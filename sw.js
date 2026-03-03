// NoteZ Service Worker — Cache-first, offline-resilient
// NEVER intercept Firebase/googleapis — let the main thread handle those with its own timeouts

const CACHE = 'notez-v3';
const ASSETS = [
  '/NoteZ/',
  '/NoteZ/index.html',
  '/NoteZ/icon-1.png',
  '/NoteZ/icon-2.png',
  '/NoteZ/manifest.json'
];

// Domains we MUST NOT intercept (main thread manages timeouts for these)
const BYPASS_DOMAINS = [
  'firebase',
  'googleapis.com',
  'firebaseio.com',
  'firebaseapp.com',
  'gstatic.com/firebasejs'
];

function shouldBypass(url) {
  return BYPASS_DOMAINS.some(d => url.includes(d));
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // ── RULE 1: Never touch Firebase / Google auth endpoints ──────────────────
  if (shouldBypass(url)) return; // Let browser handle natively

  // ── RULE 2: App-shell (NoteZ pages) — CACHE FIRST ─────────────────────────
  // Immediately serve from cache so the app loads instantly even on
  // WiFi-with-no-internet. Silently revalidate cache in the background.
  if (url.includes('/NoteZ/')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request);

        // Fire a background network fetch to keep the cache fresh
        const networkFetch = fetch(e.request)
          .then(res => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => null);

        if (cached) {
          // Serve stale-while-revalidate — fast AND eventually fresh
          networkFetch.catch(() => {}); // background only, ignore errors
          return cached;
        }

        // Nothing in cache yet (first ever visit) — must wait for network
        const netRes = await networkFetch;
        if (netRes && netRes.ok) return netRes;

        // Truly offline AND no cache — show a friendly error instead of browser's ugly page
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NoteZ - Offline</title>' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;' +
          'height:100vh;margin:0;background:#0f0f11;color:#e8e8f0;flex-direction:column;gap:16px;text-align:center}' +
          'h2{color:#a900ff;font-size:2rem;margin:0}p{color:#9090a8;max-width:300px}</style></head>' +
          '<body><h2>NoteZ</h2><p>You\'re offline and the app hasn\'t been cached yet.' +
          '<br><br>Connect once to enable full offline support.</p></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  // ── RULE 3: Other static assets (fonts, icons, etc.) — Cache-first ────────
  // Google Fonts CSS/woff2 are cached after first successful fetch.
  // If offline and not cached, return empty 200 so fonts gracefully degrade.
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      if (cached) return cached;

      try {
        const res = await fetch(e.request);
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        // Offline, no cache — return empty response (fonts degrade gracefully)
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
      }
    })
  );
});
