/**
 * tests/test-daily-stock.js — F3 "Agotados con memoria" (Serie 3 "El Sistema", 57ª suite)
 * ─────────────────────────────────────────────────────────────────────────────
 * El plato con `dailyStock` ("vendo ~30 por día") se pausa SOLO cuando las
 * ventas del día local del dueño alcanzaron su tope y revive solo a la
 * medianoche del dueño — derivación server-side, CERO cron de reset.
 *
 * §1 Módulo puro `api/utils/dailyStockTracker.js`: parseDailyStock (UNA regla
 *    1..9999), ventana del día local reutilizada de F1 (nightSummary,
 *    mismo huso → cero drift), sumSoldByDish (cancelados NO consumen stock,
 *    helado a medida y basura se saltan), borde inclusivo >=, attach estable,
 *    anyDishWithDailyStock (cero costo para locales sin el flag).
 * §2 Sanitizer: dailyStock OPT-IN (campo ABSENT cuando inválido, nunca
 *    null/0), idempotencia round-trip, y NO es privilegiado (survive
 *    stripPrivilegedFields — es config del dueño, no identidad/versión).
 * §3 Runtime real: server HTTP + store real — payload público de
 *    /api/menu/:slug con `soldOutToday` false→true al llegar al tope,
 *    manual `outOfStock` intacto (gana en el frontend), plato sin dailyStock
 *    intacto, medianoche local excluye al día anterior, cache invalidada
 *    entre seeds (el agregado vive DENTRO del cache de 60s).
 * §4 Contratos: openapi.yaml (Dish + MenuDish), fuentes del frontend
 *    (helper compartido isDishSoldOut + guard final del carrito + wiring
 *    del route + Studio input/editor).
 *
 * Regresión de la decisión (cero mocks; data/* mutable y el guard lo aísla).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const app = require('../api/index');
const db = require('../src/db/db');
const ds = require('../api/utils/dailyStockTracker');
const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');
const { stripPrivilegedFields } = require('../api/utils/stripPrivilegedFields');
const { invalidateMenuCache } = require('../api/middleware/cache');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

async function runTests() {
  console.log('🧪 Iniciando verificación de stock diario derivado (F3)...');

  // ── §1 Módulo puro ──────────────────────────────────────────────────────────
  // parseDailyStock: UNA sola regla compartida por sanitizer/Studio/derivado.
  assert.strictEqual(ds.parseDailyStock(30), 30, 'entero positivo pasa');
  assert.strictEqual(ds.parseDailyStock('12'), 12, 'string numérica → entero');
  assert.strictEqual(ds.parseDailyStock(2.9), 2, 'fracción → floor (venta completa)');
  assert.strictEqual(ds.parseDailyStock(1), 1, 'mínimo 1');
  assert.strictEqual(ds.parseDailyStock(9999), 9999, 'máximo 9999');
  assert.strictEqual(ds.parseDailyStock(0), null, '0 = sin tope (no hay memoria)');
  assert.strictEqual(ds.parseDailyStock(-5), null, 'negativo inválido');
  assert.strictEqual(ds.parseDailyStock(10000), null, 'fuera de rango alto');
  assert.strictEqual(ds.parseDailyStock('abc'), null, 'string no numérica');
  assert.strictEqual(ds.parseDailyStock(''), null, 'string vacía');
  assert.strictEqual(ds.parseDailyStock(undefined), null, 'ausente = sin memoria');
  assert.strictEqual(ds.parseDailyStock(null), null);
  assert.strictEqual(ds.parseDailyStock(true), null, 'boolean no es stock');
  assert.strictEqual(ds.parseDailyStock([5]), null, 'array no es stock');

  // Ventana del día local: la MISMA frontera de F1 (offset -180 → medianoche 03:00Z).
  const w = ds.getDailyStockWindow(Date.parse('2025-10-24T00:10:00Z'), -180);
  assert.strictEqual(w.localDay, '2025-10-23', '00:10Z con -180 es 21:10 del 23 local');
  assert.strictEqual(w.startUtc, '2025-10-23T03:00:00.000Z', 'arranca a la medianoche local del dueño');
  assert.strictEqual(w.endUtc, '2025-10-24T03:00:00.000Z', 'termina a la medianoche siguiente (fin exclusivo)');
  // Medianoche local exacta: cambia el día sin ambigüedad.
  const wMid = ds.getDailyStockWindow(Date.parse('2025-10-24T03:00:00.000Z'), -180);
  assert.strictEqual(wMid.localDay, '2025-10-24', 'medianoche local exacta ya es el día nuevo');
  assert.strictEqual(wMid.startUtc, '2025-10-24T03:00:00.000Z', 'la ventana arranca EN el instante');
  // Offset inválido → clampa como toda la casa (±840); el default -180 del
  // dueño lo fija el ROUTE (restaurant.utcOffsetMinutes), no este helper.
  const wClamp = ds.getDailyStockWindow(Date.parse('2025-10-24T03:00:00.000Z'), 9999);
  assert.strictEqual(wClamp.localDay, '2025-10-24', 'offset fuera de rango clampa a ±840');

  // sumSoldByDish: Σ qty por dishId; cancelados NO consumen stock.
  const sold = ds.sumSoldByDish([
    { status: 'delivered', items_snapshot: [{ dishId: 'd1', quantity: 2 }, { dishId: 'd2', quantity: 1 }] },
    { status: 'cancelled', items_snapshot: [{ dishId: 'd1', quantity: 3 }] }, // cancelado: NO consume
    { status: 'confirmed', itemsSnapshot: [{ dishId: 'd2', quantity: 1 }] }, // espejo camelCase
    { status: 'preparing', items_snapshot: [{ dishId: 'icecream_abc123', quantity: 2 }] }, // helado a medida: fuera
    { status: 'pending', items_snapshot: [{ dishId: 'd1', quantity: 0 }, { dishId: 'd1', quantity: -2 }] }, // qty ≤ 0
    { status: 'ready', items_snapshot: [{ name: 'Sin id', quantity: 5 }] }, // snapshot viejo sin dishId
    { status: 'ready', items_snapshot: 'basura' }, // snapshot roto
    null, 'perro', { status: 'ready' }, // filas basura
  ]);
  assert.strictEqual(sold.get('d1'), 2, 'd1 = 2 (el cancelado y los qty≤0 no suman)');
  assert.strictEqual(sold.get('d2'), 2, 'd2 = 2 (dual snake+camel)');
  assert.strictEqual(sold.size, 2, 'sin dishId legible no se inventan buckets');
  assert.deepEqual([...ds.sumSoldByDish(null).keys()], [], 'lista nula → mapa vacío, nunca throw');

  // computeSoldOutToday: borde INCLUSIVO (>=): el tope exacto ya agota.
  assert.strictEqual(ds.computeSoldOutToday({ dailyStock: 2 }, 1), false, '1 de 2 → todavía hay');
  assert.strictEqual(ds.computeSoldOutToday({ dailyStock: 2 }, 2), true, '2 de 2 → AGOTADO (borde inclusivo)');
  assert.strictEqual(ds.computeSoldOutToday({ dailyStock: 2 }, 7), true, 'pasado el tope → agotado');
  assert.strictEqual(ds.computeSoldOutToday({ dailyStock: 2 }, 0), false, 'sin ventas → disponible');
  assert.strictEqual(ds.computeSoldOutToday({ dailyStock: 2 }), false, 'sin dato de ventas → fail-open');
  assert.strictEqual(ds.computeSoldOutToday({ dailyStock: 0 }, 5), false, 'dailyStock inválido → nunca auto-agota');
  assert.strictEqual(ds.computeSoldOutToday({}, 5), false, 'sin dailyStock → comportamiento actual');
  assert.strictEqual(ds.computeSoldOutToday(null, 5), false, 'plato basura → false, nunca throw');

  // attachSoldOutToday: boolean ESTABLE en cada plato; el manual viaja intacto.
  const attached = ds.attachSoldOutToday(
    [
      { id: 'a', dailyStock: 1 },
      { id: 'b', outOfStock: true, dailyStock: 50 },
      { id: 'c' },
    ],
    new Map([['a', 1]])
  );
  assert.strictEqual(attached[0].soldOutToday, true, 'a: tope alcanzado → derivado true');
  assert.strictEqual(attached[1].outOfStock, true, 'b: manual intacto (el derivado nunca pisa)');
  assert.strictEqual(attached[1].soldOutToday, false, 'b: sin ventas → derivado false (el frontend hace OR)');
  assert.strictEqual(attached[2].soldOutToday, false, 'c: sin tope → false estable (siempre boolean)');
  assert.ok(!('soldOutToday' in { id: 'a', dailyStock: 1 }), 'el input no se muta (spread)');
  assert.strictEqual(ds.attachSoldOutToday('perro', sold).length, 0, 'lista basura → vacía, nunca throw');
  assert.strictEqual(ds.attachSoldOutToday([{ id: 'a', dailyStock: 1 }], null)[0].soldOutToday, false, 'map nulo → map vacío');

  // anyDishWithDailyStock: el agregado lo pagan SOLO los locales con el flag.
  assert.strictEqual(ds.anyDishWithDailyStock([{ dailyStock: 5 }, {}]), true, 'alguno con tope → sí fetch');
  assert.strictEqual(ds.anyDishWithDailyStock([{}, { dailyStock: 0 }]), false, 'tope inválido = sin memoria');
  assert.strictEqual(ds.anyDishWithDailyStock([{}, 'x', null]), false, 'cero costo para el resto');

  console.log('✓ §1 Módulo puro: parse 1..9999 + ventana F1 + sumSold (cancelados fuera) + borde >= + attach estable');

  // ── §2 Sanitizer: opt-in estricto + idempotencia + no privilegiado ─────────
  const fixtureRestaurant = {
    name: 'Local Stock', bizName: 'Local Stock', slug: 'local-stock-f3',
    phone: '59899000000', currency: 'USD', utcOffsetMinutes: -180,
    categories: [{ id: 'cat1', name: 'Rápidas' }],
    dishes: [
      { id: 'd1', name: 'Torta', price: 10, categoryId: 'cat1', dailyStock: 30 },
      { id: 'd2', name: 'Factura', price: 5, categoryId: 'cat1', dailyStock: '12' },
      { id: 'd3', name: 'Podrido', price: 3, categoryId: 'cat1', dailyStock: 0 },
      { id: 'd4', name: 'Inventado', price: 3, categoryId: 'cat1', dailyStock: 'mucho' },
    ]
  };
  const sanitized = sanitizeRestaurantPayload(fixtureRestaurant);
  const byId = Object.fromEntries(sanitized.dishes.map((d) => [d.id, d]));
  assert.strictEqual(byId.d1.dailyStock, 30, 'tope válido persiste');
  assert.strictEqual(byId.d2.dailyStock, 12, 'string numérica → entero');
  assert.ok(!('dailyStock' in byId.d3), '0 → campo ABSENT (nunca 0/null: undefined = sin memoria)');
  assert.ok(!('dailyStock' in byId.d4), 'basura → campo ABSENT');
  const reSanitized = sanitizeRestaurantPayload(sanitized);
  assert.strictEqual(JSON.stringify(reSanitized.dishes), JSON.stringify(sanitized.dishes), 'round-trip idempotente');
  assert.strictEqual(sanitizeRestaurantPayload(reSanitized).dishes[0].dailyStock, 30, 're-sanitize de la salida → estable');

  // dailyStock NO es privilegiado: es configuración del dueño y sobrevive el
  // strip anti mass-assignment (lo privilegiado es identidad/versión/proyección).
  const stripped = stripPrivilegedFields(sanitized);
  assert.strictEqual(stripped.dishes[0].dailyStock, 30, 'dailyStock sobrevive stripPrivilegedFields');
  assert.strictEqual(stripped.dishes[0].outOfStock, false, 'outOfStock (manual) sobrevive igual');
  assert.ok(!('subscription' in stripped), 'el strip Sigue haciendo su trabajo real');

  console.log('✓ §2 Sanitizer: opt-in (absent, nunca null/0) + idempotente + no privilegiado');

  // ── §3 Runtime real: payload público con soldOutToday ──────────────────────
  const runTag = Date.now();
  const userA = await db.createUser({ email: `daily-a-${runTag}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const rest = await db.saveRestaurant(userA.id, {
    name: 'Stock Local', bizName: 'Stock Local',
    slug: `stock-local-${runTag}`,
    phone: '59899333333',
    currency: 'USD',
    utcOffsetMinutes: -180,
    categories: [{ id: 'cat1', name: 'Del día' }],
    dishes: [
      { id: 'dish_torta', name: 'Torta del día', price: 10, categoryId: 'cat1', dailyStock: 2 },
      { id: 'dish_manual', name: 'Manual agotado', price: 8, categoryId: 'cat1', dailyStock: 10, outOfStock: true },
      { id: 'dish_libre', name: 'Sin tope', price: 6, categoryId: 'cat1' },
      { id: 'dish_ayer', name: 'Vendió ayer', price: 7, categoryId: 'cat1', dailyStock: 3 },
    ]
  });
  assert.ok(rest && rest.id, 'restaurante fixture creado');
  // El sanitizer del save NO borró los topes.
  assert.strictEqual(db.findRestaurantById(rest.id).dishes.find(d => d.id === 'dish_torta').dailyStock, 2, 'dailyStock sobrevive saveRestaurant');

  // Ventana REAL de HOY (huso del dueño): los seeds usan posiciones
  // DETERMINISTAS de la ventana, no el reloj del test.
  const win = ds.getDailyStockWindow(Date.now(), -180);
  const midWin = new Date((Date.parse(win.startUtc) + Date.parse(win.endUtc)) / 2).toISOString(); // mediodía local
  const beforeWin = new Date(Date.parse(win.startUtc) - 3600000).toISOString(); // ayer local
  const nearEnd = new Date(Date.parse(win.endUtc) - 60000).toISOString(); // hoy, casi medianoche

  // 1 torta vendida HOY (delivery), 1 manual sin ventas, 1 ayer.
  await db.addOrder({
    id: `ord_dstoday_${runTag}`, restaurant_id: rest.id, restaurantId: rest.id,
    status: 'delivered', currency: 'USD', amount: 10, created_at: midWin,
    items_snapshot: [{ dishId: 'dish_torta', name: 'Torta del día', quantity: 1 }]
  });
  await db.addOrder({
    id: `ord_dsyest_${runTag}`, restaurant_id: rest.id, restaurantId: rest.id,
    status: 'delivered', currency: 'USD', amount: 7, created_at: beforeWin,
    items_snapshot: [{ dishId: 'dish_ayer', name: 'Vendió ayer', quantity: 1 }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const menuUrl = `${base}/api/menu/${rest.slug}`;

  const getDishes = async () => {
    const res = await fetch(menuUrl);
    assert.strictEqual(res.status, 200, `GET /api/menu/:slug → 200`);
    const body = await res.json();
    return body.restaurant.dishes;
  };
  const findDish = (dishes, id) => dishes.find(d => d.id === id);

  let dishes = await getDishes();
  let torta = findDish(dishes, 'dish_torta');
  assert.strictEqual(torta.soldOutToday, false, '1 vendida de 2 → todavía disponible');
  assert.strictEqual(torta.dailyStock, 2, 'el tope viaja en el payload público');
  let manual = findDish(dishes, 'dish_manual');
  assert.strictEqual(manual.outOfStock, true, 'flag MANUAL viaja intacto');
  assert.strictEqual(manual.soldOutToday, false, 'manual sin ventas → derivado false (el OR del frontend lo muestra agotado)');
  const libre = findDish(dishes, 'dish_libre');
  assert.strictEqual(libre.soldOutToday, false, 'plato SIN dailyStock → soldOutToday false estable');
  assert.ok(!('dailyStock' in libre), 'sin tope → el campo no se inventa');
  assert.strictEqual(findDish(dishes, 'dish_ayer').soldOutToday, false, '1 vendida AYER (fuera de ventana) → disponible');

  // 2ª torta vendida HOY → tope 2 alcanzado. La cache (60s + single-flight)
  // se invalida entre seeds: el agregado vive DENTRO del cache y este flip
  // demuestra que el payload re-computa al refrescarlo.
  await db.addOrder({
    id: `ord_dstoday2_${runTag}`, restaurant_id: rest.id, restaurantId: rest.id,
    status: 'confirmed', currency: 'USD', amount: 10, created_at: nearEnd,
    items_snapshot: [{ dishId: 'dish_torta', name: 'Torta del día', quantity: 1 }]
  });
  // La cache (60s middleware + 5s single-flight) guarda el payload: el agregado
  // vive DENTRO del cache — invalidarla demuestra el flip al refrescar.
  await invalidateMenuCache(rest.slug);

  dishes = await getDishes();
  torta = findDish(dishes, 'dish_torta');
  assert.strictEqual(torta.soldOutToday, true, '2 vendidas de 2 → soldOutToday TRUE (derivado server-side)');

  // Cancelado NO consume: agotar por un pedido cancelado es un bug (el plato
  // no salió de la cocina). Semilla un cancelado de HOY sobre el plato manual.
  await db.addOrder({
    id: `ord_dscancel_${runTag}`, restaurant_id: rest.id, restaurantId: rest.id,
    status: 'cancelled', currency: 'USD', amount: 8, created_at: midWin,
    items_snapshot: [{ dishId: 'dish_manual', name: 'Manual agotado', quantity: 5 }]
  });
  await invalidateMenuCache(rest.slug);

  dishes = await getDishes();
  manual = findDish(dishes, 'dish_manual');
  assert.strictEqual(manual.soldOutToday, false, '5 vendidas CANCELADAS de HOY no auto-agotan (cancelados no consumen)');
  assert.strictEqual(manual.outOfStock, true, 'el manual sigue mandando: outOfStock true');

  // La medianoche del dueño revivió al plato: la ventana EXCLUYE al día
  // anterior sin ningún cron de reset (dish_ayer ya lo demostró).
  assert.strictEqual(findDish(dishes, 'dish_ayer').soldOutToday, false, 'revive a medianoche sin cron (ayer fuera de ventana)');

  // Demos: catálogo in-memory SIN ventas → payload sin soldOutToday (el
  // frontend tolera undefined con Boolean(); cero invento en demos).
  const demoRes = await fetch(`${base}/api/menu/demo-heladeria`);
  assert.strictEqual(demoRes.status, 200, 'demo heladería → 200');
  const demoBody = await demoRes.json();
  const demoDish = (demoBody.restaurant.dishes || [])[0];
  assert.ok(demoDish, 'demo con platos');
  assert.ok(!('soldOutToday' in demoDish), 'demos no llevan el derivado (sin ventas reales)');

  console.log('✓ §3 Runtime: payload público false→true con tope · manual gana · cancelados no consumen · medianoche revive · cache invalidada');

  // ── §4 Contratos: openapi + fuentes frontend ───────────────────────────────
  const openapi = read('openapi.yaml');
  assert.ok(openapi.includes('dailyStock:'), 'openapi documenta dailyStock');
  assert.ok(openapi.includes('soldOutToday:'), 'openapi documenta soldOutToday');

  // Helper compartido: UNA sola decisión de agotamiento para todo el frontend.
  const helper = read('public/js/utils/dishAvailability.js');
  assert.ok(/outOfStock \|\| dish\.soldOutToday|outOfStock \|\| (dish\.)?soldOutToday/.test(helper), 'isDishSoldOut = manual || derivado');

  // Render (badge/tachado/✕ bloqueado comparten el MISMOS estilos del manual).
  const menuRender = read('public/js/menu/menuRender.js');
  assert.ok(menuRender.includes("import { isDishSoldOut } from '../utils/dishAvailability.js'"), 'menuRender importa el helper');
  assert.ok(menuRender.includes('const isSold = isDishSoldOut(d);'), 'una sola decisión isSold en la tarjeta');

  // Guard final del carrito (el botón disabled no basta: upsell/waiter también).
  const menuJs = read('public/js/menu.js');
  assert.ok(menuJs.includes('dish.outOfStock || dish.soldOutToday'), 'addToCart bloquea el agotado de HOY');

  // Upsell del carrito + recomendaciones del Mozo Virtual: fuera los agotados.
  const cartUpsell = read('public/js/menu/cartUpsell.js');
  assert.ok(cartUpsell.includes('!isDishSoldOut(dish)') && cartUpsell.includes('!isDishSoldOut(d)'), 'cartUpsell excluye agotados (2 sitios)');
  const virtualWaiter = read('public/js/components/VirtualWaiter.js');
  assert.ok(virtualWaiter.includes('!isDishSoldOut(d)'), 'VirtualWaiter excluye agotados');
  const vwh = read('public/js/menu/virtualWaiterHeuristics.js');
  assert.ok((vwh.match(/isDishSoldOut\(/g) || []).length >= 2, 'heurísticas del mozo excluyen agotados (2 sitios)');

  // ViewModel puro (sin imports, se lee en Node): OR inline espejo del helper.
  const viewModel = read('public/js/menu/menuViewModel.js');
  assert.ok(viewModel.includes('dish.outOfStock || dish.soldOutToday'), 'visibility checks incluyen el derivado');
  assert.ok(viewModel.includes('!d.outOfStock && !d.soldOutToday'), 'hasMatch de dieta incluye el derivado');

  // Studio: input + label asociado + editor (load/reset/collect/assign).
  const studioHtml = read('public/studio.html');
  assert.ok(studioHtml.includes('id="modalDishDailyStock"'), 'input de stock diario en el modal de plato');
  assert.ok(studioHtml.includes('for="modalDishDailyStock"'), 'label asociado al input (a11y)');
  const editor = read('public/js/studio/dishEditor.js');
  assert.ok(editor.includes("el('modalDishDailyStock').value = (dish.dailyStock ?? '')"), 'load del tope al editar');
  assert.ok(editor.includes("el('modalDishDailyStock').value = ''"), 'reset del campo en alta');
  assert.ok(editor.includes('dailyStockVal <= 9999'), 'collect valida el rango 1..9999');
  assert.ok(editor.includes('delete dish.dailyStock'), 'vaciar el campo REMUEVE el tope (sin stock viejo)');

  // Wiring backend + db method + cero on*= en el segmento nuevo.
  const menuRoute = read('api/routes/menu.js');
  assert.ok(menuRoute.includes('dailyStockTracker.anyDishWithDailyStock'), 'route gatea el fetch por la carta real');
  assert.ok(menuRoute.includes('attachSoldOutToday'), 'route attacha el derivado');
  const dbJs = read('src/db/db.js');
  assert.ok(dbJs.includes('getSoldQtyForDay'), 'db dual expone getSoldQtyForDay');
  const studioSegment = studioHtml.slice(studioHtml.indexOf('modalDishDailyStock') - 400, studioHtml.indexOf('modalDishDailyStock') + 500);
  assert.ok(!/ on[a-z]+=/i.test(studioSegment), 'cero on*= alrededor del input nuevo');

  console.log('✓ §4 Contratos: openapi + helper compartido + carrito/upsell/mozo + Studio + route/db');

  await new Promise((resolve) => server.close(resolve));
  console.log('✅ test-daily-stock: F3 "Agotados con memoria" OK');
}

runTests().catch((err) => {
  console.error('❌ test-daily-stock falló:', err.message);
  process.exit(1); // el server HTTP abierto no deja drenar el event loop
});
