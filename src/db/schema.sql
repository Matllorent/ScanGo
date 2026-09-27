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
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

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
  logo_url TEXT,
  business_type TEXT NOT NULL DEFAULT 'restaurant',
  wifi JSONB DEFAULT '{"ssid": "", "password": ""}'::jsonb,
  categories JSONB DEFAULT '[]'::jsonb,
  dishes JSONB DEFAULT '[]'::jsonb,
  modifier_groups JSONB DEFAULT '[]'::jsonb,
  delivery_zones JSONB DEFAULT '[]'::jsonb,
  subscription JSONB DEFAULT '{"status": "trialing", "plan": "pro_monthly"}'::jsonb,
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

-- 5. Habilitar Row Level Security (RLS) para proteger los datos
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_carts ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura pública para el menú (solo lectura por slug)
CREATE POLICY "Menús públicos legibles por comensales" ON public.restaurants
  FOR SELECT USING (true);

-- Políticas para carritos grupales (acceso público para comensales de la mesa)
CREATE POLICY "Carritos grupales accesibles por mesa" ON public.group_carts
  FOR ALL USING (true) WITH CHECK (true);

-- Notificar éxito en Supabase
COMMENT ON TABLE public.restaurants IS 'Tabla maestra de restaurantes, platos y suscripciones para Menú Pizarrón SaaS';
COMMENT ON TABLE public.group_carts IS 'Carritos grupales en tiempo real para pedidos por mesa';
