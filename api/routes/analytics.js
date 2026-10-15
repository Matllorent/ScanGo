const express = require('express');
const { z } = require('zod');
const telemetryService = require('../services/telemetry');
const db = require('../../src/db/db');
const { successResponse, errorResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const { authMiddleware } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
// Gate por plan: checkSubscriptionKillSwitch no soporta param de feature
// (solo pausa altas globales), por eso el gate de `analytics` va inline abajo.
const { checkSubscriptionKillSwitch } = require('../middleware/killSwitch');
const billingOrchestrator = require('../../src/billing/orchestrator');

void checkSubscriptionKillSwitch;

const router = express.Router();
router.use(authMiddleware);

/**
 * Lectura de analíticas: abierta a todos los planes activos (plan único).
 * La ingesta POST /track nunca estuvo gateada; la lectura tampoco desde el
 * plan único oct-2026 (antes: starter bloqueado con ANALYTICS_UPGRADE_REQUIRED).
 */
function requireAnalyticsFeature(req, res, next) {
  return next();
}

/**
 * Resuelve {dishId, clicks} → {dishId, name, clicks} usando la carta del
 * restaurante (los eventos solo guardan dish_id; el nombre vive en dishes[]).
 */
function attachDishNames(restaurantId, topDishes) {
  if (!Array.isArray(topDishes) || topDishes.length === 0) return topDishes || [];
  const restaurant = db.findRestaurantById(restaurantId);
  const nameById = new Map((restaurant?.dishes || []).map(d => [d.id, d.name]));
  return topDishes.map(d => ({
    ...d,
    name: nameById.get(d.dishId) || d.dishId || ''
  }));
}

const trackEventSchema = z.object({
  restaurantId: z.string().min(1, { message: 'ID de restaurante requerido' }),
  eventType: z.enum([
    'qr_scan', 'dish_click', 'order_placed', 'waiter_call', 'reservation', 
    'visit', 'order', 'waiter',
    'event_qr_scan', 'event_dish_click', 'event_order_placed'
  ]),
  dishId: z.string().optional(),
  branchId: z.string().optional(),
  eventId: z.string().optional(),
  metadata: z.record(z.any()).optional().default({})
});

/**
 * POST /api/analytics/track
 * Track de eventos (QR scans, dish clicks, variantes de eventos).
 * Escribe en la telemetría (fuente única de verdad) y recalcula la proyección
 * legacy (restaurant.analytics): antes /track solo escribía telemetría y los
 * contadores legacy quedaban atrás (doble sistema con drift).
 */
router.post('/track', tenantGuard, validateBody(trackEventSchema), async (req, res) => {
  const { restaurantId, eventType, dishId, branchId, eventId, metadata } = req.body;

  await telemetryService.recordEventSync({
    restaurantId,
    eventType,
    dishId,
    branchId,
    eventId,
    metadata
  });

  // Proyección legacy derivada de la telemetría (mismo origen que el menú público)
  const restaurant = db.findRestaurantById(restaurantId);
  if (restaurant) {
    const analytics = await telemetryService.countAnalytics(restaurantId);
    await db.setAnalyticsSnapshot(restaurant.slug, analytics);
  }

  return successResponse(res, { tracked: true }, 'Evento de telemetría registrado', 202);
});

/**
 * GET /api/analytics/weekly/:restaurantId
 * Returns weekly aggregated telemetry metrics for restaurant owners
 */
router.get('/weekly/:restaurantId', tenantGuard, requireAnalyticsFeature, async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const weeklyData = await telemetryService.getWeeklyAggregatedMetrics(restaurantId);
    weeklyData.topDishes = attachDishNames(restaurantId, weeklyData.topDishes);
    return successResponse(res, weeklyData, 'Métricas semanales de telemetría calculadas');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/today/:restaurantId
 * "Lo que se vendió hoy" (día local del dueño) + comparación con ayer +
 * platos vendidos y más vistos hoy. Query: ?utcOffsetMinutes=180 (UY)
 */
router.get('/today/:restaurantId', tenantGuard, requireAnalyticsFeature, async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const utcOffsetMinutes = parseInt(req.query.utcOffsetMinutes) || 0;
    const summary = await telemetryService.getTodaySummary(restaurantId, { utcOffsetMinutes });
    summary.topDishesSold = attachDishNames(restaurantId, summary.topDishesSold);
    summary.topViewed = attachDishNames(restaurantId, summary.topViewed.map(d => ({ dishId: d.dishId, views: d.views })));
    return successResponse(res, summary, 'Resumen del día calculado');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/daily/:restaurantId
 * Returns daily metrics for the last 30 days (for charts)
 * Query params: ?days=30&branchId=xxx&eventId=xxx
 */
router.get('/daily/:restaurantId', tenantGuard, requireAnalyticsFeature, async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
    const branchId = req.query.branchId || undefined;
    const eventId = req.query.eventId || undefined;
    const dailyData = await telemetryService.getDailyMetrics(restaurantId, { days, branchId, eventId });
    return successResponse(res, dailyData, 'Métricas diarias calculadas');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/heatmap/:restaurantId
 * Returns hourly heatmap for peak hours analysis (hora del dueño con
 * ?utcOffsetMinutes=, igual que /today; sin offset = UTC).
 * Query params: ?days=7&branchId=xxx&eventId=xxx&utcOffsetMinutes=180
 */
router.get('/heatmap/:restaurantId', tenantGuard, requireAnalyticsFeature, async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 7));
    const branchId = req.query.branchId || undefined;
    const eventId = req.query.eventId || undefined;
    const utcOffsetMinutes = parseInt(req.query.utcOffsetMinutes) || 0;
    const heatmap = await telemetryService.getHourlyHeatmap(restaurantId, { days, branchId, eventId, utcOffsetMinutes });
    return successResponse(res, heatmap, 'Heatmap horario calculado');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/branches/:restaurantId
 * Returns per-branch comparison metrics
 * Query params: ?days=30
 */
router.get('/branches/:restaurantId', tenantGuard, requireAnalyticsFeature, async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
    const branchMetrics = await telemetryService.getBranchMetrics(restaurantId, { days });
    branchMetrics.forEach(b => {
      b.topDishes = attachDishNames(restaurantId, b.topDishes);
    });
    return successResponse(res, branchMetrics, 'Métricas por sucursal calculadas');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/events/:restaurantId
 * Returns event-specific metrics (for events mode)
 */
router.get('/events/:restaurantId', tenantGuard, requireAnalyticsFeature, async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const eventMetrics = await telemetryService.getEventMetrics(restaurantId);
    return successResponse(res, eventMetrics, 'Métricas de eventos calculadas');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/funnel/:restaurantId
 * Embudo Google (30 días): clicks a reseñar, aceptes del nudge y feedbacks
 * privados. SIN gate Pro (a diferencia de weekly/daily): es el loop de
 * crecimiento del local gratuito — ver que funciona empuja a configurarlo.
 */
router.get('/funnel/:restaurantId', tenantGuard, async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const [google, nudge, feedback] = await Promise.all([
      telemetryService.getEvents(restaurantId, { since, eventType: 'google_review_click' }),
      telemetryService.getEvents(restaurantId, { since, eventType: 'review_nudge_accept' }),
      telemetryService.getEvents(restaurantId, { since, eventType: 'private_feedback' })
    ]);
    return successResponse(res, {
      days,
      googleClicks: google.length,
      nudgeAccepts: nudge.length,
      privateFeedbacks: feedback.length
    }, 'Embudo de reseñas calculado');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
