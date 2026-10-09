-- ============================================================================
-- MIGRACIÓN 006 — CANJE ATÓMICO DE FIDELIZACIÓN (anti doble-canje)
--
-- El canje de códigos LOY-XXXX-XXXX tenía un race: `validateRedemptionCode`
-- hacía check-then-set local + upsert cloud fire-and-forget, así que dos
-- validates concurrentes del mismo código podían canjear doble.
--
-- Esta función cierra el race en la nube: el `UPDATE ... WHERE status='issued'`
-- es UNA sola sentencia atómica — el segundo validate concurrente (misma o
-- distinta instancia) encuentra `status='redeemed'` y pierde. El guard de
-- tenant va DENTRO del UPDATE: un código LOCAL de otro restaurante NO se
-- consume (devuelve OTHER → el backend responde 403 sin marcarlo).
--
--   claim_loyalty_redemption(p_code, p_restaurant_id) → jsonb
--     {ok:true, code, reward_title, points_cost, restaurant_id, redeemed_at,
--      redeemed_by_restaurant_id, customer_id, reward_id}
--     {ok:false, reason:'NOT_FOUND'|'ALREADY'|'EXPIRED'|'OTHER'}
--
-- Idempotente: CREATE OR REPLACE (podés ejecutarla varias veces).
-- Aplicar en el SQL Editor de Supabase (después de 001–005), o con
-- Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/olqdcudvstbawkcvsfdd/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/006_loyalty_claim_rpc.sql)\"}"
--
-- El backend degrada con honestidad si esta migración todavía no está aplicada:
-- `validateRedemptionCode` detecta la función ausente (PGRST202) y cae al path
-- local serializado por mutex en proceso (cubre la concurrencia intra-instancia).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_loyalty_redemption(p_code TEXT, p_restaurant_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.loyalty_redemptions%ROWTYPE;
  v_existing public.loyalty_redemptions%ROWTYPE;
BEGIN
  -- Canje atómico: solo una transacción concurrente actualiza la fila.
  -- El tenant guard (códigos locales solo los valida su emisor; los globales
  -- restaurant_id NULL los valida cualquiera) va dentro del UPDATE para no
  -- consumir códigos ajenos.
  UPDATE public.loyalty_redemptions AS lr
  SET status = 'redeemed',
      redeemed_at = now(),
      redeemed_by_restaurant_id = COALESCE(p_restaurant_id, lr.redeemed_by_restaurant_id)
  WHERE upper(lr.code) = upper(p_code)
    AND lr.status = 'issued'
    AND (lr.restaurant_id IS NULL OR p_restaurant_id IS NULL OR lr.restaurant_id = p_restaurant_id)
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', v_row.code,
      'reward_title', v_row.reward_title,
      'points_cost', v_row.points_cost,
      'restaurant_id', v_row.restaurant_id,
      'redeemed_at', v_row.redeemed_at,
      'redeemed_by_restaurant_id', v_row.redeemed_by_restaurant_id,
      'customer_id', v_row.customer_id,
      'reward_id', v_row.reward_id
    );
  END IF;

  -- No se actualizó: distinguir por qué (sin consumir nada).
  SELECT * INTO v_existing
  FROM public.loyalty_redemptions
  WHERE upper(code) = upper(p_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  IF v_existing.status = 'redeemed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY');
  END IF;
  IF v_existing.status = 'expired' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  END IF;
  IF v_existing.restaurant_id IS NOT NULL
     AND p_restaurant_id IS NOT NULL
     AND v_existing.restaurant_id <> p_restaurant_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'OTHER');
  END IF;
  -- Inalcanzable en la práctica (issued + mismo tenant siempre lo toma el
  -- UPDATE de arriba salvo race ya resuelto como ALREADY): fallback honesto.
  RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
END;
$$;

-- Solo el backend (service_role) puede canjear; el navegador nunca toca
-- los códigos directo (coherente con el modelo de seguridad de 001/003).
REVOKE ALL ON FUNCTION public.claim_loyalty_redemption(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_loyalty_redemption(TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.claim_loyalty_redemption(TEXT, TEXT) IS
  'Canje atómico de códigos LOY-XXXX-XXXX: UPDATE ... WHERE status=issued en una sola sentencia (anti doble-canje concurrente). Distingue NOT_FOUND/ALREADY/EXPIRED/OTHER sin consumir códigos ajenos.';
