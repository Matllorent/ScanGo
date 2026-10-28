/**
 * tests/test-prep-estimate.js — F7 "El Tiempo Real": estimación HONESTA de
 * preparación (Serie 6 "El Sistema", 60ª suite)
 * ─────────────────────────────────────────────────────────────────────────────
 * §1  Módulo puro `api/utils/prepEstimate.js`: constantes explícitas, ventana
 *     de 7 días con reloj inyectable, `prepMinutesForOrder` (solo `delivered`,
 *     dual camel/snake, delta positivo, zombis > 4 h afuera, timestamps basura
 *     → null, nunca throw) y el parser de tiempos (`toMs`).
 * §2  Percentiles nearest-rank (sin interpolación: no inventa decimales), copy
 *     del chip (`~12–18 min` / `~12 min`) y `computePrepEstimate`: menos de 20
 *     muestras → null (omitir antes que inventar), cancelados/otros estados
 *     afuera, tope de filas, `generatedAt` con el reloj inyectado y cero mutación
 *     del array de entrada.
 * §3  Sanitizer: `showPrepEstimate` default ON, `false` del dueño se respeta,
 *     idempotente y NO privilegiado (sobrevive el strip anti mass-assignment).
 * §4  Runtime real (server HTTP + store real, cero mocks): con 19 pedidos
 *     entregados en la semana la carta NO inventa un tiempo (`prepEstimate`
 *     null); al llegar a 20+ aparece el número REAL del local; cancelados,
 *     zombis, otros estados y filas sin timestamp NO cuentan; el payload nunca
 *     expone pedidos ni PII; la cache de 10 min amortigua las consultas; el
 *     toggle del dueño apaga el ETA en carta Y en seguimiento; `/track/:token`
 *     lo devuelve sin datos del comensal y una demo nunca lo inventa.
 * §5  Wiring estático + contrato: checkbox del Studio, línea del checkout,
 *     línea del seguimiento escapada, gate/caché/fail-open del servicio, unión
 *     nube ∪ espejo en `db.getOrderPrepRows`, `openapi.yaml` y las reglas de la
 *     casa (cero `on*=`, módulo puro sin I/O).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = require('../api/index');
const db = require('../src/db/db');
const prep = require('../api/utils/prepEstimate');
const { getPrepEstimateForRestaurant, clearPrepEstimateCache } = require('../api/services/prepEstimate');
const { signOrderToken } = require('../api/utils/orderTrackingToken');
const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');
const { stripPrivilegedFields } = require('../api/utils/stripPrivilegedFields');
const { invalidateMenuCache } = require('../api/middleware/cache');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const MIN = 60 * 1000;
const orderWith = (over = {}) => ({
  id: 'ord_x',
  status: 'delivered',
  created_at: '2025-10-24T18:00:00.000Z',
  status_updated_at: '2025-10-24T18:15:00.000Z',
  ...over
});

async function runTests() {
  console.log('🔎 Iniciando verificación de la estimación de preparación (F7)...');

  // ── §1 Módulo puro: constantes, ventana y minutos por pedido ─────────────
  assert.strictEqual(prep.PREP_WINDOW_DAYS, 7, 'la evidencia es de la última semana');
  assert.strictEqual(prep.PREP_MIN_SAMPLES, 20, 'menos de 20 pedidos es anécdota, no estadística');
  assert.strictEqual(prep.PREP_MAX_MINUTES, 240, 'un pedido de 4 h no es preparación: es un estado sin cerrar');
  assert.strictEqual(prep.PREP_CACHE_MS, 10 * 60 * 1000, 'el chip no necesita frescura de segundos');
  assert.strictEqual(prep.PREP_MAX_ROWS, 500, 'tope de filas para una carta chica o una semana intensa');
  assert.deepStrictEqual(prep.PREP_TERMINAL_STATUSES, ['delivered'], 'solo lo ENTREGADO mide un tiempo completo');

  const now = Date.parse('2025-10-24T18:00:00.000Z');
  const win = prep.getPrepWindow(now);
  assert.strictEqual(win.endIso, '2025-10-24T18:00:00.000Z', 'la ventana cierra en el instante consultado');
  assert.strictEqual(win.startIso, '2025-10-17T18:00:00.000Z', 'la ventana son exactamente 7 días');
  assert.strictEqual(prep.getPrepWindow(now + 24 * 60 * MIN).startIso, '2025-10-18T18:00:00.000Z',
    'la ventana se desplaza con el reloj (no está hardcodeada)');
  const junkWin = prep.getPrepWindow('basura');
  assert.ok(!Number.isNaN(Date.parse(junkWin.endIso)), 'reloj basura → cae a ahora, nunca throw');
  assert.ok(Date.parse(junkWin.startIso) < Date.parse(junkWin.endIso), 'la ventana siempre es positiva');

  // toMs: acepta ms, string numérica e ISO; basura → null.
  assert.strictEqual(prep.toMs(1000), 1000, 'epoch ms pasa tal cual');
  assert.strictEqual(prep.toMs('123'), 123, 'string numérica se interpreta como ms');
  assert.strictEqual(prep.toMs('2025-10-24T18:00:00.000Z'), now, 'ISO se parsea');
  for (const junk of [null, undefined, '', 'basura', NaN, Infinity, {}, []]) {
    assert.strictEqual(prep.toMs(junk), null, `toMs(${String(junk)}) → null`);
  }

  // prepMinutesForOrder: la medición real de UN pedido.
  assert.strictEqual(prep.prepMinutesForOrder(orderWith()), 15, 'delivered: 15 min entre alta y entrega');
  assert.strictEqual(
    prep.prepMinutesForOrder({ status: 'DELIVERED', createdAt: '2025-10-24T18:00:00.000Z', statusUpdatedAt: '2025-10-24T18:12:00.000Z' }),
    12,
    'acepta camelCase y estado en mayúsculas'
  );
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ status: 'ready' })), null, 'ready todavía no terminó');
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ status: 'cancelled' })), null, 'cancelado no mide cocina');
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ status: 'pending' })), null, 'pendiente no mide nada');
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ status_updated_at: undefined })), null,
    'sin timestamp de cierre no hay muestra (nunca se supone)');
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ created_at: undefined })), null, 'sin alta no hay delta');
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ created_at: '2025-10-24T18:15:00.000Z' })), null,
    'delta negativo (reloj inconsistente) se descarta');
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ status_updated_at: '2025-10-24T18:00:00.000Z' })), null,
    'delta cero no es una preparación');
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ status_updated_at: '2025-10-24T22:00:00.000Z' })), 240,
    '4 h exactas todavía se aceptan (borde inclusivo)');
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ status_updated_at: '2025-10-25T04:00:00.000Z' })), null,
    'más de 4 h es un estado zombi, no un tiempo de cocina');
  assert.strictEqual(prep.prepMinutesForOrder(orderWith({ created_at: 'basura' })), null, 'timestamp basura → null');
  for (const junk of [null, undefined, 'texto', 42, []]) {
    assert.strictEqual(prep.prepMinutesForOrder(junk), null, 'entrada basura nunca rompe');
  }

  console.log('✅ §1 Puro: constantes, ventana inyectable, solo entregados con delta real, zombis afuera');

  // ── §2 Percentiles, copy y estimación ────────────────────────────────────
  assert.strictEqual(prep.percentile([], 50), null, 'sin datos no hay percentil');
  assert.strictEqual(prep.percentile([1, 2, 3, 4], 50), 2, 'nearest-rank par → posición 2');
  assert.strictEqual(prep.percentile([1, 2, 3, 4, 5], 50), 3, 'nearest-rank impar → la mediana');
  assert.strictEqual(prep.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9, 'p90 se redondea HACIA ARRIBA en rango');
  assert.strictEqual(prep.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 100), 10, 'p100 es el máximo');
  assert.strictEqual(prep.percentile(null, 50), null, 'entrada no-array → null');

  assert.strictEqual(prep.buildPrepLabel({ p50: 12, p90: 18 }), '~12–18 min', 'la copy del chip usa un rango real');
  assert.strictEqual(prep.buildPrepLabel({ p50: 12, p90: 12 }), '~12 min', 'si p50 y p90 coinciden, un solo número');
  assert.strictEqual(prep.buildPrepLabel({ p50: 15, p90: 9 }), '~15 min', 'p90 menor que p50 no inventa un rango invertido');
  for (const junk of [{}, { p50: 0, p90: 10 }, { p50: 'x', p90: 10 }, null]) {
    assert.strictEqual(prep.buildPrepLabel(junk), '', `label(${JSON.stringify(junk)}) → vacío`);
  }

  // Menos de 20 muestras → null: el chip NO aparece (regla de la casa).
  const nineteen = Array.from({ length: 19 }, (_, i) => orderWith({ id: `ord_19_${i}` }));
  assert.strictEqual(prep.computePrepEstimate(nineteen, { nowMs: now }), null,
    '19 pedidos entregados no alcanzan para afirmar un tiempo');
  assert.strictEqual(prep.computePrepEstimate([], { nowMs: now }), null, 'sin pedidos → null');
  assert.strictEqual(prep.computePrepEstimate(null, { nowMs: now }), null, 'entrada nula → null, nunca throw');

  // 20 entregados consistentes → un único número (honesto).
  const twenty = Array.from({ length: 20 }, (_, i) => orderWith({
    id: `ord_20_${i}`,
    status_updated_at: '2025-10-24T18:12:00.000Z'
  }));
  const single = prep.computePrepEstimate(twenty, { nowMs: now });
  assert.ok(single, '20 muestras alcanzan');
  assert.strictEqual(single.samples, 20, 'la evidencia informa cuántos pedidos midió');
  assert.strictEqual(single.p50, 12, 'p50 real');
  assert.strictEqual(single.p90, 12, 'p90 real');
  assert.strictEqual(single.label, '~12 min', 'sin cola, un solo número (no se inventa un rango)');
  assert.strictEqual(single.min, single.p50, 'min es el p50 redondeado');
  assert.strictEqual(single.max, single.p90, 'max es el p90 redondeado');
  assert.strictEqual(single.windowDays, 7, 'la ventana viaja para que la copy sea verificable');
  assert.strictEqual(single.generatedAt, new Date(now).toISOString(), 'generatedAt usa el reloj inyectado');

  // 20 a 12 min + 4 a 30 min (total 24): el p90 muestra la cola.
  const mixed = [
    ...Array.from({ length: 20 }, (_, i) => orderWith({ id: `ord_m12_${i}`, status_updated_at: '2025-10-24T18:12:00.000Z' })),
    ...Array.from({ length: 4 }, (_, i) => orderWith({ id: `ord_m30_${i}`, status_updated_at: '2025-10-24T18:30:00.000Z' }))
  ];
  const ranged = prep.computePrepEstimate(mixed, { nowMs: now });
  assert.strictEqual(ranged.samples, 24, 'todas las muestras válidas cuentan');
  assert.strictEqual(ranged.p50, 12, 'la mitad de los pedidos sale en 12 min');
  assert.strictEqual(ranged.p90, 30, 'la cola (p90) refleja los pedidos lentos');
  assert.strictEqual(ranged.label, '~12–30 min', 'el chip muestra el rango, no un promedio que esconde la cola');

  // Lo que no es una muestra completa no entra.
  const withNoise = prep.computePrepEstimate([
    ...twenty,
    orderWith({ id: 'ord_cancel', status: 'cancelled', status_updated_at: '2025-10-24T18:03:00.000Z' }),
    orderWith({ id: 'ord_zombie', status_updated_at: '2025-10-25T04:00:00.000Z' }),
    orderWith({ id: 'ord_pending', status: 'pending', status_updated_at: '2025-10-24T18:08:00.000Z' }),
    orderWith({ id: 'ord_nofinish', status_updated_at: undefined }),
    orderWith({ id: 'ord_badcreate', created_at: 'basura' })
  ], { nowMs: now });
  assert.strictEqual(withNoise.samples, 20, 'cancelados, zombis, pendientes y filas rotas NO inflan la muestra');

  // Tope de filas: nunca procesa más de PREP_MAX_ROWS.
  const many = Array.from({ length: 600 }, (_, i) => orderWith({ id: `ord_many_${i}` }));
  const capped = prep.computePrepEstimate(many, { nowMs: now });
  assert.strictEqual(capped.samples, 500, 'tope de filas explícito');

  // El array de entrada no se muta (se ordena una copia).
  const inputBefore = twenty.slice();
  prep.computePrepEstimate(twenty, { nowMs: now });
  assert.deepStrictEqual(twenty, inputBefore, 'la estimación no muta las filas recibidas');

  console.log('✅ §2 Puro: percentiles nearest-rank, umbral 20, cancelados/zombis afuera, rango honesto, tope de filas');

  // ── §3 Sanitizer: default ON, false respetado, idempotente, no privilegiado ─
  assert.strictEqual(sanitizeRestaurantPayload({}).showPrepEstimate, true, 'ausente = encendido (default ON)');
  assert.strictEqual(sanitizeRestaurantPayload({ showPrepEstimate: undefined }).showPrepEstimate, true, 'undefined = ON');
  assert.strictEqual(sanitizeRestaurantPayload({ showPrepEstimate: true }).showPrepEstimate, true, 'true explícito');
  assert.strictEqual(sanitizeRestaurantPayload({ showPrepEstimate: false }).showPrepEstimate, false, 'false del dueño se respeta');
  assert.strictEqual(sanitizeRestaurantPayload({ showPrepEstimate: 'si' }).showPrepEstimate, true, 'basura ≠ false → ON');

  const once = sanitizeRestaurantPayload({ name: 'Local', showPrepEstimate: false });
  const twice = sanitizeRestaurantPayload(once);
  assert.deepStrictEqual(twice, once, 'sanitizer idempotente (round-trip estable)');

  const stripped = stripPrivilegedFields({ name: 'Local', showPrepEstimate: false });
  assert.strictEqual(stripped.showPrepEstimate, false,
    'showPrepEstimate es configuración del dueño, no identidad: sobrevive el strip');

  console.log('✅ §3 Sanitizer: default ON, false se respeta, idempotente, no privilegiado');

  // ── §4 Runtime real: la carta y el seguimiento dicen el tiempo REAL ──────
  const runTag = Date.now();
  const userA = await db.createUser({
    email: `prep-a-${runTag}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const rest = await db.saveRestaurant(userA.id, {
    name: 'Local del Tiempo', bizName: 'Local del Tiempo',
    slug: `prep-local-${runTag}`,
    phone: '59899222222',
    currency: 'USD',
    utcOffsetMinutes: -180,
    categories: [{ id: 'cat1', name: 'Cocina' }],
    dishes: [{ id: 'dish_a', name: 'Plato', price: 10, categoryId: 'cat1' }]
  });
  assert.ok(rest && rest.id, 'restaurante fixture creado');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const menuUrl = `${base}/api/menu/${rest.slug}`;

  const nowMs = Date.now();
  const createdMs = nowMs - 2 * 24 * 60 * 60 * 1000; // hace 2 días: dentro de la ventana
  const createdIso = new Date(createdMs).toISOString();
  const finishedIso = (minutes) => new Date(createdMs + minutes * MIN).toISOString();

  const seed = (id, status, minutes, extra = {}) => {
    const record = {
      id: `ord_prep_${id}_${runTag}`,
      restaurant_id: rest.id,
      restaurantId: rest.id,
      status,
      currency: 'USD',
      amount: 10,
      total: 10,
      created_at: createdIso,
      items_snapshot: [{ dishId: 'dish_a', name: 'Plato', quantity: 1 }],
      ...extra
    };
    if (minutes !== null) record.status_updated_at = finishedIso(minutes);
    return db.addOrder(record);
  };

  const getMenu = async () => {
    invalidateMenuCache(rest.slug);
    const res = await fetch(menuUrl);
    assert.strictEqual(res.status, 200, 'GET /api/menu/:slug → 200');
    const body = await res.json();
    return body.restaurant;
  };

  // Fase A: 19 entregados en la semana. Menos del mínimo → NO se inventa nada.
  for (let i = 0; i < 19; i++) await seed(`a${i}`, 'delivered', 12);
  clearPrepEstimateCache();
  let menu = await getMenu();
  assert.strictEqual(menu.prepEstimate, null, '19 entregados: la carta prefiere no mostrar un tiempo');
  assert.strictEqual(menu.showPrepEstimate, true, 'el flag del dueño viaja (default ON)');

  // Fase B: 5 entregados más (24 muestras) + basura que NO debe contar.
  for (let i = 0; i < 5; i++) await seed(`b${i}`, 'delivered', 30);
  const pendingOrderId = `ord_prep_pending_${runTag}`;
  await seed('cancelled', 'cancelled', 5);
  await seed('zombie', 'delivered', 600);
  await seed('ready', 'ready', 6);
  await seed('nofinish', 'delivered', null);
  await seed('badcreate', 'delivered', 12, { created_at: 'basura' });
  await seed('pending', 'pending', 4, { id: pendingOrderId });

  clearPrepEstimateCache();
  menu = await getMenu();
  const estimate = menu.prepEstimate;
  assert.ok(estimate && typeof estimate === 'object', 'con 20+ entregados la carta muestra el tiempo real del local');
  assert.strictEqual(estimate.samples, 24, 'solo los entregados válidos cuentan (cancelados/zombis/otros estados afuera)');
  assert.strictEqual(estimate.p50, 12, 'p50 real de la semana');
  assert.strictEqual(estimate.p90, 30, 'p90 real de la semana');
  assert.strictEqual(estimate.label, '~12–30 min', 'la copy es el rango real');
  assert.strictEqual(estimate.windowDays, 7, 'la ventana viaja en el payload');
  assert.deepStrictEqual(
    Object.keys(estimate).sort(),
    ['generatedAt', 'label', 'max', 'min', 'p50', 'p90', 'samples', 'windowDays'],
    'el payload SOLO lleva la estimación: ningún pedido ni fila cruda'
  );
  assert.ok(!Number.isNaN(Date.parse(estimate.generatedAt)), 'generatedAt válido');

  const menuJson = JSON.stringify(menu);
  assert.ok(!menuJson.includes('ord_prep_'), 'los IDs de pedidos NO viajan al comensal');
  assert.ok(!menuJson.includes('status_updated_at'), 'los timestamps internos NO viajan al comensal');
  assert.ok(!menuJson.includes('customer_phone'), 'ningún dato de contacto de comensales en la carta');

  // Cache de 10 min: 5 pedidos más NO cambian el número hasta que expira/limpia.
  for (let i = 0; i < 5; i++) await seed(`c${i}`, 'delivered', 30);
  menu = await getMenu(); // invalida SOLO la cache del menú, no la del servicio
  assert.strictEqual(menu.prepEstimate.samples, 24, 'la cache de 10 min evita una consulta de pedidos por request');

  clearPrepEstimateCache();
  menu = await getMenu();
  assert.strictEqual(menu.prepEstimate.samples, 29, 'al expirar la cache, los pedidos nuevos entran');

  // Toggle del dueño: apagado no consulta y el ETA desaparece (carta y seguimiento).
  await db.saveRestaurant(userA.id, { ...db.findRestaurantById(rest.id), showPrepEstimate: false });
  clearPrepEstimateCache();
  menu = await getMenu();
  assert.strictEqual(menu.showPrepEstimate, false, 'el payload expone el flag apagado');
  assert.strictEqual(menu.prepEstimate, null, 'apagado → la carta no muestra ningún tiempo');

  const token = signOrderToken(pendingOrderId);
  let trackRes = await fetch(`${base}/api/orders/track/${token}`);
  assert.strictEqual(trackRes.status, 200, 'GET /api/orders/track/:token → 200');
  let trackBody = await trackRes.json();
  assert.strictEqual(trackBody.data.prepEstimate, null, 'apagado por el dueño: el seguimiento tampoco muestra ETA');
  assert.strictEqual(trackBody.data.orderId, pendingOrderId, 'el seguimiento sigue funcionando');

  // Vuelta a ON: el seguimiento muestra el mismo número del local, sin PII.
  await db.saveRestaurant(userA.id, { ...db.findRestaurantById(rest.id), showPrepEstimate: true });
  clearPrepEstimateCache();
  menu = await getMenu();
  assert.strictEqual(menu.prepEstimate.samples, 29, 'el toggle ON vuelve a calcular');

  trackRes = await fetch(`${base}/api/orders/track/${token}`);
  trackBody = await trackRes.json();
  const trackEstimate = trackBody.data.prepEstimate;
  assert.ok(trackEstimate && trackEstimate.label, 'el seguimiento muestra cuánto tardan los pedidos del local');
  assert.strictEqual(trackEstimate.label, '~12–30 min', 'es el MISMO número del local (una sola fuente)');
  const trackJson = JSON.stringify(trackBody);
  for (const forbidden of ['customer_phone', 'customerPhone', 'address', 'notes', 'deliveryAddress', 'customerName', 'phone']) {
    assert.ok(!trackJson.includes(forbidden), `el seguimiento no expone ${forbidden}`);
  }

  const badTrack = await fetch(`${base}/api/orders/track/token-que-no-existe`);
  assert.strictEqual(badTrack.status, 404, 'token inválido → 404 (sin ETA para un pedido ajeno)');

  // Una demo nunca tiene pedidos reales: jamás inventa un tiempo.
  const demoRes = await fetch(`${base}/api/menu/demo-heladeria`);
  assert.strictEqual(demoRes.status, 200, 'la demo pública responde 200');
  const demoBody = await demoRes.json();
  assert.strictEqual(demoBody.restaurant.prepEstimate, null, 'una demo no inventa un ETA');
  assert.strictEqual(demoBody.restaurant.showPrepEstimate, true, 'la demo expone el default del flag');

  await new Promise((resolve) => server.close(resolve));

  console.log('✅ §4 Runtime: 19→null, 20+→número real, basura afuera, sin PII, cache 10 min, toggle apaga carta y seguimiento, demo null');

  // ── §5 Wiring estático + contrato + reglas de la casa ────────────────────
  const menuHtml = read('public/menu.html');
  assert.ok(menuHtml.includes('id="prepEstimateLine"'), 'línea del ETA en el resumen del checkout');
  assert.ok(/id="prepEstimateLine"[^>]*display:none/.test(menuHtml), 'oculta por defecto (sin estimación no existe)');
  assert.ok(!/id="prepEstimateLine"[^>]*\bon[a-z]+\s*=/i.test(menuHtml), 'cero on*= en la línea nueva (CSP)');

  const menuJs = read('public/js/menu.js');
  assert.ok(menuJs.includes('function updatePrepEstimateLine()'), 'el checkout pinta la línea con una función propia');
  assert.ok(menuJs.includes('restaurantData.prepEstimate'), 'la estimación viene del servidor, no se calcula en el browser');
  assert.ok(/updateTotals\(\)\s*\{[\s\S]*updatePrepEstimateLine\(\)/.test(menuJs),
    'la línea se refresca en cada recálculo del total');
  assert.ok(menuJs.includes('line.style.display = \'none\''), 'sin estimación la línea se oculta');

  const tracking = read('public/js/menu/orderTracking.js');
  assert.ok(tracking.includes('data.prepEstimate'), 'el seguimiento usa la estimación del token');
  assert.ok(tracking.includes('escapeHtml(String(prep.label))'), 'la etiqueta se escapa antes de pintar');
  assert.ok(tracking.includes("status !== 'delivered'") && tracking.includes("status !== 'cancelled'"),
    'entregado/cancelado ya no muestran un ETA (no aplica)');

  const studioHtml = read('public/studio.html');
  assert.ok(studioHtml.includes('id="inputShowPrepEstimate"'), 'interruptor del dueño en Mi Local');
  assert.ok(studioHtml.includes('id="sliderShowPrepEstimate"'), 'slider del interruptor');
  assert.ok(/id="inputShowPrepEstimate"[^>]*aria-label=/.test(studioHtml), 'el toggle tiene nombre accesible');

  const studioJs = read('public/js/studio.js');
  assert.ok(studioJs.includes("el('inputShowPrepEstimate')"), 'el Studio lee el toggle');
  assert.ok(studioJs.includes('restaurant.showPrepEstimate = prepEstimateCheck.checked !== false'),
    'al guardar, default ON (apagado explícito se respeta)');
  assert.ok(studioJs.includes('prepLoad.checked = restaurant.showPrepEstimate !== false'),
    'al cargar, default ON');

  const sanitizeSrc = read('api/utils/sanitizeRestaurant.js');
  assert.ok(sanitizeSrc.includes('clean.showPrepEstimate = clean.showPrepEstimate !== false'),
    'sanitizer server-side con default ON');

  const menuRoute = read('api/routes/menu.js');
  assert.ok(menuRoute.includes('getPrepEstimateBundleForRestaurant'), 'la carta pide el bundle de estimación al servicio');
  assert.ok(menuRoute.includes('prepEstimate: prepEstimateValue'), 'el payload público lleva la estimación');
  assert.ok(menuRoute.includes('showPrepEstimate: restaurant.showPrepEstimate !== false'), 'el payload lleva el flag');
  assert.ok(menuRoute.includes('prepEstimate: null'), 'una demo nunca inventa un ETA');

  const ordersRoute = read('api/routes/orders.js');
  assert.ok(/getPrepEstimateBundleForRestaurant\(restaurant\)/.test(ordersRoute), 'el seguimiento pide el bundle de estimación');
  assert.ok(ordersRoute.includes('prepEstimate,'), 'el seguimiento la devuelve');

  const service = read('api/services/prepEstimate.js');
  assert.ok(service.includes("restaurant.showPrepEstimate === false"), 'apagado por el dueño = cero consultas');
  assert.ok(service.includes('PREP_CACHE_MS'), 'cache por restaurante');
  assert.ok(/catch \(err\)/.test(service) && service.includes('return null'),
    'fail-open: si la consulta falla, la carta se sirve sin ETA');
  assert.ok(service.includes('clearPrepEstimateCache'), 'la cache se puede limpiar (testeable)');

  const dbSrc = read('src/db/db.js');
  assert.ok(dbSrc.includes('async getOrderPrepRows('), 'db expone la consulta de filas de preparación');
  assert.ok(/created_at[\s\S]{0,200}status_updated_at/.test(dbSrc), 'consulta los dos timestamps que miden la preparación');
  assert.ok(dbSrc.includes("const baseColumns = 'id, status, created_at'"), 'columnas mínimas (sin PII)');
  assert.ok(dbSrc.includes('/status_updated_at/i.test'), 'degradación honesta si la migración 004 no está en cloud');
  assert.ok(dbSrc.includes('!cloudFinished && localFinished'), 'la nube no borra el timestamp que el espejo sí tiene');

  // Módulo puro: sin I/O ni dependencias de capas (guard de arquitectura B).
  const pureSrc = read('api/utils/prepEstimate.js');
  assert.ok(!/require\(/.test(pureSrc), 'módulo puro sin requires');
  assert.ok(!/supabase|readJson|writeJson|express/i.test(pureSrc), 'cero I/O en la lógica de decisión');

  // Contrato público documentado.
  const openapi = read('openapi.yaml');
  assert.ok(openapi.includes('showPrepEstimate:'), 'openapi: flag del dueño');
  assert.ok(/prepEstimate:\s*\n\s+type: object\s*\n\s+nullable: true/.test(openapi),
    'openapi: estimación nullable en el payload público');

  console.log('✅ §5 Wiring: Studio + checkout + seguimiento + servicio + db + contrato, cero on*= en lo nuevo');
  console.log('🎉 test-prep-estimate: F7 "El Tiempo Real" OK');
}

runTests().catch((err) => {
  console.error('❌ test-prep-estimate falló:', err && err.stack ? err.stack : err);
  process.exit(1); // el server HTTP abierto no deja drenar el event loop
});
