const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const app = require('../api/index');
const db = require('../src/db/db');

async function runTests() {
  const unique = Date.now();
  const slug = `schema-bistro-${unique}`;
  const user = db.createUser({
    email: `schema-bistro-${unique}@example.com`,
    password: 'test_password'
  });
  db.saveRestaurant(user.id, {
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
      price: 420
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
    const appUrl = (process.env.APP_URL || 'https://menupizarron.com').replace(/\/+$/, '');
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes('<meta property="og:title" content="Schema Bistro — Menú Pizarrón"'), 'OG title identifies the restaurant');
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
    assert.strictEqual(restaurant.hasMenu.hasMenuSection[0].name, 'Platos principales');
    const menuItem = restaurant.hasMenu.hasMenuSection[0].hasMenuItem[0];
    assert.strictEqual(menuItem.name, 'Pasta fresca');
    assert.strictEqual(menuItem.offers.price, '420');
    assert.strictEqual(menuItem.offers.priceCurrency, 'UYU');
    assert.strictEqual(menuItem.description, 'Salsa casera </script><script>alert("x")</script>');

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

    const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
    const menuRoute = vercelConfig.routes.find(route => route.src === '/m/(.*)');
    assert.strictEqual(menuRoute.dest, '/api/index.js', 'Vercel routes public menus through Express');
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