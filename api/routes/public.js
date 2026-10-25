/**
 * api/routes/public.js
 * ────────────────────
 * Superficie pública sin auth (captcha, analytics/event, reviews aprobadas,
 * pricing, logs del cliente). Extraído de api/index.js sin cambios.
 * Se monta como app.use('/api', publicRouter).
 */
const express = require('express');
const db = require('../../src/db/db');
const telemetryService = require('../services/telemetry');
const { isDemoSlug } = require('../utils/demoRestaurants');
const { publicAnalyticsLimiter } = require('../middleware/rateLimits');

const router = express.Router();

router.get('/public/captcha-config', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ sitekey: process.env.TURNSTILE_SITEKEY || '' });
});

router.post('/public/analytics/event', publicAnalyticsLimiter, async (req, res) => {
  try {
    const { slug, event, dishId, branchId, amount, items, consent } = req.body || {};
    if (!slug || !event) return res.status(400).json({ error: 'slug y event requeridos' });
    const validEvents = ['visit', 'order', 'reservation', 'waiter', 'dish_click', 'order_placed', 'google_review_click', 'private_feedback', 'review_nudge_accept', 'dish_like', 'loyalty_near_reward', 'scango_cta_click'];
    if (!validEvents.includes(event)) return res.status(400).json({ error: 'Evento inválido' });
    // dish_like sin plato es ruido (inflaría lecturas del feed sin contar en
    // ningún lado): se rechaza antes de persistir.
    if (event === 'dish_like' && !dishId) return res.status(400).json({ error: 'dishId requerido' });
    const restaurant = db.findRestaurantBySlug(slug);
    if (!restaurant) {
      // Los menús demo son públicos pero NO son restaurantes reales: no se
      // persiste telemetría (cero datos falsos). Se responde 200 no-op para no
      // llenar de 404 el panel de red / monitoreo de cada visita a una demo.
      if (isDemoSlug(slug)) return res.json({ success: true, demo: true });
      return res.status(404).json({ error: 'Restaurante no encontrado' });
    }
    // Consentimiento (Ley 18.331 / cookies): con 'necessary' solo se registra
    // lo contractual (el pedido/reserva/aviso que el local necesita operar);
    // lo puramente analítico se descarta con 200 honesto (sin persistir).
    // Sin consentimiento declarado se mantiene el comportamiento actual.
    const CONTRACTUAL_EVENTS = new Set(['order_placed', 'reservation', 'waiter_call']);
    const canonicalPre = event === 'order' || event === 'order_placed'
      ? 'order_placed'
      : event === 'waiter'
        ? 'waiter_call'
        : event;
    const minimalConsent = consent === 'necessary';
    if (minimalConsent && !CONTRACTUAL_EVENTS.has(canonicalPre)) {
      return res.json({ success: true, recorded: false, reason: 'CONSENT_NECESSARY' });
    }
    // dish_like de un plato que no es de la carta: voto fantasma (inflaría el
    // feed de otro local). Se valida pertenencia antes de persistir.
    if (event === 'dish_like') {
      const belongs = (restaurant.dishes || []).some(d => d && String(d.id) === String(dishId).slice(0, 80));
      if (!belongs) return res.status(400).json({ error: 'Plato no pertenece al local' });
    }

    // Telemetría rica: alimenta ticket promedio, top platos y comparativa de
    // sucursales. Los valores se sanean (cadenas cortas; amount numérico 0..1e9;
    // items de pedidos con dishId ≤80 y qty 1..999, máximo 100 por pedido).
    // Con consentimiento mínimo ('necessary') el metadata se reduce a la fuente
    // (sin montos ni detalle de ítems): alcanza para operar, no para perfilar.
    const cleanAmount = Number(amount);
    const safeAmount = Number.isFinite(cleanAmount) && cleanAmount >= 0 && cleanAmount <= 1e9
      ? cleanAmount
      : undefined;
    const metadata = minimalConsent
      ? { source: 'public_menu' }
      : { amount: safeAmount, source: 'public_menu' };
    if (event === 'order_placed' && Array.isArray(items) && !minimalConsent) {
      const safeItems = items
        .slice(0, 100)
        .map(it => ({
          dishId: it && it.dishId ? String(it.dishId).slice(0, 80) : undefined,
          qty: it && Number.isFinite(Number(it.qty)) ? Math.max(1, Math.min(999, Math.floor(Number(it.qty)))) : 1
        }))
        .filter(it => it.dishId);
      if (safeItems.length) metadata.items = safeItems;
    }
    await telemetryService.recordEventSync({
      restaurantId: restaurant.id,
      eventType: canonicalPre,
      dishId: dishId ? String(dishId).slice(0, 80) : undefined,
      branchId: branchId ? String(branchId).slice(0, 80) : undefined,
      metadata
    });

    // Proyección legacy derivada de la telemetría (queda sincronizada con todo
    // lo que pasa por /track y por el menú público). Se recalcula por evento:
    // los contadores del dueño deben estar frescos y los tests lo exigen.
    // El control de carga de este camino es el rate-limit por slug (120/15min)
    // + el scan acotado a la columna que usa la proyección. Con sizing por
    // popularidad activo arrastra además `dishPopularity` (throttled 10 min);
    // el resto de locales no paga una query extra.
    const analytics = await telemetryService.projectAnalytics(restaurant);
    await db.setAnalyticsSnapshot(slug, analytics);

    res.json({ success: true, analytics, telemetry: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/reviews/approved', (req, res) => {
  try {
    const reviews = db.getApprovedReviews();
    res.json({ reviews });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/settings/pricing', (req, res) => {
  try {
    const settings = db.getSettings();
    res.json({ success: true, settings });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/logs', (req, res) => {
  const { level, message, stack, url, ua } = req.body || {};
  const timestamp = new Date().toISOString();
  console.log(`[CLIENT-LOG] [${timestamp}] [${level || 'INFO'}] ${message || ''} | URL: ${url || ''}`);
  if (stack) console.error(stack);
  res.json({ received: true });
});

module.exports = router;
