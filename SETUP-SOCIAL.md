# Social platforms setup (YouTube · TikTok · X)

This app can connect and publish the finished MP4 to **YouTube**, **TikTok**, and **X**.

Open the simulator at `http://localhost:3000`, use the **Social** cards on the start screen, then tick platforms on the post-match screen.

---

## 0) Common for all platforms

1. Run the app: `npm start` → open `http://localhost:3000`
2. Keep credentials only in `.env` (never commit them)
3. After editing `.env`, restart the server
4. On the start screen: **Connect / Reconnect / Disconnect / Refresh** per platform

Copy new keys into `.env` using the names below (also listed in `.env.example`).

---

## 1) YouTube (already supported)

### Create credentials
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. **APIs & Services → Library** → enable **YouTube Data API v3**
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
5. Application type: **Web application**
6. Authorized redirect URI:
   - `http://localhost:3000/oauth2callback`
7. Copy **Client ID** and **Client secret**

### Put in `.env`
```bash
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback
YOUTUBE_SCHEDULE_MINUTES=60
```

### Connect
1. Restart server
2. Click **Connect** on the YouTube card
3. Approve access (token is saved automatically)
4. After a match: pick schedule time + tick **YouTube**

---

## 2) TikTok

TikTok **rejects `http://localhost`**. Every URL in the developer portal must start with **`https://`**.

For local testing, use a free HTTPS tunnel (**ngrok** or Cloudflare Tunnel).

### A. Create an HTTPS tunnel to your local app
1. Keep the simulator running: `npm start` (port 3000)
2. Install ngrok: https://ngrok.com/download (or `brew install ngrok`)
3. Sign up / add your authtoken once
4. In a **second terminal**:
   ```bash
   ngrok http 3000
   ```
5. Copy the HTTPS URL ngrok shows, e.g.
   `https://abc123.ngrok-free.app`
6. Your TikTok callback will be:
   `https://abc123.ngrok-free.app/oauth/tiktok/callback`

> Free ngrok URLs change when you restart ngrok unless you reserve a static domain. If the URL changes, update TikTok portal + `.env` again.

### B. Create the TikTok app
1. Go to [TikTok for Developers](https://developers.tiktok.com/)
2. **Manage apps → Create an app**
3. Add products:
   - **Login Kit**
   - **Content Posting API**
4. In app / Login Kit settings, fill **HTTPS** fields only:
   - **Website URL**: `https://abc123.ngrok-free.app` (or your real site)
   - **Terms of Service URL**: any public https page (your site, Notion, GitHub Pages, etc.)
   - **Privacy Policy URL**: any public https page
   - **Redirect URI**:
     `https://abc123.ngrok-free.app/oauth/tiktok/callback`
5. Request scopes:
   - `user.info.basic`
   - `video.upload`
   - `video.publish`
6. Copy **Client Key** and **Client Secret**

### C. Put in `.env` (must match portal exactly)
```bash
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://abc123.ngrok-free.app/oauth/tiktok/callback
TIKTOK_POST_MODE=direct
TIKTOK_PRIVACY_LEVEL=SELF_ONLY
```

### D. Connect
1. Restart `npm start`
2. Keep `ngrok http 3000` running
3. Open the app via the **ngrok https URL** (or localhost is fine for UI, but OAuth callback must hit ngrok)
4. Click **Connect** on the TikTok card → approve
5. After a match, tick **TikTok** and generate

### Notes
- Until TikTok audits your app, posts are often **private / self-only**, or use:
  ```bash
  TIKTOK_POST_MODE=inbox
  ```
  then finish posting in the TikTok app.
- If TikTok says **integration guidelines**:
  - Unaudited Direct Post only works with **SELF_ONLY** and a **private** TikTok account
- Prefer `TIKTOK_POST_MODE=direct` so captions apply (unaudited apps: private/`SELF_ONLY` only). If Direct Post is blocked, the app falls back to inbox drafts and shows a **Copy caption** button — inbox mode cannot set title/caption via API.
  - Public auto-posting needs TikTok’s Content Posting API **audit**
- If TikTok says **“correct … client_key”**:
  1. Confirm **Login Kit** is added on the same app as Content Posting API
  2. Re-copy **Client Key** (not Client Secret) into `TIKTOK_CLIENT_KEY`
  3. Redirect URI in the portal must match `.env` **character-for-character** (including `https://…ngrok…/oauth/tiktok/callback`)
  4. Keep ngrok running; if the ngrok URL changed, update portal + `.env` and restart the server
  5. If the app is in sandbox / unreviewed, add your TikTok account as a **test user**
- Official docs: [Login Kit Web](https://developers.tiktok.com/doc/login-kit-web) · [Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started) · [Sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/)

---

## 3) X (Twitter)

X posting needs a developer project/app with **OAuth 2.0** user tokens. Video upload needs the **`media.write`** scope. Paid API access may be required depending on your X developer tier.

### Create app
1. Go to [X Developer Portal](https://developer.x.com/)
2. Create a **Project** + **App**
3. App settings → **User authentication settings**:
   - Turn on **OAuth 2.0**
   - Type: **Web App**
   - Callback URL:
     - `http://localhost:3000/oauth/x/callback`
   - Website URL: your site or `http://localhost:3000`
   - App permissions: read + write
4. Copy **Client ID** and **Client Secret** (OAuth 2.0)

### Put in `.env`
```bash
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_REDIRECT_URI=http://localhost:3000/oauth/x/callback
X_SCOPES=tweet.read tweet.write users.read offline.access media.write
```

### Connect & publish
1. Restart server
2. Click **Connect** on the X card → approve (include media permission)
3. After a match, tick **X** and generate
4. The app uploads the MP4, waits for processing, then creates a post with the video

Official docs:
- [X OAuth 2.0](https://developer.x.com/en/docs/authentication/oauth-2-0)
- [Media upload](https://docs.x.com/x-api/media/introduction)

---

## 4) Quick checklist

| Platform | Redirect URI | Main env keys | Connect URL |
|----------|--------------|---------------|-------------|
| YouTube | `http://localhost:3000/oauth2callback` | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | `/auth/youtube` |
| TikTok | `https://YOUR-NGROK-URL/oauth/tiktok/callback` | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `/auth/tiktok` |
| X | `http://localhost:3000/oauth/x/callback` | `X_CLIENT_ID`, `X_CLIENT_SECRET` | `/auth/x` |

### After a match
1. Choose music
2. Set YouTube schedule (if publishing to YouTube)
3. Tick **YouTube / TikTok / X**
4. **Generate MP4 & Upload**
5. Use **Download MP4** anytime

### Status APIs (debug)
- `GET /api/youtube-status`
- `GET /api/tiktok-status`
- `GET /api/x-status`

---

## Common issues

- **TikTok “valid URL beginning with https://”** → TikTok does not accept `http://localhost`. Use ngrok HTTPS for Website / Privacy / Terms / Redirect URI (see TikTok section above)
- **redirect_uri mismatch** → URI in the developer portal must match `.env` exactly
- **TikTok private only** → app not audited yet; use `SELF_ONLY` or `TIKTOK_POST_MODE=inbox`
- **X 403 on media** → reconnect and ensure `media.write` is granted; check your X API access tier
- **Gemini titles fail** → MP4 + social upload still work; titles fall back to defaults
