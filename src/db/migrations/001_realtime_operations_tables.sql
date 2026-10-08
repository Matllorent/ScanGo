-- ============================================================================
-- MIGRACIÓN 001 — TABLAS CLOUD DE REALTIME Y OPERACIONES
-- Crea las tablas que faltan en el proyecto Supabase (verificado por
-- `npm run db:check`): group_carts, orders, reviews, customer_feedback,
-- audit_logs, push_subscriptions, telemetry_events.
--
-- Idempotente: podés ejecutarla varias veces (CREATE/ADD/INDEX IF NOT EXISTS).
-- Aplicar en el SQL Editor de Supabase, o con Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/olqdcudvstbawkcvsfdd/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/001_realtime_operations_tables.sql)\"}"
--
-- Modelo de seguridad: las tablas NUNCA se exponen a anon/authenticated.
-- RLS está HABILITADA + FORZADA (defensa en profundidad, incluso para el owner)
-- y los únicos privilegios son del service_role, que usa el backend.
-- El Realtime de los carritos grupales usa Broadcast (canales `realtime:...`),
-- que NO requiere privilegios de tabla ni publicación; por eso no se agregan
-- tablas a la publicación supabase_realtime aquí.
-- ============================================================================

-- 1. Carritos grupales (realtime por mesa)
CREATE TABLE IF NOT EXISTS public.group_carts (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  table_number TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_action TEXT NOT NULL DEFAULT 'sync',
  last_user TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_group_carts_restaurant ON public.group_carts(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_group_carts_updated_at ON public.group_carts(updated_at);

-- 2. Pedidos (histórico con snapshot de precios)
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  table_number TEXT NOT NULL DEFAULT '',
  items_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CONSTRAINT ck_orders_amount_nonneg CHECK (amount >= 0),
  amount_in_cents BIGINT NOT NULL DEFAULT 0 CONSTRAINT ck_orders_cents_nonneg CHECK (amount_in_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'UYU',
  status TEXT NOT NULL DEFAULT 'pending',
  customer_name TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  notes TEXT,
  is_group_order BOOLEAN NOT NULL DEFAULT false,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  group_session_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_orders_restaurant_created
  ON public.orders (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_group_session
  ON public.orders (group_session_id) WHERE group_session_id <> '';

-- 3. Reseñas públicas (smart Google reviews / moderación)
CREATE TABLE IF NOT EXISTS public.reviews (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  user_id TEXT,
  restaurant_name TEXT,
  rating SMALLINT NOT NULL CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  author_photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT ck_reviews_status CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  moderated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON public.reviews (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_created
  ON public.reviews (restaurant_id, created_at DESC);

-- 4. Feedback privado de clientes (canal aparte de reseñas públicas)
CREATE TABLE IF NOT EXISTS public.customer_feedback (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  rating SMALLINT NOT NULL CONSTRAINT ck_feedback_rating CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT 'Anónimo',
  customer_contact TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_restaurant_created
  ON public.customer_feedback (restaurant_id, created_at DESC);

-- 5. Auditoría (fire-and-forget desde api/services/audit.js)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'system',
  user_id TEXT NOT NULL DEFAULT 'system',
  request_id TEXT NOT NULL DEFAULT 'untracked',
  action TEXT NOT NULL DEFAULT 'UNKNOWN',
  entity TEXT NOT NULL DEFAULT 'unknown',
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON public.audit_logs (tenant_id, created_at DESC);

-- 6. Suscripciones push (endpoint UNIQUE por upsert onConflict)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  restaurant_id TEXT,
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT uq_push_subscriptions_endpoint UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_restaurant
  ON public.push_subscriptions (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions (user_id) WHERE user_id IS NOT NULL;

-- 7. Telemetría (eventos públicos/analytics, event_id único por acción)
CREATE TABLE IF NOT EXISTS public.telemetry_events (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  dish_id TEXT,
  branch_id TEXT,
  event_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_telemetry_restaurant_created
  ON public.telemetry_events (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_event_id
  ON public.telemetry_events (event_id) WHERE event_id IS NOT NULL;

-- ============================================================================
-- SEGURIDAD: RLS forzada + solo service_role (coherente con src/db/schema.sql)
-- ============================================================================
ALTER TABLE public.group_carts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_feedback  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_events   ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.group_carts        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reviews            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_feedback  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_events   FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.group_carts, public.orders, public.reviews,
  public.customer_feedback, public.audit_logs, public.push_subscriptions,
  public.telemetry_events
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.group_carts, public.orders, public.reviews,
  public.customer_feedback, public.audit_logs, public.push_subscriptions,
  public.telemetry_events
  TO service_role;

COMMENT ON TABLE public.group_carts IS
  'Carritos grupales realtime por mesa. Escritura exclusiva vía service_role (backend); broadcast por canal Realtime.';
COMMENT ON TABLE public.orders IS
  'Histórico de pedidos con snapshot de precios; inmutable por diseño (append-only).';
COMMENT ON TABLE public.reviews IS
  'Reseñas públicas moderadas; el comensal nunca escribe directo (service role media la inserción).';
COMMENT ON TABLE public.customer_feedback IS
  'Feedback privado 1-5 estrellas para la administración del restaurante.';
COMMENT ON TABLE public.audit_logs IS
  'Auditoría de acciones administrativas; fire-and-forget desde el backend.';
COMMENT ON TABLE public.push_subscriptions IS
  'Suscripciones Web Push; endpoint único para upsert idempotente.';
COMMENT ON TABLE public.telemetry_events IS
  'Eventos de telemetría (vistas, clicks, analytics).';