/**
 * Test Suite: Descubrimiento SEO/GEO — compilador api/utils/seoDiscovery.js
 *
 * Verifica que el SaaS genere automáticamente la infraestructura de
 * descubrimiento de cada restaurante desde la data YA validada (sin drift):
 *
 *   1. OpeningHoursSpecification DERIVADO del horario real (scheduleActiveHours,
 *      la misma fuente de verdad que computeOpenStatus del Bloque 1) con
 *      soporte de ventana nocturna (18:00-02:00 = dos tramos).
 *   2. robots.txt con política de rastreo clásica + rastreadores de IA por
 *      user-agent (OAI-SearchBot, PerplexityBot, GPTBot…) y paneles privados
 *      fuera del índice.
 *   3. sitemap.xml con menús activos, CADA sucursal real (?branch=) y legales
 *      (lastmod por restaurante); en producción Vercel lo sirve Express (los
 *      estáticos public/robots.txt y public/sitemap.xml fueron eliminados).
 *   4. noindex,follow en los paneles privados (studio/admin/reset/email-verified).
 *
 * Sin mocks: usamos flujos reales (server + db) como todo el repo.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const app = require('../api/index');
const db = require('../src/db/db');
const seoDiscovery = require('../api/utils/seoDiscovery');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const appUrl = process.env.APP_URL || 'https://scango.uy';

/** Equivalencia exacta entre el horario configurado y el schema emitido. */
function assertHours(restaurant, openingHours, expectedSpecs) {
  const result = seoDiscovery.buildOpeningHoursFromSchedule(restaurant);
  assert.ok(result, `debe derivar horario para ${restaurant.scheduleActiveHours}`);
  assert.strictEqual(result.openingHours, openingHours, 'cadena openingHours');
  assert.strictEqual(result.openingHoursSpecification.length, expectedSpecs.length, 'cantidad de tramos');
  expectedSpecs.forEach(([opens, closes], i) => {
    const spec = result.openingHoursSpecification[i];
    assert.strictEqual(spec['@type'], 'OpeningHoursSpecification');
    assert.strictEqual(spec.opens, opens);
    assert.strictEqual(spec.closes, closes);
    assert.strictEqual(spec.dayOfWeek.length, 7, 'cubre toda la semana');
  });
}

async function runTests() {
  // ── Fase A · compilador puro (sin I/O) ──────────────────────────────────

  // 1. Horarios → Schema.org
  assert.strictEqual(seoDiscovery.buildOpeningHoursFromSchedule(null), null, 'restaurant nulo');
  assert.strictEqual(seoDiscovery.buildOpeningHoursFromSchedule({}), null, 'sin horario');
  assert.strictEqual(seoDiscovery.buildOpeningHoursFromSchedule({ scheduleEnabled: true }), null, 'sin scheduleActiveHours');
  assert.strictEqual(
    seoDiscovery.buildOpeningHoursFromSchedule({ scheduleEnabled: false, scheduleActiveHours: '12:00-23:00' }),
    null,
    'horario deshabilitado → nada publicado'
  );
  assert.strictEqual(
    seoDiscovery.buildOpeningHoursFromSchedule({ scheduleEnabled: true, scheduleActiveHours: 'no-formato' }),
    null,
    'formato inválido → se omite (no inventa datos)'
  );
  assertHours({ scheduleEnabled: true, scheduleActiveHours: '12:00-23:00' }, 'Mo-Su 12:00-23:00', [['12:00', '23:00']]);
  assertHours({ scheduleEnabled: true, scheduleActiveHours: '09:30-17:45' }, 'Mo-Su 09:30-17:45', [['09:30', '17:45']]);
  assertHours({ scheduleEnabled: true, scheduleActiveHours: '00:00-23:59' }, 'Mo-Su 00:00-23:59', [['00:00', '23:59']]);
  // Ventana nocturna (cruza medianoche): dos OpeningHoursSpecification por día.
  assertHours(
    { scheduleEnabled: true, scheduleActiveHours: '18:00-02:00' },
    'Mo-Su 18:00-02:00',
    [
      ['18:00', '23:59'],
      ['00:00', '02:00']
    ]
  );
  // 23:00-00:00 → solo [23:00 → 23:59]; el tramo que empieza en 00:00 es vacío y no se emite.
  assertHours({ scheduleEnabled: true, scheduleActiveHours: '23:00-00:00' }, 'Mo-Su 23:00-00:00', [['23:00', '23:59']]);

  // 2. robots.txt: buscadores clásicos + IA explícita, paneles privados fuera del índice.
  const robots = seoDiscovery.buildRobotsTxt('https://menus.example');
  for (const token of [
    'User-agent: *',
    'Disallow: /studio',
    'Disallow: /admin',
    'Disallow: /api/',
    'Allow: /m/',
    'User-agent: OAI-SearchBot',
    'User-agent: ChatGPT-User',
    'User-agent: PerplexityBot',
    'User-agent: Google-Extended',
    'User-agent: GPTBot',
    'User-agent: Applebot',
    'Sitemap: https://menus.example/sitemap.xml'
  ]) {
    assert.ok(robots.includes(token), `robots.txt debe contener "${token}"`);
  }
  assert.ok(!robots.includes('https://scango.uy/sitemap.xml'), 'el sitemap del robots usa el APP_URL provisto');
  assert.strictEqual(seoDiscovery.AI_USER_AGENTS.length, 12, 'política de IA centralizada (un solo módulo)');

  // 3. sitemap.xml: /, legales, menús activos y SUCURSALES reales (?branch=).
  const sitemap = seoDiscovery.buildSitemapXml({
    appUrl: 'https://menus.example',
    restaurants: [
      {
        slug: 'mi-local',
        updatedAt: '2026-10-12T10:00:00.000Z',
        branches: [{ slug: 'centro', name: 'Centro', address: '18 de Julio 1234' }]
      }
    ]
  });
  for (const expected of [
    'https://menus.example/',
    '/terminos',
    '/m/mi-local',
    '/m/mi-local?branch=centro',
    '<lastmod>2026-10-12T10:00:00.000Z</lastmod>',
    '<priority>0.8</priority>',
    '<priority>0.6</priority>'
  ]) {
    assert.ok(sitemap.includes(expected), `sitemap debe contener ${expected}`);
  }

  // ── Fase B · runtime (SSR + rutas dinámicas reales) ─────────────────────
  const unique = Date.now();
  const slug = `seo-local-${unique}`;
  const user = await db.createUser({
    email: `seo-discovery-${unique}@example.com`,
    password: 'test_password'
  });
  await db.saveRestaurant(user.id, {
    name: 'SEO Bistró',
    bizName: 'SEO Bistró',
    slug,
    slogan: 'Cocina & datos estructurados',
    currency: 'UYU',
    phone: '+59899123456',
    city: 'Montevideo',
    scheduleEnabled: true,
    scheduleActiveHours: '18:00-02:00',
    categories: [{ id: 'cat-main', name: 'Platos principales' }],
    dishes: [{ id: 'dish-n', categoryId: 'cat-main', name: 'Ñoquis', description: 'Con salsa', price: 320 }],
    branches: [{ id: 'b-centro', slug: 'centro', name: 'Centro', address: '18 de Julio 1234' }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();

    // 4. El JSON-LD del SSR refleja el horario real (ventana nocturna incluida).
    const ssrResponse = await fetch(`http://localhost:${port}/m/${slug}`);
    const html = await ssrResponse.text();
    assert.strictEqual(ssrResponse.status, 200);
    for (const token of [
      `"openingHours":"Mo-Su 18:00-02:00"`,
      '"@type":"OpeningHoursSpecification"',
      '"opens":"18:00"',
      '"closes":"23:59"',
      '"opens":"00:00"',
      '"closes":"02:00"',
      `<link rel="canonical" href="${appUrl}/m/${slug}"`
    ]) {
      assert.ok(html.includes(token), `SSR /m/${slug} debe incluir ${token}`);
    }

    // 5. robots.txt dinámico (política + sitemap).
    const robotsResponse = await fetch(`http://localhost:${port}/robots.txt`);
    const robotsText = await robotsResponse.text();
    assert.strictEqual(robotsResponse.status, 200);
    assert.ok(robotsText.includes('User-agent: OAI-SearchBot'), 'robots dinámico: política de IA');
    assert.ok(robotsText.includes('Disallow: /studio'), 'robots dinámico: /studio fuera del índice');
    assert.ok(robotsText.includes(`Sitemap: ${appUrl}/sitemap.xml`), 'robots dinámico: anuncia el sitemap');

    // 6. sitemap.xml dinámico (menú + sucursal + legales).
    const sitemapResponse = await fetch(`http://localhost:${port}/sitemap.xml`);
    const sitemapText = await sitemapResponse.text();
    assert.strictEqual(sitemapResponse.status, 200);
    assert.ok(sitemapText.includes(`/m/${slug}`), 'sitemap: menú activo listado');
    assert.ok(sitemapText.includes(`/m/${slug}?branch=centro`), 'sitemap: sucursal real listada');
    assert.ok(sitemapText.includes('/terminos'), 'sitemap: legales presentes (paridad con el flujo anterior)');

    // 7. noindex,follow en paneles privados (nunca indexados).
    for (const file of ['studio.html', 'admin.html', 'reset-password.html', 'email-verified.html']) {
      const content = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      assert.ok(content.includes('<meta name="robots" content="noindex,follow"'), `${file} debe llevar noindex`);
    }

    // 8. Los estáticos viejos fueron ELIMINADOS a propósito (en Vercel el archivo
    //    estático pisaba al dinámico y dejaba los /m/* fuera del sitemap de prod).
    assert.ok(!fs.existsSync(path.join(PUBLIC_DIR, 'robots.txt')), 'public/robots.txt no debe existir (lo sirve Express)');
    assert.ok(!fs.existsSync(path.join(PUBLIC_DIR, 'sitemap.xml')), 'public/sitemap.xml no debe existir (lo sirve Express)');
  } finally {
    server.close();
  }

  console.log('✓ Descubrimiento SEO/GEO validado: compilador puro, JSON-LD de horarios reales, robots+IA, sitemap con sucursales, noindex');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});