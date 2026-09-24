const express = require('express');
const { z } = require('zod');
const telemetryService = require('../services/telemetry');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');

const router = express.Router();

const trackEventSchema = z.object({
  restaurantId: z.string().min(1, { message: 'ID de restaurante requerido' }),
  eventType: z.enum(['qr_scan', 'dish_click', 'order_placed', 'waiter_call', 'reservation', 'visit', 'order', 'waiter']),
  dishId: z.string().optional(),
  metadata: z.record(z.any()).optional().default({})
});

/**
 * POST /api/analytics/track
 * Non-blocking fire-and-forget event tracking for QR scans and dish clicks
 */
router.post('/track', validateBody(trackEventSchema), (req, res) => {
  const { restaurantId, eventType, dishId, metadata } = req.body;

  telemetryService.recordEvent({
    restaurantId,
    eventType,
    dishId,
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

module.exports = router;
