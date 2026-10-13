const assert = require('assert');
const fs = require('fs');
const path = require('path');

/**
 * Checklist de "puesta en marcha" del Studio (palanca de activación).
 *
 * El cálculo del progreso es una función PURA
 * (public/js/studio/onboardingChecklist.js) derivada del estado REAL del local.
 * Acá se valida contra fixtures (specification by example) + que el HTML/CSS/
 * Studio lo cableen sin on*= (CSP script-src-attr 'none') y con DOM API
 * (cero innerHTML con data). No toca data/ ni la red.
 */

console.log('🧪 Puesta en marcha: checklist de activación (puro + wiring)...');

const ON_ATTR = /\son(?:click|change|input|submit|error|load|mouseover|mouseout|keydown|focus|blur)\s*=/i;

// DOM mínimo simulado (sin jsdom): ejerce el render REAL de la lista de pasos
// en Node. `textContent` setter limpia hijos (como el DOM de verdad cuando se
// hace `list.textContent = ''`).
function makeEl(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    type: '',
    style: {},
    children: [],
    attrs: {},
    _text: '',
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    }
  };
  Object.defineProperty(el, 'textContent', {
    get() {
      return this._text;
    },
    set(v) {
      this._text = String(v);
      this.children = [];
    }
  });
  return el;
}

function installFakeDom(ids) {
  const registry = {};
  for (const id of ids) registry[id] = makeEl('div');
  const store = {};
  globalThis.document = {
    getElementById: (id) => registry[id] || null,
    createElement: (tag) => makeEl(tag)
  };
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    }
  };
  return registry;
}

async function run() {
  const mod = await import('../public/js/studio/onboardingChecklist.js');

  // ── 1) Restaurante vacío → 0 de 6 ────────────────────────────────────
  const empty = mod.computeOnboardingProgress({});
  assert.strictEqual(empty.total, 6, 'el checklist tiene 6 pasos');
  assert.strictEqual(empty.done, 0, 'un local vacío no completó nada');
  assert.strictEqual(empty.percent, 0, 'progreso 0%');
  assert.strictEqual(empty.complete, false, 'no está completo');
  assert.ok(empty.steps.every((s) => s.done === false), 'todos los pasos pendientes');

  // Nulidades no explotan
  assert.strictEqual(mod.computeOnboardingProgress(null).done, 0, 'restaurante nulo no lanza y da 0');

  // Forma de cada paso + pestañas válidas (las que existen como tab-pane)
  const VALID_TABS = new Set(['local', 'dishes', 'theme', 'delivery', 'qr', 'stats', 'branches', 'reviews', 'notifications', 'analytics', 'seo', 'coupons']);
  for (const step of empty.steps) {
    assert.ok(typeof step.id === 'string' && step.id, 'paso con id');
    assert.ok(typeof step.label === 'string' && step.label, `paso ${step.id} con label`);
    assert.ok(typeof step.hint === 'string' && step.hint, `paso ${step.id} con hint`);
    assert.ok(VALID_TABS.has(step.tab), `paso ${step.id} apunta a una pestaña real (${step.tab})`);
    assert.strictEqual(typeof step.done, 'boolean', `paso ${step.id} con done booleano`);
  }
  assert.strictEqual(new Set(empty.steps.map((s) => s.id)).size, empty.steps.length, 'ids de paso únicos');
  console.log('✓ Restaurante vacío: 6 pasos, 0%, pestañas válidas y forma correcta');

  // ── 2) Local completo → 6 de 6, 100% ─────────────────────────────────
  const full = mod.computeOnboardingProgress({
    logoUrl: 'https://cdn/x.png',
    phone: '+598 91 234 567',
    categories: [{ id: 'c1', name: 'Principales' }],
    dishes: [
      { id: 'd1', name: 'A', photoUrl: 'https://cdn/a.jpg' },
      { id: 'd2', name: 'B' },
      { id: 'd3', name: 'C' }
    ],
    scheduleEnabled: true,
    scheduleActiveHours: '11:30-23:30'
  });
  assert.strictEqual(full.done, 6, 'local completo → 6/6');
  assert.strictEqual(full.percent, 100, 'progreso 100%');
  assert.strictEqual(full.complete, true, 'complete true');
  console.log('✓ Local completo: 6/6 (100%, complete=true)');

  // ── 3) Tabla de bordes por paso (specification-by-example) ───────────
  const stepOf = (r, id) => mod.computeOnboardingProgress(r).steps.find((s) => s.id === id);

  assert.strictEqual(stepOf({ logoUrl: 'x' }, 'brand').done, true, 'logo desbloquea "marca"');
  assert.strictEqual(stepOf({ bannerUrl: 'x' }, 'brand').done, true, 'portada desbloquea "marca"');
  assert.strictEqual(stepOf({}, 'brand').done, false, 'sin marca pendiente');

  assert.strictEqual(stepOf({ phone: '59891234567' }, 'phone').done, true, '11 dígitos → ok');
  assert.strictEqual(stepOf({ phone: '+598 91 234-567' }, 'phone').done, true, 'signos y espacios se ignoran');
  assert.strictEqual(stepOf({ phone: '12345' }, 'phone').done, false, 'menos de 8 dígitos → pendiente');
  assert.strictEqual(stepOf({}, 'phone').done, false, 'vacío → pendiente');

  assert.strictEqual(stepOf({ categories: [{ id: 'c1' }] }, 'categories').done, true, '1 categoría completa');
  assert.strictEqual(stepOf({ categories: [] }, 'categories').done, false, '0 categorías pendiente');

  const dishes = (n) => Array.from({ length: n }, (_, i) => ({ id: 'd' + i }));
  assert.strictEqual(stepOf({ dishes: dishes(2) }, 'dishes').done, false, '2 platos pendiente');
  assert.strictEqual(stepOf({ dishes: dishes(3) }, 'dishes').done, true, '3 platos completa');

  assert.strictEqual(stepOf({ dishes: [{ id: 'd1', imageUrl: 'x' }] }, 'photos').done, true, 'imageUrl cuenta como foto');
  assert.strictEqual(stepOf({ dishes: [{ id: 'd1', image: 'x' }] }, 'photos').done, true, 'image cuenta como foto');
  assert.strictEqual(stepOf({ dishes: [{ id: 'd1' }, { id: 'd2' }] }, 'photos').done, false, 'sin fotos pendiente');

  assert.strictEqual(stepOf({ scheduleEnabled: true, scheduleActiveHours: '11:30-15:30' }, 'schedule').done, true, 'horario válido + activo');
  assert.strictEqual(stepOf({ scheduleEnabled: true, scheduleActiveHours: 'nope' }, 'schedule').done, false, 'rango inválido pendiente');
  assert.strictEqual(stepOf({ scheduleEnabled: false, scheduleActiveHours: '11:30-15:30' }, 'schedule').done, false, 'horario desactivado pendiente');
  console.log('✓ Bordes por paso: marca, WhatsApp, categorías, platos, fotos y horario');

  // ── 4) Coherencia de la API ──────────────────────────────────────────
  const sample = { categories: [{ id: 'a' }] };
  assert.deepStrictEqual(mod.computeOnboardingSteps(sample), mod.computeOnboardingProgress(sample).steps, 'steps coherentes');
  assert.strictEqual(typeof mod.ONBOARDING_DISMISS_KEY, 'string', 'expone la clave de descarte');
  assert.strictEqual(typeof mod.renderOnboardingChecklist, 'function', 'expone render');
  assert.strictEqual(typeof mod.dismissOnboarding, 'function', 'expone dismiss');
  console.log('✓ API del módulo (steps/progreso/clave/render/dismiss) coherente');

  // ── 4b) Regla pura de visibilidad (completo / descartado / suprimido) ─
  const fullR = {
    logoUrl: 'x',
    phone: '59891234567',
    categories: [{ id: 'c' }],
    dishes: [{ id: 'd1', photoUrl: 'x' }, { id: 'd2' }, { id: 'd3' }],
    scheduleEnabled: true,
    scheduleActiveHours: '10:00-20:00'
  };
  assert.strictEqual(mod.shouldShowOnboarding({}, {}), true, 'local incompleto → se muestra');
  assert.strictEqual(mod.shouldShowOnboarding(fullR, {}), false, 'local completo → oculto');
  assert.strictEqual(mod.shouldShowOnboarding({}, { suppressed: true }), false, 'modo demo (suprimido) → oculto');
  assert.strictEqual(mod.shouldShowOnboarding({}, { dismissed: true }), false, 'descartado por el dueño → oculto');
  assert.strictEqual(mod.shouldShowOnboarding(fullR, { suppressed: true, dismissed: true }), false, 'completo y suprimido → oculto');
  assert.strictEqual(typeof mod.setOnboardingSuppressed, 'function', 'expone el setter de supresión');
  console.log('✓ Visibilidad pura: se muestra solo si falta algo y no está descartado ni suprimido');

  // ── 5) Wiring: HTML + CSS + Studio, sin on*= ─────────────────────────
  const html = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  assert.ok(html.includes('id="onboardingChecklist"'), 'studio.html tiene el contenedor del checklist');
  assert.ok(html.includes('id="onboardingSteps"'), 'studio.html tiene la lista de pasos');
  assert.ok(html.includes('data-js-click="dismissOnboardingChecklist"'), 'el botón de descarte usa data-js-click');
  assert.ok(!ON_ATTR.test(html), 'studio.html sin atributos on*=');

  const css = fs.readFileSync(path.join(__dirname, '../public/css/studio.css'), 'utf8');
  for (const cls of ['.onboarding-checklist', '.onboarding-bar', '.onboarding-step', '.onboarding-step-go']) {
    assert.ok(css.includes(cls), `studio.css define ${cls}`);
  }

  const studioJs = fs.readFileSync(path.join(__dirname, '../public/js/studio.js'), 'utf8');
  assert.ok(studioJs.includes("from './studio/onboardingChecklist.js'"), 'studio.js importa el módulo');
  assert.ok(studioJs.includes('onboardGoToStep'), 'studio.js navega al paso pendiente');
  assert.ok(studioJs.includes('setOnboardingSuppressedMod('), 'studio.js registra la supresión del modo demo');
  assert.ok(/renderOnboardingMod\(restaurant\)/.test(studioJs), 'studio.js llama al render tras cargar');

  const js = fs.readFileSync(path.join(__dirname, '../public/js/studio/onboardingChecklist.js'), 'utf8');
  assert.ok(!ON_ATTR.test(js), 'el módulo no usa atributos on*=');
  assert.ok(!/\.innerHTML\s*=/.test(js), 'el módulo no usa innerHTML con data');
  assert.ok(js.includes('data-js-click'), 'el módulo crea los botones con data-js-click');
  console.log('✓ Wiring HTML/CSS/Studio sin on* ni innerHTML con data');

  // ── 6) Render REAL con DOM simulado (contador, barra, botones Ir, ocultado) ─
  const dom = installFakeDom(['onboardingChecklist', 'onboardingCount', 'onboardingPercent', 'onboardingBar', 'onboardingSteps']);

  mod.renderOnboardingChecklist({ categories: [{ id: 'c1' }] });
  assert.strictEqual(dom.onboardingChecklist.style.display, '', 'incompleto → visible');
  assert.strictEqual(dom.onboardingCount.textContent, '1 de 6', 'contador "X de Y"');
  assert.strictEqual(dom.onboardingPercent.textContent, '17%', 'porcentaje redondeado (1/6)');
  assert.strictEqual(dom.onboardingBar.style.width, '17%', 'barra proporcional');
  assert.strictEqual(dom.onboardingSteps.children.length, 6, 'una fila por paso');
  const pendingRows = dom.onboardingSteps.children.filter(
    (li) => /onboarding-step\b/.test(li.className) && !/\bdone\b/.test(li.className)
  );
  assert.strictEqual(pendingRows.length, 5, '5 pasos pendientes');
  const goBtn = pendingRows[0].children.find((n) => n.className === 'onboarding-step-go');
  assert.ok(
    goBtn && goBtn.getAttribute('data-js-click') === 'onboardGoToStep|local',
    'el botón Ir del 1er pendiente (marca) navega a "local"'
  );
  const doneRow = dom.onboardingSteps.children.find((li) => /\bdone\b/.test(li.className));
  assert.ok(doneRow && !doneRow.children.some((n) => n.className === 'onboarding-step-go'), 'un paso hecho no tiene botón Ir');
  console.log('✓ Render DOM: contador, barra, botones "Ir →" y fila hecha sin botón');

  // Supresión (modo demo) oculta aunque falten pasos
  mod.setOnboardingSuppressed(() => true);
  mod.renderOnboardingChecklist({ categories: [{ id: 'c1' }] });
  assert.strictEqual(dom.onboardingChecklist.style.display, 'none', 'suprimido (demo) → oculto');
  mod.setOnboardingSuppressed(null);

  // Local completo → oculto
  mod.renderOnboardingChecklist(fullR);
  assert.strictEqual(dom.onboardingChecklist.style.display, 'none', 'completo → oculto');

  // Descarte del dueño: persiste y oculta
  mod.renderOnboardingChecklist({ categories: [{ id: 'c1' }] });
  assert.strictEqual(dom.onboardingChecklist.style.display, '', 'vuelve a mostrarse mientras falte algo');
  mod.dismissOnboarding();
  assert.strictEqual(dom.onboardingChecklist.style.display, 'none', 'descartado → oculto');
  assert.strictEqual(globalThis.localStorage.getItem(mod.ONBOARDING_DISMISS_KEY), '1', 'el descarte persiste en localStorage');
  console.log('✓ Render DOM: supresión demo, local completo y descarte ocultan el checklist');

  console.log('\n🎉 ¡PUESTA EN MARCHA EN VERDE: checklist puro + wiring CSP-safe!\n');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
