require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const tiktok = require('./platforms/tiktok');
const xPlatform = require('./platforms/x');
const { buildMatchMetadataPrompt } = require('./prompts/matchMetadata');
const {
  resolveLeagueContext,
  mergeLeagueIntoMetadata,
} = require('./prompts/leagueHashtags');
const fixtures = require('./platforms/fixtures');
const { oauthCookieHeader, readCookie } = require('./platforms/oauthStore');

const PORT = process.env.PORT || 3000;
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const MUSIC_DIR = path.join(__dirname, 'music');
const YOUTUBE_REDIRECT_URI =
  process.env.YOUTUBE_REDIRECT_URI || `http://localhost:${PORT}/oauth2callback`;

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm']);

const YOUTUBE_CATEGORIES = {
  Sports: '17',
  Gaming: '20',
  Entertainment: '24',
  'People & Blogs': '22',
  Music: '10',
  Comedy: '23',
};

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}
if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RECORDINGS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `match_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

const app = express();
app.use(express.json());

function youtubeClientConfigured() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
}

function youtubeConfigured() {
  return Boolean(youtubeClientConfigured() && process.env.YOUTUBE_REFRESH_TOKEN);
}

function updateEnvVar(key, value) {
  const envPath = path.join(__dirname, '.env');
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `${key}=${value ?? ''}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, line);
  } else {
    text = `${text.replace(/\s*$/, '')}\n${line}\n`;
  }
  fs.writeFileSync(envPath, text.endsWith('\n') ? text : `${text}\n`);
  if (value === '' || value == null) {
    delete process.env[key];
  } else {
    process.env[key] = String(value);
  }
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REDIRECT_URI
  );
}

function getYoutubeClient() {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
  });
  return google.youtube({ version: 'v3', auth: oauth2Client });
}

function formatGoogleError(err) {
  const data = err?.response?.data || null;
  const nested = data?.error;
  const parts = [];
  if (err?.message) parts.push(String(err.message));
  if (typeof nested === 'string') parts.push(nested);
  if (nested && typeof nested === 'object') {
    if (nested.message) parts.push(String(nested.message));
    if (nested.status) parts.push(String(nested.status));
    if (Array.isArray(nested.errors)) {
      nested.errors.forEach((e) => {
        if (e.message) parts.push(String(e.message));
        if (e.reason) parts.push(String(e.reason));
      });
    }
    if (Array.isArray(nested.details)) {
      nested.details.forEach((d) => {
        if (d.reason) parts.push(String(d.reason));
      });
    }
  }
  if (data?.error_description) parts.push(String(data.error_description));
  return [...new Set(parts.filter(Boolean))].join(' | ') || 'Unknown Google API error';
}

async function probeYouTubeAuth() {
  const result = {
    ok: false,
    clientConfigured: youtubeClientConfigured(),
    configured: youtubeConfigured(),
    connected: false,
    redirectUri: process.env.YOUTUBE_REDIRECT_URI || null,
    hasRefreshToken: Boolean(process.env.YOUTUBE_REFRESH_TOKEN),
    channelTitle: null,
    channelId: null,
    channelThumbnail: null,
    scopes: [],
    step: null,
    error: null,
    detail: null,
    message: null,
  };

  if (!result.clientConfigured) {
    result.error = 'Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in .env';
    return result;
  }

  if (!result.hasRefreshToken) {
    result.error = 'Not connected. Click Connect YouTube to sign in.';
    return result;
  }

  try {
    result.step = 'refresh_access_token';
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    });
    const tokenRes = await oauth2Client.getAccessToken();
    if (!tokenRes || !tokenRes.token) {
      result.error = 'Refresh succeeded but no access token returned';
      return result;
    }

    result.step = 'token_info';
    try {
      const tokenInfo = await oauth2Client.getTokenInfo(tokenRes.token);
      result.scopes = tokenInfo.scopes || [];
    } catch {
      result.scopes = [];
    }

    const scopeStr = (result.scopes || []).join(' ');
    const canUpload =
      !result.scopes.length ||
      scopeStr.includes('youtube.upload') ||
      scopeStr.includes('youtube') ||
      scopeStr.includes('youtubepartner');
    if (result.scopes.length && !canUpload) {
      result.error =
        'Token is missing youtube.upload scope. Reconnect YouTube.';
      return result;
    }

    result.step = 'youtube_channels_list';
    try {
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      const channels = await youtube.channels.list({
        part: ['snippet'],
        mine: true,
      });
      const ch = channels.data.items?.[0];
      if (ch) {
        result.channelTitle = ch.snippet?.title || null;
        result.channelId = ch.id || null;
        result.channelThumbnail =
          ch.snippet?.thumbnails?.default?.url ||
          ch.snippet?.thumbnails?.medium?.url ||
          null;
      }
    } catch (chErr) {
      // Upload may still work without readonly scope
      result.channelTitle = null;
      result.channelWarning = formatGoogleError(chErr);
    }

    result.ok = true;
    result.connected = true;
    result.message = result.channelTitle
      ? `Connected as ${result.channelTitle}`
      : 'YouTube connected (upload ready)';
    return result;
  } catch (err) {
    result.error = formatGoogleError(err);
    result.detail = err?.response?.data || null;
    return result;
  }
}

function listMusicFiles() {
  if (!fs.existsSync(MUSIC_DIR)) return [];
  return fs
    .readdirSync(MUSIC_DIR)
    .filter((name) => AUDIO_EXTS.has(path.extname(name).toLowerCase()))
    .map((name) => {
      const full = path.join(MUSIC_DIR, name);
      const stat = fs.statSync(full);
      return {
        name,
        url: `/music/${encodeURIComponent(name)}`,
        size: stat.size,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveMusicPath(musicName) {
  if (!musicName || musicName === 'none') return null;
  const safe = path.basename(String(musicName));
  const full = path.join(MUSIC_DIR, safe);
  if (!fs.existsSync(full)) return null;
  if (!AUDIO_EXTS.has(path.extname(safe).toLowerCase())) return null;
  return full;
}

function runFfmpeg(args, { timeoutMs = 12 * 60 * 1000, label = 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let lastLog = 0;
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      // Keep last chunk only so memory stays small
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
      const now = Date.now();
      if (now - lastLog > 8000) {
        lastLog = now;
        const time = (text.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/) || [])[1];
        const speed = (text.match(/speed=\s*([0-9.]+x)/) || [])[1];
        if (time || speed) {
          console.log(`${label}: time=${time || '?'} speed=${speed || '?'}`);
        }
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${label} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

function probeHasAudio(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        filePath,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let out = '';
    proc.stdout.on('data', (c) => {
      out += c.toString();
    });
    proc.on('close', () => resolve(out.trim().length > 0));
    proc.on('error', () => resolve(false));
  });
}

/** Fast encode settings for small Fly VMs (webm → mp4). */
function videoEncodeArgs() {
  const preset = process.env.FFMPEG_PRESET || 'ultrafast';
  const crf = process.env.FFMPEG_CRF || '28';
  return [
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    crf,
    '-threads',
    '1',
    '-pix_fmt',
    'yuv420p',
  ];
}

function videoScaleFilter() {
  const maxH = process.env.FFMPEG_MAX_HEIGHT || '1280';
  // Shrink tall shorts for faster encode on 1-CPU Fly VMs
  return `scale=-2:${maxH}:force_original_aspect_ratio=decrease`;
}

async function mixMusicIntoVideo(videoPath, musicPath) {
  const hasAudio = await probeHasAudio(videoPath);
  const outPath = videoPath.replace(/\.[^.]+$/, '') + '_with_music.mp4';
  const musicVol = process.env.MUSIC_VOLUME || '0.55';
  const sfxVol = process.env.SFX_VOLUME || '0.85';
  const scale = videoScaleFilter();

  const commonOut = [
    ...videoEncodeArgs(),
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath,
  ];

  let args;
  if (hasAudio) {
    // Keep SFX, duck slightly; music clearly audible in background
    args = [
      '-y',
      '-i',
      videoPath,
      '-stream_loop',
      '-1',
      '-i',
      musicPath,
      '-filter_complex',
      `[0:v]${scale}[vout];` +
        `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${sfxVol}[sfx];` +
        `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${musicVol}[bg];` +
        `[sfx][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      ...commonOut,
    ];
  } else {
    args = [
      '-y',
      '-i',
      videoPath,
      '-stream_loop',
      '-1',
      '-i',
      musicPath,
      '-filter_complex',
      `[0:v]${scale}[vout];` +
        `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${musicVol}[aout]`,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      ...commonOut,
    ];
  }

  console.log(
    `ffmpeg mix → ${path.basename(outPath)} (music=${path.basename(musicPath)}, vol=${musicVol}, preset=${process.env.FFMPEG_PRESET || 'ultrafast'})`
  );
  await runFfmpeg(args, { label: 'ffmpeg-mix' });
  return outPath;
}

async function convertToMp4(videoPath) {
  if (videoPath.toLowerCase().endsWith('.mp4')) return videoPath;
  const outPath = videoPath.replace(/\.[^.]+$/, '') + '.mp4';
  const hasAudio = await probeHasAudio(videoPath);
  const args = [
    '-y',
    '-i',
    videoPath,
    '-vf',
    videoScaleFilter(),
    ...videoEncodeArgs(),
    '-movflags',
    '+faststart',
  ];
  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '160k');
  } else {
    args.push('-an');
  }
  args.push(outPath);
  console.log(`ffmpeg convert → ${path.basename(outPath)}`);
  await runFfmpeg(args, { label: 'ffmpeg-convert' });
  return outPath;
}

function safeRecordingName(name) {
  const base = path.basename(String(name || ''));
  if (!base || base !== name || base.includes('..')) return null;
  if (!/\.(mp4|webm)$/i.test(base)) return null;
  return base;
}

const HISTORY_PATH = path.join(RECORDINGS_DIR, 'history.json');

function loadHistoryStore() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return { items: [] };
    const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    return { items: Array.isArray(data.items) ? data.items : [] };
  } catch {
    return { items: [] };
  }
}

function saveHistoryStore(store) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify({ items: store.items || [] }, null, 2));
}

function emptyPlatforms() {
  return { youtube: null, tiktok: null, x: null };
}

function upsertHistoryEntry(partial) {
  const store = loadHistoryStore();
  const filename = partial.filename;
  if (!filename) return null;
  const idx = store.items.findIndex((i) => i.filename === filename);
  const prev = idx >= 0 ? store.items[idx] : null;
  const next = {
    id: filename,
    filename,
    createdAt: partial.createdAt || prev?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    match: partial.match !== undefined ? partial.match : prev?.match || null,
    music: partial.music !== undefined ? partial.music : prev?.music || null,
    metadata: partial.metadata !== undefined ? partial.metadata : prev?.metadata || null,
    platforms: {
      ...emptyPlatforms(),
      ...(prev?.platforms || {}),
      ...(partial.platforms || {}),
    },
    errors: {
      ...(prev?.errors || {}),
      ...(partial.errors || {}),
    },
  };
  if (idx >= 0) store.items[idx] = next;
  else store.items.unshift(next);
  saveHistoryStore(store);

  // Sidecar next to the video so match/result survive history.json edits
  try {
    const side = path.join(
      RECORDINGS_DIR,
      `${path.basename(filename, path.extname(filename))}.meta.json`
    );
    fs.writeFileSync(
      side,
      JSON.stringify(
        {
          filename,
          createdAt: next.createdAt,
          updatedAt: next.updatedAt,
          match: next.match,
          music: next.music,
          metadata: next.metadata,
          platforms: next.platforms,
          errors: next.errors,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.warn('Could not write match sidecar:', err.message);
  }
  return next;
}

function readMatchSidecar(filename) {
  try {
    const side = path.join(
      RECORDINGS_DIR,
      `${path.basename(filename, path.extname(filename))}.meta.json`
    );
    if (!fs.existsSync(side)) return null;
    return JSON.parse(fs.readFileSync(side, 'utf8'));
  } catch {
    return null;
  }
}

function discoverRecordingMp4s() {
  if (!fs.existsSync(RECORDINGS_DIR)) return [];
  return fs
    .readdirSync(RECORDINGS_DIR)
    .filter((f) => /\.mp4$/i.test(f) && !f.startsWith('.'))
    .map((f) => {
      const full = path.join(RECORDINGS_DIR, f);
      const st = fs.statSync(full);
      return { filename: f, mtimeMs: st.mtimeMs, createdAt: st.mtime.toISOString(), size: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function listHistory() {
  const store = loadHistoryStore();
  const byFile = new Map(store.items.map((i) => [i.filename, { ...i }]));
  for (const file of discoverRecordingMp4s()) {
    const side = readMatchSidecar(file.filename);
    if (!byFile.has(file.filename)) {
      byFile.set(file.filename, {
        id: file.filename,
        filename: file.filename,
        createdAt: (side && side.createdAt) || file.createdAt,
        updatedAt: (side && side.updatedAt) || file.createdAt,
        match: (side && side.match) || null,
        music: (side && side.music) || (/_with_music\.mp4$/i.test(file.filename) ? '(unknown)' : null),
        metadata: (side && side.metadata) || null,
        platforms: (side && side.platforms) || emptyPlatforms(),
        errors: (side && side.errors) || {},
        size: file.size,
      });
    } else {
      const row = byFile.get(file.filename);
      row.size = file.size;
      if (!row.match && side?.match) row.match = side.match;
      if (!row.metadata && side?.metadata) row.metadata = side.metadata;
      if (side?.platforms) {
        row.platforms = { ...emptyPlatforms(), ...side.platforms, ...row.platforms };
      }
    }
  }

  const items = [...byFile.values()].filter((item) => {
    if (!fs.existsSync(path.join(RECORDINGS_DIR, item.filename))) return false;
    // Prefer *_with_music.mp4 over plain sibling .mp4
    if (!/_with_music\.mp4$/i.test(item.filename)) {
      const withMusic = item.filename.replace(/\.mp4$/i, '_with_music.mp4');
      if (byFile.has(withMusic) || fs.existsSync(path.join(RECORDINGS_DIR, withMusic))) {
        return false;
      }
    }
    return true;
  });

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return items.map((item) => ({
    ...item,
    previewUrl: `/api/download/${encodeURIComponent(item.filename)}?inline=1`,
    downloadUrl: `/api/download/${encodeURIComponent(item.filename)}`,
    posted: {
      youtube: Boolean(item.platforms?.youtube?.url || item.platforms?.youtube?.id),
      tiktok: Boolean(item.platforms?.tiktok?.ok || item.platforms?.tiktok?.publishId),
      x: Boolean(item.platforms?.x?.url || item.platforms?.x?.id),
    },
  }));
}

function getHistoryEntry(filename) {
  return listHistory().find((i) => i.filename === filename) || null;
}

async function publishToSocials(filePath, metadata, opts = {}) {
  const {
    publishYoutube = false,
    publishTiktok = false,
    publishX = false,
    publishAt = null,
  } = opts;

  let youtube = null;
  let youtubeError = null;
  let tiktokResult = null;
  let tiktokError = null;
  let xResult = null;
  let xError = null;

  if (publishYoutube) {
    if (!youtubeConfigured()) {
      youtubeError = 'YouTube not connected';
    } else {
      try {
        youtube = await uploadToYouTube(filePath, metadata, publishAt);
      } catch (ytErr) {
        youtubeError = formatGoogleError(ytErr);
        console.error('YouTube upload failed:', youtubeError);
      }
    }
  }

  const socialCaption = String(
    metadata.caption || metadata.title || 'Football fans — you need to see this #Football #Soccer'
  );

  if (publishTiktok) {
    if (!tiktok.connected()) {
      tiktokError = 'TikTok not connected';
    } else {
      try {
        tiktokResult = await tiktok.uploadVideo(
          filePath,
          socialCaption.slice(0, 2200),
          updateEnvVar
        );
      } catch (err) {
        tiktokError = err.message;
        console.error('TikTok upload failed:', tiktokError);
      }
    }
  }

  if (publishX) {
    if (!xPlatform.connected()) {
      xError = 'X not connected';
    } else {
      try {
        xResult = await xPlatform.uploadVideoAndTweet(
          filePath,
          socialCaption.slice(0, 270),
          updateEnvVar
        );
      } catch (err) {
        xError = err.message;
        console.error('X upload failed:', xError);
      }
    }
  }

  return { youtube, youtubeError, tiktok: tiktokResult, tiktokError, x: xResult, xError };
}

function historyPlatformsFromPublish(result) {
  const ytVideo = result.youtube?.video || null;
  const platforms = {};
  const errors = {};
  if (ytVideo) {
    platforms.youtube = {
      id: ytVideo.id,
      url: `https://www.youtube.com/watch?v=${ytVideo.id}`,
      scheduled: Boolean(result.youtube.scheduled),
      publishAt: result.youtube.publishAt || null,
    };
  }
  if (result.tiktok) platforms.tiktok = result.tiktok;
  if (result.x) platforms.x = result.x;
  if (result.youtubeError) errors.youtube = result.youtubeError;
  if (result.tiktokError) errors.tiktok = result.tiktokError;
  if (result.xError) errors.x = result.xError;
  return { platforms, errors };
}

function sanitizeGeminiModel(raw) {
  let s = String(raw || '').split('#')[0].trim();
  // Strip API keys accidentally glued onto the model name
  s = s.replace(/AQ\.[A-Za-z0-9_-]+.*$/i, '').replace(/AIza[A-Za-z0-9_-]+.*$/i, '').trim();
  const m = s.match(/^(gemini-[a-z0-9][a-z0-9.-]*?)(?=$|[^a-z0-9.-])/i) || s.match(/^(gemini-[a-z0-9.-]+)/i);
  let name = m ? m[1] : '';
  name = name.replace(/[.-]+$/g, '');
  // Reject obviously corrupted names that still contain key fragments
  if (!name || /AQ\.|AIza/i.test(name) || name.length > 64) {
    return 'gemini-flash-latest';
  }
  return name;
}

function pickOne(arr, seed) {
  const n = Math.abs(Number(seed) || Date.now());
  return arr[n % arr.length];
}

function hashSeed(...parts) {
  const s = parts.join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function creativeFallbackMetadata(match) {
  const t1 = String(match.team1Name || match.team1 || 'T1');
  const t2 = String(match.team2Name || match.team2 || 'T2');
  const t1Tag = t1.replace(/\s+/g, '');
  const t2Tag = t2.replace(/\s+/g, '');
  const league = resolveLeagueContext(match);
  const leagueTag = league.hashtags?.[0] || '#Football';
  const leagueHashBlock = (league.hashtags || []).join(' ');
  const seed = hashSeed(t1, t2, match.score1, match.score2, Date.now(), Math.random());

  const titles = [
    `AI prediction: ${t1} vs ${t2} — wait for the bounce ${leagueTag} #Shorts`,
    `Football prediction: ${t1} vs ${t2} forgot defense ${leagueTag} #Shorts`,
    `AI predicts this ${t1} vs ${t2} ending… fair? 😭 ${leagueTag}`,
    `I ran an AI prediction on ${t1} vs ${t2}… ${leagueTag} #Prediction`,
    `${t1} vs ${t2} AI prediction — pause at 0:08 ${leagueTag} #Shorts`,
    `Match prediction: ${t1}–${t2} hits different ${leagueTag} #Shorts`,
    `AI prediction plot twist: ${t1} vs ${t2} ${leagueTag} #Shorts`,
    `Neon AI prediction. ${t1} vs ${t2}. Zero chill ${leagueTag}`,
    `Who survives this ${t1} vs ${t2} AI prediction? ${leagueTag}`,
    `${t1} vs ${t2} prediction: the bounce that broke it ${leagueTag}`,
    `AI predicts ${t1} vs ${t2} — comment before it ends ${leagueTag}`,
    `Football AI prediction: ${t1} vs ${t2} never sleeps ${leagueTag}`,
    `Prediction check: unfair or genius? ${t1} vs ${t2} ${leagueTag}`,
    `AI sim prediction — one rebound flips ${t1} vs ${t2} ${leagueTag}`,
    `Scroll for this ${t1} vs ${t2} AI prediction ${leagueTag} #Shorts`,
  ];

  const captions = [
    `AI prediction: ${t1} vs ${t2} ending is rude 😭 who you got? ${leagueHashBlock} #Prediction #${t1Tag}`,
    `Football prediction dopamine. ${t1} ⚔️ ${t2}. Stay for the bounce. ${leagueTag} #AIPrediction`,
    `AI predicts ${t1} vs ${t2} — tell me this isn't personal. ${leagueTag} #Prediction`,
    `POV: your feed finally drops a ${t1} vs ${t2} AI prediction. ${leagueTag} #Shorts`,
    `Match prediction: ${t1} vs ${t2} — comment before it flips. ${leagueTag} #AIPrediction`,
    `This ${t1}–${t2} AI prediction is illegal for the heart rate. ${leagueTag} #Prediction`,
    `Arcade AI prediction only. ${t1} vs ${t2}. Save if you felt that. ${leagueTag} #Shorts`,
    `Prediction speedrun: ${t1} vs ${t2}. Agree with the AI? ${leagueTag} #AIPrediction`,
  ];

  const descHooks = [
    `AI prediction (${league.name}): ${t1} vs ${t2} on a neon pitch — decisive moment incoming.`,
    `Football prediction energy: this ${t1} vs ${t2} ${league.name} AI sim is Shorts dopamine.`,
    `No boring build-up. Just an AI prediction of ${t1} vs ${t2} for ${league.name}.`,
    `This ${t1} vs ${t2} AI prediction feels like a fever-dream ${league.name} short.`,
    `Rivalry brain + AI prediction: ${t1} vs ${t2} (${league.name}) in under a minute.`,
  ];

  const midLines = [
    `It's an AI football prediction sim — watch the rebounds where the mood flips.`,
    `Don't skip: the last exchange is the whole prediction.`,
    `Arcade football prediction, but the tension is weirdly real.`,
    `Built for people who argue about match predictions at 2am.`,
  ];

  const ctas = [
    `Drop ${t1} or ${t2} — do you agree with this AI prediction?`,
    `Be honest: which club are you defending after this prediction?`,
    `Tag a friend who would hate this match prediction.`,
    `Like if this AI prediction raised your heart rate.`,
  ];

  const title = pickOne(titles, seed);
  const caption = pickOne(captions, seed >> 3);
  const hook = pickOne(descHooks, seed >> 5);
  const mid = pickOne(midLines, seed >> 7);
  const cta = pickOne(ctas, seed >> 9);
  const description = [
    hook,
    mid,
    '',
    `Final: ${t1} ${match.score1}-${match.score2} ${t2}`,
    '',
    cta,
    '',
    `${leagueHashBlock} #Football #Soccer #Shorts #Prediction #AIPrediction #FootballPrediction #MatchPrediction #FootballShorts #FootballTikTok #Matchday #Sports #${t1Tag} #${t2Tag} #${t1Tag}vs${t2Tag} #FootballAI`,
  ].join('\n');

  const tags = [
    'prediction',
    'AI prediction',
    'football prediction',
    'match prediction',
    'AI predicts',
    'football AI',
    'football',
    'soccer',
    'football shorts',
    'matchday',
    'sports',
    ...(league.tags || []),
    t1,
    t2,
    match.team1,
    match.team2,
    `${t1} vs ${t2}`,
  ].filter(Boolean);

  return mergeLeagueIntoMetadata(
    {
      title: stripScoreFromTitle(title).slice(0, 100),
      description,
      caption: stripScoreFromTitle(caption).slice(0, 220),
      tags: [...new Set(tags.map(String))].slice(0, 16),
      categoryId: '17',
      categoryName: 'Sports',
      source: 'fallback',
    },
    league
  );
}

function defaultMetadata(match) {
  return creativeFallbackMetadata(match);
}

function stripScoreFromTitle(title) {
  return String(title || '')
    // remove patterns like 2-1, 2–1, 2:1, ENDS 2-1, wins 3-0
    .replace(/\bENDS?\s+\d+\s*[-–:]\s*\d+\b/gi, '')
    .replace(/\b(?:wins?|beats?|defeats?)\b/gi, '')
    .replace(/\b\d+\s*[-–:]\s*\d+\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+(#)/g, ' $1')
    .trim();
}

function normalizeCategory(parsed) {
  const name = String(parsed.category || parsed.categoryName || 'Sports').trim();
  if (YOUTUBE_CATEGORIES[name]) {
    return { categoryId: YOUTUBE_CATEGORIES[name], categoryName: name };
  }
  if (parsed.categoryId && Object.values(YOUTUBE_CATEGORIES).includes(String(parsed.categoryId))) {
    const categoryName =
      Object.keys(YOUTUBE_CATEGORIES).find(
        (k) => YOUTUBE_CATEGORIES[k] === String(parsed.categoryId)
      ) || 'Sports';
    return { categoryId: String(parsed.categoryId), categoryName };
  }
  return { categoryId: '17', categoryName: 'Sports' };
}

function parseMetadataJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}

async function generateMatchMetadata(match) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('Gemini: no API key — using creative fallback metadata');
    return creativeFallbackMetadata(match);
  }

  const uniquenessSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const prompt = buildMatchMetadataPrompt(match, { uniquenessSeed });

  // Heal corrupted GEMINI_MODEL in process + .env
  const preferred = sanitizeGeminiModel(process.env.GEMINI_MODEL || 'gemini-flash-latest');
  if (process.env.GEMINI_MODEL !== preferred) {
    console.warn(`Gemini: sanitized GEMINI_MODEL → ${preferred}`);
    try {
      updateEnvVar('GEMINI_MODEL', preferred);
    } catch {
      process.env.GEMINI_MODEL = preferred;
    }
  }

  const modelCandidates = [
    preferred,
    'gemini-flash-latest',
    'gemini-pro-latest',
    'gemini-3.6-flash',
    'gemini-3-flash-preview',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
  ].filter((name, i, arr) => name && arr.indexOf(name) === i);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  let lastErr = null;

  for (const modelName of modelCandidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 1.25,
          topP: 0.95,
          responseMimeType: 'application/json',
        },
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = parseMetadataJson(text);
      if (!parsed || !parsed.title) {
        throw new Error('Gemini returned invalid JSON metadata');
      }
      const cat = normalizeCategory(parsed);
      const fallback = creativeFallbackMetadata(match);
      const league = resolveLeagueContext(match);
      console.log(`Gemini metadata via ${modelName} · league ${league.key}`);
      const merged = mergeLeagueIntoMetadata(
        {
          title: stripScoreFromTitle(String(parsed.title || fallback.title)).slice(0, 100),
          description: String(parsed.description || fallback.description),
          caption: stripScoreFromTitle(
            String(parsed.caption || fallback.caption || parsed.title || fallback.title)
          ).slice(0, 500),
          tags: Array.isArray(parsed.tags)
            ? parsed.tags.map(String).slice(0, 16)
            : fallback.tags,
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          source: 'gemini',
          model: modelName,
        },
        league
      );
      merged.title = String(merged.title || '').slice(0, 100);
      merged.caption = String(merged.caption || '').slice(0, 500);
      return merged;
    } catch (err) {
      lastErr = err;
      console.warn(`Gemini model ${modelName} failed:`, err.message.split('\n')[0].slice(0, 180));
    }
  }

  console.warn('Gemini metadata fallback:', lastErr?.message || 'all models failed');
  return creativeFallbackMetadata(match);
}

function getSchedulePublishAt(requestedIso) {
  // Prefer explicit client datetime (from datepicker). Fallback: YOUTUBE_SCHEDULE_MINUTES (default 60).
  if (requestedIso) {
    const at = new Date(requestedIso);
    if (!Number.isNaN(at.getTime()) && at.getTime() > Date.now() + 60 * 1000) {
      return at.toISOString();
    }
    throw new Error(
      'Schedule time must be a valid future datetime (at least 1 minute from now).'
    );
  }

  const raw = process.env.YOUTUBE_SCHEDULE_MINUTES;
  const minutes = raw === undefined || raw === '' ? 60 : Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function uploadToYouTube(filePath, metadata, scheduleIso) {
  const youtube = getYoutubeClient();
  const publishAt = getSchedulePublishAt(scheduleIso);
  const status = {
    selfDeclaredMadeForKids: false,
  };

  if (publishAt) {
    // Scheduled videos must be private until publishAt
    status.privacyStatus = 'private';
    status.publishAt = publishAt;
  } else {
    status.privacyStatus = process.env.YOUTUBE_PRIVACY_STATUS || 'unlisted';
  }

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId || '17',
      },
      status,
    },
    media: {
      body: fs.createReadStream(filePath),
    },
  });
  return { video: response.data, publishAt, scheduled: Boolean(publishAt) };
}

app.get('/api/config', (_req, res) => {
  const scheduleMinutes = (() => {
    const raw = process.env.YOUTUBE_SCHEDULE_MINUTES;
    if (raw === undefined || raw === '') return 60;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 60;
  })();
  res.json({
    youtubeConfigured: youtubeConfigured(),
    tiktokConfigured: tiktok.connected(),
    xConfigured: xPlatform.connected(),
    tiktokClientConfigured: tiktok.clientConfigured(),
    xClientConfigured: xPlatform.clientConfigured(),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    geminiModel: sanitizeGeminiModel(process.env.GEMINI_MODEL || 'gemini-flash-latest'),
    saveLocalCopy: process.env.SAVE_LOCAL_COPY !== 'false',
    privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || 'unlisted',
    scheduleMinutes,
    scheduleEnabled: scheduleMinutes > 0,
    musicTracks: listMusicFiles(),
  });
});

let geminiProbeCache = { at: 0, result: null };

async function probeGeminiStatus({ force = false } = {}) {
  const modelPreferred = sanitizeGeminiModel(process.env.GEMINI_MODEL || 'gemini-flash-latest');
  const base = {
    ok: false,
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: modelPreferred,
    error: null,
    message: null,
    checkedAt: new Date().toISOString(),
  };

  if (!base.configured) {
    base.error = 'GEMINI_API_KEY not set';
    base.message = 'AI titles off — using local viral templates';
    return base;
  }

  const now = Date.now();
  if (!force && geminiProbeCache.result && now - geminiProbeCache.at < 5 * 60 * 1000) {
    return { ...geminiProbeCache.result, cached: true };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const candidates = [
    modelPreferred,
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
  ].filter((name, i, arr) => name && arr.indexOf(name) === i);

  let lastErr = null;
  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32,
          responseMimeType: 'application/json',
        },
      });
      const result = await model.generateContent(
        'Reply with only JSON: {"ok":true}'
      );
      const text = String(result.response.text() || '');
      if (!/ok/i.test(text)) {
        throw new Error('Unexpected Gemini probe response');
      }
      const okResult = {
        ok: true,
        configured: true,
        model: modelName,
        error: null,
        message: `AI titles working (${modelName})`,
        checkedAt: new Date().toISOString(),
        cached: false,
      };
      geminiProbeCache = { at: Date.now(), result: okResult };
      return okResult;
    } catch (err) {
      lastErr = err;
      console.warn(
        `Gemini probe ${modelName} failed:`,
        err.message.split('\n')[0].slice(0, 160)
      );
    }
  }

  const failResult = {
    ok: false,
    configured: true,
    model: modelPreferred,
    error: (lastErr?.message || 'Gemini probe failed').split('\n')[0].slice(0, 180),
    message: 'AI titles failing — local templates will be used',
    checkedAt: new Date().toISOString(),
    cached: false,
  };
  geminiProbeCache = { at: Date.now(), result: failResult };
  return failResult;
}

app.get('/api/gemini-status', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const status = await probeGeminiStatus({ force });
    res.json(status);
  } catch (err) {
    res.status(500).json({
      ok: false,
      configured: Boolean(process.env.GEMINI_API_KEY),
      error: err.message,
      message: 'AI titles failing — local templates will be used',
    });
  }
});

app.get('/api/youtube-status', async (_req, res) => {
  const status = await probeYouTubeAuth();
  res.status(status.ok || !status.hasRefreshToken ? 200 : 401).json(status);
});

app.post('/api/youtube-disconnect', (_req, res) => {
  try {
    updateEnvVar('YOUTUBE_REFRESH_TOKEN', '');
    res.json({
      ok: true,
      message: 'YouTube disconnected. Refresh token cleared from .env.',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/tiktok-status', async (_req, res) => {
  const status = await tiktok.probeStatus(updateEnvVar);
  res.status(200).json(status);
});

app.post('/api/tiktok-disconnect', (_req, res) => {
  try {
    updateEnvVar('TIKTOK_REFRESH_TOKEN', '');
    updateEnvVar('TIKTOK_ACCESS_TOKEN', '');
    res.json({ ok: true, message: 'TikTok disconnected.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/x-status', async (_req, res) => {
  const status = await xPlatform.probeStatus(updateEnvVar);
  res.status(200).json(status);
});

app.post('/api/x-disconnect', (_req, res) => {
  try {
    updateEnvVar('X_REFRESH_TOKEN', '');
    updateEnvVar('X_ACCESS_TOKEN', '');
    res.json({ ok: true, message: 'X disconnected.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/auth/tiktok', (req, res) => {
  try {
    const auth = tiktok.getAuthUrl(PORT);
    res.setHeader('Set-Cookie', oauthCookieHeader('oauth_tiktok', auth.cookieValue));
    res.redirect(auth.url);
  } catch (err) {
    res.status(400).send(err.message);
  }
});

app.get('/oauth/tiktok/callback', async (req, res) => {
  try {
    const { code, state, error, error_description: errDesc } = req.query;
    if (error) {
      return res.status(400).send(`TikTok OAuth error: ${error} ${errDesc || ''}`);
    }
    if (!code || !state) return res.status(400).send('Missing code/state');
    const cookieVal = readCookie(req, 'oauth_tiktok');
    const tokens = await tiktok.exchangeCode(String(code), String(state), cookieVal);
    res.setHeader('Set-Cookie', oauthCookieHeader('oauth_tiktok', '', { clear: true }));
    if (tokens.refresh_token) updateEnvVar('TIKTOK_REFRESH_TOKEN', tokens.refresh_token);
    if (tokens.access_token) updateEnvVar('TIKTOK_ACCESS_TOKEN', tokens.access_token);
    let name = null;
    try {
      const user = await tiktok.probeStatus(updateEnvVar);
      name = user.displayName;
    } catch {
      /* ignore */
    }
    res.send(`
      <html><body style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:20px;background:#0a111a;color:#fff;">
        <h1>TikTok connected${name ? `: ${name}` : ''}</h1>
        <p>Tokens saved for this server process. On Fly, also run <code>fly secrets set TIKTOK_REFRESH_TOKEN=...</code> if deploys wipe them.</p>
        <p><a href="/" style="color:#00f3ff;">← Back to simulator</a></p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`TikTok OAuth error: ${err.message}`);
  }
});

app.get('/auth/x', (req, res) => {
  try {
    const auth = xPlatform.getAuthUrl(PORT);
    res.setHeader('Set-Cookie', oauthCookieHeader('oauth_x', auth.cookieValue));
    res.redirect(auth.url);
  } catch (err) {
    res.status(400).send(err.message);
  }
});

app.get('/oauth/x/callback', async (req, res) => {
  try {
    const { code, state, error, error_description: errDesc } = req.query;
    if (error) {
      return res.status(400).send(`X OAuth error: ${error} ${errDesc || ''}`);
    }
    if (!code || !state) return res.status(400).send('Missing code/state');
    const cookieVal = readCookie(req, 'oauth_x');
    const tokens = await xPlatform.exchangeCode(String(code), String(state), cookieVal);
    res.setHeader('Set-Cookie', oauthCookieHeader('oauth_x', '', { clear: true }));
    if (tokens.refresh_token) updateEnvVar('X_REFRESH_TOKEN', tokens.refresh_token);
    if (tokens.access_token) updateEnvVar('X_ACCESS_TOKEN', tokens.access_token);
    let handle = null;
    try {
      const st = await xPlatform.probeStatus(updateEnvVar);
      handle = st.username ? `@${st.username}` : st.name;
    } catch {
      /* ignore */
    }
    res.send(`
      <html><body style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:20px;background:#0a111a;color:#fff;">
        <h1>X connected${handle ? `: ${handle}` : ''}</h1>
        <p>Tokens saved for this server process.</p>
        <p><a href="/" style="color:#00f3ff;">← Back to simulator</a></p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`X OAuth error: ${err.message}`);
  }
});

app.get('/api/music', (_req, res) => {
  res.json({ tracks: listMusicFiles() });
});

app.get('/auth/youtube', (_req, res) => {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    return res.status(400).send(
      'Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first.'
    );
  }
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    let saved = false;
    let channelTitle = null;

    if (tokens.refresh_token) {
      updateEnvVar('YOUTUBE_REFRESH_TOKEN', tokens.refresh_token);
      saved = true;
    } else if (process.env.YOUTUBE_REFRESH_TOKEN) {
      // Re-consent sometimes omits refresh_token if one already exists
      saved = true;
    }

    try {
      if (tokens.access_token) {
        oauth2Client.setCredentials(tokens);
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        const channels = await youtube.channels.list({
          part: ['snippet'],
          mine: true,
        });
        channelTitle = channels.data.items?.[0]?.snippet?.title || null;
      }
    } catch {
      // ignore channel lookup failures on connect page
    }

    res.send(`
      <html><body style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:20px;background:#0a111a;color:#fff;">
        <h1>YouTube connected${channelTitle ? `: ${channelTitle}` : ''}</h1>
        ${
          saved
            ? '<p>Refresh token saved to <code>.env</code>. You can close this tab and return to the simulator.</p>'
            : `<p>No new refresh token was returned. Revoke app access in Google Account permissions, then try Connect again.</p>
               <pre style="background:#111;padding:16px;overflow:auto;">YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token || '(none)'}</pre>`
        }
        <p><a href="/" style="color:#00f3ff;">← Back to simulator</a></p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

app.post('/api/upload-match', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No video file received.' });
  }

  const match = {
    team1: req.body.team1 || 'T1',
    team2: req.body.team2 || 'T2',
    team1Name: req.body.team1Name || req.body.team1 || 'T1',
    team2Name: req.body.team2Name || req.body.team2 || 'T2',
    score1: String(req.body.score1 ?? '0'),
    score2: String(req.body.score2 ?? '0'),
    league: req.body.league || req.body.competition || '',
    leagueName: req.body.leagueName || '',
    team1League: req.body.team1League || '',
    team2League: req.body.team2League || '',
  };
  const skipYoutube = req.body.skipYoutube === 'true' || req.body.skipYoutube === '1';
  const publishYoutube =
    !skipYoutube &&
    (req.body.publishYoutube === undefined ||
      req.body.publishYoutube === 'true' ||
      req.body.publishYoutube === '1');
  const publishTiktok =
    req.body.publishTiktok === 'true' || req.body.publishTiktok === '1';
  const publishX = req.body.publishX === 'true' || req.body.publishX === '1';

  let filePath = req.file.path;
  let savedPath = filePath;
  let finalMp4 = null;

  try {
    const musicPath = resolveMusicPath(req.body.music);
    console.log(`Upload music field: "${req.body.music}" → ${musicPath || 'none'}`);
    if (musicPath) {
      console.log(`Mixing music: ${path.basename(musicPath)}`);
      finalMp4 = await mixMusicIntoVideo(filePath, musicPath);
    } else {
      console.log('Converting recording to MP4…');
      finalMp4 = await convertToMp4(filePath);
    }
    filePath = finalMp4;

    const metadata = await generateMatchMetadata(match);

    if (publishYoutube && process.env.REQUIRE_YOUTUBE === 'true' && !youtubeConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'YouTube is not configured. Visit /auth/youtube after setting client credentials.',
        downloadUrl: `/api/download/${encodeURIComponent(path.basename(filePath))}`,
        previewUrl: `/api/download/${encodeURIComponent(path.basename(filePath))}?inline=1`,
      });
    }

    const published = await publishToSocials(filePath, metadata, {
      publishYoutube,
      publishTiktok,
      publishX,
      publishAt: req.body.publishAt || null,
    });
    const youtube = published.youtube;
    const youtubeError = published.youtubeError;
    const tiktokResult = published.tiktok;
    const tiktokError = published.tiktokError;
    const xResult = published.x;
    const xError = published.xError;

    savedPath = filePath;

    const downloadName = path.basename(filePath);
    const ytVideo = youtube?.video || null;
    const histPatch = historyPlatformsFromPublish(published);
    upsertHistoryEntry({
      filename: downloadName,
      match,
      music: musicPath ? path.basename(musicPath) : null,
      metadata,
      platforms: histPatch.platforms,
      errors: histPatch.errors,
    });

    res.json({
      ok: true,
      match,
      metadata,
      music: musicPath ? path.basename(musicPath) : null,
      savedPath: path.basename(savedPath),
      downloadUrl: `/api/download/${encodeURIComponent(downloadName)}`,
      previewUrl: `/api/download/${encodeURIComponent(downloadName)}?inline=1`,
      youtube: ytVideo
        ? {
            id: ytVideo.id,
            url: `https://www.youtube.com/watch?v=${ytVideo.id}`,
            scheduled: Boolean(youtube.scheduled),
            publishAt: youtube.publishAt || null,
          }
        : null,
      youtubeError,
      tiktok: tiktokResult,
      tiktokError,
      x: xResult,
      xError,
      message: ytVideo
        ? youtube.scheduled
          ? `Scheduled on YouTube for ${youtube.publishAt}.`
          : 'Match uploaded to YouTube.'
        : youtubeError
          ? `Final MP4 ready. YouTube failed: ${youtubeError}`
          : 'Final MP4 ready.',
    });
  } catch (err) {
    console.error('Upload failed:', err);
    const fallbackMp4 =
      finalMp4 && fs.existsSync(finalMp4) ? path.basename(finalMp4) : null;
    res.status(500).json({
      ok: false,
      error: err.message || 'Upload failed.',
      savedPath: fs.existsSync(req.file.path) ? path.basename(req.file.path) : null,
      downloadUrl: fallbackMp4
        ? `/api/download/${encodeURIComponent(fallbackMp4)}`
        : null,
      previewUrl: fallbackMp4
        ? `/api/download/${encodeURIComponent(fallbackMp4)}?inline=1`
        : null,
    });
  }
});

app.get('/api/download/:filename', (req, res) => {
  const name = safeRecordingName(req.params.filename);
  if (!name) {
    return res.status(400).json({ ok: false, error: 'Invalid filename.' });
  }
  const full = path.join(RECORDINGS_DIR, name);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ ok: false, error: 'File not found.' });
  }
  const inline = req.query.inline === '1';
  res.setHeader(
    'Content-Type',
    name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/webm'
  );
  if (inline) {
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  }
  fs.createReadStream(full).pipe(res);
});

app.get('/api/history', (_req, res) => {
  try {
    res.json({ ok: true, items: listHistory() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/fixtures/suggested', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await fixtures.getSuggestedFixtures({ force });
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('Fixtures failed:', err);
    res.status(500).json({ ok: false, error: err.message || 'Fixtures failed.' });
  }
});

app.post('/api/fixtures/refresh', async (_req, res) => {
  try {
    const data = await fixtures.getSuggestedFixtures({ force: true });
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('Fixtures refresh failed:', err);
    res.status(500).json({ ok: false, error: err.message || 'Fixtures refresh failed.' });
  }
});

app.get('/api/history/:filename', (req, res) => {
  const name = safeRecordingName(req.params.filename);
  if (!name) return res.status(400).json({ ok: false, error: 'Invalid filename.' });
  const item = getHistoryEntry(name);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found.' });
  res.json({ ok: true, item });
});

app.post('/api/history/:filename/publish', async (req, res) => {
  const name = safeRecordingName(req.params.filename);
  if (!name) return res.status(400).json({ ok: false, error: 'Invalid filename.' });
  const full = path.join(RECORDINGS_DIR, name);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ ok: false, error: 'File not found.' });
  }

  const entry = getHistoryEntry(name) || {
    filename: name,
    match: null,
    metadata: null,
    platforms: emptyPlatforms(),
    errors: {},
  };

  const publishYoutube =
    req.body?.publishYoutube === true || req.body?.publishYoutube === 'true';
  const publishTiktok =
    req.body?.publishTiktok === true || req.body?.publishTiktok === 'true';
  const publishX = req.body?.publishX === true || req.body?.publishX === 'true';

  if (!publishYoutube && !publishTiktok && !publishX) {
    return res.status(400).json({ ok: false, error: 'Select at least one platform.' });
  }

  // Don't re-upload platforms already posted unless force=true
  const force = req.body?.force === true || req.body?.force === 'true';
  const wantYoutube =
    publishYoutube && (force || !entry.posted?.youtube);
  const wantTiktok = publishTiktok && (force || !entry.posted?.tiktok);
  const wantX = publishX && (force || !entry.posted?.x);

  if (!wantYoutube && !wantTiktok && !wantX) {
    return res.json({
      ok: true,
      item: entry,
      message: 'Already posted to the selected platforms.',
    });
  }

  try {
    let metadata = entry.metadata;
    if (!metadata || !metadata.title) {
      metadata = await generateMatchMetadata(
        entry.match || { team1: 'T1', team2: 'T2', score1: '0', score2: '0' }
      );
    }

    const published = await publishToSocials(full, metadata, {
      publishYoutube: wantYoutube,
      publishTiktok: wantTiktok,
      publishX: wantX,
      publishAt: req.body?.publishAt || null,
    });

    const histPatch = historyPlatformsFromPublish(published);
    const saved = upsertHistoryEntry({
      filename: name,
      match: entry.match,
      music: entry.music,
      metadata,
      platforms: histPatch.platforms,
      errors: histPatch.errors,
    });

    res.json({
      ok: true,
      item: getHistoryEntry(name) || saved,
      youtube: histPatch.platforms.youtube || null,
      youtubeError: published.youtubeError,
      tiktok: published.tiktok,
      tiktokError: published.tiktokError,
      x: published.x,
      xError: published.xError,
    });
  } catch (err) {
    console.error('History publish failed:', err);
    res.status(500).json({ ok: false, error: err.message || 'Publish failed.' });
  }
});

app.use('/music', express.static(MUSIC_DIR));
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));
app.use('/clubs', express.static(path.join(__dirname, 'clubs')));
app.use(express.static(__dirname));

app.get('/api/clubs', (_req, res) => {
  const clubsPath = path.join(__dirname, 'clubs', 'clubs.json');
  if (!fs.existsSync(clubsPath)) {
    return res.json({ ok: true, count: 0, clubs: [], leagues: [] });
  }
  try {
    const data = JSON.parse(fs.readFileSync(clubsPath, 'utf8'));
    res.json({
      ok: true,
      count: data.count || (data.clubs || []).length,
      leagues: data.leagues || [],
      clubs: data.clubs || [],
      updatedAt: data.updatedAt || null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`UCL Simulator server → http://0.0.0.0:${PORT}`);
  console.log(`YouTube: ${youtubeConfigured() ? 'ready' : 'not configured (open /auth/youtube)'}`);
  console.log(`Music tracks: ${listMusicFiles().length} in ./music`);
  if (process.env.GEMINI_API_KEY) {
    console.log('Gemini: metadata generation enabled');
  }
});
