# AGENTS.md — Menú Pizarrón SaaS

## Proyecto
SaaS de menús digitales QR con pedidos por WhatsApp y suscripción recurrente. **Express 5** + frontend estático (sin build step) + wrapper **Capacitor** para Android. Deploy en **Vercel**.

## Comandos Principales

```bash
npm run dev          # Desarrollo con nodemon (puerto 3000)
npm start            # Producción (node api/index.js)
npm test             # Suite completa (35 tests en secuencia) — con snapshot/restore automático de data/
npm run test:billing # Test individual de pasarelas de pago
npm run test:analytics # Test individual de analytics de negocio (ticket promedio, CSV, top platos)
npm run test:admin   # Test individual del panel /admin (login 2FA, plata/mes, renovaciones)
npm run test:push    # Test individual de push notifications (VAPID, aviso de mozo)
npm run test:loyalty # Test individual de fidelización dual (local + red global) y centro de notificaciones
npm run test:order-tracking # Test individual del seguimiento del pedido (token, estado público, push dirigido)
npm run test:online-payment # Test individual del pago online del comensal (toggle del dueño, gate 403, preferencia MP real)
npm run test:realtime # Test individual del guard de canales Realtime (migración 002)
npm run test:realtime-live # Test E2E real del guard (conecta a Supabase Realtime con la anon key)
npm run test:csp     # Test individual del guard CSP + headers duros
npm run test:semgrep  # Análisis estático Semgrep (reglas comunitarias gratis; SKIP si semgrep no está instalado)
npm run test:escape-html # Test individual del escape HTML legacy (CommonJS)
npm run test:db-write # Test individual de la primitiva atómica writeJson (temp-file + rename)
npm run db:check     # Inventario real de tablas Supabase (service role, read-only)
npm run db:smoke     # Smoke test de persistencia cloud de group_carts (round-trip real)
npm run mobile:sync  # npx cap sync (sincroniza Capacitor)
npm run mobile:build # npx cap copy android (copia web a Android)
```

Ejecución de test individual: `node tests/test-billing.js` (más rápido que `npm run test:billing`).

`npm run dev` (nodemon) solo observa `api/`, `src/` y `public/` con `NODE_ENV=development` — cambios en `tests/` o `data/` no reinician el server.

## Arquitectura

### Backend
- **Entrypoint**: `api/index.js` — rutas inline + routers modulares en `api/routes/`
- **Routers modulares** (12 en `api/routes/`): auth, reviews, storage, webhooks, notifications, email, health, orders, analytics, **studio**, **ai**, **loyalty**
- **Cron**: `api/cron/billing-dunning.js` (montado como `/api/cron/billing-dunning`, requiere `CRON_SECRET`)
- **Middleware**: `api/middleware/` (auth, validation, rateLimits, killSwitch, subscriptionGuard, tenantGuard, requireVerifiedEmail, idempotency, cache, errorHandler, requestId)
- **Services**: `api/services/` (audit, email, geminiMenuParser, **loyalty**, notifications, storage, telemetry, weather). El servicio de Mercado Pago vive en `src/services/mercadopago.js`. **La telemetría es la fuente única de verdad de analytics**: `restaurant.analytics` es una proyección derivada (`telemetry.countAnalytics()` → `db.setAnalyticsSnapshot()`), nunca se incrementa a mano.
- **Utils**: `api/utils/` (response, sentry, hash, menuOptions, groupCartToken, …)

### Frontend (`public/`)
- HTML/CSS/JS plano — **sin bundler, sin framework**
- `menu.html` — visor de menú público (ruta `/m/*`)
- `studio.html` — panel de restaurante (ruta `/studio`)
- `admin.html` — panel maestro (ruta `/admin`)
- **Guard de HTML distinto según entorno**: en dev, `GET /studio` y `GET /admin` pasan por `studioHtmlAuthMiddleware` / `adminHtmlAuthMiddleware` (cookie `auth_token` / `admin_token` con JWT, redirigen sin sesión). **En Vercel, `vercel.json` los sirve estáticos sin pasar por Express** → el guard solo existe en dev; la seguridad real está en las APIs `/api/*`.
- Assets servidos estáticamente desde `public/`
- `public/js/components/` — 14 componentes ES Module (DishCard, GroupCartManager, IceCreamWizard, etc.)
- `public/js/menu-modules.js` — ES Module que importa componentes y expone en `window.`
- `public/js/menu.js` — script inline principal (módulo raíz)
- `public/js/menu/` — módulos ES internos (eventGuestMode, menuState, menuViewModel, menuModals, menuLoader, cartOperations, orderCheckout, smartReviews, virtualWaiterHeuristics, **iceCreamHeuristics**, **perfumeryHeuristics** y **tipCalculator**)
- **Catálogos data-driven (cero demo)**: `iceCreamHeuristics.js` (`buildCustomFlavors`) y `perfumeryHeuristics.js` (`buildPerfumeryCatalog`) derivan sabores/fragancias de la **carta real** del local. El wizard/vista ya no caen a catálogos inventados: una heladería sin pistas por nombre/categoría usa toda su carta **excepto las bebidas heladas** (un milkshake no es un sabor); una perfumería usa el **id real** de cada plato (así el pedido cotiza bien, antes el `id` sintético `perfume_...` rompía con `DISH_NOT_FOUND`). Regresión cubierta en `tests/test-menu-componentization.js` (§11/§12).
- **Armador de helado intuitivo (divulgación progresiva + CTA protagonista)**: `public/js/components/IceCreamWizard.js` es un builder de una sola vista con **resumen y total en vivo en una barra inferior fija** (`renderSummary`). El flujo revela los pasos de a uno: al abrir se ve **sólo el tamaño** (sin preselección, `selectedContainer = null`/`sizeChosen = false`) y, al elegir uno, `updateFlowVisibility()` despliega **sabores y toppings** (antes aparecían los tres pasos a la vez y saturaban). Los chips de categoría de sabores son **data-driven** (`getFlavorBuckets`, sólo categorías con sabores). El menú (`public/menu.html`) expone un **único** CTA protagonista `#iceCreamHeroCTA` (arriba del menú, visible sólo en heladerías) — se eliminó el botón duplicado `#btnOpenIceCreamWizard` de la barra de accesos. El texto del botón es **configurable por el dueño** (`restaurant.iceCreamBuilderLabel`, input en Studio; vacío → default "Armá tu helado a medida"). Regresión en `tests/test-frontend-structure.js` (§F) y `tests/test-menu-componentization.js` (§14/§15).
- **Selector de idioma 🌐 (sólo si hay traducciones)**: `public/js/components/I18nCurrencyManager.js` renderiza un ícono 🌐 que despliega un menú flotante con los idiomas realmente disponibles, derivados por `detectAvailableLanguages()` de las traducciones no vacías de platos/categorías (o de un array `availableLanguages` explícito). Si el dueño **no** configuró idiomas alternativos, el selector se **oculta por completo** (antes se veían las pastillas ES/EN/PT hardcodeadas aunque no tradujeran nada). La barra usa la superficie del tema (`--surface-card`, no un `rgba(0,0,0,0.3)` hardcodeado). El menú avisa `scango:menu-ready` para re-renderizar la barra cuando la carta (y sus traducciones) llegan después del `DOMContentLoaded`.
- **Heladería es un rubro de primera clase**: `businessType='heladeria'` no se colapsa a `restaurant`; el asistente se gobierna con `allowIceCreamWizard` y `normalizeRestaurantBusinessType()` (src/db/db.js) preserva la bandera explícita y promueve registros viejos. Ver "Heladería como Rubro de Primera Clase" y "Temas Visuales para Heladerías".
- `public/js/pwa.js` — Service Worker + CTA de instalación flotante (`pwa-install-ready` → `window.triggerPWAInstall()`; antes el trigger quedaba huérfano). Descartable (localStorage `scango_pwa_install_dismissed`); usa `addEventListener`, sin `on*=`. Guard en `tests/test-frontend-structure.js` (§D).
- `public/js/dom-bindings.js` — binder de eventos delegados para atributos `data-js-*` (todas las páginas: menú, Studio, Admin, Landing; requisito de la CSP `script-src-attr 'none'`, ver sección "Seguridad — CSP")
- `public/js/utils/` — utilitarios ES: **`escapeHtmlBrowser.js`** (el que usa todo el frontend), `dishPriceFormatter.js`, `categoryFilter.js` (ver gotcha abajo)

### Seguridad — CSP real + headers duros
- **Fuente única de verdad**: `api/utils/securityHeaders.js` genera TODOS los headers de seguridad. Se aplica en los dos caminos de producción idénticamente (verificado por `tests/test-csp.js`):
  1. **Express** (`api/index.js`): `securityHeadersMiddleware` global en todas las respuestas (dev, APIs y SSR), después de `app.disable('x-powered-by')`. Reemplazó a helmet (que estaba con `contentSecurityPolicy:false`).
  2. **Vercel** (`vercel.json` → bloque `headers`): mismos valores para los estáticos (`/studio`, `/admin`, `/terminos`, `/privacidad`, `/(.*)`), que NO pasan por Express en producción. La regla usa regex con negative lookahead `^/(?!m/|api/).*` para no pisar la CSP que genera la API en `/m/*` y `/api/*`.
- **CSP por capas** (AMBAS variantes con `script-src-attr 'none'` desde la **Etapa 2 completa**):
  - **Estricta (menú público `/m/*`)**: `script-src 'self'` + `cdn.jsdelivr.net` (supabase-js). La setea el handler SSR de `/m/:slug` a nivel `res.setHeader` (el middleware ya puso el resto).
  - **Transicional (Studio/Admin/Landing/Legales)**: `script-src` = 'self' + CDNs de confianza (`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `accounts.google.com`) + **SHA-256 de los scripts inline** de las páginas estáticas (admin.html, index.html, reset-password.html; se skip JSON-LD y scripts dentro de comentarios HTML). `style-src`/`font-src` incluyen `cdnjs.cloudflare.com` (Font Awesome del admin).
  - **No existe NINGÚN atributo `on*=` en todo `public/`** (migrado a `data-js-*` con el codemod, ~230 handlers; verificado en navegador en landing, /m/demo, studio, panel admin y gate 403). `tests/test-csp.js` lo escanea todo y falla si aparece uno nuevo.
  - **HTML generado por el servidor** (gate 403 de /admin y callback OAuth de Google) NO puede usar scripts inline (no entran en los hashes de public/) → sus scripts viven en `public/js/admin-gate.js` y `public/js/google-auth-callback.js` (servidos desde 'self').
- **Cambio de un script inline en admin/index/reset-password → cambia su hash** → hay que regenerar la CSP: `node scripts/regen-vercel-csp.js` (actualiza vercel.json desde el módulo; el módulo recalcula en runtime). `tests/test-csp.js` detecta el drift en la próxima corrida. **Ojo**: el browser normaliza CRLF→LF antes de hashear (spec CSP) — `computeInlineScriptHashes()` normaliza igual; un archivo CRLF hasheado crudo produce un hash que el browser rechaza (bug que bloqueó el script del panel admin durante el Bloque 16).
- Directivas comunes: `default-src 'self'`, `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src gstatic`, `img-src 'self' data: blob: https:`, `connect-src 'self' https://*.supabase.co wss://*.supabase.co`, `frame-ancestors 'self'`, `frame-src` ('self' [+ accounts.google.com en transicional]), `object-src 'none'`, `base-uri 'self'`, `form-action 'self' + stripe/mercadopago`. Headers duros: `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/geolocation/mic/payment/usb/serial/gyro/…), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Strict-Transport-Security` (15552000). **Regla de oro: cualquier host externo nuevo que cargue el frontend debe agregarse ACA y en `vercel.json`.**
- `scripts/codemod-csp-events.js` es el codemod REUTILIZABLE que convierte `onclick="fn('a')"` → `data-js-click="fn|a"` (arg parse: `event`→ev, `this`→el, `this.ruta`→prop, números→Number, `event.preventDefault()` → `data-js-submit="preventDefault"`, `document.getElementById('x').click()` → `fireClick|x`, `if(event.target===this)FN()` → `data-js-click-backdrop="FN"`, `this.style.prop='v'` → `data-js-<tipo>-style-<prop>` por evento, y `onerror` → `data-js-error-style-prop` / `data-js-error-fn`). Modos: dry-run (default) y `--apply`. Se usó para migrar los ~230 handlers de la Etapa 2; sigue disponible para HTML nuevo que aparezca con handlers.

### Base de Datos — Dual Mode
- **Default**: archivos JSON en `data/` (`users.json`, `restaurants.json`, `webhooks.json`, `reset_tokens.json`, `reviews.json`, `feedback.json`, `settings.json`)
- **Supabase (PostgreSQL)**: si existen `SUPABASE_URL` + (`SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SERVICE_KEY`) en `.env`
  - Al arrancar: `db.ready` hidrata el snapshot local desde Supabase antes de atender `/api/*` y `/m/*`.
  - En runtime: JSON funciona como cache/fallback y las escrituras se replican a Supabase; las respuestas esperan escrituras pendientes.
  - En Vercel: el fallback JSON usa `/tmp` (efímero); producción falla cerrado si falta una service key válida o falla la hidratación.
  - `SUPABASE_ANON_KEY` es solo para Supabase Realtime en el navegador; el backend no la usa como clave de servicio.
- Helpers clave en `src/db/db.js`: `getRestaurantBranches()`, `findRestaurantBranch()`, `updateBranches()`, `normalizeRestaurantBusinessType()`
- Tablas Supabase declaradas: `users`, `restaurants`, `webhooks`, `group_carts`, `orders`, `reviews`, `customer_feedback`, `audit_logs`, `push_subscriptions`, `telemetry_events`. RLS deniega acceso directo de roles cliente; el backend usa service role.
- **Estado del esquema cloud: TODAS las migraciones 001–005 están aplicadas** en el proyecto real (`olqdcudvstbawkcvsfdd`), verificado con `npm run db:check` + un probe read-only por columna. Existen las 10 tablas de `schema.sql`, las 5 de fidelización (`customer_profiles`, `loyalty_accounts`, `loyalty_ledger`, `loyalty_redemptions`, `notification_events`) y todos los ALTERs (`push_subscriptions.role/consent_marketing/customer_phone`, `orders.status_updated_at`, `orders.tip_amount`). **No hay tablas ni columnas pendientes.** (Antes del Bloque de propina solo faltaba la 005.)
- **Reaplicar en un proyecto nuevo**: cada migración es idempotente y va en orden 001 → 005 (SQL Editor, o Management API con `SUPABASE_ACCESS_TOKEN`).
  - `001_realtime_operations_tables.sql`: 7 tablas operacionales (`group_carts`, `orders`, `reviews`, `customer_feedback`, `audit_logs`, `push_subscriptions`, `telemetry_events`), RLS FORCE + grants solo service_role. Hasta aplicarla, el backend degrada: carritos grupales en memoria y el estado se expone en `/api/healthz` → `schema.missing` (ya no es silencioso). Smoke test real: `npm run db:smoke`.
  - `002_realtime_channel_guard.sql`: autorización por topic en `realtime.messages` (anon/authenticated: SELECT para join+receive e INSERT para emitir, solo con topics `realtime:%`; el resto queda reservado al service_role). ⚠️ Es SOLO políticas: **no puede incluir ni un `ALTER TABLE` sobre `realtime.messages`** (es de `supabase_realtime_admin`; supautils permite `create/drop/alter policy` pero no `ALTER TABLE` → falla `42501` y aborta la transacción). RLS ya está activa por defecto en esa tabla. Las políticas recién tienen efecto cuando los canales se unen como privados: eso ya está en el código (`config: { private: true }` en GroupCartManager.js, orders.js y el canal `event_waiters_` de api/index.js). **Orden al desplegar: aplicar el SQL 002 ANTES del código** (si el código va primero, los comensales anónimos son rechazados por deny-by-default).

### Billing — Multi-Provider (`src/billing/orchestrator.js`)
- **Resolución de proveedor** (`resolveProvider`): UY/AR + moneda `$|UYU|ARS|$U|USD` → **Mercado Pago**; resto → `DEFAULT_BILLING_PROVIDER` (`lemonsqueezy`), con fallback a la primera pasarela configurada.
- **`createCheckout` es async** (MP/Stripe crean la sesión vía API). Acepta `planId` real o alias `monthly|annual` (`normalizePlanId()` → 400 `INVALID_PLAN`). Sin credenciales devuelve `checkoutUrl: null` + `configuration.missing` y la ruta responde **503 `PAYMENT_PROVIDER_NOT_CONFIGURED`** (nunca URL trucha).
- **Lemon**: link `/buy/<variant_id>` con `LEMONSQUEEZY_VARIANT_<PLAN>` (fallback `LEMONSQUEEZY_PLAN_<PERIOD>_VARIANT_ID`). **Stripe**: Checkout Session real (`STRIPE_PRICE_<PLAN>`). **MP**: preferencia real con `external_reference = <restaurantId>:<planId>` y `notification_url` con `?secret=`; el webhook consulta `GET /v1/payments/:id` porque el IPN no trae `external_reference`.
- Planes: `starter_monthly|annual` (9/79 USD), `pro_monthly|annual` (19/159 USD)
- **Descuento escalonado por sucursales**: 1ª=100%, 2ª=80%, 3ª=65%, 4ª+=50% (`calculateMultiBranchPrice()`)
- **Webhooks idempotentes**: `db.hasProcessedWebhook()` / `markWebhookProcessed()` evitan duplicados
- **Smart Dunning**: `past_due` → 7 días de gracia antes de bloquear menú (`verifyAccess()`)
- **Trial 7 + 3**: días 1-7 acceso total; **días 8-10** `verifyAccess()` devuelve `allowed:true` + `requiresPayment:true` (menú público online, Studio muestra paywall con "Seguir editando"); **día 11+** menú pausado. Excepción: una suscripción que ya estuvo pagas (`provider !== 'trial'` o `downgradedAt`) no gana la gracia. El cron pasa `trialing` → `expired` y manda los emails de vencido/pausado una sola vez (banderas `trialWarning3dSent|trialWarning1dSent|trialExpiredEmailSent|menuPausedEmailSent`).
- **Espejo client** en `public/js/studio/subscription.js` (`checkStudioAccess`) — si se cambia uno, cambiar el otro.

### Fidelización Dual + Centro de Notificaciones
- **`api/services/loyalty.js`** + **`api/routes/loyalty.js`** (`/api/loyalty/*`, público: `me`/`redeem`; dueño: `validate`/`credit`/`customers`; DELETE `/me` = derecho al olvido RGPD/Ley 18.331).
- **Identidad**: teléfono E.164 normalizado como PK (mismo identitario que el flujo WhatsApp). Nunca se loguea crudo: `customers` devuelve `phoneMasked`. Consentimiento explícito (`consentMarketing`) para promos, separación estricta de roles `owner` (avisos de mesa) / `guest` (solo promos con opt-in).
- **Dual**: LOCAL por restaurante (`restaurant.loyaltyConfig`: `pointsPerOrder`, `pointsPerCurrency`, `stampsTarget`, `visitReward`, `rewards[]`) + GLOBAL cross-restaurant (niveles Bronce→Platino por visitas, insignias, beneficios de red canjeables en cualquier local). Acreditación automática post-orden en `api/routes/orders.js` (nunca rompe el alta: captura sus errores).
- **Canje**: código `LOY-XXXX-XXXX` de un solo uso; `validate` con `tenantGuard` bloquea códigos de otros restaurantes (403) y el doble uso (409). **Ojo**: el param de mark-read es `:eventId` — `tenantGuard` interpreta `:id` como tenant.
- **Persistencia**: migración **`src/db/migrations/003_loyalty_notifications.sql`** (5 tablas + ALTER de `push_subscriptions`, RLS FORCE, idempotente — **ya aplicada**; en un proyecto nuevo pegarla en el SQL Editor de Supabase; el backend degrada a JSON local/`/tmp` si faltara).
- Frontend: `public/js/components/LoyaltyRewardsModal.js` (data-driven, cero demo), banner/modal en `menu.js`/`menu-modules.js`, config + validador + inbox + composer de promos en `studio.html`/`studio.js` (tab Avisos WA).

### Seguimiento del Pedido (comensal)
- **Token sin estado**: `api/utils/orderTrackingToken.js` firma `${orderId}.${HMAC-SHA256}` (secreto: `ORDER_TRACKING_SECRET` → `GROUP_CART_SECRET` → `JWT_SECRET`). No requiere columnas nuevas; el id se recupera verificando la firma (comparación en tiempo constante).
- **Endpoints** (en `api/routes/orders.js`): `POST /api/orders` devuelve `trackingToken`; **público** `GET /api/orders/track/:token` (estado + resumen, **sin PII**: nunca teléfono/nombre/dirección; token inválido/adulterado → 404); **dueño** `PATCH /api/orders/status/:orderId` (`requireAuth` + `tenantGuard`, estados `pending|confirmed|preparing|ready|on_the_way|delayed|delivered|cancelled`; cross-tenant → 403 `ORDER_TENANT_MISMATCH`). Persiste en espejo local (`data/orders.json`) + Supabase `orders.status` y avisa por push.
- **Push dirigido**: `notificationsService.sendOrderStatusNotification()` manda `type: 'order_status'` SOLO a las suscripciones guest del restaurante con consentimiento **cuyo `customer_phone` coincide** con el del pedido (nunca a todos). El teléfono se guarda normalizado en `push_subscriptions.customer_phone` (migración 004); sin coincidencias devuelve `checked:0` sin exigir VAPID.
- **Frontend comensal**: el menú guarda el token en `localStorage.scango_active_order`, muestra un FAB 🧾 y un modal de seguimiento con stepper (polling 15s + `visibilitychange`); el push abre `/m/<slug>?track=<token>`. Al cargar su teléfono con push ya activo, `syncPushCustomerPhone()` re-suscribe con el teléfono para que el aviso le llegue dirigido.
- **Frontend dueño**: pestaña **Notificaciones → "📦 Pedidos en vivo"** (`loadRecentOrders`/`setOrderStatus`) lista los pedidos y avanza el estado; el comensal lo ve y recibe el push.

### Pago Online del Comensal (opcional, lo habilita el dueño)
- **Es SOLO una posibilidad**: `restaurant.allowOnlinePayment` (default `false`). Con el interruptor apagado, la opción "Mercado Pago / Tarjeta" NO aparece en el menú y `POST /api/orders/mercadopago/preference` responde **403 `ONLINE_PAYMENT_DISABLED`**.
- Con el interruptor prendido, `/api/menu/:slug` expone `allowOnlinePayment` + `onlinePaymentReady` (hay con qué cobrar: link propio `paymentLink` y/o Checkout Pro configurado en el server). El menú ofrece el pago; si hay `paymentLink` lo usa, y si no, genera una preferencia MP real por pedido (`handleExternalPayClick`/`startOnlinePayment` en `public/js/menu.js`, cerrando el endpoint que estaba huérfano).
- Studio: toggle **"💳 Ofrecer Pago Online al Comensal"** (`inputAllowOnlinePayment`) junto al link propio.
- `invalidateMenuCache()` limpia también la capa single-flight de 5s del SSR (`api/middleware/cache.js`), así el dueño ve el cambio al instante.

### Propina del Comensal (checkout)
- **100% opcional y decisión del comensal** (nunca obligatoria): el checkout parte de "Sin propina" y ofrece 5% / 10% / 15% o un monto fijo. Módulo puro `public/js/menu/tipCalculator.js` (`computeTipAmount(subtotal, tipPercent, customAmount)`, `TIP_PERCENT_PRESETS`); la base es el subtotal de platos (sin envío). El monto fijo tiene prioridad; nunca devuelve negativos.
- **Viaja aparte del monto de los platos**: la propina se suma al `TOTAL A PAGAR` del mensaje de WhatsApp y se envía como `tipAmount` a `POST /api/orders`. El backend la persiste en `orders.tip_amount` (migración **005**, idempotente, **ya aplicada**) y en el espejo local; `GET /api/orders/track/:token` la expone como `tip`. **No** se suma a `orders.amount` (no distorsiona el ticket promedio de analytics). Si la 005 no estuviera aplicada, el INSERT en cloud reintenta sin `tip_amount` (el pedido no se pierde).
- UI: `public/menu.html` (`#tipSectionBox` con pills `data-js-click="setTipPercent|N"` + `#tipCustomInput` con `data-js-input="setTipCustom|this.value"`) y resumen `#summaryTipRow`. Los handlers `setTipPercent`/`setTipCustom` se exponen en `window` (binder `data-js-*`).
- Regresión: unit en `tests/test-menu-componentization.js` (§13) + propina real de punta a punta en `tests/test-order-tracking.js`.

### Mobile (Capacitor)
- Config: `mobile/capacitor.config.json`
- `webDir: "public"` — apunta directo al frontend estático
- `appId: "com.menupizarron.studio"`
- Build: AAB (`releaseType: "AAB"`)

### Deploy (Vercel)
- `vercel.json`:
  - `/api/*` → `api/index.js` (@vercel/node)
  - `/m/*` → `api/index.js` (SSR de Open Graph, canonical y JSON-LD `Restaurant`/`Menu`)
  - `/studio` → `public/studio.html`
  - `/admin` → `public/admin.html`
  - `/terminos`, `/privacidad` → páginas legales
  - `/(.*)` → `public/$1` (static)
  - **`headers`**: CSP transicional + headers duros en los estáticos (ver "Seguridad — CSP"), excluyendo `/m/*` y `/api/*`
- Cron: `/api/cron/billing-dunning` cada día a las 02:00 UTC

## Testing

- **Framework**: `assert` de Node puro — **sin Jest/Mocha**
- **Tests mutan `data/*.json`** durante la corrida (flujos reales con el store local). **`npm test` ahora las aísla solo**: `scripts/test-data-guard.js` saca una foto de `data/` antes y la restaura siempre al final (pase o falle). La cadena real de tests vive en `npm run test:core`; no hay que revertir `data/` a mano para commitear.
- Suite completa (`npm test`) ejecuta 35 tests en secuencia — **todos deben pasar (35/35)**
- **2 tests existen pero NO están en `npm test`**: `test-e2e.js` (E2E integral real: registra en la nube, crea un checkout de Mercado Pago real y activa la suscripción por webhook — correrlo a mano; en modo cloud confirma el email del usuario recién registrado vía Admin API de Supabase, flujo real del link, sin mocks, porque `/api/studio/save` exige `requireVerifiedEmail`) y `test-supabase-group-cart-persistence.js` (es el `npm run db:smoke`, round-trip real de `group_carts` contra la nube). `test-escape-html`, `test-db-write` y `test-semgrep` solían estar fuera pero **ahora corren en el chain** (`npm test`): el guard de tests (`test-data-guard.js`) + el SKIP autónomo de semgrep los hacen seguros de correr en serie.
- **Sin `.env` la suite igual arranca**: `JWT_SECRET` y `GROUP_CART_SECRET` caen a fallbacks de dev (`dev_secret_menu_pizarron_2026`). Solo 4 tests cargan `.env` solos: `test-mp-upsell-reviews`, `test-group-cart-mozo`, `test-geo-killswitch-upsell` y `test-realtime-live-guard` (usan credenciales reales; el último hace SKIP si no hay `SUPABASE_URL`/`SUPABASE_ANON_KEY`).
- Para debug rápido: `node tests/test-billing.js` (o el test específico, o `npm run test:<alias>`)

### Tests incluidos en `npm test` (35 suites)

| Archivo | Qué Prueba |
|---------|------------|
| `test-billing.js` | Webhooks, idempotencia, dunning, precios multi-sucursal |
| `test-fixes.js` | 7 mejoras críticas, saneamiento, 2FA, expiración trial |
| `test-new-features.js` | Landmarks, dimensiones de logos, contraste, jerarquía de encabezados |
| `test-resilience-security.js` | Rate-limit, headers HTTP, seguridad JWT, prevención de reutilización de tokens |
| `test-banner-and-layouts.js` | Banner hero, 14 temas clásicos, 6 temas de heladería (3 coloridos + 3 formales), round-trip del rubro Heladería, morfologías Bento/Minimalist/Neon |
| `test-mp-upsell-reviews.js` | Mercado Pago Checkout Pro, upselling "El Mozo Virtual", reseñas inteligentes |
| `test-geo-killswitch-upsell.js` | GEO (llms.txt/Schema), kill-switch HTTP 503, mozo virtual contextual |
| `test-weather.js` | Contexto de clima, caché por ciudad, fallback rápido |
| `test-landing-conversion.js` | Landing page, Google seguro, simulador sin registro |
| `test-group-cart-mozo.js` | GroupCartManager, Mozo Virtual, permisos por comensal, Realtime |
| `test-email-notifications.js` | Los 7 métodos de email (Resend/SMTP): bienvenida, recibo, fallido, dunning, warning trial, trial vencido, menú pausado |
| `test-ai-menu-import.js` | Gemini Flash multimodal, JSON schema, carga multi-página, límites 25mb, descarte por plato |
| `test-menu-componentization.js` | Módulos ES de menu (smartReviews, virtualWaiterHeuristics, orderCheckout), catálogos data-driven de heladería/perfumería (§11/§12) y propina del comensal (§13, `computeTipAmount`) |
| `test-menu-seo.js` | SSR, metadatos y JSON-LD por restaurante + ETag/`s-maxage=60` en `/m/*` (200 con `ETag: W/"m-..."`, 304 con `If-None-Match`) |
| `test-google-auth.js` | GIS, callback OAuth y configuración backend |
| `test-security-endpoints.js` | Auth/tenant, límites, cron/readiness y QR capability + P0: anti mass-assignment en `/save`, auth en IA, TOTP fail-closed, 403 a cuentas huérfanas |
| `test-analytics-business.js` | Analytics de negocio: ticket promedio, ingresos, top platos con nombres, export CSV, canal público unificado |
| `test-admin-panel.js` | Panel `/admin` en español llano: login 2FA TOTP, plata que entra al mes (por plan + multi-sucursal), renovaciones en 7 días, pruebas por terminar, conversión de la prueba |
| `test-db-await-integrity.js` | Integridad `await` en llamadas a métodos async de `db` (regresión 47ea3f7) |
| `test-frontend-esm-syntax.js` | Todos los JS de `public/js/` parsean como ES Module (regresión codemod quick-wins) |
| `test-frontend-structure.js` | `<div>` balanceados, modales a nivel body en 3 HTML + orden close→assign→open del import IA |
| `test-push-notifications.js` | Push Web real (VAPID): suscripción cloud, 503 PUSH_NOT_CONFIGURED sin llaves, aviso de mozo desde la mesa con entrega intentada |
| `test-loyalty-dual.js` | Fidelización DUAL (local + red global cross-restaurant): identidad E.164 enmascarada, acreditación post-pedido, niveles Bronce→Platino + insignias, canje LOY-XXXX-XXXX con validación cross-restaurant 403/doble 409, `/customers` con privacidad, borrado total (RGPD), OTP de posesión por email (challenge/confirm, un solo uso, email first-write), y centro de notificaciones: aviso de mozo persistido + inbox mark-read + suscripción guest con consentimiento y separación de roles owner/guest |
| `test-loyalty-claim.js` | Atomicidad del canje: doble `validate` concurrente (`Promise.all`) = exactamente 1 éxito + 1×409 `CODE_ALREADY_REDEEMED` (mutex local + RPC atómico `claim_loyalty_redemption` si la 006 está aplicada; sonda con SKIP si falta; NOT_FOUND con espejo local delega al local —corrige 404 fantasma con cloud rezagado— y un `ok:true` con espejo ya redeemed se veta a 409 anti split-brain) |
| `test-billing-properties.js` | Properties con PRNG seed fijo (sin deps): `calculateMultiBranchPrice` monótono/tiers 100-80-65-50, `sanitizeUrl` nunca devuelve `javascript:/data:`, y diferencial máquina-vs-`verifyAccess` (500 fixtures, 0 mismatches) |
| `test-subscription-machine.js` | Máquina de estados de suscripción (`src/billing/subscriptionMachine.js`): tabla total 7×6, invariantes (sin retorno a trialing, `DOWNGRADE_TO_FREE` solo desde past_due, gracia solo si nunca pagó, `BLOCK_MENU` solo paused/expired) |
| `test-order-tracking.js` | Seguimiento del pedido end-to-end: token HMAC sin estado (`signOrderToken`/`verifyOrderToken`), `POST /api/orders` devuelve `trackingToken` y persiste la propina (`tipAmount`), `GET /api/orders/track/:token` público SIN PII (sin teléfono/nombre) y con `tip`, token adulterado 404, `PATCH /api/orders/status/:orderId` (401 anónimo, 400 inválido, 403 cross-tenant), y push de estado dirigido SOLO al comensal del pedido por teléfono |
| `test-online-payment.js` | Pago online del comensal: default OFF no aparece en `/api/menu/:slug` y `POST /api/orders/mercadopago/preference` → 403 `ONLINE_PAYMENT_DISABLED`; con `allowOnlinePayment=true` el menú lo expone (+`onlinePaymentReady`) y el gate se abre (200 con MP real, 5xx `MP_NOT_CONFIGURED` honesto sin credenciales); restaurante inexistente → 404; el flag persiste |
| `test-openapi-contract.js` | Contrato `openapi.yaml` (3.1) vs runtime: el spec lista los 20 paths reales y el test golpea cada ruta (códigos 200/201/400/401/403/404 según caso, nunca 404 inesperado; `track/:token` sin PII) |
| `test-realtime-rls-guard.js` | Guard estático de canales Realtime: la 002 existe, NO tiene ALTER TABLE sobre realtime.messages (evita el 42501), políticas SELECT+INSERT `realtime:%` para anon/authenticated, y los canales del código unen con `private: true` |
| `test-realtime-live-guard.js` | E2E real del guard contra Supabase Realtime (anon key): JOIN+broadcast en `realtime:%` OK y topics ajenos (`event_waiters_*`) rechazados — detecta si la 002 NO está aplicada |
| `test-escape-html.js` | Escape HTML legacy (CommonJS `public/js/utils/escapeHtml.js`): entidades, falsy, números, idempotencia |
| `test-db-write.js` | Primitiva atómica `db.writeJson` (temp-file + rename, retries con backoff no-bloqueante): write básico, arrays y 5 escrituras concurrentes sin busy-wait |
| `test-semgrep.js` | Análisis estático Semgrep (`p/security-audit` + `p/owasp-top-ten` + `p/javascript` sobre `api/ src/ public/js/`); hace SKIP con exit 0 si `semgrep` no está instalado |
| `test-csp.js` | Guard CSP real + headers duros: **cero `on*=` en TODO `public/`** (scan de todos los JS+HTML; si alguien agrega un onclick, la CSP con `script-src-attr 'none'` lo rompe y el guard falla), hashes SHA-256 de scripts inline (normalizados CRLF→LF como el browser) presentes en la CSP transitional, paridad exacta vercel.json ↔ api/utils/securityHeaders.js, y en runtime `/m/:slug` responde con CSP estricta y el resto con transitional (ambas `script-src-attr 'none'`) |

## Configuración (`.env`)

Copiar `.env.example` → `.env`. Variables **críticas**:

| Variable | Descripción |
|----------|-------------|
| `JWT_SECRET` | Firma de tokens (cambiar en prod) |
| `ADMIN_KEY` | Clave maestra panel `/admin` |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (alias: `SUPABASE_SERVICE_KEY`) | Habilita modo cloud PostgreSQL; clave de servicio, nunca al navegador |
| `LEMONSQUEEZY_*` | API key, store ID, webhook secret, variant IDs (`LEMONSQUEEZY_VARIANT_<PLAN>` por plan, fallback `_PLAN_<PERIOD>_VARIANT_ID`) |
| `STRIPE_*` | Secret key, webhook secret, price IDs (`STRIPE_PRICE_<PLAN>`, fallback `_MONTHLY`/`_ANNUAL`) |
| `MERCADOPAGO_*` | Access token, webhook secret, `MERCADOPAGO_CURRENCY` (default USD; no-USD exige `MERCADOPAGO_FX_<CUR>`) |
| `DEFAULT_BILLING_PROVIDER` | Proveedor para países fuera de UY/AR (default `lemonsqueezy`) |
| `RESEND_API_KEY` + `EMAIL_FROM` | Emails transaccionales |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (+ `VAPID_SUBJECT`) | Push Web para avisar al dueño cuando una mesa llama al mozo. Generar par con `node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"`. Sin ellas, `/api/notifications/send` responde 503 `PUSH_NOT_CONFIGURED` y el aviso de mozo degrada sin romper WhatsApp |
| `GEMINI_API_KEY` | Importación de cartas físicas con Google Gemini Flash |
| `SENTRY_DSN` | Monitoreo errores (opcional) |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 para login social |
| `ADMIN_TOTP_SECRET` | 2FA opcional panel admin |
| `SUPABASE_ANON_KEY` | Clave pública para Realtime en navegador (protegida por RLS) |
| `CRON_SECRET` | Bearer/header requerido para cron en producción |
| `GROUP_CART_SECRET` | Firma HMAC de QR de mesa; puede usar `JWT_SECRET` como fallback |

### Tooling OpenCode
- `opencode.json` define 8 MCP locales: `menu-filesystem`, `memory-graph`, `playwright-testing`, `chrome-devtools`, `context7`, `supabase` (**read-only**, project-ref `olqdcudvstbawkcvsfdd`, requiere `SUPABASE_ACCESS_TOKEN` en el entorno), `osv-scanner` y `semgrep` (ambos activos en la sesión).
- **`osv-scanner` (Google OSV-Scanner v2.6.0)**: auditoría de vulnerabilidades de dependencias. El binario vive fuera del repo en `C:\Users\<usuario>\.local\bin\osv-scanner.exe` (verificado contra el hash oficial `SHA256SUMS`, 56 MB) y el MCP corre con el subcomando `experimental-mcp` (stdio). Tools: `scan_vulnerable_dependencies`, `get_vulnerability_details`, `ignore_vulnerability`. Se actualiza descargando el release de https://github.com/google/osv-scanner/releases y re-verificando el hash.
- **`semgrep` (Semgrep Community Edition, gratis)**: análisis estático de código (XSS, inyección, buenas prácticas JS). MCP oficial nativo `semgrep mcp` (stdio) con el binario global `C:\Users\<usuario>\AppData\Local\Programs\Python\Python312\Scripts\semgrep.exe` (instalar: `python -m pip install --upgrade semgrep` — Windows nativo desde 2025). ⚠️ El paquete `semgrep-mcp` / `mcp.semgrep.ai` quedó **DEPRECADO**: usar siempre `semgrep mcp`. Rulesets de `npm run test:semgrep`: `p/security-audit` + `p/owasp-top-ten` + `p/javascript` sobre `api/ src/ public/js/`. En `api/index.js` hay un falso positivo documentado con `// nosemgrep` (SSR de `/m/*`: todo dato pasa por `escapeHtml()`/`safeJsonLd`, verificado).

## Convenciones y Gotchas

### Cero Mocks (ver `.cursorrules`)
- Flujos **reales** con DB y pasarelas de pago en tests y desarrollo
- No hay mocks de Stripe/LemonSqueezy/MercadoPago ni de Supabase

### Sincronización API ↔ Admin ↔ Contrato
- Mantener rutas de `api/routes/` sincronizadas con vistas de `studio.html` y `admin.html`
- Cambios en endpoints requieren actualizar ambas partes + `openapi.yaml` + caso en `test-openapi-contract.js`
- **Reglas duras de seguridad** (regresión en `test-security-endpoints.js`): `/api/studio/save` NUNCA persiste `subscription/userId/id/analytics/createdAt/updatedAt` del cliente (solo vías server-side: webhooks/cron/admin); `/api/ai/*` exige sesión; `tenantGuard` responde 403 `TENANT_REQUIRED` a cuentas sin local ante tenant ajeno; `ADMIN_TOTP_SECRET` es obligatorio en prod y `verifyTotpToken` sin secreto deniega
- **Sesiones revocables** (`api/utils/tokenRevocation.js`): JWT con `jti` + `pwdTs`; logout revoca el jti, reset invalida todo vía `updatedAt` (replica a cloud, cross-instancia); `authMiddleware`/`requireAuth`/`/me` validan frescura (401 `SESSION_REVOKED`); admin con tope absoluto 8h además del deslizante 15min; TOTP single-use + `timingSafeEqual`; `ADMIN_KEY` y legacy-password por hash comparativo; `jwt.verify` siempre con `algorithms:['HS256']`; `authLimiter` por IP real
- **Loyalty con posesión** (`requestLoyaltyOtp`/HMAC-OTP stateless 10min + `verifyLoyaltyOtp` single-use): canje y borrado exigen OTP al email del perfil (`/challenge` → `/redeem/confirm`, `DELETE /me` con `otp`); email first-write (`/email`, cambio con OTP al anterior); el modal (`LoyaltyRewardsModal`) guía email→código→confirmación
- **Profundidad**: `originCheck` anti-CSRF en mutaciones con cookie; MP sin secreto en prod → 503; `googleReview` solo https + `escapeHtml` en `src=`; topes de tamaño en Base64 (IA/storage); `__proto__` filtrado en save y `overridePrices`; filenames solo-puntos rechazados; `requireActiveSubscription` también en branches/events/ai-import/loyalty-credit
- **Sesión solo-cookie + app nativa** (`public/js/authClient.js` + `api/utils/deviceTokens.js`): el JWT NO viaja en el body (respuestas de login/register/google/callback y login admin); web por cookie `httpOnly`, app Capacitor con credencial opaca revocable (`POST /api/auth/device`, `GET/DELETE /api/auth/devices`, muere con el reset); `authMiddleware`/`requireAuth`/`/me` dual centralizado en `authenticateRequest()`; registro duplicado → 200 genérico anti-enumeración
- **CAPTCHA invisible** (Turnstile, `api/utils/captcha.js`): `POST /orders` exige `captchaToken` solo con `TURNSTILE_SECRET` (403 `CAPTCHA_REQUIRED`/`CAPTCHA_INVALID`, fail-open solo si CF inalcanzable); menú lo adjunta solo vía `/api/public/captcha-config`; CSP estricta suma `challenges.cloudflare.com` (script/connect/frame)

### Linter / Formatter / CI
- `eslint.config.mjs` + `.prettierrc` (printWidth 110, singleQuote) + `npm run lint` (`eslint api src`; requiere `npm i -D eslint`, NO entra en `npm test`, no se reformateó el repo)
- CI: `.github/workflows/ci.yml` (push/PR, matriz Node 22+24: `npm ci` → `npm test` → `test:semgrep` → osv-scanner sin bloqueo). `.nvmrc` = `22`, `engines: >=20`.
- `tsconfig.json` existe pero **el app corre JS puro** — no hay paso de compilación

### Trampas conocidas del codebase
- **`data/*.json` está en `.gitignore` pero `restaurants.json`, `users.json` y `webhooks.json` están trackeados** (fueron `git add -f`). Con el guard de tests ya no llegan mutados al commit, pero igual conviene chequear `git status` antes de commitear.
- **`node_modules` está trackeado PARCIALMENTE**: solo se force-addearon paquetes críticos históricos (zod, `@supabase/*`, semver, minimatch, nodemon, …). `@sentry/node` y `@opentelemetry/*` NO están trackeados. Consecuencia: un bump que toca paquetes no trackeados (p.ej. Sentry 8→11) deja diff solo en `package.json` + `package-lock.json` + `node_modules/.package-lock.json`; uno que toque paquetes trackeados (p.ej. zod) agranda el diff de verdad.
- **Auditoría de dependencias (Block 14)**: `@sentry/node` subió `^8.0.0` → `^11.5.0` para resolver 22 calamidades de OpenTelemetry (GHSA-8988-4f7v-96qf, GHSA-qqmp-wf37-98f9) **sin cambios de código** (API `init/captureException/captureMessage/withScope/addBreadcrumb` verificado contra v11; suite 24/24 en verde). Riesgo aceptado documentado: `braces@3.0.3` → `chokidar` → `nodemon` (dev-only) con GHSA-vfj7-8cjw-p6xm (CVE-2026-93687, HIGH 8.7, **sin versión corregida publicada**; npm sugiere `nodemon@1.14.10`, un downgrade absurdo — NO aplicarlo). Re-auditar con `osv-scanner scan source -L package-lock.json` o el MCP `osv-scanner`.
- **Dos escapeHtml**: `public/js/utils/escapeHtml.js` es CommonJS legacy usado solo por `tests/test-escape-html.js`; el frontend importa `escapeHtmlBrowser.js`. No "unificar" a ciegas.
- **Los archivos muertos se eliminaron (Block 6)**: `public/js/utils/eventThemes.js` y `src/menuRenderer.js` fueron removidos del repo (nadie los importaba). No buscarlos. La lógica real de temas en vivo vive en `public/js/menu/eventGuestMode.js`.
- **`test-frontend-esm-syntax.js` solo valida *sintaxis*** (copia cada `public/js/**` a `.mjs` y corre `node --check`). Un `require()`/`module.exports` en tiempo de ejecución NO lo rompe. No asumir "pasó el test ⇒ es usable".
- **Prohibido `on*=` en TODO `public/`** (HTML y JS): la CSP de **ambas** variantes tiene `script-src-attr 'none'` desde la Etapa 2 — un `onclick=`/`onchange=`/etc. nuevo se rompe en producción (y `tests/test-csp.js` falla, escanea todo `public/`). Usar `data-js-*` + `public/js/dom-bindings.js` (binder universal). También: `javascript:void(0)` está bloqueado → usar `href="#"` (el binder hace preventDefault en los `<A>`).

### Estructura de Datos Clave
- **Restaurant** incluye: `subscription` (status, plan, provider, trialEndsAt, currentPeriodEnd, gracePeriodDaysRemaining), `branches[]`, `categories[]`, `dishes[]`, `modifierGroups[]`, `deliveryZones[]`, `businessType` (`restaurant|heladeria|perfumery|events`), `layout` (`classic|modern|minimal`), `theme`, `city`, `smartWeatherEnabled`
- **Branch**: `id`, `name`, `slug`, `phone`, `address`, `overridePrices{}`, `customDishes[]`
- **User**: `id`, `email`, `password` (bcrypt), `name`, `createdAt`

### Rate Limiting
- Por tenant/IP (`x-tenant-id` o `x-restaurant-id` header), ventana 15 min
- **En Vercel**: `app.set('trust proxy', 1)` (api/index.js) — sin esto, `req.ip` es la IP del proxy para todos y el rate-limit por IP se rompe. Vercel reescribe `X-Forwarded-For` en el edge.
- El canal público de analytics se limita **por slug de menú** (`publicEventKeyGenerator` en `api/middleware/rateLimits.js`), no por IP global: un balde por restaurante, nunca uno compartido por todo el tráfico.
- En `api/index.js`: auth=30, reviews=30, orders=60, **admin=5**
- En `api/middleware/rateLimits.js`: email=10, notifications=20, storage=20, groupCart=90, analytics=120

### Helpers Útiles (referencia rápida)
- `api/utils/response.js`: `successResponse()`, `errorResponse()` — formato estándar API
- `api/middleware/killSwitch.js`: `checkSubscriptionKillSwitch` — bloquea features por plan
- `api/middleware/cache.js`: `menuCacheMiddleware`, `invalidateMenuCache()` — cache menú público
- `api/utils/sentry.js`: `captureMessage()`, `captureException()` — no-op si no hay DSN

> **Ojo**: `src/` solo contiene `db/`, `billing/`, `services/mercadopago.js` y `email/`. Todo el código del runtime HTTP (helpers, middleware, utils) vive en **`api/utils/`** y **`api/middleware/`**.

### Módulos de Utilidades (`public/js/utils/`)

| Módulo | Propósito |
|--------|-----------|
| `escapeHtmlBrowser.js` | Sanitizador XSS — **el que importa todo el frontend** (`menu.js`, `studio.js`, componentes) |
| `dishPriceFormatter.js` | Formateo de precios, Happy Hour, strike |
| `categoryFilter.js` | Filtros dietéticos, orden por clima |
| *(removido en Block 6)* | `eventThemes.js` (legacy CommonJS sin imports) fue borrado — no usar |

## Temas Visuales para Eventos

Lógica real: **`resolveEventTheme()` en `public/js/menu/eventGuestMode.js`** (llamado desde `menu.js`). `public/js/utils/eventThemes.js` era código CommonJS legacy que nadie importaba y fue **eliminado en Block 6**.

- Se activa si `businessType==='events'` **o** `?event=` ∈ `true|wedding|cumple_15|birthday|catering`
- Sin parámetro y `businessType='events'` → `theme-wedding`
- Mapeo: `cumple_15`→`theme-cumple15`, `birthday`→`theme-birthday`, `catering`→`theme-catering`, resto→`theme-wedding`
- **`?event=...` funciona también con `businessType='restaurant'`** (el flag solo fuerza el default wedding)

Estéticas (definiciones CSS en `public/css/menu.css`): wedding = marfil + serif Playfair + dorado `#D4A853`; cumple15 = pastel rosado/champán sobre `#F9F0F5`; birthday = mint `#A8D5C7` + oro `#C9A867` sobre `#FAF8F5`; catering = neutral cálido `#C49A4A`/`#A4753C` sobre `#F7F4F0`.

### Itinerario Visual de Boda (rubro Eventos)

Sección data-driven `restaurant.weddingItinerary` (`{enabled, title, coupleNames, date, venue, items[{time,title,icon}]}` máx 12, sanitizado en `sanitizeWeddingItinerary()` de `api/utils/sanitizeRestaurant.js`, espejo del módulo frontend). Módulo puro `public/js/menu/weddingItinerary.js` (`sanitizeWeddingItinerary`/`renderWeddingItineraryHTML`, con escape XSS) + estilos `.wed-it-*` en `menu.css` (espina central con nodos 💛, tarjetas alternadas en desktop, una columna en móvil ≤520px; **marco floral**: doble marco dorado + 4 esquinas botánicas SVG inline + divisor floral, todo sin assets externos; usa variables del tema activo así se adapta a wedding/cumple15/birthday/catering). Visible solo con tema de evento activo + itinerario habilitado con ≥1 momento (`renderWeddingItinerary()` en `menu.js`). El dueño lo edita en Studio (sección visible solo con `businessType='events'`: toggle + título/pareja/fecha/lugar + filas hora+título+icono con `add/remove/updateWeddingItineraryItem`). Regresión en `tests/test-menu-componentization.js` (§16).

**En vivo**: el timeline marca el progreso con la hora real (`resolveItineraryProgress()` + `parseItineraryTime()`: acepta `18:00`/`18.00`/`18h00`, acarreo nocturno para fiestas que cruzan la medianoche). Estados: `countdown` (⏳ faltan N días, requiere `eventDay` ISO que el dueño fija con input date en Studio), `upcoming` (🕒 comienza a las…), `live` (🔴 píldora En vivo + barra de avance + momento `AHORA` con `aria-current` + pasados con ✓ + tag Siguiente) y `finished` (✅ gracias). Sin horas válidas → `static` sin adornos. `menu.js` re-renderiza solo cada 30s (`weddingItineraryTimer`); CSS con `prefers-reduced-motion`. Regresión §19.

### Neón Multi-Acentos (layout Neon Nightbar)

El layout `neon` tiñe todo su glow con variables `--neon`/`--neon-rgb` según `restaurant.neonAccent`: `mint` (default, el menta original), `cyan`, `magenta`, `amber`, `lime`, `violet` (`NEON_ACCENTS` + `resolveNeonAccent()` en `public/js/menu/menuPresentation.js`; clases `body.layout-neon.neon-<clave>` en `menu.css`). `menu.js` agrega `neon-<x>` solo con layout neon (+ preview con `?neon=<clave>`, espejo de `?morph=`). Studio: selector `#inputNeonAccent` visible solo en neon + save/load; backend con allowlist en `sanitizeRestaurant.js` (default mint). Regresión §21.

### Precios $0 (sin costo) y Notas por Rubro

- **Sin costo**: `isFreePrice()` en `public/js/menu/menuPresentation.js` (0, ausente o no numérico → true). Con precio libre NO se muestra ninguna cifra en carta, chef specials, upsells, cross-sell del modal ni líneas del carrito (botón `+` intacto); barra flotante `Ver Pedido →` sin `($0)`; totales `Sin costo`; WhatsApp lista ítems sin precio y declara `💝 Pedido sin costo` sin Subtotal/TOTAL. Backend ya acepta monto 0 (`createOrderSchema` sin campo amount). Regresión §17.
- **Notas por rubro**: `getDishNoteCopy()` (mismo módulo) adapta etiqueta+placeholder del modal en `openDishNoteModal`: heladería → "Nota para tu helado" (nunca "sin cebolla"), perfumería → "Nota del pedido", eventos → "Indicaciones para los anfitriones", restaurante → default de cocina. Regresión §18.

## Heladería como Rubro de Primera Clase

`businessType='heladeria'` es un rubro propio (no se colapsa a `restaurant`), seleccionable en el registro (`public/index.html`) y en Studio (`#inputBusinessType`). El asistente de armado (tamaño → sabores → toppings) se gobierna con `restaurant.allowIceCreamWizard` (default `true` para heladería). `normalizeRestaurantBusinessType()` en `src/db/db.js`:
- preserva un `true`/`false` explícito del dueño (nunca lo pisa al leer);
- promueve registros antiguos guardados como `restaurant` + `allowIceCreamWizard=true` a `heladeria`;
- sólo define el default cuando la bandera está ausente.

Antes esto era un bug: `heladeria` se colapsaba a `restaurant` al guardar y la bandera se apagaba en la siguiente lectura, por lo que el asistente desaparecía al recargar. Regresión cubierta en `tests/test-banner-and-layouts.js` (round-trip de heladería + `false` explícito). El precio es **idéntico al de restaurante** (mismos planes y descuento multi-sucursal; el billing no mira `businessType`).

### Temas Visuales para Heladerías

6 temas en `public/css/menu.css` (`body.theme-*`), expuestos en el selector de estética de Studio (agrupados en "🍦 Heladería & Postres") y aceptados en `validThemes` de `public/js/menu.js`:

| Tema | Vibe | Paleta |
|------|------|--------|
| `theme-helado-fiesta` | Entretenido | Confeti rosa/cyan/limón/lila sobre blanco `#FFF7FB` |
| `theme-helado-menta` | Entretenido | Menta `#1FA97A` + chips de chocolate sobre `#F1FBF7` |
| `theme-helado-tropical` | Colorido | Mango `#FF7A00`, coral `#FF5A5F`, turquesa `#17B8A6` sobre `#FFF8EE` |
| `theme-helado-pastel` | Formal suave | Lavanda `#9F7AEA`, rosa y menta pastel sobre `#FBF6FF` |
| `theme-gelateria` | Formal italiano | Marfil `#FBF6EE`, terracota `#C56B4A`, pistacho `#94A97A` |
| `theme-cioccolato` | Formal premium | Cacao oscuro `#231410` + oro `#E0B04A` (único oscuro) |

Los 5 claros sobreescriben `--chalk-white` a tinta oscura y refuerzan títulos/nombres (mismo patrón que los temas de evento); no fuerzan tipografía, así el selector de fuente del dueño sigue mandando. Guard en `tests/test-banner-and-layouts.js` (§3e).

## Archivos de Referencia Rápida

| Archivo | Propósito |
|---------|-----------|
| `api/index.js` | Entry point, middleware stack, router mounting |
| `src/db/db.js` | Dual-mode DB adapter (JSON + Supabase) |
| `src/billing/orchestrator.js` | Lógica de facturación multi-provider |
| `vercel.json` | Routing + headers CSP/duros + cron config para Vercel |
| `api/utils/securityHeaders.js` | Única fuente de verdad de CSP + headers duros (Express y Vercel) |
| `public/js/dom-bindings.js` | Binder de eventos delegados `data-js-*` universal (menú, Studio, Admin, Landing; paths punteados `i18nManager.setLanguage\|pt` invocan método con receiver = dueño) |
| `scripts/codemod-csp-events.js` | Codemod `onclick=""` → `data-js-*` reutilizable (migró los ~230 handlers de la Etapa 2; correr en dry-run ante HTML nuevo) |
| `scripts/regen-vercel-csp.js` | Regenera los headers CSP de `vercel.json` desde `api/utils/securityHeaders.js` (correr tras editar scripts inline de admin/index/reset-password) |
| `mobile/capacitor.config.json` | Config Android/Capacitor |
| `src/db/schema.sql` | Esquema PostgreSQL para Supabase |
| `src/db/migrations/001_realtime_operations_tables.sql` | Migración idempotente: 7 tablas operacionales (carritos, pedidos, reseñas, feedback, auditoría, push, telemetría), RLS FORCE |
| `src/db/migrations/002_realtime_channel_guard.sql` | Migración idempotente (solo políticas): autorización por topic en `realtime.messages` (`realtime:%` para anon; sin `ALTER TABLE`) |
| `src/db/migrations/003_loyalty_notifications.sql` | Migración idempotente: 5 tablas de fidelización + ALTER `push_subscriptions` (RLS FORCE) |
| `src/db/migrations/004_order_tracking.sql` | Migración idempotente del seguimiento del pedido: `orders.status_updated_at` + `push_subscriptions.customer_phone` (aviso dirigido por teléfono) |
| `src/db/migrations/005_order_tips.sql` | Migración idempotente de la propina del comensal: `orders.tip_amount` (NUMERIC, no negativo; aparte del ticket promedio) |
| `src/db/migrations/006_loyalty_claim_rpc.sql` | **Aplicada en cloud**: `claim_loyalty_redemption(p_code, p_restaurant_id)` atómico (`SECURITY DEFINER`, solo `service_role`) — canje en una sola sentencia (cierra el race del doble canje concurrente; verificado por `test-loyalty-claim.js` vía RPC real) |
| `.cursorrules` | Reglas de desarrollo (cero mocks, sync API↔Admin) |
| `public/js/menu/eventGuestMode.js` | Resolución de tema de evento, contexto de invitado, reservas WhatsApp |
| `public/js/utils/` | Utilidades frontend (usan `escapeHtmlBrowser.js`, ver trampas) |
| `public/js/components/` | 14 componentes ES Module reutilizables |
| `tests/` | 36 archivos; 35 corren en `npm test` (ver sección Testing) |
| `openapi.yaml` | Contrato OpenAPI 3.1 de la API (20 paths verificados contra handlers; `test-openapi-contract.js` lo golpea en runtime — endpoint nuevo = entrada acá + caso en el test) |
| `src/billing/subscriptionMachine.js` | Máquina de estados pura de suscripción (7 estados × 6 eventos, `computeStatus` diferencialmente testeada contra `verifyAccess`; la tabla manda, el orchestrator la sigue) |
| `src/billing/plans.json` | Fuente única de precios/planes y `TRIAL_DAYS` (el orchestrator la lee con fallback a literales) |
| `SECURITY.md` | Política de disclosure (reporte a `hola@menu-pizarron.com` `[SECURITY]`, SLA 48h/7d) |
| `docs/adr/` | ADRs (0001 dual JSON↔Supabase, 0002 trial 7+3, 0003 plans.json) — decisión irreversible nueva = ADR nuevo |
| `docs/chaos-dual-write.md` | Runbook del drill mensual de divergencia JSON↔cloud (+ `npm run db:parity` solo-lectura, cero PII) |
| `stryker.conf.json` | Mutation testing acotado (`src/billing/orchestrator.js` + `api/utils/sanitizeRestaurant.js`, `npm run test:mutation`; requiere `npm i -D @stryker-mutator/core @stryker-mutator/command-runner`) |