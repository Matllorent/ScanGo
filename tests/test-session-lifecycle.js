/**
 * tests/test-session-lifecycle.js
 * ───────────────────────────────
 * Ciclo de vida de la sesión del dueño: login/logout con revocación,
 * migración transparente a bcrypt, muerte por reset (pwdTs), reset atómico
 * ante doble POST, Origin check, device tokens opacos y baja voluntaria.
 *
 * Separado de test-security-endpoints.js: el rate-limit de /api/auth es
 * 20/15min por IP y un solo archivo con todo lo superaba (429 espurios).
 * Cada suite corre en su proceso con limiter propio.
 *
 * Cero mocks: server HTTP real + store real. data/* la aísla el guard.
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');

async function runTests() {
  assert.ok(db.ready && typeof db.ready.then === 'function', 'Database initialization must expose a readiness promise');
  const readiness = await db.ready;
  assert.strictEqual(readiness.ready, true, 'The database must be hydrated before tests create or read records');

  const user = await db.createUser({
    email: `session-owner-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'Session Test Bistro',
    bizName: 'Session Test Bistro',
    slug: `session-test-${Date.now()}`
  });
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026',
    { expiresIn: '5m' }
  );

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));

  try {
    const { port } = server.address();
    // P1-1 Logout revoca server-side: la cookie vieja muere aunque se conserve.
    const loginRes = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'test_password' })
    });
    assert.strictEqual(loginRes.status, 200, 'Login con fixture de texto plano');
    // Cookie-only: el JWT ya no viaja en el body.
    const loginJson = await loginRes.json();
    assert.ok(!('token' in loginJson), 'Sin JWT en el body del login');
    const setCookieHeader = loginRes.headers.get('set-cookie') || '';
    assert.ok(setCookieHeader.includes('auth_token='), 'El login setea la cookie auth_token');
    const sessionCookie = setCookieHeader.split(';')[0];
    // Migración transparente a bcrypt en el login (la clave NO cambia).
    assert.ok(db.findUserByEmail(user.email).password.startsWith('$2'), 'Password legacy migrado a bcrypt');
    const meBefore = await fetch(`http://localhost:${port}/api/auth/me`, {
      headers: { Cookie: sessionCookie }
    });
    assert.strictEqual(meBefore.status, 200, 'Sesión válida antes del logout');
    const logoutRes = await fetch(`http://localhost:${port}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: sessionCookie }
    });
    assert.strictEqual(logoutRes.status, 200, 'Logout responde 200');
    const meAfter = await fetch(`http://localhost:${port}/api/auth/me`, {
      headers: { Cookie: sessionCookie }
    });
    assert.strictEqual(meAfter.status, 401, 'Sesión revocada tras logout');
    assert.strictEqual((await meAfter.json()).code, 'SESSION_REVOKED');
    console.log('✓ Logout revoca el jti server-side (cookie vieja → 401 SESSION_REVOKED)');

    // P1-2 Reset mata todas las sesiones (pwdTs) + claim atómico ante doble POST.
    const { hashPassword } = require('../api/utils/hash');
    const login2Res = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'test_password' })
    });
    const cookie2 = (login2Res.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie2.startsWith('auth_token='), 'Login re-emite cookie');
    await db.updateUserPassword(user.id, await hashPassword('nueva_clave_segura'));
    const meStale = await fetch(`http://localhost:${port}/api/auth/me`, {
      headers: { Cookie: cookie2 }
    });
    assert.strictEqual(meStale.status, 401, 'Sesión anterior al reset muere por pwdTs');
    const login3Res = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'nueva_clave_segura' })
    });
    const cookie3 = (login3Res.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie3.startsWith('auth_token='), 'Login post-reset emite cookie vigente');
    // P1-4 Origin extranjero con cookie de sesión → 403 (sin Origin sigue pasando).
    const evilOrigin = await fetch(`http://localhost:${port}/api/studio/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie3, Origin: 'https://evil.example' },
      body: JSON.stringify({ name: 'X' })
    });
    assert.strictEqual(evilOrigin.status, 403, 'Origin extranjero con cookie → 403');
    assert.strictEqual((await evilOrigin.json()).code, 'FORBIDDEN_ORIGIN');
    console.log('✓ Origin check anti-CSRF en mutaciones con cookie');

    // P1-6 Device tokens: emisión, uso, listado, revocación y muerte por reset.
    const devIssue = await fetch(`http://localhost:${port}/api/auth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'nueva_clave_segura', deviceName: 'pixel-test' })
    });
    assert.strictEqual(devIssue.status, 201, 'Emisión de credencial de dispositivo');
    const devBody = await devIssue.json();
    assert.ok(devBody.data.deviceToken.startsWith('scango_dev_'), 'Crudo con prefijo una sola vez');
    const devBearer = { Authorization: `Bearer ${devBody.data.deviceToken}` };
    const devMe = await fetch(`http://localhost:${port}/api/auth/me`, { headers: devBearer });
    assert.strictEqual(devMe.status, 200, 'Device token autentica (dual con JWT)');
    const devList = await fetch(`http://localhost:${port}/api/auth/devices`, {
      headers: devBearer
    });
    assert.strictEqual(devList.status, 200, 'Listado de dispositivos con sesión');
    const devices = (await devList.json()).data.devices;
    assert.ok(devices.some((d) => d.deviceName === 'pixel-test' && !('hash' in d)), 'Listado sin hashes');
    const devId = devices.find((d) => d.deviceName === 'pixel-test').id;
    const devRevoke = await fetch(`http://localhost:${port}/api/auth/devices/${devId}`, {
      method: 'DELETE',
      headers: devBearer
    });
    assert.strictEqual(devRevoke.status, 200, 'Revocación de dispositivo');
    const devDead = await fetch(`http://localhost:${port}/api/auth/me`, { headers: devBearer });
    assert.strictEqual(devDead.status, 401, 'Device revocado → 401');
    // El reset mata también los dispositivos vinculados (purga en la ruta).
    const devIssue2 = await fetch(`http://localhost:${port}/api/auth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'nueva_clave_segura', deviceName: 'pixel-test-2' })
    });
    assert.strictEqual(devIssue2.status, 201, 'Segundo dispositivo para probar purga por reset');
    const devBearer2 = { Authorization: `Bearer ${(await devIssue2.json()).data.deviceToken}` };
    const nodeCrypto = require('crypto');
    const killJti = nodeCrypto.randomUUID();
    const killToken = jwt.sign(
      { userId: user.id, email: user.email, purpose: 'reset-password' },
      process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026',
      { expiresIn: 900, jwtid: killJti }
    );
    await db.savePasswordResetToken(user.id, killJti, Date.now() + 900000);
    const killReset = await fetch(`http://localhost:${port}/api/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: killToken, password: 'clave_final_999' })
    });
    assert.strictEqual(killReset.status, 200, 'Reset para matar devices');
    const devAfterReset = await fetch(`http://localhost:${port}/api/auth/me`, { headers: devBearer2 });
    assert.strictEqual(devAfterReset.status, 401, 'Reset revoca dispositivos vinculados');
    const devBad = await fetch(`http://localhost:${port}/api/auth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'clave_mala', deviceName: 'x' })
    });
    assert.strictEqual(devBad.status, 401, 'Device con clave mala → 401');
    console.log('✓ Device tokens: emisión única, uso dual, listado sin hashes, revocación');

    // P1-7 Baja voluntaria: 401 anónimo, 200 idempotente, menú pausado (402).
    // (Sesión fresca: los resets previos revocaron los JWT manuales.)
    const loginCancelRes = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'clave_final_999' })
    });
    assert.strictEqual(loginCancelRes.status, 200, 'Login para la baja');
    const cookieCancel = (loginCancelRes.headers.get('set-cookie') || '').split(';')[0];
    const cancelAnon = await fetch(`http://localhost:${port}/api/billing/cancel`, { method: 'POST' });
    assert.strictEqual(cancelAnon.status, 401, 'Baja anónima → 401');
    const cancel1 = await fetch(`http://localhost:${port}/api/billing/cancel`, {
      method: 'POST',
      headers: { Cookie: cookieCancel }
    });
    assert.strictEqual(cancel1.status, 200, 'Baja del dueño → 200');
    assert.strictEqual(db.findRestaurantById(restaurant.id).subscription.status, 'canceled', 'Estado canceled persistido');
    const cancel2 = await fetch(`http://localhost:${port}/api/billing/cancel`, {
      method: 'POST',
      headers: { Cookie: cookieCancel }
    });
    assert.strictEqual(cancel2.status, 200, 'Doble baja idempotente → 200');
    const savePaused = await fetch(`http://localhost:${port}/api/studio/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieCancel },
      body: JSON.stringify({ name: 'Security Test Bistro' })
    });
    assert.strictEqual(savePaused.status, 402, 'Con plan dado de baja, guardar exige reactivar');
    console.log('✓ Baja voluntaria: 401 anónimo, idempotente, menú pausado con 402');
    // Doble canje concurrente del mismo enlace: exactamente un 200 + un 400.
    const crypto = require('crypto');
    const raceJti = crypto.randomUUID();
    const raceToken = jwt.sign(
      { userId: user.id, email: user.email, purpose: 'reset-password' },
      process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026',
      { expiresIn: 900, jwtid: raceJti }
    );
    await db.savePasswordResetToken(user.id, raceJti, Date.now() + 900000);
    const racePayload = { token: raceToken, password: 'otra_clave_123' };
    const [raceA, raceB] = await Promise.all([
      fetch(`http://localhost:${port}/api/auth/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(racePayload)
      }),
      fetch(`http://localhost:${port}/api/auth/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(racePayload)
      })
    ]);
    const raceStatuses = [raceA.status, raceB.status].sort();
    assert.deepStrictEqual(raceStatuses, [200, 400], 'Doble POST concurrente: un éxito + un rechazo');
    console.log('✓ Reset atómico (mutex por jti) y sesiones previas invalidadas por pwdTs');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

runTests()
  .then(() => console.log('✅ test-session-lifecycle.js OK'))
  .catch((error) => {
    console.error('❌ Error en pruebas de ciclo de sesión:', error);
    process.exitCode = 1;
  });
