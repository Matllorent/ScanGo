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