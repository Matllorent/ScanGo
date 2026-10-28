/**
 * Test Suite: SEO programático por CIUDAD
 * Módulo puro api/utils/seoCities.js + SSR de /ciudades y /ciudades/:slug.
 *
 * Verifica que el motor de landings por ciudad, espejando el patrón de
 * /soluciones y derivando TODO de locales reales (cero ciudades inventadas):
 *
 *   1. Sanitizers puros: nombre (cap 40) y slug (sin diacríticos, [a-z0-9-]).
 *   2. Índice derivado: agrupa por slug ("Montevideo" = "montevideo"), orden
 *      count desc + nombre asc, demos y basura fuera, sin mutar la entrada.
 *   3. JSON-LD: BreadcrumbList + WebPage + FAQPage + ItemList (city) y
 *      CollectionPage + ItemList (hub), serializables y con URLs del base.
 *   4. HTML server-rendered SEGURO: sin scripts inline, cero on*=
 *      (script-src-attr 'none') y con el contenido hostil escapado.
 *   5. Wiring estático: rutas en discovery.js, sitemap con `cities`,
 *      vercel.json antes del catch-all, llms.txt/llms-full.txt documentando.
 *   6. Runtime REAL: hub 200, cada ciudad 200 con sus menús, ciudad
 *      desconocida 404 (nunca inventa), canceladas/demos fuera y sitemap.
 *
 * Sin mocks: server + db reales, como todo el repo.
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../api/index');
const db = require('../src/db/db');
const seoSolutions = require('../api/utils/seoSolutions');
const seoCities = require('../api/utils/seoCities');
const seoDiscovery = require('../api/utils/seoDiscovery');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const appUrl = (process.env.APP_URL || 'https://scango.uy').replace(/\/+$/, '');
const INLINE_EVENT_ATTR = /\son[a-z]+\s*=/i;

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** Restaurante QA de referencia (el owner queda @example.com → lo purga el guard). */
function cityRestaurant(ownerId, slug, city, businessType, extra = {}) {
  return {
    id: `rest-city-${slug}`,
    userId: ownerId,
    name: `Cartas QA ${slug}`,
    bizName: `Cartas QA ${slug}`,
    slug,
    city,
    businessType,
    subscription: { status: 'active', plan: 'starter_monthly' },
    categories: [{ id: 'cat-1', name: 'Carta' }],
    dishes: [
      { id: 'dish-1', categoryId: 'cat-1', name: 'Plato QA', description: 'Test', price: 100 }
    ],
    ...extra
  };
}

async function runTests() {
  // ── §1 · módulo puro ─────────────────────────────────────────────────────

  // 1. sanitizeCityName: espacios colapsados + cap 40 + basura → ''.
  assert.strictEqual(seoCities.sanitizeCityName('  Montevideo  \n'), 'Montevideo', 'trim + colapso');
  assert.strictEqual(seoCities.sanitizeCityName('Punta   del Este'), 'Punta del Este', 'espacios internos colapsados');
  assert.strictEqual(seoCities.sanitizeCityName('a'.repeat(41)), 'a'.repeat(40), 'cap 40');
  for (const basura of [null, undefined, {}, 123, '   ']) {
    assert.strictEqual(seoCities.sanitizeCityName(basura), '', 'basura de entrada → nombre vacío');
  }

  // 2. citySlugOf: minúsculas + sin diacríticos + [a-z0-9-].
  assert.strictEqual(seoCities.citySlugOf('Montevideo'), 'montevideo');
  assert.strictEqual(seoCities.citySlugOf('Punta del Este'), 'punta-del-este');
  assert.strictEqual(seoCities.citySlugOf('ÑUÑOA'), 'nunoa', 'ñ → n (sin diacríticos)');
  assert.strictEqual(seoCities.citySlugOf('Málaga'), 'malaga', 'á → a');
  assert.strictEqual(seoCities.citySlugOf('Colonia del Sacramento'), 'colonia-del-sacramento');
  assert.strictEqual(seoCities.citySlugOf('---'), '', 'solo separadores → slug vacío');
  assert.strictEqual(seoCities.citySlugOf(''), '');
  // Cap efectivo: el nombre va cap 40 primero, así que el slug nunca excede 40.
  assert.strictEqual(seoCities.citySlugOf('a'.repeat(55)).length, 40, 'cap de slug vía nombre');

  // 3. Índice derivado: agrupa por slug, demos fuera, orden honesto, sin PII.
  const baseInput = [
    cityRestaurant('u1', 'mvd-1', 'Montevideo', 'restaurant'),
    cityRestaurant('u2', 'mvd-2', 'montevideo', 'heladeria'), // misma ciudad, otra grafía
    cityRestaurant('u3', 'pde-1', 'Punta del Este', 'perfumery'),
    cityRestaurant('u4', 'demo-x', 'Montevideo', 'restaurant', { isDemo: true }), // demo fuera
    cityRestaurant('u5', 'sin-city', ''), // sin ciudad fuera
    { userId: 'u6', slug: 'city-basura', city: '   ', name: 'Basura' }, // ciudad basura
    null,
    'string suelta',
    42
  ];
  const inputSnapshot = structuredClone(baseInput.filter((r) => r && typeof r === 'object'));
  const cities = seoCities.buildCityIndex(baseInput);
  assert.deepStrictEqual(
    baseInput.filter((r) => r && typeof r === 'object'),
    inputSnapshot,
    'buildCityIndex NUNCA muta la entrada (pureza)'
  );
  assert.deepStrictEqual(
    cities.map((c) => c.slug),
    ['montevideo', 'punta-del-este'],
    'agrupación por slug + orden count desc'
  );
  const mvd = cities[0];
  assert.strictEqual(mvd.name, 'Montevideo', 'grafía mostrada: empate 1/1 → la alfabéticamente menor');
  assert.strictEqual(mvd.count, 2, 'Montevideo y montevideo son la MISMA ciudad');
  assert.deepStrictEqual(
    mvd.restaurants.map((r) => r.href),
    ['/m/mvd-1', '/m/mvd-2'],
    'cartas ordenadas por nombre dentro de la ciudad'
  );
  for (const card of mvd.restaurants) {
    assert.deepStrictEqual(Object.keys(card), ['name', 'href', 'businessLabel'], 'carta sin PII (solo name/href/rubro)');
  }
  assert.deepStrictEqual(
    cities.map((c) => c.restaurants.map((r) => r.businessLabel)),
    [['Restaurante', 'Heladería'], ['Perfumería']],
    'rubro con label es'
  );
  assert.strictEqual(cities.find((c) => c.slug === 'montevideo').restaurants.some((r) => r.href.includes('demo-x')), false, 'demo fuera del índice');

  // Grafía dominante: la más FRECUENTE manda (no la primera llegada).
  const freqIndex = seoCities.buildCityIndex([
    cityRestaurant('a', 'f-1', 'montevideo', 'restaurant'),
    cityRestaurant('b', 'f-2', 'montevideo', 'restaurant'),
    cityRestaurant('c', 'f-3', 'Montevideo', 'restaurant')
  ]);
  assert.strictEqual(freqIndex[0].name, 'montevideo', 'grafía dominante por frecuencia (2 lowercase vs 1 capitalizada)');

  // Empate de count → nombre asc (determinista).
  const tieIndex = seoCities.buildCityIndex([
    cityRestaurant('a', 't-1', 'Testciudad B', 'restaurant'),
    cityRestaurant('b', 't-2', 'Testciudad A', 'restaurant')
  ]);
  assert.deepStrictEqual(
    tieIndex.map((c) => c.slug),
    ['testciudad-a', 'testciudad-b'],
    'empate de count → nombre asc'
  );

  // Cap honesto por página: 3 locales con cap 2 → 2 listados + extraCount 1.
  const capped = seoCities.buildCityIndex(
    [
      cityRestaurant('a', 'cap-1', 'Rocha', 'restaurant'),
      cityRestaurant('b', 'cap-2', 'Rocha', 'restaurant'),
      cityRestaurant('c', 'cap-3', 'Rocha', 'restaurant')
    ],
    { maxPerCity: 2 }
  )[0];
  assert.strictEqual(capped.count, 3, 'count es el REAL, no el recortado');
  assert.strictEqual(capped.restaurants.length, 2, 'listado recortado al cap');
  assert.strictEqual(capped.extraCount, 1, 'excedente honesto');

  // 4. getCityBySlug: normaliza el slug crudo del URL.
  assert.strictEqual(seoCities.getCityBySlug(cities, ' MONTEVIDEO ').slug, 'montevideo', 'case-insensitivo por slug');
  assert.strictEqual(seoCities.getCityBySlug(cities, 'rocha'), null, 'ciudad desconocida → null');
  assert.strictEqual(seoCities.getCityBySlug(cities, undefined), null, 'undefined → null');
  assert.strictEqual(seoCities.getCityBySlug('no-un-array', 'x'), null, 'índice basura → null');

  // 5. JSON-LD de la ciudad: BreadcrumbList + WebPage + FAQPage + ItemList.
  const cityLd = seoCities.buildCityJsonLd(mvd, appUrl);
  assert.strictEqual(cityLd['@context'], 'https://schema.org');
  assert.deepStrictEqual(
    cityLd['@graph'].map((n) => n['@type']),
    ['BreadcrumbList', 'WebPage', 'FAQPage', 'ItemList'],
    'nodos esperados de la landing de ciudad'
  );
  const cityCrumb = cityLd['@graph'][0];
  assert.strictEqual(cityCrumb.itemListElement.length, 3, 'Inicio → Ciudades → ciudad');
  assert.strictEqual(cityCrumb.itemListElement[1].item, `${appUrl}/ciudades`, 'item del hub');
  assert.strictEqual(cityCrumb.itemListElement[2].item, `${appUrl}/ciudades/${mvd.slug}`, 'item de la landing');
  const cityList = cityLd['@graph'][3];
  assert.strictEqual(cityList.numberOfItems, mvd.restaurants.length, 'ItemList con lo listado');
  assert.deepStrictEqual(
    cityList.itemListElement.map((i) => i.url),
    [`${appUrl}/m/mvd-1`, `${appUrl}/m/mvd-2`],
    'ItemList con URLs de menús reales'
  );
  JSON.parse(JSON.stringify(cityLd)); // serializable

  // 6. JSON-LD del hub: BreadcrumbList + CollectionPage con ItemList de ciudades.
  const hubLd = seoCities.buildCitiesIndexJsonLd(cities, appUrl);
  assert.deepStrictEqual(
    hubLd['@graph'].map((n) => n['@type']),
    ['BreadcrumbList', 'CollectionPage'],
    'nodos esperados del hub'
  );
  assert.strictEqual(hubLd['@graph'][1].mainEntity.itemListElement.length, cities.length, 'ItemList con una ListItem por ciudad');
  JSON.parse(JSON.stringify(hubLd));

  // 7. Render de la landing: contenido + seguridad (cero on*=, un solo script).
  const html = seoCities.renderCityHtml(mvd, { appUrl });
  for (const token of [
    `<link rel="canonical" href="${appUrl}/ciudades/${mvd.slug}"`,
    '<h1>Cartas digitales QR en Montevideo</h1>',
    'href="/m/mvd-1"',
    'href="/m/mvd-2"',
    '"@type":"FAQPage"',
    '"@type":"ItemList"',
    'skip-link',
    'id="main-content"'
  ]) {
    assert.ok(html.includes(token), `render ciudad debe incluir ${token}`);
  }
  assert.ok(!INLINE_EVENT_ATTR.test(html), 'render ciudad: cero atributos on*=');
  assert.strictEqual(countOccurrences(html, '<script'), 1, 'render ciudad: un único <script> (JSON-LD)');
  assert.ok(html.includes('<script type="application/ld+json">'), 'ese script es el JSON-LD');
  assert.ok(!html.includes('<script src'), 'sin scripts externos');

  // Hostilidad: nombre de local y ciudad con tags → escapados, nunca crudos.
  const hostile = seoCities.renderCityHtml(
    seoCities.buildCityIndex([
      { ...cityRestaurant('x', 'host-1', '<script>x</script>', 'restaurant'), name: '<img src=x onerror=alert(1)>' }
    ])[0],
    { appUrl }
  );
  assert.ok(!hostile.includes('<script>x</script>'), 'ciudad hostil escapada');
  assert.ok(!hostile.includes('<img src=x'), 'nombre hostil escapado');
  assert.ok(hostile.includes('&lt;img src=x'), 'escape visible como texto');

  // Cap superado → línea honesta de excedente.
  assert.ok(
    seoCities.renderCityHtml(capped, { appUrl }).includes('Y 1 cartas más'),
    'excedente informado, sin desaparecer en silencio'
  );

  // 8. Hub: una card por ciudad + estado vacío honesto.
  const hubHtml = seoCities.renderCitiesIndexHtml({ appUrl, cities });
  assert.ok(hubHtml.includes(`/ciudades/${mvd.slug}`), 'hub enlaza a montevideo');
  assert.ok(hubHtml.includes('/ciudades/punta-del-este'), 'hub enlaza a punta-del-este');
  assert.ok(hubHtml.includes('2 locales con cartas reales'), 'hub con count real');
  assert.ok(!INLINE_EVENT_ATTR.test(hubHtml), 'hub: cero atributos on*=');
  assert.strictEqual(countOccurrences(hubHtml, '<script'), 1, 'hub: un único <script>');
  const emptyHub = seoCities.renderCitiesIndexHtml({ appUrl, cities: [] });
  assert.ok(emptyHub.includes('Todavía no hay cartas publicadas'), 'hub vacío: honesto, sin ciudades inventadas');
  assert.ok(!INLINE_EVENT_ATTR.test(emptyHub), 'hub vacío: cero on*=');

  // 9. Contrato del reciclaje: seoSolutions expone las piezas compartidas.
  for (const shared of ['cleanBase', 'escapeHtml', 'safeJsonLd', 'renderHead', 'renderHeader', 'renderFooter', 'renderBreadcrumb', 'renderFaqs']) {
    assert.strictEqual(typeof seoSolutions[shared], 'function', `seoSolutions exporta ${shared} (cero drift de HTML entre landings)`);
  }
  // Pureza estructural: seoCities solo requiere al vecino seoSolutions.
  const citySrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'utils', 'seoCities.js'), 'utf8');
  const requires = citySrc.match(/require\(([^)]+)\)/g) || [];
  assert.ok(
    requires.every((r) => r.includes("'./seoSolutions'")),
    `seoCities sin I/O y solo requiere al vecino compartido (obtuvo ${requires.join(', ')})`
  );

  // ── §2 · wiring estático ─────────────────────────────────────────────────

  const discoverySrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'routes', 'discovery.js'), 'utf8');
  assert.ok(discoverySrc.includes("router.get('/ciudades'"), 'ruta GET /ciudades en discovery.js');
  assert.ok(discoverySrc.includes("router.get('/ciudades/:slug'"), 'ruta GET /ciudades/:slug en discovery.js');
  assert.ok(discoverySrc.includes('seoCities.buildCityIndex'), 'índice derivado en la ruta');
  assert.ok(discoverySrc.includes('seoCities.getCityBySlug'), 'lookup por slug en la ruta');
  assert.ok(discoverySrc.includes("'404.html'"), 'ciudad desconocida → 404.html real');
  assert.ok(discoverySrc.includes("'public, max-age=300, s-maxage=3600'"), 'Cache-Control de landings');
  assert.ok(discoverySrc.includes('cities: seoCities.buildCityIndex'), 'sitemap alimentado con el índice de ciudades');
  assert.ok(!INLINE_EVENT_ATTR.test(discoverySrc), 'discovery.js sin on*=');

  // Sitemap: el módulo puro acepta `cities` y emite hub + cada slug.
  const sitemapXml = seoDiscovery.buildSitemapXml({
    appUrl,
    restaurants: [],
    cities: [{ slug: 'mvd' }, { slug: 'punta-del-este' }]
  });
  assert.ok(sitemapXml.includes(`<loc>${appUrl}/ciudades</loc>`), 'sitemap incluye el hub de ciudades');
  assert.ok(sitemapXml.includes(`<loc>${appUrl}/ciudades/mvd</loc>`), 'sitemap incluye la ciudad');
  assert.ok(sitemapXml.includes(`<loc>${appUrl}/ciudades/punta-del-este</loc>`), 'sitemap incluye la ciudad compuesta');

  // Vercel: las 2 rutas ANTES del catch-all (como /soluciones).
  const vercelJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const routes = (vercelJson.routes || []).map((r) => r.src);
  assert.ok(routes.includes('/ciudades'), 'vercel enruta /ciudades al API');
  assert.ok(routes.includes('/ciudades/(.*)'), 'vercel enruta /ciudades/(.*) al API');
  const catchAllIdx = routes.findIndex((src) => src === '/(.*)');
  assert.ok(catchAllIdx > routes.indexOf('/ciudades') && catchAllIdx > routes.indexOf('/ciudades/(.*)'), 'las rutas de ciudades van ANTES del catch-all');

  // Archivos para IA: el hub documentado en ambos.
  const llmsTxt = fs.readFileSync(path.join(PUBLIC_DIR, 'llms.txt'), 'utf8');
  const llmsFullTxt = fs.readFileSync(path.join(PUBLIC_DIR, 'llms-full.txt'), 'utf8');
  assert.ok(llmsTxt.includes('/ciudades'), 'llms.txt enlaza el hub de ciudades');
  assert.ok(llmsFullTxt.includes('/ciudades'), 'llms-full.txt documenta /ciudades');

  // ── §3 · runtime real (server HTTP + store real, cero mocks) ─────────────

  const unique = Date.now();
  const owners = {};
  for (const key of ['a', 'b', 'c', 'demo', 'x']) {
    owners[key] = await db.createUser({
      email: `city-seo-${key}-${unique}@example.com`,
      password: 'test_password',
      email_confirmed_at: new Date().toISOString()
    });
  }
  // Ciudades ÚNICAS por corrida (como los slugs): una standalone previa deja
  // fixtures en data/ hasta el próximo purge — con ciudades fijas la copy exacta
  // ("1 local"/"2 locales") se contaminaría con el residuo.
  const cityUno = `Testciudad Uno ${unique}`;
  const cityDos = `Testciudad Dos ${unique}`;
  await db.saveRestaurant(owners.a.id, cityRestaurant(owners.a.id, `city-seo-a-${unique}`, cityUno, 'restaurant'));
  await db.saveRestaurant(owners.b.id, cityRestaurant(owners.b.id, `city-seo-b-${unique}`, `testciudad uno ${unique}`, 'heladeria'));
  await db.saveRestaurant(owners.c.id, cityRestaurant(owners.c.id, `city-seo-c-${unique}`, cityDos, 'perfumery'));
  await db.saveRestaurant(
    owners.demo.id,
    cityRestaurant(owners.demo.id, `city-seo-demo-${unique}`, cityUno, 'restaurant', { isDemo: true })
  );
  await db.saveRestaurant(
    owners.x.id,
    cityRestaurant(owners.x.id, `city-seo-x-${unique}`, cityDos, 'restaurant', {
      subscription: { status: 'canceled', plan: 'starter_monthly' }
    })
  );

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const base = `http://localhost:${port}`;
    // Slugs derivados del nombre único: dígitos → mismo slug en ambas grafías.
    const slugUno = `testciudad-uno-${unique}`;
    const slugDos = `testciudad-dos-${unique}`;
    const menuA = `/m/city-seo-a-${unique}`;
    const menuB = `/m/city-seo-b-${unique}`;
    const menuC = `/m/city-seo-c-${unique}`;

    // 1. Hub 200: html + CSP + ambas ciudades derivadas de los fixtures.
    const hubRes = await fetch(`${base}/ciudades`);
    const hubText = await hubRes.text();
    assert.strictEqual(hubRes.status, 200, '/ciudades responde 200');
    assert.ok(/text\/html/.test(hubRes.headers.get('content-type') || ''), 'content-type html');
    assert.ok(
      (hubRes.headers.get('content-security-policy') || '').includes("script-src-attr 'none'"),
      'CSP con script-src-attr none'
    );
    assert.ok(hubRes.headers.get('cache-control') || '', 'Cache-Control presente');
    assert.ok(hubText.includes('"@type":"CollectionPage"'), 'hub runtime con CollectionPage');
    assert.ok(hubText.includes(`/ciudades/${slugUno}`), 'hub lista testciudad-uno');
    assert.ok(hubText.includes(`/ciudades/${slugDos}`), 'hub lista testciudad-dos');
    assert.ok(hubText.includes('2 locales con cartas reales'), 'hub con el count real (2 en testciudad-uno)');
    assert.ok(!INLINE_EVENT_ATTR.test(hubText), 'hub runtime: cero on*=');

    // 2. Ciudad 200: sus dos menús (grafías distintas, MISMA ciudad), sin demo.
    const cityRes = await fetch(`${base}/ciudades/${slugUno}`);
    const cityText = await cityRes.text();
    assert.strictEqual(cityRes.status, 200, `/ciudades/${slugUno} responde 200`);
    assert.ok(cityText.includes(`<link rel="canonical" href="${appUrl}/ciudades/${slugUno}"`), 'canonical con slug normalizado');
    assert.ok(cityText.includes(`<h1>Cartas digitales QR en ${cityUno}</h1>`), 'H1 con la grafía dominante');
    assert.ok(cityText.includes(`href="${menuA}"`), 'lista el menú A');
    assert.ok(cityText.includes(`href="${menuB}"`), 'lista el menú B (misma ciudad, otra grafía)');
    assert.ok(!cityText.includes(`city-seo-demo-${unique}`), 'el demo NUNCA entra');
    assert.ok(cityText.includes('"@type":"ItemList"') && cityText.includes('"@type":"FAQPage"'), 'JSON-LD completo en runtime');
    assert.ok(!INLINE_EVENT_ATTR.test(cityText), 'ciudad runtime: cero on*=');
    assert.strictEqual(countOccurrences(cityText, '<script'), 1, 'ciudad runtime: un único <script>');

    // 3. Slug en MAYÚSCULAS matchea por normalización (canonical queda en lower).
    const upperRes = await fetch(`${base}/ciudades/${slugUno.toUpperCase()}`);
    assert.strictEqual(upperRes.status, 200, 'slug crudo en mayúsculas → misma ciudad');
    assert.ok((await upperRes.text()).includes(`href="${appUrl}/ciudades/${slugUno}"`), 'canonical en minúsculas');

    // 4. Ciudad Dos: 1 local real; la cancelada NO entra.
    const dosRes = await fetch(`${base}/ciudades/${slugDos}`);
    const dosText = await dosRes.text();
    assert.strictEqual(dosRes.status, 200, `/ciudades/${slugDos} responde 200`);
    assert.ok(dosText.includes(`href="${menuC}"`), 'lista el menú C');
    assert.ok(!dosText.includes(`city-seo-x-${unique}`), 'la CANCELADA no entra (filtro del route, igual que el sitemap)');
    assert.ok(dosText.includes('1 local'), 'copy honesta con 1 local');

    // 5. Ciudad desconocida → 404 (nunca se inventa la página).
    const missing = await fetch(`${base}/ciudades/rocha-que-no-existe-${unique}`);
    assert.strictEqual(missing.status, 404, 'ciudad sin locales → 404');

    // 6. Sitemap runtime: hub + cada ciudad.
    const sitemapRes = await fetch(`${base}/sitemap.xml`);
    const sitemapText = await sitemapRes.text();
    assert.strictEqual(sitemapRes.status, 200);
    assert.ok(sitemapText.includes(`${appUrl}/ciudades`), 'sitemap runtime incluye el hub');
    assert.ok(sitemapText.includes(`${appUrl}/ciudades/${slugUno}`), 'sitemap runtime incluye testciudad-uno');
    assert.ok(sitemapText.includes(`${appUrl}/ciudades/${slugDos}`), 'sitemap runtime incluye testciudad-dos');
  } finally {
    server.close();
  }

  console.log(
    '✓ SEO por ciudad validado: módulo puro (índice derivado sin inventar ciudades), JSON-LD completo, HTML sin on*=, wiring estático y runtime real (hub/ciudad/404/sitemap)'
  );
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
