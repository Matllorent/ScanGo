/**
 * tests/test-comandero.js — Comandero en /mozo (Fase 2 del Sistema de Mozos, 67ª suite)
 * ─────────────────────────────────────────────────────────────────────────────────────
 * El mozo toma el pedido EN la mesa desde su PWA: mesa asignada → carta real del
 * local → opciones → envío. El pedido sale REAL con atribución
 * (`source='staff'` + `waiter_id`/`table_id` de la SESIÓN de turno — jamás del
 * body) hacia el KDS y el Studio.
 *
 * §1 Módulo puro `comandero.js`: carta normalizada (soldOut estable, $0,
 *    opciones), borrador (cotas), validación de opciones (espejo del server),
 *    body de API (LOCAL + mesa + SIN atribución — anti-forging por ausencia),
 *    submittable y ticket corto.
 * §2 Wiring estático: PWA /mozo (sección + 2 modales class-driven + CSP-safe),
 *    KDS (chip del mozo), Studio (chip del mozo), contrato openapi y alias npm.
 * §3 Runtime REAL: server HTTP + store real — setup de equipo por endpoints
 *    reales, turno activado, carta pública con grupos, quote, envío atribuido
 *    con intento de forging strippeado por Zod, gates 403 (mesa ajena, rol
 *    cocina, turno cross-tenant), 401 fail-closed con Bearer basura, pedido de
 *    comensal intacto (source='customer'), idempotencia por clave, listado del
 *    dueño con `waiterName` resuelto server-side y modelo del KDS.
 *
 * Cero mocks. Muta `data/*.json` (y replica a la nube si hay credenciales) y el
 * guard de la suite completa lo aísla/purga: los emails fixture usan
 * `@example.com` (RFC 2606 → basura por definición en el barrido).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

function jsonHeaders() {
  return { 'Content-Type': 'application/json' };
}

async function requestJson(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  let body = null;
  try {
    body = await response.json();
  } catch (e) {
    body = null;
  }
  return { response, body };
}

async function runTests() {
  console.log('🧪 Iniciando verificación del Comandero de mesa (Fase 2 Mozos)...');

  // ── §1 Módulo puro comandero.js ─────────────────────────────────────────────
  const C = await import('../public/js/mozo/comandero.js');

  assert.strictEqual(C.MAX_DRAFT_LINES, 60, 'tope de líneas del borrador');
  assert.strictEqual(C.MAX_LINE_QTY, 99, 'tope de cantidad por línea');
  assert.strictEqual(C.MAX_LINE_NOTE, 250, 'tope de nota por línea');

  // Slug con la MISMA allowlist que viralRef.
  assert.strictEqual(C.sanitizeComanderoSlug(' mi-local-NUEVO '), 'mi-local-nuevo');
  assert.strictEqual(C.sanitizeComanderoSlug('javascript:alert(1)'), '');
  assert.strictEqual(C.sanitizeComanderoSlug('con espacios'), '');
  assert.strictEqual(C.sanitizeComanderoSlug('a'.repeat(65)), '');
  assert.strictEqual(C.sanitizeComanderoSlug(null), '');

  // Paridad mozoSession ↔ comandero (dos copias de la allowlist: mismo veredicto).
  const mozoSession = await import('../public/js/mozo/mozoSession.js');
  const slugCorpus = ['', 'demo-heladeria', 'Mi Local', 'javascript:', 'a'.repeat(65), 'slug-64', 'UPPER'];
  for (const candidate of slugCorpus) {
    assert.strictEqual(
      mozoSession.sanitizeComanderoSlug(candidate),
      C.sanitizeComanderoSlug(candidate),
      `paridad sanitizeComanderoSlug(${JSON.stringify(candidate)})`
    );
  }

  const groups = [
    {
      id: 'g1',
      name: 'Punto de cocción',
      kind: 'normal',
      selectionMode: 'single',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      active: true,
      options: [
        { id: 'o1', name: 'Jugoso', priceDeltaCents: 100, active: true },
        { id: 'o2', name: 'Bien cocido', priceDeltaCents: 0, active: true }
      ]
    },
    {
      id: 'g_qty',
      name: 'Adicionales',
      kind: 'normal',
      selectionMode: 'quantity',
      required: false,
      minSelections: 0,
      maxSelections: 4,
      active: true,
      options: [{ id: 'q1', name: 'Queso extra', priceDeltaCents: 50, maxQuantity: 3, active: true }]
    }
  ];

  const rawMenu = {
    id: 'rest_abc',
    slug: 'mi-local',
    name: 'Mi Local',
    currency: '$',
    allowMenuOrders: true,
    categories: [
      { id: 'cat1', name: 'Cocina' },
      { id: 'cat2', name: 'Bebidas' }
    ],
    modifierGroups: groups,
    dishes: [
      { id: 'd1', name: 'Papas', price: 5, categoryId: 'cat1' },
      { id: 'd2', name: 'Milanesa', price: 12, categoryId: 'cat1', modifierGroupIds: ['g1'] },
      { id: 'd3', name: 'Agua', price: 0, categoryId: 'cat2' },
      { id: 'd4', name: 'Tarta', price: 9, categoryId: 'cat2', outOfStock: true, soldOutToday: false },
      { id: 'd5', name: 'Flan', price: 7, categoryId: 'cat1', soldOutToday: true },
      null,
      'basura',
      { id: 'd6', name: 'Con $ <tags>', price: -3, categoryId: 'catX', station: 'Barra' }
    ]
  };

  const menu = C.normalizeComanderoMenu(rawMenu);
  assert.ok(menu, 'carta válida normaliza');
  assert.strictEqual(menu.restaurantId, 'rest_abc');
  assert.strictEqual(menu.slug, 'mi-local');
  assert.strictEqual(menu.currency, '$');
  assert.strictEqual(menu.allowOrders, true);
  assert.deepStrictEqual(menu.groups, groups, 'los grupos del local viajan al modelo');
  assert.strictEqual(menu.categories.length, 2);

  const dishes = menu.dishes;
  assert.strictEqual(dishes.length, 6, 'descarta null/string/basura, conserva d1..d6');
  const byId = new Map(dishes.map((d) => [d.id, d]));
  // soldOut estable: OR de manual + derivado, SIEMPRE boolean.
  assert.strictEqual(byId.get('d1').soldOut, false);
  assert.strictEqual(byId.get('d4').soldOut, true, 'manual outOfStock → soldOut');
  assert.strictEqual(byId.get('d5').soldOut, true, 'derivado soldOutToday → soldOut');
  // free: precio $0 o no numérico.
  assert.strictEqual(byId.get('d1').free, false);
  assert.strictEqual(byId.get('d3').free, true, 'precio 0 → sin costo');
  // Regla canónica isFreePrice: negativo NO es "sin costo" (numérico ≠ 0), pero
  // price null → el comandero nunca pinta una cifra negativa; el server cotiza.
  assert.strictEqual(byId.get('d6').free, false);
  assert.strictEqual(byId.get('d6').price, null);
  assert.strictEqual(byId.get('d6').categoryId, 'catX');
  assert.strictEqual(byId.get('d6').categoryName, 'General', 'categoría desconocida no rompe');
  // needsOptions + modifierGroupIds preservados (los resuelve dishGroupsOf).
  assert.strictEqual(byId.get('d1').needsOptions, false);
  assert.strictEqual(byId.get('d2').needsOptions, true);
  assert.deepStrictEqual(byId.get('d2').modifierGroupIds, ['g1']);
  assert.deepStrictEqual(byId.get('d1').modifierGroupIds, [], 'estable: todo plato lleva la lista');

  // normalizeComanderoMenu es PURA: no muta el payload.
  assert.strictEqual(rawMenu.dishes[5], null, 'entrada no mutada');

  // Basura → null honesto (solo no-objeto); carta sin platos → modelo vacío
  // estable (la PWA decide con menu.dishes.length, patrón soldOutToday F3).
  assert.strictEqual(C.normalizeComanderoMenu(null), null);
  assert.strictEqual(C.normalizeComanderoMenu('x'), null);
  const emptyMenu = C.normalizeComanderoMenu({ dishes: 'no' });
  assert.ok(emptyMenu && Array.isArray(emptyMenu.dishes) && emptyMenu.dishes.length === 0, 'carta vacía → modelo estable con 0 platos');

  // dishGroupsOf: asignados por id + embebidos, activos.
  assert.strictEqual(C.dishGroupsOf(byId.get('d2'), groups).length, 1);
  assert.strictEqual(C.dishGroupsOf(byId.get('d1'), groups).length, 0);
  const embeddedDish = {
    id: 'd7',
    name: 'Embedded',
    modifierGroups: [{ id: 'g_emb', name: 'Manteca', selectionMode: 'single', required: false, active: true, options: [{ id: 'e1', name: 'Con manteca', active: true }] }],
    modifierGroupIds: []
  };
  assert.strictEqual(C.dishGroupsOf(embeddedDish, groups).length, 1, 'grupos embebidos también resuelven');
  assert.strictEqual(C.dishNeedsOptions(embeddedDish, groups), true);
  assert.strictEqual(C.dishNeedsOptions(null, groups), false);

  // Borrador.
  const draft = C.createDraft();
  assert.deepStrictEqual(draft, { tableNumber: '', tableLabel: '', note: '', lines: [] });

  C.setDraftTable(draft, { number: '2', label: 'Mesa 2' });
  assert.strictEqual(draft.tableNumber, '2');
  assert.strictEqual(draft.tableLabel, 'Mesa 2');
  C.setDraftTable(draft, { number: 'Terraza 3', label: '' });
  assert.strictEqual(draft.tableNumber, 'Terraza 3');
  assert.strictEqual(draft.tableLabel, 'Terraza 3', 'mesa sin label → fallback al número');
  C.setDraftTable(draft, null);
  assert.strictEqual(draft.tableNumber, 'Terraza 3', 'basura no resetea la mesa');

  const line = C.addDraftLine(draft, { dishId: 'd2', dishName: 'Milanesa', quantity: 2, note: '  sin  cebolla ', choices: [{ groupId: 'g1', selections: [{ optionId: 'o1' }] }] });
  assert.ok(line, 'línea agregada');
  assert.strictEqual(line.quantity, 2);
  assert.strictEqual(line.note, 'sin cebolla');
  assert.strictEqual(line.label, '2× Milanesa');
  assert.strictEqual(C.describeDraftChoices(byId.get('d2'), line.choices, menu.groups), 'Punto de cocción: Jugoso');
  assert.strictEqual(C.describeDraftLine(line), '2× Milanesa');

  C.addDraftLine(draft, { dishId: 'd1', dishName: 'Papas', quantity: 0, choices: [] });
  assert.strictEqual(draft.lines[1].quantity, 1, 'qty < 1 → 1');
  const clampedLine = C.addDraftLine(draft, { dishId: 'd1', dishName: 'Papas', quantity: 150 });
  assert.ok(clampedLine, 'qty fuera de rango se CLAMPEA, no se rechaza');
  assert.strictEqual(clampedLine.quantity, 99, 'qty 150 → clamp 99');

  const draftCap = C.createDraft();
  for (let i = 0; i < C.MAX_DRAFT_LINES; i++) {
    C.addDraftLine(draftCap, { dishId: 'd1', dishName: 'Papas' });
  }
  assert.strictEqual(draftCap.lines.length, C.MAX_DRAFT_LINES);
  assert.strictEqual(C.addDraftLine(draftCap, { dishId: 'd1', dishName: 'Papas' }), null, 'cap 60 → rechaza');
  assert.strictEqual(C.addDraftLine(draftCap, { dishName: 'sin id' }), null, 'sin dishId → rechaza');

  assert.strictEqual(C.removeDraftLine(draft, 0), true);
  assert.strictEqual(draft.lines.length, 2);
  assert.strictEqual(C.removeDraftLine(draft, 99), false);

  // Choices en el shape EXACTO del schema.
  const dirtyChoices = [
    { groupId: 'g_qty', selections: [{ optionId: 'q1', quantity: 2 }, { optionId: '  ' }, null] },
    { groupId: '', selections: [{ optionId: 'x' }] },
    null
  ];
  assert.deepStrictEqual(C.sanitizeDraftChoices(dirtyChoices), [
    { groupId: 'g_qty', selections: [{ optionId: 'q1', quantity: 2 }] }
  ]);

  // Validación de opciones (display; el server es la autoridad).
  assert.deepStrictEqual(C.validateLineAgainstGroups(byId.get('d2'), [{ groupId: 'g1', selections: [{ optionId: 'o1' }] }], menu.groups), { ok: true, error: '' });
  assert.ok(C.validateLineAgainstGroups(byId.get('d2'), [], menu.groups).ok === false, 'required sin selección → error');
  assert.ok(C.validateLineAgainstGroups(byId.get('d2'), [{ groupId: 'g1', selections: [{ optionId: 'fantasma' }] }], menu.groups).ok === false, 'opción inexistente');
  assert.ok(C.validateLineAgainstGroups(byId.get('d2'), [{ groupId: 'g1', selections: [{ optionId: 'o1' }, { optionId: 'o2' }] }], menu.groups).ok === false, 'single con 2 selecciones');
  assert.ok(C.validateLineAgainstGroups(byId.get('d2'), [{ groupId: 'g_qty', selections: [{ optionId: 'q1', quantity: 9 }] }], menu.groups).ok === false, 'quantity > maxQuantity');
  assert.ok(C.validateLineAgainstGroups(byId.get('d2'), [{ groupId: 'g_qty', selections: [{ optionId: 'q1', quantity: 2 }] }, { groupId: 'g1', selections: [{ optionId: 'o1' }] }], menu.groups).ok === true, 'dos grupos válidos (choices separados, uno por groupId)');
  assert.ok(C.validateLineAgainstGroups(byId.get('d2'), [{ groupId: 'g1', selections: [{ optionId: 'o1' }] }, { groupId: 'g1', selections: [{ optionId: 'o2' }] }], menu.groups).ok === false, 'grupo duplicado → inválido');
  assert.ok(C.validateLineAgainstGroups(null, [], menu.groups).ok === false, 'plato borrado de la carta');

  // Presentación: una sola.
  const presentationGroup = { id: 'gp', name: 'Presentación', kind: 'presentation', selectionMode: 'multiple', required: true, minSelections: 1, maxSelections: 2, active: true, options: [{ id: 'p1', name: 'Cone', active: true }, { id: 'p2', name: 'Vaso', active: true }] };
  const presentationDish = { id: 'd8', name: 'Helado', modifierGroupIds: ['gp'], modifierGroups: [] };
  assert.ok(
    C.validateLineAgainstGroups(presentationDish, [{ groupId: 'gp', selections: [{ optionId: 'p1' }] }], [presentationGroup]).ok,
    'presentación con 1 selección ok'
  );
  assert.ok(
    C.validateLineAgainstGroups(presentationDish, [{ groupId: 'gp', selections: [{ optionId: 'p1' }, { optionId: 'p2' }] }], [presentationGroup]).ok === false,
    'presentación con 2 → error (aunque maxSelections lo permita)'
  );

  // Body de API: LOCAL, mesa, SIN atribución (el server decide) y offset clampeado.
  const bodyDraft = C.createDraft();
  C.setDraftTable(bodyDraft, { number: '2', label: 'Mesa 2' });
  C.addDraftLine(bodyDraft, { dishId: 'd2', dishName: 'Milanesa', quantity: 1, choices: [{ groupId: 'g1', selections: [{ optionId: 'o1' }] }] });
  const body = C.buildComanderoBody(bodyDraft, { restaurantId: 'rest_abc', utcOffsetMinutes: 9999 });
  assert.deepStrictEqual(body, {
    restaurantId: 'rest_abc',
    orderMode: 'LOCAL',
    tableNumber: '2',
    customerName: 'Mesa 2',
    notes: '',
    items: [{ dishId: 'd2', quantity: 1, note: '', choices: [{ groupId: 'g1', selections: [{ optionId: 'o1' }] }] }],
    utcOffsetMinutes: 840
  });
  assert.ok(!('source' in body) && !('waiterId' in body) && !('tableId' in body), 'el body JAMÁS lleva atribución');
  assert.strictEqual(C.buildComanderoBody(bodyDraft, { restaurantId: '' }), null, 'sin restaurantId → null');
  assert.strictEqual(C.buildComanderoBody(null, { restaurantId: 'r' }), null);
  const bodyNoTable = C.buildComanderoBody(C.createDraft(), { restaurantId: 'r' });
  assert.strictEqual(bodyNoTable.tableNumber, '1', 'sin mesa elegida el quote/POST no rebota por mesa vacía');
  assert.strictEqual(bodyNoTable.customerName, 'Mesa');

  // Submittable.
  assert.deepStrictEqual(C.draftIsSubmittable(bodyDraft, menu), { ok: true, error: '' });
  assert.ok(C.draftIsSubmittable(C.createDraft(), menu).ok === false, 'sin mesa → no enviable');
  const draftNoLines = C.createDraft();
  C.setDraftTable(draftNoLines, { number: '1', label: 'Mesa 1' });
  assert.ok(C.draftIsSubmittable(draftNoLines, menu).ok === false, 'sin líneas → no enviable');
  assert.ok(C.draftIsSubmittable(bodyDraft, { ...menu, allowOrders: false }).ok === false, 'vitrina → no enviable');
  assert.strictEqual(C.draftIsSubmittable(bodyDraft, null).ok, false);

  // Ticket corto (misma derivación que el KDS: cola del id, slice(-4)).
  assert.strictEqual(C.comanderoTicketNumber({ id: 'ord_1_AB12' }), '#AB12');
  assert.strictEqual(C.comanderoTicketNumber({ id: 'ord_123456' }), '#3456');
  assert.strictEqual(C.comanderoTicketNumber(null), '#—');

  // ── §2 Wiring estático ─────────────────────────────────────────────────────
  const mozoHtml = read('public/mozo.html');
  const mozoJs = read('public/js/mozo/mozo.js');
  const comanderoJs = read('public/js/mozo/comandero.js');
  const mozoCss = read('public/css/mozo.css');
  const kitchenColsJs = read('public/js/kitchen/kitchenColumns.js');
  const kitchenJs = read('public/js/kitchen/kitchen.js');
  const kitchenCss = read('public/css/kitchen.css');
  const studioJs = read('public/js/studio.js');
  const openapiRaw = read('openapi.yaml');
  const openapi = openapiRaw.replace(/\r\n/g, '\n'); // repo CRLF: los regex multilínea esperan \n
  const pkg = JSON.parse(read('package.json'));

  // CSP: cero on*= en TODO lo nuevo; cero diálogos nativos; DOM API en la PWA.
  for (const [label, content] of [['mozo.html', mozoHtml], ['mozo.js', mozoJs], ['comandero.js', comanderoJs]]) {
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(content), `${label} sin atributos on*=`);
  }
  assert.ok(!/\balert\s*\(/.test(mozoJs), 'mozo.js sin alert()');
  assert.ok(!/window\.confirm\s*\(/.test(mozoJs), 'mozo.js sin window.confirm');
  assert.ok(!/\.innerHTML|\.outerHTML|insertAdjacentHTML/.test(mozoJs), 'mozo.js renderiza con DOM API');

  // comandero.js puro: sin DOM, sin red, sin storage.
  assert.ok(!/document\.|window\.|localStorage|sessionStorage/.test(comanderoJs), 'comandero.js puro (cero DOM/storage)');
  assert.ok(!/fetch\s*\(/.test(comanderoJs), 'comandero.js puro (cero red)');
  assert.ok(!/require\(/.test(comanderoJs), 'comandero.js autocontenido (ESM importable en Node)');

  // Sección del comandero + modales class-driven con ARIA completo.
  for (const id of ['mozoComanderoSection', 'mozoComanderoTables', 'mozoComanderoCats', 'mozoComanderoDishes', 'mozoDraftLines', 'mozoComanderoCart', 'mozoOptionsModal', 'mozoOptionsGroups', 'mozoOptionsError', 'mozoSentModal', 'mozoSentDetail', 'mozoSentNew']) {
    assert.ok(mozoHtml.includes(`id="${id}"`), `mozo.html trae #${id}`);
  }
  assert.ok(/id="mozoOptionsModal"[^>]*role="dialog"/.test(mozoHtml.replace(/\n\s*/g, ' ')), 'modal de opciones con role=dialog');
  assert.ok(/aria-modal="true"/.test(mozoHtml), 'modales con aria-modal');
  assert.ok(/aria-labelledby="mozoOptionsTitle"/.test(mozoHtml), 'modal de opciones con nombre accesible');
  assert.ok(/class="[^"]*modal-close[^"]*"[^>]*aria-label="Cerrar"/.test(mozoHtml.replace(/\n\s*/g, ' ')), 'botón de cierre con aria-label');
  assert.ok(/id="mozoOptionsError"[^>]*role="alert"/.test(mozoHtml.replace(/\n\s*/g, ' ')), 'error del modal como live region');

  // Class-driven (modalA11y observa class/style, NO hidden).
  assert.ok(/classList\.add\('active'\)/.test(mozoJs) && /classList\.remove\('active'\)/.test(mozoJs), 'modales togglean .active (patrón modalA11y)');
  assert.ok(/\.mozo-modal\.active\s*\{\s*display:\s*flex/.test(mozoCss), 'CSS de .active display:flex');
  assert.ok(/\[hidden\]\s*\{\s*display:\s*none\s*!\s*important/.test(mozoCss), 'guard [hidden] en mozo.css');
  assert.ok(/initModalA11y/.test(mozoJs), 'mozo.js usa el enhancer compartido de modales');

  // Envío: idempotencia por borrador + Bearer de turno + validación por línea.
  assert.ok(/'Idempotency-Key'/.test(mozoJs), 'mozo.js manda Idempotency-Key');
  assert.ok(/handleCartSend/.test(mozoJs) && /resetComanderoDraft/.test(mozoJs), 'flujo de envío + reset tras éxito');
  assert.ok(/validateLineAgainstGroups/.test(mozoJs), 're-validación por línea antes de enviar');
  assert.ok(/apiFetch\('\/api\/orders'/, 'mozo.js POSTea /api/orders (endpoint existente)');

  // KDS + Studio: chip del mozo con el nombre resuelto server-side.
  assert.ok(/waiterName:\s*stringSafe\(order\.waiterName\)/.test(kitchenColsJs), 'kitchenColumns mapea waiterName');
  assert.ok(/kds-chip-waiter/.test(kitchenJs), 'kitchen.js pinta el chip del mozo');
  assert.ok(/\.kds-chip-waiter/.test(kitchenCss), 'kitchen.css estila el chip');
  assert.ok(/waiterName/.test(studioJs), 'studio.js muestra el mozo en Pedidos en vivo');

  // Contrato: Order con atribución + gates del comandero documentados.
  assert.ok(/waiterName:/.test(openapi), 'openapi Order.waiterName');
  assert.ok(/source:\n\s+type: string\n\s+enum: \[customer, staff, kiosk\]/.test(openapi), 'openapi Order.source');
  assert.ok(/TABLE_NOT_ASSIGNED/.test(openapi) && /STAFF_ROLE_NOT_ALLOWED/.test(openapi) && /STAFF_RESTAURANT_MISMATCH/.test(openapi), 'openapi documenta los 403 del comandero');
  assert.ok(/Bearer <token de turno>/.test(openapi), 'openapi describe el Bearer opcional de staff');

  // Alias npm + cadena de la suite completa (67ª).
  assert.ok(pkg.scripts['test:comandero'] === 'node tests/test-comandero.js', 'alias test:comandero');
  assert.ok(pkg.scripts['test:core'].includes('node tests/test-comandero.js'), 'test:core incluye la 67ª suite');

  // ── §3 Runtime real ────────────────────────────────────────────────────────
  const stamp = Date.now();
  const ownerA = await db.createUser({
    email: `comandero-a-${stamp}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const ownerB = await db.createUser({
    email: `comandero-b-${stamp}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  await db.flushCloudWrites();

  const restA = await db.saveRestaurant(ownerA.id, {
    name: 'Comandero Local A',
    bizName: 'Comandero Local A',
    slug: `comandero-local-a-${stamp}`,
    phone: '59899333333',
    currency: 'USD',
    tableCount: 6,
    categories: [
      { id: 'cat1', name: 'Cocina' },
      { id: 'cat2', name: 'Bebidas' }
    ],
    modifierGroups: [
      {
        id: 'g1',
        name: 'Punto de cocción',
        kind: 'normal',
        selectionMode: 'single',
        required: true,
        minSelections: 1,
        maxSelections: 1,
        active: true,
        options: [
          { id: 'o1', name: 'Jugoso', priceDeltaCents: 100, active: true },
          { id: 'o2', name: 'Bien cocido', priceDeltaCents: 0, active: true }
        ]
      }
    ],
    dishes: [
      { id: 'dish_simple', name: 'Papas', price: 5, categoryId: 'cat1' },
      { id: 'dish_opt', name: 'Milanesa', price: 12, categoryId: 'cat1', modifierGroupIds: ['g1'] },
      { id: 'dish_off', name: 'Tarta', price: 9, categoryId: 'cat2', outOfStock: true }
    ]
  });
  const restB = await db.saveRestaurant(ownerB.id, {
    name: 'Comandero Local B',
    bizName: 'Comandero Local B',
    slug: `comandero-local-b-${stamp}`,
    phone: '59899444444',
    currency: 'USD',
    tableCount: 2,
    categories: [{ id: 'cat1', name: 'Cocina' }],
    dishes: [{ id: 'dish_b1', name: 'Burger', price: 10, categoryId: 'cat1' }]
  });
  const tokenOwnerA = jwt.sign({ userId: ownerA.id }, JWT_SECRET, { expiresIn: '1h' });
  const authA = authHeaders(tokenOwnerA);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  try {
    // 1) Carta pública: lo que el comandero trae (slug → /api/menu/:slug).
    let out = await requestJson(base, `/api/menu/${restA.slug}`);
    assert.strictEqual(out.response.status, 200, 'carta pública 200');
    const publicMenu = out.body && out.body.restaurant;
    assert.ok(publicMenu, 'payload con restaurant');
    assert.strictEqual(publicMenu.allowMenuOrders, true, 'allowMenuOrders expuesto');
    assert.ok(Array.isArray(publicMenu.modifierGroups) && publicMenu.modifierGroups.length === 1, 'modifierGroups públicos');
    const publicDishOpt = publicMenu.dishes.find((d) => d.id === 'dish_opt');
    assert.deepStrictEqual(publicDishOpt.modifierGroupIds, ['g1'], 'dish expone modifierGroupIds (el comandero resuelve grupos)');
    const publicDishOff = publicMenu.dishes.find((d) => d.id === 'dish_off');
    assert.strictEqual(publicDishOff.outOfStock, true, 'agotado manual viaja al payload');
    assert.strictEqual(publicMenu.dishes.find((d) => d.id === 'dish_off').station, undefined, 'station nunca viaja al comensal (F6)');

    // 2) Equipo real por endpoints del Studio.
    out = await requestJson(base, '/api/studio/staff', {
      method: 'POST', headers: authA, body: JSON.stringify({ name: 'Ana Mozo', role: 'waiter' })
    });
    assert.strictEqual(out.response.status, 201, 'alta de mozo → 201');
    const ana = out.body.staff;
    const anaCredential = out.body.credential;

    out = await requestJson(base, '/api/studio/staff', {
      method: 'POST', headers: authA, body: JSON.stringify({ name: 'Beto Cocina', role: 'kitchen' })
    });
    assert.strictEqual(out.response.status, 201, 'alta de cocina → 201');
    const beto = out.body.staff;
    const betoCredential = out.body.credential;

    out = await requestJson(base, '/api/studio/staff/tables', {
      method: 'PATCH', headers: authA, body: JSON.stringify({ assignments: { '1': ana.id, '2': ana.id } })
    });
    assert.strictEqual(out.response.status, 200, 'mesas asignadas a Ana');

    // 3) Turnos activados (QR real → token opaco).
    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ restaurantId: restA.id, staffId: ana.id, secret: anaCredential })
    });
    assert.strictEqual(out.response.status, 200, 'turno de Ana activado');
    const anaToken = out.body.data.token;
    assert.ok(anaToken, 'token de turno emitido');
    assert.strictEqual(out.body.data.restaurant.slug, restA.slug, 'la sesión trae el slug (el comandero fetchea la carta)');
    assert.ok(out.body.data.tables.some((t) => String(t.number) === '1'), 'mesas del turno');

    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ restaurantId: restA.id, staffId: beto.id, secret: betoCredential })
    });
    assert.strictEqual(out.response.status, 200, 'turno de cocina activado');
    const betoToken = out.body.data.token;

    // 4) Quote con el body del comandero (mismo schema que el comensal).
    const quoteDraft = C.createDraft();
    C.setDraftTable(quoteDraft, { number: '1', label: 'Mesa 1' });
    C.addDraftLine(quoteDraft, { dishId: 'dish_simple', dishName: 'Papas', quantity: 2, choices: [] });
    C.addDraftLine(quoteDraft, { dishId: 'dish_opt', dishName: 'Milanesa', quantity: 1, choices: [{ groupId: 'g1', selections: [{ optionId: 'o1' }] }] });
    const quoteBody = C.buildComanderoBody(quoteDraft, { restaurantId: restA.id, utcOffsetMinutes: -180 });
    out = await requestJson(base, '/api/orders/quote', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(quoteBody) });
    assert.strictEqual(out.response.status, 200, 'quote 200');
    assert.strictEqual(Number(out.body.data.amount), 23, 'quote = 2×5 + (12 + 1 delta) = 10 + 13');
    assert.strictEqual(out.body.data.currency, 'USD');

    // 5) Envío atribuido E2E con intento de FORGING en el body.
    const sendDraft = C.createDraft();
    C.setDraftTable(sendDraft, { number: '2', label: 'Mesa 2' });
    C.addDraftLine(sendDraft, { dishId: 'dish_opt', dishName: 'Milanesa', quantity: 1, note: 'al punto', choices: [{ groupId: 'g1', selections: [{ optionId: 'o1' }] }] });
    C.addDraftLine(sendDraft, { dishId: 'dish_simple', dishName: 'Papas', quantity: 3, choices: [] });
    const sendBody = C.buildComanderoBody(sendDraft, { restaurantId: restA.id, utcOffsetMinutes: -180 });
    // Forging: el mozo/lan intenta colar source/waiterId/tableId en el body —
    // Zod strippea las claves desconocidas; lo único válido sale de su SESIÓN.
    sendBody.source = 'customer';
    sendBody.waiterId = 'staff_forged_999';
    sendBody.tableId = '9';
    const idemKey = `cmd_test_${stamp}_a`;
    out = await requestJson(base, '/api/orders', {
      method: 'POST',
      headers: { ...jsonHeaders(), Authorization: `Bearer ${anaToken}`, 'Idempotency-Key': idemKey },
      body: JSON.stringify(sendBody)
    });
    assert.strictEqual(out.response.status, 201, 'pedido del comandero → 201');
    const staffOrder = out.body.data;
    assert.ok(staffOrder && staffOrder.id, 'pedido creado');
    assert.strictEqual(staffOrder.source, 'staff', 'source lo decide el SERVER (session-only)');
    assert.strictEqual(staffOrder.waiter_id, ana.id, 'waiter_id de la SESIÓN, no del body');
    assert.strictEqual(staffOrder.waiterId, ana.id, 'forging strippeado: waiterId es el real');
    assert.strictEqual(staffOrder.table_id, '2', 'table_id = mesa asignada del body (mesa 2)');
    assert.strictEqual(staffOrder.tableId, '2', 'forging strippeado: tableId es el real');
    assert.ok(staffOrder.trackingToken, 'trackingToken presente');
    assert.strictEqual(staffOrder.orderMode, 'LOCAL', 'comandero registra salón');
    assert.strictEqual(staffOrder.customer_name, 'Mesa 2', 'customerName = etiqueta de mesa (sin PII)');
    assert.strictEqual(staffOrder.status, 'pending', 'sale a pending → pizarra');
    assert.strictEqual(Number(staffOrder.amount), 28, 'amount = 13 (milanesa + delta) + 3×5 papas = 28');

    // 6) Mesa ajena → 403.
    out = await requestJson(base, '/api/orders', {
      method: 'POST', headers: authHeaders(anaToken),
      body: JSON.stringify({ ...sendBody, tableNumber: '3' })
    });
    assert.strictEqual(out.response.status, 403, 'mesa no asignada → 403');
    assert.strictEqual(out.body.code, 'TABLE_NOT_ASSIGNED');

    // 7) Cocina NO comanda → 403.
    out = await requestJson(base, '/api/orders', {
      method: 'POST', headers: authHeaders(betoToken),
      body: JSON.stringify(sendBody)
    });
    assert.strictEqual(out.response.status, 403, 'rol cocina → 403');
    assert.strictEqual(out.body.code, 'STAFF_ROLE_NOT_ALLOWED');

    // 8) Bearer de turno basura → 401 fail-closed (jamás degrada a comensal).
    out = await requestJson(base, '/api/orders', {
      method: 'POST', headers: { ...jsonHeaders(), Authorization: `Bearer ${'x'.repeat(40)}` },
      body: JSON.stringify(sendBody)
    });
    assert.strictEqual(out.response.status, 401, 'Bearer inválido → 401 fail-closed');
    assert.strictEqual(out.body.code, 'STAFF_SESSION_INVALID');

    // 9) Turno cross-tenant → 403.
    out = await requestJson(base, '/api/orders', {
      method: 'POST', headers: authHeaders(anaToken),
      body: JSON.stringify({ ...sendBody, restaurantId: restB.id, tableNumber: '1' })
    });
    assert.strictEqual(out.response.status, 403, 'QR de otro local → 403');
    assert.strictEqual(out.body.code, 'STAFF_RESTAURANT_MISMATCH');

    // 10) Comensal intacto: sin Bearer → customer + forging de staff strippeado.
    out = await requestJson(base, '/api/orders', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({
        restaurantId: restA.id,
        orderMode: 'LOCAL',
        tableNumber: '9',
        customerName: 'Cliente Web',
        items: [{ dishId: 'dish_simple', quantity: 1, note: '', choices: [] }],
        waiterId: 'staff_forged_999',
        source: 'staff'
      })
    });
    assert.strictEqual(out.response.status, 201, 'pedido del comensal → 201');
    const customerOrder = out.body.data;
    assert.strictEqual(customerOrder.source, 'customer', 'comensal → customer');
    assert.ok(!('waiterId' in customerOrder) && !('waiter_id' in customerOrder), 'comensal sin atribución de staff (forging strippeado)');
    assert.strictEqual(customerOrder.tableNumber, '9', 'comensal puede mandar cualquier mesa (no hay asignación)');

    // 11) Idempotencia: la MISMA clave (reintentos del borrador) no crea doble.
    out = await requestJson(base, '/api/orders', {
      method: 'POST',
      headers: { ...jsonHeaders(), Authorization: `Bearer ${anaToken}`, 'Idempotency-Key': idemKey },
      body: JSON.stringify(sendBody)
    });
    assert.ok(out.response.status === 200 || out.response.status === 201, 'retry idempotente 200/201');
    assert.strictEqual(out.body.data.id, staffOrder.id, 'misma clave → MISMO pedido (adiós doble tap)');
    assert.strictEqual(out.body.idempotent, true, 'marcado como idempotente');

    // 12) Listado del dueño: waiterName resuelto server-side, comensal sin él.
    out = await requestJson(base, `/api/orders/restaurant/${restA.id}`, { headers: authA });
    assert.strictEqual(out.response.status, 200, 'listado del dueño 200');
    assert.ok(Array.isArray(out.body.data), 'array de pedidos');
    const listedStaff = out.body.data.find((o) => o.id === staffOrder.id);
    const listedCustomer = out.body.data.find((o) => o.id === customerOrder.id);
    assert.ok(listedStaff, 'pedido del staff listado');
    assert.strictEqual(listedStaff.waiterName, 'Ana Mozo', 'waiterName resuelto (KDS/Studio)');
    assert.ok(listedCustomer && !listedCustomer.waiterName, 'pedido del comensal sin waiterName');

    // 13) KDS: el modelo de tarjeta pinta el chip del mozo (y nada para el comensal).
    const cols = await import('../public/js/kitchen/kitchenColumns.js');
    const staffModel = cols.buildKitchenCardModel(listedStaff);
    assert.strictEqual(staffModel.waiterName, 'Ana Mozo', 'KDS muestra quién tomó el pedido');
    const customerModel = cols.buildKitchenCardModel(listedCustomer);
    assert.strictEqual(customerModel.waiterName, '', 'pedido del comensal sin chip');
    assert.strictEqual(staffModel.orderMode, 'LOCAL');
    assert.strictEqual(staffModel.columnId, 'queue', 'pending → En cola');

    // 14) /api/staff/me sigue el contrato del comandero (slug en la sesión).
    out = await requestJson(base, '/api/staff/me', { headers: authHeaders(anaToken) });
    assert.strictEqual(out.response.status, 200, 'me 200');
    assert.strictEqual(out.body.data.restaurant.slug, restA.slug, 'me trae el slug');

    console.log('✓ §3 Runtime: setup real, forging strippeado, gates 401/403, idempotencia, waiterName en KDS/Studio');
  } finally {
    await server.close();
    // Limpieza best-effort (el guard de npm test purga de todas formas).
    try { await db.deleteRestaurantData(ownerA.id, restA.id); } catch (e) {}
    try { await db.deleteRestaurantData(ownerB.id, restB.id); } catch (e) {}
  }

  console.log('✓ Comandero de mesa (Fase 2): puro + wiring + runtime completo');
}

runTests().catch((err) => {
  console.error('✗ FALLO test-comandero:', err && err.message ? err.message : err);
  if (err && err.stack) console.error(err.stack);
  process.exit(1);
});
