/**
 * tests/test-night-summary.js
 * ──────────────────────────
 * Serie 1 "El Sistema" — F1 "El Cierre" + findings P1/P2 de la auditoría de
 * abuso oct-2026. Cero mocks: server HTTP real + store real + email REALMENTE
 * hermético (RESEND_API_KEY se retira por la corrida: ningún email sale).
 *
 * Cubre:
 *  - §1 Módulo puro api/utils/nightSummary.js: ventana de la jornada cerrada
 *       (prevLocalDay — reloj inyectable), bordes de día/offset, resumen en
 *       centavos (ingresos SIN propina, propinas aparte, avgTicket sobre
 *       intentados, cancelados sin plata), top 3, hora pico y ventana/husos.
 *  - §2 Sanitizer: utcOffsetMinutes (default -180 UY/AR, clamp ±840,
 *       idempotente) + nightSummaryEnabled (default ON, false explícito vale).
 *  - §3 Dedupe de notification_events (night_summary): idempotente por
 *       (restaurante, día local) + retención P1 (dry-run no muta; purga real
 *       SOLO en modo local, patrón test-hardening §B).
 *  - §4 Cron GET /api/cron/night-summary runtime: fail-closed con CRON_SECRET
 *       (401 sin/mal header, 200 con x-cron-secret), reloj congelado
 *       ?nowMs= (solo fuera de producción), franja 3..5 local por huso,
 *       skips honestos (DISABLED / OUT_OF_HOUR / NO_ORDERS+marcador / DEMO),
 *       dedupe global (segunda corrida sent=0 + ALREADY_SENT) y marcador
 *       consultable por la suite.
 *  - §5 P2 — emails sin HTML inyectado: escapeHtmlText en las plantillas
 *       (input de tercero SIEMPRE texto literal) y safeEmailHref (solo
 *       http(s)/rutas de la app: javascript:/data: jamás salen como href).
 *
 * Las mutaciones de data/* las aísla scripts/test-data-guard.js; esta suite
 * además limpia SUS PROPIAS filas de notification_events al terminar.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const app = require('../api/index');
const db = require('../src/db/db');
const { getSupabaseClient } = require('../api/utils/supabase');
const nightSummary = require('../api/utils/nightSummary');
const notificationsService = require('../api/services/notifications');
const emailService = require('../api/services/email');
const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');

const NOTIFICATION_EVENTS_FILE = path.join(__dirname, '..', 'data', 'notification_events.json');

// Reloj fijo de la corrida: 2025-10-24T00:10:00Z. Con offset 240 (UTC+4) la
// hora local es 04:10 ∈ franja 3..5. Los establecimientos reales del espejo
// (UY/AR, offset -180) quedan a las 21:10 → OUT_OF_HOUR (ningún email a un
// dueño real ni marcador ruidoso: la suite es segura a cualquier hora).
const FIXED_NOW_MS = Date.parse('2025-10-24T00:10:00.000Z');
const WINDOW_A = { startUtc: '2025-10-22T20:00:00.000Z', endUtc: '2025-10-23T20:00:00.000Z', localDay: '2025-10-23' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const makeUser = (tag) => db.createUser({
  email: `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
  password: 'test_password',
  email_confirmed_at: new Date().toISOString()
});

async function runTests() {
  console.log('🧪 Iniciando prueba de El Cierre (F1) + P1 retención + P2 escape de emails...');

  // HERMÉTICO desde el arranque: sin RESEND_API_KEY cualquier sendEmail cae a
  // local_mock (nada sale por más que el espejo tenga dueños reales). Con
  // CRON_SECRET propio el cron queda fail-closed para la suite.
  const savedResendKey = Object.prototype.hasOwnProperty.call(process.env, 'RESEND_API_KEY')
    ? process.env.RESEND_API_KEY
    : undefined;
  delete process.env.RESEND_API_KEY;
  const savedCronSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-night-secret';

  // Captura de emails: dejamos pasar TODO por el sendEmail real (cero mocks
  // de negocio) y solo interceptamos para poder mirar lo que realmente sale.
  const outbox = [];
  const realSendEmail = emailService.sendEmail.bind(emailService);
  emailService.sendEmail = async function capturedSendEmail(payload) {
    outbox.push({ to: payload && payload.to, subject: payload && payload.subject, html: payload && payload.html });
    return realSendEmail(payload);
  };

  // own-cleanup: ids de eventos creados a mano (purga §3b) y
  // restaurantIds fixture cuyo marcador el cron pudo dejar (los 5
  // restaurantes fixture se listan en fixtureRestIds más abajo).
  const trackedEventIds = [];
  const fixtureRestIds = [];

  try {
    // ── §1) Módulo puro: ventanas de la jornada cerrada ────────────────────
    // A las 03:00 locales del día 25 (offset -180 = UY), el cierre cuenta el 24.
    const prevUY = nightSummary.prevLocalDay_window('2025-01-15T06:00:00.000Z', -180);
    assert.deepStrictEqual(prevUY, {
      localDay: '2025-01-14',
      startUtc: '2025-01-14T03:00:00.000Z',
      endUtc: '2025-01-15T03:00:00.000Z'
    }, 'la jornada que acabó es exactamente [00:00, 24:00) local convertida a UTC');

    const todayUY = nightSummary.localDayWindow('2025-01-15T06:00:00.000Z', -180, 0);
    assert.strictEqual(todayUY.localDay, '2025-01-15');
    assert.strictEqual(todayUY.startUtc, '2025-01-15T03:00:00.000Z');

    // Offset límite +14h: medianoche local de enero 15 es 10:00Z del día anterior.
    const extreme = nightSummary.localDayWindow('2025-01-15T06:00:00.000Z', 840, 0);
    assert.strictEqual(extreme.startUtc, '2025-01-14T10:00:00.000Z');
    assert.strictEqual(extreme.endUtc, '2025-01-15T10:00:00.000Z');

    // Medianoche local cruzando el cambio de año (02:00 del 01 local → prev = 31 dic).
    const newYear = nightSummary.prevLocalDay_window('2025-01-01T05:00:00.000Z', -180);
    assert.strictEqual(newYear.localDay, '2024-12-31', 'la madrugada del 1° cierra la jornada del 31');

    assert.strictEqual(nightSummary.clampOffset(9999), 840);
    assert.strictEqual(nightSummary.clampOffset(-9999), -840);
    assert.strictEqual(nightSummary.clampOffset('abc'), 0);
    assert.strictEqual(nightSummary.localHourOf('fecha-invalida', 0), null);
    assert.strictEqual(nightSummary.localHourOf('2025-01-15T06:00:00.000Z', -180), 3, '06:00Z en UY son las 03:00');

    console.log('✓ §1a: ventana de la jornada cerrada exacta (medianoche local, offset límite, año nuevo)');

    // ── §1b) Resumen en centavos: plata sin cancelados, top y pico ─────────
    const emptySummary = nightSummary.computeNightSummary([], { localDay: '2025-10-23', currency: 'UYU', utcOffsetMinutes: 240 });
    assert.strictEqual(emptySummary.counts.total, 0);
    assert.strictEqual(emptySummary.revenue, 0);
    assert.strictEqual(emptySummary.avgTicket, 0);
    assert.strictEqual(emptySummary.peakHour, null);
    assert.deepStrictEqual(emptySummary.topDishes, []);
    assert.strictEqual(emptySummary.firstOrderLabel, '');

    const orders = [
      { id: 'o1', status: 'delivered', total: 640, tipAmount: 30, created_at: '2025-10-23T01:15:00.000Z', items_snapshot: [{ name: 'Fainá', quantity: 2 }, { name: 'Muzza', quantity: 1 }] },
      { id: 'o2', status: 'delivered', total: 500, tip_amount: 20, created_at: '2025-10-23T02:15:00.000Z', items_snapshot: [{ name: 'Fainá', quantity: 1 }] },
      { id: 'o3', status: 'cancelled', total: 999, created_at: '2025-10-23T03:15:00.000Z' },
      { id: 'o4', status: 'confirmed', total: 110, created_at: '2025-10-23T00:15:00.000Z' }
    ];
    const S = nightSummary.computeNightSummary(orders, { localDay: '2025-10-23', currency: 'UYU', utcOffsetMinutes: 240 });
    assert.strictEqual(S.counts.total, 4, 'todos los pedidos del día cuentan como tráfico');
    assert.strictEqual(S.counts.delivered, 2);
    assert.strictEqual(S.counts.cancelled, 1);
    assert.strictEqual(S.counts.attempted, 3, 'cancelado cuenta sin plata (ticket sobre intentados)');
    assert.strictEqual(S.revenue, 1200, 'ingresos = (total - propina) de los NO cancelados');
    assert.strictEqual(S.tips, 50, 'propinas aparte');
    assert.strictEqual(S.avgTicket, 400, 'ticket promedio = ingresos / intentados');
    assert.strictEqual(S.counts.truncated, false);

    assert.deepStrictEqual(S.topDishes, [
      { name: 'Fainá', qty: 3 },
      { name: 'Muzza', qty: 1 }
    ], 'top 3 agregado por nombre con qty');
    assert.strictEqual(S.peakHour.label, '04:00', 'empate de hora pico → la primera');
    assert.strictEqual(S.firstOrderLabel, '04:15', 'primera venta en la hora del dueño');
    assert.strictEqual(S.lastOrderLabel, '07:15', 'última venta en la hora del dueño');

    const truncated = nightSummary.computeNightSummary(orders.slice(0, 1), { localDay: '2025-10-23', truncated: true });
    assert.strictEqual(truncated.counts.truncated, true, 'el cap lo marca el llamador y llega al email');
    assert.strictEqual(truncated.counts.total, 1);

    // Determinismo con empates del top: A antes que B a igual qty.
    const tie = nightSummary.computeNightSummary([
      { id: 't1', status: 'delivered', total: 10, created_at: '2025-10-23T01:00:00.000Z', items_snapshot: [{ name: 'Ceviche', quantity: 1 }, { name: 'Asado', quantity: 1 }] }
    ], { localDay: 'x' });
    assert.strictEqual(tie.topDishes[0].name, 'Asado');
    assert.strictEqual(tie.topDishes[1].name, 'Ceviche');

    console.log('✓ §1b: resumen en centavos (ingresos/propinas aparte, avgTicket, top, pico, truncado)');

    // ── §2) Sanitizer: huso del dueño + interruptor del cierre ────────────
    const base = { slug: 'cierre-santi' };
    const def = sanitizeRestaurantPayload(base);
    assert.strictEqual(def.utcOffsetMinutes, -180, 'ausente → -180 (UY/AR, default del producto)');
    assert.strictEqual(def.nightSummaryEnabled, true, 'el cierre por email nace ENCENDIDO');
    const clamp = sanitizeRestaurantPayload({ slug: 'c', utcOffsetMinutes: 9999 });
    assert.strictEqual(clamp.utcOffsetMinutes, 840, 'offset se acota a ±14h');
    const clampNeg = sanitizeRestaurantPayload({ slug: 'c', utcOffsetMinutes: -9999 });
    assert.strictEqual(clampNeg.utcOffsetMinutes, -840);
    const asString = sanitizeRestaurantPayload({ slug: 'c', utcOffsetMinutes: '150' });
    assert.strictEqual(asString.utcOffsetMinutes, 150, 'el string numérico del navegador se acepta');
    const off = sanitizeRestaurantPayload({ slug: 'c', nightSummaryEnabled: false, utcOffsetMinutes: -180 });
    assert.strictEqual(off.nightSummaryEnabled, false, 'un false explícito del dueño se respeta');
    const again = sanitizeRestaurantPayload(off);
    assert.strictEqual(again.utcOffsetMinutes, -180, 'idempotente (round-trip)');
    assert.strictEqual(again.nightSummaryEnabled, false, 'idempotente también el interruptor');
    console.log('✓ §2: sanitizer captura utcOffsetMinutes (default/limites/idempotencia) + nightSummaryEnabled');

    // ── §3) Dedupe night_summary en notification_events ───────────────────
    const dedupeId = `rest_night_dedupe_${Date.now()}`;
    assert.strictEqual(await notificationsService.hasNightSummarySent(dedupeId, '2025-10-23'), false);
    const marker1 = await notificationsService.recordNightSummary({ restaurantId: dedupeId, localDay: '2025-10-23' });
    assert.ok(marker1 && marker1.id, 'el marcador se graba');
    const marker2 = await notificationsService.recordNightSummary({ restaurantId: dedupeId, localDay: '2025-10-23' });
    assert.strictEqual(marker2.id, marker1.id, 'el marcador es idempotente (segunda escritura devuelve el mismo)');
    assert.strictEqual(await notificationsService.hasNightSummarySent(dedupeId, '2025-10-23'), true);
    assert.strictEqual(await notificationsService.hasNightSummarySent(dedupeId, '2025-10-24'), false, 'otro día → no enviado');
    if (marker2 && marker2.id) trackedEventIds.push(marker2.id);
    fixtureRestIds.push(dedupeId);
    console.log('✓ §3a: dedupe night_summary idempotente por (restaurante, día local)');

    // ── §3b) Retención P1 (dry-run no muta; purga real solo en modo local) ──
    const cloudActive = !!getSupabaseClient();
    let localRows = [];
    try { localRows = JSON.parse(fs.readFileSync(NOTIFICATION_EVENTS_FILE, 'utf8')); } catch { localRows = []; }
    const beforePurge = localRows.length;
    const oldIso = new Date(Date.now() - 250 * 86400000).toISOString();
    const recentIso = new Date(Date.now() - 10 * 86400000).toISOString();
    localRows.push(
      { id: 'purge_test_read_old', type: 'night_summary', restaurantId: 'rest_purge_fixture', data: { restaurantId: 'rest_purge_fixture', localDay: '2025-01-01' }, isRead: true, createdAt: oldIso },
      { id: 'purge_test_unread_old', type: 'night_summary', restaurantId: 'rest_purge_fixture', data: { restaurantId: 'rest_purge_fixture', localDay: '2025-01-02' }, isRead: false, createdAt: oldIso },
      { id: 'purge_test_read_recent', type: 'night_summary', restaurantId: 'rest_purge_fixture', data: { restaurantId: 'rest_purge_fixture', localDay: '2025-10-20' }, isRead: true, createdAt: recentIso }
    );
    trackedEventIds.push('purge_test_read_old', 'purge_test_unread_old', 'purge_test_read_recent');
    await db.writeJson(NOTIFICATION_EVENTS_FILE, localRows);

    const dry = await notificationsService.purgeOldNotificationEvents({ readOlderThanDays: 30, dryRun: true });
    assert.strictEqual(dry.dryRun, true);
    assert.strictEqual(dry.prunedLocal, 1, 'dry-run cuenta el candidato (leído + 250 días)');
    assert.ok(typeof dry.candidatesCloud === 'number', 'la nube reporta candidatos en solo lectura');
    let rowsNow = [];
    try { rowsNow = JSON.parse(fs.readFileSync(NOTIFICATION_EVENTS_FILE, 'utf8')); } catch { rowsNow = []; }
    assert.strictEqual(rowsNow.length, beforePurge + 3, 'dry-run NO muta el espejo');

    if (!cloudActive) {
      const purge = await notificationsService.purgeOldNotificationEvents({ readOlderThanDays: 30 });
      assert.strictEqual(purge.prunedLocal, 1, 'solo el leído+viejo se purga');
      rowsNow = [];
      try { rowsNow = JSON.parse(fs.readFileSync(NOTIFICATION_EVENTS_FILE, 'utf8')); } catch { rowsNow = []; }
      assert.ok(!rowsNow.some((r) => r.id === 'purge_test_read_old'), 'el backdated leído desapareció');
      assert.ok(rowsNow.some((r) => r.id === 'purge_test_unread_old'), 'el vivo (sin leer) queda SIEMPRE');
      assert.ok(rowsNow.some((r) => r.id === 'purge_test_read_recent'), 'el reciente queda');
      console.log('✓ §3b: purga real local (dry-run reporta, purge borra exactamente el candidato)');
    } else {
      console.log('✓ §3b: modo cloud — dry-run reporta sin borrar (nada se destruye en la nube real)');
    }

    // ── §4) Cron runtime con reloj fijo ────────────────────────────────────
    // 5 users (saveRestaurant: un local por dueño) + locales alineados al reloj.
    const ownerA = await makeUser('night-a');
    const restA = await db.saveRestaurant(ownerA.id, {
      name: 'Cierre <b>Negrita</b> A', bizName: 'Cierre A', slug: `night-a-${Date.now()}`,
      currency: 'UYU', utcOffsetMinutes: 240, dishes: [{ id: 'd1', name: 'Fainá', price: 300 }]
    });
    fixtureRestIds.push(restA.id);

    const ownerB = await makeUser('night-b');
    const restB = await db.saveRestaurant(ownerB.id, {
      name: 'Cierre B', bizName: 'Cierre B', slug: `night-b-${Date.now()}`,
      utcOffsetMinutes: 240, nightSummaryEnabled: false, dishes: []
    });
    fixtureRestIds.push(restB.id);

    const ownerC = await makeUser('night-c');
    const restC = await db.saveRestaurant(ownerC.id, {
      name: 'Cierre C', bizName: 'Cierre C', slug: `night-c-${Date.now()}`,
      utcOffsetMinutes: 0, dishes: []
    });
    fixtureRestIds.push(restC.id);

    const ownerD = await makeUser('night-d');
    const restD = await db.saveRestaurant(ownerD.id, {
      name: 'Cierre D', bizName: 'Cierre D', slug: `night-d-${Date.now()}`,
      utcOffsetMinutes: 240, dishes: []
    });
    fixtureRestIds.push(restD.id);

    const ownerE = await makeUser('night-e');
    const restE = await db.saveRestaurant(ownerE.id, {
      name: 'Cierre Demo', bizName: 'Cierre Demo', slug: `night-demo-${Date.now()}`,
      utcOffsetMinutes: 240, isDemo: true, dishes: [{ id: 'd9', name: 'Demo dish', price: 50 }]
    });
    fixtureRestIds.push(restE.id);

    // Pedidos del local A dentro de la ventana fija (camel/snake mezclado como
    // el repo). 4 pedidos: 3 con plata (1200) y 1 cancelado.
    for (const o of [
      { id: `ord_nsa1_${Date.now()}`, restaurantId: restA.id, restaurant_id: restA.id, status: 'delivered', total: 640, amount: 610, tip_amount: 30, tipAmount: 30, items_snapshot: [{ name: 'Fainá', quantity: 2 }, { name: 'Muzza', quantity: 1 }], created_at: '2025-10-23T01:15:00.000Z' },
      { id: `ord_nsa2_${Date.now()}`, restaurantId: restA.id, restaurant_id: restA.id, status: 'delivered', total: 500, amount: 480, tip_amount: 20, tipAmount: 20, items_snapshot: [{ name: 'Fainá', quantity: 1 }], created_at: '2025-10-23T02:15:00.000Z' },
      { id: `ord_nsa3_${Date.now()}`, restaurantId: restA.id, restaurant_id: restA.id, status: 'cancelled', total: 999, amount: 999, created_at: '2025-10-23T03:15:00.000Z' },
      { id: `ord_nsa4_${Date.now()}`, restaurantId: restA.id, restaurant_id: restA.id, status: 'confirmed', total: 110, amount: 110, items_snapshot: [{ name: 'Alfajor Muzza', quantity: 1 }], created_at: '2025-10-23T00:15:00.000Z' }
    ]) await db.addOrder(o);
    // Pedido de la noche ANTERIOR: no entra en la ventana del día A.
    await db.addOrder({ id: `ord_nsa0_${Date.now()}`, restaurantId: restA.id, restaurant_id: restA.id, status: 'delivered', total: 5000, amount: 5000, created_at: '2025-10-21T23:00:00.000Z' });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    const baseURL = `http://localhost:${port}`;
    const cronUrl = `${baseURL}/api/cron/night-summary?nowMs=${FIXED_NOW_MS}`;

    try {
      // Fail-closed: con CRON_SECRET configurado la suite exige el header.
      const locked = await fetch(cronUrl);
      assert.strictEqual(locked.status, 401, 'cron sin secreto → 401');
      const wrong = await fetch(cronUrl, { headers: { 'x-cron-secret': 'otra-clave-errada' } });
      assert.strictEqual(wrong.status, 401, 'cron con secreto equivocado → 401');

      const run1 = await fetch(cronUrl, { headers: { 'x-cron-secret': 'test-night-secret' } });
      assert.strictEqual(run1.status, 200, 'cron con x-cron-secret → 200');
      const body1 = await run1.json();
      assert.strictEqual(body1.success, true);
      assert.deepStrictEqual(body1.windowHours, [3, 5]);
      assert.strictEqual(body1.data.checked >= 5, true, 'recorre TODOS los locales');
      assert.strictEqual(body1.data.sent >= 1, true, 'el local alineado con pedidos recibe SU email');
      assert.strictEqual(body1.data.reasons.DISABLED >= 1, true, 'nightSummaryEnabled=false → DISABLED');
      assert.strictEqual(body1.data.reasons.NO_ORDERS >= 1, true, 'día sin pedidos → NO_ORDERS (con marcador)');
      assert.strictEqual(body1.data.reasons.OUT_OF_HOUR >= 1, true, 'local fuera de su madrugada → OUT_OF_HOUR');
      assert.strictEqual(body1.data.reasons.DEMO >= 1, true, 'demo → salteado siempre');
      assert.strictEqual(await notificationsService.hasNightSummarySent(restA.id, WINDOW_A.localDay), true, 'el marcador queda consultable');
      assert.strictEqual(await notificationsService.hasNightSummarySent(restD.id, WINDOW_A.localDay), true, 'NO_ORDERS también graba marcador (dedupe de los próximos ticks)');

      // Dedupe global: segunda corrida del MISMO tick no reenvía NADA.
      const run2 = await fetch(cronUrl, { headers: { 'x-cron-secret': 'test-night-secret' } });
      const body2 = await run2.json();
      assert.strictEqual(body2.data.sent, 0, 'segunda corrida → 0 emails (dedupe)');
      assert.strictEqual(body2.data.reasons.ALREADY_SENT >= 1, true);
      console.log('✓ §4: cron fail-closed (401/401/200), skips honestos, reloj ?nowMs=, dedupe global');

      // El email de cierre de A llegó PRECISO: 4 pedidos, $1.200, ventana local,
      // nombre del local escapado (P2) y sin nota de truncado.
      const nightMail = outbox.find((m) => m.subject.includes('Tu cierre de hoy'));
      assert.ok(nightMail, 'el email del cierre salió (con capture de la suite)');
      assert.strictEqual(nightMail.to, ownerA.email, 'el cierre le llega al DUEÑO del local');
      assert.ok(/4 pedidos/.test(nightMail.subject), `asunto con la cantidad real: ${nightMail.subject}`);
      assert.ok(/1\.200|1200/.test(nightMail.subject), `asunto con los ingresos sin propinas: ${nightMail.subject}`);
      assert.ok(!nightMail.html.includes('<b>Negrita'), 'nombre del local va ESCAPADO en el HTML');
      assert.ok(nightMail.html.includes('&lt;b&gt;Negrita&lt;/b&gt;'), 'el escape de entidades esperado');
      assert.ok(nightMail.html.includes('04:15 → 07:15'), 'ventana local primera → última venta');
      assert.ok(nightMail.html.includes('Propinas'), 'propinas reportadas aparte');
      assert.ok(!nightMail.html.includes('resumen parcial'), 'sin cap → sin nota de truncado');
      console.log('✓ §4b: el email del cierre lleva números precisos + huso del dueño');
    } finally {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }

    // ── §5) P2 — nada de HTML del dueño sale vivo en los emails ───────────
    assert.strictEqual(emailService.escapeHtmlText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.strictEqual(emailService.escapeHtmlText('a & "b" \'c\''), 'a &amp; &quot;b&quot; &#39;c&#39;');
    assert.strictEqual(emailService.safeEmailHref('javascript:alert(1)'), '');
    assert.strictEqual(emailService.safeEmailHref('data:text/html,<b>x</b>'), '');
    assert.strictEqual(emailService.safeEmailHref('https://scango.uy/studio?tab=x'), 'https://scango.uy/studio?tab=x');
    assert.strictEqual(emailService.safeEmailHref('/studio?tab=x'), '/studio?tab=x');
    assert.strictEqual(emailService.safeEmailHref('HTTPS://X.COM/A'), 'HTTPS://X.COM/A', 'mayúsculas de esquema también pasan');

    const hostileOut = outbox.length;
    await emailService.sendReviewRequestEmail({
      to: 'test-night-p2@example.com',
      customerName: 'Fede <script>alert(1)</script>',
      restaurantName: '<b>Negrita PI</b>',
      reviewUrl: 'javascript:alert(1)'
    });
    const hostileMail = outbox[hostileOut];
    assert.ok(!hostileMail.html.includes('<script>alert'), 'el input de tercero NUNCA sale como markup vivo');
    assert.ok(hostileMail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'va como texto literal');
    assert.ok(!hostileMail.html.includes('javascript:'), 'href javascript: descartado');
    assert.ok(!hostileMail.html.includes('<b>Negrita PI'), 'nombre del local escapado también aquí');

    const hostileOut2 = outbox.length;
    await emailService.sendWelcomeEmail({
      to: 'test-night-p2@example.com',
      restaurantName: 'Pepe <img src=x onerror=alert(2)>',
      menuUrl: "data:text/html,<b>x</b>",
      studioUrl: 'https://scango.uy/studio'
    });
    const welcomeMail = outbox[hostileOut2];
    // El ASUNTO es texto plano (los clientes no lo interpretan); en el HTML el
    // nombre sale escapado: la PEROPOSIDAD 'onerror' sigue visible como TEXT
    // (dentro de &lt;&gt; es inerte) y jamás como tag vivo.
    assert.ok(!welcomeMail.html.includes('<img'), 'sin tags de imagen vivos en el HTML');
    assert.ok(welcomeMail.html.includes('&lt;img'), 'el nombre sale como texto literal');
    assert.ok(!welcomeMail.html.includes('href="data:'), 'data: jamás es href');
    assert.ok(welcomeMail.html.includes('href="https://scango.uy/studio"'), 'el CTA legítimo sigue su curso');

    console.log('✓ §5: escape de plantillas (terceros escapados) + base de datos href (safeEmailHref)');
  } finally {
    // Limpieza best-effort de PROPIAS filas de notification_events (local):
    // marcadores de dedupe + fixtures de purga. La nube la limpia el guard
    // (restaurantes fixture, cascade por restaurant_id).
    try {
      const rows = JSON.parse(fs.readFileSync(NOTIFICATION_EVENTS_FILE, 'utf8'));
      const fixtureSet = new Set([...fixtureRestIds, 'rest_purge_fixture']);
      const kept = rows.filter((r) => {
        const rest = r && (r.restaurantId || (r.data && r.data.restaurantId) || '');
        const isMine = (trackedEventIds.includes(r.id)) || (rest && fixtureSet.has(String(rest)));
        return !isMine;
      });
      await db.writeJson(NOTIFICATION_EVENTS_FILE, kept);
    } catch (e) { /* best-effort */ }

    // Restaurar el entorno EXACTO como estaba.
    emailService.sendEmail = realSendEmail;
    if (typeof savedResendKey === 'undefined') {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = savedResendKey;
    }
    if (typeof savedCronSecret === 'undefined') {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = savedCronSecret;
    }
  }
  console.log('✅ Night summary (F1) + P1 + P2 verificados');
}

runTests().catch((error) => {
  console.error('❌ Falló test-night-summary:', error);
  process.exit(1);
});
