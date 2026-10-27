/**
 * tests/test-kitchen.js — KDS "Vista Kitchen" (Serie 2 "El Sistema", 56ª suite)
 * ─────────────────────────────────────────────────────────────────────────────
 * La pizarra de cocina del dueño: tablet fullscreen, SIN navegación y SIN
 * endpoints nuevos (reusa `GET /api/orders/restaurant/:id` +
 * `PATCH /api/orders/status/:orderId` + la sesión del Studio).
 *
 * §1 Estático fuente: kitchen.html / kitchen.js / kitchenColumns.js /
 *    kitchen.css (cero on*=, cero window.confirm, cero alert, cero innerHTML
 *    con data, imports dentro de public/js, script module).
 * §2 Módulo puro `kitchenColumns.js`: tabla de decisión de columnas + secuencia
 *    de avance + modelo de tarjeta tolerante (dual-mode camel/snake,
 *    customIceCream, opciones de modificadores, estado desconocido).
 * §3 Runtime real: server HTTP propio + store real — GET del dueño (id y slug),
 *    cross-tenant 403, 401 anónimo, avance validado + invalido, cancelado, y
 *    el mapping colId orchestration + la ruta dev `GET /kitchen` con CSP.
 * §4 A11y de la página: skip-link, main, modales ARIA, botones nombrados,
 *    live region y gating (complementa el guard global tests/test-a11y.js).
 *
 * Regresión de la decisión (cero mocks, mutable data/* y el guard lo aísla).
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

async function runTests() {
  console.log('🧪 Iniciando verificación de Vista Kitchen (KDS F2)...');

  // ── §1 Estático fuente ──────────────────────────────────────────────────────
  const html = read('public/kitchen.html');
  const kitchenJs = read('public/js/kitchen/kitchen.js');
  const colsJs = read('public/js/kitchen/kitchenColumns.js');
  const kitchenCss = read('public/css/kitchen.css');

  // CSP: cero on*= en TODO lo nuevo (la suite global escanea public/ completa).
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'kitchen.html no debe tener atributos on*=');
  assert.ok(!/on(click|load|error)\s*=/i.test(kitchenJs), 'kitchen.js no debe escribir on*=');
  assert.ok(!/on(click|load|error)\s*=/i.test(colsJs), 'kitchenColumns.js no debe escribir on*=');

  // Diálogos destructivos: showConfirmDialog, NUNCA window.confirm/alert/confirm().
  assert.ok(!/window\.confirm\s*\(/.test(kitchenJs), 'kitchen.js no debe usar window.confirm');
  assert.ok(!/\balert\s*\(/.test(kitchenJs), 'kitchen.js no debe llamar alert() (banner honesto)');
  assert.ok(/showConfirmDialog/.test(kitchenJs) && /closeConfirmDialog/.test(kitchenJs), 'kitchen.js debe cancelar vía showConfirmDialog (diálogo propio)');
  assert.ok(/['"]cancelled['"]/.test(kitchenJs), 'kitchen.js debe mandar cancelled por el PATCH existente');
  assert.ok(!/\bconfirm\s*\(/.test(kitchenJs), 'kitchen.js no debe abrir diálogos nativos');

  // Render DOM API pura: cero innerHTML con data del comensal.
  assert.ok(!/innerHTML/.test(kitchenJs) && !/outerHTML/.test(kitchenJs), 'kitchen.js renderiza con createElement/textContent (cero innerHTML)');
  assert.ok(/createElement\(/.test(kitchenJs) && /textContent/.test(kitchenJs), 'kitchen.js usa DOM API');
  assert.ok(!/data-js-/.test(kitchenJs), 'kitchen.js no declare data-js-* muertos (usa addEventListener propio)');

  // Script module + sesión por el mismo flujo del Studio.
  assert.ok(/<script[^>]*type="module"[^>]*src="\/js\/kitchen\/kitchen\.js"/.test(html), 'kitchen.html debe cargar /js/kitchen/kitchen.js como módulo');
  assert.ok(/<script[^>]*src="\/js\/authClient\.js"/.test(html), 'kitchen.html debe cargar authClient (sesión cookie/device, espejo Studio)');
  assert.ok(/<link[^>]*rel="stylesheet"[^>]*href="\/css\/kitchen\.css"/.test(html), 'kitchen.css linkeado');
  assert.ok(/<meta[^>]*name="robots"[^>]*content="noindex/.test(html), 'paneles privados fuera del índice');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/.test(kitchenCss + html), 'cero terceros en la pizarra (cero requests de red externa)');

  // Módulo puro: importable desde Node, sin DOM ni I/O, imports propios ESM.
  assert.ok(!/require\(/.test(colsJs), 'kitchenColumns.js puro: sin require');
  assert.ok(!/document\.|window\./.test(colsJs), 'kitchenColumns.js puro: cero DOM');
  assert.ok(!/import /.test(colsJs), 'kitchenColumns.js autocontenido (importable en Node sin rewrites)');

  // Importaciones de kitchen.js: dentro de public/js (guard de arquitectura C)
  // y de los módulos que el diseño manda reutilizar.
  assert.ok(/import\s*\{[^}]*buildKitchenCardModel[^}]*\}\s*from\s*'\.\/kitchenColumns\.js'/.test(kitchenJs), 'kitchen.js importa la tabla de decisión local');
  assert.ok(/'\.\.\/studio\/orderAging\.js'/.test(kitchenJs), 'kitchen.js reutiliza orderAging (cero duplicados)');
  assert.ok(/'\.\.\/studio\/ui\/confirmDialog\.js'/.test(kitchenJs), 'kitchen.js reutiliza confirmDialog');
  assert.ok(/'\.\.\/modalA11y\.js'/.test(kitchenJs), 'kitchen.js reutiliza el enhancer de modales compartido');

  // F0: impresión térmica desde la cocina con los módulos compartidos del
  // Studio (builder puro + transporte WebUSB), sin duplicar drivers.
  assert.ok(/'\.\.\/studio\/escposTicket\.js'/.test(kitchenJs), 'kitchen.js reutiliza el builder ESC/POS puro');
  assert.ok(/'\.\.\/print\/webusbPrinter\.js'/.test(kitchenJs), 'kitchen.js reutiliza el transporte WebUSB compartido');
  assert.ok(/printOrderCard/.test(kitchenJs) && /printTicketOps/.test(kitchenJs), 'la pizarra imprime con el builder y el transporte compartidos');
  assert.ok(/id="kdsPrinterBtn"/.test(html), 'botón de impresora en el encabezado del KDS');
  assert.ok(/kds-btn-print/.test(kitchenJs) && /\.kds-btn-print/.test(kitchenCss), 'botón 🖨️ por tarjeta con estilo propio');

  // Polling + avisos (spec F2): 20s solo visible, beep WebAudio, live region.
  assert.ok(/20000/.test(kitchenJs) && /visibilityState\s*===\s*['"]visible['"]/.test(kitchenJs), 'polling de 20s solo con la pestaña visible');
  assert.ok(/AudioContext|webkitAudioContext/.test(kitchenJs), 'beep WebAudio sin assets');
  assert.ok(/initModalA11y\(\)/.test(kitchenJs), 'kitchen.js cablea el enhancer de modales');

  console.log('✓ §1 Estático: HTML/CSS/JS de la pizarra (CSP, diálogos, DOM API, imports)');

  // ── §2 Módulo puro kitchenColumns.js ────────────────────────────────────────
  const cols = await import('../public/js/kitchen/kitchenColumns.js');

  assert.ok(Array.isArray(cols.KITCHEN_COLUMNS) && cols.KITCHEN_COLUMNS.length === 5, '5 columnas fijas');
  assert.ok(cols.KDS_COLUMN_IDS.length === 5 && new Set(cols.KDS_COLUMN_IDS).size === 5, 'ids de columna únicos');
  assert.deepEqual(
    cols.KITCHEN_COLUMNS.map((c) => c.id),
    cols.KDS_COLUMN_IDS,
    'las columnas declaradas y los ids canónicos coinciden'
  );

  // Estados cubiertos, disjuntos y sin 'cancelled' (fuera de la pizarra).
  const allStatuses = cols.KITCHEN_COLUMNS.flatMap((c) => c.statuses);
  assert.ok(new Set(allStatuses).size === allStatuses.length, 'un estado jamás vive en dos columnas');
  assert.ok(!allStatuses.includes('cancelled'), 'cancelled no entra a la pizarra');
  assert.ok(['pending', 'confirmed', 'preparing', 'ready', 'on_the_way', 'delivered', 'delayed'].every((s) => allStatuses.includes(s)), 'los 7 estados activos tienen columna');

  // Tabla de decisión exacta (la ESPEC ejecutable).
  assert.strictEqual(cols.columnIdForStatus('pending'), 'queue', 'pending → En cola');
  assert.strictEqual(cols.columnIdForStatus('confirmed'), 'confirmed', 'confirmed → Confirmados');
  assert.strictEqual(cols.columnIdForStatus('preparing'), 'preparing', 'preparing → Preparando');
  assert.strictEqual(cols.columnIdForStatus('delayed'), 'preparing', 'delayed → Preparando (sigue siendo trabajo de cocina)');
  assert.strictEqual(cols.columnIdForStatus('ready'), 'ready', 'ready → Listo/En camino');
  assert.strictEqual(cols.columnIdForStatus('on_the_way'), 'ready', 'on_the_way → Listo/En camino');
  assert.strictEqual(cols.columnIdForStatus('delivered'), 'delivered', 'delivered → Entregados');
  assert.strictEqual(cols.columnIdForStatus('cancelled'), null, 'cancelled → null (no pinta)');
  assert.strictEqual(cols.columnIdForStatus('estado_futuro'), 'queue', 'estado desconocido → En cola (la cocina JAMÁS pierde un pedido)');
  assert.strictEqual(cols.columnIdForStatus(''), 'queue', 'estado faltante → En cola');
  assert.strictEqual(cols.columnIdForStatus(null), 'queue', 'estado null → En cola');

  // Secuencia de avance por toque.
  assert.deepEqual(
    ['pending', 'confirmed', 'preparing', 'ready', 'on_the_way', 'delivered'].map((s) => cols.nextKitchenStatus(s) || null),
    ['confirmed', 'preparing', 'ready', 'on_the_way', 'delivered', null],
    'toque avanza la secuencia completa: pending→…→delivered'
  );
  assert.strictEqual(cols.nextKitchenStatus('delayed'), 'delivered', 'delayed avanza directo a entregado');
  assert.strictEqual(cols.nextKitchenStatus('delivered'), null, 'delivered es terminal (sin avance)');
  assert.strictEqual(cols.nextKitchenStatus('cancelled'), null, 'cancelado es terminal (cancelar NUNCA va por toque)');
  assert.strictEqual(cols.nextKitchenStatus('estado_futuro'), null, 'estado desconocido no avanza a ciegas');

  // Ticket corto determinista.
  assert.strictEqual(cols.kitchenTicketNumber({ id: 'ord_1750000000_AB12' }), '#AB12');
  assert.strictEqual(cols.kitchenTicketNumber({ id: 'xkcd' }), '#XKCD', 'id sin guiones bajos: cola completa');
  assert.strictEqual(cols.kitchenTicketNumber({}), '#—', 'pedido sin id → ticket marcado, no throw');
  assert.strictEqual(cols.kitchenTicketNumber(null), '#—');

  // Etiquetas de estado: espejo del Studio y del backend.
  assert.strictEqual(cols.KITCHEN_STATUS_LABELS.pending, 'Recibido');
  assert.strictEqual(cols.KITCHEN_STATUS_LABELS.delayed, 'Demorado');
  assert.strictEqual(cols.KITCHEN_STATUS_LABELS.on_the_way, 'En camino');

  // Modelo de tarjeta completo (snake_mode real del backend).
  const orderSnake = {
    id: 'ord_kck_SE2A',
    status: 'pending',
    restaurant_id: 'r1',
    table_number: '4',
    customer_name: 'Gonzalo',
    created_at: new Date().toISOString(),
    notes: '<b>Sin talco</b>',
    items_snapshot: [
      {
        name: 'Chivito',
        quantity: 2,
        note: 'sin lechuga',
        optionsSnapshot: [
          { groupName: 'Aderezos', kind: 'sauce', selections: [{ name: 'Mayo', quantity: 1 }, { name: 'Ketchup', quantity: 2 }] },
          { groupName: 'Presentación', kind: 'presentation', selections: [{ name: 'Paquete x12', quantity: 1 }] }
        ]
      },
      { name: 'Papas', quantity: 1 }
    ]
  };
  const mSnake = cols.buildKitchenCardModel(orderSnake);
  assert.ok(mSnake, 'modelo construido');
  assert.strictEqual(mSnake.columnId, 'queue');
  assert.strictEqual(mSnake.ticketNumber, '#SE2A');
  assert.strictEqual(mSnake.table, '4');
  assert.strictEqual(mSnake.customer, 'Gonzalo');
  assert.strictEqual(mSnake.pending, true);
  assert.strictEqual(mSnake.terminal, false);
  assert.strictEqual(mSnake.items[0].label, '2× Chivito');
  assert.deepEqual(mSnake.items[0].mods, ['Aderezos: Mayo, 2× Ketchup'], 'modificadores aplanados (la presentación NO es un modificador)');
  assert.strictEqual(mSnake.items[0].note, 'sin lechuga');
  assert.strictEqual(mSnake.items[1].label, 'Papas');
  assert.deepEqual(mSnake.items[1].mods, []);
  assert.ok(mSnake.notes.includes('Sin talco'), 'la nota del comensal viaja cruda (el render usa textContent, jamás HTML)');

  // F0: modalidad del pedido en el modelo (salón / delivery / mostrador).
  assert.deepEqual(cols.KDS_ORDER_MODE_IDS, ['LOCAL', 'DELIVERY', 'TAKEAWAY'], 'allowlist de modalidades');
  assert.strictEqual(cols.normalizeKdsOrderMode(' delivery '), 'DELIVERY', 'normaliza espacios/mayúsculas');
  assert.strictEqual(cols.normalizeKdsOrderMode(null), 'LOCAL', 'sin modalidad → LOCAL');
  assert.strictEqual(mSnake.orderMode, 'LOCAL', 'pedido histórico sin order_mode → LOCAL');
  assert.strictEqual(mSnake.orderModeLabel, 'Salón');
  const mDelivery = cols.buildKitchenCardModel({ id: 'd1', status: 'preparing', order_mode: 'DELIVERY' });
  assert.strictEqual(mDelivery.orderMode, 'DELIVERY');
  assert.strictEqual(mDelivery.orderModeLabel, 'Delivery');
  assert.strictEqual(mDelivery.orderModeIcon, '🛵');
  assert.strictEqual(mDelivery.orderModeClass, 'kds-mode-delivery');
  const mTakeaway = cols.buildKitchenCardModel({ id: 't1', status: 'pending', orderMode: 'takeaway' });
  assert.strictEqual(mTakeaway.orderMode, 'TAKEAWAY', 'camelCase/minúsculas normalizadas');
  assert.strictEqual(mTakeaway.orderModeLabel, 'Para llevar');
  assert.strictEqual(mTakeaway.orderModeClass, 'kds-mode-takeaway');
  const mUnknownMode = cols.buildKitchenCardModel({ id: 'u1', status: 'pending', order_mode: 'PICKUP' });
  assert.strictEqual(mUnknownMode.orderMode, 'LOCAL', 'modalidad desconocida cae a LOCAL (nunca rompe la tarjeta)');

  // Fallbacks camelCase (dual-mode) y snapshot de helado a medida.
  const mCamel = cols.buildKitchenCardModel({
    id: 'kds1',
    status: 'ready',
    itemsSnapshot: [{ name: 'Gelatina', quantity: 3, optionsSnapshot: [] }],
    tableNumber: '7',
    createdAt: '2026-01-01T00:00:00.000Z'
  });
  assert.strictEqual(mCamel.columnId, 'ready');
  assert.strictEqual(mCamel.items[0].label, '3× Gelatina');
  assert.strictEqual(mCamel.table, '7');

  const mIce = cols.buildKitchenCardModel({
    id: 'ice1', status: 'confirmed',
    items_snapshot: [{ customIceCream: true, quantity: 1 }]
  });
  assert.strictEqual(mIce.items[0].label, 'Item personalizado', 'snapshot sin nombre legible → fallback, jamás rompe');

  // Tolerancia a basura (nada hard-crashea la pizarra).
  assert.strictEqual(cols.buildKitchenCardModel(null), null);
  assert.strictEqual(cols.buildKitchenCardModel('perro'), null);
  const mJunk = cols.buildKitchenCardModel({ status: 'pending', items_snapshot: [null, 'x', { quantity: 2 }, { name: 'Vivo' }] });
  assert.deepEqual(mJunk.items.map((i) => i.label).sort(), ['2× Item personalizado', 'Vivo'], 'ítems rotos se saltan sin matar la tarjeta');
  const mNoQty = cols.buildKitchenCardModel({ id: 'q1', status: 'confirmed', items_snapshot: [{ name: 'Flan' }] });
  assert.strictEqual(mNoQty.items[0].label, 'Flan', 'sin qty no pinta "undefined×"');

  console.log('✓ §2 Módulo puro: tabla de decisión + secuencia + modelo tolerante');

  // ── §3 Runtime real: server HTTP + store real ──────────────────────────────
  const runTag = Date.now();
  const userA = await db.createUser({ email: `kitchen-a-${runTag}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const userB = await db.createUser({ email: `kitchen-b-${runTag}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });

  const restA = await db.saveRestaurant(userA.id, {
    name: 'Kitchen Local A', bizName: 'Kitchen Local A',
    slug: `kitchen-local-a-${runTag}`,
    phone: '59899111111',
    currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }]
  });
  await db.saveRestaurant(userB.id, {
    name: 'Kitchen Local B', bizName: 'Kitchen Local B',
    slug: `kitchen-local-b-${runTag}`,
    phone: '59899222222',
    currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Burger', price: 10, categoryId: 'cat1' }]
  });

  const tokenA = jwt.sign({ userId: userA.id }, JWT_SECRET, { expiresIn: '1h' });
  const tokenB = jwt.sign({ userId: userB.id }, JWT_SECRET, { expiresIn: '1h' });
  const authA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };
  const authB = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` };

  // 8 pedidos reales, uno por estado (determinista para el mapping).
  const statuses = ['pending', 'confirmed', 'preparing', 'ready', 'on_the_way', 'delivered', 'delayed', 'cancelled'];
  const orderIds = {};
  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    const id = `ord_kck_${runTag}_${i.toString().padStart(2, '0')}`;
    orderIds[status] = id;
    await db.addOrder({
      id,
      restaurant_id: restA.id,
      restaurantId: restA.id,
      status,
      // F0: modalidad real del pedido (el KDS la pinta en la tarjeta).
      order_mode: status === 'confirmed' ? 'DELIVERY' : (status === 'preparing' ? 'TAKEAWAY' : 'LOCAL'),
      currency: 'USD',
      amount: 12.5,
      table_number: String(i + 1),
      tableNumber: String(i + 1),
      customer_name: `Comensal ${i + 1}`,
      created_at: new Date(Date.now() - (90 - i) * 60000).toISOString(),
      notes: i === 0 ? 'Sin sal (alérgeno)' : '',
      items_snapshot: [{ name: 'Milanesa', quantity: i + 1, note: i === 0 ? 'sin zanahoria' : '' }]
    });
  }

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  // GET anónimo → 401 (la data del dueño no es pública).
  const anon = await fetch(`${base}/api/orders/restaurant/${encodeURIComponent(restA.id)}`);
  assert.strictEqual(anon.status, 401, 'GET pedidos anónimo → 401');

  // GET del dueño por id → 200 con los 8.
  const resOrders = await fetch(`${base}/api/orders/restaurant/${encodeURIComponent(restA.id)}`, { headers: authA });
  assert.strictEqual(resOrders.status, 200, 'GET pedidos del dueño (por id) → 200');
  const bodyOrders = await resOrders.json();
  assert.ok(bodyOrders.success && Array.isArray(bodyOrders.data), 'respuesta con data:[pedidos]');
  const fetchedIds = new Set(bodyOrders.data.map((o) => o.id));
  assert.ok(Object.values(orderIds).every((id) => fetchedIds.has(id)), 'los 8 pedidos llegan al KDS');
  assert.equal(bodyOrders.data.length, 8, 'exactamente 8 (aislado por restaurante)');

  // F0: la modalidad persiste en el espejo local y el modelo la expone.
  const rowConfirmed = bodyOrders.data.find((o) => o.status === 'confirmed');
  const rowPreparing = bodyOrders.data.find((o) => o.status === 'preparing');
  assert.strictEqual(rowConfirmed.order_mode, 'DELIVERY', 'DELIVERY persiste en la fila real');
  assert.strictEqual(rowPreparing.order_mode, 'TAKEAWAY', 'TAKEAWAY persiste en la fila real');
  assert.strictEqual(cols.buildKitchenCardModel(rowConfirmed).orderMode, 'DELIVERY', 'el KDS lee la modalidad de la fila');
  assert.strictEqual(cols.buildKitchenCardModel(rowPreparing).orderModeLabel, 'Para llevar', 'la etiqueta del KDS sale de la modalidad');

  // Mapping colId sobre las filas REALES del runtime.
  const buckets = { queue: 0, confirmed: 0, preparing: 0, ready: 0, delivered: 0 };
  for (const o of bodyOrders.data) {
    const model = cols.buildKitchenCardModel(o);
    if (o.status === 'cancelled') {
      assert.strictEqual(model.columnId, null, 'cancelados no pintan en ningún column list');
      continue;
    }
    buckets[model.columnId] += 1;
  }
  assert.deepEqual(buckets, { queue: 1, confirmed: 1, preparing: 2, ready: 2, delivered: 1 }, 'reparto exacto En cola 1 · Confirmados 1 · Preparando 2 (preparing+delayed) · Listo/En camino 2 · Entregados 1');

  // GET por slug (el owner-check acepta id O slug).
  const resBySlug = await fetch(`${base}/api/orders/restaurant/${encodeURIComponent(restA.slug)}`, { headers: authA });
  assert.strictEqual(resBySlug.status, 200, 'GET pedidos por slug también responde (tablet vieja)');

  // Cross-tenant: el dueño B no ve los pedidos del local A (403 hardening;
  // el código exacto depende del guard: IDOR_ACCESS_DENIED genérico).
  const resCross = await fetch(`${base}/api/orders/restaurant/${encodeURIComponent(restA.id)}`, { headers: authB });
  assert.strictEqual(resCross.status, 403, 'dueño ajeno → 403');
  const bodyCross = await resCross.json();
  assert.ok(
    bodyCross.code === 'IDOR_ACCESS_DENIED' || bodyCross.code === 'ORDER_TENANT_MISMATCH',
    '403 con código hardening (IDOR_ACCESS_DENIED/ORDER_TENANT_MISMATCH)'
  );

  // PATCH avanzar: pending → confirmed (el toque de la tarjeta del KDS).
  const pendingId = orderIds.pending;
  const resOk = await fetch(`${base}/api/orders/status/${encodeURIComponent(pendingId)}`, {
    method: 'PATCH', headers: authA, body: JSON.stringify({ status: 'confirmed' })
  });
  assert.strictEqual(resOk.status, 200, 'PATCH válido → 200');
  const bodyOk = await resOk.json();
  assert.ok(bodyOk.success, 'PATCH confirma success');
  const after = await db.findOrderById(pendingId);
  assert.strictEqual(after.status, 'confirmed', 'el estado persistió REAL en el store');

  // Re-GET: el KDS ahora lo pinta en Confirmados (mapping vivo).
  const resRe = await fetch(`${base}/api/orders/restaurant/${encodeURIComponent(restA.id)}`, { headers: authA });
  const bodyRe = await resRe.json();
  const reModel = cols.buildKitchenCardModel(bodyRe.data.find((o) => o.id === pendingId));
  assert.strictEqual(reModel.columnId, 'confirmed', 'el pedido avanzado cae en la columna Confirmados');

  // PATCH inválido → 400 con código honesto.
  const resBad = await fetch(`${base}/api/orders/status/${encodeURIComponent(pendingId)}`, {
    method: 'PATCH', headers: authA, body: JSON.stringify({ status: 'teleport' })
  });
  assert.strictEqual(resBad.status, 400, 'estado inválido → 400');
  const bodyBad = await resBad.json();
  assert.strictEqual(bodyBad.code, 'INVALID_ORDER_STATUS', 'código INVALID_ORDER_STATUS');

  // PATCH anónimo → 401; PATCH cross-tenant → 403 Y NO toca nada.
  const resAnonPatch = await fetch(`${base}/api/orders/status/${encodeURIComponent(orderIds.confirmed)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'preparing' })
  });
  assert.strictEqual(resAnonPatch.status, 401, 'PATCH anónimo → 401');
  const resCrossPatch = await fetch(`${base}/api/orders/status/${encodeURIComponent(orderIds.confirmed)}`, {
    method: 'PATCH', headers: authB, body: JSON.stringify({ status: 'cancelled' })
  });
  assert.strictEqual(resCrossPatch.status, 403, 'PATCH de dueño ajeno → 403');
  assert.strictEqual((await db.findOrderById(orderIds.confirmed)).status, 'confirmed', 'el 403 no mutó el estado');
  // Cancelar (único flujo destructivo; la confirmación es client-side): 200 + fuera de la pizarra.
  const resCancel = await fetch(`${base}/api/orders/status/${encodeURIComponent(orderIds.delayed)}`, {
    method: 'PATCH', headers: authA, body: JSON.stringify({ status: 'cancelled' })
  });
  assert.strictEqual(resCancel.status, 200, 'cancelar → 200');
  assert.strictEqual(
    cols.buildKitchenCardModel(await db.findOrderById(orderIds.delayed)).columnId,
    null,
    'el cancelado sale de la pizarra'
  );

  // ── Ruta dev de la página (express): HTML con headers de seguridad ────────
  const page = await fetch(`${base}/kitchen`);
  assert.strictEqual(page.status, 200, 'GET /kitchen (dev express) → 200');
  const pageText = await page.text();
  assert.ok(pageText.includes('Vista Kitchen'), 'página del KDS servida');
  assert.ok(/script-src-attr\s+'none'/.test(page.headers.get('content-security-policy') || ''), 'cabeza CSP transitional en /kitchen');
  assert.ok(/\bid="main-content"/.test(pageText), 'landmark main en la respuesta dev');

  // Alta REAL (al final, para no alterar el snapshot local/cloud de arriba):
  // el body del pedido lleva la modalidad al registro. TAKEAWAY no exige
  // dirección ni zona de envío.
  const resCreate = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      restaurantId: restA.id,
      tableNumber: '0',
      orderMode: 'TAKEAWAY',
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Mostrador Test',
      // Teléfono único por corrida: este alta también acredita fidelización
      // global y un número fijo contaminaba a test-loyalty-dual entre
      // corridas standalone (3 visitas fantasma → 4 !== 1).
      customerPhone: `59899${String(Date.now()).slice(-6)}`,
      currency: 'USD'
    })
  });
  assert.strictEqual(resCreate.status, 201, 'POST pedido takeaway → 201');
  const createdBody = await resCreate.json();
  const createdId = createdBody && createdBody.data && createdBody.data.id;
  assert.ok(createdId, 'el pedido creado devuelve id');
  const createdRow = await db.findOrderById(createdId);
  assert.strictEqual(createdRow.order_mode, 'TAKEAWAY', 'POST /api/orders persiste order_mode (local)');
  assert.strictEqual(db.toCloudOrder(createdRow).order_mode, 'TAKEAWAY', 'toCloudOrder mapea order_mode a la nube');

  console.log('✓ §3 Runtime: GET id/slug · 403 cross-tenant · 401 anónimo · avance/cancel reales · /kitchen dev');

  // ── §4 A11y de la pizarra (complementa test-a11y global) ──────────────────
  assert.ok(html.match(/<html\s+lang="es"/), 'lang="es"');
  const mainOpen = (html.match(/<main\b/g) || []).length;
  assert.strictEqual(mainOpen, 1, 'exactamente UN <main>');
  assert.ok(/<main[^>]*id="main-content"[^>]*tabindex="-1"/.test(html), 'main con tabindex="-1" (destino del skip-link)');
  assert.ok(html.indexOf('class="skip-link"') < html.indexOf('<main'), 'skip-link antes del main');
  assert.ok(!/tabindex="\d/.test(html), 'cero tabindex positivos');
  assert.ok((html.match(/<h1\b/g) || []).length >= 1 && (html.match(/<h2\b/g) || []).length === 5, 'h1 + 5 encabezados de columna h2');
  assert.ok(!/<input|<select|<textarea/.test(html), 'pizarra sin formularios (cero labels huérfanos posibles)');

  // Modal de confirmación: rol + aria + nombre accesible + botón cerrado nombrado.
  const modalIdx = html.indexOf('confirmActionModal');
  assert.ok(modalIdx > 0, 'modal de confirmación presente');
  const modalSeg = html.slice(modalIdx, html.indexOf('</body>'));
  assert.ok(/role="dialog"/.test(modalSeg) && /aria-modal="true"/.test(modalSeg), 'modal con role=dialog + aria-modal');
  assert.ok(/aria-labelledby="confirmDialogTitle"/.test(modalSeg), 'nombre accesible por labelledby');
  assert.ok(/id="confirmDialogTitle"/.test(modalSeg), 'el título referenciado existe');
  assert.ok(/aria-label="Cerrar"/.test(modalSeg), 'botón ✕ con aria-label');

  // Elementos de estado del spec F2: banner honesto + cancelados + live + gate.
  ['kdsBanner', 'kdsCancelledNote', 'kdsLive', 'kdsGate', 'kdsGateMessage'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `#kds* ${id} presente`);
  });
  assert.ok(/id="kdsLive"[^>]*aria-live="polite"/.test(html) || /aria-live="polite"[^>]*id="kdsLive"/.test(html), 'live region aria-live=polite');
  ['colTitleQueue', 'colBodyConfirmed', 'colCountPreparing', 'colBodyReady', 'colCountDelivered'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `columna ${id} presente`);
  });

  console.log('✓ §4 A11y: skip-link/main/modales ARIA/columnas/live/gate');

  await new Promise((resolve) => server.close(resolve));
  console.log('✅ test-kitchen: Vista Kitchen (KDS F2) OK');
}

runTests().catch((err) => {
  console.error('❌ test-kitchen falló:', err.message);
  process.exit(1); // el server HTTP abierto no deja drenar el event loop
});
