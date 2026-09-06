const crypto = require('crypto');

const pending = new Map(); // state -> { platform, codeVerifier, createdAt } (local fallback)

function base64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPkce() {
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

function signingSecret() {
  return (
    process.env.OAUTH_STATE_SECRET ||
    process.env.X_CLIENT_SECRET ||
    process.env.TIKTOK_CLIENT_SECRET ||
    process.env.YOUTUBE_CLIENT_SECRET ||
    'local-dev-oauth-secret'
  );
}

/** Cookie-safe session so PKCE works across multiple Fly machines. */
function createOAuthSession(platform, extra = {}) {
  const state = base64Url(crypto.randomBytes(16));
  const pkce = createPkce();
  const payloadObj = {
    platform,
    state,
    codeVerifier: pkce.codeVerifier,
    t: Date.now(),
    ...extra,
  };
  const payload = base64Url(Buffer.from(JSON.stringify(payloadObj), 'utf8'));
  const sig = base64Url(
    crypto.createHmac('sha256', signingSecret()).update(payload).digest()
  );
  // Keep in-memory too (single-machine / local)
  pending.set(state, {
    platform,
    codeVerifier: pkce.codeVerifier,
    codeChallenge: pkce.codeChallenge,
    ...extra,
    createdAt: Date.now(),
  });
  for (const [k, v] of pending) {
    if (Date.now() - v.createdAt > 30 * 60 * 1000) pending.delete(k);
  }
  return {
    state,
    codeChallenge: pkce.codeChallenge,
    codeVerifier: pkce.codeVerifier,
    cookieValue: `${payload}.${sig}`,
  };
}

function parseOAuthCookie(cookieValue) {
  if (!cookieValue || !cookieValue.includes('.')) return null;
  const [payload, sig] = cookieValue.split('.');
  const expect = base64Url(
    crypto.createHmac('sha256', signingSecret()).update(payload).digest()
  );
  if (sig !== expect) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    );
    const row = JSON.parse(json);
    if (!row?.state || !row?.codeVerifier || !row?.platform) return null;
    if (Date.now() - Number(row.t || 0) > 30 * 60 * 1000) return null;
    return row;
  } catch {
    return null;
  }
}

function saveOAuthState(platform, extra = {}) {
  // Back-compat: still returns state + challenge; prefer createOAuthSession
  const session = createOAuthSession(platform, extra);
  return {
    state: session.state,
    codeChallenge: session.codeChallenge,
    codeVerifier: session.codeVerifier,
    cookieValue: session.cookieValue,
  };
}

function takeOAuthState(state, cookieValue) {
  // Prefer signed cookie (multi-machine safe)
  if (cookieValue) {
    const row = parseOAuthCookie(cookieValue);
    if (row && row.state === state) {
      pending.delete(state);
      return row;
    }
  }
  const row = pending.get(state);
  if (!row) return null;
  pending.delete(state);
  return row;
}

function oauthCookieHeader(name, value, { clear = false } = {}) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  if (clear) {
    return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  }
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

function readCookie(req, name) {
  const raw = req.headers?.cookie || '';
  const parts = raw.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return null;
}

module.exports = {
  saveOAuthState,
  takeOAuthState,
  createOAuthSession,
  createPkce,
  base64Url,
  oauthCookieHeader,
  readCookie,
};
