/**
 * tests/test-order-tracking.js
 * ────────────────────────────
 * Seguimiento del pedido del comensal (order tracking) — el pedido que antes
 * se perdía apenas se abría WhatsApp ahora tiene un estado persistente, una
 * vista pública por token no adivinable y aviso push cuando el local lo avanza.
 *
 * Cero mocks: server HTTP real + store real (JSON local y/o Supabase según el
 * entorno). Las mutaciones de data/* las aísla scripts/test-data-guard.js.
 *
 * Cubre:
 *  - Helpers puros: signOrderToken / verifyOrderToken (token HMAC sin estado).
 *  - POST /api/orders devuelve `trackingToken` firmado para el pedido recién creado.
 *  - GET /api/orders/track/:token → estado público SIN datos personales del cliente.
 *  - Token adulterado / inexistente → 404 (no se filtra nada).
 *  - PATCH /api/orders/status/:orderId exige sesión (401 anónimo).
 *  - Estado inválido → 400 INVALID_ORDER_STATUS.
 *  - Otro dueño no puede cambiar mi pedido → 403 ORDER_TENANT_MISMATCH.
 *  - El dueño avanza el estado y la vista pública lo refleja (con etiqueta).
 *  - El push de estado se dirige SOLO al comensal que lo pidió (por teléfono),
 *    nunca a todos los guests.
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const notificationsService = require('../api/services/notifications');
const loyaltyService = require('../api/services/loyalty');
const { signOrderToken, verifyOrderToken } = require('../api/utils/orderTrackingToken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

async function runTests() {
  console.log('🧪 Iniciando verificación de Seguimiento del Pedido...');

  // Teléfono ÚNICO por corrida: el pedido acredita fidelización (flujo real),
  // y así este test nunca colisiona con la identidad fija de test-loyalty-dual.
  const testPhone = '+598 99 ' + String(Date.now()).slice(-6);
  const testPhoneNorm = testPhone.replace(/\D/g, '');

  // ── 1) Helpers puros del token ─────────────────────────────────────────────
  const orderId = 'ord_test_123_abc';
  const token = signOrderToken(orderId);
  assert.ok(typeof token === 'string' && token.startsWith(`${orderId}.`), 'token firmado con prefijo del orderId');
  assert.strictEqual(verifyOrderToken(token), orderId, 'token válido devuelve el orderId');
  assert.strictEqual(verifyOrderToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), null, 'firma adulterada → null');
  assert.strictEqual(verifyOrderToken(`${orderId}.deadbeef`), null, 'firma falsa → null');
  assert.strictEqual(verifyOrderToken('sin.punto'), null, 'token malformado → null');
  assert.strictEqual(verifyOrderToken(''), null);
  assert.strictEqual(verifyOrderToken(null), null);
  assert.notStrictEqual(signOrderToken('ord_A'), signOrderToken('ord_B'), 'dos pedidos → dos tokens');
  console.log('✓ Helpers puros: signOrderToken / verifyOrderToken (HMAC sin estado)');

  // ── Setup: dos dueños, dos restaurantes, un platillo ──────────────────────
  const userA = await db.createUser({ email: `track-a-${Date.now()}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const userB = await db.createUser({ email: `track-b-${Date.now()}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });

  const restA = await db.saveRestaurant(userA.id, {
    name: 'Tracking Local A', bizName: 'Tracking Local A',
    slug: `tracking-a-${Date.now()}`,
    phone: '59891111111',
    currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }]
  });
  const restB = await db.saveRestaurant(userB.id, {
    name: 'Tracking Local B', bizName: 'Tracking Local B',
    slug: `tracking-b-${Date.now()}`,
    phone: '59892222222',
    currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
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
  const patchJson = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${url}`, { method: 'PATCH', headers, body: JSON.stringify(body) });

  try {
    // ── 2) El pedido nace con token de seguimiento ──────────────────────────
    const orderRes = await postJson('/api/orders', {
      restaurantId: restA.id,
      tableNumber: '4',
      customerName: 'Alice',
      customerPhone: testPhone,
      currency: 'USD',
      tipAmount: 1.5,
      items: [{ dishId: 'dish1', quantity: 2 }]
    });
    assert.strictEqual(orderRes.status, 201, 'Pedido creado');
    const order = (await orderRes.json()).data;
    assert.ok(order.id && order.trackingToken, 'El pedido expone id + trackingToken');
    assert.strictEqual(verifyOrderToken(order.trackingToken), order.id, 'El token corresponde al pedido');
    assert.strictEqual(order.status, 'pending', 'Estado inicial pendiente');
    assert.strictEqual(order.tipAmount, 1.5, 'La propina declarada se persiste en el pedido');
    console.log('✓ POST /api/orders devuelve un trackingToken firmado del pedido');

    // ── 2b) CAPTCHA exigido cuando el despliegue lo configura ─────────────
    // (Sin secreto el flujo anterior ya probó que no se exige nada.)
    const prevCaptchaSecret = process.env.TURNSTILE_SECRET;
    process.env.TURNSTILE_SECRET = 'test-bogus-secret';
    try {
      const noCaptcha = await postJson('/api/orders', {
        restaurantId: restA.id,
        customerName: 'Bot',
        customerPhone: testPhone,
        currency: 'USD',
        items: [{ dishId: 'dish1', quantity: 1 }]
      });
      assert.strictEqual(noCaptcha.status, 403, 'Sin captchaToken → 403');
      assert.strictEqual((await noCaptcha.json()).code, 'CAPTCHA_REQUIRED');
      console.log('✓ CAPTCHA configurado: pedido sin token → 403 CAPTCHA_REQUIRED');
    } finally {
      if (prevCaptchaSecret === undefined) delete process.env.TURNSTILE_SECRET;
      else process.env.TURNSTILE_SECRET = prevCaptchaSecret;
    }

    // ── 3) Vista pública por token, sin PII ─────────────────────────────────
    const trackRes = await fetch(`${base}/api/orders/track/${order.trackingToken}`);
    assert.strictEqual(trackRes.status, 200, 'Seguimiento público responde 200');
    const track = (await trackRes.json()).data;
    assert.strictEqual(track.status, 'pending');
    assert.strictEqual(track.statusLabel, 'Recibido');
    assert.strictEqual(track.restaurantName, restA.name);
    assert.strictEqual(String(track.tableNumber), '4');
    assert.ok(Array.isArray(track.items) && track.items.length === 1, 'Resumen de ítems presente');
    assert.strictEqual(track.items[0].name, 'Milanesa');
    assert.strictEqual(track.items[0].quantity, 2);
    assert.strictEqual(track.tip, 1.5, 'La propina se expone en el seguimiento público');
    // Privacidad: el token no debe exponer teléfono ni nombre del cliente.
    assert.ok(!('customer_phone' in track) && !('customerPhone' in track), 'Sin teléfono en la respuesta pública');
    assert.ok(!('customer_name' in track) && !('customerName' in track), 'Sin nombre del cliente en la respuesta pública');
    console.log('✓ GET /api/orders/track/:token: estado público y SIN datos personales');

    // ── 4) Token adulterado o inexistente → 404 ─────────────────────────────
    const tampered = order.trackingToken.slice(0, -1) + (order.trackingToken.endsWith('a') ? 'b' : 'a');
    const badRes = await fetch(`${base}/api/orders/track/${tampered}`);
    assert.strictEqual(badRes.status, 404, 'Token adulterado → 404');
    assert.strictEqual((await badRes.json()).code, 'ORDER_NOT_FOUND');
    const missingRes = await fetch(`${base}/api/orders/track/ord_noexiste.firmafalsa`);
    assert.strictEqual(missingRes.status, 404, 'Token inexistente → 404');
    console.log('✓ Token adulterado / inexistente → 404 (sin filtrar existencia)');

    // ── 5) Actualización de estado: control de acceso ───────────────────────
    const anonPatch = await patchJson(`/api/orders/status/${order.id}`, { status: 'preparing' });
    assert.strictEqual(anonPatch.status, 401, 'Anónimo no puede cambiar el estado (401)');

    const invalid = await patchJson(`/api/orders/status/${order.id}`, { status: 'flying' }, authA);
    assert.strictEqual(invalid.status, 400, 'Estado inválido → 400');
    assert.strictEqual((await invalid.json()).code, 'INVALID_ORDER_STATUS');

    const cross = await patchJson(`/api/orders/status/${order.id}`, { status: 'preparing' }, authB);
    assert.strictEqual(cross.status, 403, 'Otro dueño no puede tocar mi pedido (403)');
    assert.strictEqual((await cross.json()).code, 'ORDER_TENANT_MISMATCH');
    console.log('✓ PATCH estado: 401 anónimo · 400 inválido · 403 cross-tenant');

    // ── 6) El dueño avanza el estado y la vista pública lo refleja ──────────
    const ok = await patchJson(`/api/orders/status/${order.id}`, { status: 'preparing' }, authA);
    assert.strictEqual(ok.status, 200, 'El dueño actualiza el estado');
    const okBody = (await ok.json()).data;
    assert.strictEqual(okBody.status, 'preparing');
    assert.strictEqual(okBody.statusLabel, 'En preparación');

    const track2 = (await (await fetch(`${base}/api/orders/track/${order.trackingToken}`)).json()).data;
    assert.strictEqual(track2.status, 'preparing', 'El seguimiento refleja el nuevo estado');
    assert.strictEqual(track2.statusLabel, 'En preparación');

    const ready = (await (await patchJson(`/api/orders/status/${order.id}`, { status: 'ready' }, authA)).json()).data;
    assert.strictEqual(ready.status, 'ready');
    assert.strictEqual(ready.statusLabel, 'Listo');
    console.log('✓ El dueño avanza el estado y el comensal lo ve (con etiqueta en español)');

    // ── 7) Push de estado dirigido SOLO al comensal que pidió ───────────────
    const guestSub = await postJson('/api/notifications/subscribe', {
      restaurantId: restA.id,
      endpoint: `https://notify.example.invalid/order-${Date.now()}`,
      keys: { p256dh: 'E' + 'x'.repeat(86), auth: 'F' + 'y'.repeat(21) },
      role: 'guest',
      consentMarketing: true,
      customerPhone: testPhone
    });
    assert.strictEqual(guestSub.status, 201, 'Guest con teléfono + opt-in se suscribe');
    const guest = (await guestSub.json()).data;
    assert.strictEqual(guest.customer_phone, testPhoneNorm, 'El teléfono se guarda normalizado (E.164 sin +)');
    const guestSubs = await notificationsService.listSubscriptions({ restaurantId: restA.id, role: 'guest' });
    assert.ok(guestSubs.some(s => s.endpoint === guest.endpoint && s.customer_phone === testPhoneNorm), 'Suscripción guest con teléfono listada');

    // Un teléfono que no hizo el pedido no recibe NADA (sin tocar VAPID).
    const stranger = await notificationsService.sendOrderStatusNotification({
      restaurantId: restA.id,
      customerPhone: '+598 00 000 000',
      status: 'ready',
      orderId: order.id,
      slug: restA.slug,
      restaurantName: restA.name
    });
    assert.strictEqual(stranger.checked, 0, 'Ningún comensal ajeno recibe el aviso de estado');
    assert.strictEqual(stranger.skipped, 'NO_MATCHING_SUBSCRIBERS');

    // El teléfono correcto sí entra al dispatch (con VAPID real; sin llaves,
    // el servicio lo declara honestamente y el estado ya quedó persistido).
    try {
      const targeted = await notificationsService.sendOrderStatusNotification({
        restaurantId: restA.id,
        customerPhone: testPhoneNorm,
        status: 'ready',
        orderId: order.id,
        slug: restA.slug,
        restaurantName: restA.name
      });
      assert.ok(targeted.checked >= 1, 'El comensal que pidió entra al dispatch de estado');
    } catch (e) {
      assert.strictEqual(e.code, 'PUSH_NOT_CONFIGURED', 'Sin VAPID degrada honestamente (no rompe el pedido)');
    }
    console.log('✓ Push de estado dirigido por teléfono: solo el comensal del pedido, nunca todos');

    console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE SEGUIMIENTO DEL PEDIDO PASARON!');
  } finally {
    // Limpieza real: el pedido acreditó fidelización para este teléfono único
    // (flujo 0-mocks). Borramos ese perfil para no ensuciar la nube entre
    // corridas; el espejo local de data/ lo restaura scripts/test-data-guard.js.
    try { await loyaltyService.eraseCustomerData(testPhoneNorm); } catch (e) { /* best-effort */ }
    server.close();
  }
}

runTests()
  .then(() => console.log('✅ test-order-tracking.js OK'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
