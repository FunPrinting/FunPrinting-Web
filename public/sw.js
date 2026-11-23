// Service Worker for Fun Printing Store PWA
const CACHE_NAME = 'funprinting-cache-v1';

// Install event: immediately activate
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event: claim clients and clear stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch event: required for Chrome PWA installability criteria
self.addEventListener('fetch', (event) => {
  // Only process GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never intercept API routes, auth callbacks, admin endpoints, or Next.js live data
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/data/') ||
    url.hostname.startsWith('admin.')
  ) {
    return;
  }

  // Network-first strategy with cache fallback for offline resilience
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      return cached || Promise.reject('offline');
    })
  );
});
