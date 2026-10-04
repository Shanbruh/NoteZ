# Deploying NoteZ (ai-notez)

Your project is already wired up for Firebase Hosting under the project id
**`ai-notez`** (see `.firebaserc`). This ties that together with the backend
proxy from `notez-backend-langchain/`, and notes two real bugs I found and
fixed in your uploaded files while going through them.

## What I changed in the files you uploaded, and why

- **`sw.js`** — the service worker's bypass list only knew about the old
  direct Gemini URL. Now that AI calls go through your own backend instead,
  every chat request (a POST) was falling through to the generic cache
  handler, which tries `cache.put()` on it — the Cache API silently rejects
  that for non-GET requests. Harmless-ish in isolation, but it's exactly the
  kind of thing that can intermittently interfere with a streaming response
  and floods devtools with unhandled-rejection noise on every single message.
  Fixed by skipping all non-GET requests up front — robust regardless of
  whether your backend ends up on localhost, a tunnel, or a real host. Bumped
  the cache version (v72 → v73) so clients actually pick up the fix instead
  of running the stale cached service worker indefinitely.
- **`firebase.json`** — `"public": "."` deploys your whole project directory.
  Without an explicit ignore, your backend source (`notez-backend-langchain/`)
  would be uploaded as public static files on your hosting URL — not as
  dangerous as leaking the Gemini key itself, but still your server logic,
  rate-limit numbers, and auth approach sitting at a guessable public path.
  Added it (and Python/Node build artifacts) to `ignore`.
- **`.gitignore`** — added `venv/`, `__pycache__/`, and the Python backend's
  `.env` so secrets and build artifacts from the new backend never get
  committed, same protection your existing Node `.gitignore` entries already
  gave the frontend.
- **I did *not* use the `index.html` you uploaded** — it's an earlier copy
  that predates this session's work (it still has a Gemini key hardcoded in
  it, among other things). I kept the version I've been building on, which
  includes the backend-proxy migration, trash feature, and everything else
  from this conversation. If that uploaded copy is actually what's live right
  now, treat its key as compromised — rotate it regardless of anything else.
- **Didn't touch** `manifest.json`, `404.html`, the icons, `.firebaserc`, or
  `package-lock.json` — nothing about this work needed them to change.
- **Left the `hosting_*.cache` files alone** — those are Firebase CLI's own
  deploy bookkeeping (normally inside `.firebase/`, already gitignored).
  They regenerate automatically on your next `firebase deploy`; don't hand-edit them.

## Deploying the frontend (Firebase Hosting)

From the project root (where `firebase.json` lives):
```bash
firebase deploy --only hosting
```
This publishes `index.html`, `sw.js`, `manifest.json`, the icons, and
`404.html` to `https://ai-notez.web.app` (also mirrored at
`https://ai-notez.firebaseapp.com`) — and now correctly leaves the backend
folder out of it.

## Deploying the backend

This is the part Firebase Hosting *can't* do (see the earlier conversation —
it's static-only). Pick one:
- **Your laptop + Cloudflare Tunnel** — fine for personal use/testing; see
  `notez-backend-langchain/README.md`.
- **A small always-on host** (Railway, Render, a cheap VPS) — same
  `main.py`, unchanged, for when you want it reachable without your laptop
  staying on.

Either way, once you know the backend's real URL:
1. Set `GROQ_URL` in `index.html` to `<your-backend-url>/api/chat`.
2. Set `ALLOWED_ORIGIN` in the backend's `.env` to `https://ai-notez.web.app`.
3. Re-deploy the frontend (`firebase deploy --only hosting`) so the updated
   `GROQ_URL` goes live.
