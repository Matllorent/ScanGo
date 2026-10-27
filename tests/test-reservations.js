/**
 * tests/test-reservations.js — "Reservas de verdad" + recordatorio 24h (65ª suite)
 * ─────────────────────────────────────────────────────────────────────────────────
 * El chip "Reservar Mesa" deja de ser solo WhatsApp: la reserva EXISTE en el
 * sistema (restaurant.reservations[], columna `profile` — cero migración), el
 * dueño la opera desde el Studio (agenda del día + máquina de estados) y el
 * comensal recibe un recordatorio 24h (cron horario + email + push).
 *
 * §1 Módulo puro `api/utils/reservations.js`: parseo del alta (pax '8+',
 *    teléfonos por dígitos, fecha pasada/lejana), instantes locales
 *    (local = UTC + offset), capacidad por franja (SLOT_FULL/BUFFER con
 *    same-time gobernar por maxPerSlot), trim con overflow (terminales viejas
 *    primero), máquina de estados total y selección de recordatorios.
 * §2 Privilegio: `/api/studio/save` NUNCA crea/pisa `reservations`
 *    (PRIVILEGED_FIELDS + sanitizer sin la clave).
 * §3 Runtime real: server HTTP + store real — 201 pública, 400s honestos,
 *    403 disabled, demo no-op, 409 capacidad (slot lleno y buffer) en
 *    restaurantes separados, agenda del dueño con anillo del Club y counts,
 *    máquina de estados vía PATCH (409/400/404/401) y cross-tenant 404.
 * §4 Cron real hermético: RESEND/VAPID retirados por la corrida, outbox
 *    interceptando el sendEmail REAL, reloj congelado ?nowMs= (gated),
 *    ventana acotable ?windowHours=, sent=1 + NO_CHANNEL sin marcar,
 *    dedupe en 2ª corrida y fail-closed del cron auth.
 * §5 Wiring estático (menu + Studio) + contrato openapi.yaml.
 *
 * Regresión de la decisión (cero mocks: flujos reales con store y HTTP;
 * tests mutan data/* y `npm test` las aísla/restaura).
 * ─────────────────────────────────────────────────────────────────────────────────
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const reservations = require('../api/utils/reservations');
const emailService = require('../api/services/email');
const notificationsService = require('../api/services/notifications');
const loyaltyService = require('../api/services/loyalty');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Reloj fijo del cron (§4): 2026-01-15T00:00:00Z. Con offset -180 (UY) la
// reserva {date:'2026-01-15', time:'21:00'} arranca 2026-01-16T00:00Z →
// delta exacto 24h, DENTRO de la ventana [23, 25].
const FIXED_NOW_MS = Date.parse('2026-01-15T00:00:00.000Z');

/** Teléfono único por corrida (los fixtures pueden replicarse a la nube). */
const STAMP = Date.now();

async function runTests() {
  console.log('🧪 Iniciando prueba de Reservas de verdad + recordatorio 24h...');

  // ── §1 Módulo puro ──────────────────────────────────────────────────────────
  console.log('\n── §1 Módulo puro api/utils/reservations.js ──────────────────────');
  {
    const NOW = Date.parse('2026-01-15T12:00:00.000Z');
    const OFF = -180; // UY: local = UTC − 3h → "hoy local" 2026-01-15 (09:00 local)

    // Parseo feliz + normalizaciones (teléfono por dígitos, email lowercase).
    const ok = reservations.parseReservationInput(
      {
        name: '  Ana   Pérez ', phone: '+598 99 123 456', email: 'ANA@Example.COM ',
        date: '2026-01-16', time: '21:00', pax: '4', notes: '  Sin  mani  '
      },
      { nowMs: NOW, utcOffsetMinutes: OFF }
    );
    assert.strictEqual(ok.ok, true, 'alta válida parsea ok');
    assert.strictEqual(ok.value.name, 'Ana Pérez', 'nombre saneado (colapsa espacios)');
    assert.strictEqual(ok.value.phone, '59899123456', 'teléfono por dígitos');
    assert.strictEqual(ok.value.email, 'ana@example.com', 'email trim + lowercase');
    assert.strictEqual(ok.value.pax, 4, 'pax numérico');
    assert.strictEqual(ok.value.notes, 'Sin mani', 'notas saneadas');
    assert.ok(!('paxLabel' in ok.value), 'pax normal no lleva label');

    // Mesa larga: '8+' → pax 8 + label de presentación.
    const big = reservations.parseReservationInput(
      { name: 'Familia', phone: '099123456', date: '2026-01-16', time: '13:30', pax: '8+' },
      { nowMs: NOW, utcOffsetMinutes: OFF }
    );
    assert.strictEqual(big.ok, true, "'8+' parsea ok");
    assert.strictEqual(big.value.pax, 8, "'8+' cuenta como 8");
    assert.strictEqual(big.value.paxLabel, '8+', 'label de presentación');

    // Errores uno por uno (códigos estables que la ruta mapea a 400).
    const codesOf = (r) => r.errors.map((e) => e.code);
    assert.ok(codesOf(reservations.parseReservationInput({}, { nowMs: NOW })).includes('RESERVATION_NAME_REQUIRED'), 'sin nombre → RESERVATION_NAME_REQUIRED');
    assert.ok(codesOf(reservations.parseReservationInput({ name: 'x', phone: '123' }, { nowMs: NOW })).includes('RESERVATION_PHONE_INVALID'), 'teléfono corto → RESERVATION_PHONE_INVALID');
    assert.ok(
      codesOf(reservations.parseReservationInput({ name: 'x', phone: '59899123456', date: '2026-01-10', time: '21:00', pax: 2 }, { nowMs: NOW, utcOffsetMinutes: OFF })).includes('RESERVATION_DATE_PAST'),
      'fecha pasada (en huso del dueño) → RESERVATION_DATE_PAST'
    );
    assert.ok(
      codesOf(reservations.parseReservationInput({ name: 'x', phone: '59899123456', date: '2026-03-17', time: '21:00', pax: 2 }, { nowMs: NOW, utcOffsetMinutes: OFF })).includes('RESERVATION_DATE_TOO_FAR'),
      'fecha lejana (>60d) → RESERVATION_DATE_TOO_FAR (maxDate 2026-03-16, local 2026-01-15 + 60d)'
    );
    assert.strictEqual(
      reservations.parseReservationInput({ name: 'x', phone: '59899123456', date: '2026-03-16', time: '21:00', pax: 2 }, { nowMs: NOW, utcOffsetMinutes: OFF }).ok,
      true,
      'día 60 exacto (borde inclusivo) es reservable'
    );
    assert.ok(codesOf(reservations.parseReservationInput({ name: 'x', phone: '59899123456', date: '2026-13-45', time: '21:00', pax: 2 }, { nowMs: NOW })).includes('RESERVATION_DATE_INVALID'), 'fecha inválida → RESERVATION_DATE_INVALID');
    assert.ok(codesOf(reservations.parseReservationInput({ name: 'x', phone: '59899123456', date: '2026-01-16', time: '25:00', pax: 2 }, { nowMs: NOW })).includes('RESERVATION_TIME_INVALID'), 'hora inválida → RESERVATION_TIME_INVALID');
    assert.ok(codesOf(reservations.parseReservationInput({ name: 'x', phone: '59899123456', date: '2026-01-16', time: '21:00', pax: 13 }, { nowMs: NOW })).includes('RESERVATION_PAX_INVALID'), 'pax > maxPax → RESERVATION_PAX_INVALID');
    assert.ok(codesOf(reservations.parseReservationInput({ name: 'x', phone: '59899123456', date: '2026-01-16', time: '21:00', pax: 0 }, { nowMs: NOW })).includes('RESERVATION_PAX_INVALID'), 'pax 0 → RESERVATION_PAX_INVALID');
    assert.ok(
      codesOf(reservations.parseReservationInput({ name: 'x', phone: '59899123456', date: '2026-01-16', time: '21:00', pax: 2, email: 'no-es-mail' }, { nowMs: NOW })).includes('RESERVATION_EMAIL_INVALID'),
      'email inválido → RESERVATION_EMAIL_INVALID'
    );
    // Hoy local exacto y email ausente: válidos.
    const today = reservations.parseReservationInput({ name: 'x', phone: '59899123456', date: '2026-01-15', time: '23:30', pax: 2 }, { nowMs: NOW, utcOffsetMinutes: OFF });
    assert.strictEqual(today.ok, true, 'hoy local (borde inclusivo) es reservable');
    assert.ok(!('email' in today.value), 'email ausente NO inventa la clave');
    // Body basura.
    assert.ok(codesOf(reservations.parseReservationInput('perro')).includes('VALIDATION_ERROR'), 'body no-objeto → VALIDATION_ERROR');

    // Instante UTC de la reserva local: local = UTC + offset (UY −180 → +3h).
    assert.strictEqual(
      reservations.localReservationStartUtcMs({ date: '2026-01-15', time: '21:00' }, -180),
      Date.parse('2026-01-16T00:00:00.000Z'),
      '21:00 local UY = 00:00Z del día siguiente'
    );
    assert.strictEqual(
      reservations.localReservationStartUtcMs({ date: '2026-01-15', time: '21:00' }, 240),
      Date.parse('2026-01-15T17:00:00.000Z'),
      '21:00 local UTC+4 = 17:00Z'
    );
    assert.strictEqual(reservations.localReservationStartUtcMs({ date: 'perro', time: '21:00' }, -180), null, 'fecha basura → null (nunca inventa)');
    assert.strictEqual(reservations.localReservationStartUtcMs({ date: '2026-01-15', time: '9:00' }, -180), null, 'hora sin cero → null');

    // Capacidad: 4 activas a la MISMA hora llenan el slot (5ª → SLOT_FULL)...
    const row = (id, time, status) => ({ id, date: '2026-01-16', time, status });
    const fullSlot = [row('a', '21:00', 'requested'), row('b', '21:00', 'confirmed'), row('c', '21:00', 'requested'), row('d', '21:00', 'confirmed')];
    assert.deepStrictEqual(reservations.assertSlotAvailable(fullSlot, { date: '2026-01-16', time: '21:00' }), { ok: false, reason: 'SLOT_FULL' }, '5ª reserva a la misma hora → SLOT_FULL');
    // ...y la 2ª a la misma hora NO rebota por buffer (maxPerSlot la gobierna).
    assert.deepStrictEqual(reservations.assertSlotAvailable([row('a', '21:00', 'requested')], { date: '2026-01-16', time: '21:00' }), { ok: true }, '2ª reserva a la misma hora pasa (el buffer NO cuenta same-time)');
    // Buffer: otra reserva activa a menos de 30 min bloquea; a 30 exactas pasa.
    assert.deepStrictEqual(reservations.assertSlotAvailable([row('a', '20:00', 'confirmed')], { date: '2026-01-16', time: '20:15' }), { ok: false, reason: 'BUFFER_TOO_CLOSE' }, '20:15 vs 20:00 → BUFFER_TOO_CLOSE');
    assert.deepStrictEqual(reservations.assertSlotAvailable([row('a', '20:00', 'confirmed')], { date: '2026-01-16', time: '20:30' }), { ok: true }, '20:30 exacto (borde >=) pasa');
    // Terminales liberan lugar; otro día no cuenta; basura no bloquea (fail-open).
    assert.deepStrictEqual(reservations.assertSlotAvailable([row('a', '21:00', 'cancelled'), row('b', '21:00', 'no_show')], { date: '2026-01-16', time: '21:00' }), { ok: true }, 'canceladas/no-show liberan la franja');
    assert.deepStrictEqual(reservations.assertSlotAvailable([row('a', '21:00', 'confirmed')], { date: '2026-01-17', time: '21:00' }), { ok: true }, 'otro día no bloquea');
    assert.deepStrictEqual(reservations.assertSlotAvailable([{ id: 'z' }, null], { date: '2026-01-16', time: '21:00' }), { ok: true }, 'filas basura no bloquean (fail-open)');
    assert.deepStrictEqual(reservations.assertSlotAvailable([], { date: '2026-01-16', time: 'no-hora' }).ok, false, 'hora inválida → rechaza');

    // Máquina de estados: tabla total.
    assert.deepStrictEqual(reservations.transitionReservationStatus('requested', 'confirmed'), { ok: true }, 'requested→confirmed');
    assert.deepStrictEqual(reservations.transitionReservationStatus('requested', 'cancelled'), { ok: true }, 'requested→cancelled');
    assert.deepStrictEqual(reservations.transitionReservationStatus('requested', 'seated'), { ok: false, reason: 'INVALID_RESERVATION_TRANSITION' }, 'requested→seated prohibido');
    assert.deepStrictEqual(reservations.transitionReservationStatus('requested', 'requested'), { ok: false, reason: 'INVALID_RESERVATION_TRANSITION' }, 'self-transition prohibida');
    assert.deepStrictEqual(reservations.transitionReservationStatus('confirmed', 'seated'), { ok: true }, 'confirmed→seated');
    assert.deepStrictEqual(reservations.transitionReservationStatus('confirmed', 'no_show'), { ok: true }, 'confirmed→no_show');
    assert.deepStrictEqual(reservations.transitionReservationStatus('confirmed', 'confirmed'), { ok: false, reason: 'INVALID_RESERVATION_TRANSITION' }, 'confirmed→confirmed prohibido');
    assert.deepStrictEqual(reservations.transitionReservationStatus('seated', 'cancelled'), { ok: false, reason: 'INVALID_RESERVATION_TRANSITION' }, 'seated es terminal');
    assert.deepStrictEqual(reservations.transitionReservationStatus('cancelled', 'requested'), { ok: false, reason: 'INVALID_RESERVATION_TRANSITION' }, 'cancelled es terminal');
    assert.deepStrictEqual(reservations.transitionReservationStatus('no_show', 'seated'), { ok: false, reason: 'INVALID_RESERVATION_TRANSITION' }, 'no_show es terminal');
    assert.deepStrictEqual(reservations.transitionReservationStatus('requested', 'weird'), { ok: false, reason: 'INVALID_RESERVATION_STATUS' }, 'estado destino desconocido → INVALID_RESERVATION_STATUS');
    assert.deepStrictEqual(reservations.transitionReservationStatus('weird', 'confirmed'), { ok: false, reason: 'INVALID_RESERVATION_STATUS' }, 'estado origen desconocido → INVALID_RESERVATION_STATUS');

    // Labels ES para el chip del Studio.
    assert.strictEqual(reservations.describeReservationStatus('requested').label, 'Solicitada');
    assert.strictEqual(reservations.describeReservationStatus('no_show').label, 'No vino');

    // Trim con overflow: primero terminales viejas, después las más viejas.
    const fiftyTwo = [];
    for (let i = 0; i < 502; i++) fiftyTwo.push({ id: `t${i}`, status: i < 2 ? 'requested' : i < 10 ? 'cancelled' : 'requested' });
    const trimmed = reservations.trimReservationsList(fiftyTwo);
    assert.strictEqual(trimmed.length, 500, 'trim deja exactamente MAX_RESERVATIONS');
    assert.ok(trimmed.some(r => r.id === 't0') && trimmed.some(r => r.id === 't1'), 'reservas ACTIVAS viejas sobreviven');
    assert.ok(!trimmed.some(r => r.id === 't2') && !trimmed.some(r => r.id === 't3'), 'las terminales MÁS VIEJAS se dropean primero');
    const noTerminals = Array.from({ length: 501 }, (_, i) => ({ id: `q${i}`, status: 'requested' }));
    const trimmed2 = reservations.trimReservationsList(noTerminals);
    assert.strictEqual(trimmed2.length, 500, 'sin terminales dropea overflow');
    assert.ok(!trimmed2.some(r => r.id === 'q0') && trimmed2.some(r => r.id === 'q500'), 'sin terminales dropea las MÁS VIEJAS');
    const under = [{ id: 'a', status: 'requested' }, { id: 'b', status: 'confirmed' }];
    assert.strictEqual(reservations.trimReservationsList(under).length, 2, 'bajo el cap: identidad');

    // Selección de recordatorios: solo confirmed en [23,25]h, sin demos, sin mutar.
    const mkRes = (over) => ({ id: `r_${over.time}`, date: '2026-01-15', time: over.time, status: over.status || 'confirmed', name: 'Ana', phone: '59899111222', ...over });
    const restFixture = {
      id: 'rest_x', slug: 'rest-x', name: 'Rest X', utcOffsetMinutes: -180,
      reservations: [
        mkRes({ time: '21:00' }),                                    // 24h → DENTRO
        mkRes({ time: '20:00' }),                                    // 23h → borde DENTRO
        mkRes({ time: '22:00' }),                                    // 25h → borde DENTRO
        mkRes({ time: '19:54' }),                                    // 22.9h → fuera
        mkRes({ time: '22:06' }),                                    // 25.1h → fuera
        mkRes({ time: '23:00', date: '2026-01-14' }),                // +2h → fuera
        mkRes({ time: '21:30', status: 'requested' }),               // no confirmada → fuera
        mkRes({ time: '21:45', status: 'cancelled' }),               // terminal → fuera
        mkRes({ time: 'perro' }),                                    // start inválido → fuera
        null
      ]
    };
    const before = JSON.stringify(restFixture.reservations);
    const cands = reservations.selectReservationReminders([restFixture, { isDemo: true, id: 'd', slug: 'd', reservations: [mkRes({ time: '21:00' })] }], { nowMs: FIXED_NOW_MS });
    assert.strictEqual(cands.length, 3, 'exactamente las confirmed dentro de [23,25] (24h/23h/25h)');
    assert.ok(cands.every(c => c.restaurantId === 'rest_x'), 'la demo queda AFUERA');
    assert.strictEqual(JSON.stringify(restFixture.reservations), before, 'no muta la entrada');
    assert.strictEqual(reservations.selectReservationReminders([restFixture], { nowMs: FIXED_NOW_MS, windowHours: [0, 1] }).length, 0, 'ventana acotada no selecciona nada');
    assert.strictEqual(reservations.selectReservationReminders([restFixture], { nowMs: FIXED_NOW_MS, max: 1 }).length, 1, 'tope por corrida respeta max');
    assert.strictEqual(reservations.selectReservationReminders([{ id: 'x', reservations: [mkRes({ time: '21:00' })] }], { nowMs: FIXED_NOW_MS }).length, 0, 'sin slug fuera (el push linkea el menú)');
    assert.strictEqual(reservations.selectReservationReminders('perro', { nowMs: FIXED_NOW_MS }).length, 0, 'entrada basura → lista vacía');
    console.log('✓ §1 módulo puro: parseo, huso, capacidad, máquina, trim y recordatorios');
  }

  // ── Server + entorno hermético para §2/§3 ───────────────────────────────────
  const savedEnv = {
    RESEND_API_KEY: Object.prototype.hasOwnProperty.call(process.env, 'RESEND_API_KEY') ? process.env.RESEND_API_KEY : undefined,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    CRON_SECRET: process.env.CRON_SECRET
  };
  delete process.env.RESEND_API_KEY;   // sendEmail cae a local_mock: cero tráfico externo
  delete process.env.VAPID_PUBLIC_KEY; // push honesto PUSH_NOT_CONFIGURED
  delete process.env.VAPID_PRIVATE_KEY;
  process.env.CRON_SECRET = 'test-reservations-secret';

  // Outbox: TODO pasa por el sendEmail REAL (cero mocks), solo lo observamos.
  const outbox = [];
  const realSendEmail = emailService.sendEmail.bind(emailService);
  emailService.sendEmail = async function capturedSendEmail(payload) {
    outbox.push(payload);
    return realSendEmail(payload);
  };

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const json = { 'Content-Type': 'application/json' };
  const postJson = (url, body, headers = json) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const patchJson = (url, body, headers = json) =>
    fetch(`${base}${url}`, { method: 'PATCH', headers, body: JSON.stringify(body) });

  const fixtureUserIds = [];
  const fixtureRestIds = [];
  const makeUser = (tag) => db.createUser({
    email: `${tag}-${STAMP}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });

  try {
    // ── §2 Runtime real ──────────────────────────────────────────────────────
    console.log('\n── §2 Runtime real (server HTTP + store) ────────────────────────');
    const ownerA = await makeUser('res-owner-a');
    fixtureUserIds.push(ownerA.id);
    const ownerB = await makeUser('res-owner-b');
    fixtureUserIds.push(ownerB.id);

    const dayPlus = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10); // siempre futuro
    const restMain = await db.saveRestaurant(ownerA.id, {
      name: 'Restaurante Reservas', bizName: 'Restaurante Reservas',
      slug: `reservas-main-${STAMP}`, utcOffsetMinutes: -180, dishes: [], categories: []
    });
    fixtureRestIds.push(restMain.id);
    const restB = await db.saveRestaurant(ownerB.id, {
      name: 'Restaurante Ajeno', bizName: 'Restaurante Ajeno',
      slug: `reservas-ajeno-${STAMP}`, utcOffsetMinutes: -180, dishes: [], categories: []
    });
    fixtureRestIds.push(restB.id);

    // Alta pública feliz: 201 + requested + label ES + source menu.
    const marcelaPhone = `59899${String(STAMP).slice(-6)}`; // el Club se siembra con ESTE teléfono
    const r1 = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Marcela', phone: marcelaPhone,
      date: dayPlus, time: '21:00', pax: '2', notes: 'Aniversario'
    });
    assert.strictEqual(r1.status, 201, 'alta pública → 201');
    const happy = (await r1.json()).data.reservation;
    assert.strictEqual(happy.status, 'requested', 'la reserva nace requested');
    assert.strictEqual(happy.statusLabel, 'Solicitada', 'label ES en el alta');
    assert.strictEqual(happy.pax, 2, 'pax persistido');
    assert.strictEqual(happy.source, 'menu', 'origen menú');
    assert.ok(happy.id.startsWith('resv_'), 'id de reserva resv_*');
    assert.ok(!('club' in happy), 'el alta pública no consulta el Club');

    // Mesa larga '8+' (misma hora: la gobierna maxPerSlot, no el buffer).
    const r2 = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Familia Ruiz', phone: `59898${String(STAMP).slice(-6)}`,
      date: dayPlus, time: '21:00', pax: '8+'
    });
    assert.strictEqual(r2.status, 201, "'8+' en la misma hora → 201 (buffer no bloquea same-time)");
    const big = (await r2.json()).data.reservation;
    assert.strictEqual(big.pax, 8, 'pax 8');
    assert.strictEqual(big.paxLabel, '8+', 'paxLabel persistido');

    // Errores honestos de validación (400 con el código del primer error).
    const badName = await postJson('/api/reservations', { slug: restMain.slug, name: '', phone: '59899111222', date: dayPlus, time: '21:00', pax: '2' });
    assert.strictEqual(badName.status, 400, 'sin nombre → 400');
    assert.strictEqual((await badName.json()).code, 'RESERVATION_NAME_REQUIRED', 'código RESERVATION_NAME_REQUIRED');
    const badDate = await postJson('/api/reservations', { slug: restMain.slug, name: 'X', phone: '59899111222', date: '2020-01-01', time: '21:00', pax: '2' });
    assert.strictEqual(badDate.status, 400, 'fecha pasada → 400');
    assert.strictEqual((await badDate.json()).code, 'RESERVATION_DATE_PAST', 'código RESERVATION_DATE_PAST');
    const noSlug = await postJson('/api/reservations', { name: 'X', phone: '59899111222', date: dayPlus, time: '21:00', pax: '2' });
    assert.strictEqual(noSlug.status, 400, 'sin slug → 400 VALIDATION_ERROR');

    // Local inexistente → 404.
    const noRest = await postJson('/api/reservations', { slug: `no-existe-${STAMP}`, name: 'X', phone: '59899111222', date: dayPlus, time: '21:00', pax: '2' });
    assert.strictEqual(noRest.status, 404, 'slug desconocido → 404');

    // Demo: 200 no-op honesto (sin data real).
    const demoRes = await postJson('/api/reservations', {
      slug: 'demo-restaurante', name: 'Demo', phone: '59899111222', date: dayPlus, time: '21:00', pax: '2'
    });
    assert.strictEqual(demoRes.status, 200, 'demo → 200 (no-op)');
    const demoBody = await demoRes.json();
    assert.strictEqual(demoBody.data.demo, true, 'demo → {demo:true} sin persistir');

    // Toggle del dueño apagado → 403 RESERVATIONS_DISABLED.
    // OJO: saveRestaurant es UN local por dueño (Object.assign sobre el existente)
    // → cada fixture necesita su PROPIO dueño.
    const ownerOff = await makeUser('res-owner-off');
    fixtureUserIds.push(ownerOff.id);
    const restOff = await db.saveRestaurant(ownerOff.id, {
      name: 'Reservas Apagadas', bizName: 'Reservas Apagadas',
      slug: `reservas-off-${STAMP}`, utcOffsetMinutes: -180, dishes: [], categories: [], allowReservations: false
    });
    fixtureRestIds.push(restOff.id);
    const disabled = await postJson('/api/reservations', {
      slug: restOff.slug, name: 'X', phone: '59899111222', date: dayPlus, time: '21:00', pax: '2'
    });
    assert.strictEqual(disabled.status, 403, 'reservas apagadas → 403');
    assert.strictEqual((await disabled.json()).code, 'RESERVATIONS_DISABLED', 'código RESERVATIONS_DISABLED');

    // Slot lleno: 4 activas a la misma hora + 5ª → 409 SLOT_UNAVAILABLE
    // (restaurante separado para no rozar el limiter público de restMain).
    const ownerSlot = await makeUser('res-owner-slot');
    fixtureUserIds.push(ownerSlot.id);
    const restSlot = await db.saveRestaurant(ownerSlot.id, {
      name: 'Reservas Slot', bizName: 'Reservas Slot',
      slug: `reservas-slot-${STAMP}`, utcOffsetMinutes: -180, dishes: [], categories: []
    });
    fixtureRestIds.push(restSlot.id);
    for (let i = 0; i < 4; i++) {
      const r = await postJson('/api/reservations', {
        slug: restSlot.slug, name: `Mesa ${i + 1}`, phone: `59899111${i}${String(STAMP).slice(-2)}`,
        date: dayPlus, time: '22:00', pax: '2'
      });
      assert.strictEqual(r.status, 201, `slot ${i + 1}/4 a la misma hora → 201`);
    }
    const fifth = await postJson('/api/reservations', {
      slug: restSlot.slug, name: 'El que no entra', phone: '59899111999', date: dayPlus, time: '22:00', pax: '2'
    });
    assert.strictEqual(fifth.status, 409, '5ª reserva del slot → 409');
    assert.strictEqual((await fifth.json()).code, 'SLOT_UNAVAILABLE', 'un solo código público SLOT_UNAVAILABLE');

    // Buffer: 20:00 ocupada → 20:15 rebota (buffer 30); 20:30 exacto pasa.
    const ownerBuf = await makeUser('res-owner-buf');
    fixtureUserIds.push(ownerBuf.id);
    const restBuf = await db.saveRestaurant(ownerBuf.id, {
      name: 'Reservas Buffer', bizName: 'Reservas Buffer',
      slug: `reservas-buffer-${STAMP}`, utcOffsetMinutes: -180, dishes: [], categories: []
    });
    fixtureRestIds.push(restBuf.id);
    const bufFirst = await postJson('/api/reservations', { slug: restBuf.slug, name: 'Primera', phone: '59899111222', date: dayPlus, time: '20:00', pax: '2' });
    assert.strictEqual(bufFirst.status, 201, '20:00 libre → 201');
    const bufClose = await postJson('/api/reservations', { slug: restBuf.slug, name: 'Cerca', phone: '59899111223', date: dayPlus, time: '20:15', pax: '2' });
    assert.strictEqual(bufClose.status, 409, '20:15 vs 20:00 → 409 (buffer 30)');
    const bufEdge = await postJson('/api/reservations', { slug: restBuf.slug, name: 'Borde', phone: '59899111224', date: dayPlus, time: '20:30', pax: '2' });
    assert.strictEqual(bufEdge.status, 201, '20:30 exacto (borde >= 30) → 201');

    // Agenda del dueño: agenda del día, orden por hora, counts y anillo del Club.
    const customer = await loyaltyService.findOrCreateCustomer({ phone: marcelaPhone, name: 'Cliente Club' });
    await loyaltyService.getOrCreateAccount(customer.id, restMain.id);
    const agendaRes = await fetch(`${base}/api/reservations?date=${dayPlus}`, { headers: { Authorization: `Bearer ${ownerToken(ownerA.id)}` } });
    assert.strictEqual(agendaRes.status, 200, 'agenda del dueño → 200');
    const agenda = (await agendaRes.json()).data;
    assert.strictEqual(agenda.date, dayPlus, 'día eco');
    assert.strictEqual(agenda.allowReservations, true, 'toggle ON reflejado');
    assert.strictEqual(agenda.reservations.length, 2, 'solo las 2 reservas del día');
    assert.strictEqual(agenda.reservations[0].time, '21:00', 'orden por hora estable');
    const marcela = agenda.reservations.find(r => r.name === 'Marcela');
    assert.ok(marcela.club && marcela.club.localVisits === 0 && typeof marcela.club.level === 'string', 'anillo del Club para el teléfono con perfil (lectura, nunca crea)');
    const ruiz = agenda.reservations.find(r => r.name === 'Familia Ruiz');
    assert.strictEqual(ruiz.club, null, 'teléfono sin perfil → club null (honesto)');
    assert.ok(agenda.counts && agenda.counts.day === 2 && agenda.counts.requested === 2 && agenda.counts.pending === 2, 'counts del día + pending global');
    const agendaAnon = await fetch(`${base}/api/reservations?date=${dayPlus}`);
    assert.strictEqual(agendaAnon.status, 401, 'agenda anónima → 401');

    // Máquina de estados vía PATCH: transición feliz, self prohibida, terminal.
    const hdrA = { Authorization: `Bearer ${ownerToken(ownerA.id)}`, ...json };
    const confirmRes = await patchJson(`/api/reservations/${happy.id}`, { status: 'confirmed' }, hdrA);
    assert.strictEqual(confirmRes.status, 200, 'requested→confirmed → 200');
    assert.strictEqual((await confirmRes.json()).data.reservation.status, 'confirmed', 'estado persistido');
    const selfRes = await patchJson(`/api/reservations/${happy.id}`, { status: 'confirmed' }, hdrA);
    assert.strictEqual(selfRes.status, 409, 'confirmed→confirmed → 409 (self prohibida)');
    assert.strictEqual((await selfRes.json()).code, 'INVALID_RESERVATION_TRANSITION', 'código INVALID_RESERVATION_TRANSITION');
    const seatRes = await patchJson(`/api/reservations/${happy.id}`, { status: 'seated' }, hdrA);
    assert.strictEqual(seatRes.status, 200, 'confirmed→seated → 200');
    const afterSeat = await patchJson(`/api/reservations/${happy.id}`, { status: 'cancelled' }, hdrA);
    assert.strictEqual(afterSeat.status, 409, 'seated→cancelled → 409 (terminal)');
    const weird = await patchJson(`/api/reservations/${happy.id}`, { status: 'weird' }, hdrA);
    assert.strictEqual(weird.status, 400, 'estado desconocido → 400');
    assert.strictEqual((await weird.json()).code, 'INVALID_RESERVATION_STATUS', 'código INVALID_RESERVATION_STATUS');

    // Cancelación con motivo en una reserva que sigue requested.
    const cancelRes = await patchJson(`/api/reservations/${big.id}`, { status: 'cancelled', cancelReason: 'Mesa reservada para evento' }, hdrA);
    assert.strictEqual(cancelRes.status, 200, 'confirmed... requested→cancelled → 200');
    const cancelled = (await cancelRes.json()).data.reservation;
    assert.strictEqual(cancelled.status, 'cancelled', 'estado cancelled');
    assert.strictEqual(cancelled.cancelReason, 'Mesa reservada para evento', 'motivo persistido');

    // Aislamiento: la reserva ajena es 404 (no 403 — no se enumera).
    const cross = await patchJson(`/api/reservations/${happy.id}`, { status: 'confirmed' }, { Authorization: `Bearer ${ownerToken(ownerB.id)}`, ...json });
    assert.strictEqual(cross.status, 404, 'cross-tenant → 404 RESERVATION_NOT_FOUND');
    assert.strictEqual((await cross.json()).code, 'RESERVATION_NOT_FOUND', 'código RESERVATION_NOT_FOUND');
    const unknown = await patchJson('/api/reservations/resv_inexistente', { status: 'confirmed' }, hdrA);
    assert.strictEqual(unknown.status, 404, 'id desconocido → 404');
    const patchAnon = await patchJson(`/api/reservations/${happy.id}`, { status: 'confirmed' });
    assert.strictEqual(patchAnon.status, 401, 'PATCH anónimo → 401');

    // Agenda tras la máquina: counts exactos del día.
    const agenda2 = (await (await fetch(`${base}/api/reservations?date=${dayPlus}`, { headers: { Authorization: `Bearer ${ownerToken(ownerA.id)}` } })).json()).data;
    assert.deepStrictEqual(
      { requested: agenda2.counts.requested, confirmed: agenda2.counts.confirmed, seated: agenda2.counts.seated, cancelled: agenda2.counts.cancelled, noShow: agenda2.counts.noShow },
      { requested: 0, confirmed: 0, seated: 1, cancelled: 1, noShow: 0 },
      'counts reflejan la máquina completa'
    );
    assert.strictEqual(agenda2.counts.pending, 0, 'pending global 0 tras operarlas todas');
    // La reserva liberada por cancelación abre lugar de nuevo en su franja.
    const refill = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Volvió', phone: '59899111998', date: dayPlus, time: '21:00', pax: '2'
    });
    assert.strictEqual(refill.status, 201, 'cancelar libera franja (solo queda la sentada, terminal no bloquea slot)');

    // Privilegio: el save del Studio NO puede crear ni pisar `reservations`.
    const evilSave = await fetch(`${base}/api/studio/save`, {
      method: 'POST',
      headers: hdrA,
      body: JSON.stringify({
        name: restMain.name,
        allowReservations: true,
        reservations: [{ id: 'fake_resv_studio', status: 'confirmed', name: 'Falso' }]
      })
    });
    assert.strictEqual(evilSave.status, 200, 'save del Studio → 200');
    const afterEvil = db.findRestaurantBySlug(restMain.slug);
    assert.ok(!afterEvil.reservations || !afterEvil.reservations.some(r => r.id === 'fake_resv_studio'), 'el save NO creó la reserva falsa (SERVER-OWNED)');
    const fakeInAgenda = agenda2.reservations.some(r => r.id === 'fake_resv_studio') ||
      ((await (await fetch(`${base}/api/reservations?date=${dayPlus}`, { headers: { Authorization: `Bearer ${ownerToken(ownerA.id)}` } })).json()).data.reservations.some(r => r.id === 'fake_resv_studio'));
    assert.strictEqual(fakeInAgenda, false, 'la agenda tampoco muestra el fake');
    console.log('✓ §2 runtime: 201 pública, capacidad 409 (slot/buffer), agenda+club, máquina PATCH, privilegio /save');

    // ── §3 Cron real hermético ──────────────────────────────────────────────────
  console.log('\n── §3 Cron de recordatorios (reloj congelado + outbox) ──────────');
  {
    const ownerC = await makeUser('res-owner-c');
    fixtureUserIds.push(ownerC.id);
    const restCand = await db.saveRestaurant(ownerC.id, {
      name: 'Reservas Cron', bizName: 'Reservas Cron',
      slug: `reservas-cron-${STAMP}`, utcOffsetMinutes: -180, dishes: [], categories: []
    });
    fixtureRestIds.push(restCand.id);
    const ownerDemo = await makeUser('res-owner-demo');
    fixtureUserIds.push(ownerDemo.id);
    const restDemo = await db.saveRestaurant(ownerDemo.id, {
      name: 'Reservas Demo', bizName: 'Reservas Demo',
      slug: `reservas-cron-demo-${STAMP}`, utcOffsetMinutes: -180, dishes: [], categories: [], isDemo: true
    });
    fixtureRestIds.push(restDemo.id);

    const iso = new Date().toISOString();
    // Alta por el camino REAL (addReservation + máquina de estados del mutex).
    const mkSeed = async (rest, extra) => {
      const id = `resv_${STAMP}_${extra.tag}`;
      const add = await db.addReservation(rest.id, {
        id, name: extra.name || 'Ana', phone: extra.phone, email: extra.email,
        date: extra.date, time: extra.time, pax: 2, status: 'requested', source: 'menu',
        createdAt: iso, statusUpdatedAt: iso
      });
      assert.ok(add.success, `seed ${extra.tag} agregada`);
      if (extra.confirm) {
        const up = await db.updateReservationStatus(rest.id, id, { status: 'confirmed' }, iso);
        assert.ok(up.success, `seed ${extra.tag} confirmada (máquina real)`);
      }
      return id;
    };
    const resA = await mkSeed(restCand, { tag: 'a', phone: '59899111001', email: 'ana-reminder@example.com', date: '2026-01-15', time: '21:00', confirm: true });  // 24h → dentro, con email
    const resB = await mkSeed(restCand, { tag: 'b', phone: '59899111002', date: '2026-01-15', time: '20:00', confirm: true });                                     // 23h → dentro, SIN email
    await mkSeed(restCand, { tag: 'c', phone: '59899111003', date: '2026-01-15', time: '21:30', confirm: false });                                                  // requested → fuera
    await mkSeed(restCand, { tag: 'd', phone: '59899111004', date: '2026-01-15', time: '21:45', confirm: true });                                                  // confirmada...
    await db.updateReservationStatus(restCand.id, `resv_${STAMP}_d`, { status: 'cancelled' }, iso);                                                                // ...luego cancelada → fuera
    await mkSeed(restCand, { tag: 'e', phone: '59899111005', date: '2026-01-14', time: '23:00', confirm: true });                                                   // +2h → fuera
    await mkSeed(restDemo, { tag: 'f', phone: '59899111006', email: 'demo@example.com', date: '2026-01-15', time: '21:00', confirm: true });                        // demo → fuera

    // Cron auth fail-closed: sin header → 401, header errado → 401.
    const cronUrl = `${base}/api/cron/reservation-reminders?nowMs=${FIXED_NOW_MS}`;
    const noAuth = await fetch(cronUrl);
    assert.strictEqual(noAuth.status, 401, 'cron sin secreto → 401');
    const wrongAuth = await fetch(cronUrl, { headers: { 'x-cron-secret': 'otra-clave-errada' } });
    assert.strictEqual(wrongAuth.status, 401, 'cron con secreto errado → 401');

    // Corrida 1: sent=1 (email), NO_CHANNEL sin marcar, dedupe listo.
    outbox.length = 0;
    const run1 = await fetch(cronUrl, { headers: { 'x-cron-secret': 'test-reservations-secret' } });
    assert.strictEqual(run1.status, 200, 'cron con x-cron-secret → 200');
    const report1 = (await run1.json()).data;
    assert.strictEqual(report1.sent, 1, 'exactamente UN recordatorio enviado (el de Ana con email)');
    // considered/NO_CHANNEL son >= (las corridas individuales dejan fixtures
    // previos en el espejo: resA vieja cae ALREADY_SENT y resB vieja NO_CHANNEL
    // de nuevo — el siguiente `npm test` los purga; el número EXACTO es sent).
    assert.ok(report1.considered >= 2, `consideradas ≥ 2 (Ana + la sin email) = ${report1.considered}`);
    assert.ok(report1.skipped >= 1, `un skip o más (${report1.skipped})`);
    assert.ok(report1.reasons.NO_CHANNEL >= 1, 'la sin email y sin push → NO_CHANNEL');
    assert.ok(report1.checked >= 6, `recorre todos los locales (${report1.checked})`);
    assert.strictEqual(outbox.length, 1, 'un solo email en la outbox');
    assert.strictEqual(outbox[0].to, 'ana-reminder@example.com', 'destinatario = el email del comensal');
    assert.ok(String(outbox[0].html || '').includes('2026-01-15') && String(outbox[0].html || '').includes('21:00'), 'el email menciona fecha y hora');
    const markedA = await notificationsService.hasReservationReminder(resA);
    assert.strictEqual(markedA, true, 'la enviada quedó marcada (dedupe)');
    const markedB = await notificationsService.hasReservationReminder(resB);
    assert.strictEqual(markedB, false, 'la NO_CHANNEL NO se marca (reintenta próximas horas)');

    // Corrida 2 (mismo reloj): dedupe — sent=0, ALREADY_SENT.
    outbox.length = 0;
    const run2 = await fetch(cronUrl, { headers: { 'x-cron-secret': 'test-reservations-secret' } });
    const report2 = (await run2.json()).data;
    assert.strictEqual(report2.sent, 0, 'segunda corrida NO reenvía (dedupe)');
    assert.ok(report2.reasons.ALREADY_SENT >= 1, 'la enviada cae en ALREADY_SENT');
    assert.strictEqual(outbox.length, 0, 'cero emails duplicados');

    // Ventana acotada (solo fuera de producción): nada dentro de [0,1]h.
    const run3 = await fetch(`${base}/api/cron/reservation-reminders?nowMs=${FIXED_NOW_MS}&windowHours=0,1`, { headers: { 'x-cron-secret': 'test-reservations-secret' } });
    const report3 = (await run3.json()).data;
    assert.strictEqual(report3.considered, 0, 'ventana [0,1] acota la selección a 0');
    assert.strictEqual(report3.sent, 0, 'nada enviado fuera de ventana');
    console.log('✓ §3 cron: sent=1 + NO_CHANNEL sin marcar + dedupe + ventana inyectable + fail-closed');
  }

  // ── §4 Wiring estático + contrato ───────────────────────────────────────────
  console.log('\n── §4 Wiring estático + contrato openapi ────────────────────────');
  {
    const menuHtml = read('public/menu.html');
    const guestMode = read('public/js/menu/eventGuestMode.js');
    const menuJs = read('public/js/menu.js');
    const studioHtml = read('public/studio.html');
    const resManager = read('public/js/studio/reservationsManager.js');
    const studioJs = read('public/js/studio.js');
    const studioCss = read('public/css/studio.css');
    const contract = read('openapi.yaml');
    const contractTest = read('tests/test-openapi-contract.js');

    // CSP: cero on*= en TODO lo nuevo (la suite global escanea public/ completa).
    assert.ok(!/\son[a-z]+\s*=/i.test(menuHtml), 'menu.html sin atributos on*=');
    assert.ok(!/\bon(click|submit|change)\s*=/i.test(guestMode), 'eventGuestMode.js sin on*=');
    assert.ok(!/on(click|load|error)\s*=/i.test(resManager), 'reservationsManager.js sin on*=');

    // Render DOM API: cero innerHTML con data del comensal.
    assert.ok(!/innerHTML/.test(guestMode), 'eventGuestMode.js renderiza con textContent (cero innerHTML)');
    assert.ok(!/innerHTML\s*=/.test(resManager), 'reservationsManager.js renderiza con createElement/textContent (sin asignar innerHTML)');
    assert.ok(/createElement\(/.test(resManager) && /textContent/.test(resManager), 'reservationsManager.js usa DOM API');

    // Diálogos: el cancel/no_show del Studio usa showConfirmDialog (promesa).
    assert.ok(/showConfirmDialog/.test(resManager), 'cancel/no_show vía showConfirmDialog (promesa)');
    assert.ok(!/window\.confirm\s*\(/.test(resManager) && !/\balert\s*\(/.test(resManager), 'reservationsManager.js sin confirm/alert nativos');

    // Comensal: modal con phone obligatorio, email opcional y panel de éxito.
    assert.ok(/id="reservationModal"/.test(menuHtml), 'modal de reserva presente');
    assert.ok(/data-js-submit="submitReservation\|event"/.test(menuHtml), 'submit vía data-js-* (CSP-safe)');
    assert.ok(/id="resPhone"[^>]*required/.test(menuHtml), 'resPhone required');
    assert.ok(/id="resEmail"/.test(menuHtml) && /id="resDate"/.test(menuHtml), 'email opcional + fecha');
    assert.ok(/id="resSuccessBox"/.test(menuHtml) && /id="resSuccessWaBtn"/.test(menuHtml) && /id="resSuccessDoneBtn"/.test(menuHtml), 'panel de éxito con botón WhatsApp + Listo');
    assert.ok(/id="resFormMsg"[^>]*role="alert"/.test(menuHtml), 'error honesto con role=alert');

    // Flujo real en eventGuestMode + wrapper en menu.js con ctx inyectado.
    assert.ok(/async\s+function\s+submitReservation/.test(guestMode), 'submitReservation async (espera el POST real)');
    assert.ok(/['"]\/api\/reservations['"]/.test(guestMode), 'POST real a /api/reservations');
    assert.ok(/buildReservationWaUrl/.test(guestMode) && /wireReservationSuccessActions/.test(guestMode), 'WhatsApp DESPUÉS del éxito (sin carrera de popup blocker)');
    assert.ok(/resetReservationForm/.test(guestMode) && /showReservationError/.test(guestMode), 'reset + error honesto');
    assert.ok(/getCaptchaToken/.test(guestMode), 'captcha del pedido reutilizado vía ctx');
    assert.ok(/submitReservation\(/.test(menuJs) && /getCaptchaToken/.test(menuJs), 'menu.js pasa getCaptchaToken/showToast por ctx');

    // Studio: tab, agenda, date input data-driven, manager y wiring.
    assert.ok(/data-js-click="switchTab\|reservas"/.test(studioHtml), 'botón de tab Reservas');
    assert.ok(/id="tab-reservas"/.test(studioHtml), 'panel de reservas');
    assert.ok(/data-js-change="changeReservationsDate\|this\.value"/.test(studioHtml), 'date input data-driven');
    assert.ok(/id="reservationsList"/.test(studioHtml) && /id="reservationsCounts"/.test(studioHtml), 'listado + counts');
    assert.ok(/allowedActions/.test(resManager), 'máquina de estados espejo en el Studio');
    assert.ok(/id="res-status-chip"|\.res-status-chip/.test(studioCss), 'CSS del chip de estado');
    assert.ok(/from\s+'\.\.\/\.\.\/js\/studio\/reservationsManager\.js'|from\s+'\.\/studio\/reservationsManager\.js'/.test(studioJs), 'studio.js importa reservationsManager');
    assert.ok(/tabId\s*===\s*'reservas'/.test(studioJs), 'switchTab carga la agenda al entrar');
    assert.ok(/loadReservations/.test(studioJs), 'exports en window (globalExports)');
    assert.ok(/isDemo/.test(guestMode), 'demo mantiene flujo WhatsApp puro client-side');

    // Contrato: 3 paths + schemas en el spec y en el test de contrato.
    assert.ok(/\/api\/reservations:/.test(contract), 'path POST/GET /api/reservations en el spec');
    assert.ok(/\/api\/reservations\/\{id\}:/.test(contract), 'path PATCH /api/reservations/{id} en el spec');
    assert.ok(/Reservation:/.test(contract) && /ReservationClub:/.test(contract), 'schemas Reservation/ReservationClub');
    assert.ok(/- name: reservations/.test(contract), 'tag reservations');
    assert.ok(contractTest.includes("'/api/reservations'") && contractTest.includes("'/api/reservations/{id}'"), 'SPEC_PATHS del test de contrato incluye reservas');
    console.log('✓ §4 wiring + contrato: comensal, Studio, CSS y openapi.yaml consistentes');
  }

  console.log('\n✅ Reservas de verdad + recordatorio 24h: TODOS los asserts pasaron');
  } finally {
    // Restaurar email real + entorno SIEMPRE (la outbox queda viva durante §3).
    emailService.sendEmail = realSendEmail;
    if (savedEnv.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = savedEnv.RESEND_API_KEY;
    if (savedEnv.VAPID_PUBLIC_KEY === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = savedEnv.VAPID_PUBLIC_KEY;
    if (savedEnv.VAPID_PRIVATE_KEY === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = savedEnv.VAPID_PRIVATE_KEY;
    if (savedEnv.CRON_SECRET === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedEnv.CRON_SECRET;
  }
}

/** Token JWT directo (mismo patrón que test-kitchen: sesión del dueño sin login). */
function ownerToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
}

runTests()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Fallo en test-reservations:', e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  });
