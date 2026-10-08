-- ============================================================================
-- MIGRACIÓN 003 — FIDELIZACIÓN DUAL (LOCAL + RED SaaS) Y CENTRO DE
-- NOTIFICACIONES DEL DUEÑO
--
-- Crea las tablas que sostienen el bloque "Fidelización Dual" y el inbox de
-- notificaciones del dueño:
--   customer_profiles     → identidad unificada del comensal (teléfono E.164
--                           normalizado como clave, privacy-first: consent
--                           explícito, log de datos enmascarado, borrado total).
--   loyalty_accounts      → estado por (comensal, restaurante): puntos, sellos,
--                           visitas (fidelización LOCAL).
--   loyalty_ledger        → auditoría de cada movimiento de puntos (local y global).
--   loyalty_redemptions   → códigos de canje de un solo uso emitidos por el server.
--   notification_events   → persistencia del aviso de mozo / eventos para el
--                           inbox del dueño (consume el push que hoy es efímero).
--
-- También agrega a push_subscriptions las columnas `role` (owner|guest) y
-- `consent_marketing` (opt-in explícito del comensal para promos): el aviso de
-- mozo va SOLO al dueño y las promos SOLO a clients suscriptos con consentimiento.
--
-- Idempotente: podés ejecutarla varias veces (CREATE/ADD/INDEX IF NOT EXISTS).
-- Aplicar en el SQL Editor de Supabase (después de 001 y 002), o con Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/olqdcudvstbawkcvsfdd/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/003_loyalty_notifications.sql)\"}"
--
-- Modelo de seguridad idéntico a 001: RLS habilitada + FORZADA (ni siquiera el
-- owner toca las tablas directo) y únicos privilegios para el service_role, que
-- media toda escritura/lectura desde el backend. Los datos personales (teléfono
-- del cliente) NUNCA son accesibles desde el navegador vía PostgREST.
-- ============================================================================

-- 1. Perfiles de cliente (identidad unificada de la red)
CREATE TABLE IF NOT EXISTS public.customer_profiles (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  phone_hash TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  consent_push BOOLEAN NOT NULL DEFAULT false,
  consent_marketing BOOLEAN NOT NULL DEFAULT false,
  global_visits INTEGER NOT NULL DEFAULT 0,
  global_points INTEGER NOT NULL DEFAULT 0,
  restaurants_visited INTEGER NOT NULL DEFAULT 0,
  level_id TEXT NOT NULL DEFAULT 'bronce',
  badges JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT uq_customer_profiles_phone UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_phone_hash
  ON public.customer_profiles (phone_hash);

-- 2. Cuentas de fidelización por (comensal, restaurante)
CREATE TABLE IF NOT EXISTS public.loyalty_accounts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  stamps INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  level_id TEXT NOT NULL DEFAULT 'bronce',
  last_visit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT uq_loyalty_accounts_customer_restaurant UNIQUE (customer_id, restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_restaurant
  ON public.loyalty_accounts (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_customer
  ON public.loyalty_accounts (customer_id);

-- 3. Ledger de puntos (auditoría, append-only)
CREATE TABLE IF NOT EXISTS public.loyalty_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  restaurant_id TEXT,
  kind TEXT NOT NULL DEFAULT 'adjust',
  points_delta INTEGER NOT NULL DEFAULT 0,
  stamps_delta INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  ref_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_customer_created
  ON public.loyalty_ledger (customer_id, created_at DESC);

-- 4. Canjes (códigos de un solo uso) — restaurant_id NULL = beneficio global de la red
CREATE TABLE IF NOT EXISTS public.loyalty_redemptions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  restaurant_id TEXT,
  reward_id TEXT NOT NULL,
  reward_title TEXT NOT NULL DEFAULT '',
  reward_value TEXT NOT NULL DEFAULT '',
  points_cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'issued'
    CONSTRAINT ck_loyalty_redemptions_status CHECK (status IN ('issued', 'redeemed', 'expired')),
  redeemed_at TIMESTAMPTZ,
  redeemed_by_restaurant_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  CONSTRAINT uq_loyalty_redemptions_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_customer
  ON public.loyalty_redemptions (customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_status
  ON public.loyalty_redemptions (status) WHERE status = 'issued';

-- 5. Centro de notificaciones del dueño (persistencia del push efímero)
CREATE TABLE IF NOT EXISTS public.notification_events (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  branch_id TEXT,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_notification_events_restaurant_created
  ON public.notification_events (restaurant_id, created_at DESC);

-- 6. push_subscriptions: rol del suscriptor + consentimiento de marketing
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS consent_marketing BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_role
  ON public.push_subscriptions (role) WHERE role = 'guest';

-- ============================================================================
-- SEGURIDAD: RLS forzada + solo service_role (coherente con 001/002)
-- ============================================================================
ALTER TABLE public.customer_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_ledger       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_redemptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_profiles    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_accounts     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_ledger       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_redemptions  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events  FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.customer_profiles, public.loyalty_accounts,
  public.loyalty_ledger, public.loyalty_redemptions, public.notification_events
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.customer_profiles, public.loyalty_accounts,
  public.loyalty_ledger, public.loyalty_redemptions, public.notification_events
  TO service_role;

COMMENT ON TABLE public.customer_profiles IS
  'Identidad unificada del comensal (teléfono normalizado E.164, privacy-first: consentimiento explícito y borrado total).';
COMMENT ON TABLE public.loyalty_accounts IS
  'Fidelización LOCAL: puntos, sellos y visitas por (comensal, restaurante).';
COMMENT ON TABLE public.loyalty_ledger IS
  'Auditoría append-only de movimientos de puntos (local y global de la red).';
COMMENT ON TABLE public.loyalty_redemptions IS
  'Códigos de canje de un solo uso emitidos por el backend; restaurant_id NULL = beneficio global de la red.';
COMMENT ON TABLE public.notification_events IS
  'Inbox del dueño: persistencia de avisos (mozo, pedidos, promos) que hoy solo viven en el push efímero del SO.';