-- ============================================================================
-- MIGRACIÓN 011 — RESERVAS v2: ALTA ATÓMICA CON CAPACIDAD (anti overbooking)
--
-- La alta de reservas tenía un race (deliberate skip de v1, documentado en
-- api/utils/reservations.js): `assertSlotAvailable` se evaluaba en el ROUTE
-- (fuera del mutex) contra una foto del doc — dos POST para la MISMA franja
-- en el mismo instante (misma o distinta réplica de Vercel) podían pasar
-- ambos la capacidad y sobrecargarla.
--
-- `claim_reservation_slot` cierra el race en la nube en UNA transacción:
--   1. Advisory lock transaccional por (restaurante, fecha): serializa los
--      claims concurrentes del MISMO día sin bloquear a otros locales/días.
--   2. La capacidad se re-cuenta contra el DOC ACTUAL (restaurant.profile ->
--      'reservations') — la fuente de verdad, no una foto del route.
--   3. Si hay lugar, la reserva se AGREGA al array en la MISMA sentencia
--      (jsonb_set) — sin tabla contador, sin releases, sin drift posible:
--      el doc y la autorización nunca pueden divergir.
--
--   claim_reservation_slot(p_restaurant_id TEXT, p_reservation JSONB,
--                          p_max_per_slot INT, p_buffer_minutes INT,
--                          p_max_reservations INT) → jsonb
--     {ok:true, reservation, already:false}      (alta tomada)
--     {ok:true, reservation, already:true}       (retry idempotente, mismo id)
--     {ok:false, reason:'SLOT_FULL'|'BUFFER_TOO_CLOSE'}   (409 público único)
--     {ok:false, reason:'NOT_FOUND'|'INVALID_RESERVATION'|'INVALID_TIME'}
--       → el backend los trata como "cloud no disponible" y cae al path
--         local con re-chequeo dentro del mutex (degradación honesta).
--
-- Idempotente: CREATE OR REPLACE (podés ejecutarla varias veces).
-- Aplicar en el SQL Editor de Supabase (después de 001–010), o con
-- Management API:
--   curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "{\"query\": \"$(cat src/db/migrations/011_reservation_claim_rpc.sql)\"}"
--
-- Residual documentado: un PATCH de transición (path whole-doc, no RPC)
-- concurrente con un claim puede pisar el append en la nube (el espejo local
-- lo restaura en el próximo dual-write — misma clase de carrera pre-existente
-- de las escrituras whole-doc; el claim-vs-claim sí queda cerrado).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_reservation_slot(
  p_restaurant_id TEXT,
  p_reservation JSONB,
  p_max_per_slot INTEGER,
  p_buffer_minutes INTEGER,
  p_max_reservations INTEGER
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.restaurants%ROWTYPE;
  v_list JSONB;
  v_item JSONB;
  v_new_list JSONB;
  v_start_min INTEGER;
  v_other_min INTEGER;
  v_active_same_time INTEGER := 0;
  v_drop_idx INTEGER;
  v_i INTEGER;
BEGIN
  -- Forma mínima de la reserva: id + date + time (el route ya validó el resto;
  -- la RPC es la última palabra de capacidad, no del parseo).
  IF p_reservation IS NULL
     OR p_reservation->>'id' IS NULL
     OR p_reservation->>'date' IS NULL
     OR p_reservation->>'time' IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_RESERVATION');
  END IF;

  -- HH:MM 24h → minutos (misma forma que el módulo puro).
  IF p_reservation->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_TIME');
  END IF;
  v_start_min := (split_part(p_reservation->>'time', ':', 1)::int * 60)
               + split_part(p_reservation->>'time', ':', 2)::int;

  -- Serializa los claims del MISMO local+fecha (el resto del mundo no se
  -- entera: la key es restaurante|fecha, no restaurante a secas).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_restaurant_id || '|' || (p_reservation->>'date'), 0)
  );

  SELECT * INTO v_doc FROM public.restaurants WHERE id = p_restaurant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  v_list := COALESCE(v_doc.profile -> 'reservations', '[]'::jsonb);

  -- Idempotencia: un retry del route con el MISMO id no doble-agrega.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_list) AS e(x)
    WHERE e.x->>'id' = p_reservation->>'id'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'reservation', p_reservation);
  END IF;

  -- Capacidad contra el doc ACTUAL: solo reservas ACTIVAS del mismo día
  -- (requested/confirmed); cancelada/no_show/seated liberan (igual que el
  -- módulo puro). Fila sin hora legible no bloquea (fail-open).
  FOR v_item IN SELECT x FROM jsonb_array_elements(v_list) AS t(x) LOOP
    IF v_item->>'date' <> (p_reservation->>'date') THEN CONTINUE; END IF;
    IF NOT (v_item->>'status' IN ('requested', 'confirmed')) THEN CONTINUE; END IF;
    IF (v_item->>'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN CONTINUE; END IF;
    v_other_min := (split_part(v_item->>'time', ':', 1)::int * 60)
                 + split_part(v_item->>'time', ':', 2)::int;
    IF v_other_min = v_start_min THEN
      v_active_same_time := v_active_same_time + 1;
    ELSIF abs(v_other_min - v_start_min) < COALESCE(p_buffer_minutes, 0) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'BUFFER_TOO_CLOSE');
    END IF;
  END LOOP;

  IF v_active_same_time >= COALESCE(p_max_per_slot, 4) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SLOT_FULL');
  END IF;

  -- Trim (mismas reglas que trimReservationsList: primero las terminales más
  -- viejas — el orden del array es el de inserción —, después las más viejas
  -- que queden). Solo corre cuando se llega a la cota.
  v_new_list := v_list;
  IF p_max_reservations IS NOT NULL AND jsonb_array_length(v_new_list) >= p_max_reservations THEN
    WHILE jsonb_array_length(v_new_list) >= p_max_reservations LOOP
      v_drop_idx := 0; -- fallback: la más vieja
      v_i := 0;
      FOR v_item IN SELECT x FROM jsonb_array_elements(v_new_list) AS t(x) LOOP
        IF v_item->>'status' IN ('cancelled', 'no_show') THEN
          v_drop_idx := v_i;
          EXIT;
        END IF;
        v_i := v_i + 1;
      END LOOP;
      v_new_list := v_new_list - v_drop_idx;
    END LOOP;
  END IF;
  v_new_list := v_new_list || p_reservation;

  -- Alta en UNA sentencia: la expresión lee el profile ACTUAL de la fila (con
  -- su lock de fila), no el snapshot del SELECT de arriba — un PATCH que
  -- committeó entre medio no se deshace.
  UPDATE public.restaurants
  SET profile = jsonb_set(
        COALESCE(profile, '{}'::jsonb),
        '{reservations}',
        v_new_list
      ),
      updated_at = now()
  WHERE id = p_restaurant_id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'reservation', p_reservation);
END;
$$;

-- Solo el backend (service_role) reclama franjas; el navegador nunca toca
-- la capacidad directo (coherente con el modelo de seguridad de 001/003/006).
REVOKE ALL ON FUNCTION public.claim_reservation_slot(TEXT, JSONB, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reservation_slot(TEXT, JSONB, INTEGER, INTEGER, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.claim_reservation_slot(TEXT, JSONB, INTEGER, INTEGER, INTEGER) IS
  'Reservas v2: alta atómica con capacidad — advisory lock por restaurante+fecha, re-cuenta reservas activas del doc ACTUAL y agrega la reserva en la misma sentencia (jsonb_set). SIN counter table: el doc es la única fuente. NOT_FOUND/INVALID_* = degradar al path local.';
