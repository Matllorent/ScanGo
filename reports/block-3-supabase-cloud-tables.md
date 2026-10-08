# Block 3 — Migración Supabase de tablas cloud (realtime + operaciones)

> **Entregado:** 07/10/2026 · **Suite:** `npm test` 19/19 ✅ · **Cero mocks, 100% real.**

## Objetivo

Cerrar la deuda de infraestructura más grande del Block 2: los carritos grupales realtime
(y otras tablas operacionales) **no existían en el proyecto Supabase real** (`PGRST205`),
así que el backend degradaba silenciosamente a memoria local del proceso. Este bloque
entrega la **migración SQL autoritativa**, la **verificación real del inventario**, la
**visibilidad del gap** (sin degradación silenciosa) y un **smoke test real de persistencia**.

## Inventario real del esquema cloud (service role, read-only)

`npm run db:check` (nuevo script `scripts/check-supabase-schema.js`) sondea cada tabla
declarada vía PostgREST: `relation exists` si `SELECT id LIMIT 1` responde 200;
`relation missing (PGRST205)` si no.

| Tabla | Estado real en la nube |
|---|---|
| `users` | ✅ existe |
| `restaurants` | ✅ existe |
| `webhooks` | ✅ existe |
| `group_carts` | ❌ faltaba → **creada por migración** |
| `orders` | ❌ faltaba → **creada por migración** |
| `reviews` | ❌ faltaba → **creada por migración** |
| `customer_feedback` | ❌ faltaba → **creada por migración** |
| `audit_logs` | ❌ faltaba → **creada por migración** |
| `push_subscriptions` | ❌ faltaba → **creada por migración** |
| `telemetry_events` | ❌ faltaba → **creada por migración** |

**Faltaban 7 de 10 tablas.** El alcance aprobado ("group_carts + las que falten") cubrió las 7.

## Entregables

### 1. Migración — `src/db/migrations/001_realtime_operations_tables.sql`
- **Idempotente** (`IF NOT EXISTS` en CREATE / ADD / INDEX): se puede pegar en el SQL Editor
  de Supabase cuantas veces se quiera.
- **Columnas en sincronía exacta con el código runtime** (verificado contra cada `.insert`/
  `.upsert`/`.select` en `api/`):
  - `group_carts`: `id, restaurant_id, table_number, items JSONB, participants JSONB,
    last_action, last_user, updated_at` (upsert por `id`, lectura `single()`).
  - `orders`: snapshot de precios `items_snapshot JSONB`, `amount NUMERIC(12,2)` con
    `CHECK >= 0`, `amount_in_cents BIGINT CHECK >= 0`, `group_session_id`, `is_group_order`.
  - `reviews`: `rating SMALLINT CHECK (1..5)`, `status CHECK IN (pending, approved, rejected)`,
    índice `(status, created_at DESC)` para el listado público paginado.
  - `customer_feedback`: `rating CHECK (1..5)`, `customer_name/customer_contact`.
  - `audit_logs`: `tenant_id, user_id, request_id, action, entity, details_json JSONB` +
    índice `(tenant_id, created_at DESC)`.
  - `push_subscriptions`: `endpoint UNIQUE` (requerido por el `upsert(..., { onConflict:
    'endpoint' })`) + índices `(restaurant_id)` y `(user_id)` parcial.
  - `telemetry_events`: `event_type, dish_id, branch_id, event_id, metadata_json JSONB` +
    índices `(restaurant_id, created_at DESC)` y `event_id` parcial.
- **RLS habilitada + FORZADA** en las 7 tablas (`FORCE ROW LEVEL SECURITY`, defensa en
  profundidad incluso para el owner) y **privilegios solo para `service_role`**;
  `REVOKE` total a `PUBLIC, anon, authenticated` — coherente con el bloque de hardening
  ya existente en `src/db/schema.sql` (cero políticas: deny-all para roles cliente).
- **Realtime = Broadcast**, no Postgres Changes: los canales `realtime:<slug>:mesa_N:<token>`
  no requieren privilegios de tabla ni publicación → no se toca `supabase_realtime`
  (documentado en el propio archivo).
- Formato: lista para pegar en el SQL Editor **o** aplicar vía Management API (one-liner
  `curl` documentado en el header, requiere `SUPABASE_ACCESS_TOKEN`).

### 2. Inventario y aplicador — `scripts/check-supabase-schema.js` + `npm run db:check`
Read-only, service role, cero mocks. Lista las 10 tablas declaradas con ✅/❌ y, si faltan,
indica el archivo de migración. Es la misma sonda que usa el arranque del backend.

### 3. Visibilidad del gap — `src/db/db.js` + `api/routes/health.js`
- En el arranque Supabase (`db.ready`), nueva sonda `probeCloudSchema()` de las 7 tablas
  operacionales (Paralela, 1 RTT) → `cloudSchemaStatus` con `{ probedAt, missing, present,
  details }`.
  - Si faltan: **warn accionable** en consola (migración + `npm run db:check`) en lugar de
    degradar en silencio.
  - Si completas: log `✅ [DB] Esquema cloud completo`.
- Exposición API: `db.getSchemaStatus()` y `/api/healthz` → nuevo bloque `schema`:
  `{ probedAt, missing[], present[], migrationHint }`.
- `databaseReady` ahora devuelve `schema: { missing, present }` (sin romper el shape previo).

### 4. Smoke test real de persistencia — `tests/test-supabase-group-cart-persistence.js` + `npm run db:smoke`
- Sin credenciales Supabase → **SKIP exit 0** (modo JSON local).
- Tabla ausente (PGRST205) → **SKIP exit 0** con la ruta de migración (señal honesta de que
  el bloque aún no se aplicó).
- Tabla presente → **round-trip real**: upsert → select `single()` → asserts de
  `items/participants/last_action` → **idempotencia** (segundo upsert no duplica, `count=1`)
  → delete de limpieza. Fallo real → exit 1.
- **NO está en `npm test`** a propósito (depende de infraestructura cloud), igual que
  `test-db-write.js`/`test-e2e.js`.

## Verificación ejecutada (real, no mocks)

| Check | Resultado |
|---|---|
| `node scripts/check-supabase-schema.js` (inventario) | ✅ 3 existentes, 7 faltantes (PGRST205 confirmado) |
| Arranque `node api/index.js` | ✅ loguea las 7 faltantes + ruta de migración (degradación ya no silenciosa) |
| `GET /api/healthz` | ✅ HTTP 200, `schema.missing` = 7 tablas, `migrationHint` correcto |
| `node tests/test-supabase-group-cart-persistence.js` | ✅ SKIP limpio exit 0 con ruta de migración (tabla aún sin aplicar) |
| `npm test` (19 tests) | ✅ **19/19 verdes** post-cambios en `db.js`/`health.js` |

## Estado tras el commit

- `data/*.json` revertidos a HEAD (política: tests los mutan, el diff no se commitea).
- Falta **una acción de operador** para activar persistencia real en la nube: aplicar
  `src/db/migrations/001_realtime_operations_tables.sql` en el SQL Editor de Supabase
  (o vía Management API con `SUPABASE_ACCESS_TOKEN`, one-liner en el header del archivo).
  Después: `npm run db:smoke` debe pasar a ✅ round-trip y `/api/healthz` debe mostrar
  `schema.missing: []`.

## Notas / decisiones

- **JSONB en `items`/`participants`/`details_json`/`metadata_json`**: bustos opacos de estado
  del cliente y metadata; no se consultan por columna. Si en el futuro se analizan (top
  platos, etc.), se normaliza con columnas + backfill (nota dejada en los COMMENTs).
- **Sin triggers de `updated_at`**: el backend setea `updated_at` explícitamente en cada
  upsert (evita dependencia de extensiones).
- **RLS sin políticas**: deny-all por defecto para anon/authenticated; el service role
  (único escritor/lector) la saltea. Es el modelo ya declarado en `schema.sql`.
- La migración **no** se aplicó desde este entorno porque no existe canal de DDL:
  `SUPABASE_ACCESS_TOKEN` y DB password ausentes (verificado) y `public.users/restaurants/
  webhooks` confirman que el resto se creó manualmente por el SQL Editor (convención del repo).