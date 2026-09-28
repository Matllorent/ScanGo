# AGENTS.md — Menú Pizarrón SaaS

## Proyecto
SaaS de menús digitales QR con pedidos por WhatsApp y suscripción recurrente. **Express 5** + frontend estático (sin build step) + wrapper **Capacitor** para Android. Deploy en **Vercel**.

## Comandos Principales

```bash
npm run dev          # Desarrollo con nodemon (puerto 3000)
npm start            # Producción (node api/index.js)
npm test             # Suite completa (11 tests en secuencia, 100% verde)
npm run test:billing # Test individual de pasarelas de pago
npm run mobile:sync  # npx cap sync (sincroniza Capacitor)
npm run mobile:build # npx cap copy android (copia web a Android)
```

Ejecución de test individual: `node tests/test-billing.js` (más rápido que `npm run test:billing`).

## Arquitectura

### Backend
- **Entrypoint**: `api/index.js` (~2068 líneas) — rutas inline + routers modulares en `api/routes/`
- **Routers modulares**: auth, reviews, storage, webhooks, notifications, email, health, orders, analytics, billing-dunning (cron)
- **Middleware**: `api/middleware/` (auth, validation, rate-limit, kill-switch, subscription-guard, cache, error-handler, request-id)
- **Services**: `api/services/` (mercadopago, email, weather, audit, telemetry)
- **Utils**: `api/utils/` (response, sentry, hash, menuOptions, sentry)

### Frontend (`public/`)
- HTML/CSS/JS plano — **sin bundler, sin framework**
- `menu.html` — visor de menú público (ruta `/m/*`)
- `studio.html` — panel de restaurante (ruta `/studio`)
- `admin.html` — panel maestro (ruta `/admin`)
- Assets servidos estáticamente desde `public/`
- `public/js/components/` — 14 componentes ES Module (DishCard, GroupCartManager, IceCreamWizard, etc.)
- `public/js/menu-modules.js` — ES Module que importa componentes y expone en `window.`
- `public/js/menu.js` — script inline principal (2740 líneas)
- `public/js/utils/` — nuevos utilitarios modulares (escapeHtml, eventThemes, dishPriceFormatter, categoryFilter)

### Base de Datos — Dual Mode
- **Default**: archivos JSON en `data/` (`users.json`, `restaurants.json`, `webhooks.json`, `reset_tokens.json`, `reviews.json`, `feedback.json`, `settings.json`)
- **Supabase (PostgreSQL)**: si existen `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` en `.env`
  - Al arrancar: sincroniza **cloud → local** (lee de Supabase, escribe en JSON)
  - En runtime: **escritura dual** (JSON + Supabase en background, fire-and-forget)
- Helpers clave en `src/db/db.js`: `getRestaurantBranches()`, `findRestaurantBranch()`, `updateBranches()`, `normalizeRestaurantBusinessType()`

### Billing — Multi-Provider (`src/billing/orchestrator.js`)
- **Lemon Squeezy** (default, Merchant of Record global)
- **Stripe** (global, requiere LLC)
- **Mercado Pago** (auto-selecciona para `countryCode` UY/AR con moneda UYU/ARS/$U)
- Planes: `starter_monthly|annual` (9/79 USD), `pro_monthly|annual` (19/159 USD)
- **Descuento escalonado por sucursales**: 1ª=100%, 2ª=80%, 3ª=65%, 4ª+=50% (`calculateMultiBranchPrice()`)
- **Webhooks idempotentes**: `db.hasProcessedWebhook()` / `markWebhookProcessed()` evitan duplicados
- **Smart Dunning**: `past_due` → 7 días de gracia antes de bloquear menú (`verifyAccess()`)
- **Trial**: 7 días (`trialing` status) con acceso completo

### Mobile (Capacitor)
- Config: `mobile/capacitor.config.json`
- `webDir: "public"` — apunta directo al frontend estático
- `appId: "com.menupizarron.studio"`
- Build: AAB (`releaseType: "AAB"`)

### Deploy (Vercel)
- `vercel.json`:
  - `/api/*` → `api/index.js` (@vercel/node)
  - `/m/*` → `public/menu.html`
  - `/studio` → `public/studio.html`
  - `/admin` → `public/admin.html`
  - `/terminos`, `/privacidad` → páginas legales
  - `/(.*)` → `public/$1` (static)
- Cron: `/api/cron/billing-dunning` cada día a las 02:00 UTC

## Testing

- **Framework**: `assert` de Node puro — **sin Jest/Mocha**
- **Tests mutan `data/*.json`** — crean restaurantes/usuarios reales en el store local. **No son aislados**.
- `tests/test-e2e.js` existe pero **NO está incluido en `npm test`**
- Suite completa (`npm test`) ejecuta 11 tests en secuencia — **todos deben pasar (11/11)**
- Para debug rápido: `node tests/test-billing.js` (o el test específico)

### Tests Disponibles (11 suites)

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
| `test-email-notifications.js` | Los 4 métodos de email (Resend/SMTP): recibo, fallido, dunning, warning trial |

## Configuración (`.env`)

Copiar `.env.example` → `.env`. Variables **críticas**:

| Variable | Descripción |
|----------|-------------|
| `JWT_SECRET` | Firma de tokens (cambiar en prod) |
| `ADMIN_KEY` | Clave maestra panel `/admin` |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Habilita modo cloud PostgreSQL |
| `LEMONSQUEEZY_*` | API key, store ID, webhook secret, variant IDs |
| `STRIPE_*` | Secret key, webhook secret, price IDs |
| `MERCADOPAGO_*` | Access token, webhook secret |
| `RESEND_API_KEY` + `EMAIL_FROM` | Emails transaccionales |
| `SENTRY_DSN` | Monitoreo errores (opcional) |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 para login social |
| `ADMIN_TOTP_SECRET` | 2FA opcional panel admin |

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

### Estructura de Datos Clave
- **Restaurant** incluye: `subscription` (status, plan, provider, trialEndsAt, currentPeriodEnd, gracePeriodDaysRemaining), `branches[]`, `categories[]`, `dishes[]`, `modifierGroups[]`, `deliveryZones[]`, `businessType` (`restaurant|perfumery|events`), `layout` (`classic|modern|minimal`), `theme`, `city`, `smartWeatherEnabled`
- **Branch**: `id`, `name`, `slug`, `phone`, `address`, `overridePrices{}`, `customDishes[]`
- **User**: `id`, `email`, `password` (bcrypt), `name`, `createdAt`

### Rate Limiting
- Por tenant/IP (`x-tenant-id` o `x-restaurant-id` header)
- Límites: auth=30/15min, reviews=30/15min, orders=60/15min

### Helpers Útiles (referencia rápida)
- `src/utils/response.js`: `successResponse()`, `errorResponse()` — formato estándar API
- `src/middleware/killSwitch.js`: `checkSubscriptionKillSwitch` — bloquea features por plan
- `src/middleware/cache.js`: `menuCacheMiddleware`, `invalidateMenuCache()` — cache menú público
- `src/utils/sentry.js`: `captureMessage()`, `captureException()` — no-op si no hay DSN

### Nuevos Módulos de Utilidades (`public/js/utils/`)

| Módulo | Propósito |
|--------|-----------|
| `escapeHtml.js` | Sanitizador XSS modularizado |
| `eventThemes.js` | Detector de modo evento → clase CSS de tema |
| `dishPriceFormatter.js` | Formateo de precios, Happy Hour, strike |
| `categoryFilter.js` | Filtros dietéticos, orden por clima |

## Temas Visuales para Eventos (nuevos)

### Activación
- `businessType='events'` → `theme-wedding` por defecto
- `?event=cumple_15` → `theme-cumple15`
- `?event=birthday` → `theme-birthday`
- `?event=catering` → `theme-catering`
- `businessType='restaurant'` → **no aplica** tema de evento

### Estética Bodas / Casamientos
- Tonos blancos, marfil, marcos sutiles, tipografías serif (Playfair Display)
- Detalles decorativos con estilo floral/botánico suave
- Fondo `#FAFAFA`, tarjetas `#FFFFFF`, acentos `#D4A853` (dorado viejo)

### Estética Cumpleaños de 15 / Celebraciones
- Colores pastel suaves (rosados, champán)
- Tipografías finas, atmósfera sofisticada y festiva
- Fondo `#F9F0F5`, tarjetas `#FFFFFF`, acentos `#D4A853` + `#F4C2C2` (rosa)

### Estética Cumpleaños Generales
- Paleta suave festiva, elegante pero celebratorio
- Acentos mint (`#A8D5C7`), oro `#C9A867`
- Fondo `#FAF8F5`, tarjetas `#FFFFFF`

### Estética Catering
- Limpio, profesional, enfoque en comida
- Paleta neutral con acentos cálidos
- Fondo `#F7F4F0`, tarjetas `#FFFFFF`, acentos `#C49A4A` + `#A4753C` (umber)

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
| `public/js/utils/` | Nuevos módulos modulares (escapeHtml, eventThemes, etc.) |
| `public/js/components/` | 14 componentes ES Module reutilizables |