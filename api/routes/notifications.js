const express = require('express');
const { z } = require('zod');
const notificationsService = require('../services/notifications');
const db = require('../../src/db/db');
const AppError = require('../utils/AppError');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const { authMiddleware } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { notificationLimiter, waiterAlertLimiter } = require('../middleware/rateLimits');

const router = express.Router();

const subscribeSchema = z.object({
  userId: z.string().optional(),
  restaurantId: z.string().min(1),
  endpoint: z.string().url({ message: 'Endpoint de suscripción push inválido' }),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  }),
  // role: 'owner' (dueño; recibe avisos de mesa) | 'guest' (comensal con
  // opt-in explícito que solo recibe promos del local)
  role: z.enum(['owner', 'guest']).optional(),
  consentMarketing: z.boolean().optional(),
  // Teléfono del comensal: permite dirigir el aviso de estado SOLO a quien
  // hizo el pedido (se guarda normalizado y enmascarado a la vista del dueño).
  customerPhone: z.string().max(30).optional().default('')
});

const sendNotificationSchema = z.object({
  title: z.string().min(1, { message: 'El título es requerido' }).max(100),
  body: z.string().min(1, { message: 'El mensaje es requerido' }).max(500),
  icon: z.string().url().optional().or(z.literal('')),
  url: z.string().optional(),
  restaurantId: z.string().optional(),
  targetUserId: z.string().optional(),
  // audience: 'owners' (default) | 'guests' (promos con consentimiento) | 'all'
  audience: z.enum(['owners', 'guests', 'all']).optional()
});

const waiterAlertSchema = z.object({
  slug: z.string().min(1, { message: 'Slug del restaurante requerido' }).max(80),
  table: z.string().min(1).max(60).default('No especificada'),
  type: z.enum(['mozo', 'cuenta_efectivo', 'cuenta_tarjeta']).default('mozo')
});

/**
 * GET /api/notifications/vapid-public-key
 * Clave pública VAPID para que el navegador arme la suscripción.
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
 * al mozo o pide la cuenta. Rate-limit POR SLUG (un balde por restaurante,
 * no por IP global), persiste el evento en el inbox del dueño y dispara el
 * Web Push solo a suscripciones role=owner. Sin VAPID no rompe el flujo:
 * responde 200 con configured:false.
 */
router.post('/waiter-alert', waiterAlertLimiter, validateBody(waiterAlertSchema), async (req, res, next) => {
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
    const title = `🔔 ${labels[type] || 'Aviso de mesa'}`;
    const body = `📍 Mesa: ${table} · ${now}`;

    // Persistencia del aviso (inbox del dueño): el push del SO es efímero.
    await notificationsService.recordNotificationEvent({
      restaurantId: restaurant.id,
      type: 'waiter_call',
      title,
      body,
      data: { slug, table, type, time: now }
    });

    try {
      const result = await notificationsService.sendPromotionalNotification({
        title,
        body,
        icon: '/icon-192.png',
        url: '/studio',
        restaurantId: restaurant.id,
        audience: 'owners'
      });
      return successResponse(res, result, 'Aviso enviado al dueño');
    } catch (err) {
      if (err instanceof AppError && err.code === 'PUSH_NOT_CONFIGURED') {
        // Degradación honesta: el aviso de mozo sigue existiendo por WhatsApp
        // y ahora también queda persistido en el inbox.
        return successResponse(res, { configured: false, delivered: 0, checked: 0 }, 'Push no configurado; el aviso sigue por WhatsApp y quedó en el inbox');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/subscribe
 * Registra una suscripción Web Push.
 *
 * Seguridad: si el cuerpo declara `userId` (flujo del dueño), la sesión debe
 * estar autenticada y el userId DEBE coincidir (evita inyectar suscripciones
 * a nombre de otro usuario). Sin userId (comensal guest con opt-in) es público.
 */
router.post('/subscribe', notificationLimiter, validateBody(subscribeSchema), async (req, res, next) => {
  try {
    const { userId, restaurantId, endpoint, keys, role, consentMarketing, customerPhone } = req.body;

    if (req.headers.authorization || (req.cookies && req.cookies.auth_token)) {
      // Sesión presente → el userId declarado debe ser EL de la sesión.
      const jwt = require('jsonwebtoken');
      const token = (req.headers.authorization && req.headers.authorization.split(' ')[1]) || req.cookies.auth_token;
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026');
        if (userId && decoded.userId !== userId) {
          return res.status(403).json({ success: false, error: 'No podés suscribir dispositivos a nombre de otro usuario', code: 'SUBSCRIPTION_USER_MISMATCH' });
        }
      } catch (e) {
        return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
      }
    }

    const subscription = await notificationsService.saveSubscription({
      userId: userId || null,
      restaurantId,
      endpoint,
      keys,
      role,
      consentMarketing,
      customerPhone
    });

    return successResponse(res, subscription, 'Suscripción a notificaciones push registrada exitosamente', 201);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/send
 * Envía notificación push. El dueño puede elegir audiencia:
 *   - owners: avisos operativos (mesa, pedidos).
 *   - guests: promos SOLO a comensales que dieron opt-in explícito (rol guest
 *     + consentimiento), cumpliendo la normativa de comunicaciones comerciales.
 */
router.post('/send', authMiddleware, tenantGuard, notificationLimiter, validateBody(sendNotificationSchema), async (req, res, next) => {
  try {
    const { title, body, icon, url, restaurantId, targetUserId, audience } = req.body;

    const result = await notificationsService.sendPromotionalNotification({
      title,
      body,
      icon,
      url,
      restaurantId,
      targetUserId,
      audience
    });

    // Las promos también quedan en el inbox del dueño (auditoría de envío).
    if (audience === 'guests' || audience === 'all') {
      await notificationsService.recordNotificationEvent({
        restaurantId: restaurantId || req.tenantId,
        type: 'promo',
        title: `📣 Promo enviada: ${title}`,
        body,
        data: { sent: result.delivered, checked: result.checked }
      });
    }

    return successResponse(res, result, 'Notificaciones enviadas exitosamente');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications/events
 * Dueño: inbox del centro de notificaciones (aviso de mesa persistido).
 */
router.get('/events', authMiddleware, tenantGuard, async (req, res, next) => {
  try {
    const [events, unread] = await Promise.all([
      notificationsService.listNotificationEvents({ restaurantId: req.tenantId, limit: 50 }),
      notificationsService.unreadNotificationCount(req.tenantId)
    ]);
    return successResponse(res, { events, unread }, 'Centro de notificaciones');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/events/:eventId/read
 * Dueño: marca un evento como leído. (El param es `eventId` y no `id` a
 * propósito: tenantGuard interpretaría `:id` como tenant y bloquearía 403.)
 */
router.post('/events/:eventId/read', authMiddleware, tenantGuard, async (req, res, next) => {
  try {
    const result = await notificationsService.markNotificationEventRead(req.params.eventId, req.tenantId);
    return successResponse(res, result, 'Evento marcado como leído');
  } catch (err) {
    next(err);
  }
});

module.exports = router;