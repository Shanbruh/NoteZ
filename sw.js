// NoteZ Service Worker
const CACHE_NAME = 'notez-v1';
const urlsToCache = [
  '/NoteZ/',
  '/NoteZ/Final.html',
  '/NoteZ/manifest.json',
  '/NoteZ/icon-1.png',
  '/NoteZ/icon-2.png'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache).catch(err => {
        console.log('Some assets could not be cached:', err);
        // Continue even if some assets fail
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip Firebase and external API requests - always use network
  const url = new URL(event.request.url);
  if (url.hostname.includes('firebase') || 
      url.hostname.includes('googleapis') ||
      url.hostname.includes('securetoken') ||
      url.hostname.includes('identitytoolkit')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response('Network request failed', { status: 408 });
      })
    );
    return;
  }

  // For app resources, use cache-first strategy
  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) {
        return response;
      }
      return fetch(event.request).then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Return cached version if network fails
        return caches.match(event.request) || 
               new Response('Offline - resource not available', { status: 503 });
      });
    })
  );
});
