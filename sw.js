const CACHE = 'notez-v2';
const ASSETS = [
  '/NoteZ/',
  '/NoteZ/index.html',
  '/NoteZ/icon-1.png',
  '/NoteZ/icon-2.png',
  '/NoteZ/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // For HTML, CSS, JS - try network first, fallback to cache
  if (e.request.url.includes('/NoteZ/') && !e.request.url.includes('firebase')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Cache successful responses
          if (res.ok) {
            const cache = caches.open(CACHE);
            cache.then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => {
          // Offline - try cache
          return caches.match(e.request) || caches.match('/NoteZ/');
        })
    );
  } else {
    // For external requests (Firebase, fonts, etc) - use cache if available
    e.respondWith(
      caches.match(e.request).then(cached => {
        return cached || fetch(e.request).catch(() => caches.match('/NoteZ/'));
      })
    );
  }
});
