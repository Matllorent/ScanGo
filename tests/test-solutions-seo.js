/**
 * Test Suite: SEO programático de "soluciones por rubro"
 * Módulo puro api/utils/seoSolutions.js + SSR de /soluciones y /soluciones/:slug.
 *
 * Verifica que el motor de landings por rubro genere, desde un catálogo
 * declarativo y sin drift:
 *
 *   1. Contenido único y completo por rubro (título, meta, H1, FAQs, demo real).
 *   2. JSON-LD correcto: WebPage + BreadcrumbList + FAQPage (y ItemList en el hub).
 *   3. HTML server-rendered SEGURO: sin scripts inline, sin atributos on*= y con
 *      todo el contenido escapado (la CSP tiene script-src-attr 'none').
 *   4. Rutas reales: /soluciones (200), cada landing (200), slug inválido (404).
 *   5. Sitemap: hub + cada landing incluidos.
 *
 * Sin mocks: server + db reales, como todo el repo.
 */
const assert = require('assert');
const http = require('http');
const app = require('../api/index');
const seoSolutions = require('../api/utils/seoSolutions');

const appUrl = (process.env.APP_URL || 'https://scango.uy').replace(/\/+$/, '');
const INLINE_EVENT_ATTR = /\son[a-z]+\s*=/i;

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function runTests() {
  // ── Fase A · módulo puro ────────────────────────────────────────────────

  // 1. Catálogo: 4 rubros, slugs únicos, campos completos y contenido real.
  const solutions = seoSolutions.getAllSolutions();
  assert.strictEqual(solutions.length, 4, 'debe haber 4 soluciones (restaurante, heladería, perfumería, eventos)');
  const slugs = solutions.map((s) => s.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length, 'slugs únicos');
  assert.deepStrictEqual(
    solutions.map((s) => s.key).sort(),
    ['events', 'heladeria', 'perfumery', 'restaurant'],
    'cubre los 4 rubros del producto'
  );
  for (const s of solutions) {
    for (const field of ['slug', 'title', 'metaDescription', 'h1', 'eyebrow', 'lead', 'demoSlug', 'businessType']) {
      assert.ok(s[field] && String(s[field]).trim(), `${s.slug}: falta "${field}"`);
    }
    assert.ok(s.title.length <= 90, `${s.slug}: título demasiado largo (${s.title.length})`);
    assert.ok(s.metaDescription.length >= 70 && s.metaDescription.length <= 175, `${s.slug}: metaDescription fuera de rango`);
    assert.ok(s.highlights.length >= 3, `${s.slug}: al menos 3 highlights`);
    assert.ok(s.pains.length >= 3, `${s.slug}: al menos 3 pains`);
    assert.ok(s.features.length >= 5, `${s.slug}: al menos 5 features`);
    assert.ok(s.faqs.length >= 3, `${s.slug}: al menos 3 FAQs`);
    for (const faq of s.faqs) {
      assert.ok(faq.q && faq.a, `${s.slug}: FAQ con pregunta y respuesta`);
      assert.notStrictEqual(faq.a.toLowerCase(), faq.q.toLowerCase(), `${s.slug}: la respuesta no repite la pregunta`);
    }
    assert.ok(s.demoSlug.startsWith('demo-'), `${s.slug}: enlaza a un demo real /m/demo-*`);
  }
  assert.strictEqual(seoSolutions.getSolutionBySlug('  MENU-DIGITAL-PARA-HELADERIAS  ').key, 'heladeria', 'slug normalizado');
  assert.strictEqual(seoSolutions.getSolutionBySlug('no-existe'), null, 'slug inexistente → null');
  assert.strictEqual(seoSolutions.getSolutionBySlug(undefined), null, 'slug undefined → null');

  // 2. JSON-LD por landing: BreadcrumbList (3) + WebPage + FAQPage.
  const heladeria = seoSolutions.getSolutionBySlug('menu-digital-para-heladerias');
  const landingLd = seoSolutions.buildSolutionJsonLd(heladeria, appUrl);
  assert.strictEqual(landingLd['@context'], 'https://schema.org');
  const types = landingLd['@graph'].map((n) => n['@type']);
  assert.deepStrictEqual(types, ['BreadcrumbList', 'WebPage', 'FAQPage'], 'orden de nodos esperado');
  const breadcrumb = landingLd['@graph'][0];
  assert.strictEqual(breadcrumb.itemListElement.length, 3, 'Inicio → Soluciones → rubro');
  assert.strictEqual(breadcrumb.itemListElement[1].item, `${appUrl}/soluciones`, 'item del hub');
  assert.strictEqual(breadcrumb.itemListElement[2].item, `${appUrl}/soluciones/${heladeria.slug}`, 'item de la landing');
  const faqNode = landingLd['@graph'][2];
  assert.strictEqual(faqNode.mainEntity.length, heladeria.faqs.length, 'una Question por FAQ');
  assert.strictEqual(faqNode.mainEntity[0]['acceptedAnswer']['@type'], 'Answer');
  JSON.parse(JSON.stringify(landingLd)); // serializable

  // 3. JSON-LD del hub: CollectionPage + ItemList con las 4 landings.
  const hubLd = seoSolutions.buildSolutionsIndexJsonLd(appUrl);
  const collection = hubLd['@graph'].find((n) => n['@type'] === 'CollectionPage');
  assert.ok(collection, 'CollectionPage presente en el hub');
  assert.strictEqual(collection.mainEntity['@type'], 'ItemList');
  assert.strictEqual(collection.mainEntity.itemListElement.length, 4, 'ItemList con 4 rubros');

  // 4. Renderizado: contenido, enlaces y seguridad (cero on*=, un solo script).
  const html = seoSolutions.renderSolutionHtml(heladeria, { appUrl });
  for (const token of [
    `<link rel="canonical" href="${appUrl}/soluciones/${heladeria.slug}"`,
    `<h1>${heladeria.h1}</h1>`,
    `href="/m/${heladeria.demoSlug}"`,
    `href="/?registro=1&amp;rubro=heladeria"`,
    '"@type":"FAQPage"',
    heladeria.faqs[0].q
  ]) {
    assert.ok(html.includes(token), `render landing debe incluir ${token}`);
  }
  assert.ok(!INLINE_EVENT_ATTR.test(html), 'render landing: cero atributos on*=');
  assert.strictEqual(countOccurrences(html, '<script'), 1, 'render landing: un único <script> (JSON-LD)');
  assert.ok(html.includes('<script type="application/ld+json">'), 'ese script es el JSON-LD');
  assert.ok(!html.includes('<script src'), 'sin scripts externos');

  const hubHtml = seoSolutions.renderSolutionsIndexHtml({ appUrl });
  for (const s of solutions) {
    assert.ok(hubHtml.includes(`/soluciones/${s.slug}`), `hub enlaza a ${s.slug}`);
  }
  assert.ok(!INLINE_EVENT_ATTR.test(hubHtml), 'hub: cero atributos on*=');
  assert.strictEqual(countOccurrences(hubHtml, '<script'), 1, 'hub: un único <script>');

  // 5. Utilidades puras de escape.
  assert.strictEqual(seoSolutions.escapeHtml('<img onerror=x>'), '&lt;img onerror=x&gt;', 'escapeHtml neutraliza tags');
  assert.ok(!seoSolutions.safeJsonLd({ a: '</script><x>' }).includes('</script>'), 'safeJsonLd neutraliza </script>');
  assert.ok(seoSolutions.safeJsonLd({ a: 'a&b' }).includes('\\u0026'), 'safeJsonLd escapa &');

  // ── Fase B · runtime (rutas + sitemap + CSP) ─────────────────────────────
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const base = `http://localhost:${port}`;

    // 6. Hub.
    const hubRes = await fetch(`${base}/soluciones`);
    const hubText = await hubRes.text();
    assert.strictEqual(hubRes.status, 200, '/soluciones responde 200');
    assert.ok(/text\/html/.test(hubRes.headers.get('content-type') || ''), 'content-type html');
    for (const s of solutions) {
      assert.ok(hubText.includes(`/soluciones/${s.slug}`), `hub runtime enlaza a ${s.slug}`);
    }
    assert.ok(hubText.includes('"@type":"CollectionPage"'), 'hub runtime incluye CollectionPage');

    // 7. Cada landing responde 200 con su canonical y su FAQPage.
    for (const s of solutions) {
      const res = await fetch(`${base}/soluciones/${s.slug}`);
      const text = await res.text();
      assert.strictEqual(res.status, 200, `/soluciones/${s.slug} responde 200`);
      assert.ok(text.includes(`<link rel="canonical" href="${appUrl}/soluciones/${s.slug}"`), `${s.slug}: canonical`);
      assert.ok(text.includes('"@type":"FAQPage"'), `${s.slug}: FAQPage`);
      assert.ok(text.includes(`<h1>${s.h1}</h1>`), `${s.slug}: H1 único`);
      // CSP transicional con script-src-attr 'none' aplicada por el middleware.
      const csp = res.headers.get('content-security-policy') || '';
      assert.ok(csp.includes("script-src-attr 'none'"), `${s.slug}: CSP con script-src-attr 'none'`);
    }

    // 8. Slug inválido → 404 (no inventa páginas).
    const missing = await fetch(`${base}/soluciones/no-existe-123`);
    assert.strictEqual(missing.status, 404, 'slug inválido → 404');

    // 9. Sitemap: hub + cada landing.
    const sitemapRes = await fetch(`${base}/sitemap.xml`);
    const sitemapText = await sitemapRes.text();
    assert.strictEqual(sitemapRes.status, 200);
    assert.ok(sitemapText.includes(`${appUrl}/soluciones`), 'sitemap incluye el hub');
    for (const s of solutions) {
      assert.ok(sitemapText.includes(`${appUrl}/soluciones/${s.slug}`), `sitemap incluye ${s.slug}`);
    }
  } finally {
    server.close();
  }

  console.log('✓ Soluciones SEO validadas: catálogo por rubro, JSON-LD (WebPage+Breadcrumb+FAQ), HTML sin on*=, rutas 200/404 y sitemap');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
