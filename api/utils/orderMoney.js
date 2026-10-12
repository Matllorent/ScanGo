/**
 * api/utils/orderMoney.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Dólar de la lógica MONETARIA de pedidos, extraída de api/routes/orders.js
 * (Bloque 2 — property testing del dinero). Vive acá para que las reglas de
 * cálculo sean una utilidad pura sin router ni I/O, testeable por properties
 * con PRNG seed fijo (tests/test-money-properties.js).
 *
 * - quoteOrderItems: cotiza cada línea contra la carta real (DISH_NOT_FOUND /
 *   INVALID_DISH_OPTIONS), con dinero en CENTAVOS (precisión sin float) y
 *   snapshot histórico por línea. `timestamp` ya era inyectable.
 * - resolveDeliveryFee: valida el fee declarado contra las zonas del local
 *   (INVALID_DELIVERY_FEE si no matchea ninguna); sin zonas declara confianza
 *   en lo declarado; modo LOCAL nunca cobra envío.
 * - resolveCouponDiscount: cupón desconocido (o mutado en el cliente) nunca
 *   rompe; `percent` acotado a [0,100] (clamp); `free_delivery` solo aplica
 *   en DELIVERY y descuenta exactamente el fee.
 */
const { validateAndPriceOrderLine } = require('./menuOptions');
const AppError = require('./AppError');

function quoteOrderItems(restaurant, items, timestamp = new Date().toISOString()) {
  let amountInCents = 0;
  const itemsSnapshot = items.map((item) => {
    const dish = (restaurant.dishes || []).find((candidate) => candidate.id === item.dishId);
    if (!dish) throw new AppError('Platillo no encontrado para el pedido', 400, 'DISH_NOT_FOUND');

    const pricing = validateAndPriceOrderLine(dish, item.choices, restaurant.modifierGroups || []);
    if (!pricing.valid) throw new AppError(pricing.error, 400, 'INVALID_DISH_OPTIONS');
    const totalItemAmountInCents = pricing.unitPriceInCents * item.quantity;
    amountInCents += totalItemAmountInCents;
    const category = (restaurant.categories || []).find((candidate) => candidate.id === dish.categoryId);

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

function resolveDeliveryFee(restaurant, orderMode, declaredFee) {
  if (orderMode !== 'DELIVERY') return 0;
  const fee = Math.max(0, Number(declaredFee) || 0);
  const zones = Array.isArray(restaurant.deliveryZones) ? restaurant.deliveryZones : [];
  if (!zones.length) return fee;
  const match = zones.some((z) => Number(z.fee) === fee);
  if (!match) {
    throw new AppError('Costo de envío inválido para la zona elegida.', 400, 'INVALID_DELIVERY_FEE');
  }
  return fee;
}

function resolveCouponDiscount({ restaurant, subtotal, deliveryFee, coupon, orderMode }) {
  if (!coupon || !coupon.code) return { discount: 0, coupon: null };
  const config = Array.isArray(restaurant.customCoupons) ? restaurant.customCoupons : [];
  const valid = config.find((c) => String(c.code || '').toUpperCase() === String(coupon.code).toUpperCase());
  // Cupón desconocido (o mutado en el cliente): no descuenta, no rompe.
  if (!valid) return { discount: 0, coupon: null };
  if (valid.type === 'percent') {
    const value = Math.min(100, Math.max(0, Number(valid.value) || 0));
    return {
      discount: Math.round(subtotal * (value / 100) * 100) / 100,
      coupon: { code: valid.code, type: 'percent', value, label: valid.label || `${value}% OFF` }
    };
  }
  if (valid.type === 'free_delivery' && orderMode === 'DELIVERY') {
    return {
      discount: deliveryFee,
      coupon: { code: valid.code, type: 'free_delivery', value: 0, label: valid.label || 'Envío Gratis' }
    };
  }
  return { discount: 0, coupon: null };
}

module.exports = { quoteOrderItems, resolveDeliveryFee, resolveCouponDiscount };