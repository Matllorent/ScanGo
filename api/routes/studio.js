/**
 * Studio Routes - Panel de restaurante
 * Rutas para gestión de menú, sucursales, eventos, IA y QR de mesa
 */
const express = require('express');
const router = express.Router();
const db = require('../../src/db/db');
const billingOrchestrator = require('../../src/billing/orchestrator');
const { sanitizeRestaurantPayload } = require('../utils/sanitizeRestaurant');
const { menuCacheMiddleware, invalidateMenuCache, memoryCache } = require('../middleware/cache');
const { authMiddleware } = require('../middleware/auth');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');
const { requireActiveSubscription } = require('../middleware/subscriptionGuard');
const { createGroupCartToken } = require('../utils/groupCartToken');
const aiRouter = require('./ai');

/**
 * POST /api/studio/save - Guardar restaurante/menú completo
 * Requiere sesión + casilla verificada + suscripción vigente (o gracia activa):
 * con el trial vencido y sin plan, el menú está pausado y no debería editar se
 * como si nada. Los gates de gracia post-trial viven en verifyAccess().
 */
router.post('/save', authMiddleware, requireVerifiedEmail, requireActiveSubscription, async (req, res) => {
  try {
    const payload = req.body.data || req.body;
    const cleanPayload = sanitizeRestaurantPayload(payload);
    const restaurant = await db.saveRestaurant(req.user.userId, cleanPayload);
    if (restaurant && restaurant.slug) {
      memoryCache.delete(restaurant.slug);
      await invalidateMenuCache(restaurant.slug);
    }
    return res.json({ success: true, restaurant });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/studio/group-cart-tokens - Generar capabilities de QR de mesa
 */
router.post('/group-cart-tokens', authMiddleware, requireVerifiedEmail, (req, res) => {
  const tableCount = Number(req.body?.tableCount);
  if (!Number.isInteger(tableCount) || tableCount < 1 || tableCount > 100) {
    return res.status(400).json({ error: 'Cantidad de mesas inválida. Debe estar entre 1 y 100.' });
  }

  const restaurant = db.findRestaurantByUserId(req.user.userId);
  if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });

  const access = billingOrchestrator.verifyAccess(restaurant.id);
  if (!access.allowed) return res.status(402).json({ error: 'Suscripción requerida' });

  const tokens = Array.from({ length: tableCount }, (_, index) => {
    const tableNumber = String(index + 1);
    return { tableNumber, token: createGroupCartToken(restaurant.id, tableNumber) };
  });
  return res.json({ success: true, data: { tokens }, message: 'Capabilities de QR de mesa generadas' });
});

/**
 * POST /api/studio/ai-import - Importar carta física con Gemini Flash
 * Delega al router de IA
 */
router.post('/ai-import', authMiddleware, (req, res, next) => {
  req.url = '/parse-menu';
  aiRouter(req, res, next);
});

/**
 * PATCH /api/studio/branches - Operaciones granulares de sucursales
 * Body: { operation: 'add' | 'update' | 'delete', branch: {...}, branchId?: string, branchSlug?: string }
 */
const processedBranchOperations = new Map(); // idempotencyKey -> response
router.patch('/branches', authMiddleware, requireVerifiedEmail, async (req, res) => {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
    if (idempotencyKey && processedBranchOperations.has(idempotencyKey)) {
      return res.json(processedBranchOperations.get(idempotencyKey));
    }

    const { operation, branch, branchId, branchSlug } = req.body || {};
    if (!operation || !['add', 'update', 'delete'].includes(operation)) {
      return res.status(400).json({ error: 'Operación requerida: add, update o delete' });
    }

    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurante no encontrado' });
    }

    // Delegate to DB method
    const result = await db.updateBranches(restaurant.id, {
      operation,
      branch,
      branchId,
      branchSlug
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Invalidate menu cache
    if (result.restaurant && result.restaurant.slug) {
      memoryCache.delete(result.restaurant.slug);
      await invalidateMenuCache(result.restaurant.slug);
    }

    const responsePayload = {
      success: true,
      action: result.action,
      branch: result.branch,
      restaurant: result.restaurant
    };

    if (idempotencyKey) {
      processedBranchOperations.set(idempotencyKey, responsePayload);
      if (processedBranchOperations.size > 500) {
        const oldestKey = processedBranchOperations.keys().next().value;
        processedBranchOperations.delete(oldestKey);
      }
    }

    return res.json(responsePayload);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/studio/events - Crear un nuevo evento (restaurante temporal con expiración)
 */
router.post('/events', authMiddleware, requireVerifiedEmail, async (req, res) => {
  try {
    const { name, slug, eventDate, eventType, expiresAt, description, phone, currency, theme, layout, dishes, categories } = req.body || {};

    if (!name || !eventDate) {
      return res.status(400).json({ error: 'Nombre y fecha del evento son requeridos' });
    }

    const userId = req.user.userId;
    const cleanSlug = (slug || name).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
    const eventSlug = `event-${cleanSlug}-${Date.now().toString(36)}`;

    const expiresAtDate = expiresAt ? new Date(expiresAt) : new Date(new Date(eventDate).getTime() + 24 * 3600 * 1000); // Default: 24h after event

    // Modelo de pago de eventos: one-off por fiesta (`event_once`, ~USD 12).
    // El evento nace en trial (7 días o hasta la fecha, lo que ocurra antes)
    // para configurarlo; después el dueño paga una tarifa única que lo deja
    // online hasta eventDate. Sin pago: trial vencido + gracia 3 días → pausa.
    const trialEndRaw = new Date(Math.min(
      Date.now() + 7 * 24 * 3600 * 1000,
      expiresAtDate.getTime()
    )).toISOString();

    const eventData = {
      bizName: name,
      name: name,
      slug: eventSlug,
      slogan: description || '',
      phone: phone || '',
      currency: currency || '$',
      theme: theme || 'neon',
      layout: layout || 'neon',
      businessType: 'events',
      isEvent: true,
      eventDate: new Date(eventDate).toISOString(),
      eventType: eventType || 'private',
      expiresAt: expiresAtDate.toISOString(),
      dishes: Array.isArray(dishes) ? dishes : [],
      categories: Array.isArray(categories) ? categories : [],
      subscription: {
        status: 'trialing',
        plan: 'event_once',
        provider: 'trial',
        trialEndsAt: trialEndRaw,
        currentPeriodEnd: expiresAtDate.toISOString(),
        gracePeriodDaysRemaining: 7
      }
    };

    const cleanPayload = sanitizeRestaurantPayload(eventData);
    const event = await db.saveRestaurant(userId, cleanPayload);

    if (event && event.slug) {
      memoryCache.delete(event.slug);
      await invalidateMenuCache(event.slug);
    }

    // Generate custom QR for event
    const eventQRUrl = `${process.env.APP_URL || 'https://scango.app'}/m/${event.slug}?event=true`;

    return res.json({
      success: true,
      event,
      eventQRUrl,
      message: 'Evento creado exitosamente. El menú expirará automáticamente.'
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/studio/events - Listar eventos del usuario
 */
router.get('/events', authMiddleware, requireVerifiedEmail, async (req, res) => {
  try {
    const userId = req.user.userId;
    const rests = db.getAllRestaurants ? db.getAllRestaurants() : [];
    const userEvents = rests.filter(r => r.userId === userId && r.businessType === 'events');

    // Separate active and expired
    const now = new Date();
    const active = userEvents.filter(e => new Date(e.expiresAt || e.eventDate) > now);
    const expired = userEvents.filter(e => new Date(e.expiresAt || e.eventDate) <= now);

    return res.json({ success: true, active, expired, total: userEvents.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/studio/events/:id - Eliminar/finalizar un evento
 */
router.delete('/events/:id', authMiddleware, requireVerifiedEmail, async (req, res) => {
  try {
    const eventId = req.params.id;
    const userId = req.user.userId;
    const restaurant = db.findRestaurantById(eventId);

    if (!restaurant || restaurant.userId !== userId || restaurant.businessType !== 'events') {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    // Mark as expired immediately
    const expiredData = {
      ...restaurant,
      expiresAt: new Date().toISOString(),
      subscription: {
        ...restaurant.subscription,
        status: 'expired'
      }
    };

    await db.saveRestaurant(userId, expiredData);

    if (restaurant.slug) {
      memoryCache.delete(restaurant.slug);
      await invalidateMenuCache(restaurant.slug);
    }

    return res.json({ success: true, message: 'Evento finalizado' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;