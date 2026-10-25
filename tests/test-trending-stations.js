/**
 * tests/test-trending-stations.js — F5 "Tendencia honesta" + F6 "Estaciones de
 * cocina" (Serie 5 "El Sistema", 59ª suite)
 * ─────────────────────────────────────────────────────────────────────────────
 * §1  Módulo puro `api/utils/dishTrending.js`: ventana de 7 días con reloj
 *     inyectable, umbral mínimo 3 unidades, tope de 3 etiquetas, tie-break
 *     determinista (unidades desc → id asc), id huérfano (plato borrado) NUNCA
 *     se etiqueta, `attachTrendingLabel` no muta el input (el cache del menú se
 *     reusa) y el agregado de ventas es el MISMO de F3 (los cancelados no
 *     cuentan como ventas).
 * §2  Paridad CJS↔ESM de `sanitizeStation` (lo que el Studio guarda es lo que
 *     el KDS compara), `station` OPT-IN (campo ABSENT si vacío/basura, nunca
 *     null), `showTrendingChip` default ON y superviviente del strip
 *     anti mass-assignment.
 * §3  Runtime real (server HTTP + store real, cero mocks): el payload público
 *     de `/api/menu/:slug` etiqueta SOLO los platos con evidencia real,
 *     cancelados/ayer fuera, la etiqueta viaja SIN conteos, el toggle del dueño
 *     apaga todo, `station` NO viaja al comensal pero sí sobrevive el save, y
 *     el modelo de tarjeta del KDS resuelve `dishId → estación` con fail-open.
 * §4  `public/js/kitchen/kitchenStations.js` puro: opciones únicas (carta +
 *     tarjetas), filtrado por estación con `hiddenItems`, ítem sin estación
 *     visible en TODAS y estación recordada validada contra las reales.
 * §5  Wiring estático: cero `on*=`/`innerHTML` con data en los archivos nuevos,
 *     barra del KDS, toggle + input del Studio, chip del menú y contrato en
 *     `openapi.yaml`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const app = require('../api/index');
const db = require('../src/db/db');
const trending = require('../api/utils/dishTrending');
const stationsCjs = require('../api/utils/dishStation');
const ds = require('../api/utils/dailyStockTracker');
const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');
const { stripPrivilegedFields } = require('../api/utils/stripPrivilegedFields');
const { invalidateMenuCache } = require('../api/middleware/cache');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

async function runTests() {
  console.log('🔎 Iniciando verificación de tendencia honesta + estaciones (F5/F6)...');

  // ── §1 Módulo puro: ventana, umbral, tope y determinismo ──────────────────
  const now = Date.parse('2025-10-24T18:00:00.000Z');
  const win = trending.getTrendingWindow(now);
  assert.strictEqual(win.endIso, '2025-10-24T18:00:00.000Z', 'la ventana cierra en el instante consultado');
  assert.strictEqual(win.startIso, '2025-10-17T18:00:00.000Z', 'la ventana son exactamente 7 días');
  assert.strictEqual(trending.TRENDING_WINDOW_DAYS, 7, 'la copy dice "esta semana": la ventana es 7 días');
  const winCustom = trending.getTrendingWindow(now, 1);
  assert.strictEqual(winCustom.startIso, '2025-10-23T18:00:00.000Z', 'ventana parametrizable');
  const winJunk = trending.getTrendingWindow('basura');
  assert.ok(!Number.isNaN(Date.parse(winJunk.endIso)), 'reloj basura → cae a ahora, nunca throw');
  assert.ok(Date.parse(winJunk.startIso) < Date.parse(winJunk.endIso), 'la ventana siempre es positiva');

  const menu = [
    { id: 'd1', name: 'Uno' },
    { id: 'd2', name: 'Dos' },
    { id: 'd3', name: 'Tres' },
    { id: 'd4', name: 'Cuatro' },
    { id: 'd5', name: 'Cinco' }
  ];
  // 3 unidades = mínimo; 2 = todavía no es "muy pedido" (sería mentira).
  const labels = trending.computeTrendingLabels(
    new Map([['d1', 3], ['d2', 2], ['d3', 9], ['d4', 7]]),
    menu
  );
  assert.strictEqual(labels.size, 3, 'tope de 3 etiquetas (la carta no es un cartel de ofertas)');
  assert.strictEqual(labels.get('d3'), trending.TRENDING_LABEL, 'el más vendido se etiqueta');
  assert.strictEqual(labels.get('d4'), trending.TRENDING_LABEL, 'el segundo también');
  assert.strictEqual(labels.get('d1'), trending.TRENDING_LABEL, 'el que llega justo al umbral entra');
  assert.ok(!labels.has('d2'), '2 unidades NO alcanzan el umbral mínimo');
  assert.strictEqual(trending.TRENDING_MIN_UNITS, 3, 'umbral explícito y documentado');

  // Unidades desc y, en empate, id asc: el resultado no depende del orden de
  // inserción del Map ni del orden de la consulta (determinismo total).
  const tieA = trending.computeTrendingLabels(new Map([['d5', 4], ['d3', 4], ['d1', 4]]), menu);
  const tieB = trending.computeTrendingLabels(new Map([['d1', 4], ['d5', 4], ['d3', 4]]), menu);
  assert.deepStrictEqual([...tieA.keys()], ['d1', 'd3', 'd5'], 'empate → id asc');
  assert.deepStrictEqual([...tieB.keys()], [...tieA.keys()], 'mismo resultado con otro orden de inserción');

  // Id huérfano: un plato que ya no existe en la carta JAMÁS se etiqueta.
  const orphan = trending.computeTrendingLabels(new Map([['d_borrado', 99], ['d1', 3]]), menu);
  assert.strictEqual(orphan.size, 1, 'solo el plato que existe en la carta');
  assert.ok(orphan.has('d1'), 'el id huérfano se descarta');
  assert.ok(!orphan.has('d_borrado'), 'un plato borrado nunca se etiqueta');

  // Entrada tolerante: objeto plano (JSON), basura y valores no numéricos.
  const objectInput = trending.computeTrendingLabels({ d1: '5', d2: 'x', d3: 3 }, menu);
  assert.ok(objectInput.has('d1'), 'acepta objeto plano y string numérica');
  assert.ok(!objectInput.has('d2'), 'valor no numérico no etiqueta');
  assert.strictEqual(trending.computeTrendingLabels(null, menu).size, 0, 'agregado nulo → vacío, nunca throw');
  assert.strictEqual(trending.computeTrendingLabels(new Map([['d1', 9]]), null).size, 0, 'carta nula → vacío');
  assert.strictEqual(trending.computeTrendingLabels(new Map([['d1', 9]]), menu, { minUnits: 10 }).size, 0, 'umbral parametrizable');
  assert.strictEqual(trending.computeTrendingLabels(new Map([['d1', 9]]), menu, { maxLabels: 1 }).size, 1, 'tope parametrizable');

  // attachTrendingLabel: array NUEVO (el cache del menú no se muta) + solo los
  // platos etiquetados reciben la clave.
  const input = [{ id: 'd1' }, { id: 'd2' }];
  const attached = trending.attachTrendingLabel(input, new Map([['d1', trending.TRENDING_LABEL]]));
  assert.strictEqual(attached[0].trendingLabel, trending.TRENDING_LABEL, 'el etiquetado recibe el chip');
  assert.ok(!('trendingLabel' in attached[1]), 'el resto queda intacto (sin chip inventado)');
  assert.ok(!('trendingLabel' in input[0]), 'el input NO se muta (puede venir del cache)');
  assert.notStrictEqual(attached, input, 'devuelve un array nuevo');
  assert.strictEqual(trending.attachTrendingLabel(input, new Map()).length, 2, 'map vacío → copia sin cambios');
  assert.strictEqual(trending.attachTrendingLabel(null, new Map([['d1', 'x']])).length, 0, 'lista nula → vacía');
  assert.strictEqual(trending.attachTrendingLabel(input, null).length, 2, 'map nulo → copia sin cambios');

  // La evidencia es el MISMO agregado honesto de F3: un plato con 2 ventas
  // reales y 5 canceladas NO es "muy pedido" (los cancelados no son ventas).
  const soldAgg = ds.sumSoldByDish([
    { status: 'delivered', items_snapshot: [{ dishId: 'd1', quantity: 2 }] },
    { status: 'cancelled', items_snapshot: [{ dishId: 'd1', quantity: 5 }] },
    { status: 'delivered', items_snapshot: [{ dishId: 'd3', quantity: 3 }] }
  ]);
  const honest = trending.computeTrendingLabels(soldAgg, menu);
  assert.ok(!honest.has('d1'), 'las canceladas no cuentan como ventas (2 reales < umbral)');
  assert.ok(honest.has('d3'), 'las 3 ventas reales sí etiquetan');

  console.log('✅ §1 Tendencia pura: ventana 7d + mínimo 3 + tope 3 + empate determinista + huérfanos fuera');

  // ── §2 Paridad CJS↔ESM + sanitizer ───────────────────────────────────────
  const stationsEsm = await import('../public/js/utils/dishStation.js');
  assert.strictEqual(stationsEsm.MAX_STATION_LEN, stationsCjs.MAX_STATION_LEN, 'misma longitud máxima');
  const corpus = [
    'Barra', '  Barra   fría ', 'COCINA', 'Parrilla', 'x'.repeat(40), '',
    null, undefined, 42, true, {}, ['a'], 'a\tb', 'ñandú y más', 'Postres 1'
  ];
  for (const raw of corpus) {
    const cjs = stationsCjs.sanitizeStation(raw);
    const esm = stationsEsm.sanitizeStation(raw);
    assert.strictEqual(esm, cjs, `paridad exacta para ${JSON.stringify(raw)}`);
    assert.ok(esm.length <= stationsCjs.MAX_STATION_LEN, 'nunca excede el máximo');
    assert.strictEqual(esm, esm.trim(), 'nunca queda con espacios colgando');
    assert.ok(!/[\u0000-\u001f\u007f]/.test(esm), 'sin caracteres de control');
  }
  assert.strictEqual(stationsCjs.sanitizeStation('  Barra   fría  '), 'Barra fría', 'espacios colapsados');
  assert.strictEqual(stationsCjs.sanitizeStation(42), '', 'un número no es una estación');
  assert.strictEqual(stationsEsm.stationKey('BARRA'), 'barra', 'clave insensible a mayúsculas');

  const fixture = {
    name: 'Local F5', bizName: 'Local F5', slug: 'local-f5-f6',
    phone: '59899000000', currency: 'USD', utcOffsetMinutes: -180,
    categories: [{ id: 'cat1', name: 'Rápidas' }],
    dishes: [
      { id: 'd1', name: 'Con estación', price: 10, categoryId: 'cat1', station: '  Barra   fría ' },
      { id: 'd2', name: 'Sin estación', price: 5, categoryId: 'cat1', station: '   ' },
      { id: 'd3', name: 'Basura', price: 3, categoryId: 'cat1', station: { a: 1 } },
      { id: 'd4', name: 'Larga', price: 3, categoryId: 'cat1', station: 'x'.repeat(40) }
    ]
  };
  const sanitized = sanitizeRestaurantPayload(fixture);
  const byId = Object.fromEntries(sanitized.dishes.map((d) => [d.id, d]));
  assert.strictEqual(byId.d1.station, 'Barra fría', 'la estación se normaliza al guardar');
  assert.ok(!('station' in byId.d2), 'vacío → campo ABSENT (nunca null)');
  assert.ok(!('station' in byId.d3), 'basura → campo ABSENT');
  assert.strictEqual(byId.d4.station.length, stationsCjs.MAX_STATION_LEN, 'se recorta al máximo');
  const reSanitized = sanitizeRestaurantPayload(sanitized);
  assert.strictEqual(JSON.stringify(reSanitized.dishes), JSON.stringify(sanitized.dishes), 'round-trip idempotente');

  // `station` y `showTrendingChip` son configuración del dueño (no identidad):
  // sobreviven el strip anti mass-assignment, igual que dailyStock.
  const stripped = stripPrivilegedFields(sanitized);
  assert.strictEqual(stripped.dishes[0].station, 'Barra fría', 'station sobrevive stripPrivilegedFields');
  assert.ok(!('subscription' in stripped), 'el strip sigue haciendo su trabajo real');

  // Default ON explícito (un `false` del dueño se respeta; nada más lo apaga).
  assert.strictEqual(sanitizeRestaurantPayload({ showTrendingChip: undefined }).showTrendingChip, true, 'default ON');
  assert.strictEqual(sanitizeRestaurantPayload({ showTrendingChip: true }).showTrendingChip, true, 'true explícito');
  assert.strictEqual(sanitizeRestaurantPayload({ showTrendingChip: false }).showTrendingChip, false, 'false del dueño se respeta');

  console.log('✅ §2 Paridad CJS↔ESM + station opt-in (absent, idempotente, no privilegiado) + default ON');

  // ── §3 Runtime real: payload público + KDS ───────────────────────────────
  const runTag = Date.now();
  const userA = await db.createUser({ email: `trend-a-${runTag}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const rest = await db.saveRestaurant(userA.id, {
    name: 'Tendencia Local', bizName: 'Tendencia Local',
    slug: `trend-local-${runTag}`,
    phone: '59899333333',
    currency: 'USD',
    utcOffsetMinutes: -180,
    categories: [{ id: 'cat1', name: 'Cocina' }],
    dishes: [
      { id: 'dish_top', name: 'Top ventas', price: 10, categoryId: 'cat1', station: 'Cocina' },
      { id: 'dish_segundo', name: 'Segundo', price: 9, categoryId: 'cat1', station: 'Barra' },
      { id: 'dish_tercero', name: 'Tercero', price: 8, categoryId: 'cat1' },
      { id: 'dish_cuarto', name: 'Cuarto', price: 7, categoryId: 'cat1', station: 'Parrilla' },
      { id: 'dish_poco', name: 'Poco vendido', price: 6, categoryId: 'cat1', station: 'Barra' },
      { id: 'dish_cancelado', name: 'Solo cancelados', price: 5, categoryId: 'cat1' },
      { id: 'dish_viejo', name: 'Vendido hace un mes', price: 4, categoryId: 'cat1' }
    ]
  });
  assert.ok(rest && rest.id, 'restaurante fixture creado');
  assert.strictEqual(db.findRestaurantById(rest.id).dishes.find((d) => d.id === 'dish_top').station, 'Cocina', 'station sobrevive saveRestaurant');

  // Seeds DETERMINISTAS dentro/fuera de la ventana de 7 días (reloj del test).
  const nowMs = Date.now();
  const inWindow = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();       // hace 2 días: cuenta
  const outWindow = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();     // hace 30 días: NO cuenta
  const seed = (id, status, items, createdAt) => db.addOrder({
    id: `ord_tr_${id}_${runTag}`, restaurant_id: rest.id, restaurantId: rest.id,
    status, currency: 'USD', amount: 10, created_at: createdAt,
    items_snapshot: items
  });
  await seed('top', 'delivered', [{ dishId: 'dish_top', name: 'Top ventas', quantity: 5 }], inWindow);
  await seed('segundo', 'delivered', [{ dishId: 'dish_segundo', name: 'Segundo', quantity: 4 }], inWindow);
  await seed('tercero', 'delivered', [{ dishId: 'dish_tercero', name: 'Tercero', quantity: 3 }], inWindow);
  await seed('cuarto', 'delivered', [{ dishId: 'dish_cuarto', name: 'Cuarto', quantity: 3 }], inWindow);
  await seed('poco', 'delivered', [{ dishId: 'dish_poco', name: 'Poco vendido', quantity: 2 }], inWindow);
  await seed('cancelado', 'cancelled', [{ dishId: 'dish_cancelado', name: 'Solo cancelados', quantity: 9 }], inWindow);
  await seed('viejo', 'delivered', [{ dishId: 'dish_viejo', name: 'Vendido hace un mes', quantity: 9 }], outWindow);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const menuUrl = `${base}/api/menu/${rest.slug}`;

  const getMenu = async () => {
    invalidateMenuCache(rest.slug);
    const res = await fetch(menuUrl);
    assert.strictEqual(res.status, 200, 'GET /api/menu/:slug → 200');
    const body = await res.json();
    return body.restaurant;
  };

  let restaurant = await getMenu();
  const dishById = (id) => restaurant.dishes.find((d) => d.id === id);
  const labeled = restaurant.dishes.filter((d) => d.trendingLabel).map((d) => d.id);

  assert.deepStrictEqual(
    labeled.sort(),
    ['dish_cuarto', 'dish_segundo', 'dish_top'],
    'etiqueta los 3 más vendidos de la semana (5, 4, 3 — empate resuelto por id)'
  );
  assert.ok(!dishById('dish_poco').trendingLabel, '2 ventas no alcanzan el umbral (no se miente)');
  assert.ok(!dishById('dish_cancelado').trendingLabel, 'los cancelados no son ventas');
  assert.ok(!dishById('dish_viejo').trendingLabel, 'fuera de la ventana de 7 días no es "esta semana"');
  assert.strictEqual(dishById('dish_top').trendingLabel, trending.TRENDING_LABEL, 'la etiqueta es la copy canónica');

  // El payload público NUNCA ve unidades ni scores: solo la etiqueta textual.
  const topDish = dishById('dish_top');
  assert.ok(!('trendingUnits' in topDish) && !('soldLast7d' in topDish) && !('trendingScore' in topDish),
    'cero conteos/scores en el payload público');
  const rawPayload = JSON.stringify(restaurant);
  assert.ok(!rawPayload.includes('trendingUnits'), 'ninguna clave de conteo viaja al comensal');
  // F6: la estación es dato operativo del local, no del comensal.
  assert.ok(!('station' in topDish), 'station NO viaja en el payload público');
  assert.ok(!rawPayload.includes('"station"'), 'ninguna estación en el menú público');

  // Cache en proceso (10 min): un pedido nuevo no cambia el chip al instante.
  await seed('top-late', 'delivered', [{ dishId: 'dish_poco', name: 'Poco vendido', quantity: 5 }], inWindow);
  restaurant = await getMenu();
  assert.ok(!restaurant.dishes.find((d) => d.id === 'dish_poco').trendingLabel,
    'el cache de 10 min evita una consulta de ventas por request');

  // Toggle del dueño: apagado no se consulta nada y la carta no muestra chips.
  await db.saveRestaurant(userA.id, { ...db.findRestaurantById(rest.id), showTrendingChip: false });
  restaurant = await getMenu();
  assert.strictEqual(restaurant.showTrendingChip, false, 'el payload público expone el flag');
  assert.strictEqual(restaurant.dishes.filter((d) => d.trendingLabel).length, 0, 'apagado → cero etiquetas');
  await db.saveRestaurant(userA.id, { ...db.findRestaurantById(rest.id), showTrendingChip: true });
  restaurant = await getMenu();
  assert.strictEqual(restaurant.showTrendingChip, true, 'el flag vuelve a ON');

  // KDS: el modelo de tarjeta resuelve dishId → estación desde la carta.
  const kitchenColumns = await import('../public/js/kitchen/kitchenColumns.js');
  const stationByDishId = new Map([['dish_top', 'Cocina'], ['dish_segundo', 'Barra']]);
  const model = kitchenColumns.buildKitchenCardModel({
    id: 'ord_kds_station', status: 'pending', table_number: 7,
    items_snapshot: [
      { dishId: 'dish_top', name: 'Top ventas', quantity: 2 },
      { dishId: 'dish_segundo', name: 'Segundo', quantity: 1 },
      { dishId: 'icecream_custom', name: 'Helado a medida', quantity: 1 }
    ]
  }, stationByDishId);
  assert.strictEqual(model.items[0].station, 'Cocina', 'el ítem hereda la estación de su plato');
  assert.strictEqual(model.items[1].station, 'Barra', 'cada ítem su propia estación');
  assert.strictEqual(model.items[2].station, '', 'sin lookup (helado a medida) → fail-open: se ve en todas');
  assert.strictEqual(model.items[0].dishId, 'dish_top', 'el modelo conserva el dishId');
  const sinMapa = kitchenColumns.buildKitchenCardModel({ id: 'o2', status: 'pending', items_snapshot: [{ dishId: 'dish_top', quantity: 1 }] });
  assert.strictEqual(sinMapa.items[0].station, '', 'sin mapa de estaciones la pizarra no rompe');

  await new Promise((resolve) => server.close(resolve));

  console.log('✅ §3 Runtime: chips con evidencia real, cancelados/ayer fuera, sin conteos, toggle OFF, station fuera del público');

  // ── §4 Filtrado puro del KDS ─────────────────────────────────────────────
  const kds = await import('../public/js/kitchen/kitchenStations.js');
  const models = [
    { id: 'o1', columnId: 'queue', items: [{ label: 'A', station: 'Cocina' }, { label: 'B', station: 'Barra' }, { label: 'C', station: '' }] },
    { id: 'o2', columnId: 'queue', items: [{ label: 'D', station: 'barra' }] },
    { id: 'o3', columnId: 'confirmado', items: [{ label: 'E', station: '' }] }
  ];
  const options = kds.getStationOptions(models, ['Barra', 'Cocina', 'Parrilla']);
  assert.deepStrictEqual(options.map((o) => o.key), ['barra', 'cocina', 'parrilla'], 'claves únicas, ordenadas (es)');
  assert.deepStrictEqual(options.map((o) => o.label), ['Barra', 'Cocina', 'Parrilla'], 'la grafía de la carta manda');
  assert.deepStrictEqual(kds.getStationOptions([], []), [], 'sin estaciones no hay chips');
  assert.strictEqual(kds.ALL_STATIONS_KEY, '', '"Todos" es la clave vacía');

  const all = kds.filterModelsByStation(models, kds.ALL_STATIONS_KEY);
  assert.strictEqual(all, models, 'sin filtro devuelve la misma lista (cero trabajo extra)');
  // Fail-open por diseño: el ítem SIN estación se ve en TODAS, así que o3
  // (solo ítems sin estación) aparece en cualquier filtro y o1 sobrevive en
  // Parrilla por su ítem C. Nada de trabajo desaparece de la cocina.
  const barra = kds.filterModelsByStation(models, 'Barra');
  assert.deepStrictEqual(barra.map((m) => m.id), ['o1', 'o2', 'o3'], 'o3 sigue visible: sus ítems no tienen estación');
  assert.deepStrictEqual(barra[0].items.map((i) => i.label), ['B', 'C'], 'sin estación se ve en TODAS (fail-open)');
  assert.strictEqual(barra[0].hiddenItems, 1, 'los ítems de otra estación se informan, no desaparecen');
  assert.strictEqual(barra[1].hiddenItems, 0, 'sin ítems ocultos no hay aviso');
  const parrilla = kds.filterModelsByStation(models, 'Parrilla');
  assert.deepStrictEqual(parrilla.map((m) => m.id), ['o1', 'o3'], 'el pedido con un ítem sin estación sigue visible');
  assert.strictEqual(parrilla[0].hiddenItems, 2, 'dos ítems de otras estaciones quedan informados');
  const cocina = kds.filterModelsByStation(models, 'Cocina');
  assert.deepStrictEqual(cocina[0].items.map((i) => i.label), ['A', 'C'], 'solo la estación elegida + los sin estación');
  assert.deepStrictEqual(kds.filterModelsByStation(null, 'Barra'), [], 'lista nula → vacía, nunca throw');
  assert.deepStrictEqual(kds.filterModelsByStation([{ id: 'x' }], 'Barra'), [], 'modelo sin items no rompe');

  assert.strictEqual(kds.resolveStoredStation('barra', options), 'barra', 'estación recordada válida');
  assert.strictEqual(kds.resolveStoredStation('BARRA', options), 'barra', 'normaliza mayúsculas');
  assert.strictEqual(kds.resolveStoredStation('horno', options), '', 'estación que ya no existe → Todos (nunca pizarra vacía)');
  assert.strictEqual(kds.resolveStoredStation('', options), '', 'sin valor recordado → Todos');
  assert.strictEqual(kds.resolveStoredStation(null, null), '', 'entradas basura → Todos');

  console.log('✅ §4 KDS puro: opciones únicas, filtrado con hiddenItems, sin estación visible en todas, stored validado');

  // ── §5 Wiring estático + reglas de la casa ───────────────────────────────
  const kitchenHtml = read('public/kitchen.html');
  assert.ok(kitchenHtml.includes('id="kdsStationBar"'), 'barra de estaciones en la pizarra');
  assert.ok(/id="kdsStationBar"[^>]*role="group"/.test(kitchenHtml), 'la barra es un grupo con nombre accesible');
  assert.ok(/id="kdsStationBar"[^>]*aria-label="Filtrar la pizarra por estación"/.test(kitchenHtml), 'aria-label explícito');
  assert.ok(/id="kdsStationBar"[^>]*hidden/.test(kitchenHtml), 'oculta por defecto (sin estaciones no aparece)');

  const kitchenJs = read('public/js/kitchen/kitchen.js');
  assert.ok(kitchenJs.includes("from './kitchenStations.js'"), 'la pizarra usa el módulo puro de estaciones');
  assert.ok(kitchenJs.includes('buildKitchenCardModel(order, stationByDishId)'), 'el mapa de estaciones llega al modelo');
  assert.ok(kitchenJs.includes('filterModelsByStation'), 'el render filtra por estación');
  assert.ok(kitchenJs.includes("scango_kds_station"), 'el filtro se recuerda por tablet');
  assert.ok(kitchenJs.includes('resolveStoredStation'), 'el valor recordado se valida contra las estaciones reales');
  assert.ok(kitchenJs.includes('aria-pressed'), 'los chips exponen estado ARIA');
  assert.ok(kitchenJs.includes('hiddenItems'), 'la tarjeta informa los ítems de otra estación');
  assert.ok(!/ window\.innerHTML/.test(kitchenJs) && !/\.innerHTML\s*=/.test(kitchenJs), 'cero innerHTML en el KDS (DOM API)');
  assert.ok(!/\bon[a-z]+\s*=/i.test(kitchenJs.replace(/on_the_way|onClickHandler/g, '')), 'cero on*=');

  const kitchenCss = read('public/css/kitchen.css');
  for (const cls of ['.kds-station-bar', '.kds-station-chip', '.kds-hidden-items']) {
    assert.ok(kitchenCss.includes(cls), `estilo ${cls} presente`);
  }
  assert.ok(kitchenCss.includes('[aria-pressed="true"]'), 'el chip activo se ve (estado ARIA como fuente)');

  const studioHtml = read('public/studio.html');
  assert.ok(studioHtml.includes('id="inputShowTrendingChip"'), 'toggle del chip en Mi Local');
  assert.ok(studioHtml.includes('for="modalDishStation"'), 'label asociado al campo estación');
  assert.ok(studioHtml.includes('id="modalDishStation"'), 'input de estación en el modal de plato');
  assert.ok(studioHtml.includes('list="dishStationOptions"') && studioHtml.includes('id="dishStationOptions"'), 'datalist conectado');

  const studioJs = read('public/js/studio.js');
  assert.ok(studioJs.includes("el('inputShowTrendingChip')"), 'el Studio carga/guarda el toggle');
  assert.ok(studioJs.includes('restaurant.showTrendingChip = trendingCheck.checked !== false'), 'default ON al guardar');

  const editor = read('public/js/studio/dishEditor.js');
  assert.ok(editor.includes("el('modalDishStation').value = dish.station || ''"), 'load de la estación al editar');
  assert.ok(editor.includes("el('modalDishStation').value = ''"), 'reset del campo en el alta');
  assert.ok(editor.includes('renderDishStationOptions'), 'el datalist se arma con las estaciones reales');
  assert.ok(editor.includes('delete dish.station'), 'vaciar el campo REMUEVE la estación');
  assert.ok(editor.includes("from '../utils/dishStation.js'"), 'el Studio normaliza con la MISMA regla del server');

  const menuRender = read('public/js/menu/menuRender.js');
  assert.ok(menuRender.includes('badge-trending'), 'chip de tendencia en la tarjeta del plato');
  assert.ok(menuRender.includes('escapeHtml(String(d.trendingLabel)'), 'la etiqueta se escapa antes de pintar');
  assert.ok(read('public/css/menu.css').includes('.badge-trending'), 'estilo del chip en la carta');

  const menuRoute = read('api/routes/menu.js');
  assert.ok(menuRoute.includes('attachTrendingLabel'), 'la ruta attacha la etiqueta derivada');
  assert.ok(menuRoute.includes('showTrendingChip !== false'), 'gate del dueño (default ON, cero consultas si apaga)');
  assert.ok(menuRoute.includes('const { station, ...dishPublic }'), 'la estación no viaja al comensal');
  assert.ok(menuRoute.includes('sumSoldByDish'), 'la evidencia usa el MISMO agregado honesto de F3');

  const sanitizeSrc = read('api/utils/sanitizeRestaurant.js');
  assert.ok(sanitizeSrc.includes("require('./dishStation')"), 'el sanitizer usa el módulo canónico de estaciones');
  assert.ok(sanitizeSrc.includes('clean.showTrendingChip = clean.showTrendingChip !== false'), 'default ON server-side');

  // Contrato público: lo nuevo está documentado.
  const openapi = read('openapi.yaml');
  assert.ok(openapi.includes('showTrendingChip'), 'openapi: flag del dueño');
  assert.ok(openapi.includes('trendingLabel'), 'openapi: la etiqueta del menú público');
  assert.ok(/station:/.test(openapi), 'openapi: estación del plato');

  // Reglas de la casa en los archivos nuevos (cero on*= / innerHTML con data).
  for (const file of [
    'api/utils/dishTrending.js',
    'api/utils/dishStation.js',
    'public/js/utils/dishStation.js',
    'public/js/kitchen/kitchenStations.js'
  ]) {
    const src = read(file);
    assert.ok(!/\bon(click|change|input|submit|error|load)\s*=/i.test(src), `cero on*= en ${file}`);
    assert.ok(!/\.innerHTML\s*=/.test(src), `cero innerHTML en ${file}`);
  }

  console.log('✅ §5 Wiring: KDS + Studio + carta + contrato, cero on*=/innerHTML en lo nuevo');
  console.log('🎉 test-trending-stations: F5 "Tendencia honesta" + F6 "Estaciones de cocina" OK');
}

runTests().catch((err) => {
  console.error('❌ test-trending-stations falló:', err && err.stack ? err.stack : err);
  process.exit(1); // el server HTTP abierto no deja drenar el event loop
});
