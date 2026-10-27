/**
 * tests/test-quick-wins.js
 * ────────────────────────
 * Bloque de quick wins del backlog de la estrategia (oct-2026), suite 66ª.
 * Cero mocks: server HTTP real + store local real (las mutaciones de data/*
 * las aísla scripts/test-data-guard.js en npm test).
 *
 * §1 #5 "Pedir de nuevo": módulo puro reorder.js (snapshot client-side del
 *    último pedido confirmado por slug + plan de repetición que reconcilia
 *    contra la carta ACTUAL: missing/soldout/schedule/custom/options-drift
 *    con skip honesto), wiring estático (orderSubmit/menu/menu.html/CSS/
 *    barrel/window) y runtime del canal público con `reorder_click` como
 *    tipo CRUDO (no mueve visitas/órdenes/ticket — patrón F4).
 * §2 #7 segmento una-visita: clamp [1,10] de minVisits en churnRecovery,
 *    runtime real de GET /api/loyalty/churn?minVisits=1 (visitas=1 adentro),
 *    default la excluye y 999 se clampea a 10; selector #inputChurnMinVisits
 *    del Studio + wiring de loadChurnList con copys que no mentir (1 visita
 *    no es "recurrente").
 * §3 #6 Happy Hour visible en TODOS los temas: el kicker deja de estar
 *    oculto globalmente (base visible con --chalk-dim), las morfologías que
 *    disuelven el cuerpo (moderna/basketball/ticker) dan slot vía la clase
 *    `dish-has-schedule` del render (patrón casa dish-has-photo, SIN :has())
 *    y sticker lo vuelve blanco sobre su overlay oscuro. La regla nordico
 *    duplicada queda consolidada.
 * §4 #8 nudge PWA del dueño: superficie propia del Studio (pwaNudge.js puro
 *    + Node-safe) — la píldora de pwa.js exige scroll que el layout del
 *    Studio no puede cumplir, así que gana guard `__SCANGO_PWA_SUPPRESS_BANNER__`
 *    y la del Studio aparece por retardo desde el prompt real.
 * §5 R3 multiplicador por nivel de lealtad (Fornno): escalera opt-in
 *    `loyaltyConfig.levels` ({name, minVisits, multiplier}) — módulo puro
 *    CJS + espejo ESM con paridad, sanitizer (ABSENT si basura) y el crédito
 *    multiplica con el tier YA ganado (visitas ANTES del pedido); el canje
 *    sigue restable de AMBOS ledgers en sync.
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const DAY_MS = 24 * 60 * 60 * 1000;
const accountsFile = path.join(process.cwd(), 'data', 'loyalty_accounts.json');
const customersFile = path.join(process.cwd(), 'data', 'customer_profiles.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
}
function writeJson(file, rows) {
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
}
function readSrc(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

// localStorage de prueba (el módulo lo usa lazy con try/catch; en Node se
// inyecta antes de importar — mismo patrón de test-onboarding-checklist).
const reorderStore = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(reorderStore, k) ? reorderStore[k] : null),
  setItem: (k, v) => { reorderStore[k] = String(v); },
  removeItem: (k) => { delete reorderStore[k]; }
};

async function runTests() {
  console.log('🧪 Iniciando verificación de Quick Wins (#5 Pedir de nuevo + #6 Happy Hour visible + #7 segmento una-visita + #8 nudge PWA + R3 multiplicador)...');

  // ══════════════════════════════════════════════════════════════════════════
  // §1a Módulo puro reorder.js
  // ══════════════════════════════════════════════════════════════════════════
  const reorder = await import('../public/js/menu/reorder.js');
  const SLUG = 'quick-wins-local';

  // Snapshot vacío/basura → false (nada que recordar).
  assert.strictEqual(reorder.saveReorderForSlug(SLUG, []), false, 'sin líneas no se snapshottea');
  assert.strictEqual(reorder.saveReorderForSlug('', [{ dishId: 'd1', quantity: 1 }]), false, 'slug vacío no snapshottea');
  assert.strictEqual(reorder.saveReorderForSlug(null, [{ dishId: 'd1', quantity: 1 }]), false, 'slug null no snapshottea');
  assert.strictEqual(reorder.getReorderForSlug(SLUG), null, 'slug desconocido → null');
  assert.strictEqual(reorder.getReorderForSlug(''), null, 'slug inválido → null');

  // Roundtrip feliz: la forma del snapshot es la del PAYLOAD del pedido.
  const happyLine = {
    dishId: 'dish_burger',
    quantity: 2,
    note: 'sin cebolla',
    orderedBy: 'Mesa 3',
    orderedById: 'guest_1',
    choices: [{ groupId: 'grp_extras', selections: [{ optionId: 'opt_cheddar', quantity: 1 }] }]
  };
  assert.strictEqual(reorder.saveReorderForSlug(SLUG, [happyLine]), true, 'snapshot guardado');
  let snapshot = reorder.getReorderForSlug(SLUG);
  assert.ok(snapshot && typeof snapshot.savedAt === 'number', 'snapshot con savedAt');
  assert.strictEqual(snapshot.items.length, 1, 'una línea');
  assert.strictEqual(snapshot.items[0].dishId, 'dish_burger', 'dishId preservado');
  assert.strictEqual(snapshot.items[0].quantity, 2, 'cantidad preservada');
  assert.strictEqual(snapshot.items[0].note, 'sin cebolla', 'nota preservada');
  assert.strictEqual(snapshot.items[0].choices.length, 1, 'choices preservadas');
  // La nota de atribución grupal NO viaja al snapshot: el re-agregar atribuye
  // al comensal ACTUAL (en modo solo es irrelevante; en grupo sería data vieja).
  assert.ok(!('orderedBy' in snapshot.items[0]), 'orderedBy no se persiste');
  assert.ok(!('orderedById' in snapshot.items[0]), 'orderedById no se persiste');

  // Saneo defensivo: cantidad clamp 1..99, nota cap 250, líneas sin dishId fuera.
  reorder.saveReorderForSlug('saneo', [
    { dishId: 'd1', quantity: 999, note: 'x'.repeat(500) },
    { quantity: 2, note: 'sin plato' },
    null,
    'junk',
    { dishId: 'd2', quantity: 0, note: '', choices: 'junk' },
    { dishId: 'd3', quantity: 3, choices: [{ groupId: 'g', selections: [{ optionId: 'o', quantity: 99 }] }] }
  ]);
  snapshot = reorder.getReorderForSlug('saneo');
  assert.strictEqual(snapshot.items.length, 3, 'líneas sin dishId/basura descartadas');
  assert.strictEqual(snapshot.items[0].quantity, 99, 'cantidad clamp a 99');
  assert.strictEqual(snapshot.items[0].note.length, 250, 'nota cap 250');
  assert.strictEqual(snapshot.items[1].quantity, 1, 'cantidad 0 → 1');
  assert.deepStrictEqual(snapshot.items[1].choices, [], 'choices basura → []');
  assert.strictEqual(snapshot.items[2].choices[0].selections[0].quantity, 99, 'quantity de la opción clamp 1..99');

  // Helado a medida: marcado para que el plan lo salte (los ids son de la
  // configuración VIVA del dueño; el armador es un toque).
  reorder.saveReorderForSlug('helado', [
    { dishId: 'icecream_x', quantity: 1, note: '', customIceCream: { containerId: 'c1', flavorIds: ['f1'], toppingIds: [] } }
  ]);
  snapshot = reorder.getReorderForSlug('helado');
  assert.strictEqual(snapshot.items[0].customIceCream, true, 'customIceCream → marcado true (no viaja el armado)');
  console.log('✓ §1a snapshot: roundtrip del payload, saneo (qty/note/choices), atribución grupal y armado fuera');

  // Tope de 30 líneas por snapshot.
  const thirtyPlus = [];
  for (let i = 0; i < 40; i++) thirtyPlus.push({ dishId: `dish_${i}`, quantity: 1, note: '', choices: [] });
  reorder.saveReorderForSlug('cap-items', thirtyPlus);
  assert.strictEqual(reorder.getReorderForSlug('cap-items').items.length, 30, 'cap de 30 líneas por snapshot');

  // Tope de 5 locales por savedAt: el más nuevo sobrevive.
  reorderStore.__reset_helper = undefined; // (no-op, legibilidad)
  reorder.saveReorderForSlug('slug-a', [{ dishId: 'a', quantity: 1, note: '', choices: [] }]);
  await new Promise((r) => setTimeout(r, 15));
  reorder.saveReorderForSlug('slug-b', [{ dishId: 'b', quantity: 1, note: '', choices: [] }]);
  await new Promise((r) => setTimeout(r, 15));
  reorder.saveReorderForSlug('slug-c', [{ dishId: 'c', quantity: 1, note: '', choices: [] }]);
  await new Promise((r) => setTimeout(r, 15));
  reorder.saveReorderForSlug('slug-d', [{ dishId: 'd', quantity: 1, note: '', choices: [] }]);
  await new Promise((r) => setTimeout(r, 15));
  reorder.saveReorderForSlug('slug-e', [{ dishId: 'e', quantity: 1, note: '', choices: [] }]);
  await new Promise((r) => setTimeout(r, 15));
  reorder.saveReorderForSlug('slug-f', [{ dishId: 'f', quantity: 1, note: '', choices: [] }]);
  const mapKeys = Object.keys(JSON.parse(reorderStore.scango_reorder || '{}'));
  assert.strictEqual(mapKeys.length, 5, 'cap de 5 locales');
  assert.ok(mapKeys.includes('slug-f'), 'el más nuevo sobrevive');
  assert.ok(!mapKeys.includes('saneo') && !mapKeys.includes('cap-items'), 'los más viejos salen');

  // forget: fuera del mapa.
  reorder.forgetReorderForSlug('slug-f');
  assert.strictEqual(reorder.getReorderForSlug('slug-f'), null, 'forget lo borra');
  console.log('✓ §1a topes: 30 líneas por pedido · 5 locales por savedAt · forget');

  // ── buildReorderPlan: reconcilia contra la carta ACTUAL ───────────────────
  const GROUPS = [
    { id: 'grp_extras', name: 'Extras', required: true, options: [{ id: 'opt_cheddar', name: 'Cheddar' }, { id: 'opt_bacon', name: 'Bacon' }] },
    { id: 'grp_salsa', name: 'Salsa', required: false, options: [{ id: 'opt_bbq', name: 'BBQ' }] }
  ];
  const DISHES = [
    { id: 'dish_burger', name: 'Burger', price: 10 },
    // (dish_gone NO está: el snapshot lo referencia y el plan lo salta 'missing')
    { id: 'dish_sold', name: 'Agotado Hoy', price: 7, soldOutToday: true },
    { id: 'dish_oo_stock', name: 'Sin Stock Manual', price: 7, outOfStock: true },
    { id: 'dish_night', name: 'Plato Nocturno', price: 9 }
  ];
  const deps = {
    dishes: DISHES,
    getDishGroups: (dish) => (dish.id === 'dish_burger' ? GROUPS : []),
    isDishAvailableNow: (dish) => dish.id !== 'dish_night' // el nocturno está fuera de horario
  };
  const planSnapshot = {
    savedAt: 1,
    items: [
      { dishId: 'dish_burger', quantity: 2, note: 'sin cebolla', choices: [{ groupId: 'grp_extras', selections: [{ optionId: 'opt_cheddar', quantity: 1 }] }] },
      { dishId: 'dish_gone', quantity: 1, note: '', choices: [] },
      { dishId: 'dish_sold', quantity: 1, note: '', choices: [] },
      { dishId: 'dish_oo_stock', quantity: 1, note: '', choices: [] },
      { dishId: 'dish_night', quantity: 1, note: '', choices: [] },
      { dishId: 'icecream_x', quantity: 1, note: '', customIceCream: true },
      { dishId: 'dish_burger', quantity: 1, note: '', choices: [{ groupId: 'grp_extras', selections: [{ optionId: 'opt_ELIMINADO', quantity: 1 }] }] },
      null,
      { quantity: 3, note: '', choices: [] }
    ]
  };
  const plan = reorder.buildReorderPlan(planSnapshot, deps);
  assert.strictEqual(plan.lines.length, 1, 'solo la línea feliz se agrega');
  assert.strictEqual(plan.lines[0].dish.id, 'dish_burger', 'la línea usa el plato ACTUAL');
  assert.strictEqual(plan.lines[0].quantity, 2, 'cantidad del plan');
  assert.strictEqual(plan.lines[0].note, 'sin cebolla', 'nota del plan');
  assert.deepStrictEqual(plan.lines[0].choices, [{ groupId: 'grp_extras', selections: [{ optionId: 'opt_cheddar', quantity: 1 }] }], 'choices reconciliadas (ids contra grupos vigentes)');
  assert.strictEqual(plan.skipped.length, 7, 'los otros 7 ítems se saltan con motivo');
  assert.ok(plan.skipped.some((s) => s.reason === 'missing'), 'plato que ya no está → missing');
  assert.ok(plan.skipped.some((s) => s.reason === 'soldout' && s.label === 'Agotado Hoy'), 'soldOutToday derivado → soldout');
  assert.ok(plan.skipped.some((s) => s.reason === 'soldout' && s.label === 'Sin Stock Manual'), 'outOfStock manual → soldout (mismo motivo)');
  assert.ok(plan.skipped.some((s) => s.reason === 'schedule' && s.label === 'Plato Nocturno'), 'fuera de horario → schedule');
  assert.ok(plan.skipped.some((s) => s.reason === 'custom'), 'helado a medida → custom');
  assert.ok(plan.skipped.some((s) => s.reason === 'options' && s.label === 'Burger'), 'grupo requerido sin opción viva → options (el /quote lo rechazaría igual)');
  assert.ok(!plan.skipped.some((s) => s.label === 'undefined' || s.label === 'null'), 'los saltos sin plato no inventan label basura');
  // La reconciliación FILTRA opciones muertas de grupos no requeridos (no mata la línea).
  const plan2 = reorder.buildReorderPlan({
    savedAt: 1,
    items: [{ dishId: 'dish_burger', quantity: 1, note: '', choices: [{ groupId: 'grp_salsa', selections: [{ optionId: 'opt_MUERTA', quantity: 1 }] }, { groupId: 'grp_muerto', selections: [{ optionId: 'x', quantity: 1 }] }, { groupId: 'grp_extras', selections: [{ optionId: 'opt_bacon', quantity: 1 }] }] }]
  }, deps);
  assert.deepStrictEqual(plan2.lines[0].choices, [{ groupId: 'grp_extras', selections: [{ optionId: 'opt_bacon', quantity: 1 }] }], 'grupos/opciones muertos filtrados; el requerido sano sobrevive');
  // Snapshot basura: sin throw, plan vacío.
  assert.strictEqual(reorder.buildReorderPlan(null, deps).lines.length, 0, 'snapshot null → plan vacío');
  assert.strictEqual(reorder.buildReorderPlan('junk', deps).lines.length, 0, 'snapshot string → plan vacío');
  assert.strictEqual(reorder.buildReorderPlan({ savedAt: 1, items: 'junk' }, deps).lines.length, 0, 'items basura → plan vacío');
  assert.strictEqual(reorder.buildReorderPlan(planSnapshot, {}).lines.length, 0, 'sin deps → plan vacío (no throw)');
  // PUREZA: el snapshot de entrada no se muta.
  const beforeJson = JSON.stringify(planSnapshot);
  reorder.buildReorderPlan(planSnapshot, deps);
  assert.strictEqual(JSON.stringify(planSnapshot), beforeJson, 'buildReorderPlan NO muta el snapshot');
  console.log('✓ §1a plan: feliz + missing/soldout(2)/schedule/custom/options/basura · pureza');

  // describeReorderPlan: copy honesta.
  assert.strictEqual(
    reorder.describeReorderPlan({ lines: [], skipped: [] }),
    'Los platos de tu último pedido ya no están disponibles. Elegí algo nuevo 🙂',
    'todo salteado → copy honesta'
  );
  assert.strictEqual(reorder.describeReorderPlan(null), 'Los platos de tu último pedido ya no están disponibles. Elegí algo nuevo 🙂', 'plan basura → copy honesta');
  assert.ok(
    /🛒 2 platos agregados/.test(reorder.describeReorderPlan(plan)) && /7 omitidos/.test(reorder.describeReorderPlan(plan)),
    'plan parcial → agregados + omitidos'
  );
  const single = reorder.describeReorderPlan({ lines: [{ dish: DISHES[0], quantity: 1, note: '', choices: [] }], skipped: [{ label: 'Papas', reason: 'soldout', copy: 'agotado' }] });
  assert.ok(/🛒 1 plato agregado/.test(single) && /1 omitido \(Papas\)/.test(single), 'singular + nombre del omitido');

  // ── Barrel: los exports viven en menu/index.js (sin colisiones) ───────────
  const barrel = await import('../public/js/menu/index.js');
  assert.strictEqual(typeof barrel.buildReorderPlan, 'function', 'barrel expone buildReorderPlan');
  assert.strictEqual(typeof barrel.describeReorderPlan, 'function', 'barrel expone describeReorderPlan');
  assert.strictEqual(typeof barrel.getReorderForSlug, 'function', 'barrel expone getReorderForSlug');
  assert.strictEqual(typeof barrel.saveReorderForSlug, 'function', 'barrel expone saveReorderForSlug');

  // ── §1b Wiring estático ───────────────────────────────────────────────────
  const orderSubmitSrc = readSrc('public/js/menu/orderSubmit.js');
  assert.ok(/ctx\.saveReorderSnapshot\(items\.map\(item => ctx\.toOrderItemPayload\(item\)\)\)/.test(orderSubmitSrc), 'el snapshot usa el MISMO payload del POST (cero transformación inventada)');
  assert.ok(/if \(!isGroupOrder\) \{[\s\S]{0,120}ctx\.saveReorderSnapshot/.test(orderSubmitSrc), 'en mesa grupal NO se snapshottea (las líneas de otros comensales se re-atribuirían mal)');
  assert.ok(/try \{[\s\S]{0,160}saveReorderSnapshot[\s\S]{0,80}\} catch/.test(orderSubmitSrc), 'el snapshot es best-effort (nunca rompe el alta del pedido)');

  const menuJs = readSrc('public/js/menu.js');
  assert.ok(/function reorderLastOrder\(\)/.test(menuJs), 'menu.js: handler reorderLastOrder');
  assert.ok(/function maybeShowReorderFab\(\)/.test(menuJs), 'menu.js: FAB gate maybeShowReorderFab');
  assert.ok(/maybeShowReorderFab\(\);/.test(menuJs), 'menu.js: el FAB se evalúa en notifyMenuReady');
  assert.ok(/addDishToCart\(line\.dish, line\.note, line\.choices\)/.test(menuJs), 'menu.js: re-agrega por el flujo existente (semántica exacta en solo y grupal)');
  assert.ok(/trackPublicEvent\('reorder_click'/.test(menuJs), 'menu.js: el click se mide como tipo crudo');
  assert.ok(/^      reorderLastOrder,\s*$/m.test(menuJs), 'menu.js: reorderLastOrder en window (binder data-js-click)');
  assert.ok(/buildReorderPlan as buildReorderPlanMod/.test(menuJs), 'menu.js importa el módulo por el barrel');
  assert.ok(/getDishScheduleStatus\(dish\)\.isAvailable/.test(menuJs), 'menu.js: el gate de horario es el MISMO del botón +');

  const menuHtml = readSrc('public/menu.html');
  assert.ok(/id="reorderFab"/.test(menuHtml), 'menu.html: FAB #reorderFab');
  assert.ok(/data-js-click="reorderLastOrder"/.test(menuHtml), 'menu.html: el FAB se activa con data-js-click (CSP: cero on*=)');
  assert.ok(/aria-label="Repetir mi último pedido"/.test(menuHtml), 'menu.html: nombre accesible');
  assert.ok(/id="reorderFab"[^>]*style="display:none/.test(menuHtml), 'menu.html: el FAB nace oculto (solo aparece con snapshot repetible)');

  const menuCss = readSrc('public/css/menu.css');
  assert.ok(/#reorderFab \{ bottom: 146px; \}/.test(menuCss), 'menu.css: el FAB comparte la columna de FABs');
  assert.ok(!/on\*=/.test(readSrc('public/js/menu/reorder.js')), 'reorder.js: cero on*=');
  assert.ok(!/document\./.test(readSrc('public/js/menu/reorder.js')), 'reorder.js: cero DOM (puro, seguro en Node)');
  assert.ok(/export \* from '\.\/reorder\.js';/.test(readSrc('public/js/menu/index.js')), 'barrel: reorder.js re-exportado');
  console.log('✓ §1b wiring estático: orderSubmit hook + menu.js + FAB CSP-safe + barrel');

  // ══════════════════════════════════════════════════════════════════════════
  // §2a Módulo puro: clamp de minVisits [1,10] (churnRecovery)
  // ══════════════════════════════════════════════════════════════════════════
  const { computeChurnCandidates } = require('../api/utils/churnRecovery');
  const NOW = Date.parse('2026-10-20T12:00:00.000Z');
  const mkAccount = (over = {}) => ({ id: 'acc_' + Math.random().toString(36).slice(2), customerId: 'cust_x', restaurantId: 'rA', visits: 2, points: 120, lastVisitAt: new Date(NOW - 50 * DAY_MS).toISOString(), ...over });
  const mkCustomer = (over = {}) => ({ id: 'cust_x', phone: '59899123456', name: 'Ana', email: 'ana@mail.com', consentMarketing: true, ...over });

  // minVisits=1 abre el segmento una-visita (el cliente más barato de reactivar).
  let report = computeChurnCandidates({
    accounts: [mkAccount({ visits: 1 })],
    customers: [mkCustomer()], restaurantId: 'rA', nowMs: NOW, minVisits: 1
  });
  assert.strictEqual(report.minVisits, 1, 'minVisits=1 se respeta');
  assert.strictEqual(report.count, 1, 'una-visita ausente ES candidata con minVisits=1');

  // Default (2) la excluye: nunca fue recurrente.
  report = computeChurnCandidates({
    accounts: [mkAccount({ visits: 1 })],
    customers: [mkCustomer()], restaurantId: 'rA', nowMs: NOW
  });
  assert.strictEqual(report.minVisits, 2, 'default 2');
  assert.strictEqual(report.count, 0, 'una-visita NO es candidata con el default');

  // Clamp: 999 → 10. El umbral es un MÍNIMO (visitas >= minVisits y ausente):
  // con el tope, 11 y 10 visitas siguen siendo candidatas y 9 queda afuera.
  report = computeChurnCandidates({
    accounts: [
      mkAccount({ id: 'a1', customerId: 'c1', visits: 11 }),
      mkAccount({ id: 'a2', customerId: 'c2', visits: 10 }),
      mkAccount({ id: 'a3', customerId: 'c3', visits: 9 })
    ],
    customers: [mkCustomer(), mkCustomer({ id: 'c2' }), mkCustomer({ id: 'c3' })],
    restaurantId: 'rA', nowMs: NOW, minVisits: 999
  });
  assert.strictEqual(report.minVisits, 10, 'minVisits 999 → 10 (tope)');
  assert.strictEqual(report.count, 2, 'con el tope, 11 y 10 adentro; 9 queda afuera');

  report = computeChurnCandidates({
    accounts: [mkAccount({ visits: 1 })],
    customers: [mkCustomer()], restaurantId: 'rA', nowMs: NOW, minVisits: 0
  });
  assert.strictEqual(report.minVisits, 1, 'minVisits 0 → 1 (el mínimo del segmento)');
  assert.strictEqual(report.count, 1, 'visits=1 pasa con el clamp del 0');

  report = computeChurnCandidates({
    accounts: [mkAccount({ visits: 1 })],
    customers: [mkCustomer()], restaurantId: 'rA', nowMs: NOW, minVisits: 'abc'
  });
  assert.strictEqual(report.minVisits, 2, 'basura → default 2');
  console.log('✓ §2a clamp minVisits [1,10]: una-visita adentro con 1, afuera con default, 999→10, basura→2');

  // ══════════════════════════════════════════════════════════════════════════
  // §2b Runtime: GET /api/loyalty/churn?minVisits= con cuentas REALES
  // ══════════════════════════════════════════════════════════════════════════
  const stamp = Date.now();
  const phone1 = '598' + String(stamp).slice(-9);      // 1 visita
  const phone2 = '598' + String(stamp + 1).slice(-9);  // 2 visitas
  const userA = await db.createUser({ email: `test-quickwins-${stamp}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const restA = await db.saveRestaurant(userA.id, {
    name: 'Quick Wins Local', bizName: 'Quick Wins Local',
    slug: `quick-wins-${stamp}`, allowLoyaltyPoints: true, currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const tokenA = jwt.sign({ userId: userA.id }, JWT_SECRET, { expiresIn: '1h' });
  const authA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };
  const postJson = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });

  try {
    // Cuentas reales del Club: 1 pedido (visits=1) y 2 pedidos (visits=2).
    await postJson('/api/orders', { restaurantId: restA.id, items: [{ dishId: 'dish1', quantity: 1 }], customerName: 'Beto', customerPhone: '+' + phone1, currency: 'USD' });
    await postJson('/api/orders', { restaurantId: restA.id, items: [{ dishId: 'dish1', quantity: 1 }], customerName: 'Caro', customerPhone: '+' + phone2, currency: 'USD' });
    await postJson('/api/orders', { restaurantId: restA.id, items: [{ dishId: 'dish1', quantity: 1 }], customerName: 'Caro', customerPhone: '+' + phone2, currency: 'USD' });

    // Envejecer las DOS cuentas: 50 días sin volver (mismo trato, solo cambia minVisits).
    const accounts = readJson(accountsFile);
    let aged = 0;
    for (const row of accounts) {
      if (row.restaurantId === restA.id) {
        row.lastVisitAt = new Date(Date.now() - 50 * DAY_MS).toISOString();
        if (row.last_visit_at !== undefined) row.last_visit_at = row.lastVisitAt;
        aged++;
      }
    }
    assert.ok(aged >= 2, `las dos cuentas existen tras los pedidos (aged=${aged})`);
    writeJson(accountsFile, accounts);

    const getChurn = async (query) => {
      const res = await fetch(`${base}/api/loyalty/churn${query || ''}`, { headers: authA });
      assert.strictEqual(res.status, 200, 'dueño lista su churn');
      return (await res.json()).data;
    };

    const report1 = await getChurn('?minVisits=1');
    assert.strictEqual(report1.minVisits, 1, 'el query param llega al módulo');
    assert.strictEqual(report1.count, 2, 'con minVisits=1 AMBAS son candidatas (una-visita incluida)');

    const reportDefault = await getChurn('');
    assert.strictEqual(reportDefault.minVisits, 2, 'sin param → default 2');
    assert.strictEqual(reportDefault.count, 1, 'con el default SOLO la recurrente es candidata');

    const reportClamped = await getChurn('?minVisits=999');
    assert.strictEqual(reportClamped.minVisits, 10, '999 se clampea a 10 server-side');
    assert.strictEqual(reportClamped.count, 0, 'con el tope, ninguna cuenta chica es candidata');

    // El copy del panel NO miente: 1 visita no es "recurrente".
    const loyaltySrc = readSrc('public/js/studio/loyaltyManager.js');
    assert.ok(!/cliente\(s\) recurrentes/.test(loyaltySrc), 'la lista ya no dice "recurrentes" (con minVisits=1 sería mentira)');
    assert.ok(/report\.minVisits\} \$\{report\.minVisits === 1 \? 'visita' : 'visitas'\} o más/.test(loyaltySrc), 'el resumen incluye el mínimo de visitas');
    assert.ok(/inputChurnMinVisits/.test(loyaltySrc), 'loadChurnList lee el selector nuevo');
    assert.ok(/&minVisits=\$\{encodeURIComponent\(minVisits\)\}/.test(loyaltySrc), 'el query lleva minVisits');

    const studioHtml = readSrc('public/studio.html');
    assert.ok(/id="inputChurnMinVisits"/.test(studioHtml), 'Studio: selector #inputChurnMinVisits');
    assert.ok(/aria-label="Visitas mínimas para considerar en riesgo"/.test(studioHtml), 'Studio: selector con nombre accesible');
    assert.ok(/<option value="1">1 visita<\/option>/.test(studioHtml) && /<option value="3">3 visitas<\/option>/.test(studioHtml), 'Studio: opciones 1/2/3');
    assert.ok(/Con 1 visita incluyés a quienes probaron una sola vez/.test(studioHtml), 'Studio: hint del segmento una-visita');
    // Alineación winback: el schema ya no acepta 100 (mismo tope que el clamp).
    const loyaltyRouteSrc = readSrc('api/routes/loyalty.js');
    assert.ok(/minVisits: z\.number\(\)\.int\(\)\.min\(1\)\.max\(10\)\.optional\(\)\.default\(2\)/.test(loyaltyRouteSrc), 'winback schema alineado al clamp [1,10]');
    const openapiSrc = readSrc('openapi.yaml');
    assert.ok(/maximum: 10, default: 2 \}/.test(openapiSrc), 'openapi: minVisits con maximum 10');
    console.log('✓ §2b runtime churn?minVisits: 1 abre, default cierra, 999→10 + wiring Studio/contrato');

    // ════════════════════════════════════════════════════════════════════════
    // §1c Runtime: canal público con `reorder_click` (tipo CRUDO, patrón F4)
    // ════════════════════════════════════════════════════════════════════════
    const before = db.findRestaurantById(restA.id).analytics || {};
    const postEvent = async (body) => {
      const res = await fetch(`${base}/api/public/analytics/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    const click = await postEvent({ slug: restA.slug, event: 'reorder_click', lines: 2, skipped: 1 });
    assert.strictEqual(click.status, 200, 'reorder_click → 200 (allowlist del canal)');
    assert.strictEqual(click.body.telemetry, true, 'el evento se persistió como telemetría');
    assert.strictEqual(click.body.analytics.visits, before.visits || 0, 'reorder_click NO infla visitas');
    assert.strictEqual(click.body.analytics.orders, before.orders || 0, 'reorder_click NO infla órdenes');
    assert.ok(!('averageTicket' in click.body.analytics) || click.body.analytics.averageTicket === (before.averageTicket || 0), 'el ticket promedio no se mueve');

    const minimal = await postEvent({ slug: restA.slug, event: 'reorder_click', consent: 'necessary' });
    assert.strictEqual(minimal.status, 200, 'consent necessary → 200 honesto');
    assert.strictEqual(minimal.body.recorded, false, 'consent necessary → NO se persiste lo analítico');
    assert.strictEqual(minimal.body.reason, 'CONSENT_NECESSARY', 'motivo explícito');

    const demoEvent = await postEvent({ slug: 'demo-restaurante', event: 'reorder_click' });
    assert.strictEqual(demoEvent.status, 200, 'demo → 200 no-op');
    assert.strictEqual(demoEvent.body.demo, true, 'demo no persiste telemetría');

    const invalid = await postEvent({ slug: restA.slug, event: 'evento_inventado' });
    assert.strictEqual(invalid.status, 400, 'evento fuera de la allowlist → 400');
    // La proyección no conoce el tipo: NUNCA entra en LEGACY_COUNTER_TYPES.
    const telemetrySrc = readSrc('api/services/telemetry.js');
    assert.ok(/'reorder_click'/.test(telemetrySrc), 'reorder_click en EVENT_TYPES');
    const legacyBlock = telemetrySrc.split(/const\s+LEGACY_COUNTER_TYPES\s*=/)[1] || '';
    assert.ok(!legacyBlock.includes('reorder_click'), 'reorder_click es CRUDO (fuera de la proyección legacy)');
    console.log('✓ §1c canal público: 200 sin tocar contadores · consent necessary · demo no-op · 400 fuera');
  } finally {
    server.close();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §3 #6 Happy Hour visible en TODOS los temas
  // ══════════════════════════════════════════════════════════════════════════
  // Base: visible con la variable del tema (la regla display:none murió).
  const kickerBlocks = menuCss.match(/[^{}]*\.dish-schedule-kicker[^{}]*\{[^}]*\}/g) || [];
  assert.ok(kickerBlocks.length >= 5, `hay reglas de slot por morfología (${kickerBlocks.length})`);
  for (const block of kickerBlocks) {
    assert.ok(!/display:\s*none/.test(block), 'cero display:none en reglas del kicker (la ocultación global no vuelve)');
  }
  const baseRule = kickerBlocks.find(b => b.replace(/\/\*[\s\S]*?\*\//g, '').trim().startsWith('.dish-schedule-kicker {'));
  assert.ok(baseRule, 'menu.css: regla base del kicker');
  assert.ok(/display:\s*block/.test(baseRule), 'base: display:block (visible en todos los temas)');
  assert.ok(/var\(--chalk-dim/.test(baseRule), 'base: color con la variable del tema activo');
  // Las morfologías que disuelven el cuerpo dan slot por CLASE del render
  // (patrón casa dish-has-photo; sin :has() — funciona en cualquier WebView).
  assert.ok(/body\.theme-moderna\.layout-classic \.dish-card\.dish-has-schedule \.dish-name \{ grid-row: 2; \}/.test(menuCss), 'moderna: name baja a fila 2 con horario');
  assert.ok(/body\.theme-moderna\.layout-classic \.dish-card\.dish-has-schedule \.dish-price \{ grid-row: 2; \}/.test(menuCss), 'moderna: price fila 2');
  assert.ok(/body\.theme-moderna\.layout-classic \.dish-card\.dish-has-schedule \.dish-action \{ grid-row: 3; \}/.test(menuCss), 'moderna: action fila 3');
  assert.ok(/body\.theme-basketball\.layout-classic \.dish-card\.dish-has-schedule \.dish-name \{ grid-row: 2; \}/.test(menuCss), 'basketball: name fila 2');
  assert.ok(/body\.theme-basketball\.layout-classic \.dish-card\.dish-has-schedule \.dish-desc \{ grid-row: 3; \}/.test(menuCss), 'basketball: desc fila 3');
  assert.ok(/"kicker kicker"[\s\S]{0,20}"title price"/.test(menuCss), 'ticker: template-areas extendido con fila kicker');
  assert.ok(/grid-area: kicker;/.test(menuCss), 'ticker: el kicker ocupa su area');
  assert.ok(/body\.layout-sticker \.dish-card\.dish-has-photo \.dish-schedule-kicker \{[\s\S]{0,120}rgba\(255, 255, 255/.test(menuCss), 'sticker: kicker blanco translúcido sobre el overlay oscuro');
  // La regla nordico duplicada quedó consolidada (la base la cubre).
  assert.ok(!/body\.theme-nordico \.dish-schedule-kicker/.test(menuCss), 'nordico: sin regla duplicada (la base global con --chalk-dim la reemplaza)');
  // El render emite la clase condicional junto al kicker (mismo patrón casa).
  const menuRenderSrc = readSrc('public/js/menu/menuRender.js');
  assert.ok(/scheduleKickerHtml \? 'dish-has-schedule' : ''/.test(menuRenderSrc), 'menuRender: clase condicional dish-has-schedule');
  assert.ok(/class="dish-schedule-kicker"/.test(menuRenderSrc), 'menuRender: el kicker sigue emitiéndose');
  console.log('✓ §3 kicker: base visible con vars · slots moderna/basketball/ticker/sticker · nordico consolidado · cero display:none');

  // ══════════════════════════════════════════════════════════════════════════
  // §4 #8 "Nudge PWA del dueño": superficie propia del Studio
  // ══════════════════════════════════════════════════════════════════════════
  // pwa.js exigía scroll ≥400px que el layout del Studio (sidebar + paneles)
  // nunca dispara: el dueño instalable quedaba sin CTA. La superficie nueva
  // aparece por retardo desde el prompt REAL (señal de interés del dueño).
  const pwaNudge = await import('../public/js/studio/pwaNudge.js');
  const NUDGE_DELAY = pwaNudge.STUDIO_PWA_SHOW_DELAY_MS;
  assert.ok(NUDGE_DELAY >= 10000, `el retardo no interrumpe la primera impresión (${NUDGE_DELAY}ms)`);

  // Tabla de decisión pura:
  assert.strictEqual(pwaNudge.shouldShowStudioPwaNudge({ dismissed: false, standalone: false, hasPrompt: true, elapsedMs: NUDGE_DELAY }), true, 'todo cumplido → mostrar');
  assert.strictEqual(pwaNudge.shouldShowStudioPwaNudge({ dismissed: true, standalone: false, hasPrompt: true, elapsedMs: NUDGE_DELAY }), false, 'descartado antes → nunca más');
  assert.strictEqual(pwaNudge.shouldShowStudioPwaNudge({ dismissed: false, standalone: true, hasPrompt: true, elapsedMs: NUDGE_DELAY }), false, 'ya instalada (standalone) → no molesta');
  assert.strictEqual(pwaNudge.shouldShowStudioPwaNudge({ dismissed: false, standalone: false, hasPrompt: false, elapsedMs: NUDGE_DELAY }), false, 'sin prompt del navegador → no hay nada que instalar');
  assert.strictEqual(pwaNudge.shouldShowStudioPwaNudge({ dismissed: false, standalone: false, hasPrompt: true, elapsedMs: 0 }), false, 'sin retardo cumplido → no');
  assert.strictEqual(pwaNudge.shouldShowStudioPwaNudge({ dismissed: false, standalone: false, hasPrompt: true, elapsedMs: 'basura' }), false, 'elapsed basura → no');
  assert.strictEqual(pwaNudge.isStandaloneDisplay(null), false, 'sin matchMedia (Node) → false');
  assert.strictEqual(pwaNudge.initStudioPwaNudge(undefined), null, 'init sin window → null (Node-safe, el test importa el módulo)');

  // Wiring estático: guard en pwa.js + módulo CSP-safe + import en studio.js.
  const pwaSrc = readSrc('public/js/pwa.js');
  assert.ok(/__SCANGO_PWA_SUPPRESS_BANNER__/.test(pwaSrc), 'pwa.js: guard de supresión (el Studio tiene superficie propia, cero doble banner)');
  const pwaNudgeSrc = readSrc('public/js/studio/pwaNudge.js');
  assert.ok(/scango_studio_pwa_dismissed/.test(pwaNudgeSrc), 'pwaNudge: descartable propio (no comparte key con el menú)');
  assert.ok(/triggerPWAInstall/.test(pwaNudgeSrc), 'pwaNudge: delega en el trigger global de pwa.js (cero lógica duplicada)');
  assert.ok(/appinstalled/.test(pwaNudgeSrc), 'pwaNudge: se oculta al instalarse');
  assert.ok(/pwa-install-ready/.test(pwaNudgeSrc), 'pwaNudge: escucha el prompt real');
  assert.ok(!/\son[a-z]+=/.test(pwaNudgeSrc), 'pwaNudge: cero atributos de evento inline (CSP)');
  assert.ok(!/\.innerHTML\s*=/.test(pwaNudgeSrc), 'pwaNudge: render DOM API (cero asignaciones innerHTML)');
  const studioJsSrc = readSrc('public/js/studio.js');
  assert.ok(/initStudioPwaNudge\(\);/.test(studioJsSrc), 'studio.js: llama initStudioPwaNudge en el arranque');
  assert.ok(/__SCANGO_PWA_SUPPRESS_BANNER__ = true/.test(studioJsSrc), 'studio.js: flag de supresión de la píldora del menú');
  // El Studio ya trae manifest + pwa.js: instalable de verdad, solo faltaba el CTA.
  const studioHtmlSrc = readSrc('public/studio.html');
  assert.ok(/rel="manifest" href="\/manifest\.json"/.test(studioHtmlSrc), 'studio.html: manifest presente (instalable)');
  assert.ok(/src="\/js\/pwa\.js"/.test(studioHtmlSrc), 'studio.html: pwa.js presente (SW + trigger global)');
  console.log('✓ §4 nudge PWA del dueño: tabla de decisión pura · Node-safe · wiring sin doble banner');

  // ══════════════════════════════════════════════════════════════════════════
  // §5 R3 "Multiplicador por nivel de lealtad" (Fornno)
  // ══════════════════════════════════════════════════════════════════════════
  const loyaltyLevels = require('../api/utils/loyaltyLevels');
  const loyaltyLevelsEsm = await import('../public/js/utils/loyaltyLevels.js');

  // ── §5a sanitizeLoyaltyLevels: opt-in, ABSENT si basura ──────────────────
  assert.strictEqual(loyaltyLevels.sanitizeLoyaltyLevels(undefined), undefined, 'sin niveles → campo ABSENT');
  assert.strictEqual(loyaltyLevels.sanitizeLoyaltyLevels('junk'), undefined, 'string → ABSENT');
  assert.strictEqual(loyaltyLevels.sanitizeLoyaltyLevels([]), undefined, 'vacío → ABSENT');
  assert.strictEqual(loyaltyLevels.sanitizeLoyaltyLevels([{ name: '   ', minVisits: 0, multiplier: 2 }]), undefined, 'sin nombre → ABSENT');
  assert.strictEqual(loyaltyLevels.sanitizeLoyaltyLevels([{ name: 'X', minVisits: -1, multiplier: 2 }]), undefined, 'minVisits negativo → fila afuera → ABSENT');

  const ladder = loyaltyLevels.sanitizeLoyaltyLevels([
    { name: 'Oro', minVisits: 12, multiplier: 2 },
    { name: 'Bronce', minVisits: 0, multiplier: 1 },
    { name: 'Plata', minVisits: 5, multiplier: 1.5 }
  ]);
  assert.deepStrictEqual(ladder, [
    { name: 'Bronce', minVisits: 0, multiplier: 1 },
    { name: 'Plata', minVisits: 5, multiplier: 1.5 },
    { name: 'Oro', minVisits: 12, multiplier: 2 }
  ], 'ordena por minVisits asc');

  // Clamp del multiplicador: [1,10] en pasos de 0.5; filas basura afuera.
  assert.deepStrictEqual(loyaltyLevels.sanitizeLoyaltyLevels([
    { name: 'Sube', minVisits: 0, multiplier: 0.5 },
    { name: 'Tope', minVisits: 1, multiplier: 99 },
    { name: 'Paso', minVisits: 2, multiplier: 2.25 },
    { name: 'Basura', minVisits: 3, multiplier: 'x' },
    { name: '   ', minVisits: 4, multiplier: 2 },
    { name: 'Neg', minVisits: -3, multiplier: 2 }
  ]), [
    { name: 'Sube', minVisits: 0, multiplier: 1 },
    { name: 'Tope', minVisits: 1, multiplier: 10 },
    { name: 'Paso', minVisits: 2, multiplier: 2.5 }
  ], 'clamp [1,10] pasos de 0.5; filas sin nombre/multiplicador/minVisits válidos descartadas');

  // Cap de 5 niveles + dedupe por frontera (la primera grafía manda).
  const sixRows = [];
  for (let i = 0; i < 6; i++) sixRows.push({ name: 'N' + i, minVisits: i, multiplier: 1 });
  assert.strictEqual(loyaltyLevels.sanitizeLoyaltyLevels(sixRows).length, 5, 'cap de 5 niveles');
  const dup = loyaltyLevels.sanitizeLoyaltyLevels([
    { name: 'Primera', minVisits: 5, multiplier: 1.5 },
    { name: 'Duplicada', minVisits: 5, multiplier: 3 }
  ]);
  assert.strictEqual(dup.length, 1, 'frontera duplicada → una fila');
  assert.strictEqual(dup[0].name, 'Primera', 'la primera grafía manda en el dedupe');
  // Nombre cap 24 + colapso de espacios.
  const longName = loyaltyLevels.sanitizeLoyaltyLevels([{ name: '  A   B  '.padEnd(40, 'x'), minVisits: 0, multiplier: 1 }]);
  assert.strictEqual(longName[0].name.length, 24, 'nombre cap 24');
  assert.ok(!/  /.test(longName[0].name), 'espacios colapsados');

  // ── resolvePointsMultiplier: tabla de decisión ───────────────────────────
  const R = (visits) => loyaltyLevels.resolvePointsMultiplier(ladder, visits);
  assert.strictEqual(R(0), 1, '0 visitas → tier base 1×');
  assert.strictEqual(R(4), 1, '4 visitas → todavía 1×');
  assert.strictEqual(R(5), 1.5, '5 visitas → Plata 1.5×');
  assert.strictEqual(R(11), 1.5, '11 visitas → Plata');
  assert.strictEqual(R(12), 2, '12 visitas → Oro 2×');
  assert.strictEqual(R(9999), 2, 'el tier más alto se mantiene');
  assert.strictEqual(R('abc'), 1, 'visitas basura → 1');
  assert.strictEqual(R(-5), 1, 'visitas negativas → 1');
  assert.strictEqual(loyaltyLevels.resolvePointsMultiplier(undefined, 5), 1, 'sin escalera → 1 (comportamiento intacto)');
  assert.strictEqual(loyaltyLevels.resolvePointsMultiplier([], 5), 1, 'escalera vacía → 1');
  assert.strictEqual(loyaltyLevels.resolvePointsMultiplier([
    { name: 'A', minVisits: 5, multiplier: 1.5 },
    { name: 'B', minVisits: 5, multiplier: 3 }
  ], 5), 3, 'empate de frontera → la última fila del array');
  console.log('✓ §5a módulo puro: ABSENT si basura · clamp 0.5/[1,10] · cap 5 · dedupe · tabla de decisión');

  // ── §5b Paridad CJS ↔ ESM (corpus determinista) ──────────────────────────
  const corpora = [
    undefined, null, 'junk', 42, [],
    [{ name: 'Bronce', minVisits: 0, multiplier: 1 }],
    [{ name: 'Oro', minVisits: 12, multiplier: 2 }, { name: 'Bronce', minVisits: 0, multiplier: 1 }, { name: 'Plata', minVisits: 5, multiplier: 1.5 }],
    [{ name: 'X', minVisits: 3, multiplier: 2.25 }, { name: 'Y', minVisits: 3, multiplier: 4 }, { name: 'Z', minVisits: 7, multiplier: 'x' }],
    sixRows
  ];
  for (const corpus of corpora) {
    assert.deepStrictEqual(
      loyaltyLevels.sanitizeLoyaltyLevels(corpus),
      loyaltyLevelsEsm.sanitizeLoyaltyLevels(corpus),
      'paridad CJS↔ESM: sanitizeLoyaltyLevels'
    );
    const sanitized = loyaltyLevels.sanitizeLoyaltyLevels(corpus) || [];
    for (const visits of [0, 1, 4, 5, 7, 12, 50, 'abc', null]) {
      assert.strictEqual(
        loyaltyLevels.resolvePointsMultiplier(sanitized, visits),
        loyaltyLevelsEsm.resolvePointsMultiplier(sanitized, visits),
        'paridad CJS↔ESM: resolvePointsMultiplier'
      );
    }
  }
  console.log('✓ §5b paridad CJS↔ESM exacta sobre corpus determinista (patrón dishStation/viralRef)');

  // ── §5c Sanitizer: opt-in idempotente, no privilegiado, basura fuera ─────
  const sanitizeRestaurant = require('../api/utils/sanitizeRestaurant');
  const dirty = { name: 'Local', loyaltyConfig: { enabled: true, pointsPerOrder: 10, levels: [{ name: 'Plata', minVisits: 5, multiplier: 1.5 }, { name: 'x', minVisits: -1, multiplier: 99 }] } };
  const cleaned = sanitizeRestaurant.sanitizeRestaurantPayload(dirty);
  assert.deepStrictEqual(cleaned.loyaltyConfig.levels, [{ name: 'Plata', minVisits: 5, multiplier: 1.5 }], 'sanitizer: levels saneado (fila basura afuera)');
  const onceCleaned = sanitizeRestaurant.sanitizeRestaurantPayload(JSON.parse(JSON.stringify(cleaned)));
  assert.deepStrictEqual(onceCleaned.loyaltyConfig.levels, cleaned.loyaltyConfig.levels, 'round-trip idempotente');
  const { stripPrivilegedFields } = require('../api/utils/stripPrivilegedFields');
  const stripped = stripPrivilegedFields(JSON.parse(JSON.stringify(cleaned)));
  assert.ok(stripped.loyaltyConfig && Array.isArray(stripped.loyaltyConfig.levels) && stripped.loyaltyConfig.levels.length === 1, 'la escalera es del DUEÑO: sobrevive stripPrivilegedFields');
  assert.strictEqual('loyaltyConfig' in sanitizeRestaurant.sanitizeRestaurantPayload({ name: 'L', loyaltyConfig: 'junk' }), false, 'loyaltyConfig basura no-objeto → campo fuera');
  console.log('✓ §5c sanitizer: idempotente · no privilegiado · config basura descartada');

  // ── §5d Runtime real: creditOrder con multiplicador ──────────────────────
  const loyaltyService = require('../api/services/loyalty');
  const ledgerFile = path.join(process.cwd(), 'data', 'loyalty_ledger.json');
  const restR3 = {
    id: `qw_r3_${stamp}`,
    name: 'R3 Local', slug: `qw-r3-${stamp}`,
    loyaltyConfig: {
      enabled: true, pointsPerOrder: 10, pointsPerCurrency: 1,
      levels: [{ name: 'Plata', minVisits: 5, multiplier: 1.5 }, { name: 'Oro', minVisits: 12, multiplier: 2 }]
    }
  };
  const restSinNiveles = {
    id: `qw_r3_sin_${stamp}`,
    name: 'Sin Niveles', slug: `qw-r3-sin-${stamp}`,
    loyaltyConfig: { enabled: true, pointsPerOrder: 10, pointsPerCurrency: 1 }
  };
  const phoneR3 = '+59891' + String(stamp).slice(-6);
  const AMOUNT_CENTS = 5000; // base = 10 + (5000/100)*1 = 60 pts

  // 0 visitas → 1×: un local con escalera configurada arranca igual que hoy.
  const c1r3 = await loyaltyService.creditOrder({ restaurant: restR3, customerPhone: phoneR3, orderId: `ord_r3_a_${stamp}`, amountInCents: AMOUNT_CENTS });
  assert.strictEqual(c1r3.credited, true, 'acredita');
  assert.strictEqual(c1r3.points, 60, '0 visitas → 1× (60 pts)');
  // Idempotencia por pedido intacta (el reintento no duplica).
  const againR3 = await loyaltyService.creditOrder({ restaurant: restR3, customerPhone: phoneR3, orderId: `ord_r3_a_${stamp}`, amountInCents: AMOUNT_CENTS });
  assert.strictEqual(againR3.credited, false, 'mismo orderId → already_credited');
  assert.strictEqual(againR3.reason, 'already_credited', 'motivo explícito');

  // Subir la cuenta a Plata (5 visitas): el SIGUIENTE pedido gana 1.5×.
  let accountsRows = readJson(accountsFile);
  const accR3 = accountsRows.find(r => r.restaurantId === restR3.id);
  assert.ok(accR3, 'la cuenta local existe');
  accR3.visits = 5;
  writeJson(accountsFile, accountsRows);
  const c2r3 = await loyaltyService.creditOrder({ restaurant: restR3, customerPhone: phoneR3, orderId: `ord_r3_b_${stamp}`, amountInCents: AMOUNT_CENTS });
  assert.strictEqual(c2r3.points, 90, '5 visitas → 1.5× (60 → 90)');

  // Subir a Oro (12 visitas): 2× → 120.
  accountsRows = readJson(accountsFile);
  accountsRows.find(r => r.restaurantId === restR3.id).visits = 12;
  writeJson(accountsFile, accountsRows);
  const c3r3 = await loyaltyService.creditOrder({ restaurant: restR3, customerPhone: phoneR3, orderId: `ord_r3_c_${stamp}`, amountInCents: AMOUNT_CENTS });
  assert.strictEqual(c3r3.points, 120, '12 visitas → 2× (60 → 120)');

  // Ledger con multiplicador (transparencia/auditoría).
  const ledRow = readJson(ledgerFile).find(e => e.kind === 'order' && e.refId === `ord_r3_b_${stamp}`);
  assert.ok(ledRow && ledRow.metadata && ledRow.metadata.multiplier === 1.5, 'el ledger guarda el multiplicador aplicado');

  // Ambos ledgers en SYNC (invariante del canje: resta de ambos): 60+90+120.
  const custR3 = readJson(customersFile).find(c => String(c.phone).replace(/\D/g, '') === phoneR3.replace(/\D/g, ''));
  assert.ok(custR3, 'el perfil del cliente existe');
  assert.strictEqual(custR3.globalPoints, 270, 'globalPoints acumuló los MISMO puntos que el local (canje en sync)');
  assert.strictEqual(readJson(accountsFile).find(r => r.restaurantId === restR3.id).points, 270, 'account.points acumuló lo mismo');

  // Sin escalera → 1× exacto (los locales actuales no cambian).
  const c4r3 = await loyaltyService.creditOrder({ restaurant: restSinNiveles, customerPhone: phoneR3, orderId: `ord_r3_d_${stamp}`, amountInCents: AMOUNT_CENTS });
  assert.strictEqual(c4r3.points, 60, 'sin escalera → 1× (60)');

  // Público: la escalera viaja en loyaltyConfig (data de marketing, sin PII).
  assert.deepStrictEqual(loyaltyService.getPublicLoyaltyConfig(restR3).levels, [
    { name: 'Plata', minVisits: 5, multiplier: 1.5 },
    { name: 'Oro', minVisits: 12, multiplier: 2 }
  ], 'getPublicLoyaltyConfig expone la escalera');
  assert.deepStrictEqual(loyaltyService.getLoyaltyConfig(restSinNiveles).levels, [], 'sin niveles → [] ESTABLE (patrón soldOutToday)');
  console.log('✓ §5d runtime: 1× → 1.5× → 2× · idempotencia · ledger · ledgers en sync · sin escalera intacta · pública');

  // ── §5e Wiring estático: Studio + modal del Club ─────────────────────────
  const studioHtmlR3 = readSrc('public/studio.html');
  assert.ok(/id="inputLoyaltyLevelsEnabled"/.test(studioHtmlR3), 'Studio: toggle de niveles');
  assert.ok(/id="loyaltyLevelsRows"/.test(studioHtmlR3), 'Studio: filas de niveles');
  assert.ok(/id="inputLoyaltyLevelName1"/.test(studioHtmlR3) && /id="inputLoyaltyLevelMult3"/.test(studioHtmlR3), 'Studio: 3 filas (name/visits/mult)');
  assert.ok(/data-js-change="toggleLoyaltyLevels\|this"/.test(studioHtmlR3), 'Studio: toggle CSP-safe (cero on*=)');
  assert.ok(/aria-label="Nivel 1: multiplicador de puntos"/.test(studioHtmlR3), 'Studio: inputs con nombre accesible');
  assert.ok(/delete restaurant\.loyaltyConfig\.levels/.test(studioJsSrc), 'Studio: apagar el toggle → campo ABSENT (nunca [] vacío)');
  assert.ok(/resolvePointsMultiplier\(config\.levels, account\.visits \|\| 0\)/.test(readSrc('api/services/loyalty.js')), 'credit: el tier YA ganado decide (visitas ANTES del pedido)');
  assert.ok(/Math\.round\(basePoints \* multiplier\)/.test(readSrc('api/services/loyalty.js')), 'credit: puntos enteros (Math.round)');
  const modalSrc = readSrc('public/js/components/LoyaltyRewardsModal.js');
  assert.ok(/buildLevelsLadder/.test(modalSrc), 'modal del Club: escalera visible');
  assert.ok(/Niveles de este local/.test(modalSrc), 'modal del Club: título de la escalera');
  assert.ok(/escapeHtml\(String\(\(l && l\.name\) \|\| ''\)\)/.test(modalSrc), 'modal del Club: nombre del nivel escapado');
  console.log('✓ §5e wiring: Studio toggle/filas/DOM API + modal del Club con la escalera');

  console.log('✅ Quick Wins: #5 Pedir de nuevo + #6 Happy Hour visible + #7 segmento una-visita + #8 nudge PWA + R3 multiplicador de lealtad — TODO OK');
}

// Los tests corren async (imports ESM + fetch reales); el runner los espera.
runTests().catch((err) => {
  console.error('❌ Quick Wins FALLÓ:', err && err.message ? err.message : err);
  process.exit(1);
});
