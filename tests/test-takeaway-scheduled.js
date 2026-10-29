/**
 * tests/test-takeaway-scheduled.js
 * ────────────────────────────────
 * Takeaway Programado V1 (73ª suite, Serie "El Sistema", oct-2026).
 *
 * El diferenciador de rotiserías/takeaway: el comensal RETIRA a una hora
 * elegida y el local puede tomar pre-orders con la cocina cerrada. La V1 se
 * apoya en lo que ya existe (openStatus, prepEstimates, kitchenColumns,
 * sumSoldByDish) y NO agrega crons ni endpoints: el checkout del menú manda
 * `scheduledFor`, el server verifica contra la grilla del local y el KDS
 * "despierta" la comanda cuando llega el momento (derivación client-side
 * sobre el polling de 20 s).
 *
 * Qué cubre esta suite:
 *   §1   Módulo puro CJS (api/utils/pickupSlots.js): constantes, sanitizer,
 *        lead explícito vs derivado de F7-v2, relojes, alineación, grilla,
 *        veredictos, copy, wake, capacidad y pureza.
 *   §1b  Paridad EXACTA CJS ↔ espejo ESM (public/js/utils/pickupSlots.js).
 *   §2   Sanitizer del local (allowPreOrders estricto + pickupConfig ABSENT).
 *   §3   Runtime REAL (server HTTP + store real, cero mocks): payload con
 *        reloj inyectado + cache key, quote/POST/track, excepción de cerrado,
 *        gates honestos, capacidad, stock re-anclado al día del retiro,
 *        F7 excluyendo programados y lead derivado, KDS wake.
 *   §4   Wiring estático + contrato + migración 013.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

const app = require('../api/index');
const db = require('../src/db/db');
const pickupSlots = require('../api/utils/pickupSlots');
const pickupService = require('../api/services/pickup');
const prepService = require('../api/services/prepEstimate');
const dailyStock = require('../api/utils/dailyStockTracker');
const nightSummary = require('../api/utils/nightSummary');
const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');
const { stripPrivilegedFields } = require('../api/utils/stripPrivilegedFields');
const { invalidateMenuCache } = require('../api/middleware/cache');
const { getSupabaseClient } = require('../api/utils/supabase');

const ROOT = path.join(__dirname, '..');
const readSource = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const hasFile = (rel) => fs.existsSync(path.join(ROOT, rel));

const T = (iso) => Date.parse(iso);
const NOW = T('2026-10-29T12:00:00.000Z'); // 09:00 en UY (UTC-3)
const OFFSET = -180;
const MIN = 60000;
const HOUR = 3600000;
const UNIQUE = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

let fixtureSeq = 0;
let seedSeq = 0;
let baseUrl = '';

// ── Helpers de red ───────────────────────────────────────────────────────────

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const url = new URL(baseUrl + urlPath);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getMenu(slug, extra = '') {
  const res = await request('GET', `/api/menu/${slug}${extra}`);
  assert.strictEqual(res.status, 200, `GET /api/menu/${slug}${extra} → ${res.status} ${res.raw.slice(0, 200)}`);
  return res.body.restaurant;
}

// ── Helpers de fixtures ──────────────────────────────────────────────────────

/**
 * Crea un local REAL (owner propio: db.saveRestaurant mantiene UN local por
 * userId) con un plato. `dishExtra` permite variantes (dailyStock, outOfStock).
 */
async function createFixture(label, overrides = {}) {
  const { dishExtra = {}, ...rest } = overrides;
  const stamp = `${UNIQUE}${++fixtureSeq}`;
  const slug = `tk${label}${stamp}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
  const user = await db.createUser({
    email: `takeaway-${label}-${stamp}@example.test`,
    password: 'test_password',
    name: `Owner ${label}`,
    email_confirmed_at: new Date().toISOString()
  });
  const catId = `cat_${stamp}`;
  const dishId = `dish_${stamp}`;
  const restaurant = await db.saveRestaurant(user.id, {
    name: `Takeaway ${label}`,
    bizName: `Takeaway ${label}`,
    slug,
    currency: '$',
    businessType: 'restaurant',
    allowMenuOrders: true,
    scheduleEnabled: false,
    scheduleActiveHours: '',
    utcOffsetMinutes: OFFSET,
    categories: [{ id: catId, name: 'Principal', icon: '🍽️' }],
    dishes: [{
      id: dishId,
      name: `Plato ${label}`,
      description: '',
      price: 10,
      categoryId: catId,
      available: true,
      ...dishExtra
    }],
    ...rest
  });
  assert.ok(restaurant && restaurant.id, `fixture ${label} creada`);
  assert.strictEqual(restaurant.slug, slug, `slug de ${label}`);
  return { label, user, restaurant, slug, catId, dishId };
}

/** Pedido sembrado directo en el espejo local (patrón F3/F7: ids únicos). */
async function seedOrder(restaurant, overrides = {}) {
  const id = `ord_seed_${UNIQUE}_${++seedSeq}`;
  const createdAt = overrides.created_at || new Date().toISOString();
  const row = {
    id,
    restaurant_id: restaurant.id,
    restaurantId: restaurant.id,
    status: 'delivered',
    order_mode: 'TAKEAWAY',
    orderMode: 'TAKEAWAY',
    amount: 10,
    total: 10,
    currency: '$',
    created_at: createdAt,
    status_updated_at: overrides.status_updated_at || createdAt,
    items_snapshot: [{ dishId: overrides.dishId || '', name: 'Plato', quantity: 1, unitPrice: 10 }],
    ...overrides
  };
  row.itemsSnapshot = row.items_snapshot;
  await db.addOrder(row);
  return row;
}

function orderBody(restaurant, dishId, overrides = {}) {
  return {
    restaurantId: restaurant.id,
    orderMode: 'TAKEAWAY',
    utcOffsetMinutes: OFFSET,
    customerName: 'Cliente Programado',
    customerPhone: '',
    items: [{ dishId, quantity: 1 }],
    ...overrides
  };
}

/** Grilla desde el reloj real (los slots de los fixtures se construyen vivos). */
function gridFor(restaurant, overrides = {}) {
  return pickupSlots.buildPickupSlots({
    scheduleActiveHours: restaurant.scheduleActiveHours,
    scheduleEnabled: restaurant.scheduleEnabled,
    utcOffsetMinutes: restaurant.utcOffsetMinutes,
    nowMs: Date.now(),
    pickupConfig: restaurant.pickupConfig,
    prepEstimateByMode: null,
    ...overrides
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('⏰ Iniciando verificación de Takeaway Programado (73ª suite)...');

  // ══════════════════════════════════════════════════════════════════════════
  // §1 · Módulo puro CJS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('  §1 módulo puro pickupSlots (CJS)...');

  assert.deepStrictEqual(pickupSlots.PICKUP_INTERVALS, [5, 10, 15, 20, 30, 60], 'intervalos canónicos');
  assert.strictEqual(pickupSlots.DEFAULT_INTERVAL_MINUTES, 15);
  assert.strictEqual(pickupSlots.DEFAULT_MAX_PER_SLOT, 4);
  assert.strictEqual(pickupSlots.MAX_LEAD_MINUTES, 240);
  assert.strictEqual(pickupSlots.MAX_MAX_PER_SLOT, 50);
  assert.strictEqual(pickupSlots.PICKUP_HORIZON_DAYS, 2);
  assert.strictEqual(pickupSlots.PICKUP_AUTO_MARGIN_MINUTES, 10);
  assert.strictEqual(pickupSlots.MAX_SLOTS, 48);
  assert.strictEqual(pickupSlots.MINUTES_PER_DAY, 1440);

  // sanitizePickupConfig: basura → null (campo ABSENT), defaults y clamps.
  assert.strictEqual(pickupSlots.sanitizePickupConfig(null), null);
  assert.strictEqual(pickupSlots.sanitizePickupConfig(undefined), null);
  assert.strictEqual(pickupSlots.sanitizePickupConfig('basura'), null);
  assert.strictEqual(pickupSlots.sanitizePickupConfig([]), null);
  assert.strictEqual(pickupSlots.sanitizePickupConfig(42), null);
  assert.deepStrictEqual(pickupSlots.sanitizePickupConfig({}), { intervalMinutes: 15, maxPerSlot: 4 });
  assert.deepStrictEqual(
    pickupSlots.sanitizePickupConfig({ intervalMinutes: 7, maxPerSlot: 999, leadMinutes: -5 }),
    { intervalMinutes: 15, maxPerSlot: 50, leadMinutes: 0 },
    'intervalo inválido → default; maxPerSlot clamp 50; lead negativo → 0'
  );
  assert.deepStrictEqual(
    pickupSlots.sanitizePickupConfig({ intervalMinutes: '20', maxPerSlot: '3', leadMinutes: '15' }),
    { intervalMinutes: 20, maxPerSlot: 3, leadMinutes: 15 },
    'strings numéricas se aceptan'
  );
  assert.deepStrictEqual(
    pickupSlots.sanitizePickupConfig({ leadMinutes: '' }),
    { intervalMinutes: 15, maxPerSlot: 4 },
    "lead '' = automático (clave ausente)"
  );
  assert.deepStrictEqual(
    pickupSlots.sanitizePickupConfig({ leadMinutes: 9999 }),
    { intervalMinutes: 15, maxPerSlot: 4, leadMinutes: 240 },
    'lead clamp 240'
  );
  assert.deepStrictEqual(
    pickupSlots.sanitizePickupConfig({ maxPerSlot: 0 }),
    { intervalMinutes: 15, maxPerSlot: 1 },
    'maxPerSlot mínimo 1'
  );
  const cfgOnce = pickupSlots.sanitizePickupConfig({ intervalMinutes: 30, maxPerSlot: 0, leadMinutes: 45 });
  assert.deepStrictEqual(pickupSlots.sanitizePickupConfig(cfgOnce), cfgOnce, 'sanitizer idempotente');

  // computeLeadMinutes: explícito gana; derivado = p50 TAKEAWAY + margen.
  assert.strictEqual(pickupSlots.computeLeadMinutes({ leadMinutes: 45 }, null), 45, 'lead explícito sin F7');
  assert.strictEqual(pickupSlots.computeLeadMinutes({ leadMinutes: 45 }, { TAKEAWAY: { p50: 20 } }), 45, 'explícito GANA');
  assert.strictEqual(pickupSlots.computeLeadMinutes({}, { TAKEAWAY: { p50: 20 } }), 30, 'p50 20 + 10 de margen');
  assert.strictEqual(pickupSlots.computeLeadMinutes({}, { TAKEAWAY: { p50: 0 } }), null, 'p50 0 no autoriza (sin evidencia)');
  assert.strictEqual(pickupSlots.computeLeadMinutes({}, { TAKEAWAY: null }), null);
  assert.strictEqual(pickupSlots.computeLeadMinutes({}, null), null);
  assert.strictEqual(pickupSlots.computeLeadMinutes(null, { LOCAL: { p50: 20 } }), null, 'solo TAKEAWAY deriva');
  assert.strictEqual(pickupSlots.computeLeadMinutes({ leadMinutes: 0 }, { TAKEAWAY: { p50: 20 } }), 0, '0 explícito vale');

  // Relojes locales.
  assert.strictEqual(pickupSlots.localMinutesOfDay(T('2026-10-29T13:30:00.000Z'), -180), 630, '10:30 local');
  assert.strictEqual(pickupSlots.localMinutesOfDay(T('2026-10-29T03:00:00.000Z'), -180), 0, 'medianoche local');
  assert.strictEqual(pickupSlots.localMinutesOfDay(T('2026-10-29T03:00:00.000Z'), 0), 180);
  assert.strictEqual(pickupSlots.localMinutesOfDay(T('2026-10-29T13:30:30.000Z'), -180), 630.5, 'segundos conservados');

  // Alineación (UNA regla para grilla y verificación).
  assert.strictEqual(pickupSlots.isAlignedSlot(T('2026-10-29T13:30:00.000Z'), -180, 15), true);
  assert.strictEqual(pickupSlots.isAlignedSlot(T('2026-10-29T13:31:00.000Z'), -180, 15), false);
  assert.strictEqual(pickupSlots.isAlignedSlot(T('2026-10-29T13:30:30.000Z'), -180, 15), false, 'con segundos NO');
  assert.strictEqual(pickupSlots.isAlignedSlot(T('2026-10-29T13:30:00.000Z'), -180, 20), false);
  assert.strictEqual(pickupSlots.isAlignedSlot(T('2026-10-29T13:40:00.000Z'), -180, 20), true);
  // Offset +330 (India) con grilla de 20: el minuto LOCAL es el que manda.
  assert.strictEqual(pickupSlots.isAlignedSlot(T('2026-10-29T07:00:00.000Z'), 330, 20), false, '12:30 local: 750 % 20 = 10 → NO alineado');
  assert.strictEqual(pickupSlots.isAlignedSlot(T('2026-10-29T07:10:00.000Z'), 330, 20), true, '12:40 local: 760 % 20 = 0 → alineado');

  // parseRange / openShiftRanges.
  assert.deepStrictEqual(pickupSlots.parseRange('10:00-12:00'), { startH: 10, endH: 12 });
  assert.deepStrictEqual(pickupSlots.parseRange('18:30-02:15'), { startH: 18.5, endH: 2.25 });
  assert.strictEqual(pickupSlots.parseRange('basura'), null);
  assert.strictEqual(pickupSlots.parseRange(''), null);
  assert.strictEqual(pickupSlots.parseRange(null), null);
  assert.deepStrictEqual(pickupSlots.openShiftRanges('', false, OFFSET, NOW), [], 'horario apagado → [] (24/7)');
  assert.deepStrictEqual(pickupSlots.openShiftRanges('10:00-12:00', false, OFFSET, NOW), [], 'scheduleEnabled false gana');
  assert.deepStrictEqual(pickupSlots.openShiftRanges('basura', true, OFFSET, NOW), [], 'franja basura → []');
  const dayRanges = pickupSlots.openShiftRanges('10:00-12:00', true, OFFSET, NOW);
  assert.strictEqual(dayRanges.length, 2, 'hoy + mañana');
  assert.deepStrictEqual(dayRanges[0], [T('2026-10-29T13:00:00.000Z'), T('2026-10-29T15:00:00.000Z')]);
  assert.deepStrictEqual(dayRanges[1], [T('2026-10-30T13:00:00.000Z'), T('2026-10-30T15:00:00.000Z')]);
  const nightRanges = pickupSlots.openShiftRanges('18:00-02:00', true, OFFSET, NOW);
  assert.deepStrictEqual(
    nightRanges[0],
    [T('2026-10-29T21:00:00.000Z'), T('2026-10-30T05:00:00.000Z')],
    'ventana nocturna cruza medianoche (fin +24h del mismo día base)'
  );
  const lateRanges = pickupSlots.openShiftRanges('23:00-00:00', true, 0, NOW);
  assert.deepStrictEqual(lateRanges[0], [T('2026-10-29T23:00:00.000Z'), T('2026-10-30T00:00:00.000Z')], '23-00 = 1h');

  // Grilla.
  const grid = pickupSlots.buildPickupSlots({
    scheduleEnabled: false,
    utcOffsetMinutes: OFFSET,
    nowMs: NOW,
    pickupConfig: { intervalMinutes: 15, leadMinutes: 30 }
  });
  assert.strictEqual(grid.length, pickupSlots.MAX_SLOTS, 'tope MAX_SLOTS');
  assert.deepStrictEqual(
    grid[0],
    { scheduledFor: '2026-10-29T12:30:00.000Z', minutes: 570, time: '09:30', dayKey: 'hoy' },
    'primer slot = now + lead, alineado, en el huso del dueño'
  );
  assert.strictEqual(grid[1].scheduledFor, '2026-10-29T12:45:00.000Z');
  assert.strictEqual(grid[1].time, '09:45');
  assert.deepStrictEqual(
    pickupSlots.buildPickupSlots({ scheduleEnabled: false, utcOffsetMinutes: OFFSET, nowMs: NOW, pickupConfig: {} }),
    [],
    'sin lead (ni explícito ni derivado) la grilla es []'
  );
  const capped = pickupSlots.buildPickupSlots({
    scheduleEnabled: false,
    utcOffsetMinutes: OFFSET,
    nowMs: NOW,
    pickupConfig: { leadMinutes: 30 },
    maxSlots: 5
  });
  assert.strictEqual(capped.length, 5, 'maxSlots respetado');
  const withSchedule = pickupSlots.buildPickupSlots({
    scheduleEnabled: true,
    scheduleActiveHours: '10:00-12:00',
    utcOffsetMinutes: OFFSET,
    nowMs: NOW,
    pickupConfig: { leadMinutes: 30 }
  });
  assert.ok(withSchedule.length > 0, 'grilla con franja');
  assert.ok(withSchedule.every((s) => s.time >= '10:00' && s.time <= '12:00'), 'todos dentro de la franja');
  // El horizonte es hoy + mañana: la franja se repite cada día, así que hoy
  // aporta 10:00→12:00 cada 15 min (9 slots) y mañana otros 9.
  assert.strictEqual(withSchedule.filter((s) => s.dayKey === 'hoy').length, 9, 'hoy: 10:00→12:00 cada 15 = 9 slots');
  assert.strictEqual(withSchedule.filter((s) => s.dayKey === 'mañana').length, 9, 'mañana: la franja se repite');

  // Veredictos.
  const verdictBase = {
    scheduleEnabled: false,
    utcOffsetMinutes: OFFSET,
    nowMs: NOW,
    pickupConfig: { intervalMinutes: 15, leadMinutes: 30 }
  };
  assert.deepStrictEqual(
    pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: '2026-10-29T12:30:00.000Z' }),
    { ok: true, reason: null, slotMinutes: 570, leadMinutes: 30 },
    'slot válido'
  );
  assert.strictEqual(pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: '' }).reason, 'MALFORMED');
  assert.strictEqual(pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: 'mañana' }).reason, 'MALFORMED');
  assert.strictEqual(pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: '2026-10-29' }).reason, 'MALFORMED');
  assert.strictEqual(
    pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: '2026-10-29T11:30:00.000Z' }).reason,
    'PAST'
  );
  const tooSoon = pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: '2026-10-29T12:15:00.000Z' });
  assert.strictEqual(tooSoon.reason, 'TOO_SOON');
  assert.strictEqual(tooSoon.leadMinutes, 30, 'el veredicto explica el lead');
  assert.strictEqual(
    pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: '2026-10-29T12:31:00.000Z' }).reason,
    'SLOT_UNAVAILABLE',
    'no alineado'
  );
  assert.strictEqual(
    pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: '2026-11-01T12:30:00.000Z' }).reason,
    'SLOT_UNAVAILABLE',
    'fuera del horizonte de 2 días'
  );
  assert.strictEqual(
    pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: '2026-10-30T12:30:00.000Z' }).ok,
    true,
    'sin horario configurado (24/7) mañana también vale: solo manda el horizonte'
  );
  assert.strictEqual(
    pickupSlots.verifyScheduledFor({
      ...verdictBase,
      pickupConfig: {},
      scheduledFor: '2026-10-29T12:30:00.000Z'
    }).reason,
    'NOT_OFFERED',
    'sin lead → el feature no opera'
  );
  assert.strictEqual(
    pickupSlots.verifyScheduledFor({ ...verdictBase, nowMs: 'basura', scheduledFor: '2026-10-29T12:30:00.000Z' }).reason,
    'SLOT_UNAVAILABLE',
    'reloj basura'
  );
  // ISO string como nowMs (patrón reloj inyectable).
  assert.strictEqual(
    pickupSlots.verifyScheduledFor({ ...verdictBase, nowMs: '2026-10-29T12:00:00.000Z', scheduledFor: '2026-10-29T12:30:00.000Z' }).ok,
    true,
    'nowMs ISO aceptado'
  );
  // Franja: dentro pasa, fuera no.
  const windowBase = {
    scheduleEnabled: true,
    scheduleActiveHours: '10:00-12:00',
    utcOffsetMinutes: OFFSET,
    nowMs: NOW,
    pickupConfig: { intervalMinutes: 15, leadMinutes: 30 }
  };
  assert.strictEqual(pickupSlots.verifyScheduledFor({ ...windowBase, scheduledFor: '2026-10-29T13:00:00.000Z' }).ok, true);
  assert.strictEqual(pickupSlots.verifyScheduledFor({ ...windowBase, scheduledFor: '2026-10-29T15:15:00.000Z' }).reason, 'SLOT_UNAVAILABLE');
  // Ventana nocturna: 23:30 local (02:30Z del día siguiente) adentro.
  const nightBase = {
    scheduleEnabled: true,
    scheduleActiveHours: '18:00-02:00',
    utcOffsetMinutes: OFFSET,
    nowMs: NOW,
    pickupConfig: { intervalMinutes: 15, leadMinutes: 30 }
  };
  assert.strictEqual(pickupSlots.verifyScheduledFor({ ...nightBase, scheduledFor: '2026-10-30T02:30:00.000Z' }).ok, true);
  assert.strictEqual(pickupSlots.verifyScheduledFor({ ...nightBase, scheduledFor: '2026-10-29T16:00:00.000Z' }).reason, 'SLOT_UNAVAILABLE');

  // Copy + AppError.
  assert.ok(pickupSlots.scheduledForVerdictMessage('MALFORMED').includes('no es válido'));
  assert.ok(pickupSlots.scheduledForVerdictMessage('PAST').includes('ya pasó'));
  assert.ok(pickupSlots.scheduledForVerdictMessage('TOO_SOON', { leadMinutes: 30 }).includes('30 min'));
  assert.ok(pickupSlots.scheduledForVerdictMessage('NOT_OFFERED').includes('no acepta retiros programados'));
  assert.ok(pickupSlots.scheduledForVerdictMessage('SLOT_UNAVAILABLE').includes('no está disponible'));
  assert.strictEqual(pickupSlots.scheduledForVerdictMessage('OTRO'), '');
  assert.strictEqual(pickupSlots.pickupVerdictError({ ok: true }), null);
  assert.strictEqual(pickupSlots.pickupVerdictError(null), null);
  const errorCases = {
    MALFORMED: 'SCHEDULED_INVALID',
    PAST: 'SCHEDULED_PAST',
    TOO_SOON: 'SCHEDULED_TOO_SOON',
    NOT_OFFERED: 'PRE_ORDERS_DISABLED',
    SLOT_UNAVAILABLE: 'SCHEDULED_SLOT_UNAVAILABLE'
  };
  for (const [reason, code] of Object.entries(errorCases)) {
    const err = pickupSlots.pickupVerdictError({ ok: false, reason, leadMinutes: 30 });
    assert.ok(err, `error para ${reason}`);
    assert.strictEqual(err.code, code, `código de ${reason}`);
    assert.strictEqual(err.statusCode, 400, 'todos los veredictos son 400');
    assert.ok(String(err.message).length > 0);
  }

  // Etiqueta local.
  assert.strictEqual(pickupSlots.localPickupLabel('2026-10-29T13:30:00.000Z', OFFSET, NOW), 'hoy 10:30 hs');
  assert.strictEqual(pickupSlots.localPickupLabel('2026-10-30T13:30:00.000Z', OFFSET, NOW), 'mañana 10:30 hs');
  assert.strictEqual(pickupSlots.localPickupLabel('2026-10-29T03:05:00.000Z', OFFSET, NOW), 'hoy 00:05 hs');
  assert.strictEqual(pickupSlots.localPickupLabel('basura', OFFSET, NOW), '');
  assert.strictEqual(pickupSlots.localPickupLabel('2026-10-29T13:30:00.000Z', OFFSET, 'basura'), '');

  // Wake (retiro − lead).
  assert.strictEqual(pickupSlots.computeWakeAt('2026-10-29T13:30:00.000Z', 30), '2026-10-29T13:00:00.000Z');
  assert.strictEqual(pickupSlots.computeWakeAt('2026-10-29T13:30:00.000Z', 0), '2026-10-29T13:30:00.000Z');
  assert.strictEqual(pickupSlots.computeWakeAt('2026-10-29T13:30:00.000Z', null), '2026-10-29T13:30:00.000Z', 'Number(null)=0');
  assert.strictEqual(pickupSlots.computeWakeAt('basura', 30), null);
  assert.strictEqual(pickupSlots.computeWakeAt('', 30), null);
  assert.strictEqual(pickupSlots.computeWakeAt('2026-10-29T13:30:00.000Z', 'basura'), null);

  // Capacidad por slot.
  const capOrders = [
    { scheduled_for: '2026-10-29T13:30:00.000Z', status: 'pending' },
    { scheduledFor: '2026-10-29T13:30:00.000Z', status: 'confirmed' },
    { scheduled_for: '2026-10-29T13:30:00.000Z', status: 'preparing' },
    { scheduled_for: '2026-10-29T13:30:00.000Z', status: 'cancelled' },
    { scheduled_for: '2026-10-29T13:30:00.000Z', status: 'delivered' },
    { scheduled_for: '2026-10-29T14:30:00.000Z', status: 'pending' },
    null,
    'basura',
    {},
    { scheduled_for: 'basura', status: 'pending' }
  ];
  assert.strictEqual(pickupSlots.countOrdersInSlot(capOrders, T('2026-10-29T13:30:00.000Z')), 3, 'activos cuentan; cancelados/entregados no');
  assert.strictEqual(pickupSlots.countOrdersInSlot(capOrders, '2026-10-29T13:30:00.000Z'), 0, 'exige ms numérico');
  assert.strictEqual(pickupSlots.countOrdersInSlot(capOrders, NaN), 0);
  assert.strictEqual(pickupSlots.countOrdersInSlot(null, T('2026-10-29T13:30:00.000Z')), 0);
  assert.strictEqual(pickupSlots.countOrdersInSlot([{ scheduled_for: '2026-10-29T13:30:00.000Z' }], T('2026-10-29T13:30:00.000Z')), 1, 'status default pending');

  // Pureza: las funciones no mutan sus entradas.
  const frozenConfig = Object.freeze({ intervalMinutes: 15, maxPerSlot: 2, leadMinutes: 30 });
  const frozenOrders = Object.freeze(capOrders.map((o) => (o ? Object.freeze({ ...o }) : o)));
  assert.doesNotThrow(() => pickupSlots.sanitizePickupConfig(frozenConfig));
  assert.doesNotThrow(() => pickupSlots.computeLeadMinutes(frozenConfig, { TAKEAWAY: { p50: 20 } }));
  assert.doesNotThrow(() => pickupSlots.buildPickupSlots({ scheduleEnabled: false, utcOffsetMinutes: OFFSET, nowMs: NOW, pickupConfig: frozenConfig }));
  assert.doesNotThrow(() => pickupSlots.countOrdersInSlot(frozenOrders, T('2026-10-29T13:30:00.000Z')));
  const slotListBefore = JSON.stringify(grid);
  pickupSlots.verifyScheduledFor({ ...verdictBase, scheduledFor: grid[0].scheduledFor });
  assert.strictEqual(JSON.stringify(grid), slotListBefore, 'verify no muta la grilla');
  console.log('    ✓ constantes, sanitizer, lead, relojes, grilla, veredictos, copy, wake y capacidad');

  // ══════════════════════════════════════════════════════════════════════════
  // §1b · Paridad CJS ↔ ESM
  // ══════════════════════════════════════════════════════════════════════════
  console.log('  §1b paridad CJS ↔ espejo ESM...');
  const esm = await import(pathToFileURL(path.join(ROOT, 'public/js/utils/pickupSlots.js')).href);

  for (const key of [
    'PICKUP_INTERVALS', 'DEFAULT_INTERVAL_MINUTES', 'DEFAULT_MAX_PER_SLOT', 'MAX_LEAD_MINUTES',
    'MAX_MAX_PER_SLOT', 'PICKUP_HORIZON_DAYS', 'PICKUP_AUTO_MARGIN_MINUTES', 'MAX_SLOTS', 'MINUTES_PER_DAY'
  ]) {
    assert.deepStrictEqual(esm[key], pickupSlots[key], `constante ${key} idéntica`);
  }
  for (const fn of [
    'sanitizePickupConfig', 'computeLeadMinutes', 'localMinutesOfDay', 'isAlignedSlot', 'parseRange',
    'openShiftRanges', 'buildPickupSlots', 'verifyScheduledFor', 'scheduledForVerdictMessage',
    'localPickupLabel', 'computeWakeAt', 'countOrdersInSlot'
  ]) {
    assert.strictEqual(typeof esm[fn], 'function', `ESM exporta ${fn}`);
    assert.strictEqual(typeof pickupSlots[fn], 'function', `CJS exporta ${fn}`);
  }
  assert.strictEqual(esm.pickupVerdictError, undefined, 'pickupVerdictError es backend-only (AppError)');

  const configCorpus = [
    null, undefined, 'basura', [], 42, {},
    { intervalMinutes: 5 }, { intervalMinutes: 7 }, { maxPerSlot: 0 }, { maxPerSlot: 999 },
    { leadMinutes: '' }, { leadMinutes: 0 }, { leadMinutes: 9999 },
    { intervalMinutes: 30, maxPerSlot: 10, leadMinutes: 60 },
    { intervalMinutes: '15', maxPerSlot: '2', leadMinutes: '45' }
  ];
  for (const cfg of configCorpus) {
    assert.deepStrictEqual(
      esm.sanitizePickupConfig(cfg),
      pickupSlots.sanitizePickupConfig(cfg),
      `paridad sanitize ${JSON.stringify(cfg)}`
    );
  }
  const prepCorpus = [null, {}, { TAKEAWAY: null }, { TAKEAWAY: { p50: 0 } }, { TAKEAWAY: { p50: 20 } }, { LOCAL: { p50: 9 } }];
  for (const cfg of configCorpus) {
    for (const prep of prepCorpus) {
      assert.strictEqual(
        esm.computeLeadMinutes(cfg, prep),
        pickupSlots.computeLeadMinutes(cfg, prep),
        `paridad lead ${JSON.stringify(cfg)} ${JSON.stringify(prep)}`
      );
    }
  }

  const slotCorpus = [
    { scheduleEnabled: false, utcOffsetMinutes: -180, nowMs: NOW, pickupConfig: { leadMinutes: 30 } },
    { scheduleEnabled: false, utcOffsetMinutes: 0, nowMs: NOW, pickupConfig: { leadMinutes: 15, intervalMinutes: 30 } },
    { scheduleEnabled: true, scheduleActiveHours: '10:00-12:00', utcOffsetMinutes: -180, nowMs: NOW, pickupConfig: { leadMinutes: 30 } },
    { scheduleEnabled: true, scheduleActiveHours: '18:00-02:00', utcOffsetMinutes: -180, nowMs: NOW, pickupConfig: { leadMinutes: 30 } },
    { scheduleEnabled: true, scheduleActiveHours: '23:00-00:00', utcOffsetMinutes: 0, nowMs: NOW, pickupConfig: { leadMinutes: 0 } },
    { scheduleEnabled: false, utcOffsetMinutes: 330, nowMs: NOW, pickupConfig: { leadMinutes: 45, intervalMinutes: 20 } },
    { scheduleEnabled: false, utcOffsetMinutes: -180, nowMs: NOW, pickupConfig: {}, prepEstimateByMode: { TAKEAWAY: { p50: 20 } } },
    { scheduleEnabled: false, utcOffsetMinutes: -180, nowMs: NOW, pickupConfig: {}, prepEstimateByMode: null },
    { scheduleEnabled: false, utcOffsetMinutes: -180, nowMs: NOW, pickupConfig: { leadMinutes: 30 }, maxSlots: 5 },
    { scheduleEnabled: false, utcOffsetMinutes: 840, nowMs: NOW, pickupConfig: { leadMinutes: 240 } }
  ];
  let comparedSlots = 0;
  for (const combo of slotCorpus) {
    const a = esm.buildPickupSlots(combo);
    const b = pickupSlots.buildPickupSlots(combo);
    assert.deepStrictEqual(a, b, `paridad grilla ${JSON.stringify(combo)}`);
    comparedSlots += a.length;
  }
  assert.ok(comparedSlots > 100, `corpus de grillas no vacío (${comparedSlots} slots)`);

  const verdictSlotIsos = [
    '2026-10-29T12:30:00.000Z', '2026-10-29T11:45:00.000Z', '2026-10-29T12:15:00.000Z',
    '2026-10-29T12:31:00.000Z', '2026-10-29', 'mañana', '', null,
    '2026-11-01T12:30:00.000Z', '2026-10-29T13:00:00.000Z', '2026-10-30T02:30:00.000Z'
  ];
  const verdictBases = [NOW, '2026-10-29T12:00:00.000Z'];
  const verdictVariants = [
    { scheduleEnabled: false, utcOffsetMinutes: 0, pickupConfig: { intervalMinutes: 15, leadMinutes: 30 } },
    { scheduleEnabled: true, scheduleActiveHours: '10:00-12:00', utcOffsetMinutes: -180, pickupConfig: { leadMinutes: 30 } },
    { scheduleEnabled: true, scheduleActiveHours: '18:00-02:00', utcOffsetMinutes: -180, pickupConfig: { leadMinutes: 30 } },
    { scheduleEnabled: false, utcOffsetMinutes: 0, pickupConfig: {} }
  ];
  let comparedVerdicts = 0;
  for (const base of verdictBases) {
    for (const variant of verdictVariants) {
      for (const iso of verdictSlotIsos) {
        const opts = { ...variant, nowMs: base, scheduledFor: iso };
        assert.deepStrictEqual(
          esm.verifyScheduledFor(opts),
          pickupSlots.verifyScheduledFor(opts),
          `paridad veredicto ${iso} @ ${base}`
        );
        comparedVerdicts += 1;
      }
    }
  }
  assert.strictEqual(comparedVerdicts, verdictBases.length * verdictVariants.length * verdictSlotIsos.length);

  for (const iso of ['2026-10-29T13:30:00.000Z', '2026-10-30T13:30:00.000Z', '2026-10-31T01:00:00.000Z', 'basura']) {
    for (const off of [-180, 0, 60, 330, 840]) {
      assert.strictEqual(
        esm.localPickupLabel(iso, off, NOW),
        pickupSlots.localPickupLabel(iso, off, NOW),
        `paridad label ${iso} ${off}`
      );
    }
  }
  for (const iso of ['2026-10-29T13:30:00.000Z', '2026-10-29T13:30:00.000Z', 'basura', '']) {
    for (const lead of [null, 0, 15, 30, 240, 'basura']) {
      assert.strictEqual(esm.computeWakeAt(iso, lead), pickupSlots.computeWakeAt(iso, lead), `paridad wake ${iso} ${lead}`);
    }
  }
  for (const target of [T('2026-10-29T13:30:00.000Z'), '2026-10-29T13:30:00.000Z', NaN, null]) {
    assert.strictEqual(
      esm.countOrdersInSlot(capOrders, target),
      pickupSlots.countOrdersInSlot(capOrders, target),
      `paridad capacidad ${target}`
    );
  }
  for (const raw of ['10:00-12:00', '18:30-02:15', '00:00-00:00', 'basura', '', null, '9:5-10:70']) {
    assert.deepStrictEqual(esm.parseRange(raw), pickupSlots.parseRange(raw), `paridad parseRange ${raw}`);
    for (const enabled of [true, false]) {
      assert.deepStrictEqual(
        esm.openShiftRanges(raw, enabled, -180, NOW),
        pickupSlots.openShiftRanges(raw, enabled, -180, NOW),
        `paridad franjas ${raw} ${enabled}`
      );
    }
  }
  for (const [ms, off, interval] of [[NOW, -180, 15], [NOW, 330, 20], [NOW + 7 * MIN, -180, 15], [NOW + 30 * 1000, 0, 5]]) {
    assert.strictEqual(esm.isAlignedSlot(ms, off, interval), pickupSlots.isAlignedSlot(ms, off, interval));
    assert.strictEqual(esm.localMinutesOfDay(ms, off), pickupSlots.localMinutesOfDay(ms, off));
  }
  for (const reason of ['MALFORMED', 'PAST', 'TOO_SOON', 'NOT_OFFERED', 'SLOT_UNAVAILABLE', 'OTRO']) {
    assert.strictEqual(
      esm.scheduledForVerdictMessage(reason, { leadMinutes: 30 }),
      pickupSlots.scheduledForVerdictMessage(reason, { leadMinutes: 30 }),
      `paridad copy ${reason}`
    );
  }
  console.log(`    ✓ paridad exacta (${comparedSlots} slots, ${comparedVerdicts} veredictos)`);

  // ══════════════════════════════════════════════════════════════════════════
  // §2 · Sanitizer del local
  // ══════════════════════════════════════════════════════════════════════════
  console.log('  §2 sanitizer del local (opt-in estricto)...');
  assert.strictEqual(sanitizeRestaurantPayload({ name: 'X' }).allowPreOrders, false, 'default OFF');
  assert.strictEqual(sanitizeRestaurantPayload({ name: 'X', allowPreOrders: true }).allowPreOrders, true);
  assert.strictEqual(sanitizeRestaurantPayload({ name: 'X', allowPreOrders: 'true' }).allowPreOrders, false, 'string NO');
  assert.strictEqual(sanitizeRestaurantPayload({ name: 'X', allowPreOrders: 1 }).allowPreOrders, false, 'número NO');
  assert.strictEqual(sanitizeRestaurantPayload({ name: 'X', allowPreOrders: {} }).allowPreOrders, false, 'objeto NO');
  assert.strictEqual(
    hasOwn(sanitizeRestaurantPayload({ name: 'X', allowPreOrders: true, pickupConfig: 'basura' }), 'pickupConfig'),
    false,
    'pickupConfig basura → clave AUSENTE'
  );
  assert.deepStrictEqual(
    sanitizeRestaurantPayload({ name: 'X', allowPreOrders: true, pickupConfig: { intervalMinutes: 30, maxPerSlot: 3, leadMinutes: 45 } }).pickupConfig,
    { intervalMinutes: 30, maxPerSlot: 3, leadMinutes: 45 }
  );
  assert.deepStrictEqual(
    sanitizeRestaurantPayload({ name: 'X', allowPreOrders: true, pickupConfig: { intervalMinutes: 7, maxPerSlot: 0 } }).pickupConfig,
    { intervalMinutes: 15, maxPerSlot: 1 },
    'clamps del módulo canónico'
  );
  const sanitizedOnce = sanitizeRestaurantPayload({ name: 'X', allowPreOrders: true, pickupConfig: { intervalMinutes: 30, maxPerSlot: 3, leadMinutes: 45 } });
  assert.deepStrictEqual(sanitizeRestaurantPayload(sanitizedOnce), sanitizedOnce, 'sanitizer idempotente');
  assert.strictEqual(stripPrivilegedFields(sanitizedOnce).allowPreOrders, true, 'allowPreOrders NO es privilegiado (lo edita el dueño)');
  assert.deepStrictEqual(stripPrivilegedFields(sanitizedOnce).pickupConfig, sanitizedOnce.pickupConfig, 'pickupConfig sobrevive /save');
  console.log('    ✓ allowPreOrders === true estricto + pickupConfig ABSENT/saneado/idempotente');

  // ══════════════════════════════════════════════════════════════════════════
  // §3 · Runtime real
  // ══════════════════════════════════════════════════════════════════════════
  console.log('  §3 runtime real (server HTTP + store real)...');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
  const savedMpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const savedTurnstile = process.env.TURNSTILE_SECRET;
  delete process.env.TURNSTILE_SECRET; // aislamiento de entorno: el alta no debe pedir captcha

  try {
    // ── 3.1 · Payload público con reloj inyectado + cache key ───────────────
    const r1 = await createFixture('R1', {
      allowPreOrders: true,
      forceClosed: true,
      scheduleEnabled: false,
      utcOffsetMinutes: OFFSET,
      pickupConfig: { intervalMinutes: 15, maxPerSlot: 2, leadMinutes: 30 },
      allowOnlinePayment: true
    });
    await invalidateMenuCache(r1.slug);

    const menuA = await request('GET', `/api/menu/${r1.slug}?nowMs=${NOW}`);
    assert.strictEqual(menuA.status, 200);
    assert.strictEqual(menuA.headers['x-cache'], 'MISS', 'primer request con reloj → MISS');
    const dataA = menuA.body.restaurant;
    assert.strictEqual(dataA.allowPreOrders, true, 'opt-in con lead explícito → true');
    assert.deepStrictEqual(dataA.pickupConfig, { intervalMinutes: 15, maxPerSlot: 2, leadMinutes: 30 });
    assert.strictEqual(dataA.pickupLeadMinutes, 30);
    assert.strictEqual(dataA.pickupSlots.length, pickupSlots.MAX_SLOTS);
    assert.deepStrictEqual(
      dataA.pickupSlots[0],
      { scheduledFor: '2026-10-29T12:30:00.000Z', minutes: 570, time: '09:30', dayKey: 'hoy' },
      'la grilla del payload respeta el reloj inyectado'
    );

    const menuB = await request('GET', `/api/menu/${r1.slug}?nowMs=${NOW}`);
    assert.strictEqual(menuB.headers['x-cache'], 'HIT', 'mismo reloj → HIT');
    assert.deepStrictEqual(menuB.body.restaurant.pickupSlots[0], dataA.pickupSlots[0]);

    // Regresión REAL: sin `nowMs` en la key del LRU, este request recibía los
    // slots del reloj anterior (HIT de 60 s con datos de otro instante).
    const menuC = await request('GET', `/api/menu/${r1.slug}?nowMs=${NOW + HOUR}`);
    assert.strictEqual(menuC.headers['x-cache'], 'MISS', 'otro reloj → MISS (nowMs en la key)');
    assert.strictEqual(
      menuC.body.restaurant.pickupSlots[0].scheduledFor,
      '2026-10-29T13:30:00.000Z',
      'la grilla se recalcula para el nuevo reloj'
    );
    assert.strictEqual(menuC.body.restaurant.pickupSlots[0].time, '10:30');

    // Demo: los 4 campos presentes con defaults honestos (nunca undefined).
    const demoData = await getMenu('demo-restaurante');
    assert.strictEqual(demoData.allowPreOrders, false, 'una demo no vende pre-orders');
    assert.deepStrictEqual(demoData.pickupSlots, []);
    assert.strictEqual(demoData.pickupLeadMinutes, null);
    assert.strictEqual(demoData.pickupConfig, null);

    // ── 3.2 · Feature off: payload sin campos + gates honestos ─────────────
    const r2 = await createFixture('R2', {
      allowPreOrders: false,
      forceClosed: true,
      scheduleEnabled: false,
      utcOffsetMinutes: OFFSET
    });
    await invalidateMenuCache(r2.slug);
    const dataR2 = await getMenu(r2.slug);
    assert.strictEqual(dataR2.allowPreOrders, false);
    assert.strictEqual(hasOwn(dataR2, 'pickupConfig'), false, 'sin opt-in NO viaja pickupConfig');
    assert.strictEqual(hasOwn(dataR2, 'pickupSlots'), false, 'sin opt-in NO viaja pickupSlots');
    assert.strictEqual(hasOwn(dataR2, 'pickupLeadMinutes'), false, 'sin opt-in NO viaja pickupLeadMinutes');

    const slotR2 = new Date(Date.now() + 2 * HOUR).toISOString();
    const quoteR2Slot = await request('POST', '/api/orders/quote', orderBody(r2.restaurant, r2.dishId, { scheduledFor: slotR2 }));
    assert.strictEqual(quoteR2Slot.status, 400);
    assert.strictEqual(quoteR2Slot.body.code, 'PRE_ORDERS_DISABLED', 'slot con feature off → PRE_ORDERS_DISABLED');
    const quoteR2NoSlot = await request('POST', '/api/orders/quote', orderBody(r2.restaurant, r2.dishId));
    assert.strictEqual(quoteR2NoSlot.status, 400);
    assert.strictEqual(quoteR2NoSlot.body.code, 'RESTAURANT_CLOSED', 'sin slot y cerrado → RESTAURANT_CLOSED (la excepción NO aplica)');

    // ── 3.3 · Quote: excepción de cerrado + gates por veredicto ────────────
    const slotsR1 = gridFor(r1.restaurant);
    assert.ok(slotsR1.length >= 4, 'grilla real del fixture');
    const slotA = slotsR1[1].scheduledFor;
    const slotB = slotsR1[2].scheduledFor;
    const slotC = slotsR1[3].scheduledFor;

    const quoteNoSlot = await request('POST', '/api/orders/quote', orderBody(r1.restaurant, r1.dishId));
    assert.strictEqual(quoteNoSlot.status, 400);
    assert.strictEqual(quoteNoSlot.body.code, 'RESTAURANT_CLOSED', 'forceClosed sigue ganando sin slot');

    const quoteOk = await request('POST', '/api/orders/quote', orderBody(r1.restaurant, r1.dishId, { scheduledFor: slotA }));
    assert.strictEqual(quoteOk.status, 200, quoteOk.raw.slice(0, 300));
    const quote = quoteOk.body.data;
    assert.strictEqual(quote.scheduledFor, slotA, 'el quote devuelve la franja confirmada');
    assert.strictEqual(quote.scheduledLeadMinutes, 30);
    assert.ok(/^(hoy|mañana) \d{2}:\d{2} hs$/.test(quote.scheduledLabel), `label honesto: ${quote.scheduledLabel}`);
    assert.strictEqual(quote.amount, 10, 'cotiza los platos igual');

    const quoteLocal = await request('POST', '/api/orders/quote', orderBody(r1.restaurant, r1.dishId, { orderMode: 'LOCAL', scheduledFor: slotA }));
    assert.strictEqual(quoteLocal.status, 400);
    assert.strictEqual(quoteLocal.body.code, 'SCHEDULED_TAKEAWAY_ONLY', 'programado solo con TAKEAWAY');

    const quoteDelivery = await request('POST', '/api/orders/quote', orderBody(r1.restaurant, r1.dishId, {
      orderMode: 'DELIVERY',
      deliveryAddress: 'Calle 1',
      scheduledFor: slotA
    }));
    assert.strictEqual(quoteDelivery.status, 400);
    assert.strictEqual(quoteDelivery.body.code, 'SCHEDULED_TAKEAWAY_ONLY');

    const quoteMalformed = await request('POST', '/api/orders/quote', orderBody(r1.restaurant, r1.dishId, { scheduledFor: 'mañana' }));
    assert.strictEqual(quoteMalformed.body.code, 'SCHEDULED_INVALID');
    const quotePast = await request('POST', '/api/orders/quote', orderBody(r1.restaurant, r1.dishId, {
      scheduledFor: new Date(Date.now() - HOUR).toISOString()
    }));
    assert.strictEqual(quotePast.body.code, 'SCHEDULED_PAST');
    const quoteTooSoon = await request('POST', '/api/orders/quote', orderBody(r1.restaurant, r1.dishId, {
      scheduledFor: new Date(Date.now() + 5 * MIN).toISOString()
    }));
    assert.strictEqual(quoteTooSoon.body.code, 'SCHEDULED_TOO_SOON');
    const quoteUnaligned = await request('POST', '/api/orders/quote', orderBody(r1.restaurant, r1.dishId, {
      scheduledFor: new Date(T(slotA) + MIN).toISOString()
    }));
    assert.strictEqual(quoteUnaligned.body.code, 'SCHEDULED_SLOT_UNAVAILABLE', 'no alineado');
    const quoteFar = await request('POST', '/api/orders/quote', orderBody(r1.restaurant, r1.dishId, {
      scheduledFor: new Date(Date.now() + 3 * 24 * HOUR).toISOString()
    }));
    assert.strictEqual(quoteFar.body.code, 'SCHEDULED_SLOT_UNAVAILABLE', 'fuera del horizonte');

    // ── 3.4 · Alta real: persiste la franja, el lead y el token ────────────
    const postOk = await request('POST', '/api/orders', orderBody(r1.restaurant, r1.dishId, { scheduledFor: slotA }));
    assert.strictEqual(postOk.status, 201, postOk.raw.slice(0, 400));
    const created = postOk.body.data;
    assert.ok(created && created.id, 'pedido creado');
    assert.strictEqual(created.scheduledFor, slotA, 'camel en la respuesta');
    assert.strictEqual(created.scheduled_for, slotA, 'snake en la respuesta (dual-write)');
    assert.strictEqual(created.scheduledLeadMinutes, 30);
    assert.strictEqual(created.scheduled_lead_minutes, 30);
    assert.ok(typeof created.trackingToken === 'string' && created.trackingToken.length > 10, 'token de seguimiento');
    assert.strictEqual(created.orderMode, 'TAKEAWAY');

    // Persistencia real en el espejo local.
    const mirrored = db.findOrderById(created.id);
    assert.ok(mirrored, 'pedido en el espejo local');
    assert.strictEqual(mirrored.scheduled_for, slotA);
    assert.strictEqual(mirrored.scheduled_lead_minutes, 30);

    // El lead DEBE viajar a cloud: el KDS puede caer en otra réplica de Vercel
    // y `/tmp` (espejo local) es efímero. Sin esta columna `wakeAt` no existe
    // fuera de la instancia que creó el pedido. Si la 013 v2 todavía no está
    // aplicada, SKIP honesto (el resto del feature sigue cubierto local).
    const cloud = getSupabaseClient();
    if (cloud) {
      const { data: cloudRow, error: cloudErr } = await cloud
        .from('orders')
        .select('scheduled_for, scheduled_lead_minutes')
        .eq('id', created.id)
        .maybeSingle();
      if (cloudErr && /scheduled_lead_minutes/i.test(cloudErr.message || '')) {
        console.log('    ⚠ SKIP probe cloud del lead: reaplicar la 013 (scheduled_lead_minutes)');
      } else {
        assert.ok(!cloudErr, `lectura cloud: ${cloudErr && cloudErr.message}`);
        assert.ok(cloudRow, 'el pedido llegó a cloud');
        assert.strictEqual(T(cloudRow.scheduled_for), T(slotA), 'retiro persistido en cloud');
        assert.strictEqual(Number(cloudRow.scheduled_lead_minutes), 30, 'lead persistido en cloud (wakeAt del KDS)');
      }
    }

    // ── 3.5 · Seguimiento público: franja + modalidad, sin PII ─────────────
    const track = await request('GET', `/api/orders/track/${created.trackingToken}`);
    assert.strictEqual(track.status, 200);
    const tracked = track.body.data;
    assert.strictEqual(tracked.scheduledFor, slotA);
    assert.ok(/^(hoy|mañana) \d{2}:\d{2} hs$/.test(tracked.scheduledLabel), 'label del retiro');
    assert.strictEqual(tracked.orderMode, 'TAKEAWAY');
    assert.strictEqual(tracked.status, 'pending');
    for (const forbidden of ['customerName', 'customer_name', 'customerPhone', 'customer_phone', 'deliveryAddress', 'notes']) {
      assert.strictEqual(hasOwn(tracked, forbidden), false, `sin PII: ${forbidden}`);
    }

    // ── 3.6 · Capacidad por slot (v1 in-request) ───────────────────────────
    const cap1 = await request('POST', '/api/orders', orderBody(r1.restaurant, r1.dishId, { scheduledFor: slotB }));
    assert.strictEqual(cap1.status, 201, 'primer pedido del slot');
    const cap2 = await request('POST', '/api/orders', orderBody(r1.restaurant, r1.dishId, { scheduledFor: slotB }));
    assert.strictEqual(cap2.status, 201, 'segundo pedido del slot (maxPerSlot 2)');
    const cap3 = await request('POST', '/api/orders', orderBody(r1.restaurant, r1.dishId, { scheduledFor: slotB }));
    assert.strictEqual(cap3.status, 400, 'tercer pedido rechazado');
    assert.strictEqual(cap3.body.code, 'SLOT_FULL', 'código estable de capacidad');

    // Cancelados/entregados NO saturan la franja.
    for (let i = 0; i < 3; i++) {
      await seedOrder(r1.restaurant, { dishId: r1.dishId, status: 'cancelled', scheduled_for: slotC });
    }
    for (let i = 0; i < 3; i++) {
      await seedOrder(r1.restaurant, { dishId: r1.dishId, status: 'delivered', scheduled_for: slotC });
    }
    const capFree = await request('POST', '/api/orders', orderBody(r1.restaurant, r1.dishId, { scheduledFor: slotC }));
    assert.strictEqual(capFree.status, 201, 'cancelados/entregados liberan lugar');

    // ── 3.7 · Franja de atención (R4): fuera → SLOT_UNAVAILABLE, dentro → 200
    const r4 = await createFixture('R4', {
      allowPreOrders: true,
      scheduleEnabled: true,
      scheduleActiveHours: '10:00-12:00',
      utcOffsetMinutes: 0,
      pickupConfig: { intervalMinutes: 15, maxPerSlot: 4, leadMinutes: 30 }
    });
    const tomorrow = new Date(Date.now());
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(13, 0, 0, 0);
    const outsideSlot = tomorrow.toISOString();
    tomorrow.setUTCHours(10, 30, 0, 0);
    const insideTomorrow = tomorrow.toISOString();

    const r4Outside = await request('POST', '/api/orders/quote', orderBody(r4.restaurant, r4.dishId, {
      scheduledFor: outsideSlot,
      utcOffsetMinutes: 0
    }));
    assert.strictEqual(r4Outside.status, 400, r4Outside.raw.slice(0, 300));
    assert.strictEqual(r4Outside.body.code, 'SCHEDULED_SLOT_UNAVAILABLE', '13:00 local fuera de 10-12');

    const r4Inside = await request('POST', '/api/orders/quote', orderBody(r4.restaurant, r4.dishId, {
      scheduledFor: insideTomorrow,
      utcOffsetMinutes: 0
    }));
    assert.strictEqual(r4Inside.status, 200, r4Inside.raw.slice(0, 300));
    assert.strictEqual(r4Inside.body.data.scheduledFor, insideTomorrow, '10:30 local dentro de la franja');

    // ── 3.8 · Pago online: pickup ANTES de rules y de MP ───────────────────
    process.env.MERCADOPAGO_ACCESS_TOKEN = '';
    const mpNoSlot = await request('POST', '/api/orders/mercadopago/preference', orderBody(r1.restaurant, r1.dishId));
    assert.strictEqual(mpNoSlot.status, 400);
    assert.strictEqual(mpNoSlot.body.code, 'RESTAURANT_CLOSED', 'sin slot: cerrado gana');
    const mpLocal = await request('POST', '/api/orders/mercadopago/preference', orderBody(r1.restaurant, r1.dishId, {
      orderMode: 'LOCAL',
      scheduledFor: slotA
    }));
    assert.strictEqual(mpLocal.status, 400);
    assert.strictEqual(mpLocal.body.code, 'SCHEDULED_TAKEAWAY_ONLY');
    const mpMalformed = await request('POST', '/api/orders/mercadopago/preference', orderBody(r1.restaurant, r1.dishId, {
      scheduledFor: 'basura'
    }));
    assert.strictEqual(mpMalformed.body.code, 'SCHEDULED_INVALID');
    const mpOk = await request('POST', '/api/orders/mercadopago/preference', orderBody(r1.restaurant, r1.dishId, {
      scheduledFor: slotA
    }));
    assert.strictEqual(mpOk.status, 500, 'pickup válido llegó hasta MP');
    assert.strictEqual(mpOk.body.code, 'MP_NOT_CONFIGURED', 'sin credenciales la pasarela degrada honestamente');

    // ── 3.9 · Stock diario re-anclado al día del RETIRO (R3) ───────────────
    const r3 = await createFixture('R3', {
      utcOffsetMinutes: OFFSET,
      dishExtra: { dailyStock: 2 }
    });
    const todayWindow = dailyStock.getDailyStockWindow(Date.now(), OFFSET);
    const tomorrowWindow = nightSummary.localDayWindow(Date.now(), OFFSET, 1);
    const todayNoon = new Date(T(todayWindow.startUtc) + 12 * HOUR).toISOString();
    const tomorrowNoon = new Date(T(tomorrowWindow.startUtc) + 12 * HOUR).toISOString();
    const dishSoldOut = async () => {
      await invalidateMenuCache(r3.slug);
      const data = await getMenu(r3.slug);
      const dish = data.dishes.find((d) => d.id === r3.dishId);
      assert.ok(dish, 'plato en la carta');
      return dish.soldOutToday;
    };
    assert.strictEqual(await dishSoldOut(), false, 'sin ventas no se agota');
    for (let i = 0; i < 5; i++) {
      await seedOrder(r3.restaurant, { dishId: r3.dishId, status: 'delivered', scheduled_for: tomorrowNoon });
    }
    assert.strictEqual(await dishSoldOut(), false, 'los pre-orders de MAÑANA no consumen el stock de hoy');
    for (let i = 0; i < 2; i++) {
      await seedOrder(r3.restaurant, { dishId: r3.dishId, status: 'delivered', scheduled_for: todayNoon });
    }
    assert.strictEqual(await dishSoldOut(), true, '2 retiros de HOY alcanzan el tope de 2');
    await seedOrder(r3.restaurant, { dishId: r3.dishId, status: 'cancelled', scheduled_for: todayNoon });
    assert.strictEqual(await dishSoldOut(), true, 'un cancelado no descuenta stock (ni lo libera)');

    // ── 3.10 · F7 excluye programados + lead derivado (R5) ─────────────────
    const r5 = await createFixture('R5', {
      allowPreOrders: true,
      utcOffsetMinutes: OFFSET,
      pickupConfig: { intervalMinutes: 15, maxPerSlot: 4 } // sin lead → derivado de F7
    });
    // Seeds relativos al RELOJ CONGELADO: el servicio de pickup propaga su
    // `nowMs` al bundle de F7 (misma ventana de 7 días), así la muestra es
    // determinista a cualquier hora y fecha de corrida. Antes usaban
    // `Date.now()` y la suite fallaba pasadas las 12:00 UTC (los seeds caían
    // DESPUÉS de NOW y quedaban fuera de la ventana). Los deltas
    // created→entregado (20 min) siguen siendo deterministas.
    for (let i = 0; i < 20; i++) {
      const created = new Date(NOW - (i + 2) * 10 * MIN).toISOString();
      await seedOrder(r5.restaurant, {
        dishId: r5.dishId,
        status: 'delivered',
        order_mode: 'TAKEAWAY',
        created_at: created,
        status_updated_at: new Date(T(created) + 20 * MIN).toISOString()
      });
    }
    prepService.clearPrepEstimateCache();
    const prepBundle = await prepService.getPrepEstimateBundleForRestaurant(r5.restaurant, { nowMs: NOW });
    assert.ok(prepBundle, 'bundle de F7');
    assert.strictEqual(prepBundle.all.samples, 20, '20 entregados normales');
    assert.strictEqual(prepBundle.all.p50, 20);
    assert.strictEqual(prepBundle.byMode.TAKEAWAY.samples, 20, 'TAKEAWAY con muestra propia');
    assert.strictEqual(prepBundle.byMode.TAKEAWAY.p50, 20);
    assert.strictEqual(prepBundle.byMode.DELIVERY, null, 'sin muestra de delivery no se inventa');

    const pickupR5 = await pickupService.getPickupBundleForRestaurant(r5.restaurant, { nowMs: NOW });
    assert.strictEqual(pickupR5.allowed, true, 'opt-in + lead derivado opera');
    assert.strictEqual(pickupR5.leadMinutes, 30, 'p50 20 + 10 de margen');

    // 5 programados de 90 min NO entran en la muestra de cocina.
    for (let i = 0; i < 5; i++) {
      const created = new Date(NOW - (i + 2) * 10 * MIN).toISOString();
      await seedOrder(r5.restaurant, {
        dishId: r5.dishId,
        status: 'delivered',
        order_mode: 'TAKEAWAY',
        created_at: created,
        status_updated_at: new Date(T(created) + 90 * MIN).toISOString(),
        scheduled_for: tomorrowNoon,
        scheduledFor: tomorrowNoon
      });
    }
    prepService.clearPrepEstimateCache();
    const prepAfter = await prepService.getPrepEstimateBundleForRestaurant(r5.restaurant, { nowMs: NOW });
    assert.strictEqual(prepAfter.all.samples, 20, 'los programados quedan FUERA de la muestra');
    assert.strictEqual(prepAfter.all.p50, 20, 'y no mueven el p50');
    assert.strictEqual(prepAfter.all.p90, 20);

    // El alta de R5 con la grilla derivada funciona de punta a punta.
    const slotsR5 = gridFor(r5.restaurant, { prepEstimateByMode: { TAKEAWAY: { p50: 20 } } });
    const postR5 = await request('POST', '/api/orders', orderBody(r5.restaurant, r5.dishId, { scheduledFor: slotsR5[1].scheduledFor }));
    assert.strictEqual(postR5.status, 201, postR5.raw.slice(0, 300));
    assert.strictEqual(postR5.body.data.scheduledLeadMinutes, 30, 'el lead derivado es la autoridad');

    // ── 3.11 · Opt-in SIN lead: el feature no opera (R6) ───────────────────
    const r6 = await createFixture('R6', {
      allowPreOrders: true,
      utcOffsetMinutes: OFFSET,
      pickupConfig: { intervalMinutes: 15, maxPerSlot: 4 }
    });
    await invalidateMenuCache(r6.slug);
    const dataR6 = await getMenu(r6.slug);
    assert.strictEqual(dataR6.allowPreOrders, false, 'opt-in sin lead ni muestra → NO opera (flag público false)');
    assert.strictEqual(hasOwn(dataR6, 'pickupSlots'), false);
    const quoteR6 = await request('POST', '/api/orders/quote', orderBody(r6.restaurant, r6.dishId, {
      scheduledFor: new Date(Date.now() + 2 * HOUR).toISOString()
    }));
    assert.strictEqual(quoteR6.status, 400);
    assert.strictEqual(quoteR6.body.code, 'PRE_ORDERS_DISABLED', 'sin lead el veredicto es NOT_OFFERED');

    // ── 3.12 · KDS: wakeAt + partición (paridad con el módulo puro) ────────
    const kds = await import(pathToFileURL(path.join(ROOT, 'public/js/kitchen/kitchenColumns.js')).href);
    const kdsOrder = {
      id: 'ord_kds_AB12',
      status: 'pending',
      order_mode: 'TAKEAWAY',
      scheduled_for: '2026-10-29T13:30:00.000Z',
      scheduled_lead_minutes: 30,
      items_snapshot: [{ dishId: r1.dishId, name: 'Plato', quantity: 1 }]
    };
    const card = kds.buildKitchenCardModel(kdsOrder);
    assert.strictEqual(card.scheduledFor, '2026-10-29T13:30:00.000Z');
    assert.strictEqual(card.scheduledLeadMinutes, 30);
    assert.strictEqual(
      card.wakeAt,
      pickupSlots.computeWakeAt('2026-10-29T13:30:00.000Z', 30),
      'wakeAt del KDS = computeWakeAt del módulo canónico'
    );
    const legacyCard = kds.buildKitchenCardModel({ id: 'ord_kds_CD34', status: 'pending' });
    assert.strictEqual(legacyCard.scheduledFor, '');
    assert.strictEqual(legacyCard.scheduledLeadMinutes, null);
    assert.strictEqual(legacyCard.wakeAt, null);
    const noLeadCard = kds.buildKitchenCardModel({
      id: 'ord_kds_EF56',
      status: 'pending',
      scheduled_for: '2026-10-29T13:30:00.000Z'
    });
    assert.strictEqual(noLeadCard.wakeAt, '2026-10-29T13:30:00.000Z', 'sin lead despierta en el retiro');

    const models = [
      card,
      kds.buildKitchenCardModel({ id: 'ord_kds_GH78', status: 'pending' }),
      kds.buildKitchenCardModel({ id: 'ord_kds_IJ90', status: 'delivered', scheduled_for: '2026-10-29T13:30:00.000Z', scheduled_lead_minutes: 30 }),
      kds.buildKitchenCardModel({ id: 'ord_kds_KL12', status: 'preparing', scheduled_for: '2026-10-29T16:00:00.000Z', scheduled_lead_minutes: 30 })
    ];
    const parted = kds.partitionScheduledModels(models, T('2026-10-29T12:00:00.000Z'));
    assert.strictEqual(parted.scheduled.length, 2, 'programados futuros van a la franja');
    assert.deepStrictEqual(parted.scheduled.map((m) => m.id), ['ord_kds_AB12', 'ord_kds_KL12'], 'ordenados por wakeAt');
    assert.strictEqual(parted.active.length, 2, 'el inmediato + el terminal quedan activos');
    assert.ok(parted.active.some((m) => m.id === 'ord_kds_GH78'), 'terminal nunca queda programado');

    const awake = kds.partitionScheduledModels(models, T('2026-10-29T13:30:00.000Z'));
    assert.strictEqual(awake.scheduled.length, 1, 'al llegar el wakeAt el pedido despierta');
    assert.strictEqual(awake.active.length, 3);
    assert.deepStrictEqual(kds.partitionScheduledModels([], NOW), { active: [], scheduled: [] });
    assert.deepStrictEqual(kds.partitionScheduledModels(null, NOW), { active: [], scheduled: [] });

    // ── 3.13 · Servicio: cache por minuto + bypass con reloj inyectado ─────
    pickupService.clearPickupBundleCache();
    const cachedA = await pickupService.getPickupBundleForRestaurant(r1.restaurant);
    const cachedB = await pickupService.getPickupBundleForRestaurant(r1.restaurant);
    assert.deepStrictEqual(cachedB.slots, cachedA.slots, 'segundo hit del servicio devuelve la misma grilla');
    const bypass = await pickupService.getPickupBundleForRestaurant(r1.restaurant, { nowMs: NOW });
    assert.deepStrictEqual(bypass.slots[0], dataA.pickupSlots[0], 'reloj inyectado NO usa cache');
    pickupService.clearPickupBundleCache();
  } finally {
    if (savedMpToken === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = savedMpToken;
    if (savedTurnstile === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = savedTurnstile;
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('    ✓ payload/cache, quote, alta, seguimiento, capacidad, franja, MP, stock, F7, KDS');

  // ══════════════════════════════════════════════════════════════════════════
  // §4 · Wiring estático + contrato + migración
  // ══════════════════════════════════════════════════════════════════════════
  console.log('  §4 wiring estático, contrato y migración...');

  const menuHtml = readSource('public/menu.html');
  for (const id of ['pickupScheduleBox', 'pickupScheduleVerdict', 'pickupModeNow', 'pickupModeScheduled', 'pickupSlotGrid']) {
    assert.ok(menuHtml.includes(`id="${id}"`), `menu.html tiene #${id}`);
  }
  assert.ok(/id="pickupScheduleVerdict"[^>]*role="status"/.test(menuHtml), 'veredicto es live region');
  assert.ok(/id="pickupSlotGrid"[^>]*role="group"/.test(menuHtml), 'grilla agrupada');
  assert.ok(menuHtml.includes('aria-pressed'), 'pills con estado ARIA');

  const menuJs = readSource('public/js/menu.js');
  for (const fn of ['updatePickupScheduleBox', 'renderPickupSlotGrid', 'syncPickupScheduleUi', 'setPickupMode', 'setPickupSlot', 'getPickupScheduledFor']) {
    assert.ok(menuJs.includes(`function ${fn}`), `menu.js define ${fn}`);
  }
  assert.ok(menuJs.includes('pickupScheduledFor = \'\''), 'volver a "ahora" LIMPIA la franja');
  const syncPickupFn = menuJs.slice(
    menuJs.indexOf('function syncPickupScheduleUi'),
    menuJs.indexOf('function setPickupMode')
  );
  assert.ok(syncPickupFn.includes('slot.dayKey') && syncPickupFn.includes('slot.time'), 'el veredicto usa la franja del server (huso del local)');
  assert.strictEqual(syncPickupFn.includes('getTimezoneOffset'), false, 'el veredicto NO usa el huso del navegador del comensal');
  assert.ok(/\n\s+setPickupMode,\r?\n/.test(menuJs) && /\n\s+setPickupSlot,\r?\n/.test(menuJs), 'ambos exports en window');

  const orderSubmit = readSource('public/js/menu/orderSubmit.js');
  assert.ok(orderSubmit.includes('scheduledFor'), 'el checkout manda scheduledFor');
  assert.ok(orderSubmit.includes('getPickupScheduledFor'), 'el submit conoce el contexto de retiro');
  assert.ok(orderSubmit.includes('HORARIO PROGRAMADO'), 'el mensaje de WhatsApp declara la franja');

  const orderTracking = readSource('public/js/menu/orderTracking.js');
  assert.ok(orderTracking.includes('scheduledLabel'), 'el seguimiento muestra la franja');
  assert.ok(orderTracking.includes('Retiro programado'), 'copy del seguimiento');

  const kitchenHtml = readSource('public/kitchen.html');
  for (const id of ['kdsScheduled', 'kdsScheduledTitle', 'kdsScheduledCount', 'kdsScheduledBody']) {
    assert.ok(kitchenHtml.includes(`id="${id}"`), `kitchen.html tiene #${id}`);
  }
  assert.strictEqual((kitchenHtml.match(/<h2/g) || []).length, 5, 'las 5 columnas h2 siguen intactas');
  assert.ok(kitchenHtml.includes('role="heading" aria-level="2"'), 'el título PROGRAMADOS no rompe la jerarquía');

  const kitchenColumnsSrc = readSource('public/js/kitchen/kitchenColumns.js');
  assert.ok(kitchenColumnsSrc.includes('partitionScheduledModels'), 'partición pura exportada');
  assert.ok(kitchenColumnsSrc.includes('scheduledLeadMinutes'), 'lead aditivo en el modelo');
  assert.strictEqual(/^\s*import\s/m.test(kitchenColumnsSrc), false, 'kitchenColumns se mantiene autocontenido (sin imports)');
  assert.strictEqual(kitchenColumnsSrc.includes('require('), false, 'kitchenColumns sin require');

  const kitchenJs = readSource('public/js/kitchen/kitchen.js');
  for (const token of ['announceWoken', 'kdsScheduledBody', 'isOrderAwake', 'previousScheduledIds', 'utcOffsetMinutes']) {
    assert.ok(kitchenJs.includes(token), `kitchen.js usa ${token}`);
  }

  const kitchenCss = readSource('public/css/kitchen.css');
  assert.ok(kitchenCss.includes('.kds-scheduled'), 'estilos de la franja');
  assert.ok(kitchenCss.includes('.kds-chip-scheduled'), 'chip violeta del retiro');

  const studioHtml = readSource('public/studio.html');
  for (const id of ['inputAllowPreOrders', 'sliderPreOrders', 'inputPickupInterval', 'inputPickupMaxPerSlot', 'inputPickupLead']) {
    assert.ok(studioHtml.includes(`id="${id}"`), `studio.html tiene #${id}`);
  }
  assert.ok(studioHtml.includes('Takeaway Programado'), 'bloque del dueño');
  assert.ok(/for="inputPickupInterval"/.test(studioHtml), 'label asociado al intervalo');

  const studioJs = readSource('public/js/studio.js');
  assert.ok(studioJs.includes('sanitizePickupConfig'), 'el Studio importa la MISMA regla del server');
  assert.ok(studioJs.includes('allowPreOrders'), 'el Studio collecta el opt-in');
  assert.ok(studioJs.includes('delete restaurant.pickupConfig'), 'apagar el feature limpia la config');

  const cacheSrc = readSource('api/middleware/cache.js');
  assert.ok(cacheSrc.includes(':now:'), 'la key del LRU incluye el reloj inyectado');
  const menuRouteSrc = readSource('api/routes/menu.js');
  assert.ok(menuRouteSrc.includes(':now:${reqNowMs}'), 'la key del single-flight incluye el reloj inyectado');

  const migration = 'src/db/migrations/013_pickup_scheduled.sql';
  assert.ok(hasFile(migration), 'existe la migración 013');
  const migrationSql = readSource(migration);
  assert.ok(/scheduled_for\s+timestamptz/i.test(migrationSql), 'columna scheduled_for');
  assert.ok(/scheduled_lead_minutes\s+integer/i.test(migrationSql), 'columna scheduled_lead_minutes (wakeAt cross-réplica)');
  assert.ok(/add column if not exists/i.test(migrationSql), 'idempotente');
  assert.ok(/idx_orders_scheduled_for/.test(migrationSql), 'índice parcial');

  const dbSrc = readSource('src/db/db.js');
  assert.ok(dbSrc.includes('getSlotOrdersNear'), 'db expone la unión para capacidad');
  assert.ok(dbSrc.includes('scheduled_for'), 'dual-write de la franja');
  assert.ok(dbSrc.includes('scheduled_lead_minutes'), 'dual-write del lead (el KDS no depende de /tmp)');
  assert.ok(dbSrc.includes('scheduledFor != null'), 're-anclaje del stock al retiro');
  assert.ok(dbSrc.includes('and(scheduled_for.gte.'), 'la ventana del stock ancla al retiro también en cloud (dos ramas AND, no un OR suelto)');
  assert.ok(dbSrc.includes("is('scheduled_for', null)"), 'F7 excluye los programados de la muestra de preparación');

  const openapi = readSource('openapi.yaml');
  for (const token of [
    'scheduledFor', 'scheduledLabel', 'scheduledLeadMinutes', 'allowPreOrders', 'pickupConfig',
    'pickupSlots', 'pickupLeadMinutes', 'SCHEDULED_TAKEAWAY_ONLY', 'PRE_ORDERS_DISABLED',
    'SCHEDULED_INVALID', 'SCHEDULED_PAST', 'SCHEDULED_TOO_SOON', 'SCHEDULED_SLOT_UNAVAILABLE', 'SLOT_FULL'
  ]) {
    assert.ok(openapi.includes(token), `openapi.yaml documenta ${token}`);
  }

  const pkg = JSON.parse(readSource('package.json'));
  assert.ok(pkg.scripts['test:takeaway-scheduled'], 'alias npm de la suite');
  assert.ok(
    pkg.scripts['test:core'].includes('test-takeaway-scheduled.js'),
    'la suite entra en la cadena test:core'
  );

  // Cero atributos on*= en los bloques nuevos (CSP script-src-attr 'none').
  const newBlocks = [
    menuHtml.slice(menuHtml.indexOf('pickupScheduleBox') - 200, menuHtml.indexOf('pickupScheduleBox') + 1600),
    kitchenHtml.slice(kitchenHtml.indexOf('kdsScheduled') - 200, kitchenHtml.indexOf('kdsScheduled') + 1200),
    studioHtml.slice(studioHtml.indexOf('inputAllowPreOrders') - 400, studioHtml.indexOf('inputAllowPreOrders') + 2200)
  ];
  for (const block of newBlocks) {
    assert.strictEqual(/\son[a-z]+\s*=/.test(block), false, 'cero atributos on* en el bloque nuevo');
  }
  console.log('    ✓ menu/KDS/Studio/cache/openapi/013/package.json');

  console.log('✅ Takeaway Programado: todas las verificaciones pasaron');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test falló:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
