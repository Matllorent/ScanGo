const express = require('express');
const { z } = require('zod');
const telemetryService = require('../services/telemetry');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');

const router = express.Router();

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
 * Non-blocking fire-and-forget event tracking for QR scans and dish clicks
 * Supports branchId and eventId for granular analytics
 */
router.post('/track', validateBody(trackEventSchema), (req, res) => {
  const { restaurantId, eventType, dishId, branchId, eventId, metadata } = req.body;

  telemetryService.recordEvent({
    restaurantId,
    eventType,
    dishId,
    branchId,
    eventId,
    metadata
  });

  // Respond immediately with sub-30ms performance (fire-and-forget)
  return successResponse(res, { tracked: true }, 'Evento de telemetría registrado', 202);
});

/**
 * GET /api/analytics/weekly/:restaurantId
 * Returns weekly aggregated telemetry metrics for restaurant owners
 */
router.get('/weekly/:restaurantId', async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const weeklyData = await telemetryService.getWeeklyAggregatedMetrics(restaurantId);
    return successResponse(res, weeklyData, 'Métricas semanales de telemetría calculadas');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/daily/:restaurantId
 * Returns daily metrics for the last 30 days (for charts)
 * Query params: ?days=30&branchId=xxx&eventId=xxx
 */
router.get('/daily/:restaurantId', async (req, res, next) => {
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
 * Returns hourly heatmap for peak hours analysis
 * Query params: ?days=7&branchId=xxx&eventId=xxx
 */
router.get('/heatmap/:restaurantId', async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 7));
    const branchId = req.query.branchId || undefined;
    const eventId = req.query.eventId || undefined;
    const heatmap = await telemetryService.getHourlyHeatmap(restaurantId, { days, branchId, eventId });
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
router.get('/branches/:restaurantId', async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
    const branchMetrics = await telemetryService.getBranchMetrics(restaurantId, { days });
    return successResponse(res, branchMetrics, 'Métricas por sucursal calculadas');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/events/:restaurantId
 * Returns event-specific metrics (for events mode)
 */
router.get('/events/:restaurantId', async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    const eventMetrics = await telemetryService.getEventMetrics(restaurantId);
    return successResponse(res, eventMetrics, 'Métricas de eventos calculadas');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
