const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const app = require('../api/index');
const db = require('../src/db/db');
const menuSlug = require('../api/utils/menuSlug');

async function runTests() {
  // ── §0 Slug canónico: UNA regla en backend (CJS) y Studio (ESM) ────────────
  // Un slug que el Studio muestra como válido TIENE que ser el mismo que el
  // servidor persiste; si divergen, la URL copiada puede dar 404.
  {
    const slugField = await import('../public/js/studio/slugField.js');
    assert.strictEqual(slugField.MENU_SLUG_MAX_LENGTH, menuSlug.MENU_SLUG_MAX_LENGTH, 'tope idéntico CJS↔ESM');
    const corpus = [
      null, undefined, '', '   ', 'Café Ñandú', '  --Hola--Mundo--  ',
      'a'.repeat(60), `${'A'.repeat(29)} b`, 'über straße', '100% café',
      0, 12345, {}, [], 'emoji 🍕 pizza', 'a_'.repeat(20), 'schema-bistro-1234567890123'
    ];
    for (const raw of corpus) {
      assert.strictEqual(
        slugField.normalizeMenuSlug(raw),
        menuSlug.normalizeMenuSlug(raw),
        `paridad normalizeMenuSlug para ${JSON.stringify(raw)}`
      );
      assert.strictEqual(
        slugField.isValidMenuSlug(raw),
        menuSlug.isValidMenuSlug(raw),
        `paridad isValidMenuSlug para ${JSON.stringify(raw)}`
      );
    }
    const long = 'x'.repeat(40);
    assert.strictEqual(menuSlug.normalizeMenuSlug(long).length, 30, 'tope de 30 aplicado');
    assert.strictEqual(slugField.buildPublicMenuUrl('https://localhost', 'Café Ñandú'), 'https://www.scango.uy/m/cafe-nandu', 'shell nativo → dominio oficial');
    assert.strictEqual(slugField.buildPublicMenuUrl('javascript:alert(1)', 'x'), 'https://www.scango.uy/m/x', 'origen hostil neutralizado');
    assert.strictEqual(slugField.buildPublicMenuUrl('https://www.scango.uy', ''), '', 'sin slug no hay URL');
    console.log('✓ §0 slug canónico: paridad CJS↔ESM + tope 30 + URL pública honesta');
  }

  const unique = Date.now();
  const slug = `schema-bistro-${unique}`;
  const user = await db.createUser({
    email: `schema-bistro-${unique}@example.com`,
    password: 'test_password'
  });
  await db.saveRestaurant(user.id, {
    name: 'Schema Bistro',
    bizName: 'Schema Bistro',
    slug,
    slogan: 'Cocina & pastas',
    currency: 'UYU',
    phone: '+59899123456',
    city: 'Montevideo',
    bannerUrl: 'https://example.com/schema-bistro.jpg',
    categories: [{ id: 'cat-main', name: 'Platos principales' }],
    dishes: [{
      id: 'dish-pasta',
      categoryId: 'cat-main',
      name: 'Pasta fresca',
      description: 'Salsa casera </script><script>alert("x")</script>',
      price: 420,
      tags: ['celiac', 'vegano']
    }]
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));

  try {
    const { port } = server.address();
    const apiResponse = await fetch(`http://localhost:${port}/api/menu/${slug}`);
    const publicMenu = await apiResponse.json();
    assert.strictEqual(apiResponse.status, 200, `Public menu API failed: ${JSON.stringify(publicMenu)}`);
    assert.strictEqual(publicMenu.restaurant.name, 'Schema Bistro');

    const response = await fetch(`http://localhost:${port}/m/${slug}`);
    const html = await response.text();
    const appUrl = (process.env.APP_URL || 'https://scango.uy').replace(/\/+$/, '');
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes('<meta property="og:title" content="Schema Bistro — ScanGo"'), 'OG title identifies the restaurant');
    assert.ok(html.includes('<meta property="og:description" content="Cocina &amp; pastas"'), 'OG description is HTML-escaped');
    assert.ok(html.includes('<meta property="og:image" content="https://example.com/schema-bistro.jpg"'), 'OG image uses the restaurant banner');
    assert.ok(html.includes(`<link rel="canonical" href="${appUrl}/m/${slug}"`), 'Canonical URL identifies the menu');
    assert.ok(html.includes('<script type="module" src="/js/menu.js"></script>'), 'The menu ES module remains available');
    assert.ok(html.includes('<script type="module" src="/js/menu-modules.js"></script>'), 'The menu components ES module remains available');

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLdMatch, 'Menu page includes JSON-LD');
    const restaurant = JSON.parse(jsonLdMatch[1]);
    assert.strictEqual(restaurant['@type'], 'Restaurant');
    assert.strictEqual(restaurant.name, 'Schema Bistro');
    assert.strictEqual(restaurant.hasMenu['@type'], 'Menu');
    assert.strictEqual(restaurant.areaServed, 'Montevideo', 'areaServed local para SEO de cercanía');
    assert.strictEqual(restaurant.hasMenu.hasMenuSection[0].name, 'Platos principales');
    const menuItem = restaurant.hasMenu.hasMenuSection[0].hasMenuItem[0];
    assert.strictEqual(menuItem.name, 'Pasta fresca');
    assert.strictEqual(menuItem.offers.price, '420');
    assert.strictEqual(menuItem.offers.priceCurrency, 'UYU');
    assert.strictEqual(menuItem.description, 'Salsa casera </script><script>alert("x")</script>');
    assert.deepStrictEqual(menuItem.suitableForDiet, [
      'https://schema.org/GlutenFreeDiet',
      'https://schema.org/VeganDiet'
    ], 'suitableForDiet enriquecido en Schema.org para GEO e IA');

    // §ETag — revalidación barata del SSR público (crawlers/CDN).
    const etagRes = await fetch(`http://localhost:${port}/m/${slug}`);
    assert.strictEqual(etagRes.status, 200);
    const etag = etagRes.headers.get('etag');
    assert.ok(etag && etag.startsWith('W/"m-'), `ETag débil esperado, recibido: ${etag}`);
    assert.ok((etagRes.headers.get('cache-control') || '').includes('s-maxage=60'), 'Cache-Control CDN esperado');
    await etagRes.text();
    const notModified = await fetch(`http://localhost:${port}/m/${slug}`, {
      headers: { 'If-None-Match': etag }
    });
    assert.strictEqual(notModified.status, 304, 'If-None-Match idéntico debe responder 304');
    assert.strictEqual(await notModified.text(), '', '304 sin body');

    // §Suscripción — un flip por webhook/cron cambia el HTML (pausado ↔
    // online): invalida la caché e invalida el ETag (incluye
    // subscription.updatedAt). Sin esto el comensal vería 304 con lo viejo.
    const restFlip = db.findRestaurantBySlug(slug);
    await db.updateSubscription(restFlip.id, { status: 'past_due', provider: 'test' });
    const afterFlip = await fetch(`http://localhost:${port}/m/${slug}`, {
      headers: { 'If-None-Match': etag }
    });
    assert.strictEqual(afterFlip.status, 200, 'tras flip de suscripción el ETag viejo ya no vale 304');
    const etag2 = afterFlip.headers.get('etag');
    assert.ok(etag2 && etag2 !== etag, 'ETag versionado con la suscripción');
    await afterFlip.text();
    const stableAgain = await fetch(`http://localhost:${port}/m/${slug}`, {
      headers: { 'If-None-Match': etag2 }
    });
    assert.strictEqual(stableAgain.status, 304, 'el ETag nuevo vuelve a 304');
    console.log('✓ Flip de suscripción invalida caché + ETag (sin menú pausado fantasma)');

    const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
    const menuRoute = vercelConfig.routes.find(route => route.src === '/m/(.*)');
    assert.strictEqual(menuRoute.dest, '/api/index.js', 'Vercel routes public menus through Express');

    // §Evento — el preview OG debe contar la celebración (pareja/fecha/lugar),
    // no el genérico "ScanGo" (invitaciones estéticas al compartir).
    const evtUnique = `${unique}-evt`;
    // El slug canónico tiene tope 30 (api/utils/menuSlug.js): el fixture debe
    // respetarlo o la URL quedaría fuera del límite (y el SSR serviría el 404).
    const evtSlug = `evento-${evtUnique}`;
    const evtUser = await db.createUser({ email: `evento-preview-${evtUnique}@example.com`, password: 'test_password' });
    await db.saveRestaurant(evtUser.id, {
      name: 'Estancia La Ribera',
      bizName: 'Estancia La Ribera',
      slug: evtSlug,
      businessType: 'events',
      currency: 'UYU',
      phone: '+59899123456',
      eventDate: '2027-12-12T20:00:00.000Z',
      weddingItinerary: {
        enabled: true,
        title: 'Programa de la fiesta',
        coupleNames: 'Martina & Santi',
        date: '12 de diciembre de 2027',
        venue: 'Salón Ensigna — Canelones'
      },
      categories: [{ id: 'cat-fiesta', name: 'Menú de la Fiesta' }],
      dishes: [{ id: 'dish-rec', categoryId: 'cat-fiesta', name: 'Bocados de bienvenida', price: 0 }]
    });
    const evtResponse = await fetch(`http://localhost:${port}/m/${evtSlug}`);
    const evtHtml = await evtResponse.text();
    assert.strictEqual(evtResponse.status, 200, 'SSR del evento responde 200');
    assert.ok(
      evtHtml.includes('<meta property="og:title" content="Boda: Martina &amp; Santi — Estancia La Ribera — ScanGo"'),
      'Evento: OG title con pareja (y "&" escapado)'
    );
    assert.ok(
      evtHtml.includes('<meta property="og:description" content="12 de diciembre de 2027 · Salón Ensigna — Canelones"'),
      'Evento: OG description con fecha y lugar'
    );
    assert.ok(
      evtHtml.includes(`<meta property="og:image" content="${appUrl}/og-cover.png"`),
      'Evento: fallback de imagen apunta al cover real'
    );
    // El archivo de respaldo existe y es un PNG válido (referencia rota arreglada).
    const ogCoverPath = path.join(__dirname, '../public/og-cover.png');
    const ogCoverBuf = fs.readFileSync(ogCoverPath);
    assert.strictEqual(ogCoverBuf.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'og-cover.png existe con firma PNG real');
    console.log('✓ Menú SSR: Open Graph, Restaurant/Menu JSON-LD, precios/moneda y escape seguros');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

runTests().catch(error => {
  console.error('❌ Error en prueba de SEO del menú:', error);
  process.exitCode = 1;
});