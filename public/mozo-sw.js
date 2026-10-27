/**
 * public/mozo-sw.js
 * ─────────────────
 * Service Worker EXCLUSIVO de la PWA del turno (scope `/mozo`). Hace dos cosas:
 *  1. Guarda el shell de la página para que abra rápido y sobreviva a un corte
 *     breve de red (las mesas ya vienen guardadas en la sesión local).
 *  2. Muestra los avisos push dirigidos a la persona del turno y abre /mozo al
 *     tocarlos.
 *
 * Regla de la casa (bug real cazado en QA): NUNCA interceptar requests de OTRO
 * origen. El `fetch` del propio SW queda sujeto a su CSP y bloquearía imágenes
 * o fuentes que la página sí permite. Acá además no hay assets externos, pero
 * el early-return se mantiene por contrato.
 */
const CACHE_NAME = 'scango-mozo-v2';
const SHELL = [
  '/mozo',
  '/mozo-manifest.json',
  '/css/mozo.css',
  '/js/mozo/mozo.js',
  '/js/mozo/mozoSession.js',
  '/fonts/fonts.css',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          SHELL.map((url) =>
            cache.add(url).catch(() => {
              // Un asset faltante no debe romper la instalación del SW.
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  // Cross-origin fuera (ver comentario de cabecera). APIs fuera del cache.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Solo la shell de /mozo se cachea. Otra navegación same-origin (p. ej. el
    // link "Ir a ScanGo" del gate) la maneja el browser: guardarla bajo
    // '/mozo' reemplazaría la PWA por la landing en el próximo arranque.
    if (url.pathname !== '/mozo' && url.pathname !== '/mozo/') return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/mozo', copy));
          }
          return response;
        })
        .catch(() => caches.match('/mozo').then((cached) => cached || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => Response.error());
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    try {
      payload = { body: event.data ? event.data.text() : '' };
    } catch (err) {
      payload = {};
    }
  }
  const data = payload && typeof payload === 'object' ? payload : {};
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'ScanGo · Tu turno';
  const body =
    typeof data.body === 'string' && data.body.trim()
      ? data.body.trim()
      : 'Tenés un aviso de tu turno.';
  const rawUrl = data.url || (data.data && data.data.url) || '/mozo';
  let url = '/mozo';
  try {
    const parsed = new URL(String(rawUrl), self.location.origin);
    if (parsed.origin === self.location.origin && parsed.pathname.startsWith('/mozo')) {
      url = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch (e) {
    url = '/mozo';
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: typeof data.tag === 'string' && data.tag ? data.tag : 'scango-mozo',
      renotify: true,
      requireInteraction: false,
      data: { url, staffId: data.data && data.data.staffId ? data.data.staffId : null }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification && event.notification.data ? event.notification.data : {};
  const target = data.url || '/mozo';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (!client.url) continue;
        try {
          const parsed = new URL(client.url);
          if (parsed.origin === self.location.origin && parsed.pathname.startsWith('/mozo')) {
            if ('navigate' in client && client.url !== target) client.navigate(target).catch(() => {});
            return client.focus();
          }
        } catch (e) {
          // URL ilegible: sigue con el resto.
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
