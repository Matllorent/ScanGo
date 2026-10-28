/**
 * tests/test-prep-estimate-v2.js — F7-v2 "El Tiempo Real": ETA POR MODALIDAD
 * (Serie "El Sistema", 68ª suite)
 * ─────────────────────────────────────────────────────────────────────────────
 * La migración 009 (orders.order_mode, aplicada en cloud) mató el deliberate
 * skip de F7: hoy cada pedido sabe si fue Salón/Delivery/Takeaway.
 *
 * §1  Módulo puro `api/utils/prepEstimate.js` extendido: `prepModeForOrder`
 *     (dual camel/snake, normaliza, basura → 'LOCAL' legacy) y
 *     `computePrepEstimates` — estimación GENERAL + POR MODALIDAD en UNA sola
 *     pasada; cada modalidad exige SU PROPIO mínimo de 20 muestras (20 pedidos
 *     en total NO autorizan un ETA de delivery con 3 delivery); `all` es
 *     EXACTAMENTE `computePrepEstimate` (compat 60ª suite, cero drift);
 *     cancelados/zombis/filas rotas afuera por modo; sin mutar la entrada.
 * §2  Servicio: el bundle completo vive en la MISMA entrada de cache de 10 min
 *     (identidad observable de objeto), gate OFF → null sin consultar, y el
 *     getter F7 legacy sigue devolviendo `bundle.all` intacto.
 * §3  Runtime real (server HTTP + store real, cero mocks): la carta expone
 *     `prepEstimate` (general) + `prepEstimateByMode` con las 3 claves
 *     canónicas SIEMPRE presentes cuando el ETA está encendido (patrón
 *     soldOutToday/waLink); sin contaminación cruzada entre modalidades; el
 *     seguimiento expone `orderMode` + el bundle sin PII; el toggle del dueño
 *     apaga AMBOS en carta Y seguimiento; la cache amortigua; una demo nunca
 *     inventa nada.
 * §4  Wiring estático + contrato: rutas con bundle, pick por modalidad en
 *     checkout (menu.js) y seguimiento (orderTracking.js) compartiendo el
 *     MISMO helper puro, degradación `order_mode` en db, openapi documentado.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = require('../api/index');
const db = require('../src/db/db');
const prep = require('../api/utils/prepEstimate');
const { getPrepEstimateBundleForRestaurant, getPrepEstimateForRestaurant, clearPrepEstimateCache } = require('../api/services/prepEstimate');
const { signOrderToken } = require('../api/utils/orderTrackingToken');
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
  console.log('🔎 Iniciando verificación del ETA por modalidad (F7-v2)...');

  // ── §1 Módulo puro: modalidad canónica + bundle en una pasada ───────────
  assert.deepStrictEqual(prep.PREP_MODES, ['LOCAL', 'DELIVERY', 'TAKEAWAY'],
    'las 3 modalidades canónicas del CHECK de la migración 009');

  // prepModeForOrder: dual camel/snake, normaliza, basura → LOCAL (legacy).
  assert.strictEqual(prep.prepModeForOrder({ order_mode: 'DELIVERY' }), 'DELIVERY', 'snake_case cloud');
  assert.strictEqual(prep.prepModeForOrder({ orderMode: 'TAKEAWAY' }), 'TAKEAWAY', 'camelCase espejo local');
  assert.strictEqual(prep.prepModeForOrder({ order_mode: 'delivery' }), 'DELIVERY', 'la nube puede traer minúsculas: se normaliza');
  assert.strictEqual(prep.prepModeForOrder({ order_mode: ' delivery ' }), 'DELIVERY', 'espacios de más no parten la modalidad');
  assert.strictEqual(prep.prepModeForOrder({}), 'LOCAL', 'fila histórica sin modo → LOCAL (asunción legacy de la casa)');
  assert.strictEqual(prep.prepModeForOrder({ order_mode: 'mesa' }), 'LOCAL', 'una modalidad que no existe nunca se inventa');
  assert.strictEqual(prep.prepModeForOrder({ order_mode: 42 }), 'LOCAL', 'no-string → LOCAL');
  assert.strictEqual(prep.prepModeForOrder(null), 'LOCAL', 'entrada nula → LOCAL, nunca throw');
  assert.strictEqual(prep.prepModeForOrder('texto'), 'LOCAL', 'no-objeto → LOCAL');

  // computePrepEstimates: la GENERAL es EXACTAMENTE computePrepEstimate (compat).
  const now = Date.parse('2025-10-24T18:00:00.000Z');
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => orderWith({ id: `ord_l${i}`, order_mode: 'LOCAL', status_updated_at: '2025-10-24T18:12:00.000Z' })),
    ...Array.from({ length: 24 }, (_, i) => orderWith({ id: `ord_d${i}`, order_mode: 'DELIVERY', status_updated_at: '2025-10-24T18:30:00.000Z' })),
    ...Array.from({ length: 3 }, (_, i) => orderWith({ id: `ord_t${i}`, orderMode: 'TAKEAWAY', status_updated_at: '2025-10-24T18:10:00.000Z' })),
    orderWith({ id: 'ord_cancel', order_mode: 'DELIVERY', status: 'cancelled', status_updated_at: '2025-10-24T18:05:00.000Z' }),
    orderWith({ id: 'ord_zombie', order_mode: 'DELIVERY', status_updated_at: '2025-10-25T04:00:00.000Z' })
  ];
  const bundle = prep.computePrepEstimates(rows, { nowMs: now });
  assert.deepStrictEqual(bundle.all, prep.computePrepEstimate(rows, { nowMs: now }),
    'la general del bundle es EXACTAMENTE la estimación de F7 (una sola fuente, cero drift)');

  // Reparto por modalidad: la general sumó 47 (20+24+3), cada modo lo suyo.
  assert.strictEqual(bundle.all.samples, 47, 'la general sigue sumando TODAS las modalidades');
  assert.deepStrictEqual(Object.keys(bundle.byMode).sort(), ['DELIVERY', 'LOCAL', 'TAKEAWAY'],
    'byMode lleva las 3 claves canónicas SIEMPRE (objeto estable, patrón soldOutToday)');
  assert.strictEqual(bundle.byMode.LOCAL.samples, 20, 'los 20 delivery NO contaminan salón');
  assert.strictEqual(bundle.byMode.LOCAL.label, '~12 min', 'el ETA de salón es el real de salón');
  assert.strictEqual(bundle.byMode.DELIVERY.samples, 24, 'delivery midió sus propios pedidos');
  assert.strictEqual(bundle.byMode.DELIVERY.label, '~30 min', 'el ETA de delivery es el real de delivery');
  assert.strictEqual(bundle.byMode.TAKEAWAY, null, '3 takeaways no alcanzan: null, no se inventa');

  // El mínimo es POR MODALIDAD: 19 de cada modo (38 en total) NO da ETA por modo.
  const nineteenEach = [
    ...Array.from({ length: 19 }, (_, i) => orderWith({ id: `ord_le${i}`, order_mode: 'LOCAL', status_updated_at: '2025-10-24T18:12:00.000Z' })),
    ...Array.from({ length: 19 }, (_, i) => orderWith({ id: `ord_de${i}`, order_mode: 'DELIVERY', status_updated_at: '2025-10-24T18:12:00.000Z' }))
  ];
  const splitBundle = prep.computePrepEstimates(nineteenEach, { nowMs: now });
  assert.strictEqual(splitBundle.all.samples, 38, 'juntas alcanzan el mínimo general');
  assert.strictEqual(splitBundle.byMode.LOCAL, null, '19 salón no autorizan un ETA de salón');
  assert.strictEqual(splitBundle.byMode.DELIVERY, null, '19 delivery no autorizan un ETA de delivery');

  // Sin datos: el objeto por modalidad SIEMPRE existe con sus 3 claves en null.
  const emptyBundle = prep.computePrepEstimates([], { nowMs: now });
  assert.strictEqual(emptyBundle.all, null, 'sin filas no hay general');
  assert.deepStrictEqual(Object.keys(emptyBundle.byMode).sort(), ['DELIVERY', 'LOCAL', 'TAKEAWAY'],
    'sin filas el objeto por modalidad sigue siendo estable (3 claves)');
  assert.strictEqual(prep.computePrepEstimates(null, { nowMs: now }).all, null, 'entrada nula → all null, nunca throw');

  // Filas históricas SIN modo cuentan en LOCAL (legacy), y las rotas se saltan.
  const legacyBundle = prep.computePrepEstimates([
    ...Array.from({ length: 18 }, (_, i) => orderWith({ id: `ord_lm${i}`, status_updated_at: '2025-10-24T18:12:00.000Z' })),
    ...Array.from({ length: 2 }, (_, i) => orderWith({ id: `ord_leg${i}`, status_updated_at: '2025-10-24T18:25:00.000Z' })),
    null,
    'basura',
    orderWith({ id: 'ord_bad', created_at: 'basura' })
  ], { nowMs: now });
  assert.strictEqual(legacyBundle.byMode.LOCAL.samples, 20, 'sin order_mode cae en LOCAL (legacy documentado)');

  // Tope de filas compartido y hora generada con el reloj inyectado.
  const cappedRows = [
    ...Array.from({ length: 300 }, (_, i) => orderWith({ id: `ord_c_l${i}`, order_mode: 'LOCAL', status_updated_at: '2025-10-24T18:12:00.000Z' })),
    ...Array.from({ length: 300 }, (_, i) => orderWith({ id: `ord_c_d${i}`, order_mode: 'DELIVERY', status_updated_at: '2025-10-24T18:12:00.000Z' }))
  ];
  const capped = prep.computePrepEstimates(cappedRows, { nowMs: now });
  assert.strictEqual(capped.all.samples, 500, 'el tope PREP_MAX_ROWS es compartido por todas las modalidades');
  assert.strictEqual(capped.byMode.LOCAL.samples, 300, 'el reparto respeta el orden de llegada tras el tope');
  assert.strictEqual(capped.byMode.DELIVERY.samples, 200, 'el reparto respeta el orden de llegada tras el tope');
  assert.strictEqual(bundle.all.generatedAt, new Date(now).toISOString(), 'generatedAt usa el reloj inyectado en TODAS las estimaciones');
  assert.strictEqual(bundle.byMode.DELIVERY.generatedAt, new Date(now).toISOString(), 'generatedAt también inyectable por modalidad');

  // El array de entrada no se muta (los sorts corren sobre copias internas).
  const inputBefore = JSON.parse(JSON.stringify(rows));
  prep.computePrepEstimates(rows, { nowMs: now });
  assert.deepStrictEqual(rows, inputBefore, 'el bundle no muta las filas recibidas');

  console.log('✅ §1 Puro: modalidad canónica legacy→LOCAL, una pasada, mínimo POR modalidad, general = computePrepEstimate');

  // ── §2 Servicio: bundle en la MISMA entrada de cache + compat getter ─────
  const runTag = Date.now();
  const userB = await db.createUser({
    email: `prep-v2-b-${runTag}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restB = await db.saveRestaurant(userB.id, {
    name: 'Bundle Cache Local', bizName: 'Bundle Cache Local',
    slug: `prep-v2-cache-${runTag}`,
    phone: '59899333333',
    currency: 'USD',
    categories: [{ id: 'cat1', name: 'Cocina' }],
    dishes: [{ id: 'dish_b', name: 'Plato', price: 8, categoryId: 'cat1' }]
  });
  assert.ok(restB && restB.id, 'restaurante de cache creado');

  const nowMsCache = Date.now();
  const createdCache = nowMsCache - 60 * MIN;
  for (let i = 0; i < 3; i++) {
    await db.addOrder({
      id: `ord_cache_${i}_${runTag}`,
      restaurant_id: restB.id,
      restaurantId: restB.id,
      status: 'delivered',
      currency: 'USD',
      amount: 8,
      total: 8,
      created_at: new Date(createdCache).toISOString(),
      status_updated_at: new Date(createdCache + 10 * MIN).toISOString(),
      order_mode: 'LOCAL',
      orderMode: 'LOCAL',
      items_snapshot: [{ dishId: 'dish_b', name: 'Plato', quantity: 1 }]
    });
  }
  clearPrepEstimateCache();

  const fixedNow = Date.now();
  const bundle1 = await getPrepEstimateBundleForRestaurant(restB, { nowMs: fixedNow });
  assert.ok(bundle1 && bundle1.byMode, 'el bundle se consulta y devuelve el objeto por modalidad');
  assert.strictEqual(bundle1.all, null, '3 entregados: la general sigue siendo null (mínimo intacto)');
  assert.strictEqual(bundle1.byMode.LOCAL, null, 'y el de salón también (menos de 20)');
  const bundle2 = await getPrepEstimateBundleForRestaurant(restB, { nowMs: fixedNow + 1000 });
  assert.strictEqual(bundle2, bundle1, 'la MISMA entrada de cache sirve el bundle entero (identidad observable, cero re-consulta)');

  const legacyValue = await getPrepEstimateForRestaurant(restB, { nowMs: fixedNow + 2000 });
  assert.strictEqual(legacyValue, bundle1.all, 'el getter F7 legacy devuelve bundle.all SIN segunda consulta');
  assert.strictEqual(legacyValue, null, 'compat: el getter sigue siendo honesto con muestra corta');

  const offBundle = await getPrepEstimateBundleForRestaurant(
    { ...restB, showPrepEstimate: false },
    { nowMs: fixedNow + 3000 }
  );
  assert.strictEqual(offBundle, null, 'gate OFF → null ANTES de consultar (cero costo)');
  const offLegacy = await getPrepEstimateForRestaurant({ ...restB, showPrepEstimate: false }, { nowMs: fixedNow + 4000 });
  assert.strictEqual(offLegacy, null, 'el getter legacy respeta el mismo gate');

  clearPrepEstimateCache();
  console.log('✅ §2 Servicio: bundle cacheado como una entrada, getter F7 intacto, gate OFF no consulta');

  // ── §3 Runtime real: carta + seguimiento con el número por modalidad ────
  const userA = await db.createUser({
    email: `prep-v2-a-${runTag}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const rest = await db.saveRestaurant(userA.id, {
    name: 'Local de Modalidades', bizName: 'Local de Modalidades',
    slug: `prep-v2-local-${runTag}`,
    phone: '59899444444',
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

  const createdMs = Date.now() - 2 * 24 * 60 * 60 * 1000; // hace 2 días: dentro de la ventana
  const createdIso = new Date(createdMs).toISOString();
  const finishedIso = (minutes) => new Date(createdMs + minutes * MIN).toISOString();

  const seed = (id, status, minutes, extra = {}) => {
    const record = {
      id: `ord_v2_${id}_${runTag}`,
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

  // Semilla con evidencia REAL por modalidad:
  //  salón 20×12 min + legacy 2×25 (sin order_mode) · delivery 20×30 · takeaway 3×10.
  for (let i = 0; i < 20; i++) await seed(`l${i}`, 'delivered', 12, { order_mode: 'LOCAL', orderMode: 'LOCAL' });
  for (let i = 0; i < 2; i++) await seed(`leg${i}`, 'delivered', 25); // histórico sin modo → LOCAL
  for (let i = 0; i < 20; i++) await seed(`d${i}`, 'delivered', 30, { order_mode: 'DELIVERY', orderMode: 'DELIVERY' });
  for (let i = 0; i < 3; i++) await seed(`t${i}`, 'delivered', 10, { order_mode: 'TAKEAWAY', orderMode: 'TAKEAWAY' });
  // Basura que NO debe contar en ninguna modalidad.
  await seed('cancel-d', 'cancelled', 5, { order_mode: 'DELIVERY', orderMode: 'DELIVERY' });
  await seed('zombie-d', 'delivered', 600, { order_mode: 'DELIVERY', orderMode: 'DELIVERY' });
  await seed('ready-l', 'ready', 6, { order_mode: 'LOCAL', orderMode: 'LOCAL' });
  await seed('nofinish-t', 'delivered', null, { order_mode: 'TAKEAWAY', orderMode: 'TAKEAWAY' });

  clearPrepEstimateCache();
  let menu = await getMenu();
  const estimate = menu.prepEstimate;
  const byMode = menu.prepEstimateByMode;
  assert.ok(estimate && typeof estimate === 'object', 'la general aparece con el mínimo del local completo');
  assert.strictEqual(estimate.samples, 45, 'la general sumó las 3 modalidades (20+2+20+3)');
  assert.strictEqual(estimate.label, '~12–30 min', 'la copy general es el rango real');

  assert.ok(byMode && typeof byMode === 'object', 'F7-v2: la carta expone el bundle por modalidad');
  assert.deepStrictEqual(Object.keys(byMode).sort(), ['DELIVERY', 'LOCAL', 'TAKEAWAY'],
    'las 3 claves canónicas SIEMPRE presentes cuando el ETA está encendido');
  assert.strictEqual(byMode.LOCAL.samples, 22, 'salón midió SUS 22 (20 declarados + 2 legacy sin modo)');
  assert.strictEqual(byMode.LOCAL.label, '~12 min', 'ETA de salón real');
  assert.strictEqual(byMode.DELIVERY.samples, 20, 'delivery midió SUS 20 (cancelado/zombi afuera)');
  assert.strictEqual(byMode.DELIVERY.label, '~30 min', 'ETA de delivery real');
  assert.strictEqual(byMode.TAKEAWAY, null, '3 takeaways: null honesto, no se inventa');
  assert.ok(byMode.LOCAL.p50 !== byMode.DELIVERY.p50,
    'modalidades distintas llevan números distintos: la contaminación cruzada sería 12==30 imposible');

  // Forma del estimate: solo agregados, ningún pedido ni timestamp crudo.
  assert.deepStrictEqual(
    Object.keys(byMode.LOCAL).sort(),
    ['generatedAt', 'label', 'max', 'min', 'p50', 'p90', 'samples', 'windowDays'],
    'cada estimación por modalidad SOLO lleva agregados'
  );
  const menuJson = JSON.stringify(menu);
  assert.ok(!menuJson.includes('ord_v2_'), 'los IDs de pedidos NO viajan al comensal');
  assert.ok(!menuJson.includes('order_mode'), 'el modo de cada pedido no se expone por pedido (solo agregados)');

  // Cache: un pedido más NO cambia el número hasta que expira/limpia.
  await seed('extra-l', 'delivered', 12, { order_mode: 'LOCAL', orderMode: 'LOCAL' });
  menu = await getMenu();
  assert.strictEqual(menu.prepEstimateByMode.LOCAL.samples, 22, 'la cache de 10 min amortigua también el bundle');

  clearPrepEstimateCache();
  menu = await getMenu();
  assert.strictEqual(menu.prepEstimateByMode.LOCAL.samples, 23, 'al expirar, la modalidad entra en el recálculo');
  assert.strictEqual(menu.prepEstimate.samples, 46, 'y la general también');

  // Seguimiento: modalidad del pedido + bundle, sin PII.
  const deliveryOrderId = `ord_v2_d0_${runTag}`;
  const token = signOrderToken(deliveryOrderId);
  const trackRes = await fetch(`${base}/api/orders/track/${token}`);
  assert.strictEqual(trackRes.status, 200, 'GET /api/orders/track/:token → 200');
  const trackBody = await trackRes.json();
  assert.strictEqual(trackBody.data.orderMode, 'DELIVERY', 'F7-v2: el seguimiento expone la modalidad canónica del pedido');
  assert.strictEqual(trackBody.data.prepEstimate.samples, 46, 'la general del local viaja igual que siempre');
  assert.ok(trackBody.data.prepEstimateByMode && trackBody.data.prepEstimateByMode.DELIVERY,
    'el bundle por modalidad también viaja en el seguimiento');
  assert.strictEqual(trackBody.data.prepEstimateByMode.DELIVERY.samples, 20, 'el número de delivery es el de delivery');
  const trackJson = JSON.stringify(trackBody);
  for (const forbidden of ['customer_phone', 'customerPhone', 'address', 'notes', 'deliveryAddress', 'customerName']) {
    assert.ok(!trackJson.includes(forbidden), `el seguimiento no expone ${forbidden}`);
  }

  // Toggle del dueño: apagado NO emite NINGUNA estimación (carta y seguimiento).
  await db.saveRestaurant(userA.id, { ...db.findRestaurantById(rest.id), showPrepEstimate: false });
  clearPrepEstimateCache();
  menu = await getMenu();
  assert.strictEqual(menu.showPrepEstimate, false, 'el payload expone el flag apagado');
  assert.strictEqual(menu.prepEstimate, null, 'apagado → la general desaparece');
  assert.strictEqual(menu.prepEstimateByMode, null, 'apagado → el bundle por modalidad TAMBIÉN desaparece');

  let trackOff = await fetch(`${base}/api/orders/track/${token}`);
  let trackOffBody = await trackOff.json();
  assert.strictEqual(trackOffBody.data.prepEstimate, null, 'apagado: el seguimiento no muestra ETA general');
  assert.strictEqual(trackOffBody.data.prepEstimateByMode, null, 'apagado: el seguimiento tampoco muestra bundle');
  assert.strictEqual(trackOffBody.data.orderMode, 'DELIVERY', 'la modalidad del pedido se sigue exponiendo (informativa, no es un ETA)');

  // Vuelta a ON: mismos números reales.
  await db.saveRestaurant(userA.id, { ...db.findRestaurantById(rest.id), showPrepEstimate: true });
  clearPrepEstimateCache();
  menu = await getMenu();
  assert.strictEqual(menu.prepEstimateByMode.DELIVERY.samples, 20, 'el toggle ON vuelve a calcular el bundle');

  // Una demo nunca inventa: ni general ni por modalidad.
  const demoRes = await fetch(`${base}/api/menu/demo-heladeria`);
  assert.strictEqual(demoRes.status, 200, 'la demo pública responde 200');
  const demoBody = await demoRes.json();
  assert.strictEqual(demoBody.restaurant.prepEstimate, null, 'una demo no inventa un ETA general');
  assert.strictEqual(demoBody.restaurant.prepEstimateByMode, null, 'ni un ETA por modalidad');

  await new Promise((resolve) => server.close(resolve));

  console.log('✅ §3 Runtime: general+bundle en carta y seguimiento, mínimo por modalidad, sin PII, cache, toggle, demo null');

  // ── §4 Wiring estático + contrato + reglas de la casa ────────────────────
  const menuRoute = read('api/routes/menu.js');
  assert.ok(menuRoute.includes('getPrepEstimateBundleForRestaurant'), 'la carta pide el bundle al servicio');
  assert.ok(menuRoute.includes('prepEstimateByMode: prepEstimateByModeValue'), 'el payload público lleva la estimación por modalidad');
  assert.ok(menuRoute.includes('prepEstimateByMode: null'), 'una demo nunca inventa el bundle');

  const ordersRoute = read('api/routes/orders.js');
  assert.ok(/getPrepEstimateBundleForRestaurant\(restaurant\)/.test(ordersRoute), 'el seguimiento pide el bundle');
  assert.ok(ordersRoute.includes('prepEstimateByMode,'), 'el seguimiento devuelve el bundle por modalidad');
  assert.ok(ordersRoute.includes('orderMode: prepModeForOrder(order)'), 'el seguimiento expone la modalidad canónica del pedido');

  const service = read('api/services/prepEstimate.js');
  assert.ok(service.includes('computePrepEstimates'), 'el servicio delega en el bundle del módulo puro');
  assert.ok(service.includes('getPrepEstimateBundleForRestaurant') && service.includes('getPrepEstimateForRestaurant'),
    'ambos getters conviven (bundle + compat F7)');
  assert.ok(service.includes("restaurant.showPrepEstimate === false"), 'apagado por el dueño = cero consultas');

  const dbSrc = read('src/db/db.js');
  assert.ok(dbSrc.includes('status_updated_at, order_mode'), 'getOrderPrepRows consulta order_mode junto a los timestamps');
  assert.ok(dbSrc.includes('else if (/order_mode/i.test'), 'degradación honesta si la 009 no está en cloud');
  assert.ok(dbSrc.includes('merged.order_mode = localMode'), 'la nube no borra la modalidad que el espejo sí tiene');

  const menuJs = read('public/js/menu.js');
  assert.ok(menuJs.includes('resolvePrepEstimateForModeMod'), 'el checkout usa el helper compartido (una sola fuente)');
  assert.ok(menuJs.includes('restaurantData.prepEstimateByMode'), 'el checkout lee el bundle del servidor');
  assert.ok(/updateTotals\(\)\s*\{[\s\S]*updatePrepEstimateLine\(\)/.test(menuJs),
    'la línea se refresca en cada recálculo del total');

  const tracking = read('public/js/menu/orderTracking.js');
  assert.ok(tracking.includes('function resolvePrepEstimateForMode'), 'el helper es un módulo puro del repo');
  assert.ok(tracking.includes('resolvePrepEstimateForMode,'), 'y sale por la lista de exports del módulo (barrel → menu.js)');
  assert.ok(tracking.includes('data.prepEstimateByMode') && tracking.includes('data.orderMode'),
    'el seguimiento elige por la modalidad del pedido');
  assert.ok(tracking.includes('escapeHtml(String(prep.label))'), 'la etiqueta se escapa antes de pintar');

  const openapi = read('openapi.yaml');
  const byModeDocs = openapi.split('prepEstimateByMode:').length - 1;
  assert.ok(byModeDocs >= 2, 'openapi: prepEstimateByMode documentado en carta y seguimiento');
  assert.ok(openapi.includes('enum: [LOCAL, DELIVERY, TAKEAWAY]'), 'openapi: orderMode canónico documentado');

  console.log('✅ §4 Wiring: rutas con bundle + helper compartido checkout/seguimiento + db degradada + contrato');
  console.log('🎉 test-prep-estimate-v2: F7-v2 "ETA por modalidad" OK');
}

runTests().catch((err) => {
  console.error('❌ test-prep-estimate-v2 falló:', err && err.stack ? err.stack : err);
  process.exit(1); // el server HTTP abierto no deja drenar el event loop
});
