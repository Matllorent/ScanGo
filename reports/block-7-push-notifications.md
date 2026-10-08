# Block 7 — Push Notifications: el dueño se entera cuando lo llaman

## Qué problema resuelve
Cuando un comensal tocaba "Llamar al mozo" o "Pido la cuenta", el aviso solo salía
por WhatsApp. Si el dueño no estaba mirando el teléfono, se perdía. Ahora, además,
le llega **una notificación al navegador del Studio** (Chrome/Edge, con HTTPS):
la mesa esperando, sin que él tenga que estar mirando la pantalla.

## Cómo funciona
1. El dueño activa los avisos una vez desde **Studio → Notificaciones → "🔔 Avisos de
   la mesa en tu navegador"**. El navegador pide permiso, arma una suscripción Web Push
   (VAPID) y la guarda en la tabla `push_subscriptions` de Supabase (que ya existía).
2. Cuando una mesa llama al mozo (o pide la cuenta) en el menú público, además del
   WhatsApp de siempre, se dispara `POST /api/notifications/waiter-alert` (rate-limited,
   fire-and-forget) y el servidor **entrega push real** a los navegadores suscritos:
   `🔔 Quiere al mozo — 📍 Mesa: 4 · 20:33`.
3. El dueño toca la notificación y se abre el Studio.

## Entrega real (cero mocks)
- Paquete **`web-push`** + llaves VAPID reales en `.env` (`VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Generadas con `webpush.generateVAPIDKeys()`.
- `api/services/notifications.js` reescrito: `dispatchToSubscriptions()` entrega con
  `webpush.sendNotification`, **elimina suscripciones muertas** cuando el push service
  responde 404/410 y cuenta `checked/delivered/failed/removed`.
- **Degradado honesto**: sin llaves VAPID, `/api/notifications/send` responde
  `503 PUSH_NOT_CONFIGURED` (patrón de las pasarelas de pago) y el aviso de mozo
  responde 200 con `configured:false` — **no rompe el flujo del comensal**, que sigue
  teniendo WhatsApp.

## Frontend
- `public/sw.js`: fusionado — conserva el caching offline/PWA original y agrega los
  handlers `push` + `notificationclick` (no se pisó la lógica previa).
- `public/js/studio/notifications.js` (módulo ES): registra el SW, refleja el estado
  del botón, activa/desactiva la suscripción. Conectado desde `studio.js`.
- `public/studio.html`: botón "🔔 Activar notificaciones" + estado en el tab
  Notificaciones.
- `public/js/menu.js`: el llamado al mozo dispara además el aviso push.

## Endpoints
- `GET /api/notifications/vapid-public-key` — clave pública para subscribir (503 si no hay VAPID).
- `POST /api/notifications/waiter-alert` — público, rate-limited; `{slug, table, type}`.
- `POST /api/notifications/subscribe` — ya existía; ahora persiste en la nube de verdad.

## Test (suite 22)
`tests/test-push-notifications.js` + alias `npm run test:push`. Verifica con HTTP real:
- 503 `PUSH_NOT_CONFIGURED` sin llaves (degradado honesto).
- Suscripción inválida → 400; válida → 201 y **queda guardada** (cloud/local).
- Con un par VAPID real generado: la clave pública se sirve y el aviso de mozo
  **intenta la entrega real** (endpoint `.invalid` → fallo registrado como `failed`,
  `delivered: 0`, titulo del payload correcto).
- 404 con slug inexistente; 401 en `/send` anónimo.

## Resultado
- `npm test`: **22/22 verde** (se sumó la suite 22).
- `data/*.json` revertido a HEAD; `node_modules/.package-lock.json` revertido (ruido).
  El repo trackea `node_modules` (peculiaridad preexistente); solo se commitean
  `package.json` y `package-lock.json`.
- `.env.example` documenta las variables VAPID.

## Pendiente (fuera de alcance de este bloque)
- Push nativo dentro de la app Android (Capacitor) requiere **FCM** (firebase), proyecto
  de Google Cloud y el plugin `@capacitor/firebase-messaging` — un bloque aparte.
  El Web Push de este bloque cubre el navegador del dueño (desktop o móvil con Chrome).