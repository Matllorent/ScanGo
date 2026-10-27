/**
 * api/routes/staff.js
 * ────────────────────
 * API del TURNO del equipo operativo (mozos / cocina). Es un canal separado
 * del dueño: no usa cookies JWT ni `tenantGuard`, sino el token opaco de sesión
 * que emite `POST /shift/activate` al escanear el QR de turno.
 *
 * Endpoints:
 *   POST   /api/staff/shift/activate   (público + limiter; credencial del QR)
 *   GET    /api/staff/me
 *   POST   /api/staff/shift/heartbeat
 *   POST   /api/staff/shift/end
 *   GET    /api/staff/tables
 *   POST   /api/staff/push/subscribe
 *   DELETE /api/staff/push/subscribe
 *
 * Cero PII de comensales: el turno solo ve mesas asignadas y el nombre del
 * local. El hash de la credencial y el token de sesión NUNCA se devuelven.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../../src/db/db');
const { validateBody } = require('../middleware/validation');
const { successResponse } = require('../utils/response');
const { staffLimiter, staffShiftLimiter } = require('../middleware/rateLimits');
const { staffAuthMiddleware } = require('../middleware/staffAuth');
const notificationsService = require('../services/notifications');
const auditService = require('../services/audit');
const {
  hashStaffSecret,
  safeEqualHex,
  generateStaffSecret,
  generateStaffSessionId,
  staffSessionExpiry,
  extendStaffSession,
  staffRoleLabel
} = require('../utils/staffCredentials');

const router = express.Router();

const activateSchema = z.object({
  restaurantId: z.string().min(1).max(100),
  staffId: z.string().min(1).max(100),
  secret: z.string().min(20).max(200)
});

const pushSubscribeSchema = z.object({
  endpoint: z.string().url({ message: 'Endpoint de suscripción push inválido' }).max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(1000),
    auth: z.string().min(1).max(1000)
  })
});

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url({ message: 'Endpoint de suscripción push inválido' }).max(2000)
});

/** Shape público de una persona del equipo: sin hash ni datos del dueño. */
function publicStaff(staff) {
  if (!staff) return null;
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    roleLabel: staffRoleLabel(staff.role),
    active: staff.active !== false
  };
}

function restaurantPublic(restaurant) {
  if (!restaurant) return null;
  return {
    id: restaurant.id,
    name: restaurant.name || restaurant.bizName || '',
    slug: restaurant.slug || ''
  };
}

function sortTables(a, b) {
  const na = /^\d+$/.test(a.number) ? Number(a.number) : null;
  const nb = /^\d+$/.test(b.number) ? Number(b.number) : null;
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return a.number.localeCompare(b.number, 'es');
}

function assignedTables(restaurant, staffId) {
  const map = restaurant && restaurant.tableAssignments && typeof restaurant.tableAssignments === 'object'
    ? restaurant.tableAssignments
    : {};
  return Object.entries(map)
    .filter(([, assigned]) => assigned === staffId)
    .map(([number]) => ({
      number,
      label: /^\d+$/.test(number) ? `Mesa ${number}` : number
    }))
    .sort(sortTables);
}

/**
 * POST /api/staff/shift/activate
 * Verifica la credencial del QR y emite un token de sesión opaco. El secreto
 * llega en el body (lo extrae el navegador del fragmento `#k=`), nunca en un
 * query string ni en un log.
 */
router.post('/shift/activate', staffShiftLimiter, validateBody(activateSchema), async (req, res, next) => {
  try {
    const { restaurantId, staffId, secret } = req.body;

    const staff = await db.findStaffById(staffId);
    // Misma respuesta para "no existe" y "secreto incorrecto": no se enumera
    // el equipo de un local desde internet.
    if (!staff || staff.restaurantId !== restaurantId) {
      return res.status(401).json({
        success: false,
        error: 'El QR de turno no es válido para este local.',
        code: 'STAFF_CREDENTIAL_INVALID'
      });
    }
    if (staff.active === false) {
      return res.status(403).json({
        success: false,
        error: 'Esta persona está desactivada. Pedile al dueño que la reactive.',
        code: 'STAFF_INACTIVE'
      });
    }
    const providedHash = hashStaffSecret(secret);
    if (!staff.credentialHash || !safeEqualHex(providedHash, staff.credentialHash)) {
      return res.status(401).json({
        success: false,
        error: 'El QR de turno venció o fue regenerado. Pedile uno nuevo al dueño.',
        code: 'STAFF_CREDENTIAL_INVALID'
      });
    }

    let restaurant = db.findRestaurantById(restaurantId);
    if (!restaurant && typeof db.lazyLoadRestaurantById === 'function') {
      restaurant = await db.lazyLoadRestaurantById(restaurantId);
    }
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: 'El local de este turno no existe.',
        code: 'RESTAURANT_NOT_FOUND'
      });
    }

    const token = generateStaffSecret();
    const now = new Date().toISOString();
    const session = {
      id: generateStaffSessionId(),
      staffId: staff.id,
      restaurantId: staff.restaurantId,
      tokenHash: hashStaffSecret(token),
      createdAt: now,
      expiresAt: staffSessionExpiry(),
      lastSeenAt: null,
      endedAt: null,
      revokedAt: null
    };
    await db.createStaffSession(session);

    auditService.logAction({
      tenantId: staff.restaurantId,
      userId: staff.createdBy || restaurant.userId || 'system',
      requestId: req.requestId,
      action: 'STAFF_SHIFT_START',
      entity: 'staff_session',
      details: { staffId: staff.id, role: staff.role }
    });

    return successResponse(res, {
      token,
      expiresAt: session.expiresAt,
      staff: publicStaff(staff),
      restaurant: restaurantPublic(restaurant),
      tables: assignedTables(restaurant, staff.id),
      pushConfigured: Boolean(notificationsService.getVapidConfig())
    }, 'Turno activado');
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/staff/me
 * Identidad del turno + local + mesas asignadas. Es la llamada que hace la
 * PWA al abrir y cada 30 s para refrescar (sin reingresar el QR).
 */
router.get('/me', staffLimiter, staffAuthMiddleware, (req, res) => {
  return successResponse(res, {
    staff: publicStaff(req.staff),
    restaurant: restaurantPublic(req.staffRestaurant),
    session: {
      expiresAt: req.staffSession.expiresAt,
      lastSeenAt: req.staffSession.lastSeenAt || null
    },
    tables: assignedTables(req.staffRestaurant, req.staff.id),
    pushConfigured: Boolean(notificationsService.getVapidConfig())
  }, 'Turno activo');
});

/**
 * POST /api/staff/shift/heartbeat
 * Estira la sesión viva (tope absoluto 24 h desde la activación) y devuelve el
 * vencimiento real. El middleware ya hace un touch throttled; esto es explícito
 * para que la PWA pueda renovar al volver del background.
 */
router.post('/shift/heartbeat', staffLimiter, staffAuthMiddleware, async (req, res, next) => {
  try {
    const now = Date.now();
    const expiresAt = extendStaffSession(req.staffSession, now);
    await db.touchStaffSession(req.staffSession.id, {
      lastSeenAt: new Date(now).toISOString(),
      expiresAt
    });
    return successResponse(res, { expiresAt }, 'Turno renovado');
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/staff/shift/end
 * Cierra el turno (idempotente). El token deja de servir inmediatamente; la
 * suscripción push queda guardada para el próximo turno de la misma persona.
 */
router.post('/shift/end', staffLimiter, staffAuthMiddleware, async (req, res, next) => {
  try {
    await db.endStaffSession(req.staffSession.id, new Date().toISOString());
    auditService.logAction({
      tenantId: req.staff.restaurantId,
      userId: req.staff.createdBy || 'system',
      requestId: req.requestId,
      action: 'STAFF_SHIFT_END',
      entity: 'staff_session',
      details: { staffId: req.staff.id, role: req.staff.role }
    });
    return successResponse(res, null, 'Turno cerrado');
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/staff/tables
 * Solo las mesas asignadas a ESTA persona. Sin asignaciones devuelve [] (la
 * PWA muestra "el dueño todavía no te asignó mesas", no una pizarra vacía
 * silenciosa).
 */
router.get('/tables', staffLimiter, staffAuthMiddleware, (req, res) => {
  return successResponse(res, {
    tables: assignedTables(req.staffRestaurant, req.staff.id),
    restaurant: restaurantPublic(req.staffRestaurant),
    staff: publicStaff(req.staff)
  }, 'Mesas del turno');
});

/**
 * POST /api/staff/push/subscribe
 * El aviso push del equipo se dirige por `staff_id`, no por endpoint: una
 * tablet compartida puede cambiar de turno sin que los avisos se crucen.
 */
router.post('/push/subscribe', staffLimiter, staffAuthMiddleware, validateBody(pushSubscribeSchema), async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body;
    const subscription = await notificationsService.saveSubscription({
      restaurantId: req.staff.restaurantId,
      endpoint,
      keys,
      role: 'waiter',
      staffId: req.staff.id
    });

    // Confirmación real best-effort: si hay VAPID, el mozo recibe un push de
    // bienvenida; si no, el panel muestra "avisos no configurados" sin romper.
    const dispatch = await notificationsService.sendStaffPush({
      restaurantId: req.staff.restaurantId,
      staffId: req.staff.id,
      title: '🔔 Avisos activados',
      body: `Hola ${req.staff.name}, vas a recibir los avisos de tu turno.`,
      url: '/mozo',
      type: 'staff_shift',
      tag: 'staff-welcome'
    });

    return successResponse(res, {
      subscriptionId: subscription.id,
      pushConfigured: Boolean(notificationsService.getVapidConfig()),
      delivered: dispatch.delivered || 0,
      skipped: dispatch.skipped || null
    }, 'Avisos del turno activados');
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /api/staff/push/subscribe
 * Baja SOLO una suscripción propia del turno (no la de otro mozo ni la del
 * dueño). Body: { endpoint }.
 */
router.delete('/push/subscribe', staffLimiter, staffAuthMiddleware, validateBody(pushUnsubscribeSchema), async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    const own = await notificationsService.listSubscriptions({
      restaurantId: req.staff.restaurantId,
      role: 'waiter',
      staffId: req.staff.id
    });
    const match = own.find((s) => s.endpoint === endpoint);
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Esa suscripción no pertenece a tu turno.',
        code: 'SUBSCRIPTION_NOT_FOUND'
      });
    }
    await notificationsService.removeSubscriptionByEndpoint(endpoint);
    return successResponse(res, null, 'Avisos del turno desactivados');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
