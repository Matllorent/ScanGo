/**
 * tests/test-theme-manifest.js — Suite 52
 * ─────────────────────────────────────────────────────────────────────────────
 * Paridad del MANIFEST del motor de plantillas (api/utils/themeManifest.js)
 * con sus tres consumidores + units de las piezas puras nuevas:
 *
 *   1. Manifest canónico: capacidades coherentes por morfología (10 layouts).
 *   2. Helpers de resolución: imageMode/menuSizing nunca cuele un combo que
 *      el layout no implementa (fallback al default de la morfología).
 *   3. Espejo ESM generado (public/js/menu/themeManifest.js): contenido byte a
 *      byte igual al que emite scripts/regen-theme-manifest.js + arrays
 *      idénticos al canónico (anti-drift, mismo patrón que CSP ↔ vercel.json).
 *   4. Sanitizer: allowlists derivadas del manifest + normalización de los
 *      campos nuevos (imageMode/menuSizing) sin tocar el resto.
 *   5. popularityTiers: cuantiles con tope, muestras mínimas, proxy del chef.
 *   6. Studio: options del selector de layout y de temas == ids del manifest;
 *      filas imageModeRow/menuSizingRow presentes con label asociado.
 *   7. menu.css: un body.layout-id por morfología + clases de image/sizing.
 *   8. Wiring: menuHeader/menuRender/rutas consumen el manifest y emiten las
 *      clases y atributos; countAnalytics sigue pidiendo SOLO event_type
 *      (invariante de test-differential: popularity vive aparte).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const manifest = require('../api/utils/themeManifest');
const { TARGET, buildManifestEsm } = require('../scripts/regen-theme-manifest');
const { sanitizeRestaurantPayload, ALLOWED_LAYOUTS, CLASSIC_THEMES, HELADERIA_THEMES, ALL_THEMES } = require('../api/utils/sanitizeRestaurant');
const { computePopTiers, DISH_POPULARITY_MIN_SAMPLES } = require('../api/utils/popularityTiers');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

async function runTests() {
  console.log('🧪 Iniciando verificación del manifest del motor de plantillas...');

  // ── 1) Manifest canónico coherente ────────────────────────────────────────
  assert.strictEqual(manifest.LAYOUT_IDS.length, 10, 'hay 10 morfologías (9 previas + brutalist)');
  assert.strictEqual(new Set(manifest.LAYOUT_IDS).size, 10, 'ids de layout únicos');
  assert.deepStrictEqual(manifest.IMAGE_MODES, ['grid', 'none', 'hero'], 'modos de imagen canónicos');
  assert.deepStrictEqual(manifest.MENU_SIZING_MODES, ['uniform', 'popularity'], 'modos de sizing canónicos');
  for (const layout of manifest.LAYOUTS) {
    assert.ok(manifest.IMAGE_MODES.includes(layout.defaultImageMode), `${layout.id}: defaultImageMode válido`);
    assert.ok(layout.imageModes.includes(layout.defaultImageMode), `${layout.id}: soporta su propio default`);
    assert.ok(layout.imageModes.length > 0, `${layout.id}: declara al menos un imageMode`);
    assert.ok(layout.imageModes.every((m) => manifest.IMAGE_MODES.includes(m)), `${layout.id}: imageModes ⊆ IMAGE_MODES`);
    assert.ok(layout.menuSizing.includes('uniform'), `${layout.id}: siempre soporta uniform (estado histórico)`);
    assert.ok(layout.menuSizing.every((s) => manifest.MENU_SIZING_MODES.includes(s)), `${layout.id}: menuSizing ⊆ MENU_SIZING_MODES`);
  }
  assert.strictEqual(manifest.CLASSIC_THEME_IDS.length, 18, '18 paletas clásicas');
  assert.strictEqual(manifest.HELADERIA_THEME_IDS.length, 12, '12 paletas de heladería');
  assert.strictEqual(manifest.THEME_IDS.length, 30, '30 temas en total');
  assert.strictEqual(new Set(manifest.THEME_IDS).size, 30, 'ids de tema únicos');
  assert.ok(manifest.isValidTheme('classic') && manifest.isValidTheme('cioccolato'), 'isValidTheme acepta temas reales');
  assert.ok(!manifest.isValidTheme('no-existe') && !manifest.isValidTheme('__proto__'), 'isValidTheme rechaza fantasma y proto');
  console.log('✓ Manifest canónico: 10 morfologías × capacidades coherentes + 30 temas');

  // ── 2) Resolución: los combos no soportados caen al default ───────────────
  assert.strictEqual(manifest.resolveImageMode('classic', 'auto'), 'grid', 'classic auto → grid');
  assert.strictEqual(manifest.resolveImageMode('classic', undefined), 'grid', 'classic sin dato → grid');
  assert.strictEqual(manifest.resolveImageMode('classic', ' GRID '), 'grid', 'trim + lowercase');
  assert.strictEqual(manifest.resolveImageMode('minimalist', 'auto'), 'hero', 'Fine Dining default = hero (foto por categoría)');
  assert.strictEqual(manifest.resolveImageMode('ticker', 'hero'), 'none', 'ticker no implementa hero → su default (none)');
  assert.strictEqual(manifest.resolveImageMode('banana', 'hero'), 'hero', 'layout desconocido → se resuelve como classic (que sí soporta hero)');
  assert.strictEqual(manifest.resolveMenuSizing('classic', 'popularity'), 'popularity', 'classic soporta popularidad');
  assert.strictEqual(manifest.resolveMenuSizing('ticker', 'popularity'), 'uniform', 'ticker no soporta popularidad → uniform');
  assert.strictEqual(manifest.resolveMenuSizing('classic', 'wide'), 'uniform', 'valor raro → uniform');
  assert.strictEqual(manifest.layoutSupportsImageMode('stories', 'none'), false, 'stories no apaga fotos');
  assert.strictEqual(manifest.layoutSupportsImageMode('classic', 'hero'), true, 'classic implementa hero');
  assert.strictEqual(manifest.layoutSupportsMenuSizing('delivery', 'popularity'), false, 'delivery (lista) no escala por ancho');
  assert.strictEqual(manifest.layoutSupportsMenuSizing('brutalist', 'popularity'), true, 'brutalist soporta popularidad');
  console.log('✓ Helpers de resolución: combos no soportados caen al default (nada cuele)');

  // ── 3) Espejo ESM generado: anti-drift byte a byte + arrays idénticos ─────
  const generated = fs.readFileSync(TARGET, 'utf8');
  assert.strictEqual(generated, buildManifestEsm(), 'el espejo ESM commiteado coincide con el canónico (regenerar: node scripts/regen-theme-manifest.js)');
  assert.ok(generated.includes('ARCHIVO GENERADO'), 'el espejo se marca como generado');
  const fe = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'menu', 'themeManifest.js')).href);
  assert.deepStrictEqual(fe.LAYOUTS, manifest.LAYOUTS, 'LAYOUTS idéntico canónico ↔ espejo');
  assert.deepStrictEqual(fe.LAYOUT_IDS, manifest.LAYOUT_IDS, 'LAYOUT_IDS idéntico');
  assert.deepStrictEqual(fe.IMAGE_MODES, manifest.IMAGE_MODES, 'IMAGE_MODES idéntico');
  assert.deepStrictEqual(fe.MENU_SIZING_MODES, manifest.MENU_SIZING_MODES, 'MENU_SIZING_MODES idéntico');
  assert.deepStrictEqual(fe.THEME_IDS, manifest.THEME_IDS, 'THEME_IDS idéntico');
  assert.deepStrictEqual(fe.CLASSIC_THEME_IDS, manifest.CLASSIC_THEME_IDS, 'CLASSIC_THEME_IDS idéntico');
  assert.deepStrictEqual(fe.HELADERIA_THEME_IDS, manifest.HELADERIA_THEME_IDS, 'HELADERIA_THEME_IDS idéntico');
  console.log('✓ Espejo ESM generado sin drift (contenido + arrays == canónico)');

  // ── 4) Sanitizer: allowlists del manifest + campos nuevos ─────────────────
  assert.deepStrictEqual(ALLOWED_LAYOUTS, manifest.LAYOUT_IDS, 'ALLOWED_LAYOUTS DERIVA del manifest (misma lista)');
  assert.deepStrictEqual(CLASSIC_THEMES, manifest.CLASSIC_THEME_IDS, 'CLASSIC_THEMES == manifest');
  assert.deepStrictEqual(HELADERIA_THEMES, manifest.HELADERIA_THEME_IDS, 'HELADERIA_THEMES == manifest');
  assert.deepStrictEqual(ALL_THEMES, manifest.THEME_IDS, 'ALL_THEMES == manifest');
  const base = { name: 'Local Manifest', slug: 'local-manifest' };
  assert.strictEqual(sanitizeRestaurantPayload({ ...base, layout: 'brutalist' }).layout, 'brutalist', 'brutalist persiste (allowlist nueva)');
  assert.strictEqual(sanitizeRestaurantPayload({ ...base, layout: 'no-existe' }).layout, 'classic', 'layout desconocido → classic');
  assert.strictEqual(sanitizeRestaurantPayload({ ...base, layout: 'BRUTALIST' }).layout, 'brutalist', 'case-insensitive');
  assert.strictEqual(sanitizeRestaurantPayload({ ...base, imageMode: 'hero' }).imageMode, 'hero', 'imageMode allowlist: hero persiste');
  assert.strictEqual(sanitizeRestaurantPayload({ ...base, imageMode: 'auto' }).imageMode, 'auto', 'imageMode auto persiste (default del layout)');
  assert.strictEqual(sanitizeRestaurantPayload({ ...base, imageMode: 'banana' }).imageMode, 'auto', 'imageMode raro → auto');
  assert.strictEqual(sanitizeRestaurantPayload({ ...base, menuSizing: 'popularity' }).menuSizing, 'popularity', 'menuSizing allowlist: popularity persiste');
  assert.strictEqual(sanitizeRestaurantPayload({ ...base, menuSizing: 'huge' }).menuSizing, 'uniform', 'menuSizing raro → uniform');
  const defaults = sanitizeRestaurantPayload({ ...base });
  assert.strictEqual(defaults.imageMode, 'auto', 'sin dato → imageMode auto');
  assert.strictEqual(defaults.menuSizing, 'uniform', 'sin dato → menuSizing uniform');
  const lockedHeladeria = sanitizeRestaurantPayload({ ...base, businessType: 'heladeria', theme: 'emerald' });
  assert.strictEqual(lockedHeladeria.theme, 'helado-fiesta', 'el candado de rubro de heladería sigue intacto (emerald → helado-fiesta)');
  console.log('✓ Sanitizer: allowlists derivadas del manifest + imageMode/menuSizing normalizados');

  // ── 5) popularityTiers: unidades puras ────────────────────────────────────
  const dishes = (n) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, name: `Plato ${i}` }));

  // Sin datos → todos 1 (uniforme, el estado histórico)
  let tiers = computePopTiers(dishes(5), null);
  assert.deepStrictEqual([...tiers.values()], [1, 1, 1, 1, 1], 'sin datos → uniforme (nadie chico por accidente)');

  // Proxy del chef cuando no hay evidencia estadística
  const withChef = [...dishes(4), { id: 'chef', name: 'Del chef', is_chef_recommended: true }];
  tiers = computePopTiers(withChef, null);
  assert.strictEqual(tiers.get('chef'), 2, 'sin scores, el recomendado por el chef gana el tier grande');
  assert.strictEqual(tiers.get('d0'), 1, 'sin scores, el resto queda normal');

  // Muestras insuficientes → se ignora el ranking y manda el chef (o uniforme)
  const scarce = { scores: { d0: 1, d1: 0.5 }, samples: DISH_POPULARITY_MIN_SAMPLES - 1 };
  tiers = computePopTiers(dishes(3), scarce);
  assert.deepStrictEqual([...tiers.values()], [1, 1, 1], `con < ${DISH_POPULARITY_MIN_SAMPLES} muestras no se confía en el ranking`);

  // Ranking con evidencia: top 20% → 2 (tope 4), siguiente 30% → 1, resto → 0
  const ten = dishes(10);
  const tenScores = {};
  ten.forEach((d, i) => { tenScores[d.id] = Math.round(((10 - i) / 10) * 100) / 100; });
  tiers = computePopTiers(ten, { scores: tenScores, samples: 500 });
  assert.strictEqual(tiers.get('d0'), 2, 'el más clickeado es tier 2');
  assert.strictEqual(tiers.get('d1'), 2, 'top 20% de 10 = 2 platos en tier 2');
  assert.strictEqual(tiers.get('d2'), 1, 'siguiente 30% → tier 1');
  assert.strictEqual(tiers.get('d9'), 0, 'la cola → tier 0 (chico, pero nunca invisibile)');

  // El tope de "grandes": 50 platos con evidencia → solo 4 tier 2
  const fifty = dishes(50);
  const fiftyScores = {};
  fifty.forEach((d, i) => { fiftyScores[d.id] = Math.round(((50 - i) / 50) * 100) / 100; });
  tiers = computePopTiers(fifty, { scores: fiftyScores, samples: 900 });
  assert.strictEqual([...tiers.values()].filter((t) => t === 2).length, 4, 'tope de 4 platos destacados (top 20% cap 4)');

  // Plato nuevo sin score → neutral (1), nunca castigado
  const mixed = [...dishes(10), { id: 'recien', name: 'Nuevo' }];
  tiers = computePopTiers(mixed, { scores: tenScores, samples: 500 });
  assert.strictEqual(tiers.get('recien'), 1, 'plato sin score → tier neutral');
  console.log('✓ popularityTiers: cuantiles con tope, muestras mínimas y proxy del chef');

  // ── 6) Studio: options del selector y filas del motor de plantillas ───────
  const studioHtml = read('public/studio.html');
  const layoutSelectMatch = studioHtml.match(/<select id="inputMenuLayout"[\s\S]*?<\/select>/);
  assert.ok(layoutSelectMatch, 'studio.html tiene el selector #inputMenuLayout');
  for (const id of manifest.LAYOUT_IDS) {
    assert.ok(layoutSelectMatch[0].includes(`<option value="${id}"`), `el selector de layout ofrece ${id}`);
  }
  const themeSelectMatch = studioHtml.match(/<select id="inputThemeBg"[\s\S]*?<\/select>/);
  assert.ok(themeSelectMatch, 'studio.html tiene el selector #inputThemeBg');
  for (const id of manifest.THEME_IDS) {
    assert.ok(themeSelectMatch[0].includes(`<option value="${id}"`), `el selector de temas ofrece ${id}`);
  }
  assert.ok(studioHtml.includes('id="imageModeRow"') && studioHtml.includes('for="inputImageMode"'), 'fila imageMode con label asociado');
  assert.ok(studioHtml.includes('id="menuSizingRow"') && studioHtml.includes('for="inputMenuSizing"'), 'fila menuSizing con label asociado');
  const studioJs = read('public/js/studio.js');
  assert.ok(studioJs.includes("from './menu/themeManifest.js'"), 'studio.js importa el manifest generado (fuente única de capacidades)');
  assert.ok(studioJs.includes('updateLayoutCapabilityRows'), 'studio.js muestra/oculta filas según la morfología elegida');
  assert.ok(studioJs.includes('restaurant.imageMode') && studioJs.includes('restaurant.menuSizing'), 'studio.js guarda/carga los campos nuevos');
  console.log('✓ Studio: options == manifest, filas con label y wiring desde el espejo ESM');

  // ── 7) menu.css: una clase base por morfología + image/sizing ─────────────
  const menuCss = read('public/css/menu.css');
  for (const id of manifest.LAYOUT_IDS) {
    if (id === 'classic') continue; // classic es la BASE: estilos por defecto, sin bloque propio
    assert.ok(menuCss.includes(`body.layout-${id}`), `menu.css define body.layout-${id}`);
  }
  for (const mode of manifest.IMAGE_MODES) {
    const selector = mode === 'grid' ? 'body.layout-minimalist.image-grid' : `body.image-${mode}`;
    assert.ok(menuCss.includes(selector), `menu.css estiliza el modo de imagen (${selector})`);
  }
  assert.ok(menuCss.includes('body.sizing-popularity'), 'menu.css estiliza body.sizing-popularity');
  assert.ok(menuCss.includes('[data-pop-tier="2"]'), 'el tier grande se ancha con data-pop-tier');
  assert.ok(menuCss.includes('.category-hero-img'), 'la foto protagonista por categoría tiene sus estilos');
  assert.ok(menuCss.includes('--bg-chalkboard: #F7F4ED'), 'Fine Dining usa marfil (la promesa de minimalist)');
  // Los layouts de papel re-scopean las tintas del header a tinta: el bloque
  // base re-scopea --chalk-white a claro asumiendo "header siempre oscuro" y
  // rompe los controles al volverlo papel (bug QA: Información invisible).
  for (const id of ['minimalist', 'brutalist']) {
    const headerBlock = new RegExp(`body\\.layout-${id} \\.menu-header \\{[^}]*`).exec(menuCss)?.[0] || '';
    assert.ok(headerBlock.includes('--chalk-white:'), `body.layout-${id} .menu-header re-scopea --chalk-white a tinta`);
  }
  console.log('✓ menu.css: 10 morfologías + image modes + sizing + hero + marfil + tintas de header en papel');

  // ── 8) Wiring frontend/backend + invariante de countAnalytics ─────────────
  const headerModSrc = read('public/js/menu/menuHeader.js');
  assert.ok(headerModSrc.includes("from './themeManifest.js'"), 'menuHeader importa el manifest (literales fuera)');
  assert.ok(headerModSrc.includes('image-'), 'menuHeader agrega las clases image-*');
  assert.ok(headerModSrc.includes('sizing-popularity'), 'menuHeader agrega la clase sizing-popularity');
  assert.ok(headerModSrc.includes("'?img='") || headerModSrc.includes('"img"') || headerModSrc.includes("get('img')"), 'preview ?img= (espejo de ?morph=)');
  assert.ok(headerModSrc.includes("get('sizing')"), 'preview ?sizing= (espejo de ?morph=)');
  const renderSrc = read('public/js/menu/menuRender.js');
  assert.ok(renderSrc.includes('data-pop-tier'), 'menuRender emite data-pop-tier en las cartas');
  assert.ok(renderSrc.includes('category-hero-img'), 'menuRender inyecta la foto protagonista por categoría');
  const menuJsThemesSrc = read('public/js/menu.js');
  assert.ok(menuJsThemesSrc.includes("import { LAYOUT_IDS, CLASSIC_THEME_IDS, HELADERIA_THEME_IDS } from './menu/themeManifest.js'"), 'menu.js importa las listas de temas del ESPEJO (sin copias locales que se revisen a mano)');
  assert.ok(!/const CLASSIC_THEMES = \[/.test(menuJsThemesSrc) && !/HELADERIA_THEMES_MENU\s*=/.test(menuJsThemesSrc), 'sin array de temas hardcodeado en menu.js (drift por paleta nueva = tema invisible en la demo)');
  const menuRouterSrc = read('api/routes/menu.js');
  assert.ok(menuRouterSrc.includes('resolveImageMode') && menuRouterSrc.includes('resolveMenuSizing'), 'ruta del menú resuelve las dimensiones server-side');
  assert.ok(menuRouterSrc.includes('computePopTiers') && menuRouterSrc.includes('popTier'), 'ruta del menú adjunta popTier solo con sizing activo');
  assert.ok(menuRouterSrc.includes("req.query.sizing"), 'preview ?sizing= entendido por el server');
  const telemetrySrc = read('api/services/telemetry.js');
  assert.ok(telemetrySrc.includes("getEvents(restaurantId, { columns: 'event_type' })"), 'countAnalytics sigue pidiendo SOLO event_type (invariante de test-differential: dishPopularity vive en computeDishPopularity aparte)');
  assert.ok(telemetrySrc.includes('computeDishPopularity') && telemetrySrc.includes('projectAnalytics'), 'telemetry expone computeDishPopularity + projectAnalytics');
  console.log('✓ Wiring: menú (header/render/ruta) + invariante de countAnalytics intacto');

  console.log('🎉 ¡TODAS LAS PRUEBAS DEL MANIFEST DE PLANTILLAS PASARON AL 100%!');
}

runTests().catch((err) => {
  console.error('❌ Error en pruebas del manifest de plantillas:', err);
  process.exit(1);
});
