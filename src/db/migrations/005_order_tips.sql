-- ============================================================================
-- MIGRACIÓN 005 — PROPINA DEL COMENSAL (TIP)
--
-- Sostiene la propina OPTIONAL del checkout: es 100% decisión del comensal
-- (arranca en "sin propina" y ofrece 5% / 10% / 15% o un monto fijo) y se suma
-- al total del pedido que se envía por WhatsApp.
--
-- La propina vive APARTE del monto de los platos (`orders.amount`) para no
-- distorsionar el ticket promedio de analytics; el seguimiento del pedido la
-- expone como `tip`.
--
--   orders.tip_amount → monto de propina declarado (0 = sin propina).
--
-- Idempotente: podés ejecutarla varias veces (ADD COLUMN IF NOT EXISTS).
-- Aplicar en el SQL Editor de Supabase (después de 001, 002, 003 y 004), o con
-- Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/olqdcudvstbawkcvsfdd/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/005_order_tips.sql)\"}"
--
-- El backend degrada con honestidad si esta migración todavía no está aplicada:
-- POST /api/orders reintenta el INSERT en cloud SIN `tip_amount` (el pedido no
-- se pierde), y la propina igual queda en el espejo local y en el mensaje de
-- WhatsApp que recibe el local.
-- ============================================================================

-- 1. orders: monto de propina (nunca negativo, por defecto sin propina).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 2. Guarda de no-negatividad (idempotente vía bloque DO).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_orders_tip_amount_nonneg'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT ck_orders_tip_amount_nonneg CHECK (tip_amount >= 0);
  END IF;
END $$;

-- 3. Comentario de trazabilidad (opcional, idempotente).
COMMENT ON COLUMN public.orders.tip_amount IS
  'Propina opcional declarada por el comensal en el checkout (0 = sin propina). No se suma al ticket promedio de analytics.';

-- Nota: la RLS ya está habilitada y FORZADA en `orders` desde 001; el backend
-- la toca únicamente con el service_role. No se relajan políticas.
