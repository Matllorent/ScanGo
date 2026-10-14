-- ============================================================================
-- MIGRACIÓN 008 — COLUMNAS FALTANTES DE restaurants (+ users.updated_at)
--
-- El drill + el pentest revelaron que la tabla cloud `restaurants` es anterior
-- a varios ALTER de schema.sql: los upserts fallaban con PGRST204 y el writer
-- tolerante quitaba `profile`, `modifier_groups` y `smart_weather_enabled`
-- (y potencialmente más). Sin `profile`, la hidratación cloud→local es
-- LOSSY (solo sobreviven las columnas top-level, no el JSON completo).
--
-- Este archivo aplica TODOS los ALTER de schema.sql para restaurants + el
-- `updated_at` de users que la 007 no cubría. Idempotente: todo es
-- ADD COLUMN IF NOT EXISTS (ejecutable varias veces sin daño).
-- Aplicar en el SQL Editor de Supabase (después de 001–007), o con
-- Management API + SUPABASE_ACCESS_TOKEN. Verificar con `npm run db:check`.
-- Hasta aplicarla, `cloudWriteTolerant` mantiene las escrituras a salvo.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

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

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS branches JSONB DEFAULT '[]'::jsonb;
