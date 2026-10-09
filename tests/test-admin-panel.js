/**
 * tests/test-admin-panel.js
 * ─────────────────────────────
 * Panel /admin maestro en español llano: plata que entra al mes, renovaciones,
 * pruebas que terminan, conversión de la prueba (en criollo) y las listas
 * "Lo que viene esta semana". Cero mocks: login real con 2FA TOTP (RFC 6238),
 * server HTTP real y restaurantes reales en el store local.
 *
 * Está en `npm test` (nº 21). Los tests mutan data/*.json (política del repo:
 * se revierten a HEAD antes de commitear).
 */
const assert = require('assert');
const http = require('http');
const app = require('../api/index');
const db = require('../src/db/db');
const { generateTotpToken } = require('../api/utils/totp');

const ADMIN_KEY = process.env.ADMIN_KEY || 'pizarron_admin_master_key_2026';
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || 'JBSWY3DPEHPK3PXP';

const iso = (ms) => new Date(ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

async function runTests() {
  console.log('🧪 Iniciando verificación del Panel /admin (español llano, cero jerga)...');

  // ── Semilla: 4 restaurantes reales con estados distintos ──
  const now = Date.now();

  // 1) Paga un plan anual con 2 sucursales → 159 + 159*0.8 = 286.2/año → 23.85/mes
  const payingUser = await db.createUser({ email: `admin-paying-${now}@example.com`, password: 'p', email_confirmed_at: iso(now) });
  const payingRest = await db.saveRestaurant(payingUser.id, {
    name: 'Admin Pagando Anual', bizName: 'Admin Pagando Anual', slug: `admin-paying-${now}`,
    branches: [
      { id: 'b_1', name: 'Principal', slug: 'principal' },
      { id: 'b_2', name: 'Sucursal Norte', slug: 'norte' }
    ],
    subscription: {
      status: 'active', plan: 'pro_annual', provider: 'stripe',
      trialEndsAt: iso(now - 20 * DAY), currentPeriodEnd: iso(now + 5 * DAY)
    }
  });

  // 2) En prueba gratis, termina en 3 días → debe aparecer en "pruebas que terminan"
  const trialUser = await db.createUser({ email: `admin-trial-${now}@example.com`, password: 'p', email_confirmed_at: iso(now) });
  const trialRest = await db.saveRestaurant(trialUser.id, {
    name: 'Admin Prueba a Vencer', bizName: 'Admin Prueba a Vencer', slug: `admin-trial-${now}`,
    subscription: {
      status: 'trialing', plan: 'pro_monthly', provider: 'trial',
      trialEndsAt: iso(now + 3 * DAY), currentPeriodEnd: iso(now + 3 * DAY)
    }
  });

  // 3) Terminó la prueba y no pagó → "se fue"
  const leftUser = await db.createUser({ email: `admin-left-${now}@example.com`, password: 'p', email_confirmed_at: iso(now) });
  await db.saveRestaurant(leftUser.id, {
    name: 'Admin Se Fue', bizName: 'Admin Se Fue', slug: `admin-left-${now}`,
    subscription: {
      status: 'expired', plan: 'starter_monthly', provider: 'trial',
      trialEndsAt: iso(now - 10 * DAY), currentPeriodEnd: iso(now - 10 * DAY)
    }
  });

  // 4) Terminó la prueba y se quedó pagando (starter mensual → 9/mes)
  const convertedUser = await db.createUser({ email: `admin-conv-${now}@example.com`, password: 'p', email_confirmed_at: iso(now) });
  const convertedRest = await db.saveRestaurant(convertedUser.id, {
    name: 'Admin Se Quedó', bizName: 'Admin Se Quedó', slug: `admin-conv-${now}`,
    subscription: {
      status: 'active', plan: 'starter_monthly', provider: 'mercadopago',
      trialEndsAt: iso(now - 15 * DAY), currentPeriodEnd: iso(now + 15 * DAY)
    }
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://localhost:${port}`;

  try {
    // ── Login real con 2FA TOTP ──
    const loginRes = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: ADMIN_KEY, totp: generateTotpToken(ADMIN_TOTP_SECRET) })
    });
    assert.strictEqual(loginRes.status, 200, 'Login admin con TOTP real debe responder 200');
    const loginBody = await loginRes.json();
    // Cookie-only: el JWT ya no viaja en el body (anti-XSS). El test reenvía
    // la cookie como lo haría el navegador.
    assert.ok(!('token' in (loginBody?.data || loginBody || {})), 'El login NO expone el token en el body');
    const setCookie = loginRes.headers.get('set-cookie') || '';
    const adminCookie = setCookie.split(';')[0];
    assert.ok(adminCookie.startsWith('admin_token='), 'El login setea la cookie admin_token');
    console.log('✓ Login admin con 2FA TOTP real (RFC 6238), sesión solo-cookie');

    // Sin sesión → 403
    const noAuth = await fetch(`${base}/api/admin/overview`);
    assert.strictEqual(noAuth.status, 403, 'Overview sin sesión admin se rechaza');
    console.log('✓ Overview sin sesión rechazado (403)');

    const authOverview = await fetch(`${base}/api/admin/overview`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(authOverview.status, 200);
    const { metrics } = await authOverview.json();

    // ── Métricas en criollo ──
    assert.ok(Number.isFinite(metrics.monthlyIncomeEstimate) && metrics.monthlyIncomeEstimate >= 23.85,
      `Plata/mes debe incluir ≥ 23.85 del plan anual con 2 sucursales (era ${metrics.monthlyIncomeEstimate})`);
    console.log(`✓ Plata que entra al mes: $${metrics.monthlyIncomeEstimate}`);

    assert.ok(metrics.newThisWeek >= 4, `Clientes nuevos esta semana ≥ 4 (era ${metrics.newThisWeek})`);

    // Renovaciones: el restaurante anual (periodo en 5 días) debe estar listado con 23.85/mes
    const renewals = metrics.renewalsList || [];
    const ourRenewal = renewals.find(r => r.id === payingRest.id);
    assert.ok(ourRenewal, 'El restaurante con pago a renovar en 5 días debe estar en la lista');
    assert.strictEqual(ourRenewal.amountMonthly, 23.85, 'Su equivalente mensual (anual/12 con 2 sucursales) es 23.85');
    assert.strictEqual(ourRenewal.planName, 'Pro Anual');
    assert.ok(metrics.renewalsCount >= 1);
    console.log('✓ Renovaciones en 7 días: lista con plan, fecha y plata/mes');

    // Pruebas que terminan: el trialing (en 3 días) debe estar
    const endings = metrics.trialsEndingList || [];
    assert.ok(endings.some(r => r.id === trialRest.id), 'La prueba que termina en 3 días debe aparecer');
    assert.ok(metrics.trialsEndingCount >= 1);

    // Conversión de la prueba, en criollo
    assert.ok(metrics.trialFinished >= 3, `Ya terminaron su prueba ≥ 3 restaurantes (era ${metrics.trialFinished})`);
    assert.ok(metrics.trialBecamePaying >= 2, `Siguen pagando ≥ 2 de ellos (era ${metrics.trialBecamePaying})`);
    assert.ok(metrics.trialConversionPercent >= 0 && metrics.trialConversionPercent <= 100);
    console.log(`✓ Conversión de la prueba: ${metrics.trialBecamePaying} de ${metrics.trialFinished} siguen pagando (${metrics.trialConversionPercent}%)`);

    // Los que se fueron
    assert.ok(metrics.expiredSubs >= 1, 'Al menos 1 restaurante dejó de pagar');
    console.log('✓ Clientes que dejaron de pagar contados correctamente');

    // El que sigue pagando no es una "renovación próxima" (su periodo vence en 15 días)
    assert.ok(!renewals.some(r => r.id === convertedRest.id), 'El que renueva en 15 días NO debe estar en la lista de 7');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('🎉 ¡TODAS LAS VERIFICACIONES DEL PANEL ADMIN PASARON EXITOSAMENTE AL 100%!');
}

runTests().catch(err => {
  console.error('❌ Panel /admin FALLÓ:', err);
  process.exit(1);
});