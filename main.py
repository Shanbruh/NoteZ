# ============================================================================
# NoteZ AI backend — LangChain edition
#
# Replaces the earlier plain-Express proxy. Accepts the same OpenAI-style
# chat-completions request the NoteZ frontend already sends (model, messages,
# stream), and replies with the same OpenAI-style SSE streaming format it
# already parses — so the frontend needed ZERO further changes for this
# migration. Internally, the actual call to Gemini goes through LangChain
# (ChatGoogleGenerativeAI), which is what makes this swappable: add another
# LangChain chat model class and you can support another provider without
# touching the frontend at all.
#
# Run it:
#   python -m venv venv && source venv/bin/activate   (Windows: venv\Scripts\activate)
#   pip install -r requirements.txt
#   cp .env.example .env     # then fill in your real values
#   python main.py
#
# See README.md for exposing this from your laptop or deploying it properly.
# ============================================================================

import os
import json
import time
from typing import Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

load_dotenv()

# ── Config from environment — nothing secret is ever hardcoded here ─────────
GEMINI_API_KEYS = [k.strip() for k in os.getenv("GEMINI_API_KEYS", "").split(",") if k.strip()]
FIREBASE_WEB_API_KEY = os.getenv("FIREBASE_WEB_API_KEY", "")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")
PORT = int(os.getenv("PORT", "8787"))

# Per-user and per-IP daily caps — what actually stops abuse now that the key
# itself can't be stolen from the browser anymore.
AUTH_DAILY_LIMIT = int(os.getenv("AUTH_DAILY_LIMIT", "300"))   # logged-in NoteZ users
ANON_DAILY_LIMIT = int(os.getenv("ANON_DAILY_LIMIT", "20"))    # Test Mode / no token

if not GEMINI_API_KEYS:
    print("⚠️  No GEMINI_API_KEYS set in .env — every request will fail until you add one.")
if not FIREBASE_WEB_API_KEY:
    print("⚠️  No FIREBASE_WEB_API_KEY set — logged-in requests will be treated as anonymous.")

app = FastAPI(title="NoteZ AI Backend (LangChain)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOWED_ORIGIN == "*" else [ALLOWED_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Daily quota bookkeeping (in-memory; resets if the process restarts —
# that's fine for a laptop-hosted single-process setup; swap for Redis or a
# small DB if you move to multiple instances) ───────────────────────────────
_daily_usage: dict[str, dict] = {}


def _check_and_bump_quota(kind: str, ident: str, limit: int) -> bool:
    key = f"{kind}:{ident}"
    now = time.time()
    entry = _daily_usage.get(key)
    if not entry or now >= entry["reset_at"]:
        entry = {"count": 0, "reset_at": now + 24 * 60 * 60}
    if entry["count"] >= limit:
        _daily_usage[key] = entry
        return False
    entry["count"] += 1
    _daily_usage[key] = entry
    return True


# ── Verify a Firebase ID token the lightweight way — no service-account JSON
# needed, just your Firebase project's public Web API key. ──────────────────
async def verify_firebase_token(id_token: str) -> Optional[str]:
    if not id_token or not FIREBASE_WEB_API_KEY:
        return None
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={FIREBASE_WEB_API_KEY}"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(url, json={"idToken": id_token})
        if res.status_code != 200:
            return None
        data = res.json()
        users = data.get("users") or []
        return users[0]["localId"] if users else None
    except Exception as e:
        print("Firebase token verification failed:", e)
        return None


# ── Gemini key rotation — same idea as before, just living server-side now
_key_idx = 0


def _next_key() -> str:
    global _key_idx
    if not GEMINI_API_KEYS:
        return ""
    key = GEMINI_API_KEYS[_key_idx % len(GEMINI_API_KEYS)]
    _key_idx += 1
    return key


def _to_langchain_messages(messages: list[dict]):
    """Convert the OpenAI-shaped `messages` array the frontend sends into
    LangChain's message objects."""
    out = []
    for m in messages:
        role = m.get("role")
        content = m.get("content", "")
        if role == "system":
            out.append(SystemMessage(content=content))
        elif role == "assistant":
            out.append(AIMessage(content=content))
        else:
            out.append(HumanMessage(content=content))
    return out


@app.get("/health")
async def health():
    return {
        "ok": True,
        "keysConfigured": len(GEMINI_API_KEYS),
        "firebaseConfigured": bool(FIREBASE_WEB_API_KEY),
    }


@app.post("/api/chat")
async def chat(request: Request):
    auth_header = request.headers.get("authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else ""

    uid = await verify_firebase_token(token)
    is_authed = uid is not None
    quota_kind = "user" if is_authed else "ip"
    quota_id = uid if is_authed else (request.client.host if request.client else "unknown")
    limit = AUTH_DAILY_LIMIT if is_authed else ANON_DAILY_LIMIT

    if not _check_and_bump_quota(quota_kind, quota_id, limit):
        return JSONResponse(
            status_code=429,
            content={"error": "daily_limit_reached", "message": "Daily AI usage limit reached. Try again tomorrow."},
        )

    gemini_key = _next_key()
    if not gemini_key:
        return JSONResponse(
            status_code=500,
            content={"error": "no_key_configured", "message": "Server is missing a Gemini API key."},
        )

    body = await request.json()
    model_name = body.get("model") or "gemini-3.5-flash"
    messages = _to_langchain_messages(body.get("messages", []))
    max_tokens = body.get("max_tokens")
    temperature = body.get("temperature", 0.7)
    want_stream = body.get("stream", True)

    llm = ChatGoogleGenerativeAI(
        model=model_name,
        google_api_key=gemini_key,
        max_output_tokens=max_tokens,
        temperature=temperature,
    )

    # ── Non-streaming path (a few helper features in the frontend request
    # stream:false — title generation, summarisation, etc.) ─────────────────
    if not want_stream:
        try:
            result = await llm.ainvoke(messages)
            return JSONResponse(content={"choices": [{"message": {"role": "assistant", "content": result.content}}]})
        except Exception as e:
            return JSONResponse(status_code=502, content={"error": "upstream_failed", "message": str(e)})

    # ── Streaming path — this is what NoteZ's chat UI actually uses ─────────
    async def event_stream():
        try:
            async for chunk in llm.astream(messages):
                delta = chunk.content or ""
                if delta:
                    payload = {"choices": [{"delta": {"content": delta}}]}
                    yield f"data: {json.dumps(payload)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': {'message': str(e)}})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable any reverse-proxy buffering in front of this
        },
    )


if __name__ == "__main__":
    import uvicorn

    print(f"NoteZ AI backend (LangChain) listening on http://localhost:{PORT}")
    print(f"  Gemini keys configured: {len(GEMINI_API_KEYS)}")
    print(f"  Firebase verification:  {'enabled' if FIREBASE_WEB_API_KEY else 'disabled (all requests treated as anonymous)'}")
    print(f"  Allowed origin:         {ALLOWED_ORIGIN}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
