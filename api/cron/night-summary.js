/**
 * GET /api/cron/night-summary
 * F1 "El Cierre" (oct-2026): el cierre de la jornada al dueño, SEMILLA DEL
 * WOW diario — como el Z-report del POS que "tiene 30 segundos y cero datos":
 * pedidos, ingresos (sin propinas), propinas aparte, ticket promedio, hora
 * pico y top 3, con CTA directo a Pedidos en vivo.
 *
 * Cron HORARIO productor + dedupe (nunca un cron por huso horario — plan §0):
 * Vercel lo llama cada hora y cada local decide con SU madrugada local via
 * `utcOffsetMinutes` (capturado en /api/studio/save, default -180 UY/AR):
 *   - Ventana: la jornada que ACABÓ (prevLocalDay_window — el Z-report real:
 *     a las 3 AM del día 25 se cierra el día 24, banda [00:00, 24:00) local
 *     convertida a rango UTC exacto para SQL y espejo).
 *   - Dedupe: marcador `night_summary` {restaurantId, localDay} en
 *     notification_events (global por réplica, mismo patrón que review-nudge).
 *     Se graba también en días de 0 pedidos: dedupe barato de los próximos ticks.
 *   - Franja de envío: hora local 3..5 (la 3 exacta envía; hasta las 5 local
 *     re-intenta si el send falló — el dedupe evita duplicados).
 *   - Skip honesto: demos (cero datos falsos), nightSummaryEnabled === false,
 *     sin email del dueño, 0 pedidos (NO_ORDERS), send fallado (SEND_FAILED,
 *     sin marcador para que una hora posterior lo reintente).
 *
 * Seguridad: exige CRON_SECRET (prod falla cerrado). Cap 500 pedidos por
 * jornada por local (fetch limit MAX+1 → `counts.truncated` → "500+").
 */
const express = require('express');
const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { verifyCronAuth } = require('../middleware/cronAuth');
const nightSummary = require('../utils/nightSummary');
const emailService = require('../services/email');
const notificationsService = require('../services/notifications');
const logger = require('../utils/logger');

const router = express.Router();

/** Pedidos de la jornada para UN local (dual-mode): Unión nube ∪ espejo local
 *  por id — si el dual-write de un pedido fue rechazado en la nube (FK/schema
 *  drift, el caso cloudPending), el espejo local evita un NO_ORDERS falso.
 *  Mismo criterio del boot (repairCloudPendingOrders): ambas caras son verdad. */
async function fetchOrdersInWindow(supabase, restaurantId, startUtc, endUtc) {
  const startTs = new Date(startUtc).getTime();
  const endTs = new Date(endUtc).getTime();
  const byId = new Map();

  if (supabase) {
    try {
      // `*` a propósito: el esquema cloud puede ir detrás del local (Batch C
      // agregó `orders.total` y una select con columna inexistente mata el
      // lado cloud para SIEMPRE). Las columnas de plata viven en la fila igual.
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', String(restaurantId))
        .gte('created_at', startUtc)
        .lt('created_at', endUtc)
        .order('created_at', { ascending: true })
        .limit(nightSummary.MAX_SUMMARY_ORDERS + 1);
      if (!error && Array.isArray(data)) {
        for (const row of data) {
          if (row && row.id !== undefined) byId.set(String(row.id), row);
        }
      } else if (error) {
        console.warn('[Supabase Night Summary Orders Warning]', error.message);
      }
    } catch (e) {
      console.warn('[Supabase Night Summary Orders Exception]', e.message);
    }
  }

  // Espejo local (camel/snake mezclado como siempre): agrega lo que falte.
  try {
    for (const o of (db.getOrders() || [])) {
      if (String(o.restaurantId || o.restaurant_id || '') !== String(restaurantId)) continue;
      const ts = new Date(o.created_at || o.createdAt).getTime();
      if (isNaN(ts) || ts < startTs || ts >= endTs) continue;
      const key = String(o.id);
      if (!byId.has(key)) byId.set(key, o);
    }
  } catch (e) { /* espejo ilegible: la nube (o nada) es lo que hay */ }

  const merged = [...byId.values()].sort((a, b) => {
    const ta = new Date(a.created_at || a.createdAt).getTime() || 0;
    const tb = new Date(b.created_at || b.createdAt).getTime() || 0;
    return ta - tb;
  });
  return merged.slice(0, nightSummary.MAX_SUMMARY_ORDERS + 1);
}

router.get('/night-summary', verifyCronAuth, async (req, res) => {
  try {
    // Reloj INYECTABLE (patrón de la casa): `?nowMs=` congela "ahora" para que
    // la suite ejercite la franja 3..5 local sin dormir ni depender del reloj
    // de pared. SOLO fuera de producción (el Caller autorizado es el cron secret
    // mismo; en prod Vercel nunca lo pasa). Sin inyección ni prod → reloj real.
    const injectMs = Number(req.query.nowMs);
    const startedAt = injectMs > 0 && process.env.NODE_ENV !== 'production' ? injectMs : Date.now();
    const wallClock = Date.now(); // solo para ms de log real (el inyectado no corre)
    const supabase = getSupabaseClient();
    const restaurants = (db.getAllRestaurants ? db.getAllRestaurants() : []).filter(r => r && r.slug);
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

    const results = { checked: restaurants.length, sent: 0, skipped: 0, reasons: {} };
    const bump = (key) => { results.reasons[key] = (results.reasons[key] || 0) + 1; results.skipped += 1; };

    for (const restaurant of restaurants) {
      try {
        // Demos afuera SIEMPRE (cero datos falsos, cero ruido en la medición real).
        if (restaurant.isDemo) { bump('DEMO'); continue; }
        if (restaurant.nightSummaryEnabled === false) { bump('DISABLED'); continue; }

        // Huso del dueño (sanitizado en el save; el cron se defiende igual).
        const offset = nightSummary.clampOffset(
          restaurant.utcOffsetMinutes !== undefined && restaurant.utcOffsetMinutes !== null
            ? restaurant.utcOffsetMinutes
            : -180
        );
        const localHour = nightSummary.localHourOf(startedAt, offset);
        if (localHour === null) { bump('NO_CLOCK'); continue; }

        // Franja de envío 3..5 local: la 3 exacta es el envío principal,
        // hasta las 5 re-intenta send-failures (el dedupe evita duplicados).
        if (localHour < nightSummary.DEFAULT_SUMMARY_HOUR || localHour > nightSummary.DEFAULT_SUMMARY_HOUR + 2) { bump('OUT_OF_HOUR'); continue; }

        const window = nightSummary.prevLocalDay_window(startedAt, offset);
        if (!window || !window.localDay) { bump('NO_WINDOW'); continue; }

        // Dedupe global por réplica: ya enviado hoy → nada (segunda corrida del
        // mismo tick en varias instancias de Vercel sale en 0).
        if (await notificationsService.hasNightSummarySent(restaurant.id, window.localDay)) { bump('ALREADY_SENT'); continue; }

        // Email del DUEÑO (transaccional, no campaña): user del local.
        const owner = restaurant.userId ? db.findUserById(restaurant.userId) : null;
        const ownerEmail = owner && typeof owner.email === 'string' ? owner.email.trim() : '';
        if (!ownerEmail) { bump('NO_OWNER_EMAIL'); continue; }

        const raw = await fetchOrdersInWindow(supabase, restaurant.id, window.startUtc, window.endUtc);
        // Cap: > MAX fetch ⇒ "500+" en el email y resumen sobre los primeros.
        const truncated = raw.length > nightSummary.MAX_SUMMARY_ORDERS;
        const orders = truncated ? raw.slice(0, nightSummary.MAX_SUMMARY_ORDERS) : raw;

        const summary = nightSummary.computeNightSummary(orders, {
          localDay: window.localDay,
          currency: restaurant.currency || 'USD',
          utcOffsetMinutes: offset,
          truncated
        });

        // Día sin pedidos: cero email, marcador sí (no re-consultar toda la noche).
        if (!summary.counts || summary.counts.total === 0) {
          await notificationsService.recordNightSummary({ restaurantId: restaurant.id, localDay: window.localDay });
          bump('NO_ORDERS');
          continue;
        }

        const result = await emailService.sendNightSummaryEmail({
          to: ownerEmail,
          restaurantName: restaurant.name || restaurant.bizName || '',
          localDay: window.localDay,
          currency: restaurant.currency || 'USD',
          summary,
          studioUrl: `${appUrl}/studio?tab=notifications`
        });
        if (!result || result.success === false) { bump('SEND_FAILED'); continue; }

        results.sent += 1;
        // El marcador se graba DESPUÉS del envío efectivo (send-failures
        // reintentan en la franja 4..5 local gracias a que no quedó marcado).
        await notificationsService.recordNightSummary({ restaurantId: restaurant.id, localDay: window.localDay });
      } catch (e) {
        bump('ERROR');
        logger.info('[Night Summary] error por local, se continúa', { details: String(e.message || e) });
      }
    }

    logger.info('[Night Summary] ejecutado', {
      details: `checked=${results.checked} sent=${results.sent} skipped=${results.skipped} ms=${Date.now() - wallClock}`
    });

    return res.json({
      success: true,
      windowHours: [nightSummary.DEFAULT_SUMMARY_HOUR, nightSummary.DEFAULT_SUMMARY_HOUR + 2],
      dayShift: -1,
      data: results
    });
  } catch (e) {
    console.error('[Night Summary Cron Error]', e.message);
    return res.status(500).json({ success: false, error: 'El cierre nocturno falló calculando' });
  }
});

module.exports = router;
