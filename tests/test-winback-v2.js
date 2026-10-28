/**
 * tests/test-winback-v2.js
 * ────────────────────────
 * F8-v2 — El cupón de recupero se puede CANJEAR de verdad.
 *
 * Hallazgo que motiva la suite: el circuito estaba a medias. El cupón
 * `VOL-XXXXXXXX` se emitía y se mandaba por email, pero era imposible usarlo:
 *  - `applyCoupon()` del menú comparaba SOLO contra `restaurant.customCoupons`
 *    (el catálogo público del dueño) y rechazaba el código en el navegador;
 *  - `POST /api/orders` llamaba `resolveCouponDiscount` sin el ledger privado ni
 *    el teléfono, así que aunque llegara el código no descontaba nada;
 *  - `claimRecoveryCoupon`/`finalizeRecoveryClaim`/`releaseRecoveryClaim` no se
 *    invocaban desde ninguna ruta;
 *  - `GET /api/loyalty/winback/telemetry` no existía (el Studio lo llamaba → 404).
 *
 * Cero mocks: server HTTP real + store real (JSON local y/o Supabase según el
 * entorno). Las mutaciones de data/* las aísla scripts/test-data-guard.js.
 *
 * Cubre:
 *  §1 Módulo puro: `describeRecoveryCoupon` + copy honesta + normalización del
 *     teléfono (un número con espacios canjea su propio cupón) + telemetría
 *     (cohorte, conversión, ingreso real, cancelados afuera, sin mutación).
 *  §2 `POST /api/orders/coupon/validate` público: catálogo del dueño, envío
 *     gratis solo en delivery, ledger privado (vigente/vencido/usado/otro
 *     teléfono/desconocido/UNAVAILABLE) y que NO consume el código.
 *  §3 Canje E2E: pedido real con descuento aplicado, cupón usado + `usedOrderId`,
 *     segundo intento 409 `COUPON_ALREADY_USED`, otro teléfono 422
 *     `COUPON_NOT_FOR_THIS_PHONE`, y el seguimiento público muestra el descuento.
 *  §4 Release: un claim sin pedido se libera y el cupón vuelve a servir.
 *  §5 `GET /api/loyalty/winback/coupons`: 401 anónimo, 200 dueño, teléfono
 *     enmascarado, CERO `boundPhone`/`usedByPhone` y aislamiento cross-tenant.
 *  §6 `GET /api/loyalty/winback/telemetry`: 401 anónimo, métricas reales y un
 *     pedido cancelado NO suma ingreso recuperado.
 *  §7 Push dirigido del cupón + reporte aditivo de la campaña (`pushed`,
 *     `recipients` con `waLink`), sin romper los contadores de F8.
 *  §8 Wiring estático (menú async, panel del Studio con DOM API, cero `on*=`,
 *     export en window) + contrato `openapi.yaml`.
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const loyaltyService = require('../api/services/loyalty');
const notificationsService = require('../api/services/notifications');
const recoveryCoupons = require('../api/utils/recoveryCoupons');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const DAY_MS = 24 * 60 * 60 * 1000;
const ROOT = path.join(__dirname, '..');
const customersFile = path.join(ROOT, 'data', 'customer_profiles.json');
const accountsFile = path.join(ROOT, 'data', 'loyalty_accounts.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
}
function writeJson(file, rows) {
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
}

async function runTests() {
  console.log('🧪 Iniciando verificación de F8-v2 (cupón de recupero canjeable)...');

  // ─────────────────────────────────────────────────────────────────────────
  // §1 Módulo puro
  // ─────────────────────────────────────────────────────────────────────────
  const nowMs = Date.now();
  const baseRow = {
    id: 'wbcp_test_1',
    code: 'VOL-ABCD-1234',
    type: 'percent',
    value: 10,
    label: '10% OFF',
    createdAt: new Date(nowMs - DAY_MS).toISOString(),
    expiresAt: new Date(nowMs + 13 * DAY_MS).toISOString(),
    usedAt: null,
    boundPhone: '59899123456'
  };

  assert.deepStrictEqual(
    recoveryCoupons.describeRecoveryCoupon(null),
    { valid: false, reason: 'NOT_FOUND', message: recoveryCoupons.RECOVERY_COUPON_REASON_COPY.NOT_FOUND, coupon: null },
    'sin fila → NOT_FOUND con copy honesta'
  );
  const okDesc = recoveryCoupons.describeRecoveryCoupon(baseRow, { nowMs, phone: '59899123456' });
  assert.strictEqual(okDesc.valid, true, 'cupón vigente y del mismo teléfono → válido');
  assert.strictEqual(okDesc.reason, null);
  assert.deepStrictEqual(okDesc.coupon, { code: 'VOL-ABCD-1234', type: 'percent', value: 10, label: '10% OFF' }, 'forma de catálogo sin PII');

  // El teléfono se compara por DÍGITOS: el comensal puede escribirlo con
  // espacios/guiones/+, y su propio cupón debe servir igual.
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon(baseRow, { nowMs, phone: '+598 99 123 456' }).valid,
    true,
    'teléfono con formato canjea su propio cupón (normalización por dígitos)'
  );
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon(baseRow, { nowMs, phone: '0059899123456' }).valid,
    true,
    'prefijo internacional 00 normalizado'
  );
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon(baseRow, { nowMs, phone: '59899000000' }).reason,
    'NOT_FOR_THIS_PHONE',
    'otro teléfono → NOT_FOR_THIS_PHONE'
  );
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon({ ...baseRow, usedAt: new Date().toISOString() }, { nowMs }).reason,
    'ALREADY_USED',
    'usado → ALREADY_USED'
  );
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon({ ...baseRow, expiresAt: new Date(nowMs - DAY_MS).toISOString() }, { nowMs }).reason,
    'EXPIRED',
    'vencido → EXPIRED'
  );
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon({ foo: 'bar' }, { nowMs }).reason,
    'MALFORMED',
    'fila basura → MALFORMED'
  );

  // Aplicabilidad por modalidad: envío gratis SOLO en DELIVERY. Es la criba
  // que corre ANTES del claim para no quemar el cupón en una mesa.
  const freeRow = { ...baseRow, type: 'free_delivery', value: 0, label: 'Envío Gratis' };
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon(freeRow, { nowMs, orderMode: 'LOCAL' }).reason,
    'NOT_APPLICABLE',
    'envío gratis en mesa → NOT_APPLICABLE'
  );
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon(freeRow, { nowMs, orderMode: 'TAKEAWAY' }).reason,
    'NOT_APPLICABLE',
    'envío gratis para llevar → NOT_APPLICABLE'
  );
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon(freeRow, { nowMs, orderMode: 'DELIVERY' }).valid,
    true,
    'envío gratis en delivery → válido'
  );
  assert.strictEqual(
    recoveryCoupons.describeRecoveryCoupon(freeRow, { nowMs }).valid,
    true,
    'sin orderMode la aplicabilidad no se evalúa (retrocompatible)'
  );
  for (const reason of ['NOT_FOUND', 'EXPIRED', 'ALREADY_USED', 'NOT_FOR_THIS_PHONE', 'MALFORMED', 'NOT_APPLICABLE']) {
    assert.ok(recoveryCoupons.RECOVERY_COUPON_REASON_COPY[reason], `hay copy para ${reason}`);
    assert.notStrictEqual(recoveryCoupons.RECOVERY_COUPON_REASON_COPY[reason], '');
  }

  // Telemetría: cohorte por emisión, ingreso solo de pedidos REALES.
  const cohort = [
    { id: 'c1', code: 'VOL-1', restaurantId: 'r1', createdAt: new Date(nowMs - 2 * DAY_MS).toISOString(), expiresAt: new Date(nowMs + 12 * DAY_MS).toISOString(), usedAt: null },
    { id: 'c2', code: 'VOL-2', restaurantId: 'r1', createdAt: new Date(nowMs - 3 * DAY_MS).toISOString(), expiresAt: new Date(nowMs + 11 * DAY_MS).toISOString(), usedAt: new Date(nowMs - DAY_MS).toISOString(), usedOrderId: 'ord_1' },
    { id: 'c3', code: 'VOL-3', restaurantId: 'r1', createdAt: new Date(nowMs - 20 * DAY_MS).toISOString(), expiresAt: new Date(nowMs - 6 * DAY_MS).toISOString(), usedAt: null },
    { id: 'c4', code: 'VOL-4', restaurantId: 'r1', createdAt: new Date(nowMs - 40 * DAY_MS).toISOString(), expiresAt: new Date(nowMs - 26 * DAY_MS).toISOString(), usedAt: null },
    { id: 'c5', code: 'VOL-5', restaurantId: 'r1', createdAt: new Date(nowMs - 4 * DAY_MS).toISOString(), expiresAt: new Date(nowMs + 10 * DAY_MS).toISOString(), usedAt: new Date(nowMs - DAY_MS).toISOString(), usedOrderId: 'ord_cancelled' },
    { id: 'c6', code: 'VOL-6', restaurantId: 'r1', createdAt: new Date(nowMs - 5 * DAY_MS).toISOString(), expiresAt: new Date(nowMs + 9 * DAY_MS).toISOString(), usedAt: new Date(nowMs - DAY_MS).toISOString(), usedOrderId: 'ord_missing' }
  ];
  const orders = [
    { id: 'ord_1', restaurant_id: 'r1', total: 12.5, status: 'delivered' },
    { id: 'ord_cancelled', restaurant_id: 'r1', total: 99, status: 'cancelled' }
  ];
  const telemetry = recoveryCoupons.computeWinbackTelemetry(cohort, { orders, nowMs, windowDays: 30, restaurantId: 'r1' });
  assert.strictEqual(telemetry.couponsIssued, 5, 'cohorte = emitidos en la ventana (c4 de 40 días queda afuera)');
  assert.strictEqual(telemetry.couponsUsed, 3, 'usados en la cohorte');
  assert.strictEqual(telemetry.couponsLive, 1, 'vigentes en la cohorte (solo c1)');
  assert.strictEqual(telemetry.couponsExpired, 1, 'vencidos = cohorte − usados − vigentes (c3)');
  assert.strictEqual(telemetry.recoveredCount, 1, 'solo el pedido real y no cancelado cuenta como recuperado');
  assert.strictEqual(telemetry.attributedRevenueCents, 1250, 'ingreso en centavos del pedido real');
  assert.strictEqual(telemetry.conversionRate, 60, 'tasa de canje = 3/5 = 60%');
  assert.deepStrictEqual(cohort.map(r => r.id), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], 'NO muta el array de entrada');
  const emptyTelemetry = recoveryCoupons.computeWinbackTelemetry([], {});
  assert.strictEqual(emptyTelemetry.conversionRate, 0, 'sin cupones la tasa es 0 (no NaN)');
  assert.strictEqual(emptyTelemetry.attributedRevenueCents, 0);
  console.log('✓ §1 módulo puro: veredictos honestos, teléfono por dígitos y telemetría real');

  // ─────────────────────────────────────────────────────────────────────────
  // §2 Setup runtime real
  // ─────────────────────────────────────────────────────────────────────────
  const stamp = Date.now();
  const phoneA = '598' + String(stamp).slice(0, 3) + String(stamp).slice(-5);
  const phoneOther = '598' + String(stamp + 9).slice(0, 3) + String(stamp + 9).slice(-5);

  const userA = await db.createUser({ email: `test-wbv2-${stamp}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const userB = await db.createUser({ email: `test-wbv2-b-${stamp}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const restA = await db.saveRestaurant(userA.id, {
    name: 'Winback V2 Local', bizName: 'Winback V2 Local', slug: `wbv2-${stamp}`,
    currency: 'USD', allowLoyaltyPoints: true,
    // El pago online se habilita SOLO para verificar que la preferencia MP
    // rechaza un cupón no usable antes de cobrar (no llega a Mercado Pago).
    allowOnlinePayment: true,
    customCoupons: [
      { code: 'BIENVENIDO10', type: 'percent', value: 10, label: '10% OFF' },
      { code: 'ENVIOGRATIS', type: 'free_delivery', value: 0, label: 'Envío Gratis' }
    ],
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }],
    deliveryZones: [{ name: 'Centro', fee: 3 }]
  });
  const restB = await db.saveRestaurant(userB.id, {
    name: 'Winback V2 Local B', bizName: 'Winback V2 Local B', slug: `wbv2-b-${stamp}`,
    currency: 'USD', categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Burger', price: 10, categoryId: 'cat1' }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const tokenA = jwt.sign({ userId: userA.id }, JWT_SECRET, { expiresIn: '1h' });
  const tokenB = jwt.sign({ userId: userB.id }, JWT_SECRET, { expiresIn: '1h' });
  const authA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };
  const authB = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` };
  const postJson = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });

  // Cupones REALES en el ledger del local (creación con la capa de servicio).
  const couponLive = await loyaltyService.createWinbackCoupon({
    restaurantId: restA.id, discountType: 'percent', discountValue: 10,
    nowMs, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
  });
  const couponExpired = await loyaltyService.createWinbackCoupon({
    restaurantId: restA.id, discountType: 'percent', discountValue: 15,
    nowMs: nowMs - 20 * DAY_MS, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
  });
  const couponUsed = await loyaltyService.createWinbackCoupon({
    restaurantId: restA.id, discountType: 'free_delivery', discountValue: 0,
    nowMs, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
  });
  // Cupón de envío gratis dedicado a la criba de aplicabilidad: se intenta en
  // mesa (debe rechazarse SIN consumirse) y después en delivery (canje real).
  const couponFreeOrder = await loyaltyService.createWinbackCoupon({
    restaurantId: restA.id, discountType: 'free_delivery', discountValue: 0,
    nowMs, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
  });
  assert.ok(couponLive && couponExpired && couponUsed, 'los 3 cupones se crearon en el ledger real');
  assert.ok(couponFreeOrder && couponFreeOrder.code, 'cupón de envío gratis para la criba de aplicabilidad');

  try {
    // ───────────────────────────────────────────────────────────────────────
    // §2 POST /api/orders/coupon/validate — público, honesto, NO consume
    // ───────────────────────────────────────────────────────────────────────
    const validate = (body) => postJson('/api/orders/coupon/validate', { restaurantId: restA.id, ...body });

    const custom = await validate({ code: 'bienvenido10' });
    assert.strictEqual(custom.status, 200);
    const customBody = await custom.json();
    assert.strictEqual(customBody.data.valid, true, 'cupón del dueño válido (case-insensitive)');
    assert.strictEqual(customBody.data.source, 'custom');
    assert.strictEqual(customBody.data.coupon.code, 'BIENVENIDO10');

    const freeLocal = await validate({ code: 'ENVIOGRATIS', orderMode: 'LOCAL' });
    const freeLocalBody = await freeLocal.json();
    assert.strictEqual(freeLocalBody.data.valid, false, 'envío gratis en mesa no aplica');
    assert.strictEqual(freeLocalBody.data.reason, 'NOT_APPLICABLE');
    const freeDelivery = await validate({ code: 'ENVIOGRATIS', orderMode: 'DELIVERY' });
    assert.strictEqual((await freeDelivery.json()).data.valid, true, 'envío gratis en delivery sí aplica');

    const live = await validate({ code: couponLive.code, phone: '+' + phoneA });
    const liveBody = await live.json();
    assert.strictEqual(liveBody.data.valid, true, 'cupón de recupero vigente válido');
    assert.strictEqual(liveBody.data.source, 'recovery');
    assert.strictEqual(liveBody.data.coupon.code, couponLive.code);

    // Un cupón de recupero de envío gratis también respeta la modalidad.
    const freeRecoveryLocal = await validate({ code: couponFreeOrder.code, phone: phoneA, orderMode: 'LOCAL' });
    const freeRecoveryLocalBody = await freeRecoveryLocal.json();
    assert.strictEqual(freeRecoveryLocalBody.data.valid, false, 'envío gratis de recupero en mesa no aplica');
    assert.strictEqual(freeRecoveryLocalBody.data.reason, 'NOT_APPLICABLE');
    const freeRecoveryDelivery = await validate({ code: couponFreeOrder.code, phone: phoneA, orderMode: 'DELIVERY' });
    assert.strictEqual((await freeRecoveryDelivery.json()).data.valid, true, 'envío gratis de recupero en delivery sí aplica');

    const otherPhone = await validate({ code: couponLive.code, phone: phoneOther });
    const otherPhoneBody = await otherPhone.json();
    assert.strictEqual(otherPhoneBody.data.valid, false, 'cupón personal de otro teléfono no aplica');
    assert.strictEqual(otherPhoneBody.data.reason, 'NOT_FOR_THIS_PHONE');
    assert.ok(otherPhoneBody.data.message.length > 10, 'explica POR QUÉ no aplica');

    const expired = await validate({ code: couponExpired.code, phone: phoneA });
    assert.strictEqual((await expired.json()).data.reason, 'EXPIRED', 'vencido → EXPIRED');

    const unknown = await validate({ code: 'NO-EXISTE-999' });
    assert.strictEqual((await unknown.json()).data.reason, 'NOT_FOUND', 'desconocido → NOT_FOUND');

    // NO consume: el mismo código sigue vigente después de validarlo 3 veces.
    const again = await validate({ code: couponLive.code, phone: phoneA });
    assert.strictEqual((await again.json()).data.valid, true, 'validar no consume el cupón');
    assert.strictEqual((await loyaltyService.listRecoveryCoupons(restA.id)).find(r => r.id === couponLive.id).usedAt, null, 'ledger intacto tras validar');
    console.log('✓ §2 coupon/validate: catálogo del dueño + ledger privado con veredicto honesto, sin consumir');

    // ───────────────────────────────────────────────────────────────────────
    // §3 Canje E2E: pedido real con descuento
    // ───────────────────────────────────────────────────────────────────────
    const orderWithCoupon = await postJson('/api/orders', {
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Alice',
      customerPhone: '+' + phoneA,
      currency: 'USD',
      // El comensal lo escribe con formato: el server compara por dígitos.
      coupon: { code: couponLive.code, type: 'percent', value: 10, label: '10% OFF' }
    });
    assert.strictEqual(orderWithCoupon.status, 201, `pedido con cupón → 201 (llegó ${orderWithCoupon.status})`);
    const orderBodyRes = await orderWithCoupon.json();
    const order = orderBodyRes.data;
    assert.strictEqual(order.discount_amount, 1, 'descuento real 10% de $10');
    assert.strictEqual(order.total, 9, 'total canónico = 10 − 1');
    assert.strictEqual(order.amount, 10, '`amount` conserva el subtotal de platos (analytics intacto)');
    assert.ok(order.coupon && order.coupon.code === couponLive.code, 'el pedido guarda el cupón validado');

    const usedRow = (await loyaltyService.listRecoveryCoupons(restA.id)).find(r => r.id === couponLive.id);
    assert.ok(usedRow.usedAt, 'el cupón quedó USADO en el ledger');
    assert.strictEqual(usedRow.usedOrderId, order.id, 'el uso se atribuye al pedido real');
    assert.strictEqual(usedRow.boundPhone, phoneA, 'sigue atado al teléfono');

    const track = await fetch(`${base}/api/orders/track/${order.trackingToken}`);
    assert.strictEqual(track.status, 200);
    const trackBody = await track.json();
    assert.strictEqual(trackBody.data.discount, 1, 'el seguimiento público muestra el descuento');
    assert.strictEqual(trackBody.data.total, 9, 'el seguimiento público muestra el total real');
    assert.ok(!trackBody.data.phone && !trackBody.data.customerPhone, 'sin PII en el seguimiento');

    // Segundo intento con el MISMO código → 409 honesto (no cobra el total en silencio).
    const reuse = await postJson('/api/orders', {
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Alice', customerPhone: phoneA, currency: 'USD',
      coupon: { code: couponLive.code }
    });
    assert.strictEqual(reuse.status, 409, `cupón usado → 409 (llegó ${reuse.status})`);
    assert.strictEqual((await reuse.json()).code, 'COUPON_ALREADY_USED');

    // Otro teléfono con el cupón de otro → 422 honesto.
    const hijack = await postJson('/api/orders', {
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Bob', customerPhone: phoneOther, currency: 'USD',
      coupon: { code: couponUsed.code }
    });
    assert.strictEqual(hijack.status, 422, `cupón de otro teléfono → 422 (llegó ${hijack.status})`);
    assert.strictEqual((await hijack.json()).code, 'COUPON_NOT_FOR_THIS_PHONE');

    // Vencido → 422 COUPON_EXPIRED.
    const expiredOrder = await postJson('/api/orders', {
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Alice', customerPhone: phoneA, currency: 'USD',
      coupon: { code: couponExpired.code }
    });
    assert.strictEqual(expiredOrder.status, 422, `cupón vencido → 422 (llegó ${expiredOrder.status})`);
    assert.strictEqual((await expiredOrder.json()).code, 'COUPON_EXPIRED');

    // ───────────────────────────────────────────────────────────────────────
    // §3b Aplicabilidad: envío gratis fuera de delivery NO se quema
    // ───────────────────────────────────────────────────────────────────────
    const freeLocalOrder = await postJson('/api/orders', {
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Alice', customerPhone: phoneA, currency: 'USD',
      orderMode: 'LOCAL',
      coupon: { code: couponFreeOrder.code }
    });
    assert.strictEqual(freeLocalOrder.status, 422, `envío gratis en mesa → 422 (llegó ${freeLocalOrder.status})`);
    assert.strictEqual((await freeLocalOrder.json()).code, 'COUPON_NOT_APPLICABLE');
    assert.strictEqual(
      (await loyaltyService.listRecoveryCoupons(restA.id)).find(r => r.id === couponFreeOrder.id).usedAt,
      null,
      'el cupón NO se consumió al rechazarse la modalidad'
    );

    // La preferencia de pago VALIDA sin reclamar y tampoco cobra en silencio:
    // un cupón existente pero inaplicable/vencido devuelve el mismo error.
    const prefNotApplicable = await postJson('/api/orders/mercadopago/preference', {
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Alice', customerPhone: phoneA, currency: 'USD',
      orderMode: 'LOCAL',
      coupon: { code: couponFreeOrder.code }
    });
    assert.strictEqual(prefNotApplicable.status, 422, `preferencia con cupón inaplicable → 422 (llegó ${prefNotApplicable.status})`);
    assert.strictEqual((await prefNotApplicable.json()).code, 'COUPON_NOT_APPLICABLE');
    assert.strictEqual(
      (await loyaltyService.listRecoveryCoupons(restA.id)).find(r => r.id === couponFreeOrder.id).usedAt,
      null,
      'pagar es una intención: la preferencia no reclama el cupón'
    );
    const prefExpired = await postJson('/api/orders/mercadopago/preference', {
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Alice', customerPhone: phoneA, currency: 'USD',
      coupon: { code: couponExpired.code }
    });
    assert.strictEqual(prefExpired.status, 422, `preferencia con cupón vencido → 422 (llegó ${prefExpired.status})`);
    assert.strictEqual((await prefExpired.json()).code, 'COUPON_EXPIRED');

    // En delivery el MISMO cupón sí canjea: envío gratis = fee (3) y el total
    // no cambia por el envío.
    const freeDeliveryOrder = await postJson('/api/orders', {
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Alice', customerPhone: phoneA, currency: 'USD',
      orderMode: 'DELIVERY', deliveryFee: 3, deliveryAddress: 'Calle Falsa 123',
      coupon: { code: couponFreeOrder.code }
    });
    assert.strictEqual(freeDeliveryOrder.status, 201, `envío gratis en delivery → 201 (llegó ${freeDeliveryOrder.status})`);
    const freeDeliveryData = (await freeDeliveryOrder.json()).data;
    assert.strictEqual(freeDeliveryData.discount_amount, 3, 'descuento = costo de envío');
    assert.strictEqual(freeDeliveryData.total, 10, 'total = platos + envío − envío');
    const freeUsedRow = (await loyaltyService.listRecoveryCoupons(restA.id)).find(r => r.id === couponFreeOrder.id);
    assert.ok(freeUsedRow.usedAt, 'en delivery sí quedó usado');
    assert.strictEqual(freeUsedRow.usedOrderId, freeDeliveryData.id, 'atribuido al pedido de delivery');
    console.log('✓ §3b aplicabilidad: envío gratis en mesa rechaza sin quemar el cupón; delivery canjea; la preferencia MP no cobra en silencio');

    // Tras el 409/422 el ledger NO se corrompió: el usado sigue usado y el
    // vencido sigue vencido (nada se "revivió" por un intento fallido).
    const afterFailures = await loyaltyService.listRecoveryCoupons(restA.id);
    assert.strictEqual(afterFailures.find(r => r.id === couponExpired.id).usedAt, null, 'el vencido no se marcó usado');
    assert.ok(afterFailures.find(r => r.id === couponUsed.id).usedAt === null, 'el cupón ajeno no se consumió');
    console.log('✓ §3 canje E2E: descuento real, usedOrderId, 409 ALREADY_USED, 422 NOT_FOR_THIS_PHONE/EXPIRED');

    // ───────────────────────────────────────────────────────────────────────
    // §4 Release: un claim sin pedido se libera
    // ───────────────────────────────────────────────────────────────────────
    const claimed = await loyaltyService.claimRecoveryCoupon({ restaurantId: restA.id, code: couponUsed.code, phone: phoneA });
    assert.ok(claimed.row && !claimed.reason, 'claim directo OK');
    const released = await loyaltyService.releaseRecoveryClaim({ restaurantId: restA.id, code: couponUsed.code });
    assert.strictEqual(released.released, true, 'release devuelve released:true');
    const releasedRow = (await loyaltyService.listRecoveryCoupons(restA.id)).find(r => r.id === couponUsed.id);
    assert.strictEqual(releasedRow.usedAt, null, 'el cupón vuelve a estar vigente tras el release');
    assert.strictEqual(releasedRow.usedOrderId, null, 'sin pedido atribuido');
    assert.strictEqual(releasedRow.usedByPhone, null, 'sin teléfono de uso residual');
    console.log('✓ §4 release: un claim sin pedido no quema el cupón');

    // ───────────────────────────────────────────────────────────────────────
    // §5 GET /winback/coupons — privacidad y aislamiento
    // ───────────────────────────────────────────────────────────────────────
    const couponsAnon = await fetch(`${base}/api/loyalty/winback/coupons`);
    assert.strictEqual(couponsAnon.status, 401, 'sin sesión → 401');

    const couponsRes = await fetch(`${base}/api/loyalty/winback/coupons`, { headers: authA });
    assert.strictEqual(couponsRes.status, 200, 'dueño → 200');
    const couponsBody = await couponsRes.json();
    const ledger = couponsBody.data.coupons;
    assert.ok(ledger.length >= 3, 'lista los 3 cupones del local');
    const usedJson = ledger.find(c => c.code === couponLive.code);
    assert.strictEqual(usedJson.status, 'used', 'estado derivado: used');
    assert.strictEqual(ledger.find(c => c.code === couponExpired.code).status, 'expired', 'estado derivado: expired');
    assert.strictEqual(ledger.find(c => c.code === couponUsed.code).status, 'live', 'estado derivado: live');
    assert.ok(usedJson.phoneMasked.includes('***'), 'teléfono enmascarado');
    assert.ok(!usedJson.phoneMasked.includes(phoneA), 'nunca el teléfono completo');
    assert.ok(!('boundPhone' in usedJson), 'no expone boundPhone');
    assert.ok(!('usedByPhone' in usedJson), 'no expone usedByPhone');
    const couponsRaw = JSON.stringify(couponsBody);
    assert.ok(!couponsRaw.includes(`"${phoneA}"`), 'el teléfono crudo no aparece como campo en la respuesta');
    assert.ok(!couponsRaw.includes('boundPhone'), 'ni siquiera el nombre del campo privado');
    assert.strictEqual(usedJson.usedOrderId, order.id, 'atribuye el pedido del canje');

    const couponsB = await fetch(`${base}/api/loyalty/winback/coupons`, { headers: authB });
    assert.strictEqual(couponsB.status, 200);
    const couponsBBody = await couponsB.json();
    assert.strictEqual(couponsBBody.data.coupons.length, 0, 'aislamiento cross-tenant: B no ve cupones de A');
    console.log('✓ §5 /winback/coupons: enmascarado, sin campos privados, aislamiento cross-tenant');

    // ───────────────────────────────────────────────────────────────────────
    // §6 GET /winback/telemetry — métricas reales
    // ───────────────────────────────────────────────────────────────────────
    const telemetryAnon = await fetch(`${base}/api/loyalty/winback/telemetry`);
    assert.strictEqual(telemetryAnon.status, 401, 'sin sesión → 401');

    const telemetryRes = await fetch(`${base}/api/loyalty/winback/telemetry`, { headers: authA });
    assert.strictEqual(telemetryRes.status, 200, 'dueño → 200');
    const t1 = (await telemetryRes.json()).data;
    assert.strictEqual(t1.windowDays, 30, 'ventana default 30 días');
    assert.ok(t1.couponsIssued >= 3, 'cuenta los cupones emitidos');
    assert.strictEqual(t1.couponsUsed, 2, 'usados: el porcentual y el de envío gratis (los rechazados no cuentan)');
    assert.strictEqual(t1.recoveredCount, 2, 'dos clientes recuperados con pedido real');
    assert.strictEqual(t1.attributedRevenueCents, 1900, 'ingreso atribuido = $9 + $10 reales');
    assert.ok(t1.conversionRate > 0 && t1.conversionRate <= 100, 'tasa porcentual acotada');

    // Cancelar el pedido → el ingreso recuperado NO se cuenta (no es plata).
    const cancelRes = await fetch(`${base}/api/orders/status/${order.id}`, {
      method: 'PATCH',
      headers: authA,
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.strictEqual(cancelRes.status, 200, 'cancelar pedido → 200');
    const t2 = (await (await fetch(`${base}/api/loyalty/winback/telemetry`, { headers: authA })).json()).data;
    assert.strictEqual(t2.recoveredCount, 1, 'cancelado no cuenta como cliente recuperado (queda el delivery)');
    assert.strictEqual(t2.attributedRevenueCents, 1000, 'cancelado no suma ingreso (queda el delivery $10)');
    assert.strictEqual(t2.couponsUsed, 2, 'los cupones siguen usados (el canje existió)');
    console.log('✓ §6 /winback/telemetry: ingreso real y cancelados afuera');

    // ───────────────────────────────────────────────────────────────────────
    // §7 Push dirigido + reporte aditivo de la campaña
    // ───────────────────────────────────────────────────────────────────────
    // Sin suscripción para ese teléfono → skipped honesto, sin romper.
    const noMatch = await notificationsService.sendWinbackCouponNotification({
      restaurantId: restA.id, customerPhone: phoneOther,
      couponCode: 'VOL-TEST-0001', offerLabel: '10% OFF', slug: restA.slug, restaurantName: restA.name
    });
    assert.strictEqual(noMatch.skipped, 'NO_MATCHING_SUBSCRIBERS', 'sin suscripción → skipped explícito');

    await notificationsService.saveSubscription({
      restaurantId: restA.id,
      endpoint: `https://push.test/wbv2-${stamp}`,
      keys: { p256dh: 'BfakeKeyForTest', auth: 'fakeAuth' },
      role: 'guest',
      consentMarketing: true,
      customerPhone: phoneA
    });
    const push = await notificationsService.sendWinbackCouponNotification({
      restaurantId: restA.id, customerPhone: '+' + phoneA,
      couponCode: 'VOL-TEST-0002', offerLabel: '10% OFF', slug: restA.slug, restaurantName: restA.name
    });
    assert.strictEqual(push.success, true, 'push no rompe aunque falle la entrega');
    assert.strictEqual(push.delivered, 0, 'endpoint falso: ninguna entrega real');
    if (push.skipped === 'PUSH_NOT_CONFIGURED') {
      // Sin VAPID (CI sin .env): el service devuelve el skip honesto SIN
      // payload — el cupón ya viajó por email/WhatsApp. El payload tipado
      // solo se puede verificar donde haya llaves VAPID.
      console.log('  (sin VAPID: skipped honesto PUSH_NOT_CONFIGURED, payload no verificable)');
    } else {
      assert.ok(push.payload && push.payload.type === 'winback_coupon', 'payload tipado winback_coupon');
      assert.ok(push.payload.tag.includes('VOL-TEST-0002'), 'tag por cupón (no pisa otros avisos)');
      assert.strictEqual(push.payload.url, `/m/${restA.slug}`, 'abre la carta del local');
    }

    // Campaña real con un cliente churn (consent + email) para verificar que
    // el reporte aditivo no rompe los contadores históricos de F8.
    const phoneChurn = '598' + String(stamp + 5).slice(0, 3) + String(stamp + 5).slice(-5);
    for (let i = 0; i < 2; i++) {
      await postJson('/api/orders', {
        restaurantId: restA.id, items: [{ dishId: 'dish1', quantity: 1 }],
        customerName: 'Churn', customerPhone: phoneChurn, currency: 'USD'
      });
    }
    await postJson('/api/loyalty/email', { phone: phoneChurn, email: `wbv2-churn-${stamp}@mail.com` });
    const customers = readJson(customersFile);
    const churnCustomer = customers.find(c => c.phone === phoneChurn);
    if (churnCustomer) churnCustomer.consentMarketing = true;
    writeJson(customersFile, customers);
    const accounts = readJson(accountsFile);
    for (const row of accounts) {
      if (row.restaurantId === restA.id && row.customerId === churnCustomer?.id) {
        row.lastVisitAt = new Date(Date.now() - 50 * DAY_MS).toISOString();
        if (row.last_visit_at !== undefined) row.last_visit_at = row.lastVisitAt;
      }
    }
    writeJson(accountsFile, accounts);

    const campaign = await postJson('/api/loyalty/winback', { offerType: 'percent_10' }, authA);
    assert.strictEqual(campaign.status, 200);
    const campaignData = (await campaign.json()).data;
    assert.strictEqual(campaignData.sent, 1, 'contrato F8 intacto: 1 email enviado');
    assert.ok(Number.isInteger(campaignData.pushed), '`pushed` es un entero (aditivo)');
    assert.ok(Array.isArray(campaignData.recipients), '`recipients` es aditivo y siempre un array');
    assert.strictEqual(campaignData.recipients.length, 1, 'un destinatario con cupón');
    const recipient = campaignData.recipients[0];
    assert.ok(recipient.phoneMasked.includes('***'), 'destinatario con teléfono enmascarado');
    assert.ok(!recipient.phoneMasked.includes(phoneChurn), 'nunca el teléfono completo como campo');
    assert.ok(recipient.couponCode.startsWith('VOL-'), 'código del cupón emitido');
    assert.strictEqual(typeof recipient.waLink, 'string', 'link de WhatsApp operativo');
    assert.ok(recipient.waLink.startsWith('https://wa.me/'), 'wa.me real');
    assert.ok(recipient.waLink.includes(encodeURIComponent(recipient.couponCode)), 'el mensaje lleva el cupón');
    assert.deepStrictEqual(Object.keys(recipient.channels).sort(), ['email', 'push'], 'canales reportados');
    assert.strictEqual(recipient.channels.email, true, 'el email salió');
    console.log('✓ §7 push dirigido + reporte aditivo (pushed/recipients/waLink) sin romper F8');

    // ───────────────────────────────────────────────────────────────────────
    // §8 Wiring estático + contrato
    // ───────────────────────────────────────────────────────────────────────
    const menuJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'menu.js'), 'utf8');
    assert.ok(menuJs.includes('async function applyCoupon'), 'applyCoupon es async (consulta al servidor)');
    assert.ok(menuJs.includes("'/api/orders/coupon/validate'"), 'el menú valida contra el endpoint público');
    assert.ok(menuJs.includes('data.valid'), 'respeta el veredicto del servidor');
    assert.ok(!/window\.confirm|(?<![\w.])alert\(/.test(menuJs.slice(menuJs.indexOf('async function applyCoupon'), menuJs.indexOf('async function applyCoupon') + 4000)), 'cero confirm/alert en el flujo nuevo');

    const loyaltyManager = fs.readFileSync(path.join(ROOT, 'public', 'js', 'studio', 'loyaltyManager.js'), 'utf8');
    assert.ok(loyaltyManager.includes('export async function loadWinbackCoupons'), 'panel de cupones exportado');
    const winbackSection = loyaltyManager.slice(loyaltyManager.indexOf('function winbackEl'));
    assert.ok(!winbackSection.includes('innerHTML'), 'el panel nuevo renderiza con DOM API (cero innerHTML)');
    assert.ok(winbackSection.includes('document.createElement'), 'usa createElement');
    assert.ok(winbackSection.includes('textContent'), 'usa textContent para data');
    assert.ok(!/\son[a-z]+\s*=/i.test(winbackSection), 'cero atributos on*=');

    const studioHtml = fs.readFileSync(path.join(ROOT, 'public', 'studio.html'), 'utf8');
    assert.ok(studioHtml.includes('id="winbackCouponsPanel"'), 'el Studio tiene el panel de cupones');
    assert.ok(studioHtml.includes('data-js-click="loadWinbackCoupons"'), 'botón con binder CSP-safe');
    assert.ok(!/\son[a-z]+\s*=\s*"/i.test(studioHtml.slice(studioHtml.indexOf('Campana Automatizada'.replace('Campana', 'Campaña')), studioHtml.indexOf('id="winbackCouponsPanel"') + 2000)), 'cero on*= en el bloque nuevo');

    const studioJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'studio.js'), 'utf8');
    assert.ok(studioJs.includes('loadWinbackCoupons'), 'studio.js cablea el panel');
    assert.ok(studioJs.includes('launchWinbackCampaign, loadWinbackCoupons'), 'AMBOS exportados a window (el botón de campaña estaba muerto)');

    const spec = fs.readFileSync(path.join(ROOT, 'openapi.yaml'), 'utf8');
    for (const p of ['/api/orders/coupon/validate', '/api/loyalty/winback/coupons', '/api/loyalty/winback/telemetry', '/api/loyalty/winback:']) {
      assert.ok(spec.includes(p), `openapi documenta ${p}`);
    }
    assert.ok(spec.includes('COUPON_ALREADY_USED') && spec.includes('COUPON_NOT_FOR_THIS_PHONE'), 'openapi documenta los errores honestos del canje');
    assert.ok(spec.includes('recipients') && spec.includes('waLink'), 'openapi documenta el reporte aditivo');
    console.log('✓ §8 wiring (menú async, panel DOM API, cero on*=) + contrato openapi');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('✅ F8-v2: el cupón de recupero se emite, se ve, se canjea y se mide');
}

runTests().catch((err) => {
  console.error('❌ Error en test-winback-v2:', err);
  process.exit(1);
});
