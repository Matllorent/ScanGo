# k6 Load Testing Suite for ScanGo

Suite de pruebas de carga con **k6.io** para validar performance, consistencia y SLOs de los endpoints críticos de ScanGo.

## 📁 Estructura

```
tests/k6/
├── load-test-checkout.js      # Escenario 1 (pico hora comida) + 2 (concurrencia cupones)
├── load-test-groupcart.js     # Escenario 3 (carritos grupales 30×4 via Realtime)
├── load-test-discover.js      # Escenario 4 (feed Descubrir geo + paginación + likes)
├── test-data/
│   └── slugs.csv              # Slugs de restaurantes para tests data-driven
├── k6-options.json            # Thresholds compartidos y config de CI
└── README.md                  # Este archivo
```

## 🚀 Ejecución Rápida

### Prerrequisitos
- **k6** instalado: `brew install k6` (macOS) / `winget install k6` (Windows) / [descargar](https://k6.io/docs/getting-started/installation/)
- **Node.js ≥20** (para generar tokens si se necesita)
- Acceso al deployment target (Vercel prod/staging o localhost)

### Variables de Entorno Requeridas

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `BASE_URL` | URL base del deployment (ej: `https://scango-rouge.vercel.app`) | ✅ Sí |
| `SLUGS_CSV` | Path a CSV con columna `slug` (usa `tests/k6/test-data/slugs.csv` por defecto) | No |
| `AUTH_TOKEN` | JWT de dueño para endpoints autenticados (`/api/loyalty/validate`, `/api/loyalty/winback`) | Para test winback |
| `WINBACK_COUPON` | Código de cupón específico a testear (default: genera `VOL-XXXXXXXX`) | No |
| `GROUP_CART_TOKEN` | Token HMAC para endpoints `/group/*` (QR de mesa) | Para group cart |
| `RESTAURANT_ID` | ID del restaurante para group cart tests | Para group cart |
| `TABLE_NUMBER` | Número de mesa base (default: `1`) | No |
| `LAT` / `LNG` | Coordenadas para geo tests (default: Montevideo centro) | No |
| `RADIUS_KM` | Radio en km para filtro geo (default: `10`) | No |
| `CITY` | Ciudad para filtro Descubrir (default: `montevideo`) | No |

---

## 📋 Escenarios

### 1. Checkout Load Test (`load-test-checkout.js`)

**Escenario 1 — Pico hora comida:**
- 200 VU: rampa 2min → 5min sostenido → 1min bajada
- 70% `GET /m/:slug` (menú público SSR con CSP estricta)
- 20% `POST /api/orders/quote` + `POST /api/orders` (con `Idempotency-Key`)
- 10% loyalty/realtime endpoints

**Escenario 2 — Concurrencia cupones winback:**
- 50 VU simultáneos validando EL MISMO cupón `VOL-XXXXXXXX`
- Valida atomicidad: **exactamente 1 éxito (200), 49 conflictos (409)**

```bash
# Básico (usa slugs demo, sin auth)
k6 run --env BASE_URL=https://scango-rouge.vercel.app tests/k6/load-test-checkout.js

# Con slugs reales CSV
k6 run --env BASE_URL=https://scango-rouge.vercel.app \
       --env SLUGS_CSV=./tests/k6/test-data/slugs.csv \
       tests/k6/load-test-checkout.js

# Con auth para test winback (requiere JWT dueño)
k6 run --env BASE_URL=https://scango-rouge.vercel.app \
       --env AUTH_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... \
       tests/k6/load-test-checkout.js

# Con cupón winback específico
k6 run --env BASE_URL=https://scango-rouge.vercel.app \
       --env AUTH_TOKEN=... \
       --env WINBACK_COUPON=VOL-A1B2C3D4 \
       tests/k6/load-test-checkout.js
```

**Thresholds clave:**
- `menu_latency{p95} < 500ms` (SLO menú público)
- `quote_latency{p95} < 1000ms`, `order_latency{p95} < 1000ms` (SLO API)
- `coupon_success == 1`, `coupon_conflict_409 == 49`, `coupon_fail_other == 0`
- `error_rate < 1%`

---

### 2. Group Cart Load Test (`load-test-groupcart.js`)

**Escenario 3 — Carritos grupales:**
- 120 VU = 30 mesas × 4 comensales
- Cada VU = 1 comensal agregando/quitando items concurrentes
- Simula Realtime via HTTP polling a `POST /group/:restaurantId/:tableNumber/sync`
- Valida **union-merge** + **tombstones** (anti-resurrección)

```bash
# Requiere token de mesa y restaurantId
# Generar token: node -e "const {signGroupCartToken}=require('./api/utils/groupCartToken'); console.log(signGroupCartToken('rest_xxx','1'))"

k6 run --env BASE_URL=https://scango-rouge.vercel.app \
       --env GROUP_CART_TOKEN=eyJhbGciOiJIUzI1NiJ9... \
       --env RESTAURANT_ID=rest_abc123 \
       --env TABLE_NUMBER=5 \
       tests/k6/load-test-groupcart.js

# Con slugs CSV
k6 run --env BASE_URL=https://scango-rouge.vercel.app \
       --env SLUGS_CSV=./tests/k6/test-data/slugs.csv \
       --env GROUP_CART_TOKEN=... \
       --env RESTAURANT_ID=rest_abc123 \
       tests/k6/load-test-groupcart.js
```

**Thresholds clave:**
- `groupcart_sync_latency{p95} < 1000ms`
- `groupcart_get_latency{p95} < 500ms`
- `groupcart_merge_success > 100`
- `sync_errors < 2%`

> **Nota:** k6 no tiene soporte nativo robusto para WebSockets. Este test simula el flujo Realtime mediante HTTP polling al endpoint `/sync` y valida la consistencia del union-merge. Para test real de WebSockets, usar la extensión experimental `k6/x/websockets` (no incluido por compatibilidad).

---

### 3. Discover Feed Load Test (`load-test-discover.js`)

**Escenario 4 — Feed Descubrir beta:**
- 100 VU consultando `/api/discover/feed`
- 60% con geo (lat/lng/radiusKm), 70% con filtro ciudad
- Paginación profunda (offset 0-200)
- Likes concurrentes vía `POST /api/public/analytics/event` (`dish_like`)

```bash
# Básico
k6 run --env BASE_URL=https://scango-rouge.vercel.app tests/k6/load-test-discover.js

# Con geo personalizado (ej: Punta del Este)
k6 run --env BASE_URL=https://scango-rouge.vercel.app \
       --env LAT=-34.9598 --env LNG=-54.9479 \
       --env RADIUS_KM=15 --env CITY=pdeleste \
       tests/k6/load-test-discover.js
```

**Thresholds clave:**
- `discover_feed_latency{p95} < 800ms` (feed con geo + likes)
- `discover_pagination_latency{p95} < 600ms`
- `discover_like_latency{p95} < 500ms`
- `discover_cache_hit_rate > 30%` (server cache 60s)
- `error_rate < 1%`

---

## 🔧 Generación de Tokens

### AUTH_TOKEN (JWT dueño)
```bash
# Login en /api/auth/login → obtener cookie auth_token
# O generar manualmente si tienes JWT_SECRET:
node -e "
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const token = jwt.sign({ userId: 'usr_xxx', tenantId: 'rest_xxx', role: 'owner' }, secret, { expiresIn: '1h' });
console.log(token);
"
```

### GROUP_CART_TOKEN (HMAC QR mesa)
```bash
# Desde el server (requiere GROUP_CART_SECRET o JWT_SECRET):
node -e "
const {signGroupCartToken} = require('./api/utils/groupCartToken');
console.log(signGroupCartToken('rest_abc123', '5'));
"
```

### WINBACK_COUPON
Los cupones winback se generan vía `POST /api/loyalty/winback` (requiere auth dueño) y tienen formato `VOL-XXXXXXXX`. Para test de atomicidad pura, usar un cupón que YA EXISTA en BD.

---

## 📊 Resultados y Reportes

### Salida JSON (para CI)
```bash
k6 run --out json=results.json --summary-export=summary.json tests/k6/load-test-checkout.js
```

### Métricas clave a revisar
| Métrica | SLO | Significado |
|---------|-----|-------------|
| `menu_latency{p95}` | < 500ms | SSR menú público |
| `quote_latency{p95}` | < 1000ms | Cotización |
| `order_latency{p95}` | < 1000ms | Alta pedido |
| `http_req_failed` | < 1% | Tasa error global |
| `coupon_success` | == 1 | Atomicidad cupón |
| `coupon_conflict_409` | == 49 | Conflictos esperados |

---

## 🔄 Integración CI (GitHub Actions)

Workflow: `.github/workflows/k6-load-test.yml`

**Trigger manual:** `workflow_dispatch` con inputs:
- `test_suite`: `checkout` | `groupcart` | `discover` | `all`
- `base_url`: URL target (default: prod Vercel)
- `slugs_csv`: path a CSV (opcional)
- `auth_token`, `group_cart_token`, `restaurant_id`: secrets

**Ejecutar desde UI:**
1. GitHub → Actions → "k6 Load Tests" → Run workflow
2. Seleccionar suite y parámetros
3. Ver artifacts: `k6-results-*.json`, `k6-summary-*.json`

**En PR:** Comentario automático con tabla de thresholds pass/fail.

### Secrets Requeridos en GitHub
```
K6_BASE_URL          # https://scango-rouge.vercel.app (o staging)
K6_AUTH_TOKEN        # JWT dueño (generar y rotar periódicamente)
K6_GROUP_CART_TOKEN  # HMAC token mesa
K6_RESTAURANT_ID     # rest_xxx
```

---

## 📝 Data-Driven: CSV de Slugs

Formato `tests/k6/test-data/slugs.csv`:
```csv
slug
demo
demo-heladeria
demo-perfumeria
demo-evento
mi-restaurante-real
otro-slug-produccion
```

Para generar desde Supabase (solo lectura):
```bash
# Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
node -e "
const {createClient} = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data} = await supabase.from('restaurants').select('slug').eq('allowDiscovery', true);
console.log('slug');
data.forEach(r => console.log(r.slug));
" > tests/k6/test-data/slugs.csv
```

---

## ⚠️ Consideraciones Importantes

1. **Rate Limits**: Los endpoints tienen rate limiting por slug/IP (ver `api/middleware/rateLimits.js`). Los tests respetan think-times realistas para no saturar.

2. **Captcha Turnstile**: `POST /api/orders` exige `captchaToken` solo si `TURNSTILE_SECRET` está configurado. En load test se envía vacío (flujo actual intacto).

3. **Idempotency Key**: `POST /api/orders` requiere header `Idempotency-Key` (UUID por request). El test lo genera automáticamente.

4. **Cookies/JWT**: Endpoints autenticados (`/api/loyalty/validate`, `/api/loyalty/winback`, `/api/loyalty/credit`, etc.) requieren `AUTH_TOKEN` (JWT) en header `Authorization: Bearer`.

5. **Realtime Real**: Para test real de WebSockets Supabase, usar `k6/x/websockets` (extensión experimental). Este suite usa HTTP polling a `/sync` que replica la lógica de union-merge.

6. **Cleanup**: Los tests crean pedidos/carritos de prueba. En staging/prod, considerar limpieza post-test o usar base de datos dedicada.

---

## 🐛 Troubleshooting

| Error | Causa | Solución |
|-------|-------|----------|
| `401 Unauthorized` en loyalty | Falta `AUTH_TOKEN` | Proveer JWT dueño válido |
| `403 GROUP_CART_TOKEN_INVALID` | Token HMAC inválido | Generar token correcto con `signGroupCartToken` |
| `429 Rate Limited` | Excedió rate limit | Reducir VUs o aumentar think-time |
| `0 slugs en CSV` | CSV malformado | Verificar header `slug` y una por línea |
| `coupon_success = 0` | Cupón no existe o ya usado | Crear cupón fresco vía `/api/loyalty/winback` o usar `WINBACK_COUPON` nuevo |

---

## 📚 Referencias

- [k6 Documentation](https://k6.io/docs/)
- [k6 Thresholds](https://k6.io/docs/using-k6/thresholds/)
- [k6 Scenarios](https://k6.io/docs/using-k6/scenarios/)
- [ScanGo AGENTS.md](../AGENTS.md) — Arquitectura, endpoints, SLOs
- [API Contract](openapi.yaml) — OpenAPI 3.1 spec