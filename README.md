# NoteZ — AI Voice Notes & Smart Notes

**NoteZ** is a web-based AI voice-note and note-taking app. It brings a notes workspace together with AI assistance in an installable Progressive Web App (PWA). The frontend is hosted as a static site on Firebase, while a separate Python API handles server-side AI requests.

- **Live app:** https://ai-notez.web.app
- **Repository:** https://github.com/Shanbruh/NoteZ

> The frontend and backend are separate parts of the project. Firebase Hosting serves the web app; it does not run the Python API.

## Features

- **Voice notes and note organization** — a web-based workspace for capturing and working with notes.
- **AI assistance** — chat with an AI model through the NoteZ backend.
- **Retrieval and indexing** — note-related indexing and retrieval support for finding relevant context.
- **Streaming responses** — the backend streams AI output using Server-Sent Events (SSE).
- **Authentication-aware requests** — Firebase ID tokens can be verified by the backend.
- **Usage limits** — configurable daily request caps for authenticated users and anonymous traffic.
- **Installable PWA** — web-app manifest, service worker, and cached assets support an app-like experience.
- **Offline-aware shell** — the service worker caches the app shell and selected CDN assets.
- **Math and PDF support** — MathJax and PDF.js are precached by the service worker.
- **Firebase deployment** — static frontend deployment is configured with `firebase.json`.

Feature availability can depend on the current frontend configuration and whether the AI backend is running.

## Architecture

```text
                         ┌──────────────────────────┐
                         │ User's browser / PWA     │
                         │ index.html               │
                         │ notes UI + AI interface  │
                         └────────────┬─────────────┘
                                      │
                   ┌──────────────────┴──────────────────┐
                   │                                     │
                   ▼                                     ▼
        ┌─────────────────────┐             ┌────────────────────────┐
        │ Firebase services   │             │ NoteZ AI API            │
        │ Authentication /    │             │ FastAPI + Python        │
        │ app data as wired   │             │ POST /api/chat          │
        └─────────────────────┘             └────────────┬───────────┘
                                                        │
                                                        ▼
                                           ┌────────────────────────┐
                                           │ LangChain              │
                                           │ ChatGoogleGenerativeAI │
                                           └────────────┬───────────┘
                                                        │
                                                        ▼
                                           ┌────────────────────────┐
                                           │ Gemini API             │
                                           └────────────────────────┘

       Firebase Hosting serves the static frontend; the API is deployed separately.
```

### Frontend

The primary UI currently lives in `index.html`. The service worker (`sw.js`) handles caching and bypasses non-GET requests so AI POST/streaming calls are not intercepted by the cache layer. `manifest.json` defines the installable PWA metadata and icons.

### AI backend

The root-level `main.py` implements a FastAPI service:

- `GET /health` — reports service health and whether keys/Firebase verification are configured.
- `POST /api/chat` — accepts an OpenAI-style chat request and returns either a JSON completion or an SSE stream.
- LangChain's `ChatGoogleGenerativeAI` sends the model request to Gemini.
- Gemini keys are read from environment variables and rotated between requests.
- Firebase ID-token verification identifies signed-in users when configured.
- In-memory daily quotas limit authenticated and anonymous requests. These counters reset when the process restarts and are not shared between multiple instances.

## Technology stack

| Layer | Technology |
|---|---|
| Web app | HTML, CSS, JavaScript in `index.html` |
| Installability and caching | PWA manifest, Service Worker, Cache API |
| Hosting | Firebase Hosting |
| Authentication / app services | Firebase, as configured by the frontend |
| API server | Python, FastAPI, Uvicorn |
| AI orchestration | LangChain |
| Model provider | Google Gemini API |
| Streaming | Server-Sent Events (SSE) |
| Supporting libraries | HTTPX, python-dotenv, MathJax, PDF.js |

## Repository layout

```text
NoteZ/
├── index.html          # Main web app UI
├── sw.js               # Service worker and asset caching
├── manifest.json       # PWA metadata and icons
├── icon-1.png          # App icon asset
├── icon-2.png          # Icon path used by the current manifest/service worker
├── main.py             # FastAPI + LangChain AI backend
├── requirements.txt    # Python backend dependencies
├── .env.example        # Backend environment-variable template
├── .gitignore          # Ignore rules for local/generated files
├── .firebaserc         # Firebase project selection
├── firebase.json       # Firebase Hosting configuration
├── DEPLOYMENT.md       # Deployment notes
└── README.md           # Project overview and setup
```

## Run the AI backend locally

You need Python 3.10+ (use a version supported by the installed dependencies) and a Gemini API key. Firebase Web API key configuration enables the backend's Firebase ID-token verification.

### 1. Create and activate a virtual environment

**Windows PowerShell:**
```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

**macOS / Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

### 2. Configure environment variables

Copy the template to `.env` in the repository root.

**Windows PowerShell:**
```powershell
Copy-Item .env.example .env
```

**macOS / Linux:**
```bash
cp .env.example .env
```

Edit `.env` and set at least:

- `GEMINI_API_KEYS` — one or more comma-separated Gemini API keys.
- `FIREBASE_WEB_API_KEY` — the Firebase project's Web API key, if using token verification.
- `PORT` — optional; defaults to `8787`.
- `ALLOWED_ORIGIN` — set this to the exact deployed frontend origin for production rather than leaving `*`.
- `AUTH_DAILY_LIMIT` and `ANON_DAILY_LIMIT` — optional daily request limits.

**Never commit your real `.env` file or Gemini API keys.** Keep secrets on the backend; do not put provider keys in browser code.

### 3. Start the API

```bash
python main.py
```

By default, the API listens on `http://localhost:8787`.

- Health check: http://localhost:8787/health
- Chat endpoint: `POST http://localhost:8787/api/chat`

The frontend must be configured to point its AI request URL at the running backend. A locally running API is not automatically available to the public website.

## Deploy

### Frontend — Firebase Hosting

Install the Firebase CLI, authenticate, and deploy from the repository root:

```bash
firebase deploy --only hosting
```

The Hosting configuration excludes backend source and local build artifacts from the static deployment.

### Backend — separate Python hosting

Firebase Hosting is static hosting and does not run `main.py`. Deploy the API separately to a Python-capable host, or use a tunnel for temporary local testing. Configure the frontend's API URL and set `ALLOWED_ORIGIN` to the deployed frontend origin before production use.

See [DEPLOYMENT.md](DEPLOYMENT.md) for project-specific deployment notes.

## Security and operational notes

- Keep Gemini API keys in backend environment variables.
- Set a restrictive `ALLOWED_ORIGIN` in production; CORS is not authentication.
- The current daily quota store is in memory, so it is suitable only for a single-process/simple deployment. Use shared persistent storage for multi-instance production.
- The anonymous quota is keyed by the request IP as seen by the app; configure proxy handling carefully if deploying behind a reverse proxy.
- Do not treat a successful `/health` response as proof that model requests will succeed; provider keys, quotas, network access, and model availability still matter.

## Contributing

1. Fork the repository.
2. Create a branch for your change.
3. Test the frontend and backend paths affected by the change.
4. Open a pull request describing the change and how it was tested.

## License

No license file is currently included. Unless a license is added, the repository should not be assumed to grant broad permission to reuse or redistribute the code.
