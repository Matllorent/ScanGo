/**
 * tests/test-discover.js
 * ───────────────────────
 * Descubrir beta (formato tiktok de la zona, en prueba):
 *  1. `allowDiscovery` es opt-in estricto (default false).
 *  2. El feed solo lista opt-in con suscripción válida (cancelados afuera).
 *  3. Sin PII: nunca teléfono, dirección, userId ni emails.
 *  4. Me gusta: canal público + conteo por plato (un like por navegador).
 *  5. Filtro por ciudad + paginación + cache.
 *  6. Página /descubrir 200 (sin on*=) + entradas (menú 🧭, landing).
 *  7. Studio: toggle opt-in con save/load.
 *  8. Pedido single-local: deep-link ?dish= (scroll+flash) y botón Pedir.
 *
 * Cero mocks: server HTTP real + DB real (local/cloud según entorno).
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const app = require('../api/index');
const db = require('../src/db/db');
const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');

const ROOT = path.join(__dirname, '..');

async function runTests() {
  console.log('🧪 Descubrir beta: feed de la zona + me gusta + pedido single-local...');

  // ── 1) Opt-in estricto en el saneador ───────────────────────────────────
  const base = sanitizeRestaurantPayload({ name: 'X', dishes: [] });
  assert.strictEqual(base.allowDiscovery, false, 'default apagado (nadie aparece sin querer)');
  assert.strictEqual(sanitizeRestaurantPayload({ allowDiscovery: true }).allowDiscovery, true, 'true explícito pasa');
  assert.strictEqual(sanitizeRestaurantPayload({ allowDiscovery: 'true' }).allowDiscovery, false, 'string no es opt-in');
  assert.strictEqual(sanitizeRestaurantPayload({ allowDiscovery: 1 }).allowDiscovery, false, 'número no es opt-in');
  console.log('✓ allowDiscovery opt-in estricto (solo === true)');

  const stamp = Date.now();
  const mkUser = (tag) => db.createUser({ email: `discover-${tag}-${stamp}@example.com`, password: 'test_password' });
  const u1 = await mkUser('on');
  const u2 = await mkUser('off');
  const u3 = await mkUser('canceled');

  const activeSub = { status: 'active', plan: 'pro_monthly', provider: 'stripe' };
  const rOn = await db.saveRestaurant(u1.id, {
    name: 'Descubrir QA 1', slug: `discover-qa1-${stamp}`, city: 'Montevideo', currency: '$',
    latitude: -34.9, longitude: -56.16,
    subscription: activeSub, allowDiscovery: true,
    categories: [{ id: 'c1', name: 'Platos' }],
    dishes: [
      { id: 'dd1', name: 'Mila Descubrir', price: 500, categoryId: 'c1', photoUrl: 'https://cdn.example.com/mila.jpg', description: 'gigante' },
      { id: 'dd2', name: 'Faina Simple', price: 120, categoryId: 'c1', outOfStock: true },
      { id: 'dd3', name: 'Panchito', price: 200, categoryId: 'c1' },
      { id: 'dd4', name: 'Happy Hour Solo', price: 300, categoryId: 'c1', schedule: { enabled: true, days: [1, 2, 3, 4, 5], timeStart: '18:00', timeEnd: '20:00', behavior: 'hide' } }
    ]
  });
  await db.saveRestaurant(u2.id, {
    name: 'Descubrir QA 2', slug: `discover-qa2-${stamp}`, city: 'Montevideo',
    subscription: activeSub, phone: '59899000111', address: 'Calle Falsa 123',
    categories: [{ id: 'c1', name: 'Platos' }],
    dishes: [{ id: 'dd9', name: 'Oculto', price: 10, categoryId: 'c1' }]
  });
  await db.saveRestaurant(u3.id, {
    name: 'Descubrir QA 3', slug: `discover-qa3-${stamp}`, city: 'Montevideo',
    subscription: { status: 'canceled', plan: 'pro_monthly' }, allowDiscovery: true,
    categories: [{ id: 'c1', name: 'Platos' }],
    dishes: [{ id: 'dd8', name: 'Cancelado', price: 10, categoryId: 'c1' }]
  });
  const u4 = await mkUser('far');
  await db.saveRestaurant(u4.id, {
    name: 'Descubrir QA Lejos', slug: `discover-far-${stamp}`, city: 'Punta del Este',
    latitude: -34.96, longitude: -54.94,
    subscription: activeSub, allowDiscovery: true,
    categories: [{ id: 'c1', name: 'Platos' }],
    dishes: [{ id: 'dd7', name: 'Lejano', price: 10, categoryId: 'c1' }]
  });
  const u5 = await mkUser('nogeo');
  await db.saveRestaurant(u5.id, {
    name: 'Descubrir QA Sin Geo', slug: `discover-nogeo-${stamp}`, city: 'Montevideo',
    subscription: activeSub, allowDiscovery: true,
    categories: [{ id: 'c1', name: 'Platos' }],
    dishes: [{ id: 'dd6', name: 'Sin Ubicación', price: 10, categoryId: 'c1' }]
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    // ── 2) Feed: solo opt-in válido ───────────────────────────────────────
    const feedRes = await fetch(`${baseUrl}/api/discover/feed?limit=24`);
    assert.strictEqual(feedRes.status, 200, 'GET /feed → 200 sin auth');
    assert.ok((feedRes.headers.get('cache-control') || '').includes('max-age=60'), 'cache 60s (no fundir la DB)');
    const feed = (await feedRes.json()).data;
    assert.strictEqual(feed.beta, true, 'feed marcado beta (honesto, es prueba)');
    const ids = feed.items.map(i => i.dish ? i.dish.id : i.id);
    assert.ok(ids.includes('dd1'), 'plato opt-in visible');
    assert.ok(!ids.includes('dd2'), 'agotado no se publicita');
    assert.ok(!ids.includes('dd4'), 'plato con franja no se publicita (feed evergreen)');
    assert.ok(!ids.includes('dd9'), 'sin opt-in afuera aunque tenga suscripción');
    assert.ok(!ids.includes('dd8'), 'cancelado afuera aunque tenga opt-in');
    console.log('✓ Feed: solo opt-in válido (agotados, no-opt y cancelados afuera)');

    // ── 3) Sin PII ────────────────────────────────────────────────────────
    const blob = JSON.stringify(feed.items);
    for (const leak of ['59899000111', 'Calle Falsa', 'userId', 'user_id', '@example.com', 'password']) {
      assert.ok(!blob.includes(leak), `el feed no filtra: ${leak}`);
    }
    const first = feed.items.find(i => (i.dish ? i.dish.id : i.id) === 'dd1' && i.restaurant && i.restaurant.slug === rOn.slug);
    assert.ok(first, 'el plato de ESTA corrida está en el feed');
    const item = first.dish || first;
    assert.strictEqual(item.name, 'Mila Descubrir', 'nombre real');
    assert.strictEqual(item.price, 500, 'precio real');
    assert.strictEqual(item.photoUrl, 'https://cdn.example.com/mila.jpg', 'foto real');
    assert.ok(item.restaurant && item.restaurant.slug === rOn.slug, 'restaurante con slug para deep-link');
    assert.ok(!('phone' in (item.restaurant || {})), 'restaurante sin teléfono');
    assert.strictEqual(item.restaurant.ordersEnabled, true, 'feed expone ordersEnabled (vitrina → "Ver carta")');
    console.log('✓ Sin PII en el feed (teléfono/dirección/users afuera)');

    // ── 4) Me gusta: canal + conteo ───────────────────────────────────────
    const likeRes = await fetch(`${baseUrl}/api/public/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: rOn.slug, event: 'dish_like', dishId: 'dd1' })
    });
    assert.strictEqual(likeRes.status, 200, 'dish_like aceptado en el canal público');
    const feed2 = (await fetch(`${baseUrl}/api/discover/feed?limit=24`).then(r => r.json())).data;
    const liked = feed2.items.map(i => (i.dish ? i.dish : i)).find(i => i.id === 'dd1' && i.restaurant && i.restaurant.slug === rOn.slug);
    assert.ok(liked, 'el plato likeado es el de esta corrida');
    assert.strictEqual(liked.likeCount, 1, 'likeCount refleja el me gusta');
    const likeNoDish = await fetch(`${baseUrl}/api/public/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: rOn.slug, event: 'dish_like' })
    });
    assert.strictEqual(likeNoDish.status, 400, 'dish_like sin plato se rechaza (anti-ruido)');
    console.log('✓ Me gusta: evento + conteo por plato');

    // ── 5) Ciudad + paginación ────────────────────────────────────────────
    const cityRes = await fetch(`${baseUrl}/api/discover/feed?city=montevideo&limit=24`);
    assert.strictEqual(cityRes.status, 200, 'filtro ciudad 200');
    assert.ok((await cityRes.json()).data.items.length >= 1, 'Montevideo trae el local');
    const emptyCity = await fetch(`${baseUrl}/api/discover/feed?city=ciudad-inexistente-xyz&limit=24`);
    const emptyBody = (await emptyCity.json()).data;
    assert.strictEqual(emptyBody.items.length, 0, 'ciudad sin locales → vacío honesto');
    assert.strictEqual(emptyBody.nextOffset, null, 'sin página siguiente');
    const page1 = (await fetch(`${baseUrl}/api/discover/feed?limit=1&offset=0`).then(r => r.json())).data;
    assert.strictEqual(page1.items.length, 1, 'límite respeta página');
    console.log('✓ Ciudad, vacío honesto y paginación');

    // ── 5b) Orden: mix justo vs top tendencias ─────────────────────────────
    const badSort = await fetch(`${baseUrl}/api/discover/feed?sort=hack`);
    assert.strictEqual(badSort.status, 400, 'sort inválido se rechaza');
    const topFeed = (await fetch(`${baseUrl}/api/discover/feed?limit=24&sort=top`).then(r => r.json())).data;
    const counts = topFeed.items.map(i => i.likeCount);
    const ordered = [...counts].sort((a, b) => b - a);
    assert.deepStrictEqual(counts, ordered, 'sort=top ordena global por likes desc');
    console.log('✓ Sort mix/top (tendencias reales, no top de página)');

    // ── 5c) Radio de cercanía ───────────────────────────────────────────────
    const geo = require('../api/utils/geo');
    assert.ok(Math.abs(geo.haversineKm(-34.9, -56.16, -34.9, -56.16)) < 0.001, 'mismo punto = 0km');
    const oneDeg = geo.haversineKm(0, 0, 1, 0);
    assert.ok(oneDeg > 110 && oneDeg < 112, '1° de latitud ≈ 111km (Haversine real)');
    assert.ok(geo.haversineKm(-34.9, -56.16, -34.96, -54.94) > 100, 'MVD→PDE > 100km');
    assert.strictEqual(geo.haversineKm('x', 0, 0, 0), null, 'coordenada inválida = null');
    assert.strictEqual(geo.isValidLatLng(-91, 0), false, 'lat fuera de rango');
    assert.strictEqual(geo.roundCoord(-34.90555), -34.906, 'redondeo a 3 decimales (~100m, privacidad)');
    const nearRes = await fetch(`${baseUrl}/api/discover/feed?lat=-34.90&lng=-56.16&radiusKm=10&limit=24`);
    assert.strictEqual(nearRes.status, 200, 'radio responde 200');
    const nearIds = (await nearRes.json()).data.items.map(i => i.id);
    assert.ok(nearIds.includes('dd1'), 'local cercano adentro del radio');
    assert.ok(!nearIds.includes('dd7'), 'local a +100km afuera del radio');
    assert.ok(!nearIds.includes('dd6'), 'local sin coords afuera del radio (no se puede probar cercanía)');
    const nearItem = (await fetch(`${baseUrl}/api/discover/feed?lat=-34.90&lng=-56.16&radiusKm=10&limit=24`).then(r => r.json())).data.items.find(i => i.id === 'dd1');
    assert.ok(Number.isFinite(nearItem.restaurant.distanceKm) && nearItem.restaurant.distanceKm < 10, 'distanceKm informada y dentro del radio');
    const badGeo = await fetch(`${baseUrl}/api/discover/feed?lat=200&lng=0`);
    assert.strictEqual(badGeo.status, 400, 'lat inválida se rechaza');
    const badRadius = await fetch(`${baseUrl}/api/discover/feed?lat=-34.9&lng=-56.16&radiusKm=500`);
    assert.strictEqual(badRadius.status, 400, 'radio fuera de 1..50 se rechaza');
    console.log('✓ Radio: Haversine, filtro, distancia, sin coords afuera, params validados');

    // ── 9b) Anti-fantasma ─────────────────────────────────────────────────
    const ghostLike = await fetch(`${baseUrl}/api/public/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: rOn.slug, event: 'dish_like', dishId: 'plato-de-otro-local' })
    });
    assert.strictEqual(ghostLike.status, 400, 'like a plato ajeno se rechaza');
    const noindexPage = await fetch(`${baseUrl}/descubrir`).then(r => r.text());
    assert.ok(noindexPage.includes('noindex,follow'), '/descubrir no se indexa (feed fino beta)');
    console.log('✓ Anti-fantasma y noindex');

    // ── 6) Página /descubrir ──────────────────────────────────────────────
    const pageRes = await fetch(`${baseUrl}/descubrir`);
    assert.strictEqual(pageRes.status, 200, 'GET /descubrir → 200');
    const pageHtml = await pageRes.text();
    assert.ok(pageHtml.includes('/js/discover.js'), 'carga discover.js (cero inline)');
    assert.ok(!/on(click|change|input|submit)=/i.test(pageHtml), 'cero on*= en discover.html');
    assert.ok(pageHtml.includes('id="dzOwnerLine"') && pageHtml.includes('id="dzBackLink"'), 'textos vía dict i18n');
    console.log('✓ /descubrir 200, CSP-safe y honesta');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  // ── 7) Studio: toggle + entradas ────────────────────────────────────────
  const studioHtml = fs.readFileSync(path.join(ROOT, 'public/studio.html'), 'utf8');
  assert.ok(studioHtml.includes('id="inputAllowDiscovery"'), 'studio tiene el toggle opt-in');
  const studioJs = fs.readFileSync(path.join(ROOT, 'public/js/studio.js'), 'utf8');
  assert.ok(studioJs.includes('inputAllowDiscovery'), 'studio guarda y carga el flag');
  const menuHtml = fs.readFileSync(path.join(ROOT, 'public/menu.html'), 'utf8');
  assert.ok(menuHtml.includes('href="/descubrir"'), 'el menú enlaza a Descubrir (🧭)');
  const landing = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(landing.includes('href="/descubrir"'), 'la landing enlaza a Descubrir');
  console.log('✓ Studio opt-in + entradas (menú y landing)');

  // ── 8) Pedido single-local ──────────────────────────────────────────────
  const menuJs = fs.readFileSync(path.join(ROOT, 'public/js/menu.js'), 'utf8');
  assert.ok(menuJs.includes('maybeOpenDishDeepLink'), 'menu conserva el wrapper ?dish=');
  const trackingSrc2 = fs.readFileSync(path.join(ROOT, 'public/js/menu/orderTracking.js'), 'utf8');
  assert.ok(trackingSrc2.includes("params.get('dish')") && trackingSrc2.includes('dishLinkConsumed'), 'el módulo consume ?dish= (scroll+flash)');
  const storiesMod = fs.readFileSync(path.join(ROOT, 'public/js/menu/storiesLayout.js'), 'utf8');
  assert.ok(storiesMod.includes('enterDiscoverMode'), 'storiesLayout expone modo discover');
  assert.ok(storiesMod.includes("'/m/' + st.slug + '?dish='"), 'Pedir lleva al local con deep-link (sin carrito mixto)');
  assert.ok(storiesMod.includes('scango_likes'), 'likes con un voto por navegador');
  console.log('✓ Pedido single-local: deep-link ?dish= + botón Pedir por local');

  console.log('🎉 ¡DESCUBRIR BETA VERIFICADO: feed honesto + likes + pedido por local!');

  // ── 9) Auditoría de estándares: rendimiento, share y ruido ───────────────
  const storiesSrc = fs.readFileSync(path.join(ROOT, 'public/js/menu/storiesLayout.js'), 'utf8');
  assert.ok(storiesSrc.includes('requestAnimationFrame'), 'scroll del overlay throttled por rAF (400 rects por evento = jank)');
  assert.ok(storiesSrc.includes('/m/${st.slug}?dish=${encodeURIComponent(st.id)}'), 'compartir en Descubrir lleva al plato exacto');
  const menuCss = fs.readFileSync(path.join(ROOT, 'public/css/menu.css'), 'utf8');
  assert.ok(menuCss.includes('content-visibility: auto'), 'tarjetas con render diferido (cartas largas)');
  const discoverJs = fs.readFileSync(path.join(ROOT, 'public/js/discover.js'), 'utf8');
  assert.ok(discoverJs.includes('dzMore') && discoverJs.includes('resumeAt'), 'Ver más pagina sin perder posición');
  const studioJsAudit = fs.readFileSync(path.join(ROOT, 'public/js/studio.js'), 'utf8');
  assert.ok(studioJsAudit.includes('loadReviewFunnel()'), 'el embudo se auto-carga en Studio');
  // ── 9) Auditoría de estándares ────────────────────────────────────────────
  const discoverSrc = fs.readFileSync(path.join(ROOT, 'public/js/discover.js'), 'utf8');
  for (const lang of ['es:', 'en:', 'pt:']) {
    assert.ok(discoverSrc.includes(lang), `discover.js debe tener bloque ${lang}`);
  }
  for (const key of ['title:', 'loading:', 'geoOn:', 'empty:', 'more:', 'fail:', 'ownerLine:', 'backHome:']) {
    const occurrences = (discoverSrc.match(new RegExp(key, 'g')) || []).length;
    assert.ok(occurrences >= 3, `discover ${key} en los 3 idiomas`);
  }
  assert.ok(discoverSrc.includes('sin carrito mixto') || discoverSrc.includes('cada pedido'), 'el dict aclara pedido por local');
  const reqIdSrc = fs.readFileSync(path.join(ROOT, 'api/middleware/requestId.js'), 'utf8');
  assert.ok(reqIdSrc.includes("split('?')[0]"), 'los logs no guardan query strings (coords fuera de logs)');
  console.log('✓ Auditoría: rAF-throttle, share al plato, content-visibility, Ver más, anti-ruido y funnel auto');
}

runTests().catch(err => {
  console.error('❌ Descubrir beta FALLÓ:', err);
  process.exit(1);
});
