-- ============================================================================
-- MIGRACIÓN 012 — WINBACK v3: CLAIM / RELEASE / REVOKE ATÓMICO DE CUPONES
--
-- El claim del cupón de recupero (F8-v2) era provisional: solo escribía el
-- ledger LOCAL de la réplica y el marcador `wbu_` era del uso FINAL — dos
-- réplicas de Vercel podían reclamar el MISMO código en el mismo instante y
-- ambas órdenes salían con descuento (race cross-réplica deliberado de v1,
-- documentado en la 61ª suite). Peor: la lectura del espejo cloud
-- (mirrorCouponList) consultaba columnas INEXISTENTES (`response` /
-- `created_at` — la tabla usa `data` / `received_at`), el error se tragaba
-- con `return []` y la lectura cross-réplica estaba MUERTA en silencio.
--
-- Tres funciones atómicas sobre la MISMA fila espejo (provider
-- 'winback_coupon', event_id 'wb_<couponId>', el cupón completo en
-- `data->'coupon'` — UPSERT in-place por UNIQUE (provider, event_id), así
-- que cada cambio de estado REEMPLAZA la fila y `received_at` refresca):
--
--   claim_recovery_coupon   — veredictos → UPDATE condicional (usedAt/usedByPhone).
--                             El row-lock de Postgres re-evalúa el WHERE contra
--                             la versión ACTUAL de la fila: el perdedor de la
--                             carrera ve 0 filas → re-clasifica → ALREADY_USED.
--   release_recovery_coupon — CAS por `usedAt` exacto + guard FINALIZED (el
--                             marcador `wbu_` del uso final). Un fallo de
--                             infraestructura tras el claim NO quema el cupón,
--                             pero tampoco deshace un uso ya concreto.
--   revoke_recovery_coupon  — solo cupones VIVOS: el dueño baja el código
--                             (fuga, error del staff) y el comensal ve
--                             REVOKED en vez de poder usarlo.
--
-- El reloj llega como parámetro (`p_now_iso`, `nowMs` inyectable de la casa):
-- las decisiones son deterministas y testeables, y la revisión del estado tras
-- un UPDATE de 0 filas no puede variar por el paso del tiempo.
--
-- Idempotencia: aplicar 0+ veces es seguro (CREATE OR REPLACE). El claim de un
-- cupón ya reclamado devuelve la MISMA fila con usedAt (sin doble escritura).
--
-- Aplicación: SQL Editor del dashboard de Supabase (proyecto olqdcudvstbawkcvsfdd).
-- Verificación:
--   SELECT claim_recovery_coupon('ghost', 'VOL-TEST1', '', '', now()::text);
--   → {"ok": false, "reason": "NOT_FOUND"}   (aplicada)
--   → error 42883/404 (PGRST202)             (sin aplicar)
-- ============================================================================

-- ── 1. claim_recovery_coupon ────────────────────────────────────────────────
-- Devuelve SIEMPRE jsonb:
--   {"ok": true,  "coupon": <fila>}                        — claim tomado
--   {"ok": false, "reason": "NOT_FOUND" | "ALREADY_USED" |
--              "REVOKED" | "EXPIRED" | "NOT_FOR_THIS_PHONE" |
--              "MALFORMED" | "INVALID_INPUT"}              — sin claim
-- La verificación de teléfono replica EXACTAMENTE normalizePhoneDigits del
-- módulo puro (digits, strip '+', strip '00' inicial): «+598 99 123 456» y
-- «0059899123456» son el mismo número. Un cupón SIN boundPhone o un comensal
-- sin teléfono pasan (misma semántica v1: posesión del código + un solo uso).
CREATE OR REPLACE FUNCTION public.claim_recovery_coupon(
  p_restaurant_id  text,
  p_code           text,
  p_phone_digits   text,
  p_used_by_phone  text,
  p_now_iso        text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id   bigint;
  v_coupon   jsonb;
  v_new      jsonb;
  v_bound    text;
  v_updated  integer;
  v_attempts integer := 0;
BEGIN
  IF p_restaurant_id IS NULL OR length(trim(coalesce(p_restaurant_id, ''))) = 0
     OR p_code IS NULL OR length(trim(coalesce(p_code, ''))) = 0
     OR p_now_iso IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT');
  END IF;

  LOOP
    v_attempts := v_attempts + 1;

    SELECT id, data->'coupon' INTO v_row_id, v_coupon
    FROM webhooks
    WHERE provider = 'winback_coupon'
      AND data->'coupon'->>'restaurantId' = p_restaurant_id
      AND upper(data->'coupon'->>'code') = upper(p_code)
    ORDER BY received_at DESC
    LIMIT 1;

    IF v_coupon IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
    END IF;

    -- Veredictos en el MISMO orden del módulo puro (revocación del dueño
    -- GANA SIEMPRE; usado; vencido; teléfono).
    IF coalesce(v_coupon->>'revokedAt', '') <> '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'REVOKED');
    END IF;
    IF coalesce(v_coupon->>'usedAt', '') <> '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
    END IF;
    IF v_coupon->>'expiresAt' IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'MALFORMED');
    END IF;
    IF (v_coupon->>'expiresAt')::timestamptz <= p_now_iso::timestamptz THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'EXPIRED');
    END IF;
    IF coalesce(v_coupon->>'boundPhone', '') <> '' AND coalesce(p_phone_digits, '') <> '' THEN
      v_bound := regexp_replace(v_coupon->>'boundPhone', '[^0-9+]', '', 'g');
      IF v_bound LIKE '+%' THEN v_bound := substr(v_bound, 2); END IF;
      IF v_bound LIKE '00%' THEN v_bound := substr(v_bound, 3); END IF;
      IF v_bound <> p_phone_digits THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOR_THIS_PHONE');
      END IF;
    END IF;

    v_new := v_coupon || jsonb_build_object(
      'usedAt',      p_now_iso,
      'usedByPhone', p_used_by_phone,
      'stateAt',     p_now_iso
    );

    UPDATE webhooks
    SET data = jsonb_set(data, '{coupon}', v_new)
    WHERE id = v_row_id
      AND provider = 'winback_coupon'
      AND coalesce(data->'coupon'->>'usedAt', '') = ''
      AND coalesce(data->'coupon'->>'revokedAt', '') = '';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      RETURN jsonb_build_object('ok', true, 'coupon', v_new);
    END IF;

    -- 0 filas: la fila cambió bajo nosotros (otra réplica reclamó/revocó, o el
    -- espejo UPSERTEÓ la misma event_id). Re-clasificamos contra el estado
    -- fresco; con p_now_iso fijo la expiración NO puede cruzar entre intentos.
    IF v_attempts >= 2 THEN
      SELECT id, data->'coupon' INTO v_row_id, v_coupon
      FROM webhooks
      WHERE provider = 'winback_coupon'
        AND data->'coupon'->>'restaurantId' = p_restaurant_id
        AND upper(data->'coupon'->>'code') = upper(p_code)
      ORDER BY received_at DESC
      LIMIT 1;
      IF v_coupon IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
      END IF;
      IF coalesce(v_coupon->>'revokedAt', '') <> '' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'REVOKED');
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
    END IF;
  END LOOP;
END;
$$;

-- ── 2. release_recovery_coupon ──────────────────────────────────────────────
-- Suelta un claim PROVISIONAL (el pedido falló ANTES de existir). CAS por el
-- `usedAt` exacto del claim (solo quien lo reclamó puede soltarlo) + guard
-- FINALIZED: si el marcador `wbu_` existe (el pedido SÍ existió en otra
-- réplica), el uso ya concreto NO se deshace.
--   {"ok": true,  "coupon": <fila>}                          — soltado
--   {"ok": true,  "already": true}                           — ya estaba libre (idempotente)
--   {"ok": false, "reason": "NOT_FOUND" | "FINALIZED" | "NOT_CLAIMED" | "INVALID_INPUT"}
CREATE OR REPLACE FUNCTION public.release_recovery_coupon(
  p_restaurant_id text,
  p_code          text,
  p_used_at       text,
  p_now_iso       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id  bigint;
  v_coupon  jsonb;
  v_clean   jsonb;
  v_updated integer;
BEGIN
  IF p_restaurant_id IS NULL OR length(trim(coalesce(p_restaurant_id, ''))) = 0
     OR p_code IS NULL OR length(trim(coalesce(p_code, ''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT');
  END IF;

  SELECT id, data->'coupon' INTO v_row_id, v_coupon
  FROM webhooks
  WHERE provider = 'winback_coupon'
    AND data->'coupon'->>'restaurantId' = p_restaurant_id
    AND upper(data->'coupon'->>'code') = upper(p_code)
  ORDER BY received_at DESC
  LIMIT 1;

  IF v_coupon IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  -- Guard FINALIZED: el uso final (pedido real) ya se concretó en CUALQUIER
  -- réplica → el release no puede reabrir el cupón.
  IF EXISTS (
    SELECT 1 FROM webhooks
    WHERE provider = 'winback_used'
      AND event_id = 'wbu_' || (v_coupon->>'id')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FINALIZED');
  END IF;

  IF coalesce(v_coupon->>'usedAt', '') IS NULL OR coalesce(v_coupon->>'usedAt', '') = '' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  IF p_used_at IS NULL OR v_coupon->>'usedAt' <> p_used_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMED');
  END IF;

  v_clean := v_coupon || jsonb_build_object(
    'usedAt',      NULL::text,
    'usedByPhone', NULL::text,
    'usedOrderId', NULL::text,
    'stateAt',     coalesce(p_now_iso, to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  );

  UPDATE webhooks
  SET data = jsonb_set(data, '{coupon}', v_clean)
  WHERE id = v_row_id
    AND provider = 'winback_coupon'
    AND data->'coupon'->>'usedAt' = p_used_at;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    RETURN jsonb_build_object('ok', true, 'coupon', v_clean);
  END IF;
  -- La fila cambió bajo nosotros (mirror upsert): re-clasificar contra el
  -- estado fresco — finalizado no se deshace; ya libre es idempotente; con
  -- otro claim ajeno NO soltamos (NOT_CLAIMED).
  SELECT data->'coupon' INTO v_coupon
  FROM webhooks
  WHERE provider = 'winback_coupon'
    AND data->'coupon'->>'restaurantId' = p_restaurant_id
    AND upper(data->'coupon'->>'code') = upper(p_code)
  ORDER BY received_at DESC
  LIMIT 1;
  IF v_coupon IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  IF EXISTS (
    SELECT 1 FROM webhooks
    WHERE provider = 'winback_used'
      AND event_id = 'wbu_' || (v_coupon->>'id')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FINALIZED');
  END IF;
  IF coalesce(v_coupon->>'usedAt', '') = '' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMED');
END;
$$;

-- ── 3. revoke_recovery_coupon ───────────────────────────────────────────────
-- El dueño baja un cupón VIVO (fuga del código, error del staff). Solo tiene
-- sentido sobre cupones vivos: usado → ALREADY_USED (el uso ya concreto no se
-- revoca), ya revocado → ALREADY_REVOKED, vencido → EXPIRED (ya está muerto,
-- nada que revocar). El comensal ve REVOKED (copy propia) en validate y el
-- checkout rechaza con 422 COUPON_REVOKED.
--   {"ok": true,  "coupon": <fila>}                          — revocado
--   {"ok": false, "reason": "NOT_FOUND" | "ALREADY_USED" |
--              "ALREADY_REVOKED" | "EXPIRED" | "MALFORMED" | "INVALID_INPUT"}
CREATE OR REPLACE FUNCTION public.revoke_recovery_coupon(
  p_restaurant_id text,
  p_code          text,
  p_now_iso       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id   bigint;
  v_coupon   jsonb;
  v_new      jsonb;
  v_updated  integer;
  v_attempts integer := 0;
BEGIN
  IF p_restaurant_id IS NULL OR length(trim(coalesce(p_restaurant_id, ''))) = 0
     OR p_code IS NULL OR length(trim(coalesce(p_code, ''))) = 0
     OR p_now_iso IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT');
  END IF;

  LOOP
    v_attempts := v_attempts + 1;

    SELECT id, data->'coupon' INTO v_row_id, v_coupon
    FROM webhooks
    WHERE provider = 'winback_coupon'
      AND data->'coupon'->>'restaurantId' = p_restaurant_id
      AND upper(data->'coupon'->>'code') = upper(p_code)
    ORDER BY received_at DESC
    LIMIT 1;

    IF v_coupon IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
    END IF;

    IF coalesce(v_coupon->>'usedAt', '') <> '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
    END IF;
    IF coalesce(v_coupon->>'revokedAt', '') <> '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_REVOKED');
    END IF;
    IF v_coupon->>'expiresAt' IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'MALFORMED');
    END IF;
    IF (v_coupon->>'expiresAt')::timestamptz <= p_now_iso::timestamptz THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'EXPIRED');
    END IF;

    v_new := v_coupon || jsonb_build_object('revokedAt', p_now_iso, 'stateAt', p_now_iso);

    UPDATE webhooks
    SET data = jsonb_set(data, '{coupon}', v_new)
    WHERE id = v_row_id
      AND provider = 'winback_coupon'
      AND coalesce(data->'coupon'->>'usedAt', '') = ''
      AND coalesce(data->'coupon'->>'revokedAt', '') = '';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      RETURN jsonb_build_object('ok', true, 'coupon', v_new);
    END IF;

    IF v_attempts >= 2 THEN
      SELECT data->'coupon' INTO v_coupon
      FROM webhooks
      WHERE provider = 'winback_coupon'
        AND data->'coupon'->>'restaurantId' = p_restaurant_id
        AND upper(data->'coupon'->>'code') = upper(p_code)
      ORDER BY received_at DESC
      LIMIT 1;
      IF v_coupon IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
      END IF;
      IF coalesce(v_coupon->>'usedAt', '') <> '' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
      END IF;
      IF coalesce(v_coupon->>'revokedAt', '') <> '' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_REVOKED');
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'EXPIRED');
    END IF;
  END LOOP;
END;
$$;

-- Solo el backend (service_role) ejecuta: los roles cliente NUNCA tocan el
-- ledger de cupones (misma política que claim_reservation_slot de la 011).
REVOKE ALL ON FUNCTION public.claim_recovery_coupon(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_recovery_coupon(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_recovery_coupon(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recovery_coupon(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_recovery_coupon(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_recovery_coupon(text, text, text) TO service_role;

COMMENT ON FUNCTION public.claim_recovery_coupon(text, text, text, text, text)
  IS 'Winback v3 (012): claim atomico de cupon de recupero — veredictos + UPDATE condicional (row lock re-evalua WHERE). Cross-replica: el perdedor de la carrera ve ALREADY_USED.';
COMMENT ON FUNCTION public.release_recovery_coupon(text, text, text, text)
  IS 'Winback v3 (012): release de claim provisional — CAS por usedAt + guard FINALIZED (marcador wbu_). Un fallo de infra no quema el cupon y un uso concreto no se deshace.';
COMMENT ON FUNCTION public.revoke_recovery_coupon(text, text, text)
  IS 'Winback v3 (012): revocacion de cupon vivo por el dueno — solo vivos; usado/revocado/vencido son 409/409/422.';
