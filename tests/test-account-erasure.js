/**
 * tests/test-account-erasure.js
 * ─────────────────────────────
 * Derecho al olvido (RGPD / Ley 18.331 / política de borrado de cuentas de
 * Google Play): `POST /api/account/delete-request` borra el usuario, el
 * restaurante y los datos asociados (reseñas, feedback, pedidos), revoca la
 * sesión y deja una entrada de auditoría ANTES del borrado.
 *
 * Antes de este test el "Eliminar cuenta" del Studio era un no-op: el frontend
 * llamaba a `/api/account/delete-request` y el backend no tenía la ruta (404
 * silencioso → "Tu solicitud ha sido registrada correctamente" sin borrar nada).
 *
 * Cero mocks: server HTTP real + store real (data/* la aísla el guard).
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const auditService = require('../api/services/audit');

const SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

function postJson(port, route, body, cookie) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    };
    if (cookie) headers.Cookie = cookie;
    const req = http.request(
      { hostname: '127.0.0.1', port, path: route, method: 'POST', headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { /* body no JSON */ }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function getJson(port, route, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const req = http.request(
      { hostname: '127.0.0.1', port, path: route, method: 'GET', headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { /* body no JSON */ }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  assert.ok(db.ready && typeof db.ready.then === 'function', 'Database initialization must expose a readiness promise');
  await db.ready;

  const email = `erasable-owner-${Date.now()}@example.com`;
  const user = await db.createUser({
    email,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'Erasable Bistro',
    bizName: 'Erasable Bistro',
    slug: `erasable-${Date.now()}`
  });

  // Datos asociados que deben morir con la cuenta:
  await db.addReview({ restaurant_id: restaurant.id, restaurantId: restaurant.id, rating: 5, comment: 'borrame' });
  await db.addFeedback({ restaurantId: restaurant.id, rating: 2, comment: 'feedback que debe borrarse' });

  const token = jwt.sign({ userId: user.id, email }, SECRET, { expiresIn: '5m' });
  const cookie = `auth_token=${token}`;

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    // 0. El dueño puede guardar su restaurante (y eso queda auditado).
    const saveRes = await postJson(port, '/api/studio/save', {
      data: { name: 'Erasable Bistro Renovado', bizName: 'Erasable Bistro' }
    }, cookie);
    assert.strictEqual(saveRes.status, 200, 'el dueño guarda su menú (studio/save 200)');

    // 1. Sin `confirm: true` → 400 y NO se borra nada.
    const rejected = await postJson(port, '/api/account/delete-request', { reason: 'prueba' }, cookie);
    assert.strictEqual(rejected.status, 400, 'delete sin confirmación debe rechazarse (400)');
    assert.strictEqual(rejected.body.code, 'CONFIRMATION_REQUIRED');
    assert.ok(db.findUserById(user.id), 'el usuario sigue existiendo tras el rechazo');
    assert.ok(db.findRestaurantById(restaurant.id), 'el restaurante sigue existiendo tras el rechazo');

    // 2. Sin sesión → 401 (no 404 fantasma).
    const anon = await postJson(port, '/api/account/delete-request', { confirm: true });
    assert.strictEqual(anon.status, 401, 'delete sin sesión → 401');

    // 3. Confirmado → 200 y TODO se borra (usuario, restaurante, datos asociados).
    const done = await postJson(port, '/api/account/delete-request', { confirm: true, reason: 'cierre' }, cookie);
    assert.strictEqual(done.status, 200, 'delete confirmado → 200');
    assert.strictEqual(done.body.deleted, true);

    assert.strictEqual(db.findUserById(user.id), null, 'usuario eliminado');
    assert.strictEqual(db.findRestaurantById(restaurant.id), null, 'restaurante eliminado');
    assert.strictEqual(
      db.getAllReviews().some((r) => r.restaurant_id === restaurant.id || r.restaurantId === restaurant.id),
      false,
      'reseñas del local eliminadas'
    );
    assert.strictEqual(db.getFeedbackByRestaurantId(restaurant.id).length, 0, 'feedback del local eliminado');

    // 4. La sesión murió con la cuenta: /api/auth/me responde 401.
    const me = await getJson(port, '/api/auth/me', cookie);
    assert.strictEqual(me.status, 401, 'sesión revocada tras el borrado de la cuenta');

    // 5. Auditoría: el borrado dejó ACCOUNT_DELETE y el save dejó RESTAURANT_UPDATE
    //    (el audit es fire-and-forget por retryQueue: esperamos que drene).
    await new Promise((r) => setTimeout(r, 250));
    const logs = auditService.getAuditLogs();
    assert.ok(
      logs.some((a) => a.user_id === user.id && a.action === 'ACCOUNT_DELETE'),
      'debe existir entrada de auditoría ACCOUNT_DELETE del usuario borrado'
    );
    assert.ok(
      logs.some((a) => a.tenant_id === restaurant.id && a.action === 'RESTAURANT_UPDATE'),
      'el save del estudio debe estar auditado como RESTAURANT_UPDATE'
    );

    // 6. Idempotencia: con la cuenta borrada, la cookie ya NO autentica
    //    (el usuario no existe → authMiddleware responde 401). La sesión
    //    murió con la cuenta y un reintento no revive nada.
    const again = await postJson(port, '/api/account/delete-request', { confirm: true }, cookie);
    assert.strictEqual(again.status, 401, 'con la cuenta borrada la sesión muere → 401');

    console.log('✓ Derecho al olvido: rechazo sin confirmar, 401 anónimo, borrado completo, sesión revocada, auditoría y sesión muerta al reintentar');
  } finally {
    server.close();
  }

  console.log('\n🎉 ¡BORRADO DE CUENTA (RGPD) VERIFICADO DE PUNTA A PUNTA CON SERVER REAL!');
}

runTests()
  .then(() => console.log('✅ test-account-erasure.js OK'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });