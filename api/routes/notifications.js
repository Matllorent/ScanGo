const express = require('express');
const { z } = require('zod');
const notificationsService = require('../services/notifications');
const db = require('../../src/db/db');
const AppError = require('../utils/AppError');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const { authMiddleware } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { notificationLimiter } = require('../middleware/rateLimits');

const router = express.Router();

const subscribeSchema = z.object({
  userId: z.string().optional(),
  restaurantId: z.string().min(1),
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

const waiterAlertSchema = z.object({
  slug: z.string().min(1, { message: 'Slug del restaurante requerido' }).max(80),
  table: z.string().min(1).max(60).default('No especificada'),
  type: z.enum(['mozo', 'cuenta_efectivo', 'cuenta_tarjeta']).default('mozo')
});

/**
 * GET /api/notifications/vapid-public-key
 * Clave pública VAPID para que el navegador del dueño arme la suscripción.
 */
router.get('/vapid-public-key', (req, res) => {
  const config = notificationsService.getVapidConfig();
  if (!config) {
    return res.status(503).json({ success: false, error: 'Push no configurado en el servidor', code: 'PUSH_NOT_CONFIGURED' });
  }
  return successResponse(res, { publicKey: config.publicKey, subject: config.subject }, 'Clave pública VAPID');
});

/**
 * POST /api/notifications/waiter-alert
 * Público (lo llama el menú de la mesa): avisa al dueño que una mesa llama
 * al mozo o pide la cuenta, además del flujo de WhatsApp existente.
 * Sin VAPID no rompe el flujo del comensal: responde 200 con configured:false.
 */
router.post('/waiter-alert', notificationLimiter, validateBody(waiterAlertSchema), async (req, res, next) => {
  try {
    const { slug, table, type } = req.body;
    const restaurant = db.findRestaurantBySlug(slug);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado' });
    }
    const labels = {
      mozo: 'Quiere al mozo',
      cuenta_efectivo: 'Pide la cuenta (efectivo)',
      cuenta_tarjeta: 'Pide la cuenta (tarjeta)'
    };
    const now = new Date().toLocaleTimeString();
    try {
      const result = await notificationsService.sendPromotionalNotification({
        title: `🔔 ${labels[type] || 'Aviso de mesa'}`,
        body: `📍 Mesa: ${table} · ${now}`,
        icon: '/icon-192.png',
        url: '/studio',
        restaurantId: restaurant.id
      });
      return successResponse(res, result, 'Aviso enviado al dueño');
    } catch (err) {
      if (err instanceof AppError && err.code === 'PUSH_NOT_CONFIGURED') {
        // Degradación honesta: el aviso de mozo sigue existiendo por WhatsApp
        return successResponse(res, { configured: false, delivered: 0, checked: 0 }, 'Push no configurado; el aviso sigue por WhatsApp');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/subscribe
 * Register a Web Push / FCM subscription token
 */
router.post('/subscribe', notificationLimiter, validateBody(subscribeSchema), async (req, res, next) => {
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
router.post('/send', authMiddleware, tenantGuard, notificationLimiter, validateBody(sendNotificationSchema), async (req, res, next) => {
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
