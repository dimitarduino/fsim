const fs = require('fs');
const { saveOAuthState, takeOAuthState } = require('./oauthStore');

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const USER_INFO_URL =
  'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name';
const CREATOR_INFO_URL =
  'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const VIDEO_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const INBOX_INIT_URL =
  'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

function clientKey() {
  return String(process.env.TIKTOK_CLIENT_KEY || '').trim();
}

function clientSecret() {
  return String(process.env.TIKTOK_CLIENT_SECRET || '').trim();
}

function clientConfigured() {
  return Boolean(clientKey() && clientSecret());
}

function connected() {
  return Boolean(clientConfigured() && process.env.TIKTOK_REFRESH_TOKEN);
}

function redirectUri(port) {
  return (
    process.env.TIKTOK_REDIRECT_URI ||
    `http://localhost:${port || process.env.PORT || 3000}/oauth/tiktok/callback`
  );
}

function getAuthUrl(port) {
  if (!clientConfigured()) {
    throw new Error('Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env');
  }
  const { state, codeChallenge } = saveOAuthState('tiktok');
  const scopes = (
    process.env.TIKTOK_SCOPES ||
    'user.info.basic,video.upload,video.publish'
  ).trim();
  const params = new URLSearchParams({
    client_key: clientKey(),
    response_type: 'code',
    scope: scopes,
    redirect_uri: redirectUri(port),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code, state) {
  const row = takeOAuthState(state);
  if (!row || row.platform !== 'tiktok') {
    throw new Error('Invalid or expired TikTok OAuth state. Try Connect again.');
  }
  const body = new URLSearchParams({
    client_key: clientKey(),
    client_secret: clientSecret(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code_verifier: row.codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok || data.error || data.message === 'error') {
    throw new Error(
      data.error_description ||
        data.error ||
        data.message ||
        `TikTok token exchange failed (${res.status})`
    );
  }
  return data.data || data;
}

async function refreshAccessToken() {
  if (!process.env.TIKTOK_REFRESH_TOKEN) {
    throw new Error('TikTok not connected');
  }
  const body = new URLSearchParams({
    client_key: clientKey(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
    refresh_token: process.env.TIKTOK_REFRESH_TOKEN,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  const tok = data.data || data;
  if (!res.ok || !tok.access_token) {
    throw new Error(
      tok.error_description || tok.error || `TikTok refresh failed (${res.status})`
    );
  }
  return tok;
}

async function getUserInfo(accessToken) {
  const res = await fetch(USER_INFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  const user = data?.data?.user || data?.data || null;
  if (!res.ok || !user) {
    throw new Error(
      data?.error?.message || data?.message || `TikTok user info failed (${res.status})`
    );
  }
  return user;
}

async function probeStatus(updateEnvVar) {
  const result = {
    ok: false,
    clientConfigured: clientConfigured(),
    connected: false,
    hasRefreshToken: Boolean(process.env.TIKTOK_REFRESH_TOKEN),
    displayName: null,
    avatarUrl: null,
    openId: null,
    error: null,
    message: null,
  };
  if (!clientConfigured()) {
    result.error = 'Missing TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET in .env';
    return result;
  }
  if (!process.env.TIKTOK_REFRESH_TOKEN) {
    result.error = 'Not connected. Click Connect TikTok.';
    return result;
  }
  try {
    const tok = await refreshAccessToken();
    if (tok.refresh_token && typeof updateEnvVar === 'function') {
      updateEnvVar('TIKTOK_REFRESH_TOKEN', tok.refresh_token);
    }
    if (tok.access_token && typeof updateEnvVar === 'function') {
      updateEnvVar('TIKTOK_ACCESS_TOKEN', tok.access_token);
    }
    const user = await getUserInfo(tok.access_token);
    result.ok = true;
    result.connected = true;
    result.displayName = user.display_name || null;
    result.avatarUrl = user.avatar_url || null;
    result.openId = user.open_id || null;
    result.message = result.displayName
      ? `Connected as ${result.displayName}`
      : 'Connected';
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

async function getValidAccessToken(updateEnvVar) {
  const tok = await refreshAccessToken();
  if (tok.refresh_token && typeof updateEnvVar === 'function') {
    updateEnvVar('TIKTOK_REFRESH_TOKEN', tok.refresh_token);
  }
  if (tok.access_token && typeof updateEnvVar === 'function') {
    updateEnvVar('TIKTOK_ACCESS_TOKEN', tok.access_token);
  }
  return tok.access_token;
}

async function queryCreatorInfo(accessToken) {
  const res = await fetch(CREATOR_INFO_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: '{}',
  });
  const data = await res.json();
  return data?.data || null;
}

function isTikTokApiError(payload) {
  const code = payload?.error?.code;
  return Boolean(code && String(code).toLowerCase() !== 'ok');
}

function tiktokErrorMessage(payload, status) {
  return (
    payload?.error?.message ||
    payload?.message ||
    `TikTok request failed (${status}${payload?.error?.code ? `, ${payload.error.code}` : ''})`
  );
}

async function initUpload(accessToken, initUrl, initBody) {
  const initRes = await fetch(initUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(initBody),
  });
  const initData = await initRes.json();
  if (!initRes.ok || isTikTokApiError(initData)) {
    const msg = tiktokErrorMessage(initData, initRes.status);
    const err = new Error(msg);
    err.tiktokCode = initData?.error?.code;
    throw err;
  }
  return initData;
}

async function putVideo(uploadUrl, filePath) {
  const bytes = fs.readFileSync(filePath);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(bytes.length),
      'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
    },
    body: bytes,
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`TikTok upload PUT failed (${putRes.status}): ${t.slice(0, 200)}`);
  }
}

async function pollPublishStatus(accessToken, publishId) {
  let status = null;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const stRes = await fetch(STATUS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const stData = await stRes.json();
    status = stData?.data?.status || null;
    if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') break;
    if (status === 'FAILED') {
      throw new Error(
        stData?.data?.fail_reason || stData?.error?.message || 'TikTok publish failed'
      );
    }
  }
  return status;
}

async function uploadVideo(filePath, caption, updateEnvVar) {
  const accessToken = await getValidAccessToken(updateEnvVar);
  const stat = fs.statSync(filePath);
  const videoSize = stat.size;
  const chunkSize = videoSize;
  const totalChunkCount = 1;
  // Direct Post uses title as the caption (max ~2200); keep a shorter copy for UI.
  const title = String(caption || 'Football highlight').slice(0, 2200);
  const captionPreview = title.slice(0, 500);

  const creator = await queryCreatorInfo(accessToken).catch(() => null);
  const privacyOptions = creator?.privacy_level_options || [];
  const privacyLevel =
    privacyOptions.includes('SELF_ONLY')
      ? 'SELF_ONLY'
      : privacyOptions.includes('MUTUAL_FOLLOW_FRIENDS')
        ? 'MUTUAL_FOLLOW_FRIENDS'
        : privacyOptions[0] || process.env.TIKTOK_PRIVACY_LEVEL || 'SELF_ONLY';

  const preferredMode = (process.env.TIKTOK_POST_MODE || 'direct').toLowerCase();
  const sourceInfo = {
    source: 'FILE_UPLOAD',
    video_size: videoSize,
    chunk_size: chunkSize,
    total_chunk_count: totalChunkCount,
  };

  const directBody = {
    post_info: {
      title,
      privacy_level: privacyLevel || 'SELF_ONLY',
      disable_duet: true,
      disable_comment: false,
      disable_stitch: true,
      video_cover_timestamp_ms: 1000,
    },
    source_info: sourceInfo,
  };
  const inboxBody = { source_info: sourceInfo };

  let mode = preferredMode === 'inbox' ? 'inbox' : 'direct';
  let initData;

  if (mode === 'direct') {
    try {
      initData = await initUpload(accessToken, VIDEO_INIT_URL, directBody);
    } catch (err) {
      // Unaudited apps often can't Direct Post — fall back to inbox drafts.
      if (/integration guidelines|unaudited|privacy_level|scope/i.test(err.message)) {
        console.warn('TikTok direct post blocked, falling back to inbox:', err.message);
        mode = 'inbox';
        initData = await initUpload(accessToken, INBOX_INIT_URL, inboxBody);
      } else {
        throw err;
      }
    }
  } else {
    initData = await initUpload(accessToken, INBOX_INIT_URL, inboxBody);
  }

  const uploadUrl = initData.data?.upload_url;
  const publishId = initData.data?.publish_id;
  if (!uploadUrl) {
    throw new Error('TikTok did not return upload_url');
  }

  await putVideo(uploadUrl, filePath);
  const status = await pollPublishStatus(accessToken, publishId);

  return {
    ok: true,
    publishId,
    privacyLevel,
    mode,
    status,
    caption: captionPreview,
    titleApplied: mode === 'direct',
    message:
      mode === 'inbox'
        ? 'Draft sent to TikTok inbox — open the TikTok app to finish. Caption was not applied by inbox mode; copy it below.'
        : `Posted to TikTok (${privacyLevel}) with caption.`,
  };
}

module.exports = {
  clientConfigured,
  connected,
  redirectUri,
  getAuthUrl,
  exchangeCode,
  probeStatus,
  uploadVideo,
};
