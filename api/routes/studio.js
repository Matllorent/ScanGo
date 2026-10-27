/**
 * Studio Routes - Panel de restaurante
 * Rutas para gestión de menú, sucursales, eventos, IA y QR de mesa
 */
const express = require('express');
const { z } = require('zod');
const router = express.Router();
const db = require('../../src/db/db');
const billingOrchestrator = require('../../src/billing/orchestrator');
const { sanitizeRestaurantPayload, sanitizeDish, DISH_SCHEMA, DISHES_ARRAY_SCHEMA } = require('../utils/sanitizeRestaurant');
const { menuCacheMiddleware, invalidateMenuCache, memoryCache } = require('../middleware/cache');
const { authMiddleware } = require('../middleware/auth');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');
const { requireActiveSubscription } = require('../middleware/subscriptionGuard');
const { validateBody } = require('../middleware/validation');
const { createGroupCartToken } = require('../utils/groupCartToken');
const { stripPrivilegedFields } = require('../utils/stripPrivilegedFields');
const aiRouter = require('./ai');
const auditService = require('../services/audit');
const { runSeoAudit } = require('../utils/seoAudit');
const indexNow = require('../utils/indexNow');
const { dishCreationLimiter, dishBulkSaveLimiter } = require('../middleware/rateLimits');
const {
  STAFF_ROLES,
  generateStaffSecret,
  hashStaffSecret,
  generateStaffId,
  sanitizeStaffName,
  sanitizeStaffRole,
  staffRoleLabel,
  sanitizeTableNumber,
  sanitizeTableAssignments,
  buildStaffEnrollmentUrl
} = require('../utils/staffCredentials');

// IndexNow (best-effort): throttle por slug — el autosave del Studio guarda a
// menudo; no spameamos la API de pings de Bing/Yandex con cada tecla.
const indexNowThrottle = new Map();
const INDEXNOW_MIN_INTERVAL_MS = 5 * 60 * 1000;

// Cursor-based pagination constants
const DEFAULT_DISHES_LIMIT = 50;
const MAX_DISHES_LIMIT = 100;

/**
 * POST /api/studio/save - Guardar restaurante/menú completo
 * Requiere sesión + casilla verificada + suscripción vigente (o gracia activa):
 * con el trial vencido y sin plan, el menú está pausado y no debería editar se
 * como si nada. Los gates de gracia post-trial viven en verifyAccess().
 * Rate limited a 5 req/min por tenant para guardados masivos con platos.
 */
router.post('/save', authMiddleware, requireVerifiedEmail, requireActiveSubscription, dishBulkSaveLimiter, async (req, res, next) => {
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
 * POST /api/studio/dishes - Crear un plato individual
 * Rate limited a 30 req/min por tenant, con validación de cuota por plan.
 */
router.post('/dishes', authMiddleware, requireVerifiedEmail, requireActiveSubscription, dishCreationLimiter, validateBody(DISH_SCHEMA), async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const restaurant = db.findRestaurantByUserId(userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });

    // Verificar cuota de platos
    const quota = billingOrchestrator.checkDishQuota(restaurant, 1);
    if (!quota.allowed) {
      return res.status(403).json({ success: false, error: quota.error, code: 'DISH_QUOTA_EXCEEDED', current: quota.current, max: quota.max });
    }

    const dishData = req.validatedBody;
    const cleanDish = sanitizeDish(dishData);

    if (!restaurant.dishes) restaurant.dishes = [];
    restaurant.dishes.push(cleanDish);

    const saved = await db.saveRestaurant(userId, restaurant);
    if (saved && saved.slug) {
      memoryCache.delete(saved.slug);
      await invalidateMenuCache(saved.slug);
    }

    auditService.logAction({
      tenantId: saved.id,
      userId,
      requestId: req.requestId,
      action: 'DISH_CREATE',
      entity: 'dish',
      details: { dishId: cleanDish.id, dishName: cleanDish.name }
    });

    return res.status(201).json({ success: true, dish: cleanDish, quota: { current: quota.current + 1, max: quota.max } });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/studio/dishes - Listar platos con paginación cursor-based
 * Query params: limit (default 50, max 100), after_id (cursor), categoryId (filtro)
 */
router.get('/dishes', authMiddleware, requireVerifiedEmail, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const restaurant = db.findRestaurantByUserId(userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });

    let dishes = Array.isArray(restaurant.dishes) ? [...restaurant.dishes] : [];

    // Filtrar por categoría si se provee
    const categoryId = req.query.categoryId;
    if (categoryId) {
      dishes = dishes.filter(d => d.categoryId === categoryId);
    }

    // Ordenar por createdAt si existe, sino por id (más recientes al final)
    dishes.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aTime !== bTime) return aTime - bTime;
      return String(a.id).localeCompare(String(b.id));
    });

    // Cursor-based pagination
    const limit = Math.min(parseInt(req.query.limit) || DEFAULT_DISHES_LIMIT, MAX_DISHES_LIMIT);
    const afterId = req.query.after_id;

    let startIndex = 0;
    if (afterId) {
      const foundIndex = dishes.findIndex(d => String(d.id) === String(afterId));
      if (foundIndex !== -1) startIndex = foundIndex + 1;
    }

    const page = dishes.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + limit < dishes.length ? page[page.length - 1]?.id : null;

    return res.json({
      success: true,
      data: page,
      pagination: {
        limit,
        nextCursor,
        hasMore: nextCursor !== null,
        total: dishes.length
      }
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * PATCH /api/studio/dishes/:id - Actualizar un plato individual
 */
router.patch('/dishes/:id', authMiddleware, requireVerifiedEmail, requireActiveSubscription, validateBody(DISH_SCHEMA.partial()), async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const restaurant = db.findRestaurantByUserId(userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });

    const dishId = req.params.id;
    const dishIndex = (restaurant.dishes || []).findIndex(d => d.id === dishId);
    if (dishIndex === -1) {
      return res.status(404).json({ error: 'Plato no encontrado' });
    }

    const updates = req.validatedBody;
    const cleanUpdates = sanitizeDish({ ...restaurant.dishes[dishIndex], ...updates });
    // Preservar ID original
    cleanUpdates.id = dishId;
    restaurant.dishes[dishIndex] = cleanUpdates;

    const saved = await db.saveRestaurant(userId, restaurant);
    if (saved && saved.slug) {
      memoryCache.delete(saved.slug);
      await invalidateMenuCache(saved.slug);
    }

    auditService.logAction({
      tenantId: saved.id,
      userId,
      requestId: req.requestId,
      action: 'DISH_UPDATE',
      entity: 'dish',
      details: { dishId, updatedFields: Object.keys(updates) }
    });

    return res.json({ success: true, dish: cleanUpdates });
  } catch (e) {
    return next(e);
  }
});

/**
 * DELETE /api/studio/dishes/:id - Eliminar un plato individual
 */
router.delete('/dishes/:id', authMiddleware, requireVerifiedEmail, requireActiveSubscription, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const restaurant = db.findRestaurantByUserId(userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });

    const dishId = req.params.id;
    const dish = (restaurant.dishes || []).find(d => d.id === dishId);
    if (!dish) {
      return res.status(404).json({ error: 'Plato no encontrado' });
    }

    restaurant.dishes = (restaurant.dishes || []).filter(d => d.id !== dishId);

    const saved = await db.saveRestaurant(userId, restaurant);
    if (saved && saved.slug) {
      memoryCache.delete(saved.slug);
      await invalidateMenuCache(saved.slug);
    }

    auditService.logAction({
      tenantId: saved.id,
      userId,
      requestId: req.requestId,
      action: 'DISH_DELETE',
      entity: 'dish',
      details: { dishId, dishName: dish.name }
    });

    return res.json({ success: true, message: 'Plato eliminado' });
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
const BRANCH_IDEMPOTENCY_PROVIDER = 'studio_branches';
router.patch('/branches', authMiddleware, requireVerifiedEmail, requireActiveSubscription, async (req, res, next) => {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
    if (idempotencyKey && processedBranchOperations.has(idempotencyKey)) {
      return res.json(processedBranchOperations.get(idempotencyKey));
    }
    // Persistencia cross-instancia: el Map en memoria se pierde en Vercel
    // (restart / otra réplica). El marcador vive además en la tabla `webhooks`
    // (provider studio_branches, local + cloud) con la respuesta guardada.
    if (idempotencyKey) {
      const prior = await db.getProcessedWebhookAsync(BRANCH_IDEMPOTENCY_PROVIDER, idempotencyKey);
      const priorResponse = prior && prior.data && prior.data.response;
      if (priorResponse) {
        processedBranchOperations.set(idempotencyKey, priorResponse);
        return res.json(priorResponse);
      }
      if (prior) {
        return res.json({
          success: true,
          message: 'Operación de sucursal ya procesada (idempotente)',
          idempotent: true
        });
      }
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
      // Marcador persistente (local + cloud): un retry post-restart o en otra
      // réplica devuelve la MISMA respuesta sin re-ejecutar la operación.
      // Fire-and-forget: nunca rompe la respuesta al Studio.
      db.markWebhookProcessed(BRANCH_IDEMPOTENCY_PROVIDER, idempotencyKey, result.action || operation, {
        operation,
        response: responsePayload
      }).catch(() => {});
    }

    return res.json(responsePayload);
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /api/studio/events - Crear un nuevo evento (restaurante temporal con expiración)
 */
const createEventSchema = z.object({
  name: z.string().min(1, { message: 'Nombre del evento requerido' }).max(80),
  slug: z.string().max(60).optional().default(''),
  eventDate: z.string().min(1, { message: 'Fecha del evento requerida' }).max(40),
  eventType: z.string().max(30).optional().default('private'),
  expiresAt: z.string().max(40).optional().default(''),
  description: z.string().max(500).optional().default(''),
  phone: z.string().max(30).optional().default(''),
  currency: z.string().max(5).optional().default('$'),
  theme: z.string().max(40).optional().default('neon'),
  layout: z.string().max(40).optional().default('neon'),
  dishes: z.array(z.record(z.any())).max(500).optional().default([]),
  categories: z.array(z.record(z.any())).max(100).optional().default([])
});
router.post('/events', authMiddleware, requireVerifiedEmail, requireActiveSubscription, validateBody(createEventSchema), async (req, res, next) => {
  try {
    const { name, slug, eventDate, eventType, expiresAt, description, phone, currency, theme, layout, dishes, categories } = req.validatedBody;

    if (Number.isNaN(new Date(eventDate).getTime())) {
      return res.status(400).json({ success: false, error: 'Fecha del evento inválida', code: 'INVALID_EVENT_DATE' });
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

// ── Sistema de Mozos y Cocina (Fase 1) ─────────────────────────────────────
// El dueño administra su equipo desde el Studio: alta, edición, baja, rotación
// del QR de turno y asignación de mesas. La credencial se muestra UNA sola vez
// (el servidor solo guarda su hash) y el QR apunta a /mozo con el secreto en el
// fragmento `#k=`, que el browser nunca envía al servidor.

const staffCreateSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.string().max(20).optional()
});

const staffUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  role: z.string().max(20).optional(),
  active: z.boolean().optional()
});

const staffTablesSchema = z.object({
  assignments: z.record(z.any()).optional().default({})
});

function ownerRestaurant(req) {
  return req.user && req.user.userId ? db.findRestaurantByUserId(req.user.userId) : null;
}

function appBaseUrl(req) {
  const configured = String(process.env.APP_URL || '').trim();
  if (configured) return configured;
  const host = req.get('host');
  return host ? `${req.protocol}://${host}` : '';
}

function sortTableLabels(a, b) {
  const na = /^\d+$/.test(a.number) ? Number(a.number) : null;
  const nb = /^\d+$/.test(b.number) ? Number(b.number) : null;
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return a.number.localeCompare(b.number, 'es');
}

function tablesForStaff(assignments, staffId) {
  const map = assignments && typeof assignments === 'object' ? assignments : {};
  return Object.entries(map)
    .filter(([, assigned]) => assigned === staffId)
    .map(([number]) => ({
      number,
      label: /^\d+$/.test(number) ? `Mesa ${number}` : number
    }))
    .sort(sortTableLabels);
}

function tablesView(assignments, staffList) {
  const byId = new Map((staffList || []).map((s) => [s.id, s]));
  const map = assignments && typeof assignments === 'object' ? assignments : {};
  return Object.entries(map)
    .map(([number, staffId]) => {
      const staff = byId.get(staffId);
      return {
        number,
        label: /^\d+$/.test(number) ? `Mesa ${number}` : number,
        staffId,
        staffName: staff ? staff.name : ''
      };
    })
    .sort(sortTableLabels);
}

/** Shape público del equipo: NUNCA incluye `credentialHash`. */
function publicStaffRecord(staff, { activeSessions = 0, tables = [] } = {}) {
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    roleLabel: staffRoleLabel(staff.role),
    active: staff.active !== false,
    credentialUpdatedAt: staff.credentialUpdatedAt || null,
    createdAt: staff.createdAt || null,
    updatedAt: staff.updatedAt || null,
    activeSessions,
    tables
  };
}

function staffPayload(staff, { sessions = [], assignments = {} } = {}) {
  const activeByStaff = new Map();
  for (const session of sessions) {
    if (session && session.staffId) activeByStaff.set(session.staffId, (activeByStaff.get(session.staffId) || 0) + 1);
  }
  return publicStaffRecord(staff, {
    activeSessions: activeByStaff.get(staff.id) || 0,
    tables: tablesForStaff(assignments, staff.id)
  });
}

/**
 * GET /api/studio/staff
 * Lista el equipo del local + el mapa de mesas. El dueño ve cuántas sesiones
 * de turno están vivas y qué mesas tiene cada persona.
 */
router.get('/staff', authMiddleware, requireVerifiedEmail, async (req, res, next) => {
  try {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const staff = await db.listStaff(restaurant.id);
    const sessions = await db.listStaffSessions({ restaurantId: restaurant.id, activeOnly: true });
    const assignments = restaurant.tableAssignments && typeof restaurant.tableAssignments === 'object'
      ? restaurant.tableAssignments
      : {};
    return res.json({
      success: true,
      staff: staff.map((person) => staffPayload(person, { sessions, assignments })),
      assignments,
      tables: tablesView(assignments, staff),
      restaurant: {
        id: restaurant.id,
        name: restaurant.name || restaurant.bizName || '',
        tableCount: Number(restaurant.tableCount) || 1
      }
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /api/studio/staff
 * Da de alta una persona y devuelve SU credencial de enrolamiento (una sola
 * vez). El cuerpo NO acepta `id` ni hash: los genera el servidor.
 */
router.post('/staff', authMiddleware, requireVerifiedEmail, requireActiveSubscription, validateBody(staffCreateSchema), async (req, res, next) => {
  try {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const name = sanitizeStaffName(req.validatedBody.name);
    if (!name) {
      return res.status(400).json({ success: false, error: 'El nombre del integrante es obligatorio.', code: 'INVALID_STAFF_NAME' });
    }
    const role = sanitizeStaffRole(req.validatedBody.role) || 'waiter';
    const now = new Date().toISOString();
    const id = generateStaffId();
    const credential = generateStaffSecret();
    const staff = await db.createStaff({
      id,
      restaurantId: restaurant.id,
      name,
      role,
      active: true,
      credentialHash: hashStaffSecret(credential),
      credentialUpdatedAt: now,
      createdBy: req.user.userId,
      createdAt: now,
      updatedAt: now
    });
    const enrollmentUrl = buildStaffEnrollmentUrl(appBaseUrl(req), {
      restaurantId: restaurant.id,
      staffId: id,
      secret: credential
    });

    auditService.logAction({
      tenantId: restaurant.id,
      userId: req.user.userId,
      requestId: req.requestId,
      action: 'STAFF_CREATED',
      entity: 'staff',
      details: { staffId: id, role }
    });

    return res.status(201).json({
      success: true,
      message: 'Integrante agregado. Mostrale el QR para que active su turno.',
      staff: staffPayload(staff, { assignments: restaurant.tableAssignments || {} }),
      credential,
      enrollmentUrl
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * PATCH /api/studio/staff/tables
 * Asigna mesas a personas reales del local. Rechaza ids ajenos o mesas
 * inválidas (nunca guarda una asignación que el mozo no pueda resolver).
 * NO toca `updatedAt`: asignar mesas no es editar la carta ni debe disparar un
 * 409 de concurrencia en el autosave.
 *
 * OJO ORDEN: esta ruta se declara ANTES de `/staff/:id`; si no, Express la
 * captura como el id literal "tables".
 */
router.patch('/staff/tables', authMiddleware, requireVerifiedEmail, requireActiveSubscription, validateBody(staffTablesSchema), async (req, res, next) => {
  try {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const raw = req.validatedBody.assignments || {};
    const entries = Object.entries(raw);
    if (entries.length > 200) {
      return res.status(400).json({
        success: false,
        error: 'No se pueden asignar más de 200 mesas.',
        code: 'TOO_MANY_TABLES'
      });
    }
    const staff = await db.listStaff(restaurant.id);
    const staffIds = new Set(staff.map((s) => s.id));
    const assignments = {};
    const seenTables = new Set();
    for (const [rawTable, rawStaffId] of entries) {
      const table = sanitizeTableNumber(rawTable);
      if (!table) {
        return res.status(400).json({
          success: false,
          error: `Número de mesa inválido: ${String(rawTable).slice(0, 40)}`,
          code: 'INVALID_TABLE_NUMBER'
        });
      }
      if (seenTables.has(table)) {
        return res.status(400).json({
          success: false,
          error: `La mesa ${table} está repetida.`,
          code: 'DUPLICATE_TABLE'
        });
      }
      seenTables.add(table);
      const staffId = typeof rawStaffId === 'string' ? rawStaffId.trim() : '';
      if (!staffId || !staffIds.has(staffId)) {
        return res.status(400).json({
          success: false,
          error: 'La asignación apunta a una persona que no pertenece a este local.',
          code: 'INVALID_STAFF_ID'
        });
      }
      assignments[table] = staffId;
    }

    const cleanAssignments = sanitizeTableAssignments(assignments, {
      isValidStaffId: (id) => staffIds.has(id)
    });
    await db.updateTableAssignments(restaurant.id, cleanAssignments);

    auditService.logAction({
      tenantId: restaurant.id,
      userId: req.user.userId,
      requestId: req.requestId,
      action: 'STAFF_TABLE_ASSIGN',
      entity: 'staff',
      details: { tableCount: Object.keys(cleanAssignments).length }
    });

    return res.json({
      success: true,
      assignments: cleanAssignments,
      tables: tablesView(cleanAssignments, staff)
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * PATCH /api/studio/staff/:id
 * Edita nombre/rol/activo. Desactivar revoca TODAS sus sesiones de turno.
 */
router.patch('/staff/:id', authMiddleware, requireVerifiedEmail, requireActiveSubscription, validateBody(staffUpdateSchema), async (req, res, next) => {
  try {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const existing = await db.findStaffById(req.params.id);
    if (!existing || existing.restaurantId !== restaurant.id) {
      return res.status(404).json({ success: false, error: 'Integrante no encontrado', code: 'STAFF_NOT_FOUND' });
    }

    const patch = {};
    const body = req.validatedBody;
    if (body.name !== undefined) {
      const name = sanitizeStaffName(body.name);
      if (!name) {
        return res.status(400).json({ success: false, error: 'El nombre del integrante es obligatorio.', code: 'INVALID_STAFF_NAME' });
      }
      patch.name = name;
    }
    if (body.role !== undefined) {
      const role = sanitizeStaffRole(body.role);
      if (!role) {
        return res.status(400).json({ success: false, error: 'Rol inválido. Usá mozo o cocina.', code: 'INVALID_STAFF_ROLE' });
      }
      patch.role = role;
    }
    if (body.active !== undefined) patch.active = body.active;

    const updated = await db.updateStaff(existing.id, patch);
    if (body.active === false) {
      await db.revokeStaffSessions(existing.id, restaurant.id);
    }

    auditService.logAction({
      tenantId: restaurant.id,
      userId: req.user.userId,
      requestId: req.requestId,
      action: 'STAFF_UPDATED',
      entity: 'staff',
      details: { staffId: existing.id, fields: Object.keys(patch) }
    });

    const sessions = await db.listStaffSessions({ restaurantId: restaurant.id, staffId: existing.id, activeOnly: true });
    const freshRestaurant = db.findRestaurantById(restaurant.id) || restaurant;
    return res.json({
      success: true,
      staff: staffPayload(updated || existing, {
        sessions,
        assignments: freshRestaurant.tableAssignments || {}
      })
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * DELETE /api/studio/staff/:id
 * Baja definitiva: borra persona, sesiones y sus mesas asignadas.
 */
router.delete('/staff/:id', authMiddleware, requireVerifiedEmail, requireActiveSubscription, async (req, res, next) => {
  try {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const existing = await db.findStaffById(req.params.id);
    if (!existing || existing.restaurantId !== restaurant.id) {
      return res.status(404).json({ success: false, error: 'Integrante no encontrado', code: 'STAFF_NOT_FOUND' });
    }
    await db.deleteStaff(existing.id, restaurant.id);

    auditService.logAction({
      tenantId: restaurant.id,
      userId: req.user.userId,
      requestId: req.requestId,
      action: 'STAFF_DELETED',
      entity: 'staff',
      details: { staffId: existing.id, role: existing.role }
    });

    return res.json({ success: true, deleted: true, staffId: existing.id });
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /api/studio/staff/:id/credential
 * Rota el secreto del QR de turno. El anterior deja de servir al instante y
 * TODAS las sesiones vivas se revocan (un QR filtrado no puede seguir entrando).
 */
router.post('/staff/:id/credential', authMiddleware, requireVerifiedEmail, requireActiveSubscription, async (req, res, next) => {
  try {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const existing = await db.findStaffById(req.params.id);
    if (!existing || existing.restaurantId !== restaurant.id) {
      return res.status(404).json({ success: false, error: 'Integrante no encontrado', code: 'STAFF_NOT_FOUND' });
    }
    if (existing.active === false) {
      return res.status(409).json({
        success: false,
        error: 'Reactivá a la persona antes de generar un QR nuevo.',
        code: 'STAFF_INACTIVE'
      });
    }

    const credential = generateStaffSecret();
    const now = new Date().toISOString();
    const updated = await db.updateStaff(existing.id, {
      credentialHash: hashStaffSecret(credential),
      credentialUpdatedAt: now
    });
    await db.revokeStaffSessions(existing.id, restaurant.id);

    const enrollmentUrl = buildStaffEnrollmentUrl(appBaseUrl(req), {
      restaurantId: restaurant.id,
      staffId: existing.id,
      secret: credential
    });

    auditService.logAction({
      tenantId: restaurant.id,
      userId: req.user.userId,
      requestId: req.requestId,
      action: 'STAFF_CREDENTIAL_ROTATED',
      entity: 'staff',
      details: { staffId: existing.id, role: existing.role }
    });

    const sessions = await db.listStaffSessions({ restaurantId: restaurant.id, staffId: existing.id, activeOnly: true });
    return res.json({
      success: true,
      message: 'QR regenerado. El anterior ya no sirve.',
      staff: staffPayload(updated || existing, {
        sessions,
        assignments: restaurant.tableAssignments || {}
      }),
      credential,
      enrollmentUrl
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * DELETE /api/studio/staff/:id/sessions
 * Botón de pánico: cierra todos los turnos abiertos de una persona sin rotar
 * el QR (el próximo turno puede volver a escanear el mismo cartel).
 */
router.delete('/staff/:id/sessions', authMiddleware, requireVerifiedEmail, requireActiveSubscription, async (req, res, next) => {
  try {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const existing = await db.findStaffById(req.params.id);
    if (!existing || existing.restaurantId !== restaurant.id) {
      return res.status(404).json({ success: false, error: 'Integrante no encontrado', code: 'STAFF_NOT_FOUND' });
    }
    const active = await db.listStaffSessions({ restaurantId: restaurant.id, staffId: existing.id, activeOnly: true });
    await db.revokeStaffSessions(existing.id, restaurant.id);

    auditService.logAction({
      tenantId: restaurant.id,
      userId: req.user.userId,
      requestId: req.requestId,
      action: 'STAFF_SESSIONS_REVOKED',
      entity: 'staff_session',
      details: { staffId: existing.id, revoked: active.length }
    });

    return res.json({ success: true, revoked: active.length });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;