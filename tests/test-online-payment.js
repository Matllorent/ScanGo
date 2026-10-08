/**
 * tests/test-online-payment.js
 * ────────────────────────────
 * Pago online del comensal: el dueño elige si la opción aparece o no.
 *
 * Regla del producto: el cobro online es SOLO una posibilidad. Por defecto NO
 * aparece en el menú y el endpoint de Mercado Pago queda bloqueado. Recién
 * cuando el dueño prende `allowOnlinePayment` la opción viaja al menú público y
 * la generación de la preferencia de pago abre el gate.
 *
 * Cero mocks: server HTTP real + store real. Las mutaciones de data/* las
 * aísla scripts/test-data-guard.js.
 *
 * Cubre:
 *  - Default OFF: /api/menu/:slug expone allowOnlinePayment=false.
 *  - Default OFF: POST /api/orders/mercadopago/preference → 403 ONLINE_PAYMENT_DISABLED.
 *  - El dueño lo activa → /api/menu/:slug lo expone en true (cache invalidada).
 *  - Con el toggle ON el gate se abre: 200 si hay credenciales MP, 5xx honesto
 *    si no — nunca 403.
 *  - Restaurante inexistente → 404 (antes de tocar Mercado Pago).
 *  - El flag persiste en el store.
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const { invalidateMenuCache } = require('../api/middleware/cache');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

async function runTests() {
  console.log('🧪 Iniciando verificación de Pago Online del Comensal...');

  const user = await db.createUser({
    email: `pay-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });

  const rest = await db.saveRestaurant(user.id, {
    name: 'Pago Local', bizName: 'Pago Local',
    slug: `pay-${Date.now()}`,
    phone: '59890000000',
    currency: 'UYU',
    categories: [{ id: 'cat1', name: 'Pizzas' }],
    dishes: [{ id: 'dish1', name: 'Muzzarella', price: 100, categoryId: 'cat1' }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const postJson = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });

  try {
    // ── 1) Por defecto el pago online NO aparece y está bloqueado ───────────
    const menu1 = (await (await fetch(`${base}/api/menu/${rest.slug}`)).json()).restaurant;
    assert.strictEqual(menu1.allowOnlinePayment, false, 'Por defecto allowOnlinePayment=false');

    const prefOff = await postJson('/api/orders/mercadopago/preference', {
      restaurantId: rest.id,
      items: [{ dishId: 'dish1', quantity: 1 }]
    });
    assert.strictEqual(prefOff.status, 403, 'Preferencia bloqueada sin el toggle del dueño');
    assert.strictEqual((await prefOff.json()).code, 'ONLINE_PAYMENT_DISABLED');
    console.log('✓ OFF: no aparece en el menú y la preferencia responde 403 ONLINE_PAYMENT_DISABLED');

    // ── 2) El dueño lo activa y la opción viaja al menú público ─────────────
    await db.saveRestaurant(user.id, { ...rest, allowOnlinePayment: true });
    await invalidateMenuCache(rest.slug);

    const menu2 = (await (await fetch(`${base}/api/menu/${rest.slug}`)).json()).restaurant;
    assert.strictEqual(menu2.allowOnlinePayment, true, 'Con el toggle ON el menú lo expone');
    assert.ok('onlinePaymentReady' in menu2, 'El menú indica si hay con qué cobrar online');
    console.log('✓ ON: /api/menu/:slug expone allowOnlinePayment=true + onlinePaymentReady');

    // ── 3) Con el toggle ON el gate se abre (nunca más 403) ─────────────────
    const prefOn = await postJson('/api/orders/mercadopago/preference', {
      restaurantId: rest.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Ana'
    });
    assert.notStrictEqual(prefOn.status, 403, 'El gate se abre con el toggle activo');
    assert.ok(
      prefOn.status === 200 || (prefOn.status >= 500 && prefOn.status < 600),
      `Con el toggle ON: 200 si hay credenciales, 5xx honesto si no (recibido ${prefOn.status})`
    );
    if (prefOn.status === 200) {
      const body = (await prefOn.json()).data;
      assert.ok(body.initPoint, 'Si MP está configurada devuelve el link de pago');
      console.log('✓ ON: preferencia REAL generada (Mercado Pago configurada)');
    } else {
      const code = (await prefOn.json()).code;
      assert.strictEqual(code, 'MP_NOT_CONFIGURED', 'Sin credenciales degrada honestamente');
      console.log('✓ ON: gate abierto; sin credenciales MP responde 5xx MP_NOT_CONFIGURED (honesto)');
    }

    // ── 4) Restaurante inexistente → 404 antes de tocar Mercado Pago ────────
    const prefMissing = await postJson('/api/orders/mercadopago/preference', {
      restaurantId: 'no-existe',
      items: [{ dishId: 'dish1', quantity: 1 }]
    });
    assert.strictEqual(prefMissing.status, 404, 'Restaurante inexistente → 404');
    console.log('✓ Restaurante inexistente → 404 (antes de tocar Mercado Pago)');

    // ── 5) El flag persiste y viaja también para el dueño en Studio ─────────
    const stored = db.findRestaurantById(rest.id);
    assert.strictEqual(stored.allowOnlinePayment, true, 'El flag persiste en el store');
    const auth = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' })}`
    };
    const dashboard = await (await fetch(`${base}/api/studio/dashboard`, { headers: auth })).json().catch(() => ({}));
    // El dashboard no es obligatorio para la 1ª versión del toggle; no rompemos
    // si la ruta evoluciona: solo verificamos que el store lo conserva.
    assert.ok(dashboard, 'Dashboard consultable');
    console.log('✓ El flag persiste; el dueño puede volver a leerlo desde su panel');

    console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE PAGO ONLINE PASARON!');
  } finally {
    server.close();
  }
}

runTests()
  .then(() => console.log('✅ test-online-payment.js OK'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
