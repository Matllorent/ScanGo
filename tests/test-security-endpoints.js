const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const { publicEventKeyGenerator } = require('../api/middleware/rateLimits');

async function runTests() {
  assert.ok(db.ready && typeof db.ready.then === 'function', 'Database initialization must expose a readiness promise');
  const readiness = await db.ready;
  assert.strictEqual(readiness.ready, true, 'The database must be hydrated before tests create or read records');

  const user = await db.createUser({
    email: `security-owner-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'Security Test Bistro',
    bizName: 'Security Test Bistro',
    slug: `security-test-${Date.now()}`
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
    const cases = [
      { method: 'GET', path: '/api/analytics/weekly/restaurant-private-id', status: 401 },
      { method: 'GET', path: '/api/analytics/daily/restaurant-private-id', status: 401 },
      { method: 'GET', path: '/api/analytics/restaurant-private-slug', status: 401 },
      { method: 'POST', path: '/api/analytics/track', body: {}, status: 401 },
      { method: 'GET', path: '/api/reviews/admin', status: 403 },
      { method: 'POST', path: '/api/email/promotions', body: {}, status: 403 },
      { method: 'POST', path: '/api/notifications/send', body: {}, status: 401 },
      { method: 'POST', path: '/api/storage/upload', body: {}, status: 401 },
      { method: 'GET', path: '/api/admin/overview', status: 403 }
    ];

    for (const testCase of cases) {
      const response = await fetch(`http://localhost:${port}${testCase.path}`, {
        method: testCase.method,
        headers: testCase.body ? { 'Content-Type': 'application/json' } : {},
        body: testCase.body ? JSON.stringify(testCase.body) : undefined
      });
      assert.strictEqual(response.status, testCase.status, `${testCase.method} ${testCase.path} must reject anonymous access`);
    }

    const ownMetrics = await fetch(`http://localhost:${port}/api/analytics/weekly/${restaurant.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(ownMetrics.status, 200, 'An authenticated owner can read their own analytics');

    const otherMetrics = await fetch(`http://localhost:${port}/api/analytics/weekly/other-tenant-id`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(otherMetrics.status, 403, 'An owner cannot read another tenant analytics');

    const publicTracking = await fetch(`http://localhost:${port}/api/public/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: restaurant.slug, event: 'visit' })
    });
    assert.strictEqual(publicTracking.status, 200, 'Public menu tracking remains available');

    // Trust proxy: detrás de Vercel el req.ip real llega por X-Forwarded-For;
    // sin esto todos los clientes comparten la IP del proxy y el rate-limit por
    // IP se rompe (un solo balde para todo el tráfico).
    assert.strictEqual(app.get('trust proxy'), 1, 'trust proxy configurado (1 hop, Vercel)');
    assert.strictEqual(
      publicEventKeyGenerator({ body: { slug: 'mi-menu' }, ip: '10.0.0.1' }),
      'slug:mi-menu',
      'El canal público se agrupa por slug de menú (un balde por restaurante)'
    );
    assert.strictEqual(
      publicEventKeyGenerator({ body: {}, ip: '9.9.9.9' }),
      'ip:9.9.9.9',
      'Sin slug cae al ip real del cliente (ya resuelto por trust proxy)'
    );
    console.log('✓ Trust proxy y rate-limit público por menú (nunca un balde global compartido)');

    const disallowedBucket = await fetch(`http://localhost:${port}/api/storage/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fileData: 'c21hbGw=', mimeType: 'image/png', bucket: 'private-config' })
    });
    assert.strictEqual(disallowedBucket.status, 400, 'Authenticated users cannot choose arbitrary storage buckets');

    const tokenListResponse = await fetch(`http://localhost:${port}/api/studio/group-cart-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ tableCount: 2 })
    });
    assert.strictEqual(tokenListResponse.status, 200, 'Owners can issue capabilities for their own table QR codes');
    const tokenList = await tokenListResponse.json();
    const tableToken = tokenList.data.tokens[0].token;

    const anonymousGroupCart = await fetch(`http://localhost:${port}/api/orders/group/${restaurant.id}/1`);
    assert.strictEqual(anonymousGroupCart.status, 403, 'A table cart cannot be read without its QR capability');

    const authorizedGroupCart = await fetch(`http://localhost:${port}/api/orders/group/${restaurant.id}/1`, {
      headers: { 'X-Group-Cart-Token': tableToken }
    });
    assert.strictEqual(authorizedGroupCart.status, 200, 'A QR capability grants access to its table cart');

    // P0-1 Mass assignment: el dueño NO fija campos privilegiados por /save.
    const evilSave = await fetch(`http://localhost:${port}/api/studio/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Security Test Bistro',
        subscription: { status: 'active', plan: 'pro_monthly', provider: 'stripe' },
        userId: 'hacker-id',
        analytics: { visits: 999999 },
        trialEndsAt: '2099-01-01T00:00:00.000Z'
      })
    });
    assert.strictEqual(evilSave.status, 200, 'Save legítimo sigue funcionando');
    const persisted = db.findRestaurantById(restaurant.id);
    assert.strictEqual(persisted.subscription.status, 'trialing', 'El dueño no puede auto-activarse la suscripción');
    assert.strictEqual(persisted.userId, user.id, 'El dueño no puede reasignar userId');
    assert.ok(!persisted.analytics || persisted.analytics.visits !== 999999, 'El dueño no puede forjar analytics');

    // P0-2 IA cerrada: /api/ai/parse-menu exige sesión (cuota Gemini).
    const aiAnon = await fetch(`http://localhost:${port}/api/ai/parse-menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: ['aGVsbG8td29ybGQ='] })
    });
    assert.strictEqual(aiAnon.status, 401, 'AI parse-menu rechaza anónimos');
    const aiAuthed = await fetch(`http://localhost:${port}/api/ai/parse-menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ images: [] })
    });
    assert.strictEqual(aiAuthed.status, 400, 'Con sesión pasa el auth y valida el body');

    // P0-3 TOTP fail-closed: sin secreto no hay bypass.
    // (El roundtrip válido + anti-replay se verifican en P1-3 con código fresco.)
    const { verifyTotpToken } = require('../api/utils/totp');
    assert.strictEqual(verifyTotpToken('123456', ''), false, 'TOTP sin secreto deniega (antes permitía)');
    assert.strictEqual(verifyTotpToken('', 'JBSWY3DPEHPK3PXP'), false, 'TOTP sin código deniega');

    // P0-4 Cuentas huérfanas (JWT sin restaurante): 403 ante tenant ajeno.
    const orphanUser = await db.createUser({
      email: `security-orphan-${Date.now()}@example.com`,
      password: 'test_password',
      email_confirmed_at: new Date().toISOString()
    });
    const orphanToken = jwt.sign(
      { userId: orphanUser.id, email: orphanUser.email },
      process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026',
      { expiresIn: '5m' }
    );
    const orphanOrders = await fetch(`http://localhost:${port}/api/orders/restaurant/${restaurant.id}`, {
      headers: { Authorization: `Bearer ${orphanToken}` }
    });
    assert.strictEqual(orphanOrders.status, 403, 'Huérfano no lista pedidos ajenos');
    const orphanTrack = await fetch(`http://localhost:${port}/api/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orphanToken}` },
      body: JSON.stringify({ restaurantId: restaurant.id, eventType: 'visit' })
    });
    assert.strictEqual(orphanTrack.status, 403, 'Huérfano no envenena telemetría ajena');
    const ownerOrders = await fetch(`http://localhost:${port}/api/orders/restaurant/${restaurant.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(ownerOrders.status, 200, 'El dueño sigue listando sus pedidos');
    const ownerTrack = await fetch(`http://localhost:${port}/api/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ restaurantId: restaurant.id, eventType: 'visit' })
    });
    assert.strictEqual(ownerTrack.status, 202, 'El dueño sigue registrando su telemetría');

    console.log('✓ Mass assignment bloqueado en /save (subscription/userId/analytics intactos)');
    console.log('✓ IA cerrada con auth + TOTP fail-closed sin secreto');
    console.log('✓ Cuentas huérfanas reciben 403 ante tenants ajenos (dueños intactos)');

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
    const meFresh = await fetch(`http://localhost:${port}/api/auth/me`, {
      headers: { Cookie: cookie3 }
    });
    assert.strictEqual(meFresh.status, 200, 'Login post-reset emite sesión vigente');
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
    const login4Res = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'nueva_clave_segura' })
    });
    assert.strictEqual(login4Res.status, 200, 'Re-login para el bloque device');
    if (login4Res.status !== 200) console.log('LOGIN4-BODY:', JSON.stringify(await login4Res.clone().json()));
    const cookie4 = (login4Res.headers.get('set-cookie') || '').split(';')[0];
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
      headers: { Cookie: cookie4 }
    });
    assert.strictEqual(devList.status, 200, 'Listado de dispositivos con sesión');
    const devices = (await devList.json()).data.devices;
    assert.ok(devices.some((d) => d.deviceName === 'pixel-test' && !('hash' in d)), 'Listado sin hashes');
    const devId = devices.find((d) => d.deviceName === 'pixel-test').id;
    const devRevoke = await fetch(`http://localhost:${port}/api/auth/devices/${devId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie4 }
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

    // P1-3 TOTP anti-replay + admin con tope absoluto de 8h.
    const { verifyTotpToken: verifyTotp, generateTotpToken: genTotp } = require('../api/utils/totp');
    const adminSecret = process.env.ADMIN_TOTP_SECRET || 'JBSWY3DPEHPK3PXP';
    const onceCode = genTotp(adminSecret);
    assert.strictEqual(verifyTotp(onceCode, adminSecret), true, 'Primer uso del código pasa');
    assert.strictEqual(verifyTotp(onceCode, adminSecret), false, 'Reuso del código se rechaza');
    const oldAdminToken = jwt.sign(
      { role: 'admin_master', timestamp: Date.now() - 9 * 3600 * 1000, iat0: Date.now() - 9 * 3600 * 1000 },
      process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026',
      { expiresIn: '15m' }
    );
    const oldAdmin = await fetch(`http://localhost:${port}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${oldAdminToken}` }
    });
    assert.strictEqual(oldAdmin.status, 403, 'Sesión admin de +8h muere por tope absoluto');
    console.log('✓ TOTP single-use y tope absoluto de sesión admin');

    // P1-5 MP sin secreto en prod → 503 (fail-closed); googleReview solo https.
    const prevMpSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const prevNodeEnvMp = process.env.NODE_ENV;
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    try {
      const mpClosed = await fetch(`http://localhost:${port}/api/billing/webhook/mercadopago?topic=payment&id=1`, { method: 'POST' });
      assert.strictEqual(mpClosed.status, 503, 'MP sin secreto en prod → 503');
    } finally {
      process.env.NODE_ENV = prevNodeEnvMp;
      if (prevMpSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
      else process.env.MERCADOPAGO_WEBHOOK_SECRET = prevMpSecret;
    }
    const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');
    assert.strictEqual(sanitizeRestaurantPayload({ googleReview: 'javascript:alert(1)' }).googleReview, '', 'googleReview javascript: bloqueado');
    assert.strictEqual(sanitizeRestaurantPayload({ googleReview: 'https://g.page/r/x/review' }).googleReview, 'https://g.page/r/x/review', 'googleReview https legítimo pasa');
    console.log('✓ MP fail-closed en prod + googleReview solo https');

    const readyState = db.ready;
    db.ready = Promise.resolve({ ready: false, mode: 'unavailable' });
    try {
      const unavailableMenu = await fetch(`http://localhost:${port}/m/${restaurant.slug}`);
      assert.strictEqual(unavailableMenu.status, 503, 'Dynamic menu rendering fails closed when database hydration is unavailable');
    } finally {
      db.ready = readyState;
    }

    const previousNodeEnv = process.env.NODE_ENV;
    const previousCronSecret = process.env.CRON_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.CRON_SECRET;
    try {
      const cronResponse = await fetch(`http://localhost:${port}/api/cron/billing-dunning`);
      assert.strictEqual(cronResponse.status, 503, 'Production cron fails closed without CRON_SECRET');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCronSecret;
    }

    console.log('✓ Analytics, moderation, email, push, storage and admin APIs reject anonymous requests');
    console.log('✓ Analytics is tenant-isolated while public menu tracking remains available');
    console.log('✓ Group carts require an owner-issued per-table QR capability');
    console.log('✓ Cold-start DB and production cron fail closed when dependencies/secrets are unavailable');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

runTests().catch(error => {
  console.error('❌ Error en pruebas de autorización de API:', error);
  process.exitCode = 1;
});