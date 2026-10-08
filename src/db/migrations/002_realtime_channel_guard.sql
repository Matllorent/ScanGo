-- ============================================================================
-- MIGRACIÓN 002 — GUARD DE CANALES REALTIME (autorización por topic)
-- Limita qué topics de canal pueden unir y a qué canales pueden emitir los
-- clientes del navegador (anon/authenticated): SOLO carritos grupales
-- `realtime:<slug>:mesa_<N>:<token>`.
-- Todo lo demás (event_waiters_*, canales internos) queda reservado al backend
-- (service_role, que en Supabase tiene BYPASSRLS y no pasa por estas políticas).
--
-- ⚠️ ERROR CONOCIDO (42501 "must be owner of table messages"):
--   realtime.messages pertenece al rol interno supabase_realtime_admin. RLS ya
--   está HABILITADA por defecto en esa tabla. La extensión supautils permite que
--   el rol postgres (SQL Editor) ejecute `create/alter/drop policy` SOBRE ESA
--   TABLA sin ser owner, pero NO permite NI UNA forma de `ALTER TABLE`.
--   Por lo tanto: ESTA MIGRACIÓN NO CONTIENE ALTER TABLE SOBRE realtime.messages.
--   Un ALTER TABLE ahí falla con 42501 en cualquier proyecto, aborta la
--   transacción y se traga TODO lo que viene después (incluidas las políticas).
--   Para chequear que RLS siga activa, leer el catálogo (no setearla):
--     select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass;
--
-- Idempotente: podés ejecutarla varias veces (DROP POLICY IF EXISTS).
-- Aplicar en el SQL Editor de Supabase, o con Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/<PROJECT_REF>/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/002_realtime_channel_guard.sql)\"}"
--
-- ACTIVACIÓN (importante el orden): las políticas recién tienen efecto cuando
-- los canales se unen como PRIVADOS (`config.private = true`). Primero aplicar
-- este SQL y recién después desplegar la versión del código que marca los
-- canales como privados. Si el código va primero, los comensales anónimos son
-- rechazados por no haber política que los autorice (deny by default).
--   a) public/js/components/GroupCartManager.js  → config: { private: true }
--   b) api/routes/orders.js (broadcastToTableChannel) → channel() con private
--   c) api/index.js (event_waiters_<slug>)        → channel() con private
-- El toggle "Allow public access" del dashboard (default: Enabled) NO hace
-- falta apagarlo: los canales privados siempre evalúan políticas; ese toggle solo
-- admite o rechaza canales PÚBLICOS (y público≠privado aunque el topic sea igual).
-- ============================================================================

-- Unir y recibir broadcasts de carritos grupales (SELECT = join + receive).
DROP POLICY IF EXISTS "anon join receive group cart topics" ON realtime.messages;
CREATE POLICY "anon join receive group cart topics"
  ON realtime.messages
  FOR SELECT
  TO anon
  USING ((select realtime.topic()) LIKE 'realtime:%');

DROP POLICY IF EXISTS "authenticated join receive group cart topics" ON realtime.messages;
CREATE POLICY "authenticated join receive group cart topics"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING ((select realtime.topic()) LIKE 'realtime:%');

-- Emitir broadcasts (los comensales publican cart_update / request_sync /
-- sync_state desde sus teléfonos con `channel.send`, tipo broadcast).
DROP POLICY IF EXISTS "anon send broadcast in group cart topics" ON realtime.messages;
CREATE POLICY "anon send broadcast in group cart topics"
  ON realtime.messages
  FOR INSERT
  TO anon
  WITH CHECK ((select realtime.topic()) LIKE 'realtime:%');

DROP POLICY IF EXISTS "authenticated send broadcast in group cart topics" ON realtime.messages;
CREATE POLICY "authenticated send broadcast in group cart topics"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK ((select realtime.topic()) LIKE 'realtime:%');

-- service_role no necesita política: en Supabase es BYPASSRLS y conserva acceso
-- total a cualquier topic (el backend sigue usando event_waiters_*, etc.).