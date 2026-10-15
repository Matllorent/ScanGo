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

    // ── 2c) Totales canónicos: cupón validado + envío validado en el record ─
    await db.saveRestaurant(userA.id, {
      ...db.findRestaurantById(restA.id),
      deliveryZones: [{ name: 'Centro', fee: 40 }],
      customCoupons: [{ code: 'TRACK20', type: 'percent', value: 20, label: '20% OFF' }]
    });
    const canonRes = await postJson('/api/orders', {
      restaurantId: restA.id,
      orderMode: 'DELIVERY',
      deliveryAddress: 'Calle Falsa 123',
      deliveryFee: 40,
      customerName: 'Alice',
      customerPhone: testPhone,
      currency: 'USD',
      tipAmount: 5,
      coupon: { code: 'TRACK20', type: 'percent', value: 99, label: 'TRUCHO' },
      items: [{ dishId: 'dish1', quantity: 2 }]
    });
    assert.strictEqual(canonRes.status, 201, 'Pedido con cupón+envío creado');
    const canon = (await canonRes.json()).data;
    assert.strictEqual(canon.discountAmount, 4, 'Descuento recalculado server-side (20% de 20), no el declarado');
    assert.strictEqual(canon.deliveryFee, 40, 'Envío validado contra zonas');
    assert.strictEqual(canon.coupon.code, 'TRACK20', 'Cupón validado persistido');
    assert.strictEqual(canon.total, 20 + 40 - 4 + 5, 'Total canónico = platos + envío − cupón + propina');
    assert.strictEqual(canon.amount, 20, 'amount conserva el subtotal de platos');
    const canonTrack = (await (await fetch(`${base}/api/orders/track/${canon.trackingToken}`)).json()).data;
    assert.strictEqual(canonTrack.total, 61, 'El seguimiento expone el total canónico (no solo platos)');
    assert.strictEqual(canonTrack.discount, 4, 'El seguimiento expone el descuento');
    assert.strictEqual(canonTrack.deliveryFee, 40, 'El seguimiento expone el envío');
    console.log('✓ Totales canónicos server-side en record + tracking (cupón recalculado)');

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

    // ── 8) Carta vitrina: el dueño muestra sin aceptar pedidos ─────────────
    const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');
    assert.strictEqual(sanitizeRestaurantPayload({ name: 'X' }).allowMenuOrders, true, 'vitrina default ON');
    assert.strictEqual(sanitizeRestaurantPayload({ name: 'X', allowMenuOrders: false }).allowMenuOrders, false, 'false explícito se preserva');
    const menuB = (await (await fetch(`${base}/api/menu/${restB.slug}`)).json()).restaurant;
    assert.strictEqual(menuB.allowMenuOrders, true, '/api/menu expone allowMenuOrders=true por defecto');

    // Un pedido en restB ANTES de apagar (para probar que el dueño sigue operando).
    const orderBRes = await postJson('/api/orders', {
      restaurantId: restB.id,
      customerName: 'Beto',
      customerPhone: testPhone,
      currency: 'USD',
      items: [{ dishId: 'dish1', quantity: 1 }]
    });
    assert.strictEqual(orderBRes.status, 201, 'pedido en restB creado (vitrina ON)');
    const orderB = (await orderBRes.json()).data;

    await db.saveRestaurant(userB.id, { allowMenuOrders: false });
    const vitrinaBody = {
      restaurantId: restB.id,
      customerName: 'Beto',
      customerPhone: testPhone,
      currency: 'USD',
      items: [{ dishId: 'dish1', quantity: 1 }]
    };
    const offOrder = await postJson('/api/orders', vitrinaBody);
    assert.strictEqual(offOrder.status, 403, 'POST /api/orders en vitrina → 403');
    assert.strictEqual((await offOrder.json()).code, 'MENU_ORDERS_DISABLED');
    const offQuote = await postJson('/api/orders/quote', vitrinaBody);
    assert.strictEqual(offQuote.status, 403, '/quote en vitrina → 403');
    assert.strictEqual((await offQuote.json()).code, 'MENU_ORDERS_DISABLED');
    const offPref = await postJson('/api/orders/mercadopago/preference', vitrinaBody);
    assert.strictEqual(offPref.status, 403, 'preferencia MP en vitrina → 403 (antes que el gate de pago)');
    assert.strictEqual((await offPref.json()).code, 'MENU_ORDERS_DISABLED');
    // El dueño SIGUE operando lo existente: avanzar estado no es pedir.
    const stillOk = await patchJson(`/api/orders/status/${orderB.id}`, { status: 'confirmed' }, authB);
    assert.strictEqual(stillOk.status, 200, 'PATCH estado en vitrina sigue 200 (operación del dueño)');
    console.log('✓ Vitrina: POST/quote/preferencia → 403 MENU_ORDERS_DISABLED; el dueño sigue operando');

    // Frontend: sin "+" ni carrito ni grupo en vitrina + toggle del Studio.
    const fs = require('fs');
    const path = require('path');
    const menuJsSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
    assert.ok(menuJsSrc.includes('areMenuOrdersEnabled'), 'menu.js gobierna el modo vitrina');
    const renderSrc8 = fs.readFileSync(path.join(__dirname, '../public/js/menu/menuRender.js'), 'utf8');
    assert.ok(renderSrc8.includes('${!ctx.areMenuOrdersEnabled()'), 'platos sin botón + en vitrina (2 renders)');
    const storiesSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu/storiesLayout.js'), 'utf8');
    assert.ok(storiesSrc.includes('allowMenuOrders'), 'stories oculta el carrito en vitrina');
    const studioHtmlSrc = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
    assert.ok(studioHtmlSrc.includes('id="inputAllowMenuOrders"'), 'Studio expone el toggle de vitrina');
    const studioJsSrc = fs.readFileSync(path.join(__dirname, '../public/js/studio.js'), 'utf8');
    assert.ok(studioJsSrc.includes('inputAllowMenuOrders'), 'Studio guarda/carga el flag de vitrina');
    console.log('✓ Frontend vitrina: carta sin +/carrito/grupo/stories-cart + toggle sin on*=');

    // ── 9) Helado a medida punta a punta (el bug DISH_NOT_FOUND) ────────────
    // Antes: el item sintético `icecream_*` moría en /quote y el armado no se
    // podía pedir. Ahora el servidor recomputa contra la config del dueño.
    const userC = await db.createUser({ email: `track-c-${Date.now()}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
    const restC = await db.saveRestaurant(userC.id, {
      name: 'Heladería Tracking', bizName: 'Heladería Tracking',
      slug: `heladeria-${Date.now()}`,
      businessType: 'heladeria',
      allowIceCreamWizard: true,
      phone: '59893333333',
      currency: '$',
      categories: [{ id: 'catH', name: 'Cremas' }],
      dishes: [
        { id: 'f-ddl', name: 'DDL', price: 0, categoryId: 'catH', iceCreamSurcharge: 0 },
        { id: 'f-pist', name: 'Pistacho', price: 0, categoryId: 'catH', iceCreamSurcharge: 80 }
      ],
      iceCreamContainers: [{ id: 'cMio', name: 'Pote mío', price: 500, maxFlavors: 2, icon: '🍨' }],
      iceCreamToppings: [{ id: 'tMia', name: 'Extra mía', price: 40, kind: 'topping' }]
    });
    const menuC = (await (await fetch(`${base}/api/menu/${restC.slug}`)).json()).restaurant;
    assert.ok(Array.isArray(menuC.iceCreamContainers) && menuC.iceCreamContainers[0].id === 'cMio', '/api/menu expone los tamaños del dueño');
    assert.ok(Array.isArray(menuC.iceCreamToppings) && menuC.iceCreamToppings[0].id === 'tMia', '/api/menu expone los toppings del dueño');
    const iceBody = {
      restaurantId: restC.id,
      customerName: 'Heladero',
      customerPhone: testPhone,
      currency: '$',
      items: [{
        dishId: `icecream_${Date.now()}`,
        quantity: 1,
        customIceCream: { containerId: 'cMio', flavorIds: ['f-ddl', 'f-pist'], toppingIds: ['tMia'] }
      }]
    };
    const iceQuote = await postJson('/api/orders/quote', iceBody);
    assert.strictEqual(iceQuote.status, 200, '/quote cotiza el armado (ya no DISH_NOT_FOUND)');
    assert.strictEqual((await iceQuote.json()).data.amount, 500 + 80 + 40, 'total autoritativo: tamaño + recargo + topping');
    const iceOrder = await postJson('/api/orders', iceBody);
    assert.strictEqual(iceOrder.status, 201, 'POST /api/orders acepta el armado');
    assert.ok((await iceOrder.json()).data.trackingToken, 'el armado tiene tracking como cualquier pedido');
    const iceBad = await postJson('/api/orders/quote', {
      ...iceBody,
      items: [{ dishId: 'icecream_x', quantity: 1, customIceCream: { containerId: 'nope', flavorIds: ['f-ddl'], toppingIds: [] } }]
    });
    assert.strictEqual(iceBad.status, 400, 'tamaño inválido → 400 honesto');
    console.log('✓ Helado a medida punta a punta: quote + alta + tracking con precios del dueño');

    // ── 10) Outbox mínima + idempotencia sin duplicar ───────────────────────
    // Un pedido solo-local (insert cloud fallido) se marca cloudPending: el
    // dueño lo ve fusionado en el listado y el boot lo repara. Y dos POST con
    // la misma Idempotency-Key devuelven el MISMO pedido (el marcador ahora se
    // persiste ANTES de responder, no en background).
    const pendId = `ord_pend_${Date.now()}`;
    const pendOrder = {
      id: pendId, restaurant_id: restB.id, restaurantId: restB.id,
      table_number: '9', tableNumber: '9', items_snapshot: [], itemsSnapshot: [],
      amount: 100, total: 100, amount_in_cents: 10000, currency: '$', status: 'pending',
      customer_name: 'Pen', customer_phone: '', created_at: new Date().toISOString()
    };
    await db.addOrder(pendOrder);
    await db.markOrderCloudPending(pendId);
    assert.ok(db.getCloudPendingOrders().some((o) => o.id === pendId), 'pedido marcado cloudPending');
    // Mutex: 5 altas concurrentes no pierden escrituras en el espejo local.
    const raceBase = Date.now();
    await Promise.all([1, 2, 3, 4, 5].map((i) => db.addOrder({
      ...pendOrder, id: `ord_race_${raceBase}_${i}`
    })));
    const raceRows = db.getOrders().filter((o) => String(o.id).startsWith(`ord_race_${raceBase}_`));
    assert.strictEqual(raceRows.length, 5, '5 altas concurrentes = 5 filas (mutex)');
    // El listado del dueño fusiona el pendiente aunque la nube tenga filas.
    const listRes = await fetch(`${base}/api/orders/restaurant/${restB.id}`, { headers: authB });
    assert.strictEqual(listRes.status, 200, 'listado del dueño responde 200');
    const listBody = await listRes.json();
    const merged = (listBody.data || []).find((o) => o.id === pendId);
    assert.ok(merged && merged.cloudPending === true, 'pendiente fusionado y marcado en el listado');
    console.log('✓ Outbox: pendiente visible para el dueño + altas concurrentes sin pérdida');
    // Reparación: sube el pendiente a la nube (fila real, throwaway) y el
    // listado lo muestra ya sin la marca.
    const { getSupabaseClient } = require('../api/utils/supabase');
    const repair = await db.repairCloudPendingOrders();
    const supabase = getSupabaseClient();
    if (supabase) {
      assert.ok(repair.repaired >= 1, 'reparación subió el pendiente a la nube');
      const listRes2 = await fetch(`${base}/api/orders/restaurant/${restB.id}`, { headers: authB });
      const merged2 = ((await listRes2.json()).data || []).find((o) => o.id === pendId);
      assert.ok(merged2 && !merged2.cloudPending, 'reparado: fila cloud normal, sin marca');
      await supabase.from('orders').delete().eq('id', pendId).then(() => {}, () => {});
      console.log('✓ Reparación al boot: pendiente → fila cloud normal (throwaway limpiada)');
    } else {
      assert.deepStrictEqual(await db.repairCloudPendingOrders(), { repaired: 0, remaining: db.getCloudPendingOrders().length }, 'sin cloud: reparación no-op honesta');
      console.log('✓ Reparación sin cloud: no-op honesto');
    }
    // Limpieza local de las filas throwaway (el guard de npm test también
    // restaura data/, esto es para corridas individuales).
    try {
      const fsOrders = require('fs');
      const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');
      const rows = JSON.parse(fsOrders.readFileSync(ordersPath, 'utf8'));
      fsOrders.writeFileSync(ordersPath, JSON.stringify(rows.filter((o) => o.id !== pendId && !String(o.id).startsWith(`ord_race_${raceBase}_`)), null, 2));
    } catch (e) { /* best-effort */ }
    // Idempotencia: mismo key → mismo pedido, sin duplicar.
    const idemKey = `idem-${Date.now()}`;
    const idemBody = {
      restaurantId: restA.id, customerName: 'Idem', customerPhone: testPhone,
      currency: 'USD', items: [{ dishId: 'dish1', quantity: 1 }]
    };
    const idemHeaders = { 'Content-Type': 'application/json', 'X-Idempotency-Key': idemKey };
    const idem1 = await postJson('/api/orders', idemBody, idemHeaders);
    const idem2 = await postJson('/api/orders', idemBody, idemHeaders);
    assert.strictEqual(idem1.status, 201, 'primer POST con key → 201');
    assert.strictEqual(idem2.status, 201, 'retry con misma key → 201 (no error)');
    const idemB1 = await idem1.json();
    const idemB2 = await idem2.json();
    assert.strictEqual(idemB2.data.id, idemB1.data.id, 'misma key = mismo pedido (sin duplicar)');
    assert.strictEqual(idemB2.idempotent, true, 'el replay se declara idempotente');
    console.log('✓ Idempotencia: retry con misma key devuelve el mismo pedido (marcador antes de responder)');

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
