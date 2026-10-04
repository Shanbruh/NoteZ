// NoteZ Service Worker — Offline-first, full asset caching
// v73 — Bypass all non-GET requests (fixes AI backend calls breaking under the
//        new backend-proxy architecture; see note below)

const CACHE = 'notez-v73';
const ASSETS_CACHE = 'notez-assets-v73';

const APP_ASSETS = [
  './',
  'index.html',
  'icon-1.png',
  'icon-2.png',
  'manifest.json'
];

// CDN assets to pre-cache on install
const CDN_ASSETS = [
  // MathJax v3 tex-svg — single math engine
  'https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js',
  // PDF.js
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  // Note: fflate removed — ZIP export now uses built-in implementation
];

const BYPASS_DOMAINS = [
  'firebaseio.com', 'firebaseapp.com', 'firebase.googleapis.com',
  'identitytoolkit.googleapis.com', 'securetoken.googleapis.com',
  'gstatic.com/firebasejs', 'ollama.com',
  'generativelanguage.googleapis.com', 'api.groq.com',
  'api.mistral.ai', 'api.anthropic.com', 'api.openai.com',
  'openrouter.ai',
  'picsum.photos', 'unsplash.com',
  // NoteZ's own AI backend — kept here for clarity even though the method
  // check below already bypasses it. Update if you give the backend a fixed
  // domain (it changes between local dev / tunnel / cloud host).
  'localhost:8787',
];

const CACHE_DOMAINS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

function shouldBypass(url) { return BYPASS_DOMAINS.some(d => url.includes(d)); }
function isCdnAsset(url)   { return CACHE_DOMAINS.some(d => url.includes(d)); }

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    Promise.all([
      caches.open(CACHE).then(c => c.addAll(APP_ASSETS)),
      caches.open(ASSETS_CACHE).then(async cache => {
        for (const url of CDN_ASSETS) {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
          } catch(e) {}
        }
      })
    ])
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== ASSETS_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // ── Never intercept non-GET requests ────────────────────────────────────
  // The Cache API can only store GET request/response pairs — calling
  // cache.put() on a POST silently rejects in the background. Every AI call
  // (including the streaming chat endpoint) is a POST, and used to be exempt
  // only because the old direct Gemini URL happened to be in BYPASS_DOMAINS.
  // Now that AI calls go through NoteZ's own backend proxy — whose URL
  // changes between local dev, a tunnel, and wherever it's eventually
  // deployed — a method check is the robust fix regardless of that URL.
  if (e.request.method !== 'GET') return;

  const url = e.request.url;
  if (shouldBypass(url)) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const match = await cache.match(e.request, {ignoreSearch:true})
                   || await cache.match('./', {ignoreSearch:true})
                   || await cache.match('index.html', {ignoreSearch:true});
        const networkFetch = fetch(e.request)
          .then(res => { if (res?.ok) cache.put(e.request, res.clone()); return res; })
          .catch(() => null);
        if (match) { networkFetch.catch(() => {}); return match; }
        const netRes = await networkFetch;
        if (netRes?.ok) return netRes;
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NoteZ - Offline</title>'
          +'<meta name="viewport" content="width=device-width,initial-scale=1">'
          +'<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;'
          +'height:100vh;margin:0;background:#0f0f11;color:#e8e8f0;flex-direction:column;gap:16px;text-align:center;padding:20px}'
          +'h2{color:#a900ff;font-size:2rem;margin:0}p{color:#9090a8;max-width:300px;line-height:1.5}a{color:#7c6dfa;text-decoration:none}</style></head>'
          +'<body><h2>NoteZ</h2><p>You\'re offline. Your notes are saved locally and will sync when you reconnect.</p><p><a href="javascript:location.reload()">↻ Retry</a></p></body></html>',
          {status:200, headers:{'Content-Type':'text/html'}}
        );
      })
    );
    return;
  }

  if (isCdnAsset(url)) {
    e.respondWith(
      caches.open(ASSETS_CACHE).then(async cache => {
        const cached = await cache.match(e.request, {ignoreSearch:true});
        if (cached) return cached;
        try {
          const res = await fetch(e.request);
          if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
          return res;
        } catch {
          return new Response('', {status:503});
        }
      })
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request, {ignoreSearch:true});
      if (cached) return cached;
      try {
        const res = await fetch(e.request);
        if (res?.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return new Response('', {status:200});
      }
    })
  );
});

self.addEventListener('message', async e => {
  if (e.data?.type === 'PRECACHE_CDN') {
    const cache = await caches.open(ASSETS_CACHE);
    for (const url of (e.data.urls || [])) {
      try {
        if (!await cache.match(url)) {
          const res = await fetch(url, {cache:'no-cache'});
          if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
        }
      } catch(err) {}
    }
    if (e.source) e.source.postMessage({type:'PRECACHE_DONE'});
  }
});
