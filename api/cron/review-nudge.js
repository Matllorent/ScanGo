/**
 * GET /api/cron/review-nudge
 * Nudge de reseña "el día siguiente" (R2, convertido del playbook de Fornno:
 * "al día siguiente de tu visita, pedí la reseña"). Recorre los pedidos
 * ENTREGADOS hace 26..50 horas, resuelve el email del comensal desde su
 * tarjeta del Club (customer_profiles, identidad por teléfono E.164) y le
 * envía el email CONDUCTUAL con el EMBUDO NEUTRAL de reseñas (4-5★ → Google,
 * 1-3★ → feedback privado; nunca se pide "5 estrellas").
 *
 * Honesto y fallando cerrado:
 *   - Local sin tarjeta Club / sin email / sin consentimiento / opt-out → skip.
 *   - Un pedido SOLO recibe una solicitud (dedupe en notification_events
 *     `review_nudge_request`, global por réplica).
 *   - El restaurante sin menú publicado no participa (slug faltante).
 *   - Sin CRON_SECRET en prod: 503 (middleware compartido cronAuth).
 *
 * Idempotencia: la segunda corrida del mismo día vuelve con los mismos
 * marcadores → { sent: 0 }. Native-cap: tope 150 envíos por corrida.
 */
const express = require('express');
const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { verifyCronAuth } = require('../middleware/cronAuth');
const { collectReviewNudgeCandidates } = require('../utils/reviewNudge');
const loyaltyService = require('../services/loyalty');
const emailService = require('../services/email');
const notificationsService = require('../services/notifications');
const logger = require('../utils/logger');

const router = express.Router();

async function fetchRecentDeliveredOrders(supabase) {
  // Ventana ancha (3 días): el filtro fino (26..50h) es del módulo puro.
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, restaurant_id, status, status_updated_at, created_at, customer_phone, customer_name')
        .eq('status', 'delivered')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1500);
      if (!error && Array.isArray(data)) return data;
      if (error) console.warn('[Supabase Review Nudge Orders Warning]', error.message);
    } catch (e) {
      console.warn('[Supabase Review Nudge Orders Exception]', e.message);
    }
  }
  // Espejo local (dual-mode / sin nube): el mismo shape camel/snake mezclado.
  try {
    return (db.getOrders() || []).filter(o => String(o.status) === 'delivered');
  } catch (e) {
    return [];
  }
}

router.get('/review-nudge', verifyCronAuth, async (req, res) => {
  try {
    const startedAt = Date.now();
    const supabase = getSupabaseClient();
    const restaurants = (db.getAllRestaurants ? db.getAllRestaurants() : []).filter(r => r && r.slug);
    const byId = new Map(restaurants.map(r => [r.id, r]));

    const rawOrders = await fetchRecentDeliveredOrders(supabase);
    const selection = collectReviewNudgeCandidates(rawOrders, { nowMs: startedAt });
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

    const results = { checked: selection.checked, considered: selection.count, sent: 0, skipped: 0, reasons: {} };
    for (const candidate of selection.candidates) {
      try {
        const restaurant = byId.get(candidate.restaurantId);
        const slug = restaurant && restaurant.slug;
        if (!slug) { results.skipped++; results.reasons.NO_MENU = (results.reasons.NO_MENU || 0) + 1; continue; }

        if (await notificationsService.hasOrderReviewNudge(candidate.orderId)) {
          results.skipped++; results.reasons.ALREADY_NUDGED = (results.reasons.ALREADY_NUDGED || 0) + 1; continue;
        }

        const customer = await loyaltyService.findCustomerByPhone(candidate.phone);
        const email = customer && typeof customer.email === 'string' ? customer.email.trim() : '';
        if (!email) { results.skipped++; results.reasons.NO_EMAIL = (results.reasons.NO_EMAIL || 0) + 1; continue; }
        if (customer.consentMarketing === false) { results.skipped++; results.reasons.NO_MARKETING_CONSENT = (results.reasons.NO_MARKETING_CONSENT || 0) + 1; continue; }
        if (emailService.isOptedOut(email)) { results.skipped++; results.reasons.CUSTOMER_OPTED_OUT = (results.reasons.CUSTOMER_OPTED_OUT || 0) + 1; continue; }

        const reviewUrl = `${appUrl}/m/${encodeURIComponent(slug)}?review=1`;
        const result = await emailService.sendReviewRequestEmail({
          to: email,
          customerName: candidate.customerName || '',
          restaurantName: restaurant.name || '',
          reviewUrl
        });
        results.sent++;
        if (result && result.skipped) {
          results.reasons.OPT_OUT_AT_SEND = (results.reasons.OPT_OUT_AT_SEND || 0) + 1;
        }
        // El marcador se persiste SIEMPRE (enviado u opt-out: no re-enviar a
        // quien pidió la baja; no duplicar al que ya dijo sí).
        await notificationsService.recordOrderReviewNudge({ restaurantId: candidate.restaurantId, orderId: candidate.orderId });
      } catch (e) {
        results.skipped++; results.reasons.ERROR = (results.reasons.ERROR || 0) + 1;
        logger.info('[Review Nudge] error por pedido, se continúa', { details: String(e.message || e) });
      }
    }

    logger.info('[Review Nudge] ejecutado', {
      details: `checked=${results.checked} considered=${results.considered} sent=${results.sent} skipped=${results.skipped} ms=${Date.now() - startedAt}`
    });

    return res.json({ success: true, windowHours: [26, 50], data: results });
  } catch (e) {
    console.error('[Review Nudge Cron Error]', e.message);
    return res.status(500).json({ success: false, error: 'El nudge de reseña falló consultando' });
  }
});

module.exports = router;
