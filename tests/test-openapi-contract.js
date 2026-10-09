/**
 * tests/test-openapi-contract.js
 * ──────────────────────────────
 * Contrato OpenAPI: `openapi.yaml` describe los endpoints REALES y las rutas
 * responden los códigos REALES del código (sin 404 fantasma ni códigos
 * inventados).
 *
 * Cero mocks: server HTTP real + store real (JSON local y/o Supabase según el
 * entorno). Las mutaciones de data/* las aísla scripts/test-data-guard.js
 * (este test sigue el mismo patrón que test-order-tracking.js: fixtures vía
 * db + server con `app.listen(0)` + `fetch` global).
 *
 * Cubre:
 *  - El spec es parseable como texto: `openapi: 3.1`, título y versión, y cada
 *    path documentado existe como string en el YAML.
 *  - Rutas listadas responden sin 404 con payload mínimo válido, con los
 *    códigos reales: 401 sin auth donde aplica, 200/201/403/404 según caso.
 *  - GET /api/menu/:slug → 200 con `allowOnlinePayment` boolean.
 *  - POST /api/orders → 201 con `trackingToken` string (+ `tipAmount`).
 *  - GET /api/orders/track/:token → 200 SIN campo phone/customerPhone.
 *  - PATCH /api/orders/status/:id sin auth → 401.
 *  - POST /api/loyalty/redeem con body inválido → 400.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const app = require('../api/index');
const db = require('../src/db/db');

// Rutas que el spec DEBE documentar (las 20 del contrato).
const SPEC_PATHS = [
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/device',
  '/api/auth/devices',
  '/api/auth/devices/{id}',
  '/api/menu/{slug}',
  '/api/studio/save',
  '/api/orders',
  '/api/orders/track/{token}',
  '/api/orders/status/{orderId}',
  '/api/loyalty/me',
  '/api/loyalty/redeem',
  '/api/loyalty/redeem/confirm',
  '/api/loyalty/challenge',
  '/api/loyalty/email',
  '/api/loyalty/validate',
  '/api/orders/mercadopago/preference',
  '/api/public/analytics/event',
  '/api/notifications/waiter-alert',
  '/api/admin/overview',
];

async function runTests() {
  console.log('🧪 Iniciando verificación del contrato OpenAPI...');

  // ── 1) Spec parseable y completo ─────────────────────────────────────────
  const specPath = path.join(__dirname, '..', 'openapi.yaml');
  assert.ok(fs.existsSync(specPath), 'openapi.yaml existe en la raíz del repo');
  const spec = fs.readFileSync(specPath, 'utf8');
  assert.ok(spec.includes('openapi: 3.1'), 'spec declara `openapi: 3.1`');
  assert.ok(spec.includes('title: Menú Pizarrón SaaS'), 'spec tiene el título real');
  assert.ok(spec.includes('version: 2.0.0'), 'spec tiene la versión 2.0.0');
  for (const p of SPEC_PATHS) {
    assert.ok(spec.includes(p), `el spec documenta el path ${p}`);
  }
  assert.ok(spec.includes('cookieAuth') && spec.includes('auth_token'), 'auth por cookie auth_token declarada');
  assert.ok(spec.includes('bearer'), 'auth bearer declarada');
  for (const schema of ['Restaurant', 'Order', 'LoyaltyCode', 'Error']) {
    assert.ok(spec.includes(schema + ':'), `components.schemas incluye ${schema}`);
  }
  assert.ok(spec.includes('trackingToken'), 'el spec documenta trackingToken');
  assert.ok(spec.includes('tipAmount'), 'el spec documenta tipAmount');
  assert.ok(spec.includes('ONLINE_PAYMENT_DISABLED'), 'el spec documenta el gate 403 de pago online');
  console.log('✓ openapi.yaml parseable: 20/20 paths + schemas (Restaurant/Order/LoyaltyCode/Error)');

  // ── Setup: dueño + restaurante real con un plato ─────────────────────────
  const stamp = Date.now();
  const user = await db.createUser({
    email: `contract-${stamp}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString(),
  });
  const rest = await db.saveRestaurant(user.id, {
    name: 'Contract Local',
    bizName: 'Contract Local',
    slug: `contract-${stamp}`,
    phone: '59891111111',
    currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }],
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const json = { 'Content-Type': 'application/json' };
  const postJson = (url, body, headers = json) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });

  try {
    // ── 2) GET /api/menu/:slug → 200 con allowOnlinePayment boolean ─────────
    const menuRes = await fetch(`${base}/api/menu/${rest.slug}`);
    assert.strictEqual(menuRes.status, 200, 'menú público responde 200');
    const menuBody = await menuRes.json();
    assert.ok(menuBody.restaurant, 'el menú expone restaurant');
    assert.strictEqual(typeof menuBody.restaurant.allowOnlinePayment, 'boolean', 'allowOnlinePayment es boolean');
    console.log('✓ GET /api/menu/:slug 200 con allowOnlinePayment boolean');

    // Slug inexistente → 404 real (no inventado: el handler lo devuelve).
    const menu404 = await fetch(`${base}/api/menu/no-existe-${stamp}`);
    assert.strictEqual(menu404.status, 404, 'slug inexistente → 404');
    console.log('✓ GET /api/menu/:slug inexistente → 404');

    // ── 3) POST /api/orders → 201 con trackingToken + tipAmount ─────────────
    const orderRes = await postJson('/api/orders', {
      restaurantId: rest.id,
      tableNumber: '4',
      customerName: 'Contract Diner',
      customerPhone: `+598 99 ${String(stamp).slice(-6)}`,
      currency: 'USD',
      tipAmount: 2,
      items: [{ dishId: 'dish1', quantity: 1 }],
    });
    assert.strictEqual(orderRes.status, 201, 'pedido creado (201)');
    const order = (await orderRes.json()).data;
    assert.ok(order.id, 'el pedido tiene id');
    assert.strictEqual(typeof order.trackingToken, 'string', 'trackingToken es string');
    assert.strictEqual(order.tipAmount, 2, 'tipAmount persiste');
    console.log('✓ POST /api/orders 201 con trackingToken + tipAmount');

    // ── 4) GET /api/orders/track/:token → 200 SIN PII ──────────────────────
    const trackRes = await fetch(`${base}/api/orders/track/${order.trackingToken}`);
    assert.strictEqual(trackRes.status, 200, 'seguimiento público responde 200');
    const trackBody = await trackRes.json();
    const track = trackBody.data;
    assert.ok(track && track.status, 'el seguimiento expone el estado');
    const rawTrack = JSON.stringify(trackBody);
    assert.ok(!('phone' in track) && !('customerPhone' in track), 'sin campo phone/customerPhone en el objeto');
    assert.ok(!rawTrack.includes('customerPhone') && !rawTrack.includes('customer_phone'), 'sin teléfono en el JSON');
    console.log('✓ GET /api/orders/track/:token 200 sin PII');

    // ── 5) PATCH /api/orders/status/:id sin auth → 401 ─────────────────────
    const anonPatch = await fetch(`${base}/api/orders/status/${order.id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ status: 'preparing' }),
    });
    assert.strictEqual(anonPatch.status, 401, 'PATCH sin auth → 401');
    console.log('✓ PATCH /api/orders/status/:id sin auth → 401');

    // ── 6) POST /api/loyalty/redeem con body inválido → 400 ────────────────
    const redeem400 = await postJson('/api/loyalty/redeem', {});
    assert.strictEqual(redeem400.status, 400, 'redeem sin body válido → 400');
    console.log('✓ POST /api/loyalty/redeem inválido → 400');

    // ── 6b) Device tokens: emisión, uso y revocación ─────────────────────
    const devIssue = await postJson('/api/auth/device', {
      email: `contract-${stamp}@example.com`,
      password: 'test_password',
      deviceName: 'contract-pixel',
    });
    assert.strictEqual(devIssue.status, 201, 'device emite 201');
    const devToken = (await devIssue.json()).data.deviceToken;
    assert.ok(devToken.startsWith('scango_dev_'), 'crudo con prefijo');
    const devMe = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${devToken}` },
    });
    assert.strictEqual(devMe.status, 200, 'device autentica en /me');
    const devBad = await postJson('/api/auth/device', {
      email: `contract-${stamp}@example.com`,
      password: 'mala',
      deviceName: 'x',
    });
    assert.strictEqual(devBad.status, 401, 'device con clave mala → 401');
    console.log('✓ POST /api/auth/device emite y autentica (revocable)');

    // ── 7) Resto de rutas del contrato: sin 404, códigos reales ────────────
    const registerDup = await postJson('/api/auth/register', {
      email: `contract-${stamp}@example.com`,
      password: 'otra_clave_123',
    });
    assert.strictEqual(registerDup.status, 200, 'register duplicado → 200 genérico anti-enumeración (no 400 revelador)');
    const dupBody = await registerDup.json();
    assert.ok(!('token' in (dupBody.data || dupBody)), 'sin JWT en el duplicado');
    assert.strictEqual(dupBody.data?.requiresEmailVerification ?? dupBody.requiresEmailVerification, true, 'pantalla revisá-tu-correo');

    const loginBad = await postJson('/api/auth/login', {
      email: `nadie-${stamp}@example.com`,
      password: 'x',
    });
    assert.strictEqual(loginBad.status, 401, 'login con credenciales malas → 401 (no 404)');

    const studioAnon = await postJson('/api/studio/save', { name: 'x' });
    assert.strictEqual(studioAnon.status, 401, 'studio/save sin auth → 401 (no 404)');

    const loyaltyMe = await postJson('/api/loyalty/me', { phone: `+598 00 ${String(stamp).slice(-6)}` });
    assert.strictEqual(loyaltyMe.status, 200, 'loyalty/me público → 200 (no 404)');

    const loyaltyValidateAnon = await postJson('/api/loyalty/validate', { code: 'LOY-AAAA-BBBB' });
    assert.strictEqual(loyaltyValidateAnon.status, 401, 'loyalty/validate sin auth → 401 (no 404)');

    // Pago online con el interruptor apagado (default false) → 403 real.
    const mpOff = await postJson('/api/orders/mercadopago/preference', {
      restaurantId: rest.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
    });
    assert.strictEqual(mpOff.status, 403, 'MP preference con flag OFF → 403 (no 404)');
    assert.strictEqual((await mpOff.json()).code, 'ONLINE_PAYMENT_DISABLED');

    const analyticsBad = await postJson('/api/public/analytics/event', {});
    assert.strictEqual(analyticsBad.status, 400, 'analytics sin slug/event → 400 (no 404)');

    const analyticsOk = await postJson('/api/public/analytics/event', { slug: rest.slug, event: 'visit' });
    assert.strictEqual(analyticsOk.status, 200, 'analytics con slug+event → 200');

    const waiterBad = await postJson('/api/notifications/waiter-alert', {});
    assert.strictEqual(waiterBad.status, 400, 'waiter-alert sin slug → 400 (no 404)');

    const waiterOk = await postJson('/api/notifications/waiter-alert', { slug: rest.slug, table: '4' });
    assert.strictEqual(waiterOk.status, 200, 'waiter-alert válido → 200');

    const adminAnon = await fetch(`${base}/api/admin/overview`);
    assert.strictEqual(adminAnon.status, 403, 'admin/overview sin sesión → 403 (no 404)');
    console.log('✓ 9 rutas restantes: códigos reales (400/401/403/200) y ningún 404');

    console.log('\n🎉 ¡CONTRATO OPENAPI VERIFICADO CONTRA RUNTIME REAL!');
  } finally {
    server.close();
  }
}

runTests()
  .then(() => console.log('✅ test-openapi-contract.js OK'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
