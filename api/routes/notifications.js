const express = require('express');
const { z } = require('zod');
const notificationsService = require('../services/notifications');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');

const router = express.Router();

const subscribeSchema = z.object({
  userId: z.string().optional(),
  restaurantId: z.string().optional(),
  endpoint: z.string().url({ message: 'Endpoint de suscripción push inválido' }),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});

const sendNotificationSchema = z.object({
  title: z.string().min(1, { message: 'El título es requerido' }).max(100),
  body: z.string().min(1, { message: 'El mensaje es requerido' }).max(500),
  icon: z.string().url().optional().or(z.literal('')),
  url: z.string().optional(),
  restaurantId: z.string().optional(),
  targetUserId: z.string().optional()
});

/**
 * POST /api/notifications/subscribe
 * Register a Web Push / FCM subscription token
 */
router.post('/subscribe', validateBody(subscribeSchema), async (req, res, next) => {
  try {
    const { userId, restaurantId, endpoint, keys } = req.body;
    const subscription = await notificationsService.saveSubscription({
      userId,
      restaurantId,
      endpoint,
      keys
    });

    return successResponse(res, subscription, 'Suscripción a notificaciones push registrada exitosamente', 201);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/send
 * Send promotional push notification alert
 */
router.post('/send', validateBody(sendNotificationSchema), async (req, res, next) => {
  try {
    const { title, body, icon, url, restaurantId, targetUserId } = req.body;

    const result = await notificationsService.sendPromotionalNotification({
      title,
      body,
      icon,
      url,
      restaurantId,
      targetUserId
    });

    return successResponse(res, result, 'Notificaciones enviadas exitosamente');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
