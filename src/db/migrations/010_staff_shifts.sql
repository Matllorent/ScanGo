-- ─────────────────────────────────────────────────────────────────────────────
-- 010_staff_shifts.sql — Sistema de Mozos y Cocina (Fase 1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Crea la fundación server-side del equipo operativo del local:
--
--   staff           → personas del equipo (mozo / cocina) con una credencial
--                     de enrolamiento hasheada (HMAC-SHA256; el secreto vive
--                     SOLO en el QR de turno, nunca en la base).
--   staff_sessions  → sesiones de turno opacas (token hasheado), revocables,
--                     con expiración absoluta. Una sesión no es un JWT del
--                     dueño: muere al terminar el turno, al rotar el QR o al
--                     desactivar a la persona.
--
-- Además suma a `orders` la trazabilidad de quién tomó el pedido y desde qué
-- mesa (para el comandero de fases siguientes) y a `push_subscriptions` /
-- `notification_events` el enrutamiento por persona del equipo.
--
-- Idempotente: se puede correr dos veces sin error. RLS FORCE + grants solo
-- service_role: el navegador NUNCA lee estas tablas directo.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Personas del equipo ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'waiter' CHECK (role IN ('waiter', 'kitchen')),
  active BOOLEAN NOT NULL DEFAULT true,
  credential_hash TEXT NOT NULL,
  credential_updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_staff_restaurant_active
  ON public.staff (restaurant_id, active);

-- 2. Sesiones de turno ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_sessions (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff_active
  ON public.staff_sessions (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_restaurant_active
  ON public.staff_sessions (restaurant_id, created_at DESC);

-- 3. Trazabilidad del pedido (comandero / mesa) ─────────────────────────────
ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS waiter_id TEXT;
ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS table_id TEXT;
ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'customer';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'source'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_source_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_source_check
      CHECK (source IN ('customer', 'staff', 'kiosk'));
  END IF;
END $$;

-- 4. Push dirigido a una persona del equipo ─────────────────────────────────
ALTER TABLE IF EXISTS public.push_subscriptions
  ADD COLUMN IF NOT EXISTS staff_id TEXT;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_staff
  ON public.push_subscriptions (staff_id);

ALTER TABLE IF EXISTS public.notification_events
  ADD COLUMN IF NOT EXISTS target_staff_id TEXT;
CREATE INDEX IF NOT EXISTS idx_notification_events_target_staff
  ON public.notification_events (target_staff_id);

-- 5. RLS FORCE + grants solo service_role ───────────────────────────────────
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff FROM anon, authenticated;
GRANT ALL ON public.staff TO service_role;

ALTER TABLE public.staff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_sessions FROM anon, authenticated;
GRANT ALL ON public.staff_sessions TO service_role;
