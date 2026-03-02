const CACHE = 'notez-v1';
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
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).catch(() => caches.match('/NoteZ/'));
    })
  );
});
