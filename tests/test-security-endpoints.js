const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');

async function runTests() {
  assert.ok(db.ready && typeof db.ready.then === 'function', 'Database initialization must expose a readiness promise');
  const readiness = await db.ready;
  assert.strictEqual(readiness.ready, true, 'The database must be hydrated before tests create or read records');

  const user = db.createUser({
    email: `security-owner-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = db.saveRestaurant(user.id, {
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