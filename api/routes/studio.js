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
const { stripPrivilegedFields } = require('../utils/stripPrivilegedFields');
const aiRouter = require('./ai');
const auditService = require('../services/audit');
const { runSeoAudit } = require('../utils/seoAudit');
const indexNow = require('../utils/indexNow');

// IndexNow (best-effort): throttle por slug — el autosave del Studio guarda a
// menudo; no spameamos la API de pings de Bing/Yandex con cada tecla.
const indexNowThrottle = new Map();
const INDEXNOW_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * POST /api/studio/save - Guardar restaurante/menú completo
 * Requiere sesión + casilla verificada + suscripción vigente (o gracia activa):
 * con el trial vencido y sin plan, el menú está pausado y no debería editar se
 * como si nada. Los gates de gracia post-trial viven en verifyAccess().
 */
router.post('/save', authMiddleware, requireVerifiedEmail, requireActiveSubscription, async (req, res, next) => {
  try {
    const payload = req.body.data || req.body;
    if (JSON.stringify(payload).length > 1_000_000) {
      return res.status(413).json({ error: 'El menú excede el tamaño máximo permitido (1MB)' });
    }

    // Concurrencia optimista: el `updatedAt` que trae el cliente no es un campo
    // que se persiste (se borra abajo como privilegiado) sino su VERSIÓN — el
    // instante de la última respuesta que vio el Studio. Si entre esa lectura y
    // este save otra pestaña/empleado guardó, rechazamos con 409 en vez de
    // sobreescribir en silencio (last-write-wins).
    const clientUpdatedAt = payload && payload.updatedAt;
    const existing = req.user && req.user.userId ? db.findRestaurantByUserId(req.user.userId) : null;
    const serverUpdatedAt = existing && existing.updatedAt;
    if (
      clientUpdatedAt &&
      serverUpdatedAt &&
      Number.isFinite(new Date(clientUpdatedAt).getTime()) &&
      Number.isFinite(new Date(serverUpdatedAt).getTime()) &&
      new Date(clientUpdatedAt).getTime() < new Date(serverUpdatedAt).getTime()
    ) {
      return res.status(409).json({
        success: false,
        error: 'El menú fue actualizado en otra pestaña o por otro empleado. Recargá para ver la versión más reciente o sobrescribí.',
        code: 'MENU_CONCURRENCY_CONFLICT',
        currentUpdatedAt: serverUpdatedAt
      });
    }

    const cleanPayload = stripPrivilegedFields(sanitizeRestaurantPayload(payload));
    const restaurant = await db.saveRestaurant(req.user.userId, cleanPayload);
    if (restaurant && restaurant.slug) {
      memoryCache.delete(restaurant.slug);
      await invalidateMenuCache(restaurant.slug);
    }
    // Auditoría (fire-and-forget, nunca rompe el save): mutación de la carta.
    auditService.logAction({
      tenantId: restaurant ? restaurant.id : undefined,
      userId: req.user.userId,
      requestId: req.requestId,
      action: 'RESTAURANT_UPDATE',
      entity: 'restaurant',
      details: {
        fieldCount: Object.keys(cleanPayload).length,
        hasDishes: Array.isArray(cleanPayload.dishes),
        hasCategories: Array.isArray(cleanPayload.categories)
      }
    });
    // IndexNow (fire-and-forget, nunca rompe ni espera): el contenido cambió y
    // el menú + cada sucursal real pueden re-indexarse casi de inmediato.
    // Sin INDEXNOW_KEY / INDEXNOW_ENABLED=false no genera NINGÚN tráfico, y el
    // throttle de 5 min por slug acota el ruido del autosave.
    if (indexNow.isIndexNowEnabled() && restaurant && restaurant.slug) {
      const now = Date.now();
      const lastPing = indexNowThrottle.get(restaurant.slug) || 0;
      if (now - lastPing >= INDEXNOW_MIN_INTERVAL_MS) {
        indexNowThrottle.set(restaurant.slug, now);
        indexNow.dispatchIndexNowPing({
          key: indexNow.getIndexNowKey(),
          urls: indexNow.getMenuUrlsForPing(process.env.APP_URL || 'https://scango.app', restaurant)
        });
      }
    }
    return res.json({ success: true, restaurant });
  } catch (e) {
    return next(e);
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
router.post('/ai-import', authMiddleware, requireActiveSubscription, (req, res, next) => {
  req.url = '/parse-menu';
  aiRouter(req, res, next);
});

/**
 * PATCH /api/studio/branches - Operaciones granulares de sucursales
 * Body: { operation: 'add' | 'update' | 'delete', branch: {...}, branchId?: string, branchSlug?: string }
 */
const processedBranchOperations = new Map(); // idempotencyKey -> response
router.patch('/branches', authMiddleware, requireVerifiedEmail, requireActiveSubscription, async (req, res, next) => {
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
    return next(e);
  }
});

/**
 * POST /api/studio/events - Crear un nuevo evento (restaurante temporal con expiración)
 */
router.post('/events', authMiddleware, requireVerifiedEmail, requireActiveSubscription, async (req, res, next) => {
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
    return next(e);
  }
});

/**
 * GET /api/studio/events - Listar eventos del usuario
 */
router.get('/events', authMiddleware, requireVerifiedEmail, async (req, res, next) => {
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
    return next(e);
  }
});

/**
 * DELETE /api/studio/events/:id - Eliminar/finalizar un evento
 */
router.delete('/events/:id', authMiddleware, requireVerifiedEmail, async (req, res, next) => {
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
    return next(e);
  }
});

/**
 * GET /api/studio/seo-audit - Panel "Salud SEO" (reporte on-the-fly del menú)
 * Auditor puro (api/utils/seoAudit.js) sobre la carta ya validada: página vacía,
 * precios inválidos, horario roto, referencias muertas de sucursales, datos
 * locales, marcado JSON-LD y unicidad de slug. Solo el dueño (tenant propio).
 */
router.get('/seo-audit', authMiddleware, requireVerifiedEmail, async (req, res, next) => {
  try {
    const rests = db.getAllRestaurants ? db.getAllRestaurants() : [];
    const restaurant = rests.find((r) => r && r.userId === req.user.userId) || null;
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const report = runSeoAudit(restaurant, { allRestaurants: rests });
    return res.json({ success: true, ...report });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;