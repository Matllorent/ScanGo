# Production Readiness Audit — ScanGo

Fecha: 2026-10-20

Resumen ejecutivo de los 7 puntos solicitados, con estado actual y acciones
recomendadas/implementadas en este ciclo.

## 1. Connection Pooling (BD)
- **Estado:** La app no usa `pg` directo en runtime. La persistencia cloud se
  hace vía el cliente REST de `@supabase/supabase-js` (`src/db/db.js`), que
  gestiona su propio pool HTTP/keep-alive hacia PostgREST. No hay conexiones
  TCP crudas por request.
- **Acción:** No se requiere pool manual. En un proyecto nuevo con acceso SQL
  directo (backups), usar el pooler de Supabase (puerto 5432 directo o
  pooler transaccional) y configurar `max`, `connectionTimeoutMillis`,
  `idleTimeoutMillis`. Ver `src/db/GUIA-SUPABASE-GRATIS.md`.

## 2. Capa de Caché
- **Estado:** Implementada. `api/middleware/cache.js` expone un LRU en memoria
  (1000 items, TTL 60s) + cache single-flight del menú público (TTL 5s,
  stale-while-revalidate) para evitar cache stampede. Invalidación centralizada
  vía `invalidateMenuCache()` (también dispara hook de `db.updateSubscription`).
- **Acción:** Para escalar a múltiples instancias (Vercel), considerar Redis/
  Upstash como L2 compartido; el código ya tiene el hook `fetchWithTimeout`
  para invalidación remota best-effort.

## 3. Índices en BD
- **Estado:** Implementados en `src/db/schema.sql` (y migraciones 001–005):
  `users(email)`, `restaurants(slug,user_id)`, `webhooks(provider,event_id)`,
  `group_carts(restaurant_id)`, `orders(restaurant_id,created_at)`,
  `reviews(status,created_at / restaurant_id,created_at)`,
  `customer_feedback(restaurant_id,created_at)`,
  `audit_logs(tenant_id,created_at)`, `push_subscriptions(restaurant_id)`,
  `telemetry_events(restaurant_id,created_at / event_id)`,
  unique `webhooks(provider,event_id)`.
- **Acción:** Aplicar `schema.sql` + migraciones en cualquier proyecto nuevo.
  Auditar con `npm run db:check`.

## 4. CDN para Assets Estáticos e Imágenes
- **Estado:** Assets estáticos servidos por Vercel CDN (config en
  `vercel.json`). Imágenes de platos/logos/reseñas se almacenan en Supabase
  Storage (bucket público `photos`), cuyas URLs públicas son servidas desde la
  CDN de Supabase/Cloudflare.
- **Acción:** No se requiere cambio de código. Para optimización adicional,
  considerar transforms de imagen (width/quality) al subir y `loading="lazy"` en
  el frontend (ya aplicado en componentes).

## 5. Pruebas de Carga
- **Estado:** Script sin dependencias en `scripts/load-test.js` (concurrencia
  real con fetch nativo, p50/p95/p99, tasa de error, SLO p95 menú<500ms /
  API<1000ms). Uso: `node scripts/load-test.js --base URL --slug SLUG --clients 100`.
- **Acción:** Correr contra staging con `--clients 100` antes del lanzamiento.
  `npm run test:load`.

## 6. Logs y Monitoreo
- **Estado:** Logger estructurado JSON (`api/utils/logger.js`) con niveles
  info/warn/error/debug y campos requestId/path/method/statusCode/responseTime/
  tenantId/slug. Sentry integrado (`api/services/sentry.js`, opcional por DSN).
  Latency tracker con percentiles (`api/utils/latencyTracker.js`) expuesto en
  `/api/healthz`.
- **Acción:** Configurar `SENTRY_DSN` en producción. Revisar `/api/healthz`
  periódicamente (uptime check cada 6h en `.github/workflows/uptime-check.yml`).

## 7. Notificaciones por Correo de Nuevos Clientes
- **Estado (implementado en este ciclo):** Se agregó
  `emailService.sendNewClientNotification()` en `api/services/email.js`. Se
  dispara (fire-and-forget) en:
  - `POST /api/auth/register` (nuevo registro por email).
  - Flujo de Google Auth (nuevo usuario).
  - Webhook de billing al activar una suscripción (`status === 'active'`).
- **Configuración:** Definir `OWNER_NOTIFICATION_EMAIL` (soporta varios separados
  por coma) en `.env`/Vercel. Si no está definido, la llamada es no-op seguro
  (no bloquea ni rompe el flujo). También se acepta `ADMIN_NOTIFICATION_EMAIL`
  o `NOTIFICATION_EMAIL` como fallback.
- **Ya existente:** Email de bienvenida al cliente (`sendWelcomeEmail`),
  confirmación de pago (`sendPaymentReceiptEmail`), avisos de trial/dunning/
  pago fallido/pausa, verificación de email, invitaciones admin, promocionales.

## Checklist pre-lanzamiento
- [ ] Aplicar migraciones 001–005 en el proyecto Supabase de producción.
- [ ] Configurar `OWNER_NOTIFICATION_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM`.
- [ ] Configurar `SENTRY_DSN` y `CRON_SECRET`.
- [ ] Correr `npm run test:load` contra staging con 100 clientes.
- [ ] Verificar `npm test` (52/52) en CI.
- [ ] Configurar UptimeRobot (o el workflow de uptime) apuntando a
  `/api/healthz`.
