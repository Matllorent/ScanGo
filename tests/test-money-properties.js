const assert = require('assert');
const { quoteOrderItems, resolveDeliveryFee, resolveCouponDiscount } = require('../api/utils/orderMoney');
const { PRIVILEGED_FIELDS, stripPrivilegedFields } = require('../api/utils/stripPrivilegedFields');
const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');

const SEED = 20261012;

/**
 * Bloque 2 — Property testing del dinero.
 *
 * Las reglas monetarias (cotización en centavos, envío contra zonas, cupones)
 * son el corazón del cobro: un error de centavo acá es un cargo equivocado.
 * Se valida por PROPIEDADES con PRNG seed fijo (misma seed ⇒ mismos casos,
 * reproducible; sin dependencias): invariantes que deben valer para CUALQUIER
 * entrada válida, más casos fijos adversariales y 1.200+ casos fuzzed seeded.
 *
 * También se ataca el invariante P0 anti mass-assignment de Studio /save: se
 * extrajo el strip de campos privilegiados a una utilidad pura
 * (stripPrivilegedFields) y se prueba que NUNCA deja pasar
 * subscription/userId/analytics/createdAt/updatedAt ni keys de proto, que es
 * idempotente y que la composición wrapper sanitize→strip usada por la ruta
 * sigue limpia.
 *
 * No toca data/ ni la red: todo es puro, con fixtures in-memory.
 */

console.log('🧪 Propiedades del dinero: cotización, envío, cupones, P0 strip privilegiado...');

function makeRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); },
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
    maybe(p) { return this.next() < p; }
  };
}

// ── Fixture: carta típica con grupos de opciones reales ─────────────────────
const FIXTURE = {
  categories: [
    { id: 'cat-1', name: 'Principales' },
    { id: 'cat-2', name: 'Postres' }
  ],
  modifierGroups: [
    {
      id: 'grp-addons', name: 'Extras', kind: 'modifier', selectionMode: 'multiple',
      required: false, minSelections: 0, maxSelections: 3, active: true,
      options: [
        { id: 'extra-cheese', name: 'Queso extra', priceDeltaCents: 200, active: true },
        { id: 'pepperoni', name: 'Pepperoni', priceDeltaCents: 250, active: true },
        { id: 'bacon', name: 'Bacon', priceDeltaCents: 300, active: true }
      ]
    },
    {
      id: 'grp-size', name: 'Tamaño', kind: 'presentation', selectionMode: 'single',
      required: true, minSelections: 1, maxSelections: 1, active: true,
      options: [
        { id: 'small', name: 'Chica', priceCents: 1000, unitsIncluded: 1, active: true },
        { id: 'large', name: 'Grande', priceCents: 1800, unitsIncluded: 2, active: true }
      ]
    },
    {
      id: 'grp-scoops', name: 'Sabores', kind: 'flavor', selectionMode: 'quantity',
      required: false, minSelections: 1, maxSelections: 4, active: true,
      options: [
        { id: 'vanilla', name: 'Vainilla', priceDeltaCents: 0, active: true },
        { id: 'chocolate', name: 'Chocolate', priceDeltaCents: 100, active: true },
        { id: 'strawberry', name: 'Fruttilla', priceDeltaCents: 100, active: true }
      ]
    },
    {
      id: 'grp-container', name: 'Recipiente', kind: 'presentation', selectionMode: 'single',
      required: true, minSelections: 1, maxSelections: 1, active: true,
      options: [
        { id: 'cup', name: 'Vaso', priceCents: 800, unitsIncluded: 1, active: true },
        { id: 'cone', name: 'Cucurucho', priceCents: 900, unitsIncluded: 1, active: true }
      ]
    }
  ],
  dishes: [
    { id: 'dish-a', name: 'Hamburguesa', price: 12.5, categoryId: 'cat-1' },
    { id: 'dish-b', name: 'Pizza', price: 15, categoryId: 'cat-1', modifierGroupIds: ['grp-addons', 'grp-size'] },
    { id: 'dish-c', name: 'Helado', price: 5, categoryId: 'cat-2', modifierGroupIds: ['grp-scoops', 'grp-container'] }
  ],
  customCoupons: [
    { code: 'PROMO10', type: 'percent', value: 10, label: '10% OFF' },
    { code: 'TODO50', type: 'percent', value: 50, label: 'Mitad' },
    { code: 'MOCHO200', type: 'percent', value: 200, label: '200%??' },
    { code: 'ENVIOFREE', type: 'free_delivery', value: 0, label: 'Envío Gratis' }
  ],
  deliveryZones: [
    { name: 'Zona 1', fee: 200 },
    { name: 'Zona 2', fee: 350 }
  ]
};

const PRICES = {
  'dish-a': 1250,
  'grp-addons': { 'extra-cheese': 200, pepperoni: 250, bacon: 300 },
  'grp-size': { small: 1000, large: 1800 },
  'grp-scoops': { vanilla: 0, chocolate: 100, strawberry: 100 },
  'grp-container': { cup: 800, cone: 900 }
};

/** Precio unitario ESPERADO en centavos para una línea válida del fixture. */
function expectedUnitPriceCents(dishId, choices) {
  if (dishId === 'dish-a') return PRICES['dish-a'];
  if (dishId === 'dish-b') {
    const byGroup = Object.fromEntries(choices.map((c) => [c.groupId, c.selections]));
    const sizeId = byGroup['grp-size'][0].optionId;
    const extras = byGroup['grp-addons'] || [];
    return PRICES['grp-size'][sizeId] + extras.reduce((s, e) => s + PRICES['grp-addons'][e.optionId], 0);
  }
  if (dishId === 'dish-c') {
    const byGroup = Object.fromEntries(choices.map((c) => [c.groupId, c.selections]));
    const containerId = byGroup['grp-container'][0].optionId;
    const scoops = byGroup['grp-scoops'] || [];
    return PRICES['grp-container'][containerId] + scoops.reduce((s, e) => s + PRICES['grp-scoops'][e.optionId] * e.quantity, 0);
  }
  throw new Error(`fixture sin precio esperado para ${dishId}`);
}

/** Genera una orden aleatoria VÁLIDA contra el fixture. */
function randomValidOrder(rng) {
  const DISH_POOL = ['dish-a', 'dish-a', 'dish-b', 'dish-c'];
  const lines = [];
  const n = rng.int(1, 3);
  for (let i = 0; i < n; i++) {
    const dishId = rng.pick(DISH_POOL);
    let choices = [];
    if (dishId === 'dish-b') {
      const extras = [];
      const k = rng.int(0, 3);
      const pool = ['extra-cheese', 'pepperoni', 'bacon'];
      for (let e = 0; e < k; e++) {
        const opt = pool.splice(rng.int(0, pool.length - 1), 1)[0];
        extras.push({ optionId: opt });
      }
      choices = [
        { groupId: 'grp-size', selections: [{ optionId: rng.pick(['small', 'large']) }] },
        ...(extras.length ? [{ groupId: 'grp-addons', selections: extras }] : [])
      ];
    } else if (dishId === 'dish-c') {
      const total = rng.int(1, 4);
      // Sabores DISTINTOS (el validador rechaza optionId duplicado en un grupo):
      // se reparte el total entre k sabores, cada uno con su quantity.
      const flavors = ['vanilla', 'chocolate', 'strawberry'];
      const k = rng.int(1, Math.min(3, total));
      let remaining = total;
      const scoops = [];
      for (let f = 0; f < k; f++) {
        const q = f === k - 1 ? remaining : rng.int(1, remaining - (k - 1 - f));
        scoops.push({ optionId: flavors[f], quantity: q });
        remaining -= q;
      }
      choices = [
        { groupId: 'grp-scoops', selections: scoops },
        { groupId: 'grp-container', selections: [{ optionId: rng.pick(['cup', 'cone']) }] }
      ];
    }
    lines.push({ dishId, quantity: rng.int(0, 5), choices });
  }
  return lines;
}

function assertQuoteInvariants(lines, ts, tag) {
  const { itemsSnapshot, amountInCents } = quoteOrderItems(FIXTURE, lines, ts);
  assert.strictEqual(itemsSnapshot.length, lines.length, `${tag}: una línea por ítem`);
  let recomputed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = itemsSnapshot[i];
    assert.strictEqual(line.snapshotTimestamp, ts, `${tag}[${i}]: timestamp inyectado`);
    assert.strictEqual(line.unitPriceInCents, expectedUnitPriceCents(lines[i].dishId, lines[i].choices), `${tag}[${i}]: precio unitario = ${expectedUnitPriceCents(lines[i].dishId, lines[i].choices)}`);
    assert.strictEqual(line.totalItemAmountInCents, line.unitPriceInCents * line.quantity, `${tag}[${i}]: total = unitario × cantidad`);
    assert.ok(line.unitPriceInCents >= 0 && line.totalItemAmountInCents >= 0, `${tag}[${i}]: nunca negativo`);
    recomputed += line.totalItemAmountInCents;
  }
  assert.strictEqual(amountInCents, recomputed, `${tag}: amountInCents = Σ totales de línea`);
  assert.ok(amountInCents >= 0, `${tag}: total del pedido nunca negativo`);
}

function run() {
  // ── 1) Cotización: casos fijos adversariales ──────────────────────────────
  assertQuoteInvariants(
    [
      { dishId: 'dish-a', quantity: 1, choices: [] },
      { dishId: 'dish-b', quantity: 2, choices: [{ groupId: 'grp-size', selections: [{ optionId: 'small' }] }, { groupId: 'grp-addons', selections: [{ optionId: 'extra-cheese' }, { optionId: 'pepperoni' }] }] },
      { dishId: 'dish-c', quantity: 1, choices: [{ groupId: 'grp-scoops', selections: [{ optionId: 'chocolate', quantity: 2 }] }, { groupId: 'grp-container', selections: [{ optionId: 'cup' }] }] }
    ],
    '2026-10-12T12:00:00.000Z',
    'casos fijos'
  );

  // Cantidad 0: línea en cero, nunca saldo negativo.
  {
    const { itemsSnapshot, amountInCents } = quoteOrderItems(FIXTURE, [{ dishId: 'dish-a', quantity: 0, choices: [] }], 'ts0');
    assert.strictEqual(itemsSnapshot[0].totalItemAmountInCents, 0, 'qty 0 → total 0');
    assert.strictEqual(itemsSnapshot[0].unitPriceInCents, 1250, 'qty 0 → el unitario se cotiza igual');
    assert.strictEqual(amountInCents, 0, 'qty 0 → pedido 0');
  }

  // Errores honestos con código estable.
  assert.throws(() => quoteOrderItems(FIXTURE, [{ dishId: 'zzz-no-existe', quantity: 1 }]), (e) => e.code === 'DISH_NOT_FOUND', 'plato inexistente');
  assert.throws(
    () => quoteOrderItems(FIXTURE, [{ dishId: 'dish-b', quantity: 1, choices: [{ groupId: 'grp-addons', selections: [{ optionId: 'extra-cheese' }] }] }]),
    (e) => e.code === 'INVALID_DISH_OPTIONS', 'presentación requerida omitida'
  );
  assert.throws(
    () => quoteOrderItems(FIXTURE, [{ dishId: 'dish-b', quantity: 1, choices: [{ groupId: 'grp-size', selections: [{ optionId: 'xxx' }] }] }]),
    (e) => e.code === 'INVALID_DISH_OPTIONS', 'opción inexistente en un grupo'
  );
  assert.throws(
    () => quoteOrderItems(FIXTURE, [{ dishId: 'dish-b', quantity: 1, choices: [{ groupId: 'grp-size', selections: [{ optionId: 'small' }] }, { groupId: 'grp-size', selections: [{ optionId: 'large' }] }] }]),
    (e) => e.code === 'INVALID_DISH_OPTIONS', 'grupo duplicado'
  );
  assert.throws(
    () => quoteOrderItems(FIXTURE, [{ dishId: 'dish-c', quantity: 1, choices: [{ groupId: 'grp-scoops', selections: [{ optionId: 'chocolate', quantity: 1.5 }] }, { groupId: 'grp-container', selections: [{ optionId: 'cup' }] }] }]),
    (e) => e.code === 'INVALID_DISH_OPTIONS', 'cantidad no entera en modo quantity'
  );
  assert.throws(
    () => quoteOrderItems(FIXTURE, [{ dishId: 'dish-c', quantity: 1, choices: [{ groupId: 'grp-container', selections: [{ optionId: 'cup' }] }] }]),
    (e) => e.code === 'INVALID_DISH_OPTIONS', 'grupo quantity sin selecciones (minSelections 1)'
  );

  // ── 1b) Helado a medida: el servidor recomputa contra la config del dueño ─
  // (antes el item sintético `icecream_*` moría en DISH_NOT_FOUND y el helado
  // armado no se podía pedir). El precio del cliente nunca viaja: no hay campo
  // de precio en el payload, solo qué armó.
  {
    const HELA = {
      dishes: [
        { id: 'f-ddl', name: 'DDL', price: 0, iceCreamSurcharge: 0 },
        { id: 'f-pist', name: 'Pistacho', price: 0, iceCreamSurcharge: 80 },
        { id: 'f-out', name: 'Agotado', price: 0, outOfStock: true }
      ]
    };
    const line = (over = {}) => ({
      dishId: 'icecream_abc123',
      quantity: 2,
      customIceCream: {
        containerId: 'container_cucurucho', // default 220, máx 2 sabores
        flavorIds: ['f-ddl', 'f-pist'],     // 0 + 80 recargo
        toppingIds: ['salsa_ddl']           // default 50
      },
      ...over
    });
    const { itemsSnapshot, amountInCents } = quoteOrderItems(HELA, [line()], 'ts-ice');
    assert.strictEqual(amountInCents, (220 + 80 + 50) * 2 * 100, 'total = tamaño + recargo + topping, × cantidad');
    assert.strictEqual(itemsSnapshot[0].name, 'Cucurucho Artesanal Especial a medida', 'snapshot con nombre del tamaño');
    assert.strictEqual(itemsSnapshot[0].categoryName, 'Heladería', 'categoría del snapshot');
    const selNames = itemsSnapshot[0].optionsSnapshot[0].selections.map((s) => s.name).join(' ');
    assert.ok(selNames.includes('Pistacho') && selNames.includes('Cucurucho'), 'snapshot describe tamaño y sabores');
    // Config propia del dueño manda sobre los defaults.
    const HELA_OWN = {
      ...HELA,
      iceCreamContainers: [{ id: 'cX', name: 'Pote mío', price: 1000, maxFlavors: 1 }],
      iceCreamToppings: [{ id: 'tX', name: 'Extra mío', price: 5, kind: 'topping' }]
    };
    const own = quoteOrderItems(HELA_OWN, [{
      dishId: 'icecream_xyz', quantity: 1,
      customIceCream: { containerId: 'cX', flavorIds: ['f-ddl'], toppingIds: ['tX'] }
    }], 'ts-ice-own');
    assert.strictEqual(own.amountInCents, (1000 + 0 + 5) * 100, 'precios del dueño, no defaults');
    // Defaults viejos ya no valen con config propia.
    assert.throws(() => quoteOrderItems(HELA_OWN, [line()], 'ts-ice-bad'),
      (e) => e.code === 'INVALID_DISH_OPTIONS', 'container default con config propia → inválido');
    // Errores honestos, todos INVALID_DISH_OPTIONS (nunca 500).
    const badCases = [
      [{ ...line().customIceCream, containerId: 'nope' }, 'tamaño inexistente'],
      [{ ...line().customIceCream, flavorIds: ['f-ddl', 'f-pist', 'f-ddl'] }, 'más sabores que el máximo'],
      [{ ...line().customIceCream, flavorIds: ['fantasma'] }, 'sabor inexistente'],
      [{ ...line().customIceCream, flavorIds: ['f-out'] }, 'sabor agotado hoy'],
      [{ ...line().customIceCream, toppingIds: ['top_falso'] }, 'topping inexistente'],
      [{ ...line().customIceCream, flavorIds: [] }, 'sin sabores']
    ];
    for (const [custom, label] of badCases) {
      assert.throws(() => quoteOrderItems(HELA, [{ dishId: 'icecream_abc123', quantity: 1, customIceCream: custom }], 'ts-ice-err'),
        (e) => e.code === 'INVALID_DISH_OPTIONS', `helado inválido: ${label}`);
    }
    assert.throws(() => quoteOrderItems(HELA, [{ dishId: 'dish-comun', quantity: 1, customIceCream: line().customIceCream }], 'ts-ice-id'),
      (e) => e.code === 'INVALID_DISH_OPTIONS', 'customIceCream exige id icecream_*');
    // Recargo saneado a nivel plato (dueño): negativo → 0.
    const cleanDish = sanitizeRestaurantPayload({ name: 'H', dishes: [{ name: 'Pistacho', price: 0, iceCreamSurcharge: -30 }] });
    assert.strictEqual(cleanDish.dishes[0].iceCreamSurcharge, 0, 'recargo negativo → 0');
    const cleanDish2 = sanitizeRestaurantPayload({ name: 'H', dishes: [{ name: 'Pistacho', price: 0, iceCreamSurcharge: 80 }] });
    assert.strictEqual(cleanDish2.dishes[0].iceCreamSurcharge, 80, 'recargo válido se preserva');
    console.log('✓ Helado a medida: total autoritativo (tamaño+toppings+recargos), config del dueño, errores honestos');
  }

  // ── 2) Cotización: fuzz seeded (600 órdenes) ──────────────────────────────
  {
    const rng = makeRng(SEED);
    for (let i = 0; i < 600; i++) {
      const lines = randomValidOrder(rng);
      assertQuoteInvariants(lines, `ts-${i}`, `fuzz ${i}`);
    }
  }

  // ── 3) Envío: fijo + fuzz ─────────────────────────────────────────────────
  assert.strictEqual(resolveDeliveryFee(FIXTURE, 'LOCAL', 999), 0, 'LOCAL nunca cobra envío');
  assert.strictEqual(resolveDeliveryFee(FIXTURE, 'DELIVERY', 200), 200, 'fee que matchea zona');
  assert.strictEqual(resolveDeliveryFee(FIXTURE, 'DELIVERY', 350), 350, 'fee que matchea zona 2');
  assert.strictEqual(resolveDeliveryFee({ deliveryZones: [] }, 'DELIVERY', 400), 400, 'sin zonas → confía en lo declarado');
  assert.strictEqual(resolveDeliveryFee({ deliveryZones: [] }, 'DELIVERY', -10), 0, 'declarado negativo → 0');
  assert.throws(() => resolveDeliveryFee(FIXTURE, 'DELIVERY', 999), (e) => e.code === 'INVALID_DELIVERY_FEE', 'fee que no matchea ninguna zona');
  {
    const rng = makeRng(SEED + 1);
    for (let i = 0; i < 300; i++) {
      const mode = rng.maybe(0.5) ? 'DELIVERY' : 'LOCAL';
      const declared = rng.pick([0, 200, 350, 999, -1, 250, 200.5]);
      if (mode === 'LOCAL') {
        assert.strictEqual(resolveDeliveryFee(FIXTURE, mode, declared), 0, `fuzz ${i}: LOCAL → 0`);
      } else if (declared === 200 || declared === 350) {
        assert.strictEqual(resolveDeliveryFee(FIXTURE, mode, declared), declared, `fuzz ${i}: DELIVERY zona conocida`);
      } else {
        assert.throws(() => resolveDeliveryFee(FIXTURE, mode, declared), (e) => e.code === 'INVALID_DELIVERY_FEE', `fuzz ${i}: DELIVERY fee fuera de zonas`);
      }
    }
  }

  // ── 4) Cupones: fijo + fuzz ───────────────────────────────────────────────
  {
    const noCoupon = resolveCouponDiscount({ restaurant: FIXTURE, subtotal: 100, deliveryFee: 350, coupon: null, orderMode: 'DELIVERY' });
    assert.deepStrictEqual(noCoupon, { discount: 0, coupon: null }, 'sin cupón → nada');
    const unknown = resolveCouponDiscount({ restaurant: FIXTURE, subtotal: 100, deliveryFee: 350, coupon: { code: 'XXXX' }, orderMode: 'DELIVERY' });
    assert.deepStrictEqual(unknown, { discount: 0, coupon: null }, 'cupón desconocido no descuenta');
    const ci = resolveCouponDiscount({ restaurant: FIXTURE, subtotal: 100, deliveryFee: 350, coupon: { code: 'promo10' }, orderMode: 'DELIVERY' });
    assert.strictEqual(ci.discount, 10, 'case-insensitive: PROMO10 en minúsculas = 10');
    const clamp = resolveCouponDiscount({ restaurant: FIXTURE, subtotal: 100, deliveryFee: 350, coupon: { code: 'MOCHO200' }, orderMode: 'DELIVERY' });
    assert.strictEqual(clamp.discount, 100, 'percent 200 → clamp a 100 → descuenta el total');
    assert.strictEqual(clamp.coupon.value, 100, 'el valor expuesto queda clampeado');
    const zero = resolveCouponDiscount({ restaurant: FIXTURE, subtotal: 0, deliveryFee: 350, coupon: { code: 'PROMO10' }, orderMode: 'DELIVERY' });
    assert.strictEqual(zero.discount, 0, 'subtotal 0 + percent → 0');
    const freeDeliv = resolveCouponDiscount({ restaurant: FIXTURE, subtotal: 100, deliveryFee: 350, coupon: { code: 'ENVIOFREE' }, orderMode: 'DELIVERY' });
    assert.strictEqual(freeDeliv.discount, 350, 'free_delivery descuenta exactamente el fee');
    const freeLocal = resolveCouponDiscount({ restaurant: FIXTURE, subtotal: 100, deliveryFee: 350, coupon: { code: 'ENVIOFREE' }, orderMode: 'LOCAL' });
    assert.deepStrictEqual(freeLocal, { discount: 0, coupon: null }, 'free_delivery en LOCAL → nada');

    const rng = makeRng(SEED + 2);
    for (let i = 0; i < 400; i++) {
      const subtotal = rng.int(0, 100000) / 100;
      const deliveryFee = rng.int(0, 5000) / 100;
      const orderMode = rng.maybe(0.5) ? 'DELIVERY' : 'LOCAL';
      const code = rng.pick(['PROMO10', 'TODO50', 'MOCHO200', 'ENVIOFREE', 'PROMO10', 'XXXX', '']);
      const out = resolveCouponDiscount({ restaurant: FIXTURE, subtotal, deliveryFee, coupon: { code }, orderMode });
      assert.ok(out.discount >= 0, `fuzz ${i}: descuento nunca negativo`);
      if (!out.coupon) {
        assert.strictEqual(out.discount, 0, `fuzz ${i}: sin cupón válido → 0`);
        continue;
      }
      assert.strictEqual(out.coupon.code.toUpperCase(), code.toUpperCase(), `fuzz ${i}: código devuelto = código pedido (case-insensitive)`);
      if (out.coupon.type === 'percent') {
        assert.ok(out.discount <= subtotal + 1e-9, `fuzz ${i}: percent descuenta ≤ subtotal (${out.discount} vs ${subtotal})`);
        assert.ok(out.coupon.value >= 0 && out.coupon.value <= 100, `fuzz ${i}: value ∈ [0,100]`);
        assert.strictEqual(out.discount, Math.round(subtotal * (out.coupon.value / 100) * 100) / 100, `fuzz ${i}: descuento = subtotal × value/100 redondeado`);
      } else if (out.coupon.type === 'free_delivery') {
        assert.strictEqual(orderMode, 'DELIVERY', `fuzz ${i}: free_delivery solo aparece en DELIVERY`);
        // Ojo: free_delivery descuenta el FEE COMPLETO aun si supera el subtotal
        // (el envío no es un porcentaje del pedido) — invariante honesto.
        assert.strictEqual(out.discount, deliveryFee, `fuzz ${i}: free_delivery = fee`);
      }
    }
  }

  // ── 5) P0 anti mass-assignment: strip privilegiado ────────────────────────
  {
    const malicious = {
      name: 'Local',
      dishes: [{ id: 'd1', name: 'Plato' }],
      subscription: { status: 'pro', plan: 'pro_monthly' },
      userId: 'u-otro',
      id: 'rest-ajeno',
      analytics: { visits: 999, orders: 999 },
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2099-01-01T00:00:00.000Z',
      __proto__: { polluted: true },
      constructor: { prototype: {} },
      prototype: { x: 1 }
    };
    const clean = stripPrivilegedFields(malicious);
    for (const key of PRIVILEGED_FIELDS) {
      assert.ok(!Object.prototype.hasOwnProperty.call(clean, key), `strip quita ${key}`);
    }
    assert.strictEqual(clean.name, 'Local', 'campos benignos sobreviven');
    assert.deepStrictEqual(clean.dishes, malicious.dishes, 'arrays benignos sobreviven');
    assert.strictEqual(malicious.name, 'Local', 'el input NO se muta');

    const rng = makeRng(SEED + 3);
    for (let i = 0; i < 300; i++) {
      const payload = { name: `local-${i}`, city: 'Montevideo' };
      for (const key of PRIVILEGED_FIELDS) {
        if (rng.maybe(0.5)) payload[key] = { evil: true };
      }
      const out = stripPrivilegedFields(payload);
      for (const key of PRIVILEGED_FIELDS) {
        assert.ok(!Object.prototype.hasOwnProperty.call(out, key), `fuzz ${i}: quita ${key}`);
      }
      assert.deepStrictEqual(stripPrivilegedFields(out), out, `fuzz ${i}: idempotente`);
    }

    // No-objeto passthrough sin romper.
    assert.strictEqual(stripPrivilegedFields(null), null);
    assert.strictEqual(stripPrivilegedFields(undefined), undefined);
    assert.strictEqual(stripPrivilegedFields('cadena'), 'cadena');
    assert.strictEqual(stripPrivilegedFields(42), 42);
    assert.deepStrictEqual(stripPrivilegedFields([1, 2]), [1, 2], 'arrays pasan intactos');
  }

  // ── 6) Composición de la ruta: sanitize → strip nunca deja campos P0 ──────
  {
    const payload = {
      name: '  Local Prueba  ',
      bizName: 'Local Prueba SRL',
      slogan: 'El mejor',
      phone: '+59891112222',
      city: 'Montevideo',
      currency: '$',
      theme: 'classic',
      layout: 'classic',
      businessType: 'restaurant',
      scheduleEnabled: true,
      scheduleActiveHours: '12:00-23:00',
      forceClosed: false,
      allowOnlinePayment: false,
      dishes: FIXTURE.dishes.map((d) => ({ ...d })),
      categories: FIXTURE.categories.map((c) => ({ ...c })),
      modifierGroups: JSON.parse(JSON.stringify(FIXTURE.modifierGroups)),
      deliveryZones: JSON.parse(JSON.stringify(FIXTURE.deliveryZones)),
      customCoupons: JSON.parse(JSON.stringify(FIXTURE.customCoupons)),
      // Intento de mass-assignment colado en el payload completo.
      subscription: { status: 'pro', plan: 'pro_monthly' },
      userId: 'u-otro',
      analytics: { visits: 1e9 },
      createdAt: '1999-01-01T00:00:00.000Z',
      updatedAt: '2099-01-01T00:00:00.000Z'
    };
    const safe = stripPrivilegedFields(sanitizeRestaurantPayload(payload));
    for (const key of PRIVILEGED_FIELDS) {
      assert.ok(!Object.prototype.hasOwnProperty.call(safe, key), `composición quita ${key}`);
    }
    assert.strictEqual(safe.name, 'Local Prueba', 'saneo aplicado (trim)');
    assert.strictEqual(safe.scheduleActiveHours, '12:00-23:00', 'horario preservado');
    assert.strictEqual(safe.dishes.length, 3, 'platos completos preservados');

    // Idempotencia del pipeline sobre salida ya limpia (una pasada más no cambia nada).
    const twice = stripPrivilegedFields(sanitizeRestaurantPayload(safe));
    assert.deepStrictEqual(twice, safe, 'sanitize→strip es idempotente sobre su propia salida');
  }

  console.log('✓ Cotización en centavos: 600 fuzz seeded + 8 casos fijos, invariantes de consistencia/no-negatividad');
  console.log('✓ Envío vs zonas: 300 fuzz seeded + fijos (INVALID_DELIVERY_FEE, LOCAL→0, sin zonas→confianza)');
  console.log('✓ Cupones: 400 fuzz seeded + fijos (clamp [0,100], case-insensitive, free_delivery solo DELIVERY)');
  console.log('✓ P0 strip privilegiado: 300 fuzz seeded + composición sanitize→strip idempotente y sin fugas');
  console.log('\n🎉 ¡DINERO EN VERDE: propiedades del dinero + anti mass-assignment como invariante puro!\n');
}

run();