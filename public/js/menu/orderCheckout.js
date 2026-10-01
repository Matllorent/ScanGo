/**
 * public/js/menu/orderCheckout.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Order Checkout, Payment Handlers, Bill Splitting & WhatsApp formatting
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Handles changes to the selected payment method, toggling Mercado Pago link box if configured.
 * @param {string} paymentMethod Selected payment method name
 * @param {object} elements DOM elements { externalBox, btnExternal }
 * @param {string} paymentLink Restaurant's direct payment link URL
 */
export function handleOrderPaymentChange(paymentMethod, elements = {}, paymentLink = '') {
  const { externalBox, btnExternal } = elements;
  if (!externalBox) return;

  if (paymentMethod && paymentMethod.includes('Mercado Pago') && paymentLink) {
    externalBox.style.display = 'block';
    if (btnExternal) btnExternal.href = paymentLink;
  } else {
    externalBox.style.display = 'none';
  }
}

/**
 * Calculates per-person split for the bill splitter tool.
 * @param {number} total Total cart order amount
 * @param {number} peopleCount Number of people splitting
 * @returns {number} Amount per person rounded to 2 decimals
 */
export function calculateSplitPerPerson(total, peopleCount) {
  const count = Math.max(1, parseInt(peopleCount, 10) || 1);
  return Math.round((total / count) * 100) / 100;
}

/**
 * Computes discount amount from coupon.
 * @param {number} subtotal Cart items subtotal
 * @param {number} deliveryFee Delivery fee if applicable
 * @param {object|null} coupon Active coupon object { type: 'percent'|'free_delivery', value: number }
 * @param {string} mode 'DELIVERY' | 'LOCAL' | 'TAKEAWAY'
 * @returns {number} Discount amount
 */
export function calculateCouponDiscount(subtotal, deliveryFee, coupon, mode) {
  if (!coupon) return 0;
  if (coupon.type === 'percent') {
    return Math.round(subtotal * (coupon.value / 100) * 100) / 100;
  }
  if (coupon.type === 'free_delivery' && mode === 'DELIVERY') {
    return deliveryFee;
  }
  return 0;
}

/**
 * Formats structured order message for WhatsApp submission.
 */
export function formatWhatsAppOrderMessage(params) {
  const {
    restaurantName = 'RESTAURANTE',
    customerName = 'Cliente',
    mode = 'LOCAL',
    tableNumber = '1',
    address = '',
    paymentMethod = 'Efectivo',
    notes = '',
    currency = '$',
    items = [],
    subtotal = 0,
    deliveryFee = 0,
    discountAmount = 0,
    total = 0,
    isGroupOrder = false,
    paymentLink = ''
  } = params;

  let msg = isGroupOrder
    ? `👥 *PEDIDO GRUPAL COLABORATIVO - ${restaurantName.toUpperCase()}*\n`
    : `📋 *NUEVO PEDIDO - ${restaurantName.toUpperCase()}*\n`;

  msg += `👤 *Cliente:* ${customerName}\n`;
  if (mode === 'LOCAL') {
    const formattedTable = tableNumber ? (tableNumber.toLowerCase().includes('mesa') ? tableNumber : `Mesa ${tableNumber}`) : 'Mesa no especificada';
    msg += `🍽️ *Modalidad:* En el local - *${formattedTable}*\n`;
  } else if (mode === 'DELIVERY') {
    msg += `🛵 *Modalidad:* Envío a domicilio\n📍 *Dirección:* ${address || 'No indicada'}\n`;
  } else {
    msg += `🛍️ *Modalidad:* Para retirar (Take Away)\n`;
  }

  msg += `💵 *Forma de pago:* ${paymentMethod}\n`;
  if (notes) msg += `📝 *Observaciones:* ${notes}\n`;

  msg += `\n🛒 *DETALLE DEL PEDIDO:*\n`;
  items.forEach(item => {
    const dish = item.dish || {};
    const qty = item.qty || 1;
    const price = (dish.price || 0) * qty;
    msg += `▪ ${qty}x ${dish.name} - ${currency} ${price.toFixed(2)}\n`;
    if (item.note) msg += `   └ Nota: ${item.note}\n`;
    if (item.orderedBy) msg += `   └ Pedido por: ${item.orderedBy}\n`;
  });

  msg += `\n───────────────\n`;
  msg += `Subtotal: ${currency} ${subtotal.toFixed(2)}\n`;
  if (mode === 'DELIVERY' && deliveryFee > 0) {
    msg += `Costo de envío: ${currency} ${deliveryFee.toFixed(2)}\n`;
  }
  if (discountAmount > 0) {
    msg += `Descuento: -${currency} ${discountAmount.toFixed(2)}\n`;
  }
  msg += `*TOTAL: ${currency} ${total.toFixed(2)}*\n`;

  if (paymentMethod.includes('Mercado Pago') && paymentLink) {
    msg += `\n💳 *Link de Pago:* ${paymentLink}\n`;
  }

  msg += `\n_Pedido realizado a través de Menú Pizarrón_`;
  return msg;
}
