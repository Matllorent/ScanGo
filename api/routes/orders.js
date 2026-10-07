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

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

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
  groupSessionId: z.string().max(100).optional().default('')
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
      created_at: utcNow
    };

    // Save to local DB memory adapter
    const orders = db.getAllOrders ? db.getAllOrders() : [];
    orders.push(orderRecord);

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

        if (!error && data) {
          return successResponse(res, data, 'Pedidos del restaurante recuperados');
        }
      } catch (e) {}
    }

    return successResponse(res, [], 'Pedidos del restaurante recuperados');
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
// Run cleanup every hour
setInterval(cleanupActiveGroupCarts, 60 * 60 * 1000);


/**
 * Canal de Supabase Realtime para un mesa específica
 */
function getGroupCartChannel(restaurantId, tableNumber) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const channelName = `group_cart:${restaurantId}:mesa:${tableNumber}`;
  return supabase.channel(channelName);
}

/**
 * Genera el ID único del carrito grupal
 */
function getGroupCartId(restaurantId, tableNumber) {
  return `${restaurantId}_mesa_${tableNumber}`;
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
            updatedAt: data.updated_at
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
    return successResponse(res, localData, 'Carrito grupal de mesa recuperado');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/group/:restaurantId/:tableNumber/sync
 * Sincroniza y consolida el estado del carrito grupal de la mesa.
 * Persiste en Supabase + emite broadcast Realtime si está disponible.
 */
router.post('/group/:restaurantId/:tableNumber/sync', groupCartLimiter, requireGroupCartCapability, async (req, res, next) => {
  try {
    const { restaurantId, tableNumber } = req.params;
    const { items = [], participants = [], action = 'sync', fromUser = '' } = req.body;
    const key = getGroupCartId(restaurantId, tableNumber);
    const supabase = getSupabaseClient();

    // Obtener participantes actuales para merge
    let currentParticipants = [];
    if (supabase) {
      try {
        const { data } = await supabase
          .from('group_carts')
          .select('participants')
          .eq('id', key)
          .single();
        if (data && data.participants) currentParticipants = data.participants;
      } catch (e) { /* ignore */ }
    } else {
      const current = activeGroupTableCarts.get(key);
      if (current && current.participants) currentParticipants = current.participants;
    }

    const mergedParticipants = Array.from(new Set([...currentParticipants, ...participants, fromUser].filter(Boolean)));

    const updatedState = {
      restaurantId,
      tableNumber: String(tableNumber),
      items,
      participants: mergedParticipants,
      lastAction: action,
      lastUser: fromUser,
      updatedAt: new Date().toISOString()
    };

    if (supabase) {
      try {
        // Upsert en Supabase
        await supabase.from('group_carts').upsert([{
          id: key,
          restaurant_id: restaurantId,
          table_number: String(tableNumber),
          items: items,
          participants: mergedParticipants,
          last_action: action,
          last_user: fromUser,
          updated_at: updatedState.updatedAt
        }]);

        // Emitir broadcast Realtime para sincronización en tiempo real
        const channel = getGroupCartChannel(restaurantId, tableNumber);
        if (channel) {
          await channel.send({
            type: 'broadcast',
            event: 'cart_updated',
            payload: updatedState
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
 * Elimina de Supabase + emite broadcast si está disponible.
 */
router.post('/group/:restaurantId/:tableNumber/clear', groupCartLimiter, requireGroupCartCapability, async (req, res, next) => {
  try {
    const { restaurantId, tableNumber } = req.params;
    const key = getGroupCartId(restaurantId, tableNumber);
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        await supabase.from('group_carts').delete().eq('id', key);

        // Emitir broadcast de limpieza
        const channel = getGroupCartChannel(restaurantId, tableNumber);
        if (channel) {
          await channel.send({
            type: 'broadcast',
            event: 'cart_cleared',
            payload: { restaurantId, tableNumber: String(tableNumber), cleared: true }
          });
        }
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.groupCart.clear',
          level: 'warn',
          tags: { restaurantId, tableNumber }
        });
      }
    }

    // Siempre limpiar memoria local
    activeGroupTableCarts.delete(key);
    return successResponse(res, { cleared: true }, 'Carrito grupal finalizado');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
