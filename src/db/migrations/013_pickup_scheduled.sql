-- ============================================================================
-- MIGRACIÓN 013 — TAKEAWAY PROGRAMADO (retiro con horario)
--
-- El pedido del comensal ya viaja con `scheduledFor` (instante de retiro
-- programado) cuando el dueño activó `allowPreOrders`, pero hasta ahora el
-- backend no lo persistía: seguimiento, KDS y analítica no podían distinguir
-- un pedido "para retirar ya" de un pre-order programado.
--
--   orders.scheduled_for → instante autoritativo de retiro (timestamptz).
--
-- Idempotente: podés ejecutarla varias veces (ADD COLUMN IF NOT EXISTS +
-- CREATE INDEX IF NOT EXISTS). Aplicar en el SQL Editor de Supabase
-- (después de 001…012), o con Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/olqdcudvstbawkcvsfdd/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/013_pickup_scheduled.sql)\"}"
--
-- El backend degrada con honestidad si esta migración todavía no está
-- aplicada: `cloudWriteTolerant` quita la columna rechazada y el pedido se
-- guarda igual en el espejo local (`scheduledFor`/`scheduled_for` intactos
-- para seguimiento y KDS). No se inventa capacidad ni ETA por el drift.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_scheduled_for
  ON public.orders (restaurant_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;
