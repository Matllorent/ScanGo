// ScanGo Service Worker — Offline Resilience & PWA Caching + Push Notifications
const CACHE_NAME = 'scango-cache-v5';
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
  '/js/index.js',
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
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  const isHtmlRequest = event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html');

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
          if (!isOffline && !isHtmlRequest) {
            return Response.error();
          }

          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;

            if (isHtmlRequest) {
              return caches.match('/menu.html') || caches.match('/') || new Response('Sin conexión', { status: 503, statusText: 'Offline Fallback' });
            }

            return Response.error();
          });
        })
    );
    return;
  }

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
      .catch(() => {
        if (isOffline) {
          return caches.match(event.request) || Response.error();
        }
        return Response.error();
      })
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Push Notifications (Web Push / VAPID): el dueño recibe el aviso de mesa
// aunque no esté mirando el Studio en ese momento; los comensales con opt-in
// reciben promos. El payload incluye `type` (waiter_call | promo), `tag`,
// `renotify` y `requireInteraction` generados por api/services/notifications.js.
// ────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // payload no JSON: se muestra un aviso genérico
  }
  const isWaiter = data.type === 'waiter_call';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.icon || '/icon-192.png',
    data: { url: data.url || '/studio', type: data.type || 'promo' },
    vibrate: [200, 100, 200],
    // tag ÚNICO: cada aviso de mesa, promo o evento reemplaza solo a su
    // propio tipo/incidente (dos mesas distintas pueden notificar a la vez).
    tag: isWaiter ? (data.tag || `waiter-${Date.now()}`) : (data.tag || `promo-${Date.now()}`),
    renotify: isWaiter ? true : (data.renotify !== false),
    // El aviso de mesa es operativo (el mozo debe atenderlo): queda visible
    // hasta que se cierre/atienda, no se autodestruye a los pocos segundos.
    requireInteraction: isWaiter
  };
  if (isWaiter) {
    options.actions = [
      { action: 'attend', title: '👨‍🍳 Atender en Studio' },
      { action: 'close', title: 'Cerrar' }
    ];
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Menú Pizarrón', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const url = (event.notification.data && event.notification.data.url) || '/studio';
  // 'close' no navega a ningún lado; 'attend' (aviso de mesa) abre el Studio.
  const target = action === 'close' ? null : (action === 'attend' ? '/studio' : url);
  if (!target) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});