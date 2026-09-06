const fs = require('fs');
const { saveOAuthState, takeOAuthState } = require('./oauthStore');

const AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const REVOKE_URL = 'https://api.twitter.com/2/oauth2/revoke';
const ME_URL = 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username';
const MEDIA_INIT = 'https://api.x.com/2/media/upload/initialize';
const MEDIA_APPEND = (id) => `https://api.x.com/2/media/upload/${id}/append`;
const MEDIA_FINALIZE = (id) => `https://api.x.com/2/media/upload/${id}/finalize`;
const MEDIA_STATUS = 'https://api.x.com/2/media/upload';
const TWEETS_URL = 'https://api.x.com/2/tweets';

function clientConfigured() {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
}

function connected() {
  return Boolean(clientConfigured() && process.env.X_REFRESH_TOKEN);
}

function redirectUri(port) {
  return (
    process.env.X_REDIRECT_URI ||
    `http://localhost:${port || process.env.PORT || 3000}/oauth/x/callback`
  );
}

function basicAuthHeader() {
  const raw = `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

function getAuthUrl(port) {
  if (!clientConfigured()) {
    throw new Error('Set X_CLIENT_ID and X_CLIENT_SECRET in .env');
  }
  const { state, codeChallenge } = saveOAuthState('x');
  const scope = (
    process.env.X_SCOPES ||
    'tweet.read tweet.write users.read offline.access media.write'
  ).trim();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: redirectUri(port),
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code, state) {
  const row = takeOAuthState(state);
  if (!row || row.platform !== 'x') {
    throw new Error('Invalid or expired X OAuth state. Try Connect again.');
  }
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: redirectUri(),
    code_verifier: row.codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `X token exchange failed (${res.status})`
    );
  }
  return data;
}

async function refreshAccessToken() {
  if (!process.env.X_REFRESH_TOKEN) throw new Error('X not connected');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.X_REFRESH_TOKEN,
    client_id: process.env.X_CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `X refresh failed (${res.status})`
    );
  }
  return data;
}

async function getMe(accessToken) {
  const res = await fetch(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || !data.data) {
    throw new Error(
      data.detail || data.title || data.error || `X user lookup failed (${res.status})`
    );
  }
  return data.data;
}

async function probeStatus(updateEnvVar) {
  const result = {
    ok: false,
    clientConfigured: clientConfigured(),
    connected: false,
    hasRefreshToken: Boolean(process.env.X_REFRESH_TOKEN),
    name: null,
    username: null,
    avatarUrl: null,
    userId: null,
    error: null,
    message: null,
  };
  if (!result.clientConfigured) {
    result.error = 'Missing X_CLIENT_ID / X_CLIENT_SECRET in .env';
    return result;
  }
  if (!result.hasRefreshToken) {
    result.error = 'Not connected. Click Connect X.';
    return result;
  }
  try {
    const tok = await refreshAccessToken();
    if (tok.refresh_token && updateEnvVar) {
      updateEnvVar('X_REFRESH_TOKEN', tok.refresh_token);
    }
    if (tok.access_token && updateEnvVar) {
      updateEnvVar('X_ACCESS_TOKEN', tok.access_token);
    }
    const me = await getMe(tok.access_token);
    result.ok = true;
    result.connected = true;
    result.name = me.name || null;
    result.username = me.username || null;
    result.avatarUrl = me.profile_image_url || null;
    result.userId = me.id || null;
    result.message = result.username
      ? `Connected as @${result.username}`
      : 'X connected';
    return result;
  } catch (err) {
    result.error = err.message;
    return result;
  }
}

async function getValidAccessToken(updateEnvVar) {
  const tok = await refreshAccessToken();
  if (tok.refresh_token && updateEnvVar) {
    updateEnvVar('X_REFRESH_TOKEN', tok.refresh_token);
  }
  if (tok.access_token && updateEnvVar) {
    updateEnvVar('X_ACCESS_TOKEN', tok.access_token);
  }
  return tok.access_token;
}

async function uploadVideoAndTweet(filePath, text, updateEnvVar) {
  const accessToken = await getValidAccessToken(updateEnvVar);
  const bytes = fs.readFileSync(filePath);
  const totalBytes = bytes.length;

  const initRes = await fetch(MEDIA_INIT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      total_bytes: totalBytes,
      media_type: 'video/mp4',
      media_category: 'tweet_video',
    }),
  });
  const initData = await initRes.json();
  const mediaId = initData?.data?.id || initData?.data?.media_id;
  if (!initRes.ok || !mediaId) {
    throw new Error(
      initData.detail ||
        initData.title ||
        initData.error ||
        `X media init failed (${initRes.status})`
    );
  }

  const chunkSize = 4 * 1024 * 1024;
  let segmentIndex = 0;
  for (let offset = 0; offset < totalBytes; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, totalBytes));
    const form = new FormData();
    form.append('segment_index', String(segmentIndex));
    const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    form.append(
      'media',
      new Blob([ab], { type: 'application/octet-stream' }),
      'chunk.mp4'
    );

    const appendRes = await fetch(MEDIA_APPEND(mediaId), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!appendRes.ok) {
      const t = await appendRes.text();
      throw new Error(`X media append failed (${appendRes.status}): ${t.slice(0, 200)}`);
    }
    segmentIndex += 1;
  }

  const finRes = await fetch(MEDIA_FINALIZE(mediaId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const finData = await finRes.json();
  if (!finRes.ok) {
    throw new Error(
      finData.detail || finData.title || `X media finalize failed (${finRes.status})`
    );
  }

  // Poll processing
  for (let i = 0; i < 30; i++) {
    const stRes = await fetch(
      `${MEDIA_STATUS}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const stData = await stRes.json();
    const info =
      stData?.data?.processing_info ||
      stData?.processing_info ||
      finData?.data?.processing_info;
    const state = info?.state;
    if (!state || state === 'succeeded') break;
    if (state === 'failed') {
      throw new Error(info?.error?.message || 'X media processing failed');
    }
    const wait = (info?.check_after_secs || 2) * 1000;
    await new Promise((r) => setTimeout(r, wait));
  }

  const tweetText = String(text || 'UCL Simulation').slice(0, 270);
  const tweetRes = await fetch(TWEETS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: tweetText,
      media: { media_ids: [String(mediaId)] },
    }),
  });
  const tweetData = await tweetRes.json();
  if (!tweetRes.ok || !tweetData.data?.id) {
    const raw =
      tweetData.detail ||
      tweetData.title ||
      tweetData.error ||
      `X tweet failed (${tweetRes.status})`;
    if (/credits? depleted|UsageCapExceeded|402/i.test(String(raw) + tweetRes.status)) {
      throw new Error(
        `${raw}. Your X API plan has no remaining credits — top up or wait for reset at https://developer.x.com/`
      );
    }
    throw new Error(raw);
  }

  const id = tweetData.data.id;
  return {
    id,
    url: `https://x.com/i/web/status/${id}`,
    mediaId,
  };
}

module.exports = {
  clientConfigured,
  connected,
  redirectUri,
  getAuthUrl,
  exchangeCode,
  probeStatus,
  uploadVideoAndTweet,
  REVOKE_URL,
};
