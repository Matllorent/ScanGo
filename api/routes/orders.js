const express = require('express');
const { z } = require('zod');
const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { successResponse, errorResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const idempotencyMiddleware = require('../middleware/idempotency');
const { tenantGuard } = require('../middleware/tenantGuard');
const { validateAndPriceOrderLine } = require('../utils/menuOptions');
const AppError = require('../utils/AppError');

const router = express.Router();

const orderItemSchema = z.object({
  dishId: z.string().min(1, { message: 'ID de platillo requerido' }),
  quantity: z.number().int().positive({ message: 'La cantidad debe ser mayor a 0' }),
  note: z.string().trim().max(250).optional().default(''),
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
  notes: z.string().max(300).optional().default('')
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
        console.warn('[Supabase Insert Order Warning]', e.message);
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
 * Retrieve orders for a restaurant
 */
router.get('/restaurant/:id', async (req, res, next) => {
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

module.exports = router;
