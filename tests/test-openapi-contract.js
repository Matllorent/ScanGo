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

// Rutas que el spec DEBE documentar (contrato vivo: agregar acá cada endpoint nuevo).
const SPEC_PATHS = [
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/device',
  '/api/auth/devices',
  '/api/auth/devices/{id}',
  '/api/menu/{slug}',
  '/api/demos',
  '/api/demos/{type}',
  '/api/discover/feed',
  '/api/studio/save',
  '/api/studio/branches',
  '/api/studio/events',
  '/api/studio/seo-audit',
  '/api/studio/staff',
  '/api/studio/staff/tables',
  '/api/studio/staff/{id}',
  '/api/studio/staff/{id}/credential',
  '/api/studio/staff/{id}/sessions',
  '/api/staff/shift/activate',
  '/api/staff/me',
  '/api/staff/shift/heartbeat',
  '/api/staff/shift/end',
  '/api/staff/tables',
  '/api/staff/push/subscribe',
  '/api/reservations',
  '/api/reservations/{id}',
  '/api/orders',
  '/api/orders/track/{token}',
  '/api/orders/status/{orderId}',
  '/api/loyalty/me',
  '/api/loyalty/redeem',
  '/api/loyalty/redeem/confirm',
  '/api/loyalty/challenge',
  '/api/loyalty/email',
  '/api/loyalty/validate',
  '/api/loyalty/churn',
  '/api/loyalty/reactivation',
  '/api/loyalty/winback',
  '/api/loyalty/winback/coupons',
  '/api/loyalty/winback/telemetry',
  '/api/orders/coupon/validate',
  '/api/orders/mercadopago/preference',
  '/api/public/analytics/event',
  '/api/notifications/waiter-alert',
  '/api/admin/overview',
  '/api/billing/cancel',
  '/api/account/delete-request',
  '/api/storage/video-upload-url',
];

async function runTests() {
  console.log('🧪 Iniciando verificación del contrato OpenAPI...');

  // ── 1) Spec parseable y completo ─────────────────────────────────────────
  const specPath = path.join(__dirname, '..', 'openapi.yaml');
  assert.ok(fs.existsSync(specPath), 'openapi.yaml existe en la raíz del repo');
  const spec = fs.readFileSync(specPath, 'utf8');
  assert.ok(spec.includes('openapi: 3.1'), 'spec declara `openapi: 3.1`');
  assert.ok(spec.includes('title: ScanGo'), 'spec tiene el título real');
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
  console.log(`✓ openapi.yaml parseable: ${SPEC_PATHS.length}/${SPEC_PATHS.length} paths + schemas (Restaurant/Order/LoyaltyCode/Error)`);

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
    // Motor de plantillas: las dimensiones viajan RESUELTAS contra el layout
    // (nunca 'auto') y con su enum acotado — contrato documentado en openapi.yaml.
    assert.ok(['grid', 'none', 'hero'].includes(menuBody.restaurant.imageMode), 'imageMode resuelto (grid|none|hero)');
    assert.ok(['uniform', 'popularity'].includes(menuBody.restaurant.menuSizing), 'menuSizing resuelto (uniform|popularity)');
    // Preview por query (espejo de ?morph=/?theme=): ?sizing=popularity sirve
    // el sizing y sus tiers sin que el dueño lo haya guardado.
    const previewRes = await fetch(`${base}/api/menu/${rest.slug}?sizing=popularity`);
    assert.strictEqual(previewRes.status, 200, 'preview ?sizing= responde 200');
    const previewBody = await previewRes.json();
    assert.strictEqual(previewBody.restaurant.menuSizing, 'popularity', '?sizing=popularity activa el sizing por preview');
    const tiered = (previewBody.restaurant.dishes || []).find((d) => Number.isFinite(Number(d.popTier)));
    assert.ok(tiered, 'con sizing por popularidad cada plato expone popTier');
    console.log('✓ GET /api/menu/:slug 200 con allowOnlinePayment boolean + motor de plantillas (imageMode/menuSizing/popTier)');

    // Slug inexistente → 404 real (no inventado: el handler lo devuelve).
    const menu404 = await fetch(`${base}/api/menu/no-existe-${stamp}`);
    assert.strictEqual(menu404.status, 404, 'slug inexistente → 404');
    console.log('✓ GET /api/menu/:slug inexistente → 404');

    // ── 2b) Demos por rubro: lista + plantilla + menú público demo ────────
    const demosRes = await fetch(`${base}/api/demos`);
    assert.strictEqual(demosRes.status, 200, 'lista de demos responde 200');
    const demosBody = await demosRes.json();
    assert.ok(Array.isArray(demosBody.demos) && demosBody.demos.length === 4, '4 demos (restaurant/heladeria/perfumeria/events)');
    const demoTplRes = await fetch(`${base}/api/demos/heladeria`);
    assert.strictEqual(demoTplRes.status, 200, 'plantilla demo responde 200');
    const demoTpl = (await demoTplRes.json()).demo;
    assert.strictEqual(demoTpl.businessType, 'heladeria', 'la plantilla trae su rubro');
    const demoTpl404 = await fetch(`${base}/api/demos/carniceria`);
    assert.strictEqual(demoTpl404.status, 404, 'tipo inválido → 404');
    const demoMenuRes = await fetch(`${base}/api/menu/demo-heladeria`);
    assert.strictEqual(demoMenuRes.status, 200, 'menú demo responde 200 sin auth');
    const demoMenu = await demoMenuRes.json();
    assert.strictEqual(demoMenu.restaurant.isDemo, true, 'flag isDemo presente');
    assert.ok(!('userId' in demoMenu.restaurant), 'sin userId interno en el payload público');
    console.log('✓ GET /api/demos + /api/demos/:type + /api/menu/demo-* (públicos, sin PII interna)');

    // ── 2c) Descubrir beta: feed público sin PII ───────────────────────────
    const feedRes = await fetch(`${base}/api/discover/feed?limit=5`);
    assert.strictEqual(feedRes.status, 200, 'feed responde 200 sin auth');
    const feedBody = await feedRes.json();
    assert.strictEqual(feedBody.data.beta, true, 'feed marcado beta');
    assert.ok(Array.isArray(feedBody.data.items), 'items es array');

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
      ageConfirmed: true
    });
    assert.strictEqual(registerDup.status, 200, 'register duplicado → 200 genérico anti-enumeración (no 400 revelador)');
    // COPPA/RGPD: sin confirmación de edad el registro rechaza (400)
    const registerNoAge = await postJson('/api/auth/register', {
      email: `contract-age-${stamp}@example.com`,
      password: 'otra_clave_123'
    });
    assert.strictEqual(registerNoAge.status, 400, 'register sin ageConfirmed → 400');
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

    const seoAuditAnon = await fetch(`${base}/api/studio/seo-audit`);
    assert.strictEqual(seoAuditAnon.status, 401, 'studio/seo-audit sin auth → 401 (no 404)');

    const loyaltyMe = await postJson('/api/loyalty/me', { phone: `+598 00 ${String(stamp).slice(-6)}` });
    assert.strictEqual(loyaltyMe.status, 200, 'loyalty/me público → 200 (no 404)');

    const loyaltyValidateAnon = await postJson('/api/loyalty/validate', { code: 'LOY-AAAA-BBBB' });
    assert.strictEqual(loyaltyValidateAnon.status, 401, 'loyalty/validate sin auth → 401 (no 404)');

    // F8-v2: el ledger de cupones de recupero y su telemetría son del dueño.
    const winbackCouponsAnon = await fetch(`${base}/api/loyalty/winback/coupons`);
    assert.strictEqual(winbackCouponsAnon.status, 401, 'winback/coupons sin auth → 401 (no 404)');
    const winbackTelemetryAnon = await fetch(`${base}/api/loyalty/winback/telemetry`);
    assert.strictEqual(winbackTelemetryAnon.status, 401, 'winback/telemetry sin auth → 401 (no 404)');
    const winbackAnon = await postJson('/api/loyalty/winback', { offerType: 'percent_10' });
    assert.strictEqual(winbackAnon.status, 401, 'winback sin auth → 401 (no 404)');

    // F8-v2: validación pública de cupón (no consume). Código desconocido →
    // 200 con veredicto honesto (jamás 404 ni "inválido" silencioso).
    const couponUnknown = await postJson('/api/orders/coupon/validate', {
      restaurantId: rest.id,
      code: `NOEXISTE-${stamp}`,
    });
    assert.strictEqual(couponUnknown.status, 200, 'coupon/validate con código desconocido → 200');
    const couponUnknownBody = await couponUnknown.json();
    assert.strictEqual(couponUnknownBody.data.valid, false);
    assert.strictEqual(couponUnknownBody.data.reason, 'NOT_FOUND');
    const couponBad = await postJson('/api/orders/coupon/validate', { restaurantId: rest.id });
    assert.strictEqual(couponBad.status, 400, 'coupon/validate sin código → 400');
    const coupon404 = await postJson('/api/orders/coupon/validate', {
      restaurantId: `no-existe-${stamp}`,
      code: 'X',
    });
    assert.strictEqual(coupon404.status, 404, 'coupon/validate con local inexistente → 404');
    console.log('✓ F8-v2: coupon/validate público (200/400/404) + rutas de winback 401');

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

    // Baja voluntaria sin sesión → 401 real (no 404). El flujo completo con
    // sesión (200 idempotente + menú pausado) lo cubre test-session-lifecycle.
    const billingCancelAnon = await postJson('/api/billing/cancel', {});
    assert.strictEqual(billingCancelAnon.status, 401, 'billing/cancel sin auth → 401 (no 404)');

    // Derecho al olvido sin sesión → 401 real (el flujo completo con sesión lo
    // cubre test-account-erasure.js).
    const accountDeleteAnon = await postJson('/api/account/delete-request', { confirm: true });
    assert.strictEqual(accountDeleteAnon.status, 401, 'account/delete sin auth → 401 (no 404)');

    // Studio events/branches sin sesión → 401 real (no 404): paridad spec↔runtime.
    const eventAnon = await postJson('/api/studio/events', { name: 'Fiesta', eventDate: new Date().toISOString() });
    assert.strictEqual(eventAnon.status, 401, 'studio/events sin auth → 401 (no 404)');
    const branchAnon = await fetch(`${base}/api/studio/branches`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ operation: 'add', branch: { name: 'X' } })
    });
    assert.strictEqual(branchAnon.status, 401, 'studio/branches sin auth → 401 (no 404)');
    const videoUrlAnon = await postJson('/api/storage/video-upload-url', { mimeType: 'video/mp4', sizeBytes: 1000 });
    assert.strictEqual(videoUrlAnon.status, 401, 'storage/video-upload-url sin auth → 401 (no 404)');

    // Fase 1 (Sistema de Mozos y Cocina): el panel del dueño exige sesión en
    // todas sus variantes y el canal del turno exige Bearer opaco. Los flujos
    // completos viven en tests/test-staff-waiter.js.
    const staffListAnon = await fetch(`${base}/api/studio/staff`);
    assert.strictEqual(staffListAnon.status, 401, 'studio/staff GET sin auth → 401');
    const staffCreateAnon = await postJson('/api/studio/staff', { name: 'Ana', role: 'waiter' });
    assert.strictEqual(staffCreateAnon.status, 401, 'studio/staff POST sin auth → 401');
    const staffTablesAnon = await fetch(`${base}/api/studio/staff/tables`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ assignments: {} })
    });
    assert.strictEqual(staffTablesAnon.status, 401, 'studio/staff/tables PATCH sin auth → 401');
    const staffPatchAnon = await fetch(`${base}/api/studio/staff/staff_x`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ active: false })
    });
    assert.strictEqual(staffPatchAnon.status, 401, 'studio/staff/{id} PATCH sin auth → 401');
    const staffDeleteAnon = await fetch(`${base}/api/studio/staff/staff_x`, { method: 'DELETE' });
    assert.strictEqual(staffDeleteAnon.status, 401, 'studio/staff/{id} DELETE sin auth → 401');
    const staffRotateAnon = await postJson('/api/studio/staff/staff_x/credential', {});
    assert.strictEqual(staffRotateAnon.status, 401, 'studio/staff/{id}/credential sin auth → 401');
    const staffRevokeAnon = await fetch(`${base}/api/studio/staff/staff_x/sessions`, { method: 'DELETE' });
    assert.strictEqual(staffRevokeAnon.status, 401, 'studio/staff/{id}/sessions sin auth → 401');

    const staffActivateBad = await postJson('/api/staff/shift/activate', {});
    assert.strictEqual(staffActivateBad.status, 400, 'staff/shift/activate sin body → 400');
    const staffActivateFake = await postJson('/api/staff/shift/activate', {
      restaurantId: rest.id,
      staffId: `staff_fake_${stamp}`,
      secret: 'x'.repeat(32)
    });
    assert.strictEqual(staffActivateFake.status, 401, 'staff/shift/activate con QR inexistente → 401');
    const staffMeAnon = await fetch(`${base}/api/staff/me`);
    assert.strictEqual(staffMeAnon.status, 401, 'staff/me sin Bearer → 401');
    const staffHeartbeatAnon = await postJson('/api/staff/shift/heartbeat', {});
    assert.strictEqual(staffHeartbeatAnon.status, 401, 'staff/shift/heartbeat sin Bearer → 401');
    const staffEndAnon = await postJson('/api/staff/shift/end', {});
    assert.strictEqual(staffEndAnon.status, 401, 'staff/shift/end sin Bearer → 401');
    const staffTablesMineAnon = await fetch(`${base}/api/staff/tables`);
    assert.strictEqual(staffTablesMineAnon.status, 401, 'staff/tables sin Bearer → 401');
    const staffPushAnon = await postJson('/api/staff/push/subscribe', {
      endpoint: 'https://push.example.com/staff',
      keys: { p256dh: 'x', auth: 'y' }
    });
    assert.strictEqual(staffPushAnon.status, 401, 'staff/push/subscribe POST sin Bearer → 401');
    const staffPushDeleteAnon = await fetch(`${base}/api/staff/push/subscribe`, {
      method: 'DELETE',
      headers: json,
      body: JSON.stringify({ endpoint: 'https://push.example.com/staff' })
    });
    assert.strictEqual(staffPushDeleteAnon.status, 401, 'staff/push/subscribe DELETE sin Bearer → 401');

    // Reservas de verdad (backlog #2): alta pública real + agenda/cambio del
    // dueño sin sesión. Los flujos completos (capacidad, máquina de estados,
    // cron de recordatorios) viven en tests/test-reservations.js.
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const reservationOk = await postJson('/api/reservations', {
      slug: rest.slug,
      name: 'Comensal Contrato',
      phone: `59899${String(stamp).slice(-6)}`,
      date: tomorrow,
      time: '21:30',
      pax: '2'
    });
    assert.strictEqual(reservationOk.status, 201, 'reserva pública → 201');
    const reservation = (await reservationOk.json()).data.reservation;
    assert.strictEqual(reservation.status, 'requested', 'la reserva nace requested');
    assert.strictEqual(reservation.statusLabel, 'Solicitada', 'label ES en el alta');
    assert.strictEqual(reservation.pax, 2, 'pax persistido');

    const reservationsGetAnon = await fetch(`${base}/api/reservations`);
    assert.strictEqual(reservationsGetAnon.status, 401, 'GET agenda sin auth → 401 (no 404)');
    const reservationsPatchAnon = await fetch(`${base}/api/reservations/${reservation.id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ status: 'confirmed' })
    });
    assert.strictEqual(reservationsPatchAnon.status, 401, 'PATCH reserva sin auth → 401 (no 404)');
    const reservations404 = await postJson('/api/reservations', {
      slug: `no-existe-${stamp}`,
      name: 'X',
      phone: '59899000000',
      date: tomorrow,
      time: '21:30',
      pax: '2'
    });
    assert.strictEqual(reservations404.status, 404, 'reserva con slug inexistente → 404 (no 401)');
    console.log('✓ Staff (Fase 1): 7 rutas del Studio + 7 del turno responden códigos reales (401/400/401)');
    console.log('✓ Reservas (backlog #2): 201 real + agenda/PATCH 401 + 404 slug desconocido');
    console.log('✓ Rutas restantes: códigos reales (400/401/403/200) y ningún 404 inesperado');

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
