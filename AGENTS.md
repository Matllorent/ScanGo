# AGENTS.md — Menú Pizarrón SaaS

## Proyecto
SaaS de menús digitales QR con pedidos por WhatsApp y suscripción recurrente. **Express 5** + frontend estático (sin build step) + wrapper **Capacitor** para Android. Deploy en **Vercel**.

## Comandos Principales

```bash
npm run dev          # Desarrollo con nodemon (puerto 3000)
npm start            # Producción (node api/index.js)
npm test             # Suite completa (23 tests en secuencia) — con snapshot/restore automático de data/
npm run test:billing # Test individual de pasarelas de pago
npm run test:analytics # Test individual de analytics de negocio (ticket promedio, CSV, top platos)
npm run test:admin   # Test individual del panel /admin (login 2FA, plata/mes, renovaciones)
npm run test:push    # Test individual de push notifications (VAPID, aviso de mozo)
npm run test:realtime # Test individual del guard de canales Realtime (migración 002)
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
- **Routers modulares** (11 en `api/routes/`): auth, reviews, storage, webhooks, notifications, email, health, orders, analytics, **studio**, **ai**
- **Cron**: `api/cron/billing-dunning.js` (montado como `/api/cron/billing-dunning`, requiere `CRON_SECRET`)
- **Middleware**: `api/middleware/` (auth, validation, rateLimits, killSwitch, subscriptionGuard, tenantGuard, requireVerifiedEmail, idempotency, cache, errorHandler, requestId)
- **Services**: `api/services/` (audit, email, geminiMenuParser, notifications, storage, telemetry, weather). El servicio de Mercado Pago vive en `src/services/mercadopago.js`. **La telemetría es la fuente única de verdad de analytics**: `restaurant.analytics` es una proyección derivada (`telemetry.countAnalytics()` → `db.setAnalyticsSnapshot()`), nunca se incrementa a mano.
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
- `public/js/menu/` — módulos ES internos (eventGuestMode, menuState, menuViewModel, menuModals, menuLoader, cartOperations, orderCheckout, smartReviews, virtualWaiterHeuristics)
- `public/js/utils/` — utilitarios ES: **`escapeHtmlBrowser.js`** (el que usa todo el frontend), `dishPriceFormatter.js`, `categoryFilter.js` (ver gotcha abajo)

### Base de Datos — Dual Mode
- **Default**: archivos JSON en `data/` (`users.json`, `restaurants.json`, `webhooks.json`, `reset_tokens.json`, `reviews.json`, `feedback.json`, `settings.json`)
- **Supabase (PostgreSQL)**: si existen `SUPABASE_URL` + (`SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SERVICE_KEY`) en `.env`
  - Al arrancar: `db.ready` hidrata el snapshot local desde Supabase antes de atender `/api/*` y `/m/*`.
  - En runtime: JSON funciona como cache/fallback y las escrituras se replican a Supabase; las respuestas esperan escrituras pendientes.
  - En Vercel: el fallback JSON usa `/tmp` (efímero); producción falla cerrado si falta una service key válida o falla la hidratación.
  - `SUPABASE_ANON_KEY` es solo para Supabase Realtime en el navegador; el backend no la usa como clave de servicio.
- Helpers clave en `src/db/db.js`: `getRestaurantBranches()`, `findRestaurantBranch()`, `updateBranches()`, `normalizeRestaurantBusinessType()`
- Tablas Supabase declaradas: `users`, `restaurants`, `webhooks`, `group_carts`, `orders`, `reviews`, `customer_feedback`, `audit_logs`, `push_subscriptions`, `telemetry_events`. RLS deniega acceso directo de roles cliente; el backend usa service role.
- **Solo `users`, `restaurants` y `webhooks` están creadas en el proyecto real** (verificado con `npm run db:check`). Las otras 7 se crean con `src/db/migrations/001_realtime_operations_tables.sql` (idempotente, RLS FORCE + grants solo service_role) — pegarlo en el SQL Editor, o vía Management API con `SUPABASE_ACCESS_TOKEN`. Hasta aplicarla, el backend degrada: carritos grupales en memoria y el estado se expone en `/api/healthz` → `schema.missing` (ya no es silencioso). Smoke test real: `npm run db:smoke`. **`002_realtime_channel_guard.sql`** agrega autorización por topic en `realtime.messages` (anon/authenticated: SELECT para join+receive e INSERT para emitir, solo con topics `realtime:%`; el resto queda reservado al service_role). ⚠️ La migración es SOLO políticas: **no puede incluir ni un `ALTER TABLE` sobre `realtime.messages`** (es de `supabase_realtime_admin`; supautils permite `create/drop/alter policy` pero no `ALTER TABLE` → falla `42501` y aborta la transacción). RLS ya está activa por defecto en esa tabla. Las políticas recién tienen efecto cuando los canales se unen como privados: eso ya está en el código (`config: { private: true }` en GroupCartManager.js, orders.js y el canal `event_waiters_` de api/index.js). **Orden al desplegar: aplicar el SQL 002 ANTES del código** (si el código va primero, los comensales anónimos son rechazados por deny-by-default).

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
- Cron: `/api/cron/billing-dunning` cada día a las 02:00 UTC

## Testing

- **Framework**: `assert` de Node puro — **sin Jest/Mocha**
- **Tests mutan `data/*.json`** durante la corrida (flujos reales con el store local). **`npm test` ahora las aísla solo**: `scripts/test-data-guard.js` saca una foto de `data/` antes y la restaura siempre al final (pase o falle). La cadena real de tests vive en `npm run test:core`; no hay que revertir `data/` a mano para commitear.
- Suite completa (`npm test`) ejecuta 23 tests en secuencia — **todos deben pasar (23/23)**
- **3 tests existen pero NO están en `npm test`**: `test-e2e.js`, `test-db-write.js`, `test-escape-html.js` (ejecutarlos a mano si tocas esas áreas)
- **Sin `.env` la suite igual arranca**: `JWT_SECRET` y `GROUP_CART_SECRET` caen a fallbacks de dev (`dev_secret_menu_pizarron_2026`). Solo 3 tests cargan `.env` solos: `test-mp-upsell-reviews`, `test-group-cart-mozo`, `test-geo-killswitch-upsell` (usan credenciales reales).
- Para debug rápido: `node tests/test-billing.js` (o el test específico, o `npm run test:<alias>`)

### Tests incluidos en `npm test` (23 suites)

| Archivo | Qué Prueba |
|---------|------------|
| `test-billing.js` | Webhooks, idempotencia, dunning, precios multi-sucursal |
| `test-fixes.js` | 7 mejoras críticas, saneamiento, 2FA, expiración trial |
| `test-new-features.js` | Landmarks, dimensiones de logos, contraste, jerarquía de encabezados |
| `test-resilience-security.js` | Rate-limit, headers HTTP, seguridad JWT, prevención de reutilización de tokens |
| `test-banner-and-layouts.js` | Banner hero, 14 temas clásicos, morfologías Bento/Minimalist/Neon |
| `test-mp-upsell-reviews.js` | Mercado Pago Checkout Pro, upselling "El Mozo Virtual", reseñas inteligentes |
| `test-geo-killswitch-upsell.js` | GEO (llms.txt/Schema), kill-switch HTTP 503, mozo virtual contextual |
| `test-weather.js` | Contexto de clima, caché por ciudad, fallback rápido |
| `test-landing-conversion.js` | Landing page, Google seguro, simulador sin registro |
| `test-group-cart-mozo.js` | GroupCartManager, Mozo Virtual, permisos por comensal, Realtime |
| `test-email-notifications.js` | Los 7 métodos de email (Resend/SMTP): bienvenida, recibo, fallido, dunning, warning trial, trial vencido, menú pausado |
| `test-ai-menu-import.js` | Gemini Flash multimodal, JSON schema, carga multi-página, límites 25mb, descarte por plato |
| `test-menu-componentization.js` | Módulos ES de menu (smartReviews, virtualWaiterHeuristics, orderCheckout) |
| `test-menu-seo.js` | SSR, metadatos y JSON-LD por restaurante |
| `test-google-auth.js` | GIS, callback OAuth y configuración backend |
| `test-security-endpoints.js` | Auth/tenant, límites, cron/readiness y QR capability |
| `test-analytics-business.js` | Analytics de negocio: ticket promedio, ingresos, top platos con nombres, export CSV, canal público unificado |
| `test-admin-panel.js` | Panel `/admin` en español llano: login 2FA TOTP, plata que entra al mes (por plan + multi-sucursal), renovaciones en 7 días, pruebas por terminar, conversión de la prueba |
| `test-db-await-integrity.js` | Integridad `await` en llamadas a métodos async de `db` (regresión 47ea3f7) |
| `test-frontend-esm-syntax.js` | Todos los JS de `public/js/` parsean como ES Module (regresión codemod quick-wins) |
| `test-frontend-structure.js` | `<div>` balanceados, modales a nivel body en 3 HTML + orden close→assign→open del import IA |
| `test-push-notifications.js` | Push Web real (VAPID): suscripción cloud, 503 PUSH_NOT_CONFIGURED sin llaves, aviso de mozo desde la mesa con entrega intentada |
| `test-realtime-rls-guard.js` | Guard estático de canales Realtime: la 002 existe, NO tiene ALTER TABLE sobre realtime.messages (evita el 42501), políticas SELECT+INSERT `realtime:%` para anon/authenticated, y los canales del código unen con `private: true` |

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
- `opencode.json` define 6 MCP locales: `menu-filesystem`, `memory-graph`, `playwright-testing`, `chrome-devtools`, `context7` y `supabase` (**read-only**, project-ref `olqdcudvstbawkcvsfdd`, requiere `SUPABASE_ACCESS_TOKEN` en el entorno).

## Convenciones y Gotchas

### Cero Mocks (ver `.cursorrules`)
- Flujos **reales** con DB y pasarelas de pago en tests y desarrollo
- No hay mocks de Stripe/LemonSqueezy/MercadoPago ni de Supabase

### Sincronización API ↔ Admin
- Mantener rutas de `api/routes/` sincronizadas con vistas de `studio.html` y `admin.html`
- Cambios en endpoints requieren actualizar ambas partes

### Sin Linter / Formatter / CI/CD
- No hay ESLint, Prettier, ni workflows de GitHub Actions
- `tsconfig.json` existe pero **el app corre JS puro** — no hay paso de compilación

### Trampas conocidas del codebase
- **`data/*.json` está en `.gitignore` pero `restaurants.json`, `users.json` y `webhooks.json` están trackeados** (fueron `git add -f`). Con el guard de tests ya no llegan mutados al commit, pero igual conviene chequear `git status` antes de commitear.
- **Dos escapeHtml**: `public/js/utils/escapeHtml.js` es CommonJS legacy usado solo por `tests/test-escape-html.js`; el frontend importa `escapeHtmlBrowser.js`. No "unificar" a ciegas.
- **Los archivos muertos se eliminaron (Block 6)**: `public/js/utils/eventThemes.js` y `src/menuRenderer.js` fueron removidos del repo (nadie los importaba). No buscarlos. La lógica real de temas en vivo vive en `public/js/menu/eventGuestMode.js`.
- **`test-frontend-esm-syntax.js` solo valida *sintaxis*** (copia cada `public/js/**` a `.mjs` y corre `node --check`). Un `require()`/`module.exports` en tiempo de ejecución NO lo rompe. No asumir "pasó el test ⇒ es usable".

### Estructura de Datos Clave
- **Restaurant** incluye: `subscription` (status, plan, provider, trialEndsAt, currentPeriodEnd, gracePeriodDaysRemaining), `branches[]`, `categories[]`, `dishes[]`, `modifierGroups[]`, `deliveryZones[]`, `businessType` (`restaurant|perfumery|events`), `layout` (`classic|modern|minimal`), `theme`, `city`, `smartWeatherEnabled`
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

## Archivos de Referencia Rápida

| Archivo | Propósito |
|---------|-----------|
| `api/index.js` | Entry point, middleware stack, router mounting |
| `src/db/db.js` | Dual-mode DB adapter (JSON + Supabase) |
| `src/billing/orchestrator.js` | Lógica de facturación multi-provider |
| `vercel.json` | Routing + cron config para Vercel |
| `mobile/capacitor.config.json` | Config Android/Capacitor |
| `src/db/schema.sql` | Esquema PostgreSQL para Supabase |
| `.cursorrules` | Reglas de desarrollo (cero mocks, sync API↔Admin) |
| `public/js/menu/eventGuestMode.js` | Resolución de tema de evento, contexto de invitado, reservas WhatsApp |
| `public/js/utils/` | Utilidades frontend (usan `escapeHtmlBrowser.js`, ver trampas) |
| `public/js/components/` | 14 componentes ES Module reutilizables |
| `tests/` | 25 suites; 23 corren en `npm test` (ver sección Testing) |