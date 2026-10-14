/**
 * tests/test-push-notifications.js
 * ─────────────────────────────────
 * Push Notifications Web (VAPID): suscripción en la nube, degradado honesto
 * sin llaves, clave pública servida y entrega REAL intentada al aviso de mozo
 * desde la mesa. Cero mocks: server HTTP real + DB real + web-push real.
 *
 * El endpoint de suscripción usa un dominio `.invalid` a propósito: garantiza
 * fallo de resolución DNS, así el test verifica que el servidor INTENTÓ la
 * entrega real (failed>=1) sin tocar infraestructura ajena.
 *
 * Está en el final de la cadena de `npm test` (nº 22). Los tests mutan
 * data/*.json (política del repo: se revierten a HEAD antes de commitear).
 */
const assert = require('assert');
const http = require('http');
const app = require('../api/index');
const db = require('../src/db/db');
const notificationsService = require('../api/services/notifications');

async function runTests() {
  console.log('🧪 Iniciando verificación de Push Notifications (Web Push real, VAPID)...');

  // Guardamos las llaves VAPID del entorno para restaurarlas al final
  const origPublic = process.env.VAPID_PUBLIC_KEY;
  const origPrivate = process.env.VAPID_PRIVATE_KEY;
  const origSubject = process.env.VAPID_SUBJECT;

  // 1) Sin VAPID → degradado honesto: 503 PUSH_NOT_CONFIGURED
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;

  const user = await db.createUser({
    email: `push-owner-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'Push QA',
    bizName: 'Push QA',
    slug: `push-qa-${Date.now()}`
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  try {
    // GET vapid-public-key sin configuración
    const keyRes = await fetch(`${base}/api/notifications/vapid-public-key`);
    assert.strictEqual(keyRes.status, 503, 'Sin VAPID la clave pública responde 503');
    const keyBody = await keyRes.json();
    assert.strictEqual(keyBody.code, 'PUSH_NOT_CONFIGURED');
    console.log('✓ Sin VAPID: 503 PUSH_NOT_CONFIGURED honesto (como pasarelas de pago)');

    // Suscripción inválida → 400
    const badSub = await fetch(`${base}/api/notifications/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restaurant.id, endpoint: 'not-a-url' })
    });
    assert.strictEqual(badSub.status, 400, 'Suscripción sin llaves rechazada (400)');

    // Suscripción válida → 201 y persiste (cloud o local)
    const endpoint = `https://notify.example.invalid/sub-${Date.now()}`;
    const goodSub = await fetch(`${base}/api/notifications/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantId: restaurant.id,
        endpoint,
        keys: { p256dh: 'A' + 'x'.repeat(86), auth: 'B' + 'y'.repeat(21) }
      })
    });
    assert.strictEqual(goodSub.status, 201, 'Suscripción válida registrada (201)');
    const subs = await notificationsService.listSubscriptions({ restaurantId: restaurant.id });
    assert.ok(subs.some(s => s.endpoint === endpoint), 'La suscripción quedó guardada');
    console.log('✓ Suscripción guardada (cloud/local) + validaciones 400');

    // 2) Con VAPID (par real generado) → clave pública servida + entrega intentada
    const webpush = require('web-push');
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = origSubject || 'mailto:soporte@menu-pizarron.com';

    const keyRes2 = await fetch(`${base}/api/notifications/vapid-public-key`);
    assert.strictEqual(keyRes2.status, 200, 'Con VAPID la clave pública se sirve');
    const keyBody2 = await keyRes2.json();
    assert.strictEqual(keyBody2.data.publicKey, keys.publicKey, 'Clave pública = la del par');

    // Aviso de mozo desde la mesa → intento real de entrega (endpoint .invalid falla)
    const wa = await fetch(`${base}/api/notifications/waiter-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: restaurant.slug, table: 'Mesa 4', type: 'mozo' })
    });
    assert.strictEqual(wa.status, 200, 'waiter-alert responde 200 (no rompe el flujo del comensal)');
    const waBody = await wa.json();
    assert.strictEqual(waBody.data.checked, 1, 'La suscripción del dueño se chequear');
    assert.strictEqual(waBody.data.delivered, 0, 'Endpoint .invalid no puede entregar');
    assert.ok(waBody.data.failed >= 1, 'La entrega fallida se registra honestamente');
    assert.ok(waBody.data.payload && waBody.data.payload.title.includes('mozo'), 'Payload con título del aviso');
    console.log(`✓ Aviso de mozo (Mesa 4): ${waBody.data.checked} suscripción chequeada, ${waBody.data.delivered} entregadas, ${waBody.data.failed} fallidas (intento REAL via web-push)`);

    // Slug inexistente → 404
    const wa404 = await fetch(`${base}/api/notifications/waiter-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'no-existe', table: 'Mesa 1', type: 'mozo' })
    });
    assert.strictEqual(wa404.status, 404, 'Restaurante inexistente → 404');

    // /send sin sesión → 401 (sigue protegido por auth)
    const sendAnon = await fetch(`${base}/api/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hola', body: 'Mundo' })
    });
    assert.strictEqual(sendAnon.status, 401, '/send anónimo rechazado (401)');
    console.log('✓ 401 anónimo en /send + 404 en waiter-alert con slug inexistente');

    // 3) Servicio de mesa configurable por el dueño (flags + gates 403)
    const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');
    // Sanitizer: defaults encendidos (no cambia la experiencia actual).
    const cleanDefault = sanitizeRestaurantPayload({ name: 'X' });
    assert.strictEqual(cleanDefault.allowWaiterCall, true, 'allowWaiterCall default true');
    assert.strictEqual(cleanDefault.allowBillRequest, true, 'allowBillRequest default true');
    const cleanOff = sanitizeRestaurantPayload({ name: 'X', allowWaiterCall: false, allowBillRequest: false });
    assert.strictEqual(cleanOff.allowWaiterCall, false, 'false explícito se preserva');
    assert.strictEqual(cleanOff.allowBillRequest, false, 'false explícito se preserva');
    console.log('✓ Sanitizer: servicio de mesa default ON, false explícito preservado');

    // Menú público expone los flags (como allowOnlinePayment).
    const menuRes = await fetch(`${base}/api/menu/${restaurant.slug}`);
    assert.strictEqual(menuRes.status, 200, 'menú público responde 200');
    const menuBody = await menuRes.json();
    assert.strictEqual(menuBody.restaurant.allowWaiterCall, true, '/api/menu expone allowWaiterCall=true');
    assert.strictEqual(menuBody.restaurant.allowBillRequest, true, '/api/menu expone allowBillRequest=true');
    console.log('✓ /api/menu/:slug expone allowWaiterCall/allowBillRequest (default true)');

    // Gate server-side: cuenta apagada → 403 BILL_REQUEST_DISABLED, mozo sigue OK.
    await db.saveRestaurant(user.id, { allowBillRequest: false });
    const billOff = await fetch(`${base}/api/notifications/waiter-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: restaurant.slug, table: 'Mesa 1', type: 'cuenta_efectivo' })
    });
    assert.strictEqual(billOff.status, 403, 'cuenta con flag OFF → 403');
    assert.strictEqual((await billOff.json()).code, 'BILL_REQUEST_DISABLED');
    const mozoOn = await fetch(`${base}/api/notifications/waiter-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: restaurant.slug, table: 'Mesa 1', type: 'mozo' })
    });
    assert.strictEqual(mozoOn.status, 200, 'mozo con flag ON → 200');
    console.log('✓ Gate: BILL_REQUEST_DISABLED (403) con mozo intacto');

    // Gate server-side: mozo apagado → 403 WAITER_CALL_DISABLED.
    await db.saveRestaurant(user.id, { allowBillRequest: true, allowWaiterCall: false });
    const mozoOff = await fetch(`${base}/api/notifications/waiter-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: restaurant.slug, table: 'Mesa 2', type: 'mozo' })
    });
    assert.strictEqual(mozoOff.status, 403, 'mozo con flag OFF → 403');
    assert.strictEqual((await mozoOff.json()).code, 'WAITER_CALL_DISABLED');
    console.log('✓ Gate: WAITER_CALL_DISABLED (403)');

    // Frontend: ids + regla "la cuenta solo en el local" + wiring del Studio.
    const fs = require('fs');
    const path = require('path');
    const menuHtml = fs.readFileSync(path.join(__dirname, '../public/menu.html'), 'utf8');
    for (const id of ['waiterFab', 'btnCallWaiter', 'btnBillCash', 'btnBillCard']) {
      assert.ok(menuHtml.includes(`id="${id}"`), `menu.html expone #${id}`);
    }
    const menuJs = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
    assert.ok(menuJs.includes('updateTableServiceUI'), 'menu.js gobierna la UI de mesa');
    assert.ok(menuJs.includes("return mode === 'LOCAL'"), 'la cuenta solo se muestra en modalidad LOCAL');
    const studioHtml = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
    assert.ok(studioHtml.includes('id="inputAllowWaiterCall"'), 'Studio expone toggle de mozo');
    assert.ok(studioHtml.includes('id="inputAllowBillRequest"'), 'Studio expone toggle de cuenta');
    assert.ok(!/on(click|change|input|submit)=/i.test(studioHtml.match(/inputAllowWaiterCall[\s\S]{0,400}/)[0]), 'toggles sin on*= (CSP)');
    const studioJs = fs.readFileSync(path.join(__dirname, '../public/js/studio.js'), 'utf8');
    assert.ok(studioJs.includes('inputAllowWaiterCall') && studioJs.includes('inputAllowBillRequest'), 'Studio guarda/carga ambos flags');
    console.log('✓ Frontend: FAB + botones con id, cuenta solo en LOCAL, toggles del Studio sin on*=');
  } finally {
    // Restauramos el entorno original
    if (origPublic) process.env.VAPID_PUBLIC_KEY = origPublic;
    else delete process.env.VAPID_PUBLIC_KEY;
    if (origPrivate) process.env.VAPID_PRIVATE_KEY = origPrivate;
    else delete process.env.VAPID_PRIVATE_KEY;
    server.close();
  }
}

runTests()
  .then(() => {
    console.log('🎉 ¡TODAS LAS VERIFICACIONES DE PUSH NOTIFICATIONS PASARON EXITOSAMENTE AL 100%!');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });