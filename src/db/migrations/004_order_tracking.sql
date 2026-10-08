-- ============================================================================
-- MIGRACIÓN 004 — SEGUIMIENTO DEL PEDIDO (ORDER TRACKING)
--
-- Sostiene el bloque "Seguimiento del Pedido": el comensal hace el pedido desde
-- el menú, recibe un token firmado (sin estado, HMAC del id — no requiere
-- columnas nuevas) y consulta el estado en GET /api/orders/track/:token. El
-- dueño avanza el estado en Studio (PATCH /api/orders/status/:orderId) y al
-- comensal le llega un aviso push dirigido.
--
-- Esta migración agrega SOLO lo que el aviso dirigido y la marca temporal
-- necesitan sobre tablas que YA existen (001/003):
--
--   orders.status_updated_at       → cuándo se movió el pedido por última vez
--                                    (la vista pública lo muestra). `status`
--                                    ya existe desde 001.
--   push_subscriptions.customer_phone → teléfono E.164 normalizado (sin +) del
--                                    comensal suscripto. Permite dirigir el
--                                    aviso de estado SOLO a quien hizo el
--                                    pedido, nunca a todos los guests.
--
-- Idempotente: podés ejecutarla varias veces (ADD COLUMN / CREATE INDEX IF NOT
-- EXISTS). Aplicar en el SQL Editor de Supabase (después de 001, 002 y 003), o
-- con Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/olqdcudvstbawkcvsfdd/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/004_order_tracking.sql)\"}"
--
-- El backend degrada con honestidad si esta migración todavía no está aplicada:
-- el estado se actualiza igual (solo `status`) y el aviso push dirigido por
-- teléfono cae al cache en memoria del proceso. Nada se rompe.
-- ============================================================================

-- 1. orders: marca temporal del último cambio de estado.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_status_updated
  ON public.orders (restaurant_id, status_updated_at DESC);

-- 2. push_subscriptions: teléfono del comensal para el aviso dirigido.
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_customer_phone
  ON public.push_subscriptions (restaurant_id, customer_phone)
  WHERE customer_phone IS NOT NULL;

-- 3. Comentario de trazabilidad (opcional, idempotente).
COMMENT ON COLUMN public.orders.status_updated_at IS
  'Último cambio de estado del pedido (seguimiento público del comensal).';
COMMENT ON COLUMN public.push_subscriptions.customer_phone IS
  'Teléfono E.164 normalizado (sin +) del comensal; dirige el aviso de estado del pedido SOLO a quien lo pidió.';

-- Nota: la RLS ya está habilitada y FORZADA en ambas tablas desde 001/003; el
-- backend las toca únicamente con el service_role. No se relajan políticas.
