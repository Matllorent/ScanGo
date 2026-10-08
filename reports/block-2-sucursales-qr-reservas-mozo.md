# Block 2 — Sucursales & multi-local, QR/pedido grupal realtime, Reservas, El Mozo Virtual

**Fecha**: 2026-10-08 · **Commit**: `d54508a` · **Suite**: 19/19 ✔ (npm test)

Scope ejecutado completo ("Plan completo recomendado"), cero mocks — flujos reales con DB
y navegador (Playwright + browser harness).

---

## 1. Sucursales & multi-local

### Validado (E2E navegador + HTTP real)
- **Aislamiento de datos por sucursal**: `GET /api/menu/el-barril-qa?branch=centro` devuelve
  precios override y customDishes SOLO para esa sucursal; la vista sin `?branch` mantiene
  precios base y 0 customDishes. Ambas respuestas cacheadas por separado.
- **CRUD de sucursales (HTTP)**: ADD → 200, UPDATE → 200, DELETE secundaria → 200,
  protección de la principal (cambiar name/slug/borrar → 400) en `src/db/db.js`.
- **Editor visual en Studio (E2E Playwright)**:
  - Tab "Sucursales" lista la principal con botón ⚙️.
  - Modal `branchEditModal`: nombre/slug de la principal **readOnly** (protegidos también en UI),
    teléfono/dirección editables.
  - Override prices precargados (incl. legacy `{price:n}` → coerce a `6` / `8.5`).
  - Guardado real: `d_1 → 7`, `d_2 → 9` (números limpios), + alta de customDish
    "Especial de la Sucursal 2" (cat. "Cócteles", $12) persistido vía PATCH.
  - Verificación posterior por API pública: override 7/9 con `previous_price` 490 y
    customDish visible con su categoría sintética.

### Bugs encontrados y corregidos
| Bug | Fix |
|---|---|
| **Contaminación de cache por sucursal**: el menú de `?branch=centro` se cacheaba bajo el slug pelado; pedidos sin branch recibían overrides y viceversa | `api/middleware/cache.js` key incluye `branch/sucursal` (60s LRU); `api/index.js` `getCachedMenu` key = `${slug}:branch:${reqBranch}` (5s single-flight). Verificado: ambos caches HIT con keys aisladas |
| **overridePrices con shape legacy `{price:n}`** se filtraba al frontend y rompía el formato de precio | `normalizeOverridePrices()` en add/update (DB) + `resolveBranchOverridePrice()` en read-path (API + SSR) — acepta `{price:n}` legacy, descarta NaN, siempre `Record<dishId,number>` |
| **customDishes de sucursal invisibles**: el menú público agrupa por `d.categoryId === cat.id` y los customDishes venían solo con `category` (nombre) | `normalizeBranchCustomDishes()` sintetiza `categoryId` y agrega la categoría sintética a la respuesta (API + SSR). Verificado en navegador: categoría "Especiales" y plato renderizado |
| Slug de categoría custom con diacríticos producía `branch_cat_c-cteles` | Sanitizador con `normalize('NFD')` → `branch_cat_cocteles` |

---

## 2. QR & pedido grupal realtime

### Validado (E2E 2 pestañas + broadcast externo)
- **Mesa 6, vacío** (`qa-block2-bistro`): alta bidireccional A↔B sin pérdida de items.
- **Ownership**: Bruno no puede borrar el item de Ana (403 server-side + UI).
- **Tombstones**: borrado A → propagado a B y el sync devuelve `deletedItemIds` (el
  union-merge no resucita items eliminados).
- **Clear**: 0 items con participantes preservados.
- **Broadcast server→cliente real**: sync HTTP externo empujó 2 items; ambas pestañas
  los recibieron sin interacción local.

### Bugs encontrados y corregidos
| Bug | Fix |
|---|---|
| **RangeError: Maximum call stack size exceeded** en broadcast (subscribe→send→unsubscribe por request con realtime-js 2.x) y **broadcast server muerto** (send sin subscribe previo no emite nada) | Pool de canales Realtime persistentes `<channelName>` con subscribe único, TTL 10 min y cleanup 2 min (`api/routes/orders.js`) |
| **GCM arrancaba con `restaurantId` indefinido** → token HMAC firmado con `'default'` → 403 `GROUP_CART_TOKEN_INVALID`, carrito nunca persistía ni se emitía broadcast | `menu-modules.js`: espera hasta 8s por `window.restaurantData.id`, fallback slug de la URL, `restaurantId` explícito, promesa in-flight única (evita doble instancia por doble call-site) |

### Nota de infraestructura
`public.group_carts` **no existía en Supabase** (PGRST205) en el momento de este bloque →
los carritos grupales vivían en memoria del proceso (Map con TTL 24h). **Resuelto en el
Block 3** (`reports/block-3-supabase-cloud-tables.md`): migración idempotente con RLS en
`src/db/migrations/001_realtime_operations_tables.sql` + sonda de esquema en arranque
(`db.getSchemaStatus()` / `/api/healthz` → `schema.missing`) + smoke test `npm run db:smoke`.

---

## 3. Reservas

- Validación previa en `submitReservation` (eventGuestMode.js): nombre, fecha-no-anterior-a-hoy,
  horario, comensales (`8+` → "8 o más"), teléfono del local configurado.
- `resFormMsg` (role=alert) en `menu.html`: errores visibles y **limpiado al reintentar**
  (fix del mensaje fantasma).
- `openReservationModal` fija `min` = hoy y limpia el mensaje anterior.
- E2E navegador (tab fresca): fecha pasada → bloqueada con ⚠️, sin nombre → ⚠️,
  válida → `wa.me/59899123456` correcto.

---

## 4. El Mozo Virtual (reglas/heurísticas + copy honesto)

- Reglas livianas por heurística de carrito + clima (sin ML):
  plato-principal+papas, plato+bebida, día caluroso → helada/limonada,
  frío → caldo/sopa; badge contextual; target = ticket promedio creciente.
- **Copy honesto** (BIG-one del bloque):
  - `🔥 ¡Hace calor! ¿Querés agregar una X helada con 15% OFF?` → `...bien helada para refrescar el momento?` (menu.js + VirtualWaiter.js).
  - `-15% de descuento sugerido` → sin porcentaje falso (maridaje).
  - El quick-add **agrega a precio completo** (verificado: 540 + 190 = 730, sin descuento).
    El descuento real solo llega por cupón `PROMO10`/`PROMO15` (código real).
- **E2E multi-viewport (Playwright)** con contexto de clima inyectado sobre el objeto real
  (`smartWeatherEnabled=true`, `caluroso`, 32°C, dish con `weatherTags`):
  anchos 360/390/768/1024/1280 → caja visible dentro de `#cartModal`,
  razón honrada ✓, badge "Ideal para el clima" ✓, **sin** "15% OFF" ni bait ✓,
  sin overflow horizontal ✓.
- Tests actualizados en lockstep (`test-group-cart-mozo.js`): ahora asevera la
  **ausencia** de `15% OFF` y del porcentaje en el pitch de calor.

---

## 5. Calidad & regresión

- `npm test` → **19/19 ✔** (focused: `test-group-cart-mozo`, `test-db-await-integrity`,
  `test-frontend-esm-syntax` 58 archivos, `test-frontend-structure` 13 modales studio).
- `node --check` en todos los archivos editados.
- `data/*.json` (trackeados, mutados por tests) **revertidos a HEAD** antes y después de la suite;
  el árbol queda limpio tras el commit.

## 6. Deuda técnica / observaciones

- `public.group_carts` ausente en Supabase durante Block 2: carritos en memoria. **Block 3** entrega la migración con RLS (`src/db/migrations/`), el inventario `npm run db:check` y el smoke test `npm run db:smoke`.
- `restaurants.json` trackeado + mutado por tests: mantener política de revert-diff previo a commit.
- Dos `escapeHtml` (legacy CommonJS vs browser): intactos, sin unificar (gotcha AGENTS.md).
- `eventThemes.js` / `menuRenderer.js`: archivos muertos no tocados (gotcha AGENTS.md).
- Nueva dependencia funcional del editor de sucursales sobre `renderBranchesList`/`triggerAutoSave`:
  mantenida en `studio.js` (sync API↔Studio).