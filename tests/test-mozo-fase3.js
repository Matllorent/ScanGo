/**
 * tests/test-mozo-fase3.js — Comandero Fase 3: el comandero opera el Club (71ª suite).
 * ─────────────────────────────────────────────────────────────────────────────
 * Fase 2 dejó al mozo tomando el pedido en mesa; Fase 3 le da los extras del
 * comensal SIN un solo endpoint nuevo y SIN migración: el server YA procesa
 * `customerPhone` (→ creditOrder), `coupon.code` (→ claim atómico de recupero)
 * y `tipAmount` (→ orders.tip_amount). Es wiring puro de punta a punta:
 *
 *  - El mozo carga teléfono (+ nombre opcional), propina y cupón en la PWA.
 *  - El cupón se valida ANTES con `POST /api/orders/coupon/validate` (público,
 *    sin reclamar) y la copy del veredicto la ESCRIBE el server.
 *  - El 201 es la autoridad: puntos/sellos/descuento/total reales.
 *
 * §1 Módulo puro: sanitizers con PARIDAD REAL contra `normalizePhone` del
 *    servicio de loyalty (corpus compartido — un teléfono válido para el mozo
 *    ES válido para el Club), setters, body shape estable, submittable honesto.
 * §2 Wiring estático: PWA /mozo (inputs + labels a11y + live regions), mozo.js
 *    (validate + veredicto + math espejo del descuento + puntos en el modal),
 *    exports del módulo, CSS, alias npm y contrato openapi.
 * §3 Runtime REAL (server HTTP + store real, cero mocks): turno activado,
 *    pedido del comandero con Club E2E — 201 con `loyalty.credited` + puntos
 *    10+N, ledgers local/global EN SYNC, propina persistida y visible en
 *    /track, cupón custom del dueño con descuento real, cupón de recupero
 *    ajeno → 422 sin quemarse, idempotencia sin doble crédito, teléfono
 *    basura → 201 sin crédito (el server nunca inventa), quote sin propina.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const loyaltyService = require('../api/services/loyalty');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

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

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

async function runTests() {
  const pkg = JSON.parse(read('package.json'));

  // ═══════════════════════════════════════════════════════════════════════════
  // §1 Módulo puro — sanitizers + paridad REAL con el Club
  // ═══════════════════════════════════════════════════════════════════════════
  const C = await import('../public/js/mozo/comandero.js');

  assert.ok(C.GUEST_PHONE_MIN_DIGITS === 7, 'mínimo 7 dígitos (paridad normalizePhone)');
  assert.ok(C.GUEST_PHONE_MAX_DIGITS === 15, 'máximo 15 dígitos (paridad)');
  assert.ok(C.MAX_GUEST_PHONE_LEN === 30 && C.MAX_GUEST_NAME_LEN === 100, 'caps del schema de pedidos');
  assert.ok(C.MAX_COUPON_CODE_LEN === 30 && C.MAX_TIP_AMOUNT === 1000000, 'caps del cupón/propina (schema)');

  // ── Paridad EXACTA sanitizeGuestPhone ↔ loyalty.normalizePhone ────────────
  // El teléfono es la IDENTIDAD del Club: si el mozo puede enviarlo, el server
  // DEBE poder acreditarlo (y viceversa). Corpus determinista compartido.
  const phoneCorpus = [
    ['+598 99 123 456', '59899123456'],
    ['099123456', '099123456'],            // trunk 0 nacional NO se strippea (paridad)
    ['0059899123456', '59899123456'],      // prefijo 00 strip
    ['598-99-123-456', '59899123456'],
    ['(+598) 99 123 456', '59899123456'],
    ['99123456', '99123456'],              // 8 dígitos (corto nacional) → ok
    ['123456', ''],                        // 6 dígitos < 7 → ''
    ['12345678901234567', ''],             // 17 > 15 → ''
    ['', ''],
    [null, ''],
    [undefined, ''],
    ['abc', ''],                           // sin dígitos
    ['abc1234567def', '1234567'],          // el server extrae los mismos dígitos
    ['   +598 (99) 123-4567  ', '598991234567']
  ];
  for (const [raw, expected] of phoneCorpus) {
    const client = C.sanitizeGuestPhone(raw);
    const server = loyaltyService.normalizePhone(raw) || '';
    assert.ok(client === expected, `sanitizeGuestPhone(${JSON.stringify(raw)}) → ${JSON.stringify(expected)}`);
    assert.ok(
      server === expected,
      `PARIDAD con el server: normalizePhone(${JSON.stringify(raw)}) → ${JSON.stringify(expected)}`
    );
  }
  console.log('✓ §1 sanitizeGuestPhone: paridad EXACTA con loyalty.normalizePhone (14 casos)');

  assert.ok(C.sanitizeGuestName('  Lucía  ') === 'Lucía', 'nombre trim');
  assert.ok(C.sanitizeGuestName('  ').length === 0, 'nombre vacío → vacío');
  assert.ok(C.sanitizeGuestName(null) === '' && C.sanitizeGuestName(undefined) === '', 'nombre basura → vacío');
  assert.ok(C.sanitizeGuestName('A'.repeat(150)).length === 100, 'nombre cap 100 (schema)');
  assert.ok(C.sanitizeGuestName('L\u0007uc\u000Bía') === 'L uc ía', 'control chars → espacio colapsado');
  console.log('✓ §1 sanitizeGuestName: trim · cap 100 · basura fuera');

  assert.ok(C.sanitizeCouponCode('  moz10  ') === 'MOZ10', 'cupón trim + uppercase');
  assert.ok(C.sanitizeCouponCode('mo zo 10') === 'MOZO10', 'cupón sin espacios internos');
  assert.ok(C.sanitizeCouponCode('vol-abcd') === 'VOL-ABCD', 'prefijo VOL intacto');
  assert.ok(C.sanitizeCouponCode('X'.repeat(40)).length === 30, 'cupón cap 30 (schema)');
  assert.ok(C.sanitizeCouponCode('') === '' && C.sanitizeCouponCode(null) === '', 'cupón vacío → vacío');
  console.log('✓ §1 sanitizeCouponCode: uppercase · sin espacios · cap 30');

  assert.ok(C.sanitizeTipAmount('2.5') === 2.5, 'tip string numérica');
  assert.ok(C.sanitizeTipAmount(2.567) === 2.57, 'tip redondeo a 2 decimales (cents-safe)');
  assert.ok(C.sanitizeTipAmount(-5) === 0, 'tip negativa → 0 (nunca descuenta)');
  assert.ok(C.sanitizeTipAmount('abc') === 0 && C.sanitizeTipAmount('') === 0, 'tip basura → 0');
  assert.ok(C.sanitizeTipAmount(9999999) === 1000000, 'tip cap 1e6 (schema)');
  assert.ok(C.sanitizeTipAmount(0) === 0, 'tip 0 → 0');
  console.log('✓ §1 sanitizeTipAmount: monto fijo ≥0 · 2 decimales · cap 1e6');

  // ── Setters del borrador ───────────────────────────────────────────────────
  const draft = C.createDraft();
  C.setDraftGuest(draft, { phone: '  +598 99 111 222  ', name: '  Lucía  ' });
  assert.ok(draft.guestPhone === '+598 99 111 222', 'teléfono del draft CRUDO (trim, cap 30) para el bloqueo honesto');
  assert.ok(draft.guestName === 'Lucía', 'nombre ya saneado en el draft');
  C.setDraftGuest(draft, { phone: 'P'.repeat(40) });
  assert.ok(draft.guestPhone.length === 30, 'teléfono cap 30 (schema customerPhone)');
  C.setDraftGuest(draft, { phone: '' });
  assert.ok(draft.guestPhone === '' && draft.guestName === 'Lucía', 'vaciar teléfono no toca el nombre (parcial)');
  assert.deepStrictEqual(
    Object.keys(C.createDraft()),
    ['tableNumber', 'tableLabel', 'note', 'lines', 'guestPhone', 'guestName', 'tipAmount', 'couponCode'],
    'shape del borrador estable (8 campos)'
  );
  C.setDraftTipAmount(draft, '2.5');
  assert.ok(draft.tipAmount === 2.5, 'setDraftTipAmount sanea');
  C.setDraftCoupon(draft, ' moz10 ');
  assert.ok(draft.couponCode === 'MOZ10', 'setDraftCoupon sanea');
  const freshFromNull = C.setDraftGuest(null, { name: 'X' });
  assert.ok(freshFromNull && Array.isArray(freshFromNull.lines), 'setter sobre null → borrador nuevo (sin throw)');
  console.log('✓ §1 setters: parciales · caps del schema · null → borrador nuevo');

  assert.ok(
    C.describeDraftGuest({ guestName: 'Lucía', guestPhone: '+598 99 111 222' }) === 'Lucía · +598 99 111 222',
    'resumen legible nombre · teléfono'
  );
  assert.ok(C.describeDraftGuest({ guestName: '', guestPhone: '99' }) === '99', 'solo teléfono');
  assert.ok(C.describeDraftGuest({}) === '' && C.describeDraftGuest(null) === '', 'sin datos → vacío');
  console.log('✓ §1 describeDraftGuest: "Lucía · +598 99 111 222" · vacío honesto');

  // ── Body con shape estable ────────────────────────────────────────────────
  const fullDraft = C.createDraft();
  C.setDraftTable(fullDraft, { number: '2', label: 'Mesa 2' });
  C.addDraftLine(fullDraft, { dishId: 'dish_burger', dishName: 'Burger', quantity: 1, choices: [] });
  C.setDraftGuest(fullDraft, { phone: '+598 99 111 222', name: 'Lucía' });
  C.setDraftTipAmount(fullDraft, 2.5);
  C.setDraftCoupon(fullDraft, ' MOZO10 ');
  const fullBody = C.buildComanderoBody(fullDraft, { restaurantId: 'rest_abc', utcOffsetMinutes: -180 });
  assert.deepStrictEqual(fullBody, {
    restaurantId: 'rest_abc',
    orderMode: 'LOCAL',
    tableNumber: '2',
    customerName: 'Lucía',
    customerPhone: '59899111222',
    tipAmount: 2.5,
    notes: '',
    items: [{ dishId: 'dish_burger', quantity: 1, note: '', choices: [] }],
    utcOffsetMinutes: -180,
    coupon: { code: 'MOZO10' }
  }, 'body completo: Club + propina + cupón');
  assert.ok(fullBody.coupon && !('type' in fullBody.coupon) && !('value' in fullBody.coupon), 'el client manda SOLO el code (el valor lo recomputa el server)');

  const plainDraft = C.createDraft();
  C.setDraftTable(plainDraft, { number: '1', label: 'Mesa 1' });
  C.addDraftLine(plainDraft, { dishId: 'dish_papas', dishName: 'Papas', quantity: 2, choices: [] });
  const plainBody = C.buildComanderoBody(plainDraft, { restaurantId: 'rest_abc', utcOffsetMinutes: -180 });
  assert.ok(plainBody.customerPhone === '' && plainBody.tipAmount === 0, 'shape estable: teléfono/propina SIEMPRE presentes (no-op)');
  assert.ok(!('coupon' in plainBody), 'sin código no hay objeto cupón');

  const dirtyDraft = C.createDraft();
  C.setDraftTable(dirtyDraft, { number: '3', label: 'Mesa 3' });
  C.addDraftLine(dirtyDraft, { dishId: 'dish_papas', dishName: 'Papas', quantity: 1, choices: [] });
  C.setDraftGuest(dirtyDraft, { phone: '12345', name: '   ' });
  const dirtyBody = C.buildComanderoBody(dirtyDraft, { restaurantId: 'rest_abc' });
  assert.ok(dirtyBody.customerPhone === '', 'teléfono tipeado pero corto → customerPhone "" (el server no acredita basura)');
  assert.ok(dirtyBody.customerName === 'Mesa 3', 'sin nombre válido conserva la etiqueta de mesa');
  console.log('✓ §1 buildComanderoBody: shape estable (phone/tip siempre, cupón solo con código)');

  // ── Submittable honesto ───────────────────────────────────────────────────
  const menuOk = { allowOrders: true, groups: [] };
  const lineDraft = C.createDraft();
  C.setDraftTable(lineDraft, { number: '2', label: 'Mesa 2' });
  C.addDraftLine(lineDraft, { dishId: 'dish_papas', dishName: 'Papas', quantity: 1, choices: [] });
  assert.ok(C.draftIsSubmittable(lineDraft, menuOk).ok === true, 'sin extras → enviable');

  const blockedDraft = JSON.parse(JSON.stringify(lineDraft));
  C.setDraftGuest(blockedDraft, { phone: '12345' });
  const blocked = C.draftIsSubmittable(blockedDraft, menuOk);
  assert.ok(blocked.ok === false, 'teléfono tipeado pero incompleto BLOQUEA el envío');
  assert.ok(/incompleto/.test(blocked.error) && /Corregilo o borralo/.test(blocked.error), 'copy honesta (nunca drop silencioso del Club)');

  const validPhoneDraft = JSON.parse(JSON.stringify(lineDraft));
  C.setDraftGuest(validPhoneDraft, { phone: '+598 99 111 222', name: 'Lucía' });
  assert.ok(C.draftIsSubmittable(validPhoneDraft, menuOk).ok === true, 'teléfono válido → enviable');

  const emptyPhoneDraft = JSON.parse(JSON.stringify(lineDraft));
  assert.ok(C.draftIsSubmittable(emptyPhoneDraft, menuOk).ok === true, 'sin teléfono → enviable (extras TODO opcional)');

  // PUREZA: buildComanderoBody y draftIsSubmittable no mutan el borrador.
  const pureDraft = C.createDraft();
  C.setDraftTable(pureDraft, { number: '2', label: 'Mesa 2' });
  C.addDraftLine(pureDraft, { dishId: 'dish_burger', dishName: 'Burger', quantity: 1, choices: [] });
  C.setDraftGuest(pureDraft, { phone: '+598 99 111 222', name: 'Lucía' });
  C.setDraftTipAmount(pureDraft, 2.5);
  C.setDraftCoupon(pureDraft, 'MOZO10');
  const pureSnapshot = JSON.stringify(pureDraft);
  C.buildComanderoBody(pureDraft, { restaurantId: 'r' });
  C.draftIsSubmittable(pureDraft, menuOk);
  C.describeDraftGuest(pureDraft);
  assert.ok(JSON.stringify(pureDraft) === pureSnapshot, 'PUREZA: ninguna función muta el borrador');
  console.log('✓ §1 submittable: teléfono incompleto bloquea · opcionales ok · PUREZA');

  // ═══════════════════════════════════════════════════════════════════════════
  // §2 Wiring estático — PWA + mozo.js + exports + CSS + alias + contrato
  // ═══════════════════════════════════════════════════════════════════════════
  const mozoHtml = read('public/mozo.html');
  const mozoJs = read('public/js/mozo/mozo.js');
  const mozoCss = read('public/css/mozo.css');
  const openapi = read('openapi.yaml');

  assert.ok(mozoHtml.includes('id="mozoGuestPhone"'), 'HTML: input de teléfono del comensal');
  assert.ok(mozoHtml.includes('id="mozoGuestName"'), 'HTML: input de nombre (opcional)');
  assert.ok(mozoHtml.includes('id="mozoGuestPhoneError"'), 'HTML: error del teléfono');
  assert.ok(mozoHtml.includes('id="mozoDraftCoupon"'), 'HTML: input del cupón');
  assert.ok(mozoHtml.includes('id="mozoCouponCheck"'), 'HTML: botón validar cupón');
  assert.ok(mozoHtml.includes('id="mozoCouponVerdict"'), 'HTML: veredicto del cupón');
  assert.ok(mozoHtml.includes('id="mozoDraftTip"'), 'HTML: input de propina');
  assert.ok(mozoHtml.includes('id="mozoCartExtras"'), 'HTML: extras del comensal en la barra');
  assert.ok(mozoHtml.includes('id="mozoSentLoyalty"'), 'HTML: línea de puntos en el modal de éxito');
  assert.ok(/class="[^"]*mozo-guest-block/.test(mozoHtml), 'bloque del Club identificado en la sección');

  // A11y: labels asociados + live regions.
  assert.ok(/for="mozoGuestPhone"/.test(mozoHtml), 'label for= teléfono');
  assert.ok(/for="mozoGuestName"/.test(mozoHtml), 'label for= nombre');
  assert.ok(/for="mozoDraftCoupon"/.test(mozoHtml), 'label for= cupón');
  assert.ok(/for="mozoDraftTip"/.test(mozoHtml), 'label for= propina');
  assert.ok(/id="mozoGuestPhoneError"[^>]*role="alert"/.test(mozoHtml.replace(/\n\s*/g, ' ')), 'error del teléfono = live region alert');
  assert.ok(/id="mozoCouponVerdict"[^>]*role="status"/.test(mozoHtml.replace(/\n\s*/g, ' ')), 'veredicto del cupón = live region status');

  // Caps del schema en el HTML (paridad de maxlength).
  assert.ok(/maxlength="30"/.test(mozoHtml), 'maxlength 30 (teléfono/cupón)');
  assert.ok(/maxlength="100"/.test(mozoHtml), 'maxlength 100 (nombre)');
  assert.ok(/type="tel"/.test(mozoHtml), 'teclado numérico de teléfono');

  // Cero on*= (CSP script-src-attr 'none') y cero alert/confirm en el flujo.
  assert.ok(!/on(click|change|input|submit|keydown|keyup)=/i.test(mozoHtml), 'mozo.html sin on*=');
  assert.ok(!/alert\(/.test(mozoJs) && !/window\.confirm\(/.test(mozoJs), 'mozo.js sin alert/window.confirm (paréntesis = llamada real)');
  console.log('✓ §2 PWA: 9 ids · labels for= · role alert/status · caps del schema · cero on*=');

  // mozo.js: imports + estado + listeners + endpoint validate + loyalty real.
  for (const fn of ['setDraftGuest', 'setDraftTipAmount', 'setDraftCoupon', 'sanitizeGuestPhone', 'sanitizeCouponCode', 'GUEST_PHONE_MIN_DIGITS']) {
    assert.ok(new RegExp(`[\\s{(]${fn}[,\\s}]`).test(mozoJs), `mozo.js importa ${fn}`);
  }
  assert.ok(/comandero\.couponVerdict/.test(mozoJs), 'estado del veredicto en el runtime');
  assert.ok(/'\/api\/orders\/coupon\/validate'/.test(mozoJs), 'mozo.js valida el cupón contra el endpoint público EXISTENTE');
  assert.ok(/orderMode:\s*'LOCAL'/.test(mozoJs), 'validate con la modalidad del comandero (envío gratis fuera)');
  assert.ok(/data\.message \|\| \(data\.valid === true \? 'Cupón aplicado\.'/.test(mozoJs), 'la copy del veredicto la ESCRIBE el server (fallback client mínimo)');
  // Math espejo del server: percent clamp [0,100] + 2 decimales.
  assert.ok(
    /Math\.round\(\(Number\(subtotal\) \|\| 0\) \* \(value \/ 100\) \* 100\) \/ 100/.test(mozoJs),
    'descuento client espeja la MATH de resolveCouponDiscount (percent, 2 decimales)'
  );
  assert.ok(/loyalty\.credited/.test(mozoJs) && /loyalty\.points/.test(mozoJs), 'el modal muestra el crédito REAL del 201 (no lo inventa el client)');
  assert.ok(/syncComanderoGuestInputs/.test(mozoJs), 'reset sincroniza inputs del Club');
  assert.ok(/aria-invalid/.test(mozoJs), 'teléfono inválido marcado con aria-invalid (a11y dinámico)');
  assert.ok(/setGuestPhoneError\(''\)/.test(mozoJs), 'limpiar el error quita aria-invalid');
  console.log('✓ §2 mozo.js: validate + veredicto server-copy + math espejo + loyalty del 201');

  // Exports del módulo puro (los que consume mozo.js).
  const comanderoSrc = read('public/js/mozo/comandero.js');
  for (const name of ['sanitizeGuestPhone', 'sanitizeGuestName', 'sanitizeCouponCode', 'sanitizeTipAmount', 'setDraftGuest', 'setDraftTipAmount', 'setDraftCoupon', 'describeDraftGuest', 'GUEST_PHONE_MIN_DIGITS']) {
    assert.ok(comanderoSrc.includes(`export function ${name}`) || comanderoSrc.includes(`export const ${name}`), `comandero.js exporta ${name}`);
  }
  console.log('✓ §2 módulo puro: exports Fase 3 listados');

  // CSS: bloque del Club + veredicto + barra + modal.
  for (const cls of ['.mozo-guest-block', '.mozo-guest-grid', '.mozo-guest-phone-error', '.mozo-coupon-verdict', '.mozo-coupon-verdict.is-ok', '.mozo-coupon-verdict.is-err', '.mozo-cart-extras', '.mozo-sent-loyalty']) {
    assert.ok(mozoCss.includes(cls), `mozo.css estiliza ${cls}`);
  }
  assert.ok(/\[hidden\]\s*\{\s*display:\s*none\s*!\s*important/.test(mozoCss), 'guard [hidden] global intacto (los nuevos respetan hidden)');
  console.log('✓ §2 CSS: bloque Club + veredicto + barra + modal + guard hidden');

  // Alias npm + cadena de la suite completa (71ª).
  assert.ok(pkg.scripts['test:mozo-fase3'] === 'node tests/test-mozo-fase3.js', 'alias test:mozo-fase3');
  assert.ok(pkg.scripts['test:core'].includes('node tests/test-mozo-fase3.js'), 'test:core incluye la 71ª suite');

  // Contrato: el schema del pedido documenta los extras del Club.
  assert.ok(/customerPhone:/.test(openapi), 'openapi documenta customerPhone');
  assert.ok(/tipAmount:/.test(openapi), 'openapi documenta tipAmount');
  assert.ok(/COUPON_NOT_FOR_THIS_PHONE/.test(openapi), 'openapi documenta el error del cupón ajeno');
  console.log('✓ §2 contrato openapi: customerPhone + tipAmount + cupón de recupero');

  // ═══════════════════════════════════════════════════════════════════════════
  // §3 Runtime REAL — server HTTP + store real + Club de punta a punta
  // ═══════════════════════════════════════════════════════════════════════════
  const stamp = Date.now();
  const ownerA = await db.createUser({
    email: `mozo-fase3-${stamp}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  await db.flushCloudWrites();

  const restA = await db.saveRestaurant(ownerA.id, {
    name: 'Comandero Club Local',
    bizName: 'Comandero Club Local',
    slug: `mozo-fase3-${stamp}`,
    phone: '59899333333',
    currency: 'USD',
    tableCount: 4,
    allowMenuOrders: true,
    loyaltyConfig: { enabled: true, pointsPerOrder: 10, pointsPerCurrency: 1 },
    customCoupons: [{ code: 'MOZO10', type: 'percent', value: 10, label: '10% mozo' }],
    categories: [{ id: 'cat1', name: 'Cocina' }],
    dishes: [
      { id: 'dish_burger', name: 'Burger', price: 10, categoryId: 'cat1' },
      { id: 'dish_papas', name: 'Papas', price: 5, categoryId: 'cat1' }
    ]
  });
  const tokenOwnerA = jwt.sign({ userId: ownerA.id }, JWT_SECRET, { expiresIn: '1h' });
  const authA = authHeaders(tokenOwnerA);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  const ledgerFile = path.join(process.cwd(), 'data', 'loyalty_ledger.json');
  const readLedger = () => {
    try {
      return JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    } catch (e) {
      return [];
    }
  };

  try {
    // 1) Carta pública con el catálogo del dueño (validate lo resuelve primero).
    let out = await requestJson(base, `/api/menu/${restA.slug}`);
    assert.ok(out.response.status === 200, 'carta pública 200');
    const publicMenu = out.body && out.body.restaurant;
    assert.ok(Array.isArray(publicMenu.dishes) && publicMenu.dishes.length === 2, 'carta con los platos del fixture');
    assert.ok(publicMenu.allowMenuOrders === true, 'pedidos habilitados');

    // 2) Equipo + turno real (mismo circuito de la Fase 1).
    out = await requestJson(base, '/api/studio/staff', {
      method: 'POST', headers: authA, body: JSON.stringify({ name: 'Ana Mozo', role: 'waiter' })
    });
    assert.ok(out.response.status === 201, 'alta de mozo → 201');
    const ana = out.body.staff;
    const anaCredential = out.body.credential;

    out = await requestJson(base, '/api/studio/staff/tables', {
      method: 'PATCH', headers: authA, body: JSON.stringify({ assignments: { '2': ana.id } })
    });
    assert.ok(out.response.status === 200, 'mesa 2 asignada a Ana');

    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ restaurantId: restA.id, staffId: ana.id, secret: anaCredential })
    });
    assert.ok(out.response.status === 200, 'turno de Ana activado');
    const anaToken = out.body.data.token;

    // Estado PREVIO del perfil por teléfono (residuo de corridas previas no
    // contamina: la aserción es por DELTA — el Club es keyed por teléfono).
    const customersFile = path.join(process.cwd(), 'data', 'customer_profiles.json');
    const readProfiles = () => {
      try {
        return JSON.parse(fs.readFileSync(customersFile, 'utf8'));
      } catch (e) {
        return [];
      }
    };
    const profileBefore = readProfiles().find((c) => c && c.phone === '59899111222');
    const globalPointsBefore = profileBefore ? Number(profileBefore.globalPoints) || 0 : 0;
    const globalVisitsBefore = profileBefore ? Number(profileBefore.globalVisits) || 0 : 0;

    // 3) Quote con propina en el body: la propina NO cotiza platos.
    const quoteDraft = C.createDraft();
    C.setDraftTable(quoteDraft, { number: '2', label: 'Mesa 2' });
    C.addDraftLine(quoteDraft, { dishId: 'dish_burger', dishName: 'Burger', quantity: 1, choices: [] });
    C.setDraftTipAmount(quoteDraft, 2.5);
    const quoteBody = C.buildComanderoBody(quoteDraft, { restaurantId: restA.id, utcOffsetMinutes: -180 });
    out = await requestJson(base, '/api/orders/quote', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(quoteBody) });
    assert.ok(out.response.status === 200, 'quote 200 con propina en el body');
    assert.ok(Number(out.body.data.amount) === 10, 'quote = PLATOS (la propina no cotiza)');

    // 4) Validate público del cupón custom del dueño (sin reclamar).
    out = await requestJson(base, '/api/orders/coupon/validate', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ restaurantId: restA.id, code: 'MOZO10', phone: '59899111222', orderMode: 'LOCAL' })
    });
    assert.ok(out.response.status === 200, 'validate 200');
    assert.ok(out.body.data.valid === true, 'cupón custom del dueño válido');
    assert.ok(out.body.data.coupon.code === 'MOZO10', 'veredicto con el cupón');
    assert.ok(out.body.data.coupon.value === 10, '10% OFF');
    out = await requestJson(base, '/api/orders/coupon/validate', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ restaurantId: restA.id, code: 'MOZO10', phone: '', orderMode: 'LOCAL' })
    });
    assert.ok(out.body.data.valid === true, 'validar SIN teléfono también pasa (custom no exige identidad)');

    // 5) Happy path E2E: burger $10 + propina 2.5 + MOZO10 (10%) + Club.
    const sendDraft = C.createDraft();
    C.setDraftTable(sendDraft, { number: '2', label: 'Mesa 2' });
    C.addDraftLine(sendDraft, { dishId: 'dish_burger', dishName: 'Burger', quantity: 1, choices: [] });
    C.setDraftGuest(sendDraft, { phone: '+598 99 111 222', name: 'Lucía' });
    C.setDraftTipAmount(sendDraft, 2.5);
    C.setDraftCoupon(sendDraft, 'MOZO10');
    const sendBody = C.buildComanderoBody(sendDraft, { restaurantId: restA.id, utcOffsetMinutes: -180 });
    const idemKey = `m3_${stamp}_a`;
    out = await requestJson(base, '/api/orders', {
      method: 'POST',
      headers: { ...jsonHeaders(), Authorization: `Bearer ${anaToken}`, 'Idempotency-Key': idemKey },
      body: JSON.stringify(sendBody)
    });
    assert.ok(out.response.status === 201, 'pedido del comandero con Club → 201');
    const order = out.body.data;
    assert.ok(order.source === 'staff', 'atribución de la sesión');
    assert.ok(order.waiter_id === ana.id, 'waiter_id de la sesión');
    assert.ok(order.table_id === '2', 'table_id de la mesa');
    assert.ok(order.customer_name === 'Lucía', 'nombre del comensal gana sobre "Mesa 2"');
    assert.ok(order.customer_phone === '59899111222', 'teléfono NORMALIZADO (identidad del Club)');
    assert.ok(Number(order.amount) === 10, 'amount = PLATOS (analytics intacto)');
    assert.ok(Number(order.discount_amount) === 1, 'MOZO10 10% → descuento $1 real');
    assert.ok(Number(order.tip_amount) === 2.5, 'propina persistida aparte');
    assert.ok(Number(order.total) === 11.5, 'total canónico = 10 − 1 + 2.5');
    assert.ok(order.loyalty && order.loyalty.credited === true, 'el 201 informa el crédito del Club');
    assert.ok(Number(order.loyalty.points) === 20, 'puntos = 10 base + $10 × 1 = 20');
    assert.ok(Number(order.loyalty.stamps) > 0, 'sello automático');
    assert.ok(order.trackingToken, 'tracking token para el comensal');

    // 6) Club persistido: perfil por teléfono E.164 + red global (por DELTA).
    const profileAfter = readProfiles().find((c) => c && c.phone === '59899111222');
    assert.ok(profileAfter, 'perfil del Club creado con el teléfono del comandero');
    assert.ok(profileAfter.name === 'Lucía', 'perfil con el nombre del mozo');
    assert.ok(
      Number(profileAfter.globalPoints) === globalPointsBefore + 20,
      'red global: +20 pts sobre el estado previo'
    );
    assert.ok(
      Number(profileAfter.globalVisits) === globalVisitsBefore + 1,
      'visita global: +1 sobre el estado previo'
    );

    // 7) Ledgers EN SYNC: UNA entrada kind:order + UNA kind:order_global.
    let ledgerOrder = readLedger().filter((e) => e && e.refId === order.id);
    assert.ok(ledgerOrder.length === 2, '2 entradas de ledger (order + order_global)');
    assert.deepStrictEqual(ledgerOrder.map((e) => e.kind).sort(), ['order', 'order_global'], 'kinds en sync');
    for (const entry of ledgerOrder) {
      assert.ok(Number(entry.pointsDelta) === 20, 'misma pointsDelta en ambos ledgers');
      if (entry.kind === 'order') {
        assert.ok(Number(entry.stampsDelta) === 1, 'sello en el ledger LOCAL');
        assert.ok(entry.restaurantId === restA.id, 'ledger local con tenant');
      } else {
        assert.ok(Number(entry.stampsDelta) === 0, 'los sellos son POR LOCAL: el global no lleva sello');
        assert.ok(entry.restaurantId == null, 'ledger global cross-restaurant');
      }
    }

    // 8) Idempotencia: el retry con la MISMA clave no duplica crédito.
    out = await requestJson(base, '/api/orders', {
      method: 'POST',
      headers: { ...jsonHeaders(), Authorization: `Bearer ${anaToken}`, 'Idempotency-Key': idemKey },
      body: JSON.stringify(sendBody)
    });
    assert.ok(out.response.status === 200 || out.response.status === 201, 'retry idempotente');
    assert.ok(out.body.data.id === order.id, 'misma clave → MISMO pedido');
    ledgerOrder = readLedger().filter((e) => e && e.refId === order.id);
    assert.ok(ledgerOrder.length === 2, 'ledgers SIN duplicar tras el retry (already_credited)');

    // 9) Seguimiento del comensal: propina + descuento + total, SIN PII.
    out = await requestJson(base, `/api/orders/track/${order.trackingToken}`);
    assert.ok(out.response.status === 200, 'track 200');
    assert.ok(Number(out.body.data.tip) === 2.5, 'track expone la propina');
    assert.ok(Number(out.body.data.total) === 11.5, 'track expone el total canónico');
    assert.ok(Number(out.body.data.subtotal) === 10, 'track expone el subtotal de platos');
    assert.ok(Number(out.body.data.discount) === 1, 'track expone el descuento');
    assert.ok(!('customer_phone' in out.body.data) && !('customerPhone' in out.body.data), 'track SIN PII');

    // 10) Cupón de recupero AJENO: el mozo tipea un código ligado a OTRO teléfono.
    const couponA = await loyaltyService.createWinbackCoupon({
      restaurantId: restA.id,
      discountType: 'percent',
      discountValue: 15,
      boundPhone: '+598 99 444 555'
    });
    assert.ok(couponA && couponA.code, 'cupón de recupero creado con boundPhone');
    out = await requestJson(base, '/api/orders/coupon/validate', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ restaurantId: restA.id, code: couponA.code, phone: '59899111222', orderMode: 'LOCAL' })
    });
    assert.ok(out.body.data.valid === false, 'cupón de otro teléfono → inválido');
    assert.ok(out.body.data.reason === 'NOT_FOR_THIS_PHONE', 'veredicto honesto');

    const wrongDraft = C.createDraft();
    C.setDraftTable(wrongDraft, { number: '2', label: 'Mesa 2' });
    C.addDraftLine(wrongDraft, { dishId: 'dish_papas', dishName: 'Papas', quantity: 1, choices: [] });
    C.setDraftGuest(wrongDraft, { phone: '+598 99 111 222' });
    C.setDraftCoupon(wrongDraft, couponA.code);
    out = await requestJson(base, '/api/orders', {
      method: 'POST',
      headers: { ...jsonHeaders(), Authorization: `Bearer ${anaToken}`, 'Idempotency-Key': `m3_${stamp}_b` },
      body: JSON.stringify(C.buildComanderoBody(wrongDraft, { restaurantId: restA.id, utcOffsetMinutes: -180 }))
    });
    assert.ok(out.response.status === 422, 'cupón ajeno → 422 (nunca cobra el total en silencio)');
    assert.ok(out.body.code === 'COUPON_NOT_FOR_THIS_PHONE', 'código de error honesto');
    const liveRows = await loyaltyService.listRecoveryCoupons(restA.id);
    const liveRow = (Array.isArray(liveRows) ? liveRows : []).find((c) => c && c.code === couponA.code);
    assert.ok(liveRow && !liveRow.usedAt, 'el cupón ajeno SIGUE live (no se quemó por el intento)');

    // 11) Teléfono basura en el body: 201 SIN loyalty (el server nunca inventa).
    const garbageDraft = C.createDraft();
    C.setDraftTable(garbageDraft, { number: '2', label: 'Mesa 2' });
    C.addDraftLine(garbageDraft, { dishId: 'dish_papas', dishName: 'Papas', quantity: 2, choices: [] });
    C.setDraftGuest(garbageDraft, { phone: '12345' }); // el client lo bloquea; vía API llega ''
    const garbageBody = C.buildComanderoBody(garbageDraft, { restaurantId: restA.id, utcOffsetMinutes: -180 });
    assert.ok(garbageBody.customerPhone === '', 'body saneado sin teléfono');
    out = await requestJson(base, '/api/orders', {
      method: 'POST',
      headers: { ...jsonHeaders(), Authorization: `Bearer ${anaToken}`, 'Idempotency-Key': `m3_${stamp}_c` },
      body: JSON.stringify(garbageBody)
    });
    assert.ok(out.response.status === 201, 'pedido sin teléfono → 201 igual');
    assert.ok(!('loyalty' in out.body.data), 'SIN loyalty (no_phone → sin crédito, sin promesa)');
    assert.ok(Number(out.body.data.tip_amount) === 0, 'sin propina → 0');

    console.log('✓ §3 Runtime: 201 con loyalty 20pts + ledgers en sync + idempotencia + cupón ajeno sin quemar');
  } finally {
    await server.close();
    // Limpieza best-effort (el guard de npm test purga de todas formas).
    try { await db.deleteRestaurantData(ownerA.id, restA.id); } catch (e) {}
  }

  console.log('✓ Comandero Fase 3 (el comandero opera el Club): puro + wiring + runtime completo');
}

runTests().catch((err) => {
  console.error('✗ FALLO test-mozo-fase3:', err && err.message ? err.message : err);
  if (err && err.stack) console.error(err.stack);
  process.exit(1);
});
