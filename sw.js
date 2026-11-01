const CACHE_NAME = 'footsies-dojo-v12';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        // Force any tab stuck on old v9/v10 cached HTML to reload fresh from network
        clients.forEach((client) => {
          if (client.url && 'navigate' in client) {
            client.navigate(client.url).catch(() => {});
          }
        });
      })
  );
});

// Safe network-first fetch (NOTE: never pass { cache: 'no-cache' } with a mode:'navigate' Request object, as it throws TypeError!)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const isSameOrigin = event.request.url.startsWith(self.location.origin);
  event.respondWith(
    (isSameOrigin
      ? fetch(event.request.url, { cache: 'no-cache' })
      : fetch(event.request)
    ).catch(() => caches.match(event.request))
  );
});
