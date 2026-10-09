# ADR 0001: Persistencia dual JSON + Supabase

- Fecha: 2026-02-10
- Estado: Aceptado

## Contexto

El SaaS debe funcionar en local sin infraestructura y en Vercel
(serverless, filesystem efímero) con PostgreSQL en la nube.

## Decisión

JSON en `data/` como cache/fallback y Supabase como fuente cloud:
al arrancar, `db.ready` hidrata el snapshot local; en runtime las
escrituras se replican a Supabase. El backend usa service-role y
el RLS deniega el acceso directo a los roles cliente (`anon`/`authenticated`).

## Consecuencias

- Local funciona sin `.env`; Vercel falla cerrado sin service key válida.
- En Vercel el fallback JSON vive en `/tmp` (efímero, solo degraded mode).
- RLS es defensa en profundidad: toda la seguridad real está en `/api/*`.
