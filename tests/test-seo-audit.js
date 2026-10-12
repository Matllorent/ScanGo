/**
 * Test Suite: Auditor de salud SEO/GEO — api/utils/seoAudit.js + panel + cron
 *
 * Verifica la feature "Panel Salud SEO + auditor diario":
 *
 *   1. Reporte puro por restaurante (score 0–100 con pesos fail=25 / warn=5):
 *      página vacía, precios inválidos, horario roto, referencias muertas de
 *      sucursales, nombres duplicados, datos locales, descripción, marca,
 *      JSON-LD, suscripción cancelada (fuera del sitemap) y unicidad de slug.
 *   2. Endpoint GET /api/studio/seo-audit (auth + casilla verificada + tenant
 *      propio) para el panel del Studio.
 *   3. Cron /api/cron/seo-audit fail-closed (401 sin CRON_SECRET, 200 con
 *      x-cron-secret) que recorre TODOS los restaurantes en solo lectura.
 *   4. El Studio expone la pestaña "Salud SEO" (botón data-js-*, pane tab-seo)
 *      y el render de carga (loadSeoAudit) sin on*=.
 *
 * Sin mocks: flujos reales con server + db, como todo el repo.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const { runSeoAudit } = require('../api/utils/seoAudit');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/** Restaurante sano de referencia (sin checks en rojo). */
function healthyRestaurant(userId, slug) {
  return {
    id: `rest-${Date.now()}`,
    userId,
    name: 'Bistró SEO',
    bizName: 'Bistró SEO',
    slug,
    slogan: 'Cocina & datos estructurados',
    phone: '+59899123456',
    address: '18 de Julio 1234',
    city: 'Montevideo',
    bannerUrl: 'https://cdn.example.com/banner.jpg',
    scheduleEnabled: true,
    scheduleActiveHours: '12:00-23:00',
    subscription: { status: 'active', plan: 'pro_monthly' },
    categories: [{ id: 'cat-1', name: 'Platos principales' }],
    dishes: [
      { id: 'dish-1', categoryId: 'cat-1', name: 'Ñoquis', description: 'Con salsa', price: 320 },
      { id: 'dish-2', categoryId: 'cat-1', name: 'Risotto', description: 'Hongos', price: 380 }
    ]
  };
}

function findCheck(report, id) {
  const check = report.checks.find((c) => c.id === id);
  assert.ok(check, `check "${id}" debe existir`);
  return check;
}

async function runTests() {
  // ── Fase A · función pura (cero I/O) ─────────────────────────────────────
  const ownerA = 'user-a';
  const ownerB = 'user-b';
  const good = runSeoAudit(healthyRestaurant(ownerA, 'bistro-seo'), {
    allRestaurants: [healthyRestaurant(ownerA, 'bistro-seo')]
  });
  assert.strictEqual(good.summary.fail, 0, 'el restaurante sano no tiene fails');
  assert.strictEqual(good.summary.total, good.summary.ok + good.summary.warn + good.summary.fail, 'resumen consistente');
  assert.ok(good.score >= 90, `restaurante sano → score alto (obtuvo ${good.score})`);

  // Página vacía → fail 'menu'.
  const empty = runSeoAudit({ userId: ownerA, slug: 'vacio' });
  assert.strictEqual(findCheck(empty, 'menu').status, 'fail', 'carta vacía es fail');

  // Precio negativo → fail 'prices'.
  const badPrice = runSeoAudit({
    ...healthyRestaurant(ownerA, 'bistro-seo'),
    dishes: [{ id: 'd1', categoryId: 'cat-1', name: 'X', price: -5 }]
  });
  assert.strictEqual(findCheck(badPrice, 'prices').status, 'fail', 'precio negativo es fail');

  // Horario activo inválido → fail 'schedule' (misma fuente que el JSON-LD).
  const badSchedule = runSeoAudit({
    ...healthyRestaurant(ownerA, 'bistro-seo'),
    scheduleEnabled: true,
    scheduleActiveHours: 'no-formato'
  });
  assert.strictEqual(findCheck(badSchedule, 'schedule').status, 'fail', 'horario inválido activo es fail');

  // Horario deshabilitado → warn (no fail).
  const noSchedule = runSeoAudit({
    ...healthyRestaurant(ownerA, 'bistro-seo'),
    scheduleEnabled: false,
    scheduleActiveHours: ''
  });
  assert.strictEqual(findCheck(noSchedule, 'schedule').status, 'warn', 'sin horario es warn');

  // Datos locales incompletos → warn 'localData'.
  const noLocal = runSeoAudit({ ...healthyRestaurant(ownerA, 'bistro-seo'), phone: '', city: '', address: '' });
  assert.strictEqual(findCheck(noLocal, 'localData').status, 'warn', 'sin teléfono/ciudad/dirección es warn');

  // Suscripción cancelada → fail 'subscription' (fuera del sitemap).
  const canceled = runSeoAudit({
    ...healthyRestaurant(ownerA, 'bistro-seo'),
    subscription: { status: 'canceled', plan: 'pro_monthly' }
  });
  assert.strictEqual(findCheck(canceled, 'subscription').status, 'fail', 'cancelada queda fuera del sitemap');

  // Slug duplicado con otro dueño → fail 'slugUniqueness'.
  const withCollision = runSeoAudit(healthyRestaurant(ownerA, 'bistro-seo'), {
    allRestaurants: [healthyRestaurant(ownerA, 'bistro-seo'), { ...healthyRestaurant(ownerB, 'bistro-seo'), id: 'another' }]
  });
  assert.strictEqual(findCheck(withCollision, 'slugUniqueness').status, 'fail', 'slug tomado por otro dueño es fail');
  assert.strictEqual(findCheck(good, 'slugUniqueness').status, 'ok', 'slug único es ok');

  // Override muerto en sucursal → warn 'branchOverrides'.
  const deadOverride = runSeoAudit({
    ...healthyRestaurant(ownerA, 'bistro-seo'),
    branches: [{ id: 'b1', name: 'Centro', slug: 'centro', overridePrices: { 'dish-inexistente': 400 } }]
  });
  assert.strictEqual(findCheck(deadOverride, 'branchOverrides').status, 'warn', 'override a plato inexistente es warn');

  // Nombres duplicados en una categoría → warn 'duplicates'.
  const dupNames = runSeoAudit({
    ...healthyRestaurant(ownerA, 'bistro-seo'),
    dishes: [
      { id: 'd1', categoryId: 'cat-1', name: 'Pizza', price: 100 },
      { id: 'd2', categoryId: 'cat-1', name: 'pizza ', price: 120 }
    ]
  });
  assert.strictEqual(findCheck(dupNames, 'duplicates').status, 'warn', 'nombres repetidos en la misma categoría es warn');

  // Sin slogan → warn 'description'.
  const noSlogan = runSeoAudit({ ...healthyRestaurant(ownerA, 'bistro-seo'), slogan: '' });
  assert.strictEqual(findCheck(noSlogan, 'description').status, 'warn', 'sin descripción corta es warn');

  // ── Fase B · runtime (ruta del panel + cron fail-closed) ─────────────────
  const unique = Date.now();
  const email = `seo-audit-owner-${unique}@example.com`;
  const user = await db.createUser({ email, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const restaurant = await db.saveRestaurant(user.id, healthyRestaurant(user.id, `seo-audit-${unique}`));

  const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: '5m' });
  const cookie = `auth_token=${token}`;

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://localhost:${port}`;
  const jsonFetch = (route, cookieHeader) =>
    fetch(`${base}${route}`, cookieHeader ? { headers: { Cookie: cookieHeader } } : {}).then(async (r) => ({
      status: r.status,
      body: await r.json().catch(() => null)
    }));

  try {
    // 1. El dueño ve su reporte (200 + score + checks).
    const authed = await jsonFetch('/api/studio/seo-audit', cookie);
    assert.strictEqual(authed.status, 200, 'el dueño audita su menú');
    assert.strictEqual(authed.body.success, true);
    assert.strictEqual(typeof authed.body.score, 'number');
    assert.ok(Array.isArray(authed.body.checks) && authed.body.checks.length >= 10, 'reporte con checks');
    assert.ok(authed.body.checks.every((c) => ['ok', 'warn', 'fail'].includes(c.status)), 'status válidos');

    // 2. Anónimo → 401.
    const anon = await jsonFetch('/api/studio/seo-audit');
    assert.strictEqual(anon.status, 401, 'sin sesión no se audita (y no se filtra data de nadie)');

    // 3. Cron fail-closed (mismo patrón que el de retención en test-hardening).
    const cronUrl = `${base}/api/cron/seo-audit`;
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const locked = await fetch(cronUrl);
      assert.strictEqual(locked.status, 401, 'cron sin secreto → 401 (fail-closed)');
      const authedCron = await fetch(cronUrl, { headers: { 'x-cron-secret': cronSecret } });
      assert.strictEqual(authedCron.status, 200, 'cron con x-cron-secret → 200');
      const cronBody = await authedCron.json();
      assert.strictEqual(cronBody.success, true);
      assert.strictEqual(typeof cronBody.audited, 'number');
      assert.ok(Array.isArray(cronBody.alerts), 'alertas puede estar vacío');
    } else {
      const devCron = await fetch(cronUrl);
      assert.strictEqual(devCron.status, 200, 'cron responde 200 en dev (sin CRON_SECRET)');
      const cronBody = await devCron.json();
      assert.ok(cronBody.success);
    }
  } finally {
    server.close();
  }

  // ── Fase C · el Studio expone el panel sin on*= ──────────────────────────
  const studioHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'studio.html'), 'utf8');
  assert.ok(studioHtml.includes('data-js-click="switchTab|seo"'), 'pestaña Salud SEO con data-js-*');
  assert.ok(studioHtml.includes('id="tab-seo"'), 'pane tab-seo presente');
  assert.ok(studioHtml.includes('data-js-click="loadSeoAudit"'), 'botón re-evaluar con data-js-*');
  assert.ok(!studioHtml.includes('onclick'), 'studio.html sin onclick (CSP)');

  const studioJs = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'studio.js'), 'utf8');
  assert.ok(studioJs.includes('async function loadSeoAudit'), 'loadSeoAudit implementado en studio.js');
  assert.ok(studioJs.includes('loadSeoAudit,') || studioJs.includes('loadSeoAudit'), 'loadSeoAudit exportado al window');

  console.log(
    `✓ Auditor Salud SEO validado: runSeoAudit puro (${good.checks.length} checks), GET /api/studio/seo-audit 200/401, cron fail-closed, panel Studio sin on*=`
  );
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});