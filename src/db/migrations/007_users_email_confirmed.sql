-- ============================================================================
-- MIGRACIÓN 007 — COLUMNA users.email_confirmed_at (dual-write roto)
--
-- El proyecto cloud se creó con un schema anterior a schema.sql: la tabla
-- `users` NO tiene `email_confirmed_at`, así que CADA insert de usuario falla
-- con PGRST204 ("Could not find the 'email_confirmed_at' column") y NINGÚN
-- usuario llega a la nube (el silenciador lo ocultaba; ver drill
-- tests/test-restore-drill.js). Las tablas `users`/`restaurants` cloud están
-- VACÍAS aunque el local tenga cientos de filas.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS (podés ejecutarla varias veces).
-- Aplicar en el SQL Editor de Supabase (después de 001–006), o con
-- Management API + SUPABASE_ACCESS_TOKEN. Verificar con `npm run db:check`.
-- Hasta aplicarla, el código reintenta los inserts SIN la columna
-- (db.insertTolerant) para no perder escrituras.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ;
