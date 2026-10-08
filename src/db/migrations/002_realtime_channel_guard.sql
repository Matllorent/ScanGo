-- ============================================================================
-- MIGRACIÓN 002 — GUARD DE CANALES REALTIME (autorización por topic)
-- Limita qué topics de canal pueden unir los clientes del navegador
-- (anon/authenticated): SOLO carritos grupales `realtime:<slug>:mesa_<N>:<token>`.
-- Todo lo demás (event_waiters_*, canales internos) queda reservado al backend
-- (service_role, que en Supabase tiene BYPASSRLS y no pasa por estas políticas).
--
-- Idempotente: podés ejecutarla varias veces (DROP POLICY IF EXISTS).
-- Aplicar en el SQL Editor de Supabase, o con Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/<PROJECT_REF>/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/002_realtime_channel_guard.sql)\"}"
--
-- MODELO: la autorización de Realtime se evalúa al unir un canal según las
-- políticas RLS de `realtime.messages` (no es una tabla de datos; solo decide
-- join/lectura de topics). Para que estas políticas hagan efecto, el cliente
-- debe conectar el canal como PRIVADO (`private: true`). Ese flag NO se activa
-- hasta que esta migración esté aplicada (de lo contrario los carritos grupales
-- quedan sin autorización y se rompen). Pasos de activación:
--   1) Aplicar este SQL.
--   2) En public/js/components/GroupCartManager.js y api/routes/orders.js,
--      agregar `private: true` a la config del canal `realtime:<slug>:mesa_<N>:<token>`.
--      El comensal ya une con la anon key (JWT role=anon) → aplica la política anon.
-- ============================================================================

-- La tabla realtime.messages ya existe en todo proyecto Supabase; aseguramos RLS.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Comensales anónimos (escanean el QR con la anon key): solo carritos grupales.
DROP POLICY IF EXISTS "anon join group cart topics only" ON realtime.messages;
CREATE POLICY "anon join group cart topics only"
  ON realtime.messages
  FOR SELECT
  TO anon
  USING (realtime.topic() LIKE 'realtime:%');

-- Usuarios autenticados (nunca deberían tocar canales internos del backend).
DROP POLICY IF EXISTS "authenticated join group cart topics only" ON realtime.messages;
CREATE POLICY "authenticated join group cart topics only"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (realtime.topic() LIKE 'realtime:%');

-- service_role no necesita política: en Supabase es BYPASSRLS y conserva acceso
-- total a cualquier topic (el backend sigue usando event_waiters_*, etc.).