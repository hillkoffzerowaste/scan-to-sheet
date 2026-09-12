// Network-first for everything, with no cache-first path anywhere. The previous worker
// (public/sw.js, removed) answered from cache before the network and kept serving a stale
// bundle to the scanning desktop with no visible sign — the reason every registration was
// being cleared on boot. A remote that shows yesterday's courier list is the same failure.
//
// The cache name must not start with "scan-to-sheet-": src/main.jsx deletes every cache with
// that prefix on each boot of the desktop app.
const CACHE_NAME = 'scan-remote-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('scan-remote-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Firestore and the Google APIs must never pass through here, and neither must the OAuth
  // endpoints: a cached token response would be worse than an offline error.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // A ranged request must not be cached: the 206 partial would later be served as the answer
  // for the whole file, and the media stalls with nothing in the console to explain it.
  if (request.headers.has('range')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  );
});
