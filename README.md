# NoteZ AI backend — LangChain edition

This replaces the earlier plain Node/Express proxy. Same job — hold the real
Gemini key server-side, verify sign-in, stream the response back — but the
actual call to Gemini now goes through **LangChain** (`ChatGoogleGenerativeAI`)
instead of a raw `fetch`. The frontend (`index.html`) needed **no changes**
for this migration: it already points at `http://localhost:8787/api/chat`
and sends/expects the same OpenAI-style request and streaming response shape,
which this server produces too.

```
Browser (NoteZ)  →  this server (FastAPI + LangChain)  →  Gemini API
                 ←  streamed back, same SSE format as before ←
```

## 1. Install and configure

```bash
cd notez-backend-langchain
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in `.env`:
- `GEMINI_API_KEYS` — your Gemini key(s), comma-separated for fallback
- `FIREBASE_WEB_API_KEY` — the same Web API key your frontend already uses
  for sign-in (search `FB_API_KEY` in `index.html`)

## 2. Run it

```bash
python main.py
```

```
NoteZ AI backend (LangChain) listening on http://localhost:8787
  Gemini keys configured: 1
  Firebase verification:  enabled
  Allowed origin:         *
```

With this running, NoteZ's AI chat works exactly as before — same streaming,
same speed — just routed through LangChain now instead of a raw API call.

## 3. On GitHub Pages — read this before you plan around it

GitHub Pages can host your **frontend** (`index.html`) for free, permanently,
with no laptop required — that part's a genuinely good fit. But it's static
file hosting only; it cannot run this Python server. So even with everything
else in place, this backend still needs to live somewhere that can run a
process 24/7 — your laptop, or a small host. GitHub itself doesn't offer a
free way to keep a server like this running continuously (Actions/Codespaces
aren't built for that).

Practically, that means: frontend → GitHub Pages. Backend → one of the two
options below.

## 4. Exposing the backend

**Option A — your laptop (what you asked for):**
```bash
cloudflared tunnel --url http://localhost:8787
```
This prints a public `https://xxxx.trycloudflare.com` URL. Put
`https://xxxx.trycloudflare.com/api/chat` into `index.html`'s `GROQ_URL`, and
set `ALLOWED_ORIGIN` in `.env` to your GitHub Pages URL. Only stays up while
your laptop is on and `cloudflared` is running.

**Option B — a small always-on host** (next step if you want NoteZ reachable
at all times without your laptop staying on): Railway, Render, or a cheap VPS
all run this exact `main.py` unchanged — same `pip install -r
requirements.txt && python main.py`, just on infrastructure that doesn't sleep.

Either way, update `GROQ_URL` in `index.html` to point at wherever this ends
up running, and `ALLOWED_ORIGIN` in `.env` to your actual frontend URL once
you lock one in.

## 5. Tuning the limits

`AUTH_DAILY_LIMIT` / `ANON_DAILY_LIMIT` in `.env` cap requests per logged-in
user / per anonymous (Test Mode) IP per day — your actual cost control now
that the key can't be stolen from the browser. Tune to your real budget.

## What changed from the Node version

- Same `/api/chat` endpoint, same request/response shape — `index.html`
  doesn't know or care which backend is behind `GROQ_URL`.
- The Gemini call itself is now made through LangChain's
  `ChatGoogleGenerativeAI`, not a raw `fetch`. This is what makes adding a
  second provider (Groq, etc.) later a matter of adding another LangChain
  chat model, not rewriting the request/streaming plumbing.
- Firebase token verification, daily quotas, and key rotation all carried
  over with the same logic, just in Python.
