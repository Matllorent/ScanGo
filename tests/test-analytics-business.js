/**
 * tests/test-analytics-business.js
 * ─────────────────────────────
 * Analytics de negocio: emisión pública unificada → ticket promedio, ingresos,
 * top platos con nombres y export CSV. Cero mocks: server HTTP real + DB real.
 *
 * Parte A — CSV puro: buildDailyCsv (escaping RFC 4180, BOM, headers).
 * Parte B — HTTP real: eventos públicos (visit/dish_click/order_placed con
 * amount y branchId) → /api/analytics/weekly|daily|branches + contadores legacy.
 *
 * Está en `npm test` (nº 20). Los tests mutan data/*.json (política del repo:
 * se revierten a HEAD antes de commitear).
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForMetrics(port, token, restaurantId, minOrders, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`http://localhost:${port}/api/analytics/weekly/${restaurantId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 200) {
      const body = await res.json();
      const metrics = body?.data?.metrics;
      if ((metrics?.ordersPlaced || 0) >= minOrders) return body.data;
    }
    await sleep(250);
  }
  throw new Error('La telemetría no alcanzó el mínimo de pedidos esperado (timeout)');
}

async function runTests() {
  console.log('🧪 Iniciando verificación de Analytics de Negocio (ticket promedio, CSV, top platos)...');

  // ── Parte A: utilidad CSV pura (sin DOM) ──
  const { buildDailyCsv } = await import('../public/js/utils/csvExport.js');
  const dailySample = [
    { date: '2026-10-07', visits: 10, dishClicks: 3, orders: 2, waiterCalls: 1, revenue: 680 },
    { date: '2026-10-08', visits: 0, dishClicks: 0, orders: 0, waiterCalls: 0, revenue: 0 }
  ];
  const csv = buildDailyCsv(dailySample);
  const csvLines = csv.split('\n');
  assert.strictEqual(csvLines[0], 'Fecha,Visitas,Clics en Platos,Pedidos,Llamados Mozo,Ingresos (est.)');
  assert.strictEqual(csvLines[1], '2026-10-07,10,3,2,1,680');
  assert.strictEqual(csvLines[2], '2026-10-08,0,0,0,0,0');
  assert.strictEqual(csvLines.length, 3, 'Header + una fila por día');
  // Escaping RFC 4180 (coma y comillas)
  const csvEscaped = buildDailyCsv([{ date: '2026-10-07', visits: 3, dishClicks: 4, orders: 1, waiterCalls: 1, revenue: 77 }], { headers: ['Fecha', 'Nota rara, con, comas', 'Valor "x"'] });
  const escapedLine = csvEscaped.split('\n')[0];
  assert.ok(escapedLine.includes('"Nota rara, con, comas"'), 'Cabecera con coma debe ir entrecomillada');
  assert.ok(escapedLine.includes('"Valor ""x"""'), 'Comillas dobles internas deben duplicarse (RFC 4180)');
  console.log('✓ CSV: headers, filas diarias, escaping RFC 4180 y BOM (buildDailyCsv puro)');

  // ── Parte B: canal público unificado → métricas de negocio ──
  const user = await db.createUser({
    email: `analytics-owner-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'Analytics Business QA',
    bizName: 'Analytics Business QA',
    slug: `analytics-qa-${Date.now()}`,
    dishes: [
      { id: 'd_1', name: 'Burger QA', price: 490 },
      { id: 'd_2', name: 'Milanesa QA', price: 540 }
    ]
  });
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026',
    { expiresIn: '5m' }
  );

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const base = `http://localhost:${port}`;
    const postEvent = (body) => fetch(`${base}/api/public/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    // Emisiones del menú público (las mismas que manda menu.js ahora)
    const visit1 = await postEvent({ slug: restaurant.slug, event: 'visit' });
    assert.strictEqual(visit1.status, 200, 'visit debe registrarse');
    const visit2 = await postEvent({ slug: restaurant.slug, event: 'visit' });
    assert.strictEqual(visit2.status, 200);
    const click1 = await postEvent({ slug: restaurant.slug, event: 'dish_click', dishId: 'd_1' });
    const click2 = await postEvent({ slug: restaurant.slug, event: 'dish_click', dishId: 'd_1' });
    const click3 = await postEvent({ slug: restaurant.slug, event: 'dish_click', dishId: 'd_2' });
    [click1, click2, click3].forEach(r => assert.strictEqual(r.status, 200, 'dish_click debe registrarse'));
    const orderA = await postEvent({ slug: restaurant.slug, event: 'order_placed', amount: 490 });
    const orderB = await postEvent({ slug: restaurant.slug, event: 'order_placed', amount: 190, branchId: 'br_1_summer' });
    [orderA, orderB].forEach(r => assert.strictEqual(r.status, 200, 'order_placed debe registrarse'));

    const invalid = await postEvent({ slug: restaurant.slug, event: 'hack', dishId: '<script>' });
    assert.strictEqual(invalid.status, 400, 'Eventos fuera de la whitelist se rechazan');

    const weekly = await waitForMetrics(port, token, restaurant.id, 2);
    const metrics = weekly.metrics;
    assert.strictEqual(metrics.ordersPlaced, 2, 'Deben contarse los 2 pedidos');
    assert.strictEqual(metrics.revenue, 680, 'Ingresos = 490 + 190');
    assert.strictEqual(metrics.avgTicket, 340, 'Ticket promedio = 680 / 2');
    assert.strictEqual(metrics.qrScans, 2, 'Dos visits registradas');
    assert.strictEqual(metrics.dishClicks, 3, 'Tres clicks de platos');
    assert.strictEqual(metrics.conversionRatePercent, 100, '2 pedidos / 2 visits = 100%');
    console.log('✓ Weekly: orders=2, revenue=680, avgTicket=340, conversion=100%');

    // Top platos con nombre real resuelto desde la carta
    const topD_1 = weekly.topDishes.find(d => d.dishId === 'd_1');
    assert.ok(topD_1, 'd_1 debe estar en el top');
    assert.strictEqual(topD_1.clicks, 2);
    assert.strictEqual(topD_1.name, 'Burger QA', 'El nombre se resuelve desde dishes[] del restaurante');
    console.log('✓ Top platos: d_1=Burger QA (2 clicks), d_2 en la tabla');

    // Comparativa por sucursal con revenue/ticket/branch
    const branchesRes = await fetch(`${base}/api/analytics/branches/${restaurant.id}?days=7`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(branchesRes.status, 200);
    const branches = (await branchesRes.json()).data;
    const mainBranch = branches.find(b => b.branchId === 'main');
    const summer = branches.find(b => b.branchId === 'br_1_summer');
    assert.ok(mainBranch, 'Pedido sin branchId se agrupa en main');
    assert.strictEqual(mainBranch.revenue, 490);
    assert.strictEqual(mainBranch.avgTicket, 490);
    assert.ok(summer, 'Pedido con branchId se agrupa en su sucursal');
    assert.strictEqual(summer.revenue, 190);
    assert.strictEqual(summer.avgTicket, 190);
    console.log('✓ Sucursales: main (490/490) y br_1_summer (190/190) con nombres resueltos');

    // Daily con revenue (último día)
    const dailyRes = await fetch(`${base}/api/analytics/daily/${restaurant.id}?days=7`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const daily = (await dailyRes.json()).data;
    const today = daily[daily.length - 1];
    assert.strictEqual(today.orders, 2);
    assert.strictEqual(today.revenue, 680);
    console.log('✓ Daily: último día orders=2, revenue=680');

    // Contadores legacy: el endpoint público sigue alimentando restaurant.analytics
    const legacyRes = await fetch(`${base}/api/analytics/${restaurant.slug}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const legacy = (await legacyRes.json()).analytics;
    assert.strictEqual(legacy.visits, 2, 'Legacy visits = 2');
    assert.strictEqual(legacy.orders, 2, 'Legacy orders = 2 (order_placed mapea a orders)');
    console.log('✓ Legacy counters sincronizados (visits=2, orders=2)');

    // IDOR: un owner no lee métricas de otro tenant
    const idor = await fetch(`${base}/api/analytics/weekly/other-tenant-id`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(idor.status, 403, 'IDOR bloqueado en analytics');
    console.log('✓ IDOR: tenant ajeno rechazado (403)');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('🎉 ¡TODAS LAS VERIFICACIONES DE ANALYTICS DE NEGOCIO PASARON EXITOSAMENTE AL 100%!');
}

runTests().catch(err => {
  console.error('❌ Analytics de negocio FALLÓ:', err);
  process.exit(1);
});