/**
 * tests/test-reservations-v2.js — Reservas v2 (69ª suite, oct-2026)
 *
 * Cierra lo que la 65ª dejó documentado como límites:
 *  §1 Módulo puro extendido — teléfonos NACIONALES del comensal
 *     (normalizeReservationPhone con countryPrefix derivado del teléfono del
 *     local, '099 123 456' → '59899123456'), deriveCountryCodeFromPhone,
 *     sanitizeReservationConfig (config UI del dueño: ABSENT si basura,
 *     clamp con la MISMA tabla de rangos) y parseReservationInput que respeta
 *     maxPax/maxAdvanceDays del dueño (400 honestos).
 *  §2 Runtime real — alta atómica por franja (el 3er POST a un slot de 2 →
 *     409 SLOT_UNAVAILABLE), DOS POSTs SIMULTÁNEOS con maxPerSlot:1 →
 *     exactamente [201, 409] (la franja no se sobrecarga), buffer 30 min
 *     entre horas (20:15 rechazado, 20:30 exacto pasa), y ciclo de vida al
 *     comensal por email (confirmed / cancelled+motivo / no_show) en outbox
 *     sobre el sendEmail REAL.
 *  §3 Probe cloud — RPC `claim_reservation_slot` (migración 011): restaurante
 *     fantasma → degradación honesta; con cloud, claim real (mode 'cloud') o
 *     SKIP informado si la migración aún no está aplicada. Mutación cloud
 *     acotada a fixtures @example.com (los purga el próximo npm test).
 *  §4 Wiring — reservationConfig sobrevive /api/studio/save (NO es
 *     privilegiado), Studio con inputs con labels (a11y), route conecta el
 *     claim (slotInput) y openapi.yaml documenta la v2.
 *
 * Cero mocks: server HTTP real + store local real. Standalone deja residuo
 * fixture (@example.com) que el guard del próximo `npm test` purga.
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
const { stripPrivilegedFields } = require('../api/utils/stripPrivilegedFields');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const STAMP = Date.now();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Probe cloud (gated a credenciales): espera acotada a que el dual-write
//    fire-and-forget (trackSupabaseWrite) haga visible una fila. La usan la
//    carrera de §2c y el claim de §3 — SOLO cuando hay cloud.
const SUPABASE_URL_ENV = process.env.SUPABASE_URL;
const SUPABASE_KEY_ENV = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const cloudOn = Boolean(SUPABASE_URL_ENV && SUPABASE_KEY_ENV);
const sbProbe = cloudOn
  ? (() => {
      const { createClient } = require('@supabase/supabase-js');
      return createClient(SUPABASE_URL_ENV, SUPABASE_KEY_ENV, { auth: { persistSession: false } });
    })()
  : null;
const waitCloudRow = async (table, id) => {
  if (!sbProbe) return false;
  for (let i = 0; i < 40; i++) {
    const { data: row } = await sbProbe.from(table).select('id').eq('id', id).maybeSingle();
    if (row) return true;
    await wait(250);
  }
  return false;
};

async function runTests() {
  console.log('🧪 Iniciando prueba de Reservas v2 (capacidad atómica + ciclo de vida)...');

  // ── §1 Módulo puro ──────────────────────────────────────────────────────────
  console.log('\n── §1 Módulo puro api/utils/reservations.js (v2) ─────────────────');
  {
    const NOW = Date.parse('2026-01-15T12:00:00.000Z');
    const OFF = -180; // UY: local = UTC − 3h
    const base = { name: 'Ana', phone: '59899123456', date: '2026-01-16', time: '21:00', pax: '2' };

    // ── Teléfono NACIONAL del comensal: el código del local completa ──
    assert.strictEqual(
      reservations.normalizeReservationPhone('099 123 456', { countryPrefix: '598' }),
      '59899123456', 'trunk nacional 0NN… se despeluda y se prefija'
    );
    assert.strictEqual(
      reservations.normalizeReservationPhone('99123456', { countryPrefix: '598' }),
      '59899123456', 'nacional corto sin 0 → se prefija'
    );
    assert.strictEqual(
      reservations.normalizeReservationPhone('+598 99 123 456', { countryPrefix: '598' }),
      '59899123456', 'ya completo → intacto (nunca re-prefija)'
    );
    assert.strictEqual(
      reservations.normalizeReservationPhone('00598 99 123 456', { countryPrefix: '598' }),
      '59899123456', 'prefijo internacional 00 se quita (backfill #9)'
    );
    assert.strictEqual(
      reservations.normalizeReservationPhone('1-555-123-4567', { countryPrefix: '598' }),
      '15551234567', 'E.164 largo de otro país → se respeta sin inventar'
    );
    assert.strictEqual(
      reservations.normalizeReservationPhone('099123456'),
      '099123456', 'sin countryPrefix → comportamiento v1 (solo dígitos)'
    );
    assert.strictEqual(reservations.normalizeReservationPhone('123'), '', 'demasiado corto → vacío');

    // ── deriveCountryCodeFromPhone: longest-first de la lista LatAm ──
    assert.strictEqual(reservations.deriveCountryCodeFromPhone('59899123456'), '598', 'UY');
    assert.strictEqual(reservations.deriveCountryCodeFromPhone('+54 9 11 5555 4444'), '54', 'AR (de dígitos crudos)');
    assert.strictEqual(reservations.deriveCountryCodeFromPhone('5511999998888'), '55', 'BR antes que 2 dígitos');
    assert.strictEqual(reservations.deriveCountryCodeFromPhone('593991234567'), '593', '3 dígitos antes que 2 (longest-first)');
    assert.strictEqual(reservations.deriveCountryCodeFromPhone('099123456'), '', 'nacional sin prefijo → vacío');
    assert.strictEqual(reservations.deriveCountryCodeFromPhone('4412345678'), '', 'fuera de LatAm → vacío (honesto)');
    assert.strictEqual(reservations.deriveCountryCodeFromPhone(''), '', 'vacío → vacío');

    // ── parseReservationInput respeta la config del dueño ──
    const pax15 = reservations.parseReservationInput({ ...base, pax: '15' }, { nowMs: NOW, utcOffsetMinutes: OFF, config: { maxPax: 12 } });
    assert.strictEqual(pax15.ok, false, 'pax > maxPax del dueño → rechazo');
    assert.strictEqual(pax15.errors[0].code, 'RESERVATION_PAX_INVALID', 'código RESERVATION_PAX_INVALID');
    assert.strictEqual(
      reservations.parseReservationInput({ ...base, pax: '12' }, { nowMs: NOW, utcOffsetMinutes: OFF, config: { maxPax: 12 } }).ok,
      true, 'pax === maxPax pasa (borde inclusivo)'
    );
    const far40 = reservations.parseReservationInput(
      { ...base, date: '2026-02-24' }, { nowMs: NOW, utcOffsetMinutes: OFF, config: { maxAdvanceDays: 30 } }
    );
    assert.strictEqual(far40.ok, false, 'fecha > maxAdvanceDays → rechazo');
    assert.strictEqual(far40.errors[0].code, 'RESERVATION_DATE_TOO_FAR', 'código RESERVATION_DATE_TOO_FAR');
    assert.strictEqual(
      reservations.parseReservationInput({ ...base, date: '2026-02-14' }, { nowMs: NOW, utcOffsetMinutes: OFF, config: { maxAdvanceDays: 30 } }).ok,
      true, 'fecha === maxAdvanceDays pasa (borde inclusivo)'
    );

    // ── teléfonos nacionales en el PARSEO: el route deriva el prefijo del local ──
    const nacional = reservations.parseReservationInput(
      { name: 'Nacho', phone: '099 123 456', date: '2026-01-16', time: '21:00', pax: '2' },
      { nowMs: NOW, utcOffsetMinutes: OFF, countryPrefix: '598' }
    );
    assert.strictEqual(nacional.ok, true, 'teléfono nacional parsea ok');
    assert.strictEqual(nacional.value.phone, '59899123456', 'alta con 099… queda completa (wa.me ruteable)');

    // ── sanitizeReservationConfig: ABSENT si basura, clamp con la MISMA tabla ──
    const clamp = reservations.sanitizeReservationConfig({ maxPerSlot: '6', slotBufferMinutes: -5, maxPax: 8.4, maxAdvanceDays: 'x' });
    assert.deepStrictEqual(clamp, { maxPerSlot: 6, slotBufferMinutes: 0, maxPax: 8 }, 'clamp + campo ABSENT si basura');
    assert.strictEqual(reservations.sanitizeReservationConfig({}), undefined, 'bloque vacío → ABSENT (nunca {})');
    assert.strictEqual(reservations.sanitizeReservationConfig('perro'), undefined, 'basura → ABSENT');
    assert.strictEqual(reservations.sanitizeReservationConfig(null), undefined, 'null → ABSENT');
    const over = reservations.sanitizeReservationConfig({ maxPerSlot: 0, slotBufferMinutes: 999, maxPax: 0, maxAdvanceDays: 9999 });
    assert.deepStrictEqual(over, { maxPerSlot: 1, slotBufferMinutes: 240, maxPax: 1, maxAdvanceDays: 365 }, 'clamp a los rangos canónicos');
    // idempotencia round-trip: sanitize(resolve(...)) estable (resolve rellena
    // defaults y el sanitizer los conserva — nunca cambia una 2ª pasada).
    const resolved = reservations.resolveReservationConfig(clamp);
    assert.deepStrictEqual(reservations.sanitizeReservationConfig(resolved), resolved, 'round-trip idempotente');
    assert.deepStrictEqual(
      reservations.sanitizeReservationConfig(reservations.resolveReservationConfig(over)),
      reservations.resolveReservationConfig(over),
      'round-trip idempotente con valores clampeados'
    );
    assert.deepStrictEqual(
      reservations.resolveReservationConfig({}),
      { maxPerSlot: 4, slotBufferMinutes: 30, maxPax: 12, maxAdvanceDays: 60 },
      'defaults server-side intactos con config ABSENT'
    );
    console.log('✓ §1 módulo puro: teléfonos nacionales, derive de país, config UI y parseo con límites del dueño');
  }

  // ── Server + entorno hermético para §2/§3 ───────────────────────────────────
  const savedEnv = {
    RESEND_API_KEY: Object.prototype.hasOwnProperty.call(process.env, 'RESEND_API_KEY') ? process.env.RESEND_API_KEY : undefined,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY
  };
  delete process.env.RESEND_API_KEY;   // sendEmail cae a local_mock: cero tráfico externo
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;

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
  const getJson = (url, headers = json) => fetch(`${base}${url}`, { headers });

  const fixtureUserIds = [];
  const makeUser = (tag) => db.createUser({
    email: `${tag}-${STAMP}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const ownerToken = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
  const authHeaders = (userId) => ({ ...json, Authorization: `Bearer ${ownerToken(userId)}` });

  try {
    // ── §2 Runtime real ──────────────────────────────────────────────────────
    console.log('\n── §2 Runtime real (server HTTP + store) ────────────────────────');
    // OJO (gotcha db.saveRestaurant): UN restaurante por userId — la 2ª llamada
    // con el mismo dueño Object.assign al doc existente (cambia slug/config).
    // Cada local fixture lleva su PROPIO dueño (patrón 65ª).
    const ownerA = await makeUser('resv2-owner-a');
    fixtureUserIds.push(ownerA.id);
    const ownerCfg = await makeUser('resv2-owner-cfg');
    fixtureUserIds.push(ownerCfg.id);
    const ownerConc = await makeUser('resv2-owner-conc');
    fixtureUserIds.push(ownerConc.id);

    const dayPlus = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10); // siempre futuro

    // restMain: capacidad 2 por franja (buffer default 30) + teléfono del local
    // del que la route deriva el prefijo de país.
    const restMain = await db.saveRestaurant(ownerA.id, {
      name: 'Restaurante Reservas V2', bizName: 'Restaurante Reservas V2',
      slug: `reservas-v2-main-${STAMP}`, utcOffsetMinutes: -180,
      phone: '+598 99 555 111', dishes: [], categories: [],
      reservationConfig: { maxPerSlot: 2 }
    });

    // ── Alta con teléfono NACIONAL: el server completa con el código del local ──
    const nat = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Nacho', phone: '099 123 456',
      date: dayPlus, time: '21:00', pax: '2'
    });
    assert.strictEqual(nat.status, 201, 'alta con teléfono nacional → 201');
    assert.strictEqual((await nat.json()).data.reservation.phone, '59899123456', '099… se completa con el prefijo del local (598)');

    // ── Capacidad atómica: 2 activas llenan el slot de 2; la 3ª → 409 ──
    const slot2 = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Berta', phone: '59899123457', date: dayPlus, time: '21:00', pax: '2'
    });
    assert.strictEqual(slot2.status, 201, '2ª de la franja → 201');
    const slot3 = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Carlos', phone: '59899123458', date: dayPlus, time: '21:00', pax: '2'
    });
    assert.strictEqual(slot3.status, 409, '3ª a la misma hora (maxPerSlot 2) → 409');
    assert.strictEqual((await slot3.json()).code, 'SLOT_UNAVAILABLE', 'código público único SLOT_UNAVAILABLE');

    // ── Buffer: SOLO entre horas distintas; la misma hora la gobierna el slot ──
    const b1 = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Diego', phone: '59899123459', date: dayPlus, time: '20:00', pax: '2'
    });
    assert.strictEqual(b1.status, 201, '20:00 → 201 (otra hora)');
    const b2 = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Elena', phone: '59899123460', date: dayPlus, time: '20:15', pax: '2'
    });
    assert.strictEqual(b2.status, 409, '20:15 dentro del buffer de 30 min → 409');
    assert.strictEqual((await b2.json()).code, 'SLOT_UNAVAILABLE', 'buffer también colapsa a SLOT_UNAVAILABLE (no filtra geometría)');
    const b3 = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Fabio', phone: '59899123461', date: dayPlus, time: '20:30', pax: '2'
    });
    assert.strictEqual(b3.status, 201, '20:30 exacto (borde del buffer) → pasa');
    console.log('✓ §2a capacidad: slot lleno → 409, buffer 20:15 fuera / 20:30 borde pasa, teléfono nacional completado');

    // ── Límites del dueño en runtime: maxPax y maxAdvanceDays → 400 honestos ──
    const restCfg = await db.saveRestaurant(ownerCfg.id, {
      name: 'Restaurante Config', bizName: 'Restaurante Config',
      slug: `reservas-v2-cfg-${STAMP}`, utcOffsetMinutes: -180,
      dishes: [], categories: [],
      reservationConfig: { maxPax: 6, maxAdvanceDays: 30 }
    });
    const tooMany = await postJson('/api/reservations', {
      slug: restCfg.slug, name: 'Gorka', phone: '59899123462', date: dayPlus, time: '21:00', pax: '8'
    });
    assert.strictEqual(tooMany.status, 400, 'pax 8 > maxPax 6 del dueño → 400');
    assert.strictEqual((await tooMany.json()).code, 'RESERVATION_PAX_INVALID', 'código RESERVATION_PAX_INVALID');
    const farDate = await postJson('/api/reservations', {
      slug: restCfg.slug, name: 'Hana', phone: '59899123463',
      date: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10), time: '21:00', pax: '2'
    });
    assert.strictEqual(farDate.status, 400, 'fecha a 45 días > maxAdvanceDays 30 → 400');
    assert.strictEqual((await farDate.json()).code, 'RESERVATION_DATE_TOO_FAR', 'código RESERVATION_DATE_TOO_FAR');
    console.log('✓ §2b límites del dueño en runtime: maxPax/maxAdvanceDays → 400 honestos');

    // ── CONCURRENCIA: dos POSTs simultáneos con maxPerSlot:1 → [201, 409] ──
    const restConc = await db.saveRestaurant(ownerConc.id, {
      name: 'Restaurante Carrera', bizName: 'Restaurante Carrera',
      slug: `reservas-v2-conc-${STAMP}`, utcOffsetMinutes: -180,
      dishes: [], categories: [],
      reservationConfig: { maxPerSlot: 1 }
    });
    if (cloudOn) {
      // Con la 011 activa, la carrera la decide la RPC (advisory lock): la fila
      // cloud del fixture debe estar visible ANTES para que AMBOS POSTs vayan
      // por el MISMO camino (claim cloud). Un mixto — A local (fila aún
      // invisible) + B cloud — puede dejar 2×201: el whole-doc write de A no
      // aterrizó cuando la RPC de B contó la franja. Con la fila presente, la
      // RPC serializa y da exactamente [201, 409].
      assert.ok(await waitCloudRow('restaurants', restConc.id), 'fila cloud de la carrera visible antes del race (claim único)');
    }
    const raceBody = () => ({
      slug: restConc.slug, name: 'Corredor', phone: '59899123464',
      date: dayPlus, time: '21:30', pax: '2'
    });
    const [rA, rB] = await Promise.all([postJson('/api/reservations', raceBody()), postJson('/api/reservations', raceBody())]);
    const raceStatuses = [rA.status, rB.status].sort((x, y) => x - y);
    assert.deepStrictEqual(raceStatuses, [201, 409], 'carrera simultánea: UNA gana 201, la otra 409 — la franja NUNCA queda con 2');
    const third = await postJson('/api/reservations', raceBody());
    assert.strictEqual(third.status, 409, 'la franja sigue llena después de la carrera');
    console.log('✓ §2c carrera: 2 POSTs simultáneos + maxPerSlot:1 → exactamente [201, 409] (atómica real)');

    // ── Ciclo de vida al comensal: emails del PATCH (outbox, fire-and-forget) ──
    const guestA = `ciclomail-a-${STAMP}@example.com`;
    const guestB = `ciclomail-b-${STAMP}@example.com`;
    const lifeA = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Ivana', phone: '59899123465', email: guestA,
      date: dayPlus, time: '19:30', pax: '2'
    });
    assert.strictEqual(lifeA.status, 201, 'alta del ciclo A → 201');
    const resvA = (await lifeA.json()).data.reservation;

    const outboxFor = (to) => outbox.filter((m) => m.to === to);
    const beforeConfirm = outboxFor(guestA).length;
    await wait(150); // los fire-and-forget de altas anteriores ya resolvieron
    outbox.length = 0;

    const confirmA = await patchJson(`/api/reservations/${resvA.id}`, { status: 'confirmed' }, authHeaders(ownerA.id));
    assert.strictEqual(confirmA.status, 200, 'PATCH confirm → 200');
    await wait(300);
    const confirmMails = outboxFor(guestA);
    assert.strictEqual(confirmMails.length, 1, 'confirm → EXACTAMENTE 1 email al comensal');
    assert.ok(/Reserva confirmada/.test(confirmMails[0].subject), 'subject de confirmada');
    assert.ok(confirmMails[0].html.includes('19:30'), 'el email lleva la hora de la reserva');
    outbox.length = 0;

    const noShowA = await patchJson(`/api/reservations/${resvA.id}`, { status: 'no_show' }, authHeaders(ownerA.id));
    assert.strictEqual(noShowA.status, 200, 'confirmed → no_show → 200');
    await wait(300);
    const noShowMails = outboxFor(guestA);
    assert.strictEqual(noShowMails.length, 1, 'no_show → 1 email');
    assert.ok(/No te vimos/.test(noShowMails[0].subject), 'subject de no_show');
    outbox.length = 0;

    const terminalRetry = await patchJson(`/api/reservations/${resvA.id}`, { status: 'seated' }, authHeaders(ownerA.id));
    assert.strictEqual(terminalRetry.status, 409, 'terminal no_show sin ida y vuelta → 409');
    await wait(300);
    assert.strictEqual(outboxFor(guestA).length, 0, 'transición inválida NO dispara email');

    // Cancel con motivo → el email lleva el motivo del dueño
    const lifeB = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Julio', phone: '59899123466', email: guestB,
      date: dayPlus, time: '22:30', pax: '2'
    });
    assert.strictEqual(lifeB.status, 201, 'alta del ciclo B → 201');
    const resvB = (await lifeB.json()).data.reservation;
    await wait(150);
    outbox.length = 0;

    const cancelB = await patchJson(`/api/reservations/${resvB.id}`, { status: 'cancelled', cancelReason: 'Motivo de prueba' }, authHeaders(ownerA.id));
    assert.strictEqual(cancelB.status, 200, 'PATCH cancel → 200');
    await wait(300);
    const cancelMails = outboxFor(guestB);
    assert.strictEqual(cancelMails.length, 1, 'cancel → 1 email');
    assert.ok(/Reserva cancelada/.test(cancelMails[0].subject), 'subject de cancelada');
    assert.ok(cancelMails[0].html.includes('Motivo de prueba'), 'el email lleva el motivo del cancel');
    outbox.length = 0;

    // Comensal SIN email: el PATCH NO dispara nada y no rompe
    const lifeC = await postJson('/api/reservations', {
      slug: restMain.slug, name: 'Karina', phone: '59899123467', date: dayPlus, time: '23:30', pax: '2'
    });
    assert.strictEqual(lifeC.status, 201, 'alta sin email → 201');
    const resvC = (await lifeC.json()).data.reservation;
    await wait(150);
    outbox.length = 0;

    const confirmC = await patchJson(`/api/reservations/${resvC.id}`, { status: 'confirmed' }, authHeaders(ownerA.id));
    assert.strictEqual(confirmC.status, 200, 'PATCH sin email del comensal → 200 igual');
    await wait(300);
    assert.strictEqual(outbox.length, 0, 'sin email del comensal → cero envío (sin crash)');

    // Agenda final del dueño: exactamente las reservas sembradas por franja
    const agenda = await getJson(`/api/reservations?date=${dayPlus}`, authHeaders(ownerA.id));
    assert.strictEqual(agenda.status, 200, 'agenda del dueño → 200');
    const agendaData = (await agenda.json()).data;
    const bySlot = (t) => agendaData.reservations.filter((r) => r.time === t).length;
    assert.strictEqual(bySlot('21:00'), 2, 'franja 21:00 exactamente las 2 de maxPerSlot');
    assert.strictEqual(bySlot('20:00'), 1, 'franja 20:00 con 1');
    assert.strictEqual(bySlot('20:30'), 1, 'franja 20:30 con 1');
    assert.strictEqual(agendaData.reservations.some((r) => r.id === resvA.id && r.status === 'no_show'), true, 'ciclo A quedó no_show en la agenda');
    assert.strictEqual(agendaData.reservations.some((r) => r.id === resvB.id && r.status === 'cancelled'), true, 'ciclo B quedó cancelled');
    console.log('✓ §2d ciclo de vida: emails confirm/cancel(motivo)/no_show en outbox, sin email no rompe, agenda exacta');

    // ── §3 Probe cloud — RPC claim_reservation_slot (migración 011) ─────────────
    console.log('\n── §3 Probe cloud RPC 011 (claim atómico) ──────────────────────');
  {
    // cloudOn/sbProbe/waitCloudRow viven a nivel top (los comparte §2c).

    // a) Restaurante fantasma: el claim degrada honesto y el path local
    //    falla limpio — SIN mutar nada en cloud (id throwaway).
    const ghost = await db.addReservation(
      `resv2-ghost-${STAMP}`,
      { id: `resv_ghost_${STAMP}`, date: '2026-01-16', time: '21:00', status: 'requested' },
      { config: {} }
    );
    assert.strictEqual(ghost.success, false, 'restaurante fantasma → sin éxito');
    assert.strictEqual(ghost.error, 'Restaurante no encontrado', 'degradación honesta NOT_FOUND (nunca falso 201)');
    assert.ok(!ghost.code, 'sin SLOT_UNAVAILABLE inventado para un doc inexistente');

    if (cloudOn) {
      // b) Local real dual-write → alta con slotInput: el claim 011 decide.
      //    OJO: createUser y saveRestaurant disparan su dual-write cloud
      //    fire-and-forget (trackSupabaseWrite) — el claim de §3 necesita la
      //    fila YA visible en cloud (en producción el local existe de hace
      //    días; acá esperamos con polling acotado: primero el OWNER — el
      //    insert del restaurante lleva FK user_id, si el dueño no llegó la
      //    fila del local jamás aparece —, después el restaurante).
      const ownerC = await makeUser('resv2-owner-c');
      fixtureUserIds.push(ownerC.id);
      assert.ok(await waitCloudRow('users', ownerC.id), 'owner del fixture visible en cloud (FK del restaurante)');
      const restC = await db.saveRestaurant(ownerC.id, {
        name: 'Restaurante Claim', bizName: 'Restaurante Claim',
        slug: `reservas-v2-claim-${STAMP}`, utcOffsetMinutes: -180,
        phone: '+598 99 777 222', dishes: [], categories: []
      });
      assert.ok(await waitCloudRow('restaurants', restC.id), 'dual-write del fixture visible en cloud antes del claim');

      const probeRow = (n) => ({
        id: `resv_probe_${n}_${STAMP}`, date: '2026-01-16', time: '20:00',
        pax: 2, phone: '59899123456', name: `Probe ${n}`, status: 'requested',
        createdAt: new Date().toISOString(), statusUpdatedAt: new Date().toISOString()
      });
      const s1 = await db.addReservation(restC.id, probeRow(1), { config: {}, slotInput: { date: '2026-01-16', time: '20:00' } });
      assert.strictEqual(s1.success, true, 'primer claim → alta');
      const s2 = await db.addReservation(restC.id, probeRow(2), { config: { maxPerSlot: 1 }, slotInput: { date: '2026-01-16', time: '20:00' } });
      assert.strictEqual(s2.success, false, 'segundo claim con maxPerSlot:1 → rechazado');
      assert.strictEqual(s2.code, 'SLOT_UNAVAILABLE', 'franja llena → SLOT_UNAVAILABLE (venga de cloud o del mutex)');
      if (s1.mode === 'cloud') {
        const mirror = db.findRestaurantById(restC.id);
        assert.ok(
          Array.isArray(mirror.reservations) && mirror.reservations.some((r) => r && r.id === `resv_probe_1_${STAMP}`),
          'claim cloud exitoso hidrata el espejo local (sin re-escribir el doc cloud)'
        );
        console.log('✓ §3 RPC 011 aplicada en cloud: claim real atómico + SLOT_UNAVAILABLE + espejo sin pisar');
      } else {
        console.log('⏭ §3 SKIP parcial: RPC claim_reservation_slot aún no aplicada en cloud (011 pendiente) — degradación honesta al path local verificada igual');
      }
    } else {
      console.log('⏭ §3 SKIP: sin credenciales cloud — solo se verifica la degradación honesta');
    }
  }

  // ── §4 Wiring + contrato ────────────────────────────────────────────────────
  console.log('\n── §4 Wiring + contrato ────────────────────────────────────────');
  {
    // reservationConfig NO es privilegiado: sobrevive el autosave del Studio.
    const payload = { reservationConfig: { maxPerSlot: 6, slotBufferMinutes: 15 }, allowReservations: true };
    const stripped = stripPrivilegedFields(payload);
    assert.ok(stripped.reservationConfig, 'reservationConfig sobrevive stripPrivilegedFields (es editable por el dueño)');
    assert.strictEqual(stripped.reservationConfig.maxPerSlot, 6, 'el valor viaja intacto');

    // Studio: 4 inputs de capacidad con labels asociados (a11y) y cero on*=
    const studioHtml = read('public/studio.html');
    for (const id of ['inputResvMaxPerSlot', 'inputResvSlotBuffer', 'inputResvMaxPax', 'inputResvMaxAdvance']) {
      assert.ok(studioHtml.includes(`id="${id}"`), `Studio tiene #${id}`);
      assert.ok(new RegExp(`for="${id}"`).test(studioHtml), `#${id} con label for= asociado (a11y)`);
    }
    assert.ok(/⚙️ Capacidad de reservas/.test(studioHtml), 'bloque de capacidad visible en tab Reservas');

    // studio.js: collect + load de la config (mismos ids)
    const studioJs = read('public/js/studio.js');
    assert.ok(studioJs.includes("['inputResvMaxPerSlot', 'maxPerSlot']"), 'collect mapea los 4 inputs');
    assert.ok(studioJs.includes("delete restaurant.reservationConfig"), 'vaciar TODO el bloque REMUEVE la config (defaults vuelven)');
    assert.ok(/inputResvMaxPerSlot[\s\S]{0,120}?String\(resvCfg\.maxPerSlot\)/.test(studioJs), 'load rellena el input desde la config');

    // Route conectado al claim v2
    const routeSrc = read('api/routes/reservations.js');
    assert.ok(routeSrc.includes('slotInput'), 'route pasa slotInput al alta atómica');
    assert.ok(routeSrc.includes('deriveCountryCodeFromPhone'), 'route deriva el prefijo del teléfono del local');
    assert.ok(routeSrc.includes('sendReservationStatusEmail'), 'PATCH dispara el ciclo de vida al comensal');
    assert.ok(routeSrc.includes("'SLOT_UNAVAILABLE'"), 'route mapea el 409 público');

    // db.js: el alta delega en el claim de la 011
    const dbSrc = read('src/db/db.js');
    assert.ok(dbSrc.includes('claim_reservation_slot'), 'db.js llama la RPC de la 011');
    assert.ok(dbSrc.includes('runReservationMirrorWrite'), 'espejo local tras claim (sin pisar cloud)');

    // Contrato OpenAPI
    const contract = read('openapi.yaml');
    assert.ok(/ReservationConfig:/.test(contract), 'openapi documenta ReservationConfig');
    assert.ok(/reservationConfig:\s*\r?\n\s+\$ref: '#\/components\/schemas\/ReservationConfig'/.test(contract), 'Restaurant expone reservationConfig');
    assert.ok(/claim_reservation_slot/.test(contract), 'openapi documenta la RPC 011');
    assert.ok(contract.includes('SLOT_UNAVAILABLE'), '409 SLOT_UNAVAILABLE en el contrato');

    // Cero on*= en los archivos tocados (CSP script-src-attr 'none')
    for (const [name, src] of [['studio.html', studioHtml], ['studio.js', studioJs], ['reservations.js', routeSrc]]) {
      assert.ok(!/\son(load|error|click|change|submit)\s*=/i.test(src), `${name} sin on*=`);
    }
    console.log('✓ §4 wiring: sanitizer no-privilegiado, Studio a11y-safe, route+db conectados, contrato al día');
  }

  console.log('\n✅ Reservas v2 (capacidad atómica + ciclo de vida): TODOS los asserts pasaron');
  } finally {    // Restaurar email real + entorno SIEMPRE.
    emailService.sendEmail = realSendEmail;
    if (savedEnv.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = savedEnv.RESEND_API_KEY;
    if (savedEnv.VAPID_PUBLIC_KEY === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = savedEnv.VAPID_PUBLIC_KEY;
    if (savedEnv.VAPID_PRIVATE_KEY === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = savedEnv.VAPID_PRIVATE_KEY;
    try {
      server.close();
    } catch {}
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Fallo en test-reservations-v2:', e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  });
