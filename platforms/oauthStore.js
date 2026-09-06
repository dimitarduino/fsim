const crypto = require('crypto');

const pending = new Map(); // state -> { platform, codeVerifier, createdAt }

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

function saveOAuthState(platform, extra = {}) {
  const state = base64Url(crypto.randomBytes(16));
  const pkce = createPkce();
  pending.set(state, {
    platform,
    ...pkce,
    ...extra,
    createdAt: Date.now(),
  });
  // drop stale (>30m)
  for (const [k, v] of pending) {
    if (Date.now() - v.createdAt > 30 * 60 * 1000) pending.delete(k);
  }
  return { state, ...pkce };
}

function takeOAuthState(state) {
  const row = pending.get(state);
  if (!row) return null;
  pending.delete(state);
  return row;
}

module.exports = {
  saveOAuthState,
  takeOAuthState,
  createPkce,
  base64Url,
};
