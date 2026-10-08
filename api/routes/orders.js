const express = require('express');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { successResponse, errorResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const idempotencyMiddleware = require('../middleware/idempotency');
const { tenantGuard } = require('../middleware/tenantGuard');
const { validateAndPriceOrderLine } = require('../utils/menuOptions');
const AppError = require('../utils/AppError');
const sentry = require('../utils/sentry');
const { groupCartLimiter } = require('../middleware/rateLimits');
const { verifyGroupCartToken } = require('../utils/groupCartToken');
const loyaltyService = require('../services/loyalty');
const notificationsService = require('../services/notifications');
const { signOrderToken, verifyOrderToken } = require('../utils/orderTrackingToken');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

// Estados del pedido que el dueño puede fijar y que el comensal ve en su
// seguimiento. Las etiquetas viajan en español para la vista pública.
const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'on_the_way', 'delayed', 'delivered', 'cancelled'];
const ORDER_STATUS_LABELS = {
  pending: 'Recibido',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  on_the_way: 'En camino',
  delayed: 'Demorado',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};

/**
 * Auth middleware inline (mirrors api/index.js) to protect order routes.
 * Verifies JWT from cookie or Authorization header and attaches req.user.
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.auth_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) {
    return res.status(401).json({ success: false, error: 'No autorizado', code: 'UNAUTHORIZED' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Token inválido o expirado', code: 'INVALID_TOKEN' });
  }
}

function requireGroupCartCapability(req, res, next) {
  const { restaurantId, tableNumber } = req.params;
  const token = req.headers['x-group-cart-token'];
  if (!verifyGroupCartToken(restaurantId, tableNumber, token)) {
    return res.status(403).json({ success: false, error: 'QR de mesa no autorizado', code: 'GROUP_CART_TOKEN_INVALID' });
  }
  next();
}

const orderItemSchema = z.object({
  dishId: z.string().min(1, { message: 'ID de platillo requerido' }),
  quantity: z.number().int().positive({ message: 'La cantidad debe ser mayor a 0' }),
  note: z.string().trim().max(250).optional().default(''),
  orderedBy: z.string().max(100).optional().default(''),
  orderedById: z.string().max(100).optional().default(''),
  choices: z.array(z.object({
    groupId: z.string().min(1).max(80),
    selections: z.array(z.object({
      optionId: z.string().min(1).max(80),
      quantity: z.number().int().positive().optional()
    })).max(100)
  })).max(50).optional().default([]),
  options: z.record(z.any()).optional().default({})
});

const createOrderSchema = z.object({
  restaurantId: z.string().min(1, { message: 'ID de restaurante requerido' }),
  tableNumber: z.union([z.string(), z.number()]).optional().default('1'),
  items: z.array(orderItemSchema).min(1, { message: 'El pedido debe contener al menos un producto' }),
  currency: z.string().max(5).optional().default('$'),
  customerName: z.string().max(100).optional().default('Cliente'),
  customerPhone: z.string().max(30).optional().default(''),
  deliveryAddress: z.string().max(200).optional().default(''),
  notes: z.string().max(300).optional().default(''),
  isGroupOrder: z.boolean().optional().default(false),
  participants: z.array(z.string()).optional().default([]),
  groupSessionId: z.string().max(100).optional().default(''),
  // Cupón aplicado en el frontend: se persiste como parte del snapshot del
  // pedido (auditoría de descuentos concedidos).
  coupon: z.object({
    code: z.string().min(1).max(30),
    type: z.string().max(20).optional().default('percent'),
    value: z.number().nonnegative().optional().default(0),
    label: z.string().max(60).optional().default('')
  }).optional().nullish().transform(v => v || undefined)
});

function quoteOrderItems(restaurant, items, timestamp = new Date().toISOString()) {
  let amountInCents = 0;
  const itemsSnapshot = items.map(item => {
    const dish = (restaurant.dishes || []).find(candidate => candidate.id === item.dishId);
    if (!dish) throw new AppError('Platillo no encontrado para el pedido', 400, 'DISH_NOT_FOUND');

    const pricing = validateAndPriceOrderLine(dish, item.choices, restaurant.modifierGroups || []);
    if (!pricing.valid) throw new AppError(pricing.error, 400, 'INVALID_DISH_OPTIONS');
    const totalItemAmountInCents = pricing.unitPriceInCents * item.quantity;
    amountInCents += totalItemAmountInCents;
    const category = (restaurant.categories || []).find(candidate => candidate.id === dish.categoryId);

    return {
      dishId: dish.id,
      name: dish.name,
      unitPrice: pricing.unitPriceInCents / 100,
      unitPriceInCents: pricing.unitPriceInCents,
      quantity: item.quantity,
      note: item.note || '',
      orderedBy: item.orderedBy || '',
      orderedById: item.orderedById || '',
      totalItemAmount: totalItemAmountInCents / 100,
      totalItemAmountInCents,
      categoryName: category ? category.name : 'General',
      optionsSnapshot: pricing.choicesSnapshot,
      snapshotTimestamp: timestamp
    };
  });

  return { itemsSnapshot, amountInCents };
}

/**
 * Busca un pedido para seguimiento: primero el espejo local (dev/offline) y
 * luego la tabla `orders` de Supabase (fuente de verdad cloud).
 */
async function findOrderForTracking(orderId) {
  const local = db.findOrderById(orderId);
  if (local) return local;
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).limit(1);
      if (!error && Array.isArray(data) && data[0]) return data[0];
    } catch (e) { /* seguimiento nunca rompe por un error de lectura */ }
  }
  return null;
}

router.post('/quote', validateBody(createOrderSchema), (req, res, next) => {
  try {
    const restaurant = db.findRestaurantById(req.body.restaurantId) || db.findRestaurantBySlug(req.body.restaurantId);
    if (!restaurant) throw new AppError('Restaurante no encontrado para la cotización', 404, 'RESTAURANT_NOT_FOUND');
    const quote = quoteOrderItems(restaurant, req.body.items);
    return successResponse(res, {
      ...quote,
      amount: quote.amountInCents / 100,
      currency: req.body.currency || restaurant.currency || '$'
    }, 'Cotización validada');
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders
 * Creates a new order with monetary precision and historical item snapshots
 */
router.post('/', idempotencyMiddleware, validateBody(createOrderSchema), async (req, res, next) => {
  try {
    const { restaurantId, tableNumber, items, currency, customerName, customerPhone, deliveryAddress, notes } = req.body;

    const restaurant = db.findRestaurantById(restaurantId) || db.findRestaurantBySlug(restaurantId);
    if (!restaurant) {
      throw new AppError('Restaurante no encontrado para el pedido', 404, 'RESTAURANT_NOT_FOUND');
    }

    const orderCurrency = currency || restaurant.currency || 'USD';
    const utcNow = new Date().toISOString();

    const { itemsSnapshot, amountInCents } = quoteOrderItems(restaurant, items, utcNow);

    const orderRecord = {
      id: 'ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      restaurant_id: restaurant.id,
      restaurantId: restaurant.id,
      table_number: String(tableNumber),
      tableNumber: String(tableNumber),
      items_snapshot: itemsSnapshot,
      itemsSnapshot: itemsSnapshot,
      amount: amountInCents / 100,
      total: amountInCents / 100,
      amount_in_cents: amountInCents,
      currency: orderCurrency,
      status: 'pending',
      customer_name: customerName,
      customer_phone: customerPhone,
      delivery_address: deliveryAddress,
      notes: notes,
      is_group_order: Boolean(req.body.isGroupOrder),
      isGroupOrder: Boolean(req.body.isGroupOrder),
      participants: req.body.participants || [],
      group_session_id: req.body.groupSessionId || '',
      coupon: req.body.coupon || null,
      created_at: utcNow
    };

    // Token de seguimiento SIN estado (HMAC del id): el comensal lo guarda y
    // con él consulta el estado sin exponer datos personales.
    orderRecord.trackingToken = signOrderToken(orderRecord.id);

    // Espejo local (dev/offline). En cloud la fuente de verdad es Supabase.
    await db.addOrder(orderRecord);

    // Save to Supabase Cloud PostgreSQL
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('orders').insert([{
          id: orderRecord.id,
          restaurant_id: orderRecord.restaurant_id,
          table_number: orderRecord.table_number,
          items_snapshot: orderRecord.items_snapshot,
          amount: orderRecord.amount,
          amount_in_cents: orderRecord.amount_in_cents,
          currency: orderRecord.currency,
          status: orderRecord.status,
          customer_name: orderRecord.customer_name,
          customer_phone: orderRecord.customer_phone,
          created_at: orderRecord.created_at
        }]);
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.insert',
          level: 'warn',
          tags: { restaurantId: restaurant.id },
          extra: { orderId: orderRecord.id }
        });
      }
    }

    // Fidelización: acreditación automática de puntos/sellos (local + global).
    // El servicio captura sus propios errores: un problema aquí JAMÁS rompe el
    // alta del pedido ni la respuesta al comensal.
    const loyaltyResult = await loyaltyService.creditOrder({
      restaurant,
      customerPhone,
      customerName,
      orderId: orderRecord.id,
      amountInCents
    });
    if (loyaltyResult.credited) {
      orderRecord.loyalty = {
        credited: true,
        points: loyaltyResult.points,
        stamps: loyaltyResult.stamps,
        unlocks: loyaltyResult.unlocks
      };
    }

    return successResponse(
      res,
      orderRecord,
      'Pedido registrado exitosamente con snapshot histórico de precios',
      201
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/track/:token
 * Público: el comensal consulta el estado de su pedido con el token firmado
 * que recibió al pedir. Devuelve SOLO estado + resumen — nunca teléfono,
 * nombre, dirección ni notas.
 */
router.get('/track/:token', async (req, res, next) => {
  try {
    const orderId = verifyOrderToken(req.params.token);
    if (!orderId) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }
    const order = await findOrderForTracking(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    const orderRestaurantId = order.restaurant_id || order.restaurantId;
    const restaurant = db.findRestaurantById(orderRestaurantId);
    const status = ORDER_STATUSES.includes(order.status) ? order.status : 'pending';

    return successResponse(res, {
      orderId: order.id,
      status,
      statusLabel: ORDER_STATUS_LABELS[status],
      restaurantName: restaurant ? (restaurant.name || restaurant.bizName || '') : '',
      tableNumber: order.table_number || order.tableNumber || '',
      currency: order.currency || '$',
      total: order.amount != null ? order.amount : order.total,
      items: (order.items_snapshot || order.itemsSnapshot || []).map(line => ({
        name: line.name,
        quantity: line.quantity
      })),
      updatedAt: order.status_updated_at || order.created_at
    }, 'Estado del pedido');
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/orders/status/:orderId
 * Dueño (tenant-guarded): avanza el estado del pedido. Persiste en el espejo
 * local + Supabase y avisa por push SOLO al comensal que hizo el pedido (por
 * teléfono). El push es best-effort: nunca rompe la actualización de estado.
 */
router.patch('/status/:orderId', requireAuth, tenantGuard, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body || {};

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Estado de pedido inválido', code: 'INVALID_ORDER_STATUS' });
    }

    const order = await findOrderForTracking(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    const orderRestaurantId = order.restaurant_id || order.restaurantId;
    const tenantId = req.tenantId || (req.user && req.user.tenantId);
    if (tenantId && orderRestaurantId !== tenantId) {
      return res.status(403).json({ success: false, error: 'El pedido pertenece a otro local', code: 'ORDER_TENANT_MISMATCH' });
    }

    const updatedAt = new Date().toISOString();

    // 1) Espejo local
    const localUpdated = await db.updateOrderStatus(orderId, status, updatedAt);
    if (!localUpdated) {
      await db.addOrder({ ...order, status, status_updated_at: updatedAt });
    }

    // 2) Supabase (fuente de verdad cloud). Degrada si falta status_updated_at.
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('orders')
          .update({ status, status_updated_at: updatedAt })
          .eq('id', orderId);
        if (error && /status_updated_at/i.test(error.message || '')) {
          await supabase.from('orders').update({ status }).eq('id', orderId);
        }
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.updateStatus',
          level: 'warn',
          tags: { restaurantId: orderRestaurantId },
          extra: { orderId, status }
        });
      }
    }

    // 3) Aviso al comensal (best-effort; jamás rompe la actualización).
    let notification;
    try {
      const restaurant = db.findRestaurantById(orderRestaurantId);
      notification = await notificationsService.sendOrderStatusNotification({
        restaurantId: orderRestaurantId,
        customerPhone: order.customer_phone || order.customerPhone,
        status,
        orderId,
        slug: restaurant ? restaurant.slug : '',
        restaurantName: restaurant ? (restaurant.name || restaurant.bizName) : ''
      });
    } catch (e) {
      notification = { sent: false, error: e.code || e.message };
    }

    return successResponse(res, {
      orderId,
      status,
      statusLabel: ORDER_STATUS_LABELS[status],
      updatedAt,
      notification
    }, 'Estado del pedido actualizado');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/restaurant/:id
 * Retrieve orders for a restaurant (tenant-isolated, IDOR-protected)
 */
router.get('/restaurant/:id', requireAuth, tenantGuard, async (req, res, next) => {
  try {
    const restaurantId = req.params.id;
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          return successResponse(res, data, 'Pedidos del restaurante recuperados');
        }
      } catch (e) {}
    }

    // Sin cloud (o sin filas todavía): espejo local ordenado por fecha.
    const localOrders = db.getOrders()
      .filter(o => (o.restaurant_id || o.restaurantId) === restaurantId)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return successResponse(res, localOrders, 'Pedidos del restaurante recuperados');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/mercadopago/preference
 * Genera una preferencia de pago directa de Mercado Pago Checkout Pro
 */
const mpService = require('../../src/services/mercadopago');

router.post('/mercadopago/preference', validateBody(createOrderSchema), async (req, res, next) => {
  try {
    const { restaurantId, items, customerName, currency } = req.body;
    const restaurant = db.findRestaurantById(restaurantId) || db.findRestaurantBySlug(restaurantId);
    if (!restaurant) {
      throw new AppError('Restaurante no encontrado para el pago', 404, 'RESTAURANT_NOT_FOUND');
    }

    if (!mpService.isConfigured()) {
      throw new AppError('Mercado Pago no está configurado en el servidor', 500, 'MP_NOT_CONFIGURED');
    }

    const { itemsSnapshot, amountInCents } = quoteOrderItems(restaurant, items);
    const orderCurrency = currency || restaurant.currency || 'UYU';
    const currencyId = ['UYU', '$U', '$'].includes(orderCurrency) ? 'UYU' : (orderCurrency === 'ARS' ? 'ARS' : 'USD');

    const mpItems = itemsSnapshot.map(item => {
      let desc = item.name;
      if (item.optionsSnapshot && item.optionsSnapshot.length) {
        const opts = item.optionsSnapshot.flatMap(g => (g.selections || []).map(s => s.name)).join(', ');
        if (opts) desc += ` (${opts})`;
      }
      return {
        id: item.dishId,
        title: `${item.quantity}x ${desc}`.slice(0, 255),
        quantity: 1,
        unit_price: item.totalItemAmount,
        currency_id: currencyId
      };
    });

    const externalRef = `ord_${Date.now()}_${restaurant.id.slice(0, 8)}`;
    const returnBase = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

    const preference = await mpService.createPreference({
      items: mpItems,
      payer: {
        name: customerName || 'Cliente ScanGo',
        email: 'pedido@menupizarron.com'
      },
      externalReference: externalRef,
      backUrls: {
        success: `${returnBase}/m/${restaurant.slug}?payment=success&ref=${externalRef}`,
        failure: `${returnBase}/m/${restaurant.slug}?payment=failure&ref=${externalRef}`,
        pending: `${returnBase}/m/${restaurant.slug}?payment=pending&ref=${externalRef}`
      },
      autoReturn: 'approved'
    });

    return successResponse(res, {
      preferenceId: preference.id,
      initPoint: preference.init_point,
      sandboxInitPoint: preference.sandbox_init_point,
      externalReference: externalRef,
      total: amountInCents / 100
    }, 'Preferencia de Checkout Pro generada exitosamente');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/realtime-config
 * Proporciona credenciales públicas seguras para Supabase Realtime Channels.
 * NUNCA expone SUPABASE_SERVICE_ROLE_KEY — solo la anon key pública.
 */
router.get('/realtime-config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
  return successResponse(res, {
    supabaseUrl,
    supabaseKey,
    enabled: Boolean(supabaseUrl && supabaseKey)
  }, 'Configuración de tiempo real recuperada');
});

/**
 * Almacén en memoria de pedidos grupales activos por mesa (fallback local)
 * Estructura: key = `${restaurantId}_mesa_${tableNumber}` -> { items: [], participants: [], updatedAt: string }
 */
const activeGroupTableCarts = new Map();

// TTL cleanup for active group carts (24h max age)
const GROUP_CART_TTL_MS = 24 * 60 * 60 * 1000;
function cleanupActiveGroupCarts() {
  const now = Date.now();
  for (const [key, cart] of activeGroupTableCarts.entries()) {
    if (cart.lastActivity && (now - cart.lastActivity > GROUP_CART_TTL_MS)) {
      activeGroupTableCarts.delete(key);
      console.log('[GroupCart] Cleaned up expired cart:', key);
    }
  }
}
// Run cleanup every hour. `unref()` para que el timer no mantenga vivo el
// process en tests (que hacen require de api/index): sin esto, cualquier suite
// que lo importe se quedaba colgada para siempre después de pasar.
const groupCartCleanupTimer = setInterval(cleanupActiveGroupCarts, 60 * 60 * 1000);
if (typeof groupCartCleanupTimer.unref === 'function') groupCartCleanupTimer.unref();


/**
 * Genera el ID único del carrito grupal
 */
function getGroupCartId(restaurantId, tableNumber) {
  return `${restaurantId}_mesa_${tableNumber}`;
}

/**
 * Tombstones (IDs de items eliminados) de carritos grupales en memoria.
 * Clave: `tombstones:${getGroupCartId(restaurantId, tableNumber)}`.
 * Sirven para que un union-merge persistente NO resucite items borrados
 * por otro comensal. Se mantienen en memoria (TTL manual de 24h, igual que
 * activeGroupTableCarts) y se replican en la respuesta del sync para que el
 * cliente pueda purgar items locales fantasma.
 */
const activeGroupTableTombstones = new Map();
function cleanupActiveGroupTombstones() {
  const now = Date.now();
  for (const [key, entry] of activeGroupTableTombstones.entries()) {
    if (entry.expiresAt && now > entry.expiresAt) {
      activeGroupTableTombstones.delete(key);
    }
  }
}
const tombstoneCleanupTimer = setInterval(cleanupActiveGroupTombstones, 60 * 60 * 1000);
if (typeof tombstoneCleanupTimer.unref === 'function') tombstoneCleanupTimer.unref();

/**
 * Devuelve los tombstones actuales de un carrito (IDs de items eliminados).
 */
function tombstonesFor(key) {
  const entry = activeGroupTableTombstones.get(`tombstones:${key}`);
  return entry && Array.isArray(entry.ids) ? entry.ids : [];
}

/**
 * Devuelve un ID estable para un item del carrito grupal (clave de merge).
 */
function getCartItemId(item) {
  return item?.cartItemId || `cart_${item?.dish?.id || item?.dishId}_${item?.orderedById || 'anon'}`;
}

/**
 * Broadcast a un canal Supabase Realtime para notificar a los clientes de la
 * mesa. En vez de subscribe→send→unsubscribe por request (que en realtime-js
 * 2.x dispara RangeError: Maximum call stack size exceeded al encadenar
 * _schedulePendingDisconnect/_cancelPendingDisconnect), se mantiene un POOL de
 * canales persistentes: cada `channelName` se suscribe UNA vez y se reutiliza
 * para múltiples broadcasts, liberándose tras un período de inactividad.
 * `channel.send()` sin `subscribe()` previo NO envía nada (los paquetes se
 * encolan en un socket inexistente) — por eso el broadcast histórico del
 * server estaba completamente muerto.
 */
const serverBroadcastChannels = new Map(); // channelName -> { channel, lastUsedAt }
const BROADCAST_CHANNEL_IDLE_MS = 10 * 60 * 1000;

function cleanupServerBroadcastChannels() {
  const now = Date.now();
  for (const [channelName, entry] of serverBroadcastChannels.entries()) {
    if (now - entry.lastUsedAt > BROADCAST_CHANNEL_IDLE_MS) {
      try { entry.channel.unsubscribe(); } catch (e) { /* ignore */ }
      serverBroadcastChannels.delete(channelName);
    }
  }
}
const broadcastChannelCleanupTimer = setInterval(cleanupServerBroadcastChannels, 2 * 60 * 1000);
if (typeof broadcastChannelCleanupTimer.unref === 'function') broadcastChannelCleanupTimer.unref();

async function broadcastToTableChannel(supabase, channelName, event, payload) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      resolve(err);
    };

    let entry = serverBroadcastChannels.get(channelName);
    if (!entry) {
      try {
        const channel = supabase.channel(channelName, { config: { private: true } });
        entry = { channel, lastUsedAt: Date.now() };
        serverBroadcastChannels.set(channelName, entry);
      } catch (e) {
        return done(e);
      }
    }

    const channel = entry.channel;

    if (!entry.subscribed) {
      const timeout = setTimeout(() => {
        serverBroadcastChannels.delete(channelName);
        done(new Error('broadcast subscribe timeout'));
      }, 2500);

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          entry.subscribed = true;
          entry.lastUsedAt = Date.now();
          channel.send({ type: 'broadcast', event, payload })
            .then(() => done())
            .catch((err) => {
              serverBroadcastChannels.delete(channelName);
              done(err);
            });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timeout);
          serverBroadcastChannels.delete(channelName);
          done(new Error(`broadcast channel status: ${status}`));
        }
      });
      return;
    }

    entry.lastUsedAt = Date.now();
    channel.send({ type: 'broadcast', event, payload })
      .then(() => done())
      .catch((err) => {
        serverBroadcastChannels.delete(channelName);
        done(err);
      });
  });
}

/**
 * GET /api/orders/group/:restaurantId/:tableNumber
 * Recupera el carrito grupal activo de la mesa.
 * Usa Supabase si está disponible, si no fallback a memoria local.
 */
router.get('/group/:restaurantId/:tableNumber', groupCartLimiter, requireGroupCartCapability, async (req, res, next) => {
  try {
    const { restaurantId, tableNumber } = req.params;
    const key = getGroupCartId(restaurantId, tableNumber);
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('group_carts')
          .select('*')
          .eq('id', key)
          .single();

        if (!error && data) {
          return successResponse(res, {
            restaurantId: data.restaurant_id,
            tableNumber: data.table_number,
            items: data.items || [],
            participants: data.participants || [],
            lastAction: data.last_action,
            lastUser: data.last_user,
            updatedAt: data.updated_at,
            deletedItemIds: tombstonesFor(key)
          }, 'Carrito grupal de mesa recuperado');
        }
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.groupCart.get',
          level: 'warn',
          tags: { restaurantId, tableNumber }
        });
      }
    }

    // Fallback a memoria local
    const localData = activeGroupTableCarts.get(key) || { items: [], participants: [], updatedAt: new Date().toISOString() };
    return successResponse(res, {
      ...localData,
      deletedItemIds: tombstonesFor(key)
    }, 'Carrito grupal de mesa recuperado');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/group/:restaurantId/:tableNumber/sync
 * Sincroniza y consolida el estado del carrito grupal de la mesa.
 * Usa union-merge por cartItemId con tombstones: nunca pierde items de otros
 * comensales que hicieron sync concurrente, y no resucita items eliminados.
 * Persiste en Supabase + emite broadcast Realtime al MISMO canal que escuchan
 * los clientes (`realtime:<slug>:mesa_<N>:<groupToken>`, evento `cart_update`).
 */
router.post('/group/:restaurantId/:tableNumber/sync', groupCartLimiter, requireGroupCartCapability, async (req, res, next) => {
  try {
    const { restaurantId, tableNumber } = req.params;
    const { items = [], participants = [], action = 'sync', fromUser = '', fromUserId = '', deletedCartItemIds = [], restaurantSlug = '' } = req.body;
    const key = getGroupCartId(restaurantId, tableNumber);
    const supabase = getSupabaseClient();
    const groupToken = (req.headers['x-group-cart-token'] || '').trim();

    // Estado actual: items existentes + participantes (para merge no destructivo)
    let existingItems = [];
    let currentParticipants = [];
    if (supabase) {
      try {
        const { data } = await supabase
          .from('group_carts')
          .select('items, participants')
          .eq('id', key)
          .single();
        if (data) {
          existingItems = Array.isArray(data.items) ? data.items : [];
          currentParticipants = Array.isArray(data.participants) ? data.participants : [];
        }
      } catch (e) { /* ignore */ }
    } else {
      const current = activeGroupTableCarts.get(key);
      if (current) {
        existingItems = Array.isArray(current.items) ? current.items : [];
        currentParticipants = Array.isArray(current.participants) ? current.participants : [];
      }
    }

    // Tombstones del carrito (anti-resurrección de items borrados)
    const tombKey = `tombstones:${key}`;
    const tombstoneEntry = activeGroupTableTombstones.get(tombKey);
    const tombstones = new Set(tombstoneEntry ? tombstoneEntry.ids : []);

    // Union-merge por cartItemId: preserva items de otros comensales y respeta tombstones
    const mergedById = new Map();
    existingItems.forEach(item => {
      const id = getCartItemId(item);
      if (!tombstones.has(id)) mergedById.set(id, item);
    });
    (Array.isArray(items) ? items : []).forEach(item => {
      const id = getCartItemId(item);
      if (tombstones.has(id)) return;
      mergedById.set(id, item);
    });

    // Procesar eliminaciones explícitas (tombstone + borrado del merge)
    const deletedIds = new Set(
      (Array.isArray(deletedCartItemIds) ? deletedCartItemIds : []).map(id => String(id)).filter(Boolean)
    );
    if (action === 'remove' && req.body.item?.cartItemId) deletedIds.add(String(req.body.item.cartItemId));
    deletedIds.forEach(id => {
      mergedById.delete(id);
      tombstones.add(id);
    });

    const mergedItems = Array.from(mergedById.values());
    const mergedParticipants = Array.from(new Set([...currentParticipants, ...participants, fromUser].filter(Boolean)));

    const updatedState = {
      restaurantId,
      tableNumber: String(tableNumber),
      items: mergedItems,
      participants: mergedParticipants,
      lastAction: action,
      lastUser: fromUser,
      updatedAt: new Date().toISOString()
    };

    // Conservar tombstones 24h (expiran junto con el carrito)
    activeGroupTableTombstones.set(tombKey, {
      ids: Array.from(tombstones).slice(-200),
      expiresAt: Date.now() + GROUP_CART_TTL_MS
    });

    if (supabase) {
      try {
        // Upsert en Supabase
        await supabase.from('group_carts').upsert([{
          id: key,
          restaurant_id: restaurantId,
          table_number: String(tableNumber),
          items: mergedItems,
          participants: mergedParticipants,
          last_action: action,
          last_user: fromUser,
          updated_at: updatedState.updatedAt
        }]);

        // Broadcasting al canal de los clientes (no bloquea la respuesta)
        if (restaurantSlug && groupToken) {
          const fullCart = {};
          mergedItems.forEach(item => { fullCart[getCartItemId(item)] = item; });
          const channelName = `realtime:${restaurantSlug}:mesa_${tableNumber}:${groupToken}`;
          broadcastToTableChannel(supabase, channelName, 'cart_update', {
            action: (action === 'remove') ? 'remove' : 'sync',
            fullCart,
            participants: mergedParticipants,
            fromUser,
            fromUserId,
            fromServer: true,
            tableNumber: String(tableNumber)
          }).catch(() => {
            sentry.captureMessage('groupCart.serverBroadcast.sync', {
              source: 'orders.groupCart.sync',
              level: 'warn',
              tags: { restaurantId, tableNumber, channelName }
            });
          });
        }
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.groupCart.sync',
          level: 'warn',
          tags: { restaurantId, tableNumber }
        });
      }
    }

    // Siempre actualizar memoria local como fallback/cache
    activeGroupTableCarts.set(key, updatedState);
    return successResponse(res, updatedState, 'Carrito grupal sincronizado exitosamente');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/group/:restaurantId/:tableNumber/clear
 * Limpia el carrito grupal una vez enviado el pedido.
 * Limpia items + tombstones en Supabase + broadcast al canal de clientes.
 * Los participantes se conservan: las personas siguen sentadas en la mesa y
 * pueden iniciar una nueva ronda.
 */
router.post('/group/:restaurantId/:tableNumber/clear', groupCartLimiter, requireGroupCartCapability, async (req, res, next) => {
  try {
    const { restaurantId, tableNumber } = req.params;
    const { restaurantSlug = '', fromUser = '' } = req.body || {};
    const key = getGroupCartId(restaurantId, tableNumber);
    const supabase = getSupabaseClient();
    const groupToken = (req.headers['x-group-cart-token'] || '').trim();

    let participants = [];

    if (supabase) {
      try {
        const { data } = await supabase
          .from('group_carts')
          .select('participants')
          .eq('id', key)
          .single();
        if (data && Array.isArray(data.participants)) participants = data.participants;
      } catch (e) { /* ignore */ }

      try {
        await supabase.from('group_carts').upsert([{
          id: key,
          restaurant_id: restaurantId,
          table_number: String(tableNumber),
          items: [],
          participants: participants,
          last_action: 'clear',
          last_user: fromUser,
          updated_at: new Date().toISOString()
        }]);
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.groupCart.clear',
          level: 'warn',
          tags: { restaurantId, tableNumber }
        });
      }
    }

    // Limpiar tombstone + carrito en memoria local
    activeGroupTableTombstones.delete(`tombstones:${key}`);
    const localData = activeGroupTableCarts.get(key);
    const nextParticipants = participants.length ? participants : (localData?.participants || []);
    activeGroupTableCarts.set(key, {
      restaurantId,
      tableNumber: String(tableNumber),
      items: [],
      participants: nextParticipants,
      lastAction: 'clear',
      lastUser: fromUser,
      updatedAt: new Date().toISOString()
    });

    // Broadcast al canal de los clientes: todos deben vaciar su carrito local
    if (supabase && restaurantSlug && groupToken) {
      const channelName = `realtime:${restaurantSlug}:mesa_${tableNumber}:${groupToken}`;
      broadcastToTableChannel(supabase, channelName, 'cart_update', {
        action: 'clear',
        fullCart: {},
        cart: {},
        participants: nextParticipants,
        fromUser,
        fromServer: true,
        tableNumber: String(tableNumber)
      }).catch(() => {
        sentry.captureMessage('groupCart.serverBroadcast.clear', {
          source: 'orders.groupCart.clear',
          level: 'warn',
          tags: { restaurantId, tableNumber, channelName }
        });
      });
    }

    return successResponse(res, { cleared: true, participants: nextParticipants }, 'Carrito grupal finalizado');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
