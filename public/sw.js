// ScanGo Service Worker — Offline Resilience & PWA Caching
const CACHE_NAME = 'scango-cache-v2';
const STATIC_ASSETS = [
  '/',
  '/menu.html',
  '/manifest.json',
  '/favicon.ico',
  '/logo-scango.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/css/index.css',
  '/css/menu.css',
  '/css/studio.css',
  '/js/pwa.js',
  '/js/menu.js',
  '/js/menu-modules.js',
  '/js/components/DishCard.js',
  '/js/components/IceCreamWizard.js',
  '/js/components/PerfumeryView.js',
  '/js/components/LoyaltyRewardsModal.js',
  '/js/components/I18nCurrencyManager.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache addAll parcial:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Handle same-origin assets & API with Network-First + Dynamic Cache Fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            // If requesting an HTML navigation (e.g. /m/:slug), fallback to /menu.html
            if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
              return caches.match('/menu.html');
            }
            return new Response('Sin conexión', { status: 503, statusText: 'Offline Fallback' });
          });
        })
    );
  } else {
    // External resources (fonts, cdn, images)
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
