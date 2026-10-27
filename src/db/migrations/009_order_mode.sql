-- ============================================================================
-- MIGRACIÓN 009 — MODALIDAD DEL PEDIDO (KDS / MOZOS)
--
-- El pedido ya viaja con `orderMode` desde el menú (LOCAL / DELIVERY /
-- TAKEAWAY), pero hasta ahora el backend lo usaba SOLO para cotizar (envío,
-- cupones) y no lo persistía. La pizarra de cocina no podía distinguir un
-- pedido de salón de un delivery sin adivinar por el `table_number`.
--
--   orders.order_mode → modalidad autoritativa del pedido.
--
-- Idempotente: podés ejecutarla varias veces (ADD COLUMN IF NOT EXISTS +
-- bloque DO para la constraint). Aplicar en el SQL Editor de Supabase
-- (después de 001…008), o con Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/olqdcudvstbawkcvsfdd/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/009_order_mode.sql)\"}"
--
-- El backend degrada con honestidad si esta migración todavía no está
-- aplicada: `cloudWriteTolerant` quita la columna rechazada y el pedido se
-- guarda igual en cloud; el espejo local conserva la modalidad y el KDS la
-- sigue mostrando.
-- ============================================================================

-- 1. orders: modalidad del pedido (default LOCAL para filas históricas).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_mode TEXT NOT NULL DEFAULT 'LOCAL';

-- 2. Allowlist (idempotente vía bloque DO).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_orders_order_mode'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT ck_orders_order_mode
      CHECK (order_mode IN ('LOCAL', 'DELIVERY', 'TAKEAWAY'));
  END IF;
END $$;

-- 3. Índice operativo: el KDS filtra por local y la cocina suele mirar los
--    pedidos abiertos; el modo entra como columna de apoyo, no de filtro duro.
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_mode
  ON public.orders (restaurant_id, order_mode);

-- 4. Comentario de trazabilidad (idempotente).
COMMENT ON COLUMN public.orders.order_mode IS
  'Modalidad autoritativa del pedido (LOCAL, DELIVERY, TAKEAWAY); la pinta el KDS y la usa el flujo de mozos.';

-- Nota: la RLS ya está habilitada y FORZADA en `orders` desde 001; el backend
-- la toca únicamente con el service_role. No se relajan políticas.
