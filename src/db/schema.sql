-- ==========================================================
-- MENÚ PIZARRÓN SAAS — ESQUEMA POSTGRESQL PARA SUPABASE
-- Copiá y pegá este código en el SQL Editor de Supabase
-- ==========================================================

-- 1. Tabla de Usuarios / Dueños de Restaurantes
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT,
  email_confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- 2. Tabla de Restaurantes y Cartas
CREATE TABLE IF NOT EXISTS public.restaurants (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  name TEXT,
  biz_name TEXT,
  slogan TEXT,
  currency TEXT DEFAULT '$',
  phone TEXT,
  city TEXT DEFAULT '',
  smart_weather_enabled BOOLEAN NOT NULL DEFAULT false,
  theme TEXT DEFAULT 'emerald',
  theme_font TEXT DEFAULT 'serif',
  layout TEXT NOT NULL DEFAULT 'classic',
  logo_url TEXT,
  banner_url TEXT,
  business_type TEXT NOT NULL DEFAULT 'restaurant',
  wifi JSONB DEFAULT '{"ssid": "", "password": ""}'::jsonb,
  categories JSONB DEFAULT '[]'::jsonb,
  dishes JSONB DEFAULT '[]'::jsonb,
  modifier_groups JSONB DEFAULT '[]'::jsonb,
  delivery_zones JSONB DEFAULT '[]'::jsonb,
  subscription JSONB DEFAULT '{"status": "trialing", "plan": "pro_monthly"}'::jsonb,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS modifier_groups JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'restaurant';

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS smart_weather_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS theme_font TEXT DEFAULT 'serif',
  ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS banner_url TEXT,
  ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_restaurants_slug ON public.restaurants(slug);
CREATE INDEX IF NOT EXISTS idx_restaurants_user_id ON public.restaurants(user_id);

-- 2b. Multi-Branch Support: branches JSONB array
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS branches JSONB DEFAULT '[]'::jsonb;

-- branches structure:
-- [{
--   "id": "branch_1",
--   "name": "Sucursal Centro",
--   "address": "Av. 18 de Julio 1234",
--   "phone": "59899123456",
--   "is_active": true,
--   "custom_pricing": { "dish_id": 100 }
-- }]

-- 3. Tabla de Idempotencia de Webhooks de Pago
CREATE TABLE IF NOT EXISTS public.webhooks (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  received_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT unique_provider_event UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhooks_lookup ON public.webhooks(provider, event_id);

-- 4. Tabla de Carritos Grupales (Realtime)
CREATE TABLE IF NOT EXISTS public.group_carts (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  table_number TEXT NOT NULL,
  items JSONB DEFAULT '[]'::jsonb,
  participants JSONB DEFAULT '[]'::jsonb,
  last_action TEXT DEFAULT 'sync',
  last_user TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_carts_restaurant ON public.group_carts(restaurant_id);

ALTER TABLE public.group_carts
  ADD COLUMN IF NOT EXISTS restaurant_id TEXT,
  ADD COLUMN IF NOT EXISTS table_number TEXT,
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_action TEXT NOT NULL DEFAULT 'sync',
  ADD COLUMN IF NOT EXISTS last_user TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 5. Pedidos y modelos usados por rutas y servicios del backend
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  table_number TEXT NOT NULL DEFAULT '',
  items_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  amount_in_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_in_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'UYU',
  status TEXT NOT NULL DEFAULT 'pending',
  customer_name TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  notes TEXT,
  is_group_order BOOLEAN NOT NULL DEFAULT false,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  group_session_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS restaurant_id TEXT,
  ADD COLUMN IF NOT EXISTS table_number TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS items_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_in_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UYU',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS is_group_order BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS group_session_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.reviews (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  user_id TEXT,
  restaurant_name TEXT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  author_photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderated_at TIMESTAMPTZ
);

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS restaurant_id TEXT,
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS restaurant_name TEXT,
  ADD COLUMN IF NOT EXISTS rating SMALLINT,
  ADD COLUMN IF NOT EXISTS comment TEXT,
  ADD COLUMN IF NOT EXISTS author_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.customer_feedback (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT 'Anónimo',
  customer_contact TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customer_feedback
  ADD COLUMN IF NOT EXISTS restaurant_id TEXT,
  ADD COLUMN IF NOT EXISTS rating SMALLINT,
  ADD COLUMN IF NOT EXISTS comment TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT 'Anónimo',
  ADD COLUMN IF NOT EXISTS customer_contact TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS request_id TEXT NOT NULL DEFAULT 'untracked',
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS entity TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  restaurant_id TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS restaurant_id TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS keys JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.telemetry_events (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  dish_id TEXT,
  branch_id TEXT,
  event_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telemetry_events
  ADD COLUMN IF NOT EXISTS restaurant_id TEXT,
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS dish_id TEXT,
  ADD COLUMN IF NOT EXISTS branch_id TEXT,
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_orders_restaurant_created
  ON public.orders (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON public.reviews (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_created
  ON public.reviews (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_feedback_restaurant_created
  ON public.customer_feedback (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON public.audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_restaurant
  ON public.push_subscriptions (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_restaurant_created
  ON public.telemetry_events (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_event_id
  ON public.telemetry_events (event_id) WHERE event_id IS NOT NULL;

-- 6. Align idempotency on the existing webhooks table name
ALTER TABLE public.webhooks
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhooks_provider_event_unique
  ON public.webhooks (provider, event_id);

-- Migrate idempotency rows written by older releases under processed_webhooks.
DO $$
BEGIN
  IF to_regclass('public.processed_webhooks') IS NOT NULL THEN
    EXECUTE $migrate$
      INSERT INTO public.webhooks (provider, event_id, event_type, received_at, data)
      SELECT provider, event_id, 'idempotent_operation', COALESCE(processed_at, NOW()), '{}'::jsonb
      FROM public.processed_webhooks
      ON CONFLICT (provider, event_id) DO NOTHING
    $migrate$;
  END IF;
END $$;

-- 7. Deny direct client access; the API uses the server-only service role.
-- Replace only the legacy globally permissive policies known to this project.
DROP POLICY IF EXISTS "Menús públicos legibles por comensales" ON public.restaurants;
DROP POLICY IF EXISTS "Carritos grupales accesibles por mesa" ON public.group_carts;

DO $$
BEGIN
  IF to_regclass('public.processed_webhooks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.processed_webhooks ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.processed_webhooks FORCE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.processed_webhooks FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL PRIVILEGES ON TABLE public.processed_webhooks TO service_role';
  END IF;
END $$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.group_carts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_feedback FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_events FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.users, public.restaurants, public.webhooks,
  public.group_carts, public.orders, public.reviews, public.customer_feedback,
  public.audit_logs, public.push_subscriptions, public.telemetry_events
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.users, public.restaurants, public.webhooks,
  public.group_carts, public.orders, public.reviews, public.customer_feedback,
  public.audit_logs, public.push_subscriptions, public.telemetry_events
  TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Notificar éxito en Supabase
COMMENT ON TABLE public.restaurants IS 'Tabla maestra de restaurantes, platos y suscripciones para Menú Pizarrón SaaS';
COMMENT ON TABLE public.group_carts IS 'Carritos grupales en tiempo real para pedidos por mesa';
COMMENT ON TABLE public.webhooks IS 'Eventos de pago e idempotencia; nombre canónico usado por el backend';
