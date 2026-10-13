/**
 * tests/test-hardening.js
 * ──────────────────────
 * Regresión de la auditoría de ingeniería — brechas A→F. Cero mocks: server
 * HTTP real + store real (JSON local y/o Supabase según el entorno). Las
 * mutaciones de data/* las aísla scripts/test-data-guard.js.
 *
 * Cubre:
 *  - A) fetch() con timeout: un servidor que acepta y nunca responde aborta
 *       con FETCH_TIMEOUT (pasarelas/email/Redis ya usan fetchWithTimeout).
 *  - B) Retención de telemetría: cutoff configurable acotado, purga real del
 *       espejo local con evento backdated, dry-run no borra, cron 200.
 *  - C) Concurrencia optimista en /api/studio/save: versión vieja → 409
 *       MENU_CONCURRENCY_CONFLICT con currentUpdatedAt; el overwrite (reintento
 *       con la versión actual) pasa; sin versión (cliente legacy) nunca choca.
 *  - D) Heatmap en hora del dueño: ?utcOffsetMinutes= desplaza el bucket
 *       (localHourOf puro + HTTP real), totales intactos sin importar el offset.
 *  - E) Abierto/cerrado server-side: forceClosed y horario inválido cierran
 *       (400 RESTAURANT_CLOSED) en quote y POST; sin horario o rango 24h → 201.
 *  - F) Observabilidad: percentiles p50/p95/p99 del LatencyTracker puro +
 *       /api/healthz expone `latency` con grupos poblados.
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const { fetchWithTimeout } = require('../api/utils/fetchWithTimeout');
const { LatencyTracker, groupFor } = require('../api/utils/latencyTracker');
const { getSupabaseClient } = require('../api/utils/supabase');
const telemetryService = require('../api/services/telemetry');

const SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const makeUser = async (tag) =>
  db.createUser({
    email: `${tag}-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });

async function runTests() {
  console.log('🧪 Iniciando verificación de Endurecimiento (timeouts, retención, concurrencia, heatmap, horarios, SLO)...');

  // ── A) fetchWithTimeout: proveedor colgado aborta, proveedor sano pasa ──
  const hangServer = http.createServer(() => { /* acepta y nunca responde */ });
  await new Promise((r) => hangServer.listen(0, r));
  try {
    const hangUrl = `http://127.0.0.1:${hangServer.address().port}/slow`;
    const t0 = Date.now();
    await assert.rejects(
      fetchWithTimeout(hangUrl, {}, 100),
      (err) => err && err.code === 'FETCH_TIMEOUT' && err.name === 'FetchTimeoutError',
      'el helper aborta con FETCH_TIMEOUT'
    );
    assert.ok(Date.now() - t0 < 2000, 'el abort es rápido (no cuelga el request)');
    console.log('✓ A: fetch externo colgado aborta con FETCH_TIMEOUT');
  } finally {
    if (hangServer.closeAllConnections) hangServer.closeAllConnections();
    await new Promise((r) => hangServer.close(r));
  }

  const okServer = http.createServer((req, res) => res.end('ok'));
  await new Promise((r) => okServer.listen(0, r));
  try {
    const okRes = await fetchWithTimeout(`http://127.0.0.1:${okServer.address().port}/`, {}, 500);
    assert.strictEqual(okRes.status, 200);
    assert.strictEqual(await okRes.text(), 'ok');
    console.log('✓ A: fetch externo sano responde normal dentro del timeout');
  } finally {
    if (okServer.closeAllConnections) okServer.closeAllConnections();
    await new Promise((r) => okServer.close(r));
  }

  // ── B) Retención de telemetría (cutoff puro + purga local + cron) ──
  const cutoff183 = telemetryService.retentionCutoffIso(183);
  const age183 = Date.now() - new Date(cutoff183).getTime();
  assert.ok(age183 > 182 * 86400000 && age183 < 184 * 86400000, 'cutoff default ≈ 183 días');
  const ageClampLo = Date.now() - new Date(telemetryService.retentionCutoffIso(2)).getTime();
  assert.ok(Math.abs(ageClampLo - 30 * 86400000) < 60000, 'piso: 2 días pide → 30 días mínimo');
  const ageClampHi = Date.now() - new Date(telemetryService.retentionCutoffIso(9999)).getTime();
  assert.ok(Math.abs(ageClampHi - 730 * 86400000) < 60000, 'techo: 9999 días pide → 730 días máximo');
  console.log('✓ B: cutoff de retención configurable y acotado [30, 730] días');

  // Modela "un evento viejo" SOLO en modo local: en cloud NO se inyecta basura
  // backdated al proyecto real (la política del espejo local es idéntica y ahí
  // se ejerce el camino completo dry-run → purga).
  const cloudActive = !!getSupabaseClient();
  const countBefore = telemetryService.getLocalTelemetryCount();
  if (!cloudActive) {
    const backdated = await telemetryService.buildEventRecord({ restaurantId: 'rest_retention', eventType: 'visit' });
    backdated.created_at = new Date(Date.now() - 400 * 86400000).toISOString();
    await telemetryService.persistEventRecord(backdated);
  }

  const dry = await telemetryService.purgeOldTelemetry({ olderThanDays: 183, dryRun: true });
  assert.strictEqual(dry.prunedLocal, cloudActive ? 0 : 1, 'dry-run reporta lo que podaría');
  assert.strictEqual(telemetryService.getLocalTelemetryCount(), countBefore, 'dry-run no toca el espejo');

  if (!cloudActive) {
    const purge = await telemetryService.purgeOldTelemetry({ olderThanDays: 183 });
    assert.strictEqual(purge.prunedLocal, 1, 'el evento backdated (400 días) se purga');
    assert.strictEqual(telemetryService.getLocalTelemetryCount(), countBefore - 1, 'la purga quitó exactamente el evento viejo');
    console.log('✓ B: purga real del espejo local (dry-run reporta, purge sí borra)');
  } else {
    console.log('✓ B: modo cloud — dry-run reporta 0 y no muta el espejo');
  }

  // ── Usuarios / restaurantes para las secciones HTTP ──
  const userC = await makeUser('hardening-c');
  const restC = await db.saveRestaurant(userC.id, {
    name: 'Hardening Bistro',
    bizName: 'Hardening Bistro',
    slug: `hardening-${Date.now()}`,
    dishes: [{ id: 'd1', name: 'Tarta de la casa', price: 42 }]
  });
  const token = jwt.sign({ userId: userC.id, email: userC.email }, SECRET, { expiresIn: '5m' });
  const authJson = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const userE = await makeUser('hardening-e');
  const restE = await db.saveRestaurant(userE.id, {
    name: 'Horario QA',
    bizName: 'Horario QA',
    slug: `horario-${Date.now()}`,
    dishes: [{ id: 'd0', name: 'Tarta', price: 100 }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://localhost:${port}`;
  const postJson = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });

  try {
    // ── C) Concurrencia optimista en Studio (409) ──────────────────────────
    const r1 = await postJson('/api/studio/save', {
      data: { name: 'Hardening Bistro v1', bizName: 'Hardening Bistro' }
    }, authJson);
    assert.strictEqual(r1.status, 200, 'primer save sin versión → 200');
    const serverUpdatedAt = (await r1.json()).restaurant.updatedAt;
    assert.ok(serverUpdatedAt, 'el server mantiene una versión (updatedAt)');

    const stale = new Date(new Date(serverUpdatedAt).getTime() - 60000).toISOString();
    const r2 = await postJson('/api/studio/save', { data: { name: 'Hardening Bistro v2', updatedAt: stale } }, authJson);
    assert.strictEqual(r2.status, 409, 'versión vieja → 409 (no last-write-wins silencioso)');
    const conflict = await r2.json();
    assert.strictEqual(conflict.code, 'MENU_CONCURRENCY_CONFLICT');
    assert.strictEqual(conflict.currentUpdatedAt, serverUpdatedAt, 'el 409 dice cuál es la versión vigente');

    const r3 = await postJson('/api/studio/save', { data: { name: 'Hardening Bistro v2', updatedAt: conflict.currentUpdatedAt } }, authJson);
    assert.strictEqual(r3.status, 200, 'el dueño acepta sobrescribir (reintento con la versión vigente) → 200');

    const r4 = await postJson('/api/studio/save', { data: { name: 'Hardening Bistro v3' } }, authJson);
    assert.strictEqual(r4.status, 200, 'cliente sin versión (legacy) nunca choca');
    console.log('✓ C: 409 MENU_CONCURRENCY_CONFLICT + overwrite con la versión vigente');

    // ── D) Heatmap en hora local del dueño (offset) ────────────────────────
    // Helpers puros: el desplazamiento es determinista.
    assert.strictEqual(telemetryService.localHourOf('2026-01-01T12:00:00.000Z', 180), 15, 'UTC+3 → 12Z es 15 local');
    assert.strictEqual(telemetryService.localHourOf('2026-01-01T12:00:00.000Z', -300), 7, 'UTC-5 → 12Z es 7 local');
    assert.strictEqual(telemetryService.localHourOf('fecha-invalida', 0), null, 'fecha inválida no rompe el bucket');

    const beforeEvents = new Date().toISOString();
    await telemetryService.recordEventSync({ restaurantId: restC.id, eventType: 'visit' });
    await telemetryService.recordEventSync({ restaurantId: restC.id, eventType: 'dish_click', dishId: 'd1' });
    await telemetryService.recordEventSync({ restaurantId: restC.id, eventType: 'order_placed', dishId: 'd1' });

    const heat = await fetch(`${base}/api/analytics/heatmap/${restC.id}?days=7&utcOffsetMinutes=180`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(heat.status, 200, 'heatmap con offset OK');
    const heatmap = (await heat.json()).data;
    assert.strictEqual(heatmap.length, 24, '24 buckets horarios');
    const total = heatmap.reduce((s, h) => s + h.total, 0);
    assert.strictEqual(total, 3, 'los 3 eventos quedan en el heatmap');

    const expLocal = telemetryService.localHourOf(beforeEvents, 180);
    const expLocalNext = (expLocal + 1) % 24;
    assert.ok(
      heatmap[expLocal].total + heatmap[expLocalNext].total === 3,
      `los eventos caen en la hora local esperada (${expLocal}:00 o la siguiente)`
    );

    const heat0 = await fetch(`${base}/api/analytics/heatmap/${restC.id}?days=7&utcOffsetMinutes=0`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const heatmap0 = (await heat0.json()).data;
    const total0 = heatmap0.reduce((s, h) => s + h.total, 0);
    assert.strictEqual(total0, 3, 'sin offset los totales se conservan (solo cambia el bucket)');
    console.log('✓ D: heatmap aterrizado al huso del dueño (localHourOf + HTTP)');

    // ── E) Abierto/cerrado con autoridad server-side ───────────────────────
    const orderBody = () => ({ restaurantId: restE.id, tableNumber: '1', items: [{ dishId: 'd0', quantity: 1 }], utcOffsetMinutes: 0 });

    let r = await postJson('/api/orders', orderBody());
    assert.strictEqual(r.status, 201, 'sin horario configurado → abierto (pedido entra)');

    let current = db.findRestaurantById(restE.id);
    await db.saveRestaurant(userE.id, { ...current, forceClosed: true });
    r = await postJson('/api/orders', orderBody());
    assert.strictEqual(r.status, 400, 'forceClosed=true → cerrado (400)');
    assert.strictEqual((await r.json()).code, 'RESTAURANT_CLOSED');
    const quoteClosed = await postJson('/api/orders/quote', orderBody(), authJson);
    assert.strictEqual(quoteClosed.status, 400, 'la cotización también respeta el cierre (400)');

    current = db.findRestaurantById(restE.id);
    // Ventana de 1h que NUNCA contiene la hora actual evaluada por el servidor.
    // El body manda `utcOffsetMinutes: 0`, así que el server usa la hora UTC:
    // la ventana debe construirse con getUTCHours() (no getHours(), que devuelve
    // la hora local de la máquina y desincroniza el fixture en husos ≠ UTC).
    // start=(h+2)%24, end=(h+3)%24 → start<end salvo h=21 → 23-00 (ventana
    // nocturna que tampoco cubre h=21). Cerrado a cualquier hora de ejecución.
    const hNow = new Date().getUTCHours();
    const alwaysClosedHours = `${(hNow + 2) % 24}:00-${(hNow + 3) % 24}:00`;
    await db.saveRestaurant(userE.id, { ...current, forceClosed: false, scheduleEnabled: true, scheduleActiveHours: alwaysClosedHours });
    r = await postJson('/api/orders', orderBody());
    assert.strictEqual(r.status, 400, `horario ${alwaysClosedHours} no cubre la hora actual → cerrado (400)`);
    assert.strictEqual((await r.json()).code, 'RESTAURANT_CLOSED');

    current = db.findRestaurantById(restE.id);
    await db.saveRestaurant(userE.id, { ...current, scheduleActiveHours: '00:00-23:59' });
    r = await postJson('/api/orders', orderBody());
    assert.strictEqual(r.status, 201, 'rango 24h con horario activo → abierto');
    console.log('✓ E: el servidor valida abierto/cerrado (forceClosed + horario), quote y pedido');

    // ── F) Observabilidad: percentiles + healthz ───────────────────────────
    const tracker = new LatencyTracker();
    for (let i = 1; i <= 100; i++) tracker.record('/api/x', i);
    const snap = tracker.snapshot();
    assert.strictEqual(snap.groups.api.p50, 50, 'p50 de 1..100 es 50');
    assert.strictEqual(snap.groups.api.p95, 95, 'p95 de 1..100 es 95');
    assert.strictEqual(snap.groups.api.p99, 99, 'p99 de 1..100 es 99');
    assert.strictEqual(groupFor('/m/demo'), 'menu_public');
    assert.strictEqual(groupFor('/api/orders'), 'api');
    assert.strictEqual(groupFor('/favicon.ico'), 'other');

    const hz = await fetch(`${base}/api/healthz`);
    assert.strictEqual(hz.status, 200, 'healthz responde healthy');
    const hzBody = await hz.json();
    assert.ok(hzBody.latency, 'healthz expone latency');
    assert.ok(hzBody.latency.groups.api, 'con el grupo api presente');
    assert.ok(hzBody.latency.groups.api.count >= 1, 'los requests del test ya alimentaron percentiles reales');
    assert.ok(typeof hzBody.latency.groups.api.p95 === 'number', 'p95 tiene un valor numérico');
    console.log('✓ F: LatencyTracker (p50/p95/p99) + /api/healthz expone latency real');

    // ── B (cron): el endpoint de retención responde según el entorno real ────
    // Con CRON_SECRET configurado (como el .env del dueño) el cron falla
    // CERRADO sin credenciales y abre con x-cron-secret; sin secreto y fuera
    // de producción (tests) pasa directo.
    const cronUrl = `${base}/api/cron/telemetry-retention?dryRun=1`;
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const locked = await fetch(cronUrl);
      assert.strictEqual(locked.status, 401, 'cron sin secreto → 401 (fail-closed)');
      const authed = await fetch(cronUrl, { headers: { 'x-cron-secret': cronSecret } });
      assert.strictEqual(authed.status, 200, 'cron con x-cron-secret → 200');
      const cronBody = await authed.json();
      assert.strictEqual(cronBody.success, true);
      assert.ok(cronBody.cutoff, 'con cutoff ISO presente');
      console.log('✓ B: cron de retención fail-closed (401 sin secreto, 200 con x-cron-secret)');
    } else {
      const cron = await fetch(cronUrl);
      assert.strictEqual(cron.status, 200, 'cron responde 200 en dev (sin CRON_SECRET)');
      const cronBody = await cron.json();
      assert.strictEqual(cronBody.success, true);
      assert.ok(cronBody.cutoff, 'con cutoff ISO presente');
      console.log('✓ B: cron /api/cron/telemetry-retention operativo (dry-run)');
    }
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

runTests().catch((error) => {
  console.error('❌ Falló test-hardening:', error);
  process.exit(1);
});