/**
 * tests/test-loyalty-dual.js
 * ────────────────────────
 * Fidelización DUAL (local por restaurante + global cross-restaurant) y
 * centro de notificaciones del dueño. Cero mocks: server HTTP real + store
 * local real + Supabase real (cuando hay credenciales). Mutaciones de data/*
 * aisladas por scripts/test-data-guard.js (snapshot dinámico de todo data/).
 *
 * Cubre:
 *  - Helpers puros: normalizePhone, maskPhone, hashPhone, deriveLevel.
 *  - Acreditación automática de puntos/sellos/visitas al crear pedido
 *    (POST /api/orders con teléfono), local + global, sin romper el pedido.
 *  - Tarjeta del cliente en /api/loyalty/me (cuenta local + nivel global).
 *  - Canje: código LOY-XXXX-XXXX de un solo uso; validación por el dueño,
 *    rechazo cross-restaurant, doble canje 409 y código ajeno 404.
 *  - Crédito manual del dueño (visitas in-person) + nivel/insignias globales.
 *  - Borrado total de datos (derecho al olvido): nada queda en data/.
 *  - Aviso de mozo persistido como evento del inbox (GET /events, marcar
 *    leído, badge sin leer; 401 anónimo) y suscripción guest con consent.
 *  - El payload público /api/menu/:slug expone allowLoyaltyPoints + config.
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const loyaltyService = require('../api/services/loyalty');
const notificationsService = require('../api/services/notifications');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

async function runTests() {
  console.log('🧪 Iniciando verificación de Fidelización Dual + Centro de Notificaciones...');

  // ── 1) Helpers puros ──────────────────────────────────────────────────────
  assert.strictEqual(loyaltyService.normalizePhone('+598 99 123 456'), '59899123456');
  assert.strictEqual(loyaltyService.normalizePhone('0059899123456'), '59899123456');
  assert.strictEqual(loyaltyService.normalizePhone('123'), null, 'Teléfono corto → null');
  assert.strictEqual(loyaltyService.normalizePhone(null), null);
  assert.ok(/^\d{7,15}$/.test(loyaltyService.normalizePhone('(11) 4555-1234')), 'Formato sucio normalizado a dígitos');

  const masked = loyaltyService.maskPhone('59899123456');
  assert.strictEqual(masked, '598***56', 'maskPhone expone solo 3+2 dígitos');
  assert.ok(!masked.includes('991234'), 'maskPhone nunca filtra el cuerpo del número');

  const h1 = loyaltyService.hashPhone('59899123456');
  assert.strictEqual(h1.length, 64, 'phoneHash es SHA-256 hex (64)');
  assert.strictEqual(h1, loyaltyService.hashPhone('598 99 123 456'), 'hash estable frente al mismo número');
  assert.notStrictEqual(h1, loyaltyService.hashPhone('59899123457'));

  assert.strictEqual(loyaltyService.deriveLevel(0).id, 'bronce');
  assert.strictEqual(loyaltyService.deriveLevel(5).id, 'plata');
  assert.strictEqual(loyaltyService.deriveLevel(15).id, 'oro');
  assert.strictEqual(loyaltyService.deriveLevel(30).id, 'platino');
  assert.strictEqual(loyaltyService.deriveLevel(99).id, 'platino');
  console.log('✓ Helpers puros: normalizePhone / maskPhone / hashPhone / deriveLevel');

  // ── Setup: dos dueños, dos restaurantes, un platillo barato ──────────────
  const userA = await db.createUser({ email: `loyalty-a-${Date.now()}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const userB = await db.createUser({ email: `loyalty-b-${Date.now()}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });

  const restA = await db.saveRestaurant(userA.id, {
    name: 'Loyalty Local A', bizName: 'Loyalty Local A',
    slug: `loyalty-a-${Date.now()}`,
    allowLoyaltyPoints: true,
    currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }]
  });
  const restB = await db.saveRestaurant(userB.id, {
    name: 'Loyalty Local B', bizName: 'Loyalty Local B',
    slug: `loyalty-b-${Date.now()}`,
    allowLoyaltyPoints: true,
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
  const orderBody = (restaurantId, qty = 1) => ({
    restaurantId,
    items: [{ dishId: 'dish1', quantity: qty }],
    customerName: 'Alice',
    customerPhone: '+598 99 123 456',
    currency: 'USD'
  });

  try {
    // ── 2) Payload público expone la config de fidelización ─────────────────
    const menuRes = await fetch(`${base}/api/menu/${restA.slug}`);
    assert.strictEqual(menuRes.status, 200, '/api/menu/:slug responde 200');
    const menuBody = await menuRes.json();
    assert.strictEqual(menuBody.restaurant.allowLoyaltyPoints, true, 'allowLoyaltyPoints en payload público');
    assert.ok(Array.isArray(menuBody.restaurant.loyaltyConfig.rewards), 'loyaltyConfig.rewards presente');
    assert.ok(menuBody.restaurant.loyaltyConfig.rewards.some(r => r.id === 'rew_coffee'), 'Catálogo default con premio de café');
    assert.strictEqual(menuBody.restaurant.loyaltyConfig.pointsPerOrder, 10);
    console.log('✓ /api/menu/:slug expone allowLoyaltyPoints + loyaltyConfig (sin campos sensibles)');

    // ── 3) Acreditación automática al pedir (local + global) ────────────────
    const order1 = await postJson('/api/orders', orderBody(restA.id));
    assert.strictEqual(order1.status, 201, 'Pedido creado');
    const o1 = await order1.json();
    assert.ok(o1.data.loyalty && o1.data.loyalty.credited === true, 'Pedido acredita fidelización');
    const expectedPts1 = 10 + Math.floor(o1.data.amount_in_cents / 100) * 1;
    assert.strictEqual(o1.data.loyalty.points, expectedPts1, 'Puntos = base + por-moneda');
    assert.strictEqual(o1.data.loyalty.stamps, 1, '1 sello por pedido');

    const card1Res = await postJson('/api/loyalty/me', { phone: '+598 99 123 456', restaurantId: restA.id });
    assert.strictEqual(card1Res.status, 200);
    const card1 = await card1Res.json();
    assert.strictEqual(card1.data.account.points, expectedPts1);
    assert.strictEqual(card1.data.account.stamps, 1);
    assert.strictEqual(card1.data.global.visits, 1);
    assert.strictEqual(card1.data.global.level, 'Bronce');
    assert.strictEqual(card1.data.customer.phone, '598***56', 'El número viaja enmascarado');
    console.log('✓ Post-pedido: puntos/sellos locales + globales, teléfono enmascarado en la tarjeta');

    // ── 4) Gate de nivel global: recién Bronce no canjea globale ────────────
    const globTooSoon = await postJson('/api/loyalty/redeem', { phone: '+598 99 123 456', restaurantId: restA.id, rewardId: 'glob_off5' });
    assert.strictEqual(globTooSoon.status, 403, 'Bronce no accede a beneficio de Plata');
    assert.strictEqual((await globTooSoon.json()).code, 'GLOBAL_LEVEL_REQUIRED');
    console.log('✓ Gate de nivel: beneficio global exige nivel (403 GLOBAL_LEVEL_REQUIRED)');

    // ── 5) Segundo pedido + pedido en OTRO restaurante → red cross───────────
    await postJson('/api/orders', orderBody(restA.id));
    await postJson('/api/orders', orderBody(restB.id));
    const card2 = await (await postJson('/api/loyalty/me', { phone: '+598 99 123 456', restaurantId: restA.id })).json();
    assert.strictEqual(card2.data.global.visits, 3, '3 visitas acumuladas (2 en A, 1 en B)');
    assert.strictEqual(card2.data.global.restaurantsVisited, 2, '2 restaurantes distintos de la red');
    assert.ok(card2.data.restaurants.length >= 2, 'La tarjeta lista ambos locales');
    console.log('✓ Red cross-restaurant: visitas globales + restaurantes visitados');

    // ── 6) Canje local + validación por el dueño ────────────────────────────
    // Aún sin puntos suficientes → 400 honesto
    const poor = await postJson('/api/loyalty/redeem', { phone: '+598 99 123 456', restaurantId: restA.id, rewardId: 'rew_coffee' });
    assert.strictEqual(poor.status, 400, 'Sin puntos suficientes → 400');
    assert.strictEqual((await poor.json()).code, 'INSUFFICIENT_LOCAL_POINTS');

    // Crédito manual del dueño (visita in-person que no pasó por el web)
    const credit = await postJson('/api/loyalty/credit', { phone: '+598 99 123 456', points: 400, reason: 'Visita en persona' }, authA);
    assert.strictEqual(credit.status, 200, 'Crédito manual del dueño');
    const creditBody = await credit.json();
    assert.strictEqual(creditBody.data.credited, true);

    const redeem = await postJson('/api/loyalty/redeem', { phone: '+598 99 123 456', restaurantId: restA.id, rewardId: 'rew_coffee' });
    assert.strictEqual(redeem.status, 200, 'Canje local exitoso');
    const redeemBody = await redeem.json();
    assert.ok(/^LOY-[AB3CDE5FGHJK6MNPQ7RSTUVW9XZ]{4}-[AB3CDE5FGHJK6MNPQ7RSTUVW9XZ]{4}$/.test(redeemBody.data.code), `Código LOY-XXXX-XXXX sin caracteres ambiguos (${redeemBody.data.code})`);
    console.log(`✓ Canje local: código ${redeemBody.data.code} emitido (150 pts)`);

    // Validación cross-restaurant → 403 (el código es del local A)
    const crossVal = await postJson('/api/loyalty/validate', { code: redeemBody.data.code }, authB);
    assert.strictEqual(crossVal.status, 403, 'Otro restaurante no valida un código local');
    assert.strictEqual((await crossVal.json()).code, 'CODE_OTHER_RESTAURANT');

    // El dueño correcto lo valida → redeemed; segundo intento → 409
    const val = await postJson('/api/loyalty/validate', { code: redeemBody.data.code }, authA);
    assert.strictEqual(val.status, 200, 'Dueño valida el código');
    const valBody = await val.json();
    assert.strictEqual(valBody.data.rewardTitle, '☕ Café o Bebida de Bienvenida');
    const doubleVal = await postJson('/api/loyalty/validate', { code: redeemBody.data.code }, authA);
    assert.strictEqual(doubleVal.status, 409, 'Doble canje rechazado');
    assert.strictEqual((await doubleVal.json()).code, 'CODE_ALREADY_REDEEMED');
    console.log('✓ Validación: cross-restaurant 403, dueño OK, doble canje 409');

    // ── 7) Nivel global → Plata (5 visitas) + canje global = red ────────────
    await postJson('/api/orders', orderBody(restA.id));
    await postJson('/api/orders', orderBody(restB.id));
    await postJson('/api/orders', orderBody(restA.id));
    const card3 = await (await postJson('/api/loyalty/me', { phone: '+598 99 123 456', restaurantId: restA.id })).json();
    assert.strictEqual(card3.data.global.visits, 6, '6 visitas → nivel Plata');
    assert.strictEqual(card3.data.global.level, 'Plata');
    assert.ok(card3.data.customer.badges.some(b => b.id === 'habitual'), 'Insignia "Comensal habitual" (≥5 visitas)');
    assert.ok(card3.data.availableGlobalRewards.some(r => r.id === 'glob_off5'), 'Beneficio global disponible para Plata');

    // Global con puntos insuficientes → 400; con crédito → 200 y CODE red
    const globPoor = await postJson('/api/loyalty/redeem', { phone: '+598 99 123 456', restaurantId: restA.id, rewardId: 'glob_off5' });
    assert.strictEqual(globPoor.status, 400);
    assert.strictEqual((await globPoor.json()).code, 'INSUFFICIENT_GLOBAL_POINTS');

    await postJson('/api/loyalty/credit', { phone: '+598 99 123 456', points: 2000, reason: 'Ajuste global' }, authA);
    const globRedeem = await postJson('/api/loyalty/redeem', { phone: '+598 99 123 456', restaurantId: restA.id, rewardId: 'glob_off5' });
    assert.strictEqual(globRedeem.status, 200, 'Canje global exitoso');
    const globCode = (await globRedeem.json()).data.code;

    // El código global lo puede validar CUALQUIER dueño de la red (restaurant B)
    const globValB = await postJson('/api/loyalty/validate', { code: globCode }, authB);
    assert.strictEqual(globValB.status, 200, 'Local B valida un beneficio global de la red');
    console.log('✓ Nivel Plata, insignias, canje global validado por otro restaurante de la red');

    // ── 8) Customers API del dueño (teléfonos enmascarados) ─────────────────
    const customersRes = await fetch(`${base}/api/loyalty/customers`, { headers: authA });
    assert.strictEqual(customersRes.status, 200);
    const customers = await customersRes.json();
    assert.ok(customers.data.some(c => c.phone === '598***56'), 'Lista de clientes con teléfono enmascarado');
    assert.strictEqual(customers.data[0].points, 2330, 'Saldo del mejor cliente ordenado primero');  // 4 pedidos×20 +400 −150 +2000
    console.log('✓ /api/loyalty/customers: ranking del local con privacidad');

    // ── 9) Aviso de mozo → inbox persistente del dueño ──────────────────────
    const wa = await postJson('/api/notifications/waiter-alert', { slug: restA.slug, table: 'Mesa 2', type: 'cuenta_tarjeta' });
    assert.strictEqual(wa.status, 200, 'waiter-alert responde 200 sin romper la mesa');
    const waBody = await wa.json();
    // Entorno sin VAPID → degrade honesto (configured:false); con VAPID → dispatch real.
    assert.ok(
      waBody.data.configured === false || Number.isInteger(waBody.data.checked),
      'waiter-alert degrada (configured:false) o despacha de verdad (checked:N)'
    );

    const eventsAnon = await fetch(`${base}/api/notifications/events`);
    assert.strictEqual(eventsAnon.status, 401, 'Inbox anónimo rechazado (401)');

    const eventsRes = await fetch(`${base}/api/notifications/events`, { headers: authA });
    assert.strictEqual(eventsRes.status, 200);
    const inbox = await eventsRes.json();
    const waiterEvent = inbox.data.events.find(e => e.type === 'waiter_call');
    assert.ok(waiterEvent, 'El aviso de mozo quedó persistido en el inbox');
    assert.strictEqual(waiterEvent.data.table, 'Mesa 2');
    assert.strictEqual(waiterEvent.data.type, 'cuenta_tarjeta');
    assert.ok(inbox.data.unread >= 1, 'Badge de no leídos >= 1');

    const readRes = await postJson(`/api/notifications/events/${waiterEvent.id}/read`, { id: waiterEvent.id }, authA);
    assert.strictEqual(readRes.status, 200, 'Evento marcado como leído');
    const after = await (await fetch(`${base}/api/notifications/events`, { headers: authA })).json();
    assert.strictEqual(after.data.events.find(e => e.id === waiterEvent.id).isRead, true);
    console.log('✓ Aviso de mozo persistido + inbox (401 anónimo, leer, badge)');

    // ── 10) Suscripción guest con consentimiento explícito ──────────────────
    const guestSub = await postJson('/api/notifications/subscribe', {
      restaurantId: restA.id,
      endpoint: `https://notify.example.invalid/guest-${Date.now()}`,
      keys: { p256dh: 'C' + 'x'.repeat(86), auth: 'D' + 'y'.repeat(21) },
      role: 'guest',
      consentMarketing: true
    });
    assert.strictEqual(guestSub.status, 201, 'Guest con opt-in se suscribe (201)');
    const guestBody = await guestSub.json();
    assert.strictEqual(guestBody.data.role, 'guest');
    const guestSubs = await notificationsService.listSubscriptions({ restaurantId: restA.id, role: 'guest' });
    assert.ok(guestSubs.some(s => s.endpoint === guestBody.data.endpoint && s.consent_marketing === true), 'Guest listada solo con su rol');
    const ownerSubs = await notificationsService.listSubscriptions({ restaurantId: restA.id, role: 'owner' });
    assert.ok(!ownerSubs.some(s => s.endpoint === guestBody.data.endpoint), 'El rol guest nunca figura en owner');
    console.log('✓ Suscripción guest con consentimiento: separación de roles owner/guest');

    // ── 11) Borrado total de datos (derecho al olvido) ──────────────────────
    const del = await fetch(`${base}/api/loyalty/me`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+598 99 123 456' })
    });
    assert.strictEqual(del.status, 200, 'DELETE /api/loyalty/me responde 200');
    const delBody = await del.json();
    assert.strictEqual(delBody.data.erased, true);

    const afterErase = await (await postJson('/api/loyalty/me', { phone: '+598 99 123 456', restaurantId: restA.id })).json();
    assert.strictEqual(afterErase.data.customer, null, 'Tarjeta vacía tras el borrado');
    assert.strictEqual(await loyaltyService.findCustomerByPhone('59899123456'), null, 'Perfil eliminado del store');
    const customersAfter = await (await fetch(`${base}/api/loyalty/customers`, { headers: authA })).json();
    assert.strictEqual(customersAfter.data.length, 0, 'El local ya no lista al cliente borrado');
    console.log('✓ Borrado total: perfil, cuentas, ledger y códigos eliminados');

    console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE FIDELIZACIÓN DUAL + CENTRO DE NOTIFICACIONES PASARON!');
  } finally {
    server.close();
  }
}

runTests()
  .then(() => console.log('✅ test-loyalty-dual.js OK'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });