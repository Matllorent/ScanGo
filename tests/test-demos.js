/**
 * tests/test-demos.js
 * ───────────────────
 * Demos navegables por rubro + vitrina en Studio.
 *
 * Cubre:
 *  1. GET /api/demos → 4 metadatos (tipo, slug, nombre).
 *  2. GET /api/demos/:type → plantilla completa por rubro, con carta real
 *     (categorías + platos con id) y flags del vertical (heladería: wizard,
 *     perfumería: catálogo, eventos: itinerario futuro habilitado).
 *  3. Tipo inválido → 404.
 *  4. GET /api/menu/demo-* → 200 público con `isDemo: true`, SIN userId
 *     interno, y con weddingItinerary/neonAccent expuestos.
 *  5. GET /m/demo-* → 200 HTML con CSP estricta del menú público.
 *  6. openapi.yaml documenta /api/demos y /api/demos/{type}.
 *  7. Landing enlaza las 4 demos (ver menú + editar en Studio) y Studio trae
 *     el banner de modo demo con handlers data-js-* (cero on*=).
 *  8. El catálogo es determinista y devuelve copias frescas (sin aliasing).
 *  9. Analytics de una demo: 200 no-op (`{demo:true}`, sin persistir) en vez del
 *     404 ruidoso; un slug desconocido real sigue siendo 404.
 *  10. Demo vitrina: probador de temas en vivo en /m/demo-* (solo demos,
 *     lockdown por rubro), editor del Studio bloqueado salvo tema, y nombres
 *     cortos en el selector de estética.
 *
 * Cero mocks: server HTTP real + catálogo in-memory (sin data/*.json).
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const app = require('../api/index');
const { getDemoRestaurant, listDemoRestaurants } = require('../api/utils/demoRestaurants');

const ROOT = path.join(__dirname, '..');

async function runTests() {
  console.log('🧪 Demos por rubro + edición en Studio...');

  // ── 8) Catálogo puro: determinista y sin aliasing ──────────────────────
  const first = getDemoRestaurant('heladeria');
  const second = getDemoRestaurant('demo-heladeria');
  assert.deepStrictEqual(first, second, 'tipo y slug resuelven la misma demo');
  assert.strictEqual(getDemoRestaurant('perfumeria').businessType, 'perfumery', 'alias perfumeria → perfumery');
  assert.strictEqual(getDemoRestaurant('no-existe'), null, 'tipo inválido → null');
  first.dishes.push({ id: 'dish_trampa' });
  first.name = 'MUTADO';
  const fresh = getDemoRestaurant('heladeria');
  assert.ok(!fresh.dishes.some(d => d.id === 'dish_trampa'), 'cada llamada devuelve copia fresca (sin aliasing)');
  assert.notStrictEqual(fresh.name, 'MUTADO', 'la mutación no contamina el catálogo');
  console.log('✓ Catálogo determinista, con alias y sin aliasing');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const base = `http://localhost:${port}`;

    // ── 1) Lista de demos ────────────────────────────────────────────────
    const listRes = await fetch(`${base}/api/demos`);
    assert.strictEqual(listRes.status, 200, 'GET /api/demos → 200');
    const listBody = await listRes.json();
    assert.ok(Array.isArray(listBody.demos), 'responde { demos: [] }');
    assert.strictEqual(listBody.demos.length, 4, 'exactamente 4 demos');
    const byType = Object.fromEntries(listBody.demos.map(d => [d.type, d]));
    assert.strictEqual(byType.restaurant.slug, 'demo-restaurante', 'slug restaurante');
    assert.strictEqual(byType.heladeria.slug, 'demo-heladeria', 'slug heladería');
    assert.strictEqual(byType.perfumery.slug, 'demo-perfumeria', 'slug perfumería');
    assert.strictEqual(byType.events.slug, 'demo-evento', 'slug evento');
    console.log('✓ GET /api/demos lista los 4 rubros con sus slugs');

    // ── 2) Plantilla completa por rubro ──────────────────────────────────
    const expectations = {
      restaurant: { businessType: 'restaurant', flag: ['allowIceCreamWizard', false] },
      heladeria: { businessType: 'heladeria', flag: ['allowIceCreamWizard', true] },
      perfumery: { businessType: 'perfumery', flag: ['allowPerfumery', true] },
      events: { businessType: 'events', flag: ['businessType', 'events'] }
    };
    for (const [type, exp] of Object.entries(expectations)) {
      const res = await fetch(`${base}/api/demos/${type}`);
      assert.strictEqual(res.status, 200, `GET /api/demos/${type} → 200`);
      const body = await res.json();
      const demo = body.demo;
      assert.ok(demo && demo.slug, `${type}: trae slug`);
      assert.strictEqual(demo.businessType, exp.businessType, `${type}: businessType real`);
      assert.ok(Array.isArray(demo.categories) && demo.categories.length > 0, `${type}: con categorías`);
      assert.ok(Array.isArray(demo.dishes) && demo.dishes.length >= 3, `${type}: con carta real (≥3 platos)`);
      const ids = demo.dishes.map(d => d.id);
      assert.strictEqual(new Set(ids).size, ids.length, `${type}: ids de plato únicos`);
      assert.ok(demo.dishes.every(d => d.categoryId && demo.categories.some(c => c.id === d.categoryId)),
        `${type}: cada plato cuelga de una categoría existente`);
      if (type === 'heladeria') {
        assert.strictEqual(demo.allowIceCreamWizard, true, 'heladería: wizard activo');
        assert.ok(demo.iceCreamBuilderLabel, 'heladería: etiqueta del armador');
      }
      if (type === 'perfumery') {
        assert.strictEqual(demo.allowPerfumery, true, 'perfumería: catálogo activo');
        assert.ok(demo.dishes.every(d => d.id && !String(d.id).startsWith('perfume_')),
          'perfumería: ids reales (nada de perfume_ sintético que rompa la cotización)');
      }
      if (type === 'events') {
        const it = demo.weddingItinerary;
        assert.ok(it && it.enabled === true, 'evento: itinerario habilitado');
        assert.ok(Array.isArray(it.items) && it.items.length >= 3, 'evento: ≥3 momentos');
        assert.ok(new Date(demo.eventDate).getTime() > Date.now(), 'evento: fecha futura (no expirado)');
      }
      if (type === 'restaurant') {
        assert.ok(Array.isArray(demo.deliveryZones) && demo.deliveryZones.length > 0, 'restaurante: zonas de delivery');
      }
    }
    console.log('✓ GET /api/demos/:type trae carta real + flags por vertical (4/4)');

    // ── 3) Tipo inválido → 404 ───────────────────────────────────────────
    const badRes = await fetch(`${base}/api/demos/carniceria`);
    assert.strictEqual(badRes.status, 404, 'tipo inválido → 404');
    console.log('✓ GET /api/demos/:type inválido → 404');

    // ── 4) Menú público demo (siempre online, sin PII interna) ───────────
    for (const meta of listDemoRestaurants()) {
      const res = await fetch(`${base}/api/menu/${meta.slug}`);
      assert.strictEqual(res.status, 200, `GET /api/menu/${meta.slug} → 200 sin auth`);
      const body = await res.json();
      assert.ok(body.isDemo === true, `${meta.slug}: flag isDemo`);
      assert.strictEqual(body.restaurant.isDemo, true, `${meta.slug}: flag isDemo en restaurant`);
      assert.strictEqual(body.restaurant.slug, meta.slug, `${meta.slug}: slug consistente`);
      assert.ok(!('userId' in body.restaurant), `${meta.slug}: sin userId interno`);
      assert.ok('weddingItinerary' in body.restaurant, `${meta.slug}: expone weddingItinerary`);
      assert.ok('neonAccent' in body.restaurant, `${meta.slug}: expone neonAccent`);
    }
    const demoMenu = await (await fetch(`${base}/api/menu/demo-evento`)).json();
    assert.ok(demoMenu.restaurant.weddingItinerary && demoMenu.restaurant.weddingItinerary.enabled === true,
      'el menú público del evento expone el itinerario (timeline en vivo)');
    assert.strictEqual(demoMenu.isEvent, true, 'el menú del evento marca isEvent');
    console.log('✓ GET /api/menu/demo-* 200 con isDemo, sin userId, con itinerario/neón (4/4)');

    // ── 5) SSR /m/demo-* con CSP estricta ────────────────────────────────
    for (const slug of ['demo-heladeria', 'demo-evento']) {
      const res = await fetch(`${base}/m/${slug}`);
      assert.strictEqual(res.status, 200, `GET /m/${slug} → 200`);
      const csp = res.headers.get('content-security-policy') || '';
      assert.ok(csp.includes("script-src-attr 'none'"), `${slug}: CSP con script-src-attr none`);
      const html = await res.text();
      assert.ok(html.includes('<title>') && html.includes('ScanGo'), `${slug}: SSR con título`);
    }
    console.log('✓ GET /m/demo-* SSR 200 con CSP estricta (2/2)');

    // ── 6) Contrato OpenAPI ──────────────────────────────────────────────
    const spec = fs.readFileSync(path.join(ROOT, 'openapi.yaml'), 'utf8');
    assert.ok(spec.includes('/api/demos:'), 'el spec documenta /api/demos');
    assert.ok(spec.includes('/api/demos/{type}:'), 'el spec documenta /api/demos/{type}');
    console.log('✓ openapi.yaml documenta las rutas de demos');

    // ── 6b) Analytics de demo: 200 no-op (sin 404 ruidoso ni datos falsos) ──
    const demoEvent = await fetch(`${base}/api/public/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'demo-heladeria', event: 'visit' })
    });
    assert.strictEqual(demoEvent.status, 200, 'analytics de un slug demo → 200 (no 404)');
    const demoEventBody = await demoEvent.json();
    assert.strictEqual(demoEventBody.demo, true, 'respuesta { demo:true } (no persiste telemetría)');
    const ghostEvent = await fetch(`${base}/api/public/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'no-existe-xyz', event: 'visit' })
    });
    assert.strictEqual(ghostEvent.status, 404, 'un slug desconocido real sigue siendo 404');
    console.log('✓ Analytics demo: 200 no-op para demos, 404 para slugs desconocidos');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  // ── 7) Landing + Studio enlazados ──────────────────────────────────────
  const landing = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  for (const meta of listDemoRestaurants()) {
    assert.ok(landing.includes(`/m/${meta.slug}`), `landing enlaza /m/${meta.slug}`);
    assert.ok(landing.includes(`/studio?demo=${meta.type}`), `landing enlaza /studio?demo=${meta.type}`);
  }
  assert.ok(landing.includes('id="demosTitle"'), 'la galería tiene heading accesible');
  const studioHtml = fs.readFileSync(path.join(ROOT, 'public', 'studio.html'), 'utf8');
  assert.ok(studioHtml.includes('id="demoModeBanner"'), 'Studio trae el banner de modo demo');
  assert.ok(studioHtml.includes('data-js-click="importDemoTemplate"'), 'importar demo usa data-js-* (CSP)');
  assert.ok(studioHtml.includes('data-js-click="discardDemoTemplate"'), 'salir de demo usa data-js-* (CSP)');
  const studioJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'studio.js'), 'utf8');
  assert.ok(studioJs.includes('initDemoMode'), 'studio.js implementa el modo demo');
  assert.ok(studioJs.includes('scango_demo_draft_'), 'el borrador demo persiste en localStorage');
  console.log('✓ Landing con galería (8 enlaces) + Studio con modo demo (banner + importar/salir)');

  // ── 10) Demo vitrina: probador de temas en vivo + editor bloqueado ──
  const menuHtml = fs.readFileSync(path.join(ROOT, 'public', 'menu.html'), 'utf8');
  assert.ok(menuHtml.includes('id="demoThemeFab"'), 'menú trae FAB del probador de temas');
  assert.ok(menuHtml.includes('data-js-click="toggleDemoThemeBar"'), 'FAB usa data-js-* (CSP)');
  assert.ok(menuHtml.includes('aria-label="Probar otro tema visual"'), 'FAB con nombre accesible');
  assert.ok(menuHtml.includes('id="demoThemePanel"'), 'menú trae panel de temas');
  assert.ok(menuHtml.includes('aria-label="Temas visuales de la demo"'), 'panel como grupo con nombre');
  assert.ok(menuHtml.includes('id="demoThemePills"'), 'panel trae contenedor de pastillas');
  const menuJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'menu.js'), 'utf8');
  assert.ok(menuJs.includes('THEME_SHORT_NAMES'), 'menu.js trae nombres cortos de temas');
  assert.ok(menuJs.includes('function setDemoTheme('), 'menu.js implementa setDemoTheme');
  assert.ok(menuJs.includes('function toggleDemoThemeBar('), 'menu.js implementa toggleDemoThemeBar');
  assert.ok(menuJs.includes('function renderDemoThemeBar('), 'menu.js implementa renderDemoThemeBar');
  assert.ok(menuJs.includes('toggleDemoThemeBar,'), 'toggle expuesto en window');
  assert.ok(menuJs.includes('setDemoTheme,'), 'setDemoTheme expuesto en window');
  assert.ok(menuJs.includes('restaurantData.isDemo !== true'), 'setDemoTheme solo corre en demos');
  assert.ok(menuJs.includes('demoAllowedThemes'), 'allowlist de temas por rubro (lockdown heladería)');
  // Nombres cortos: el selector de estética no explica, solo nombra.
  assert.ok(studioHtml.includes('value="helado-fiesta">🍨 Fiesta de Helado</option>'), 'Studio: nombre corto de tema');
  const themeSelect = studioHtml.match(/<select id="inputThemeBg"[\s\S]*?<\/select>/);
  assert.ok(themeSelect, 'existe el select de estética');
  const themeOptions = [...themeSelect[0].matchAll(/<option value="[a-z-]+">([^<]*)<\/option>/g)].map(m => m[1]);
  const longOnes = themeOptions.filter(t => t.includes('('));
  assert.deepStrictEqual(longOnes, [], 'ninguna opción de tema lleva paréntesis explicativo');
  // Bloqueo de edición en demo invitada: solo el tema queda habilitado.
  assert.ok(studioJs.includes('function lockDemoEditor('), 'studio.js implementa el bloqueo de demo');
  assert.ok(studioJs.includes('lockDemoEditor();'), 'el bloqueo se aplica en modo demo');
  assert.ok(studioJs.includes('function refreshDemoViewMenuLink('), 'el link Ver menú arrastra el ?theme=');
  console.log('✓ Demo vitrina: probador de temas en el menú + editor bloqueado + nombres cortos');

  console.log('✅ 10/10 secciones de demos OK');
}

module.exports = { runTests };

if (require.main === module) {
  runTests()
    .then(() => { console.log('\n✅ test-demos: demos por rubro + Studio OK (10/10)'); process.exit(0); })
    .catch(err => { console.error('\n❌ test-demos falló:', err.message); process.exit(1); });
}
