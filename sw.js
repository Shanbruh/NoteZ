// NoteZ Service Worker — Cache-first, offline-resilient
// NEVER intercept Firebase/googleapis — let the main thread handle those with its own timeouts

const CACHE = 'notez-v4'; // Incremented version to ensure fresh installation
const ASSETS = [
  './',
  'index.html',
  'icon-1.png',
  'icon-2.png',
  'manifest.json'
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
  self.skipWaiting(); // Force active immediately
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
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

  // RULE 1: Never touch Firebase / Google auth endpoints
  if (shouldBypass(url)) return;

  // RULE 2: App-shell (navigation requests) — STALE-WHILE-REVALIDATE
  // Optimized for offline: fallback to 'index.html' regardless of URL
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        // Try direct match or root index. Use ignoreSearch for query params robustness
        const match = await cache.match(e.request, { ignoreSearch: true }) || 
                      await cache.match('./', { ignoreSearch: true }) ||
                      await cache.match('index.html', { ignoreSearch: true });

        // Background network fetch for next load
        const networkFetch = fetch(e.request)
          .then(res => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => null);

        if (match) {
          // Serve immediately
          return match;
        }

        // Nothing in cache (first visit) — wait for network
        const netRes = await networkFetch;
        if (netRes && netRes.ok) return netRes;

        // Still nothing and offline? Show the friendly message
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

  // RULE 3: Static assets
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const res = await fetch(e.request);
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        // Safe fallback for icons or fonts
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
      }
    })
  );
});
