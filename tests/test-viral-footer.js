/**
 * tests/test-viral-footer.js — F4 "El QR es la demo" (Serie 4 "El Sistema", 58ª suite)
 * ─────────────────────────────────────────────────────────────────────────────
 * El footer de la carta real ("Esta carta corre con ScanGo" → `/?ref=<slug>`)
 * como canal de altas, con atribución server-side y medición en el panel.
 *
 * §1 Módulos puros `api/utils/viralRef.js` (CJS) + `public/js/utils/viralFooter.js`
 *    (espejo ESM): sanitizeRefSlug (allowlist de slug, máx 64, nunca basura),
 *    buildReferralHref (NUNCA `javascript:`/`data:`), buildKitLine, y PARIDAD
 *    exacta CJS↔ESM sobre un corpus determinista. applyViralFooter (DOM falso:
 *    muestra/oculta con `hidden`, setea href, engancha el tracking UNA vez).
 * §2 Footer solo en cartas reales: `shouldShowViralFooter` (demo/undefined/slug
 *    inválido → false), wiring en menu.html/menu.js/CSS sin `on*=` y el evento
 *    en el canal público + telemetría (tipo CRUDO: no mueve ticket ni visitas).
 * §3 Canal público real: `scango_cta_click` 200, consent `necessary` →
 *    recorded:false, demo → no-op, slug desconocido → 404, evento inválido → 400.
 * §4 Atribución E2E: `POST /api/auth/register` real con `ref=<slug>` persiste
 *    `acquiredVia`; sin `ref`, con slug inexistente o con una demo → sin origen
 *    inventado; el slug viaja normalizado (mayúsculas → minúsculas) y el payload
 *    público de la carta NO lo expone. (Los registros corren en un proceso hijo
 *    con el MISMO server pero sin credenciales cloud/Resend: el flujo es real y
 *    no deja usuarios de Supabase Auth ni manda emails en cada corrida.)
 * §5 `/api/studio/save`: el dueño NO puede reescribir su origen (`acquiredVia`
 *    es campo privilegiado, igual que subscription/userId).
 * §6 `/api/admin/overview` (login real 2FA TOTP): `acquisitionSources` agrupa
 *    por origen con `(directo)` y cuenta cuántos de esos ya pagan.
 * §7 Kit de mesa imprimible: la línea viral sale de la MISMA función que el
 *    footer (`buildKitLine`) en el cartel HTML y en el PDF.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

// El panel maestro es fail-closed sin secreto (sin default público): fijamos uno
// aleatorio por corrida si el entorno no lo trae (mismo patrón que test-admin-panel).
if (!process.env.ADMIN_TOTP_SECRET) {
  process.env.ADMIN_TOTP_SECRET = crypto.randomBytes(20).toString('base64');
}

const app = require('../api/index');
const db = require('../src/db/db');
const viral = require('../api/utils/viralRef');
const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');
const { stripPrivilegedFields } = require('../api/utils/stripPrivilegedFields');
const { generateTotpToken } = require('../api/utils/totp');

const ADMIN_KEY = process.env.ADMIN_KEY || 'pizarron_admin_master_key_2026';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/**
 * DOM mínimo para ejercitar `applyViralFooter` sin navegador: un elemento con
 * `hidden`, `querySelector` y un link que registra atributos y listeners.
 */
function fakeFooter() {
  const listeners = [];
  const attributes = {};
  const link = {
    dataset: {},
    setAttribute(name, value) {
      attributes[name] = value;
    },
    addEventListener(type, fn) {
      if (type === 'click') listeners.push(fn);
    }
  };
  const el = {
    hidden: true,
    querySelector(selector) {
      return selector === '[data-viral-link]' ? link : null;
    }
  };
  return {
    el,
    link,
    attributes,
    listeners,
    click: () => listeners.forEach((fn) => fn())
  };
}

async function runTests() {
  console.log('🧪 Iniciando verificación del footer viral + atribución (F4)...');
  await db.ready;

  const tag = Date.now();

  // ── §1 Módulos puros (CJS) + paridad exacta con el espejo ESM ─────────────
  assert.strictEqual(viral.sanitizeRefSlug('  Mi-Local  '), 'mi-local', 'trim + lowercase');
  assert.strictEqual(viral.sanitizeRefSlug('a'), 'a', 'slug de 1 char válido');
  assert.strictEqual(viral.sanitizeRefSlug('9lives'), '9lives', 'puede empezar con dígito');
  assert.strictEqual(viral.sanitizeRefSlug('a--b'), 'a--b', 'guiones internos válidos');
  for (const bad of ['', '   ', '-a', 'a-', 'a_b', 'a b', 'ñandú', 'a/b', 'a.b', '<script>', 'a?ref=b']) {
    assert.strictEqual(viral.sanitizeRefSlug(bad), '', `slug inválido rechazado: ${JSON.stringify(bad)}`);
  }
  for (const notString of [null, undefined, 42, true, {}, []]) {
    assert.strictEqual(viral.sanitizeRefSlug(notString), '', 'solo strings pueden ser slug');
  }
  const long = viral.sanitizeRefSlug('a'.repeat(200));
  assert.strictEqual(long.length, viral.REF_SLUG_MAX, 'el slug se acota a 64 (nunca crece sin límite)');
  assert.ok(!/[^a-z0-9-]/.test(long), 'la salida siempre está dentro de la allowlist');

  assert.strictEqual(viral.buildReferralHref('', 'mi-local'), '/?ref=mi-local', 'base vacía → raíz relativa');
  assert.strictEqual(viral.buildReferralHref('/', 'mi-local'), '/?ref=mi-local', 'base raíz → raíz relativa');
  assert.strictEqual(
    viral.buildReferralHref('https://scango.uy/', 'mi-local'),
    'https://scango.uy/?ref=mi-local',
    'base absoluta sin doble slash'
  );
  assert.strictEqual(viral.buildReferralHref('https://scango.uy', 'NO-EXISTE-Ñ'), '', 'slug inválido → sin href');
  for (const hostile of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.example']) {
    const href = viral.buildReferralHref(hostile, 'mi-local');
    assert.strictEqual(href, '/?ref=mi-local', `base hostil neutralizada: ${hostile}`);
  }
  assert.strictEqual(viral.buildKitLine('https://scango.uy'), 'Esta carta corre con ScanGo · https://scango.uy');
  assert.strictEqual(viral.buildKitLine(''), 'Esta carta corre con ScanGo · scango.uy', 'sin URL → dominio de marca');
  assert.strictEqual(
    viral.buildKitLine('javascript:alert(1)'),
    'Esta carta corre con ScanGo · scango.uy',
    'base hostil no se imprime en el kit'
  );

  // Espejo ESM (public/js/utils/viralFooter.js): mismas firmas, misma salida.
  const esm = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'utils', 'viralFooter.js')).href);
  assert.strictEqual(esm.REF_SLUG_MAX, viral.REF_SLUG_MAX, 'REF_SLUG_MAX idéntico');
  assert.strictEqual(esm.VIRAL_FOOTER_LABEL, viral.VIRAL_FOOTER_LABEL, 'label idéntico');
  const corpus = [
    '', ' ', 'a', 'mi-local', 'A B', 'Mi-Local', '-a', 'a-', 'a_b', 'a--b', '9lives',
    'ñandú', '<script>', 'a?ref=b', 'x'.repeat(70), 'demo-heladeria', null, undefined, 42, {}, []
  ];
  for (const value of corpus) {
    assert.strictEqual(esm.sanitizeRefSlug(value), viral.sanitizeRefSlug(value), `paridad sanitizeRefSlug(${JSON.stringify(value)})`);
  }
  const bases = ['', '/', 'https://scango.uy', 'https://scango.uy/', 'http://localhost:3000', 'javascript:x', 'data:x'];
  for (const base of bases) {
    for (const slug of ['mi-local', 'A B', '']) {
      assert.strictEqual(
        esm.buildReferralHref(base, slug),
        viral.buildReferralHref(base, slug),
        `paridad buildReferralHref(${base}, ${slug})`
      );
    }
    assert.strictEqual(esm.buildKitLine(base), viral.buildKitLine(base), `paridad buildKitLine(${base})`);
  }
  console.log('✓ §1 Módulos puros + paridad CJS↔ESM (allowlist de slug, base hostil neutralizada, kit)');

  // ── §2 El footer solo existe en cartas reales ─────────────────────────────
  assert.strictEqual(esm.shouldShowViralFooter(null), false, 'sin restaurante no hay footer');
  assert.strictEqual(esm.shouldShowViralFooter(undefined), false, 'undefined → false');
  assert.strictEqual(esm.shouldShowViralFooter({}), false, 'sin slug → false');
  assert.strictEqual(esm.shouldShowViralFooter({ slug: 'A B' }), false, 'slug inválido → false');
  assert.strictEqual(esm.shouldShowViralFooter({ slug: 'mi-local' }), true, 'carta real → true');
  assert.strictEqual(esm.shouldShowViralFooter({ slug: 'demo-heladeria', isDemo: true }), false, 'una demo JAMÁS se promociona');

  const shown = fakeFooter();
  const tracked = [];
  assert.strictEqual(
    esm.applyViralFooter(shown.el, { slug: 'mi-local' }, { appUrl: 'https://scango.uy', onTrack: (slug, href) => tracked.push([slug, href]) }),
    true
  );
  assert.strictEqual(shown.el.hidden, false, 'carta real: footer visible');
  assert.strictEqual(shown.attributes.href, 'https://scango.uy/?ref=mi-local', 'href con el ref del local');
  shown.click();
  shown.click();
  assert.deepStrictEqual(tracked[0], ['mi-local', 'https://scango.uy/?ref=mi-local'], 'el click se mide');
  assert.strictEqual(shown.listeners.length, 1, 'el listener se engancha una sola vez');

  // Idempotencia: re-aplicar (re-render del menú) no duplica listeners.
  esm.applyViralFooter(shown.el, { slug: 'mi-local' }, { onTrack: () => tracked.push(['dup', '']) });
  assert.strictEqual(shown.listeners.length, 1, 're-aplicar no duplica el listener');

  const demoFooter = fakeFooter();
  assert.strictEqual(esm.applyViralFooter(demoFooter.el, { slug: 'demo-heladeria', isDemo: true }, {}), false);
  assert.strictEqual(demoFooter.el.hidden, true, 'demo: footer oculto (hidden)');
  assert.ok(!('href' in demoFooter.attributes), 'demo: no se toca el href');

  const noLink = { hidden: false, querySelector: () => null };
  assert.strictEqual(esm.applyViralFooter(noLink, { slug: 'mi-local' }, {}), true, 'sin link en el DOM no rompe');

  // Wiring estático: markup, estilos y render sin `on*=` (CSP script-src-attr none).
  const menuHtml = read('public/menu.html');
  const footerBlock = menuHtml.slice(menuHtml.indexOf('id="viralFooter"') - 300, menuHtml.indexOf('id="viralFooter"') + 700);
  assert.ok(menuHtml.includes('id="viralFooter"'), 'footer viral presente en el menú');
  assert.ok(/id="viralFooter"[^>]*hidden/.test(menuHtml), 'arranca oculto (el JS lo muestra solo en carta real)');
  assert.ok(menuHtml.includes('data-viral-link'), 'link con el hook del tracking');
  assert.ok(menuHtml.includes('Esta carta corre con ScanGo'), 'copy del footer');
  assert.ok(!/\son[a-z]+\s*=/i.test(footerBlock), 'cero on*= en el bloque nuevo');

  const menuCss = read('public/css/menu.css');
  assert.ok(menuCss.includes('.viral-footer'), 'estilos del footer');
  assert.ok(menuCss.includes('.viral-footer[hidden]'), 'hidden realmente oculta');
  assert.ok(menuCss.includes('prefers-reduced-motion'), 'respeta reduced-motion');

  const menuJs = read('public/js/menu.js');
  assert.ok(menuJs.includes("import { applyViralFooter } from './utils/viralFooter.js'"), 'menu.js importa el helper');
  assert.ok(menuJs.includes('function renderViralFooter()'), 'render del footer');
  assert.ok(/renderViralFooter\(\);/.test(menuJs), 'se aplica al quedar lista la carta');
  assert.ok(menuJs.includes("navigator.sendBeacon('/api/public/analytics/event'"), 'el click se mide con sendBeacon (la navegación no lo pierde)');
  assert.ok(menuJs.includes("trackPublicEvent('scango_cta_click')"), 'fallback al canal público');
  const viralSegment = menuJs.slice(menuJs.indexOf('function trackViralCtaClick'), menuJs.indexOf('function showOfflineBanner'));
  assert.ok(!/\son[a-z]+\s*=/i.test(viralSegment), 'cero on*= en el segmento nuevo');

  const publicRoute = read('api/routes/public.js');
  assert.ok(publicRoute.includes("'scango_cta_click'"), 'el canal público acepta el evento');

  const telemetry = read('api/services/telemetry.js');
  assert.ok(telemetry.includes("'scango_cta_click'"), 'telemetría declara el tipo crudo');
  const counterBlock = telemetry.slice(telemetry.indexOf('const LEGACY_COUNTER_TYPES'), telemetry.indexOf('const DISH_POPULARITY_WINDOW_DAYS'));
  assert.ok(!counterBlock.includes('scango_cta_click'), 'el evento NO mueve los contadores legacy (ticket/visitas/órdenes)');
  console.log('✓ §2 Footer no-demo + wiring CSP-safe + evento crudo fuera de los contadores');

  // ── Fixtures compartidas de las secciones con server ──────────────────────
  const referrerSlug = `viral-src-${tag}`;
  const referrerUser = await db.createUser({
    email: `viral-owner-${tag}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const referrer = await db.saveRestaurant(referrerUser.id, {
    name: 'Viral Origen',
    bizName: 'Viral Origen',
    slug: referrerSlug,
    phone: '59899001122',
    currency: 'USD',
    subscription: {
      status: 'active',
      plan: 'starter_monthly',
      provider: 'stripe',
      trialEndsAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      currentPeriodEnd: new Date(Date.now() + 20 * 86400000).toISOString()
    },
    categories: [{ id: 'cat_v', name: 'Casa' }],
    dishes: [{ id: 'dish_v', name: 'Plato viral', price: 10, categoryId: 'cat_v' }]
  });
  assert.ok(referrer && referrer.id, 'restaurante referente creado');
  const attributedUser = await db.createUser({
    email: `viral-attributed-${tag}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const attributed = await db.saveRestaurant(attributedUser.id, {
    name: 'Viral Atribuido',
    bizName: 'Viral Atribuido',
    slug: `viral-attributed-${tag}`,
    acquiredVia: referrerSlug,
    subscription: {
      status: 'active',
      plan: 'starter_monthly',
      provider: 'stripe',
      trialEndsAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      currentPeriodEnd: new Date(Date.now() + 20 * 86400000).toISOString()
    }
  });
  assert.strictEqual(
    db.findRestaurantById(attributed.id).acquiredVia,
    referrerSlug,
    'el store persiste acquiredVia (columna del alta, no inventada al leer)'
  );

  // ── §4 Atribución E2E: registro real en un proceso hijo en modo local ─────
  const childEnv = { ...process.env };
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'RESEND_API_KEY']) {
    delete childEnv[key];
  }
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, 'helpers', 'viral-register.js'), referrerSlug, String(tag)],
    { env: childEnv, encoding: 'utf8', timeout: 180000 }
  );
  if (child.status !== 0) {
    throw new Error(`El registro real en modo local falló (status ${child.status}): ${child.stderr || child.stdout}`);
  }
  const markerLine = String(child.stdout || '')
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith('__VIRAL_RESULT__'));
  assert.ok(markerLine, 'el hijo devuelve el resultado del alta');
  const results = JSON.parse(markerLine.slice('__VIRAL_RESULT__'.length));

  for (const [name, res] of Object.entries(results.statuses)) {
    assert.strictEqual(res.status, 200, `registro ${name} real → 200 (fue ${res.status}: ${JSON.stringify(res.body)})`);
  }
  assert.strictEqual(results.persisted.withRef.acquiredVia, referrerSlug, 'con `?ref=` real → acquiredVia persistido');
  assert.strictEqual(results.persisted.withRef.restaurantId && results.persisted.withRef.slug !== null, true, 'el alta creó su carta');
  assert.strictEqual(results.persisted.upperRef.acquiredVia, referrerSlug, 'el slug se normaliza (MAYÚSCULAS → minúsculas)');
  assert.strictEqual(results.persisted.noRef.acquiredVia, '', 'sin ref → sin atribución');
  assert.strictEqual(results.persisted.badRef.acquiredVia, '', 'ref inexistente → NUNCA se inventa el origen');
  assert.strictEqual(results.persisted.demoRef.acquiredVia, '', 'una demo no atribuye altas');
  assert.strictEqual(results.publicMenuStatus, 200, 'la carta atribuida responde público');
  assert.strictEqual(results.publicMenuHasAcquiredVia, false, 'el payload público NO expone el origen (dato de negocio)');
  console.log(`✓ §4 E2E: ?ref=${referrerSlug} → acquiredVia persistido · sin ref/inexistente/demo → sin origen · no se filtra al público`);

  // ── §5 /api/studio/save: el origen es privilegiado (no se reescribe) ──────
  const token = jwt.sign({ userId: attributedUser.id, email: attributedUser.email }, JWT_SECRET, { expiresIn: '5m' });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  try {
    const evilSave = await fetch(`${base}/api/studio/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Viral Atribuido', acquiredVia: 'carta-robada' })
    });
    assert.strictEqual(evilSave.status, 200, 'el save legítimo sigue funcionando');
    const persisted = db.findRestaurantById(attributed.id);
    assert.strictEqual(persisted.acquiredVia, referrerSlug, 'el dueño NO puede reescribir de dónde vino');
    assert.ok(
      stripPrivilegedFields({ acquiredVia: 'x' }).acquiredVia === undefined,
      'stripPrivilegedFields bloquea acquiredVia (defensa en profundidad)'
    );
    const sanitized = sanitizeRestaurantPayload({ name: 'X', acquiredVia: 'Carta-Robada' });
    assert.strictEqual(sanitized.acquiredVia, 'carta-robada', 'el sanitizer lo normaliza si viene (idempotente)');
    assert.ok(!('acquiredVia' in sanitizeRestaurantPayload({ name: 'X' })), 'sin el campo no se inventa la clave');
    console.log('✓ §5 /save: acquiredVia privilegiado (no reescribible) + sanitizer idempotente');

    // ── §3 Canal público real (con el server ya arriba) ─────────────────────
    const before = db.findRestaurantById(referrer.id).analytics || {};
    const postEvent = async (body) => {
      const res = await fetch(`${base}/api/public/analytics/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    const click = await postEvent({ slug: referrerSlug, event: 'scango_cta_click' });
    assert.strictEqual(click.status, 200, 'scango_cta_click → 200 (antes era 400 silencioso)');
    assert.strictEqual(click.body.telemetry, true, 'el evento se persistió como telemetría');
    assert.strictEqual(click.body.analytics.visits, before.visits || 0, 'el click NO infla visitas');
    assert.strictEqual(click.body.analytics.orders, before.orders || 0, 'el click NO infla órdenes');
    assert.ok(!('averageTicket' in click.body.analytics) || click.body.analytics.averageTicket === (before.averageTicket || 0), 'el ticket promedio no se mueve');

    const minimal = await postEvent({ slug: referrerSlug, event: 'scango_cta_click', consent: 'necessary' });
    assert.strictEqual(minimal.status, 200, 'consent necessary → 200 honesto');
    assert.strictEqual(minimal.body.recorded, false, 'consent necessary → NO se persiste lo analítico');
    assert.strictEqual(minimal.body.reason, 'CONSENT_NECESSARY', 'motivo explícito');

    const demoEvent = await postEvent({ slug: 'demo-restaurante', event: 'scango_cta_click' });
    assert.strictEqual(demoEvent.status, 200, 'demo → 200 no-op');
    assert.strictEqual(demoEvent.body.demo, true, 'demo no persiste telemetría (cero datos falsos)');

    const unknown = await postEvent({ slug: `no-existe-${tag}`, event: 'scango_cta_click' });
    assert.strictEqual(unknown.status, 404, 'slug desconocido → 404');
    const invalid = await postEvent({ slug: referrerSlug, event: 'evento_inventado' });
    assert.strictEqual(invalid.status, 400, 'evento fuera de la allowlist → 400');
    console.log('✓ §3 Canal público: 200 sin tocar contadores · consent necessary descarta · demo no-op · 404/400');

    // ── §6 Panel maestro: de dónde vienen los dueños nuevos ────────────────
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: ADMIN_KEY, totp: generateTotpToken(process.env.ADMIN_TOTP_SECRET) })
    });
    assert.strictEqual(login.status, 200, 'login admin con 2FA TOTP real');
    const adminCookie = (login.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(adminCookie.startsWith('admin_token='), 'cookie admin_token emitida');

    const overview = await fetch(`${base}/api/admin/overview`, { headers: { Cookie: adminCookie } });
    assert.strictEqual(overview.status, 200, 'overview admin');
    const { metrics } = await overview.json();
    assert.ok(Array.isArray(metrics.acquisitionSources), 'acquisitionSources es una lista');
    assert.ok(Number.isFinite(metrics.acquiredCount) && metrics.acquiredCount >= 1, 'acquiredCount cuenta las altas atribuidas');

    const sourceEntry = metrics.acquisitionSources.find((s) => s.via === referrerSlug);
    assert.ok(sourceEntry, 'el origen seeded aparece agrupado');
    assert.ok(sourceEntry.count >= 1, 'con al menos un alta');
    assert.ok(sourceEntry.paying >= 1, 'y la suscripción activa se contabiliza');
    assert.strictEqual(sourceEntry.label, referrerSlug, 'label legible del origen');

    const directEntry = metrics.acquisitionSources.find((s) => s.via === '');
    assert.ok(directEntry, 'los que llegan sin referido se agrupan');
    assert.strictEqual(directEntry.label, '(directo)', 'label honesta para el tráfico directo');
    assert.ok(directEntry.count >= 1, 'y se cuentan');
    const sorted = [...metrics.acquisitionSources];
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok(sorted[i - 1].count >= sorted[i].count, 'ordenado por cantidad (lo que más trae, primero)');
    }
    console.log(`✓ §6 /admin/overview: ${metrics.acquisitionSources.length} orígenes agrupados (atribuidas: ${metrics.acquiredCount})`);

    // ── §7 Kit de mesa imprimible: MISMA línea que el footer ───────────────
    const qrGenerator = read('public/js/studio/qrGenerator.js');
    assert.ok(qrGenerator.includes("import { buildKitLine } from '../utils/viralFooter.js'"), 'el kit reusa el módulo del footer');
    assert.ok(
      (qrGenerator.match(/buildKitLine\(window\.location\.origin\)/g) || []).length >= 2,
      'la línea viral se imprime en el cartel HTML y en el PDF'
    );
    assert.ok(qrGenerator.includes('.viral-line'), 'estilo de la línea en el cartel');
    assert.strictEqual(viral.buildKitLine('https://scango.uy'), 'Esta carta corre con ScanGo · https://scango.uy', 'texto exacto del kit');

    const validation = read('api/middleware/validation.js');
    assert.ok(validation.includes('ref: z.string().max(64).optional()'), 'el alta acepta ref acotado');
    const authRoute = read('api/routes/auth.js');
    assert.ok(authRoute.includes('sanitizeRefSlug(req.body.ref)'), 'el alta sanea el ref');
    assert.ok(authRoute.includes('await db.lazyLoadRestaurant(refSlug)'), 'resuelve el referente real (espera hidratación cloud)');
    assert.ok(authRoute.includes('isDemoSlug(referrer.slug)'), 'una demo no atribuye');
    assert.ok(authRoute.includes('...(acquiredVia ? { acquiredVia } : {})'), 'solo escribe el origen cuando existe');

    const strip = read('api/utils/stripPrivilegedFields.js');
    assert.ok(strip.includes("'acquiredVia'"), 'acquiredVia en la lista de privilegiados');

    const lander = read('public/js/index.js');
    assert.ok(lander.includes('const referralRef'), 'la landing captura ?ref=');
    assert.ok(lander.includes('...(referralRef ? { ref: referralRef } : {})'), 'y lo manda condicional en el alta');

    const adminRoutes = read('api/routes/admin.js');
    assert.ok(adminRoutes.includes('acquisitionSources'), 'el overview agrupa por origen');
    assert.ok(adminRoutes.includes('acquired_via || (r.profile && r.profile.acquiredVia)'), 'lee la columna y el perfil cloud');
    const adminHtml = read('public/admin.html');
    assert.ok(adminHtml.includes('id="acquisition-tbody"'), 'tabla de orígenes en el panel');
    assert.ok(adminHtml.includes('function renderAcquisition(metrics)'), 'render de la tabla');
    const acquisitionSegment = adminHtml.slice(adminHtml.indexOf('id="acquisition-tbody"') - 600, adminHtml.indexOf('id="acquisition-tbody"') + 600);
    assert.ok(!/\son[a-z]+\s*=/i.test(acquisitionSegment), 'cero on*= en la sección nueva');

    const openapi = read('openapi.yaml');
    assert.ok(openapi.includes('ref:') && openapi.includes('Slug de la carta referente'), 'contrato documenta el ref del alta');
    assert.ok(openapi.includes('acquiredVia:'), 'contrato documenta acquiredVia');

    for (const file of ['api/utils/viralRef.js', 'public/js/utils/viralFooter.js']) {
      assert.ok(!/\son[a-z]+\s*=/i.test(read(file)), `cero on*= en ${file}`);
    }
    console.log('✓ §7 Contratos: kit imprimible, alta/landing, panel, strip y openapi');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('✅ test-viral-footer: F4 "El QR es la demo" (footer viral + atribución) OK');
}

runTests().catch((err) => {
  console.error('❌ test-viral-footer falló:', err && err.stack ? err.stack : err);
  process.exit(1); // el server HTTP abierto no deja drenar el event loop
});
