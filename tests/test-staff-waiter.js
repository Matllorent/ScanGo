/**
 * tests/test-staff-waiter.js — Sistema de Mozos y Cocina, Fase 1 (64ª suite)
 * ─────────────────────────────────────────────────────────────────────────────
 * El turno del equipo operativo: el dueño da de alta mozos/cocina desde el
 * Studio, les muestra un QR de enrolamiento UNA vez y el local ve solo las
 * mesas asignadas a cada persona. La PWA `/mozo` canjea el secreto del
 * fragmento por una sesión opaca y no guarda jamás el secreto.
 *
 * §1 Estático fuente: PWA `/mozo`, service worker, Studio y CSP — cero on*=,
 *    cero window.confirm/alert, render con DOM API, manifest, noindex, scope
 *    del SW y wiring del tab Equipo.
 * §2 `staffCredentials.js` puro: roles, saneo de mesas, hash timing-safe,
 *    URL con secreto SOLO en el fragmento, sesión con TTL y tope absoluto.
 * §3 `mozoSession.js` puro: parseo del QR, token de sesión, expiración,
 *    cierre en dos toques, storage tolerante y vista sin PII.
 * §4 `staffManager.js` puro: orden de mesas, filas de asignación, colección
 *    de asignaciones, inicial y etiqueta de rol.
 * §5 Runtime REAL: server HTTP + store real — CRUD del dueño, aislamiento
 *    cross-tenant, QR/rotación/revocación, asignaciones sin bumpear updatedAt,
 *    activación/`me`/heartbeat/cierre, tabla dirigida por `staff_id`, baja
 *    RGPD y auditoría.
 *
 * Cero mocks. Muta `data/*.json` y el guard de la suite completa lo aísla.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const auditService = require('../api/services/audit');
const notificationsService = require('../api/services/notifications');
const {
  STAFF_ROLES,
  STAFF_SESSION_TTL_MS,
  STAFF_SESSION_MAX_MS,
  MAX_TABLES,
  generateStaffSecret,
  hashStaffSecret,
  safeEqualHex,
  sanitizeStaffRole,
  staffRoleLabel,
  sanitizeStaffName,
  isValidStaffId,
  sanitizeTableNumber,
  sanitizeTableAssignments,
  buildStaffEnrollmentUrl,
  isStaffSessionActive,
  staffSessionExpiry,
  extendStaffSession
} = require('../api/utils/staffCredentials');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// El camino degradado de push es parte del contrato: sin VAPID el aviso no se
// inventa y la PWA muestra "avisos no configurados". El test borra las llaves
// del proceso (nunca del `.env`) para ser determinista en cualquier máquina.
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

function parseEnrollment(url) {
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  return {
    pathname: parsed.pathname,
    restaurantId: parsed.searchParams.get('r'),
    staffId: parsed.searchParams.get('w'),
    secret: fragment.get('k'),
    query: parsed.search,
    hash: parsed.hash
  };
}

async function requestJson(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  let body = null;
  try {
    body = await response.json();
  } catch (e) {
    body = null;
  }
  return { response, body };
}

async function runTests() {
  console.log('🧪 Iniciando verificación del Sistema de Mozos y Cocina (Fase 1)...');

  // ── §1 Estático fuente ──────────────────────────────────────────────────────
  const html = read('public/mozo.html');
  const mozoJs = read('public/js/mozo/mozo.js');
  const mozoSessionJs = read('public/js/mozo/mozoSession.js');
  const swJs = read('public/mozo-sw.js');
  const manifest = JSON.parse(read('public/mozo-manifest.json'));
  const mozoCss = read('public/css/mozo.css');
  const studioHtml = read('public/studio.html');
  const studioJs = read('public/js/studio.js');
  const staffManagerJs = read('public/js/studio/staffManager.js');
  const vercel = JSON.parse(read('vercel.json'));
  const regen = read('scripts/regen-vercel-csp.js');
  const apiIndex = read('api/index.js');

  // CSP de la casa: ningún handler inline, en TODO lo nuevo.
  for (const [label, content] of [
    ['mozo.html', html],
    ['mozo.js', mozoJs],
    ['mozoSession.js', mozoSessionJs],
    ['mozo-sw.js', swJs],
    ['staffManager.js', staffManagerJs],
    ['studio.html (bloque Equipo)', studioHtml.slice(studioHtml.indexOf('tab-staff'))]
  ]) {
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(content), `${label} no debe usar atributos on*=`);
  }

  // Diálogos nativos y HTML inyectado: prohibidos en la PWA y en el Studio.
  assert.ok(!/window\.confirm\s*\(/.test(mozoJs), 'mozo.js no usa window.confirm');
  assert.ok(!/\bconfirm\s*\(/.test(mozoJs), 'mozo.js no abre diálogos nativos');
  assert.ok(!/\balert\s*\(/.test(mozoJs), 'mozo.js no usa alert()');
  assert.ok(!/\.innerHTML|\.outerHTML|insertAdjacentHTML/.test(mozoJs), 'mozo.js renderiza con DOM API (cero innerHTML)');
  assert.ok(/createElement\(/.test(mozoJs) && /textContent/.test(mozoJs), 'mozo.js usa createElement/textContent');
  assert.ok(!/\.innerHTML|\.outerHTML|insertAdjacentHTML/.test(staffManagerJs), 'staffManager usa DOM API (cero innerHTML)');
  assert.ok(/showConfirmDialog/.test(staffManagerJs), 'acciones destructivas del Studio usan el diálogo propio');
  assert.ok(!/\balert\s*\(/.test(staffManagerJs), 'staffManager no usa alert()');

  // PWA: shell accesible, manifest, service worker con scope /mozo y sin
  // requests de terceros. La sesión va por localStorage, nunca el secreto.
  assert.ok(/<html\s+lang="es"/.test(html), 'mozo.html declara lang="es"');
  assert.strictEqual((html.match(/<main\b/g) || []).length, 1, 'exactamente un <main>');
  assert.ok(/<main[^>]*id="main-content"[^>]*tabindex="-1"/.test(html), 'main focusable (skip-link)');
  assert.ok(html.indexOf('class="skip-link"') < html.indexOf('<main'), 'skip-link antes del main');
  assert.ok(/<link[^>]*rel="manifest"[^>]*href="\/mozo-manifest\.json"/.test(html), 'manifest de la PWA linkeado');
  assert.ok(/<script[^>]*type="module"[^>]*src="\/js\/mozo\/mozo\.js"/.test(html), 'mozo.js como módulo');
  assert.ok(/<meta[^>]*name="robots"[^>]*content="noindex/.test(html), 'la PWA privada no se indexa');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/.test(html + mozoCss), 'PWA sin terceros');
  assert.strictEqual(manifest.short_name, 'Mi Turno', 'manifest con nombre corto propio');
  assert.strictEqual(manifest.start_url, '/mozo', 'el manifest abre la PWA del turno');
  assert.strictEqual(manifest.scope, '/mozo', 'scope del manifest limitado al turno');

  assert.ok(/navigator\.serviceWorker\.register\(['"]\/mozo-sw\.js['"]/.test(mozoJs), 'registra el SW exclusivo /mozo-sw.js');
  assert.ok(/headers\.Authorization\s*=\s*`Bearer \$\{/.test(mozoJs), 'manda el token opaco como Bearer');
  assert.ok(/\/api\/staff\/me/.test(mozoJs) && /\/api\/staff\/tables/.test(mozoJs), 'consulta me/tables del turno');
  assert.ok(/MPOLL_MS|MOZO_POLL_MS/.test(mozoJs) && /visibilityState/.test(mozoJs), 'polling solo con pestaña visible');
  assert.ok(/MOZO_HEARTBEAT_MS/.test(mozoJs), 'heartbeat del turno');
  assert.ok(/readStaffSessionFromStorage|readStaffSession/.test(mozoJs) && /STAFF_SESSION_STORAGE_KEY/.test(mozoJs), 'persiste la sesión de staff en storage');
  assert.ok(/END_SHIFT_ARM_MS/.test(mozoJs) || /nextEndShiftTap/.test(mozoJs), 'cierre de turno en dos toques');
  assert.ok(/pushManager|subscribe\(/.test(mozoJs), 'suscripción push del turno');
  assert.ok(/bindExistingPushToShift|saveStaffSubscription/.test(mozoJs), 'rebind de la tablet compartida al activar turno');

  // SW: nunca intercepta cross-origin, jamás cachea /api ni pisa la shell con
  // una navegación same-origin distinta de /mozo.
  assert.ok(/url\.origin\s*!==\s*self\.location\.origin/.test(swJs), 'SW excluye cross-origin (regla de la casa)');
  assert.ok(/\/api\//.test(swJs), 'SW excluye /api');
  assert.ok(/CACHE_NAME\s*=\s*'scango-mozo-v[2-9]/.test(swJs), 'CACHE_NAME bumpeado tras el fix de navegación');
  assert.ok(/url\.pathname\s*!==\s*'\/mozo'\s*&&\s*url\.pathname\s*!==\s*'\/mozo\/'/.test(swJs), 'solo cachea la shell de /mozo');
  assert.ok(/notificationclick/.test(swJs) && /\/mozo/.test(swJs), 'notificación abre la PWA del turno');

  // Studio: pestaña Equipo + modales + wiring CSP-safe.
  assert.ok(/data-js-click="switchTab\|staff"/.test(studioHtml), 'nav Equipo cableado con data-js');
  assert.ok(/id="tab-staff"/.test(studioHtml), 'pane Equipo presente');
  assert.ok(/id="staffEditorModal"/.test(studioHtml) && /id="staffQrModal"/.test(studioHtml), 'modales de alta/QR presentes');
  assert.ok(/id="staffEditorForm"[^>]*data-js-submit="saveStaffEditor\|event"/.test(studioHtml), 'submit del modal usa el binder (event.preventDefault)');
  assert.ok(/id="staffQrCanvas"[^>]*aria-label/.test(studioHtml) || /id="staffQrCanvas"/.test(studioHtml), 'contenedor de QR presente');
  assert.ok(/from '\.\/studio\/staffManager\.js'/.test(studioJs), 'studio.js importa staffManager');
  assert.ok(/loadStaff/.test(studioJs) && /globalExports/.test(studioJs), 'studio.js cablea loadStaff y lo publica al binder');
  assert.ok(/setOnboardingSuppressed/.test(studioJs) || /refreshOnboardingChecklist/.test(studioJs), 'el Studio mantiene el estado del onboarding');

  // Distribución: /mozo llega al CDN con sus headers y Express la sirve en dev.
  assert.ok(/\/mozo/.test(regen) && /'\/mozo'/.test(regen), '/mozo está en STATIC_SOURCES de la CSP');
  const routes = vercel.routes || [];
  assert.ok(routes.some((r) => r.src === '/mozo' && /mozo\.html/.test(r.dest || '')), '/mozo ruteado a mozo.html en vercel.json');
  assert.ok(routes.some((r) => r.src === '/mozo' && r.headers && !Array.isArray(r.headers) && Object.keys(r.headers).length > 0), '/mozo recibe headers de seguridad');
  assert.ok(/app\.get\('\/mozo'/.test(apiIndex), 'Express sirve GET /mozo en dev');

  console.log('✓ §1 Estático: PWA/SW/Studio/CSP/distribución');

  // ── §2 staffCredentials.js puro ─────────────────────────────────────────────
  assert.deepEqual(STAFF_ROLES, ['waiter', 'kitchen'], 'roles canónicos');
  assert.strictEqual(sanitizeStaffRole('waiter'), 'waiter');
  assert.strictEqual(sanitizeStaffRole('kitchen'), 'kitchen');
  assert.strictEqual(sanitizeStaffRole('admin'), null, 'rol desconocido no se inventa');
  assert.strictEqual(staffRoleLabel('waiter'), 'Mozo');
  assert.strictEqual(staffRoleLabel('kitchen'), 'Cocina');
  assert.strictEqual(staffRoleLabel('admin'), 'Mozo', 'label seguro con rol inválido');

  assert.strictEqual(sanitizeStaffName('  Ana\u0000  Gómez  '), 'Ana Gómez', 'saneo de nombre');
  assert.strictEqual(sanitizeStaffName('x'.repeat(200)).length, 60, 'nombre cap 60');

  const secret = generateStaffSecret();
  assert.strictEqual(secret.length, 32, 'secreto de 24 bytes → 32 chars base64url');
  assert.notStrictEqual(secret, generateStaffSecret(), 'secreto aleatorio distinto');
  const hashA = hashStaffSecret(secret);
  assert.strictEqual(hashA.length, 64, 'hash HMAC-SHA256 hex');
  assert.strictEqual(hashA, hashStaffSecret(secret), 'hash determinista con el mismo pepper');
  assert.ok(safeEqualHex(hashA, hashStaffSecret(secret)), 'comparación correcta');
  assert.ok(!safeEqualHex(hashA, hashStaffSecret(secret + 'x')), 'secreto distinto no matchea');
  assert.ok(!safeEqualHex('', hashA) && !safeEqualHex(hashA, ''), 'vacío nunca matchea');
  assert.ok(!safeEqualHex(hashA.slice(0, 10), hashA), 'largo distinto no matchea');

  assert.strictEqual(sanitizeTableNumber('  Terraza 3  '), 'Terraza 3');
  assert.strictEqual(sanitizeTableNumber('Mesa #4'), 'Mesa #4');
  assert.strictEqual(sanitizeTableNumber('__proto__'), '', 'clave de prototipo fuera');
  assert.strictEqual(sanitizeTableNumber('x'.repeat(21)), '', 'mesa cap 20');
  assert.strictEqual(sanitizeTableNumber('<script>'), '', 'HTML fuera');
  const staffId = 'staff_abc123_def456';
  assert.ok(isValidStaffId(staffId), 'id server-side válido');
  assert.ok(!isValidStaffId('staff_'), 'id corto inválido');
  assert.ok(!isValidStaffId('STAFF_ABC'), 'mayúsculas fuera del formato');
  const cleanAssignments = sanitizeTableAssignments({
    '1': staffId,
    ' 2 ': staffId,
    __proto__: 'staff_hack_1234',
    constructor: 'staff_hack_1234',
    '3': 'no-es-staff',
    'bad<script>': staffId,
    '': staffId
  });
  assert.deepEqual(cleanAssignments, { '1': staffId, '2': staffId }, 'solo mesas e ids válidos');
  assert.strictEqual(sanitizeTableAssignments([]).constructor, Object, 'array → objeto vacío');
  assert.strictEqual(MAX_TABLES, 200, 'tope de mesas');

  const enrollment = buildStaffEnrollmentUrl('https://scango.uy', {
    restaurantId: 'rest_a',
    staffId,
    secret
  });
  assert.ok(enrollment.startsWith('https://scango.uy/mozo?'), 'URL sobre APP_URL');
  assert.ok(enrollment.includes(`r=rest_a`) && enrollment.includes(`w=${staffId}`), 'r/w en query');
  assert.ok(enrollment.endsWith(`#k=${encodeURIComponent(secret)}`), 'secreto SOLO en el fragmento');
  assert.ok(!enrollment.split('#')[0].includes(secret), 'el secreto no viaja en la query');
  assert.strictEqual(
    buildStaffEnrollmentUrl('javascript:alert(1)', { restaurantId: 'r', staffId, secret }),
    `/mozo?r=r&w=${staffId}#k=${encodeURIComponent(secret)}`,
    'base hostil neutralizada a relativa'
  );
  assert.strictEqual(buildStaffEnrollmentUrl('http://evil.com', { restaurantId: 'r', staffId, secret }),
    `/mozo?r=r&w=${staffId}#k=${encodeURIComponent(secret)}`, 'http no-local neutralizado');
  assert.strictEqual(buildStaffEnrollmentUrl('https://scango.uy', { restaurantId: '', staffId, secret }), '', 'sin local no hay URL');

  const now = Date.now();
  const future = staffSessionExpiry(now);
  assert.ok(Date.parse(future) - now >= STAFF_SESSION_TTL_MS - 1000, 'TTL de 12 h');
  assert.ok(isStaffSessionActive({ expiresAt: future, createdAt: new Date(now).toISOString() }, now), 'sesión vigente');
  assert.ok(!isStaffSessionActive({ expiresAt: future, revokedAt: new Date().toISOString() }, now), 'revocada no está activa');
  assert.ok(!isStaffSessionActive({ expiresAt: future, endedAt: new Date().toISOString() }, now), 'cerrada no está activa');
  assert.ok(!isStaffSessionActive({ expiresAt: new Date(now - 1).toISOString() }, now), 'vencida no está activa');
  const extended = extendStaffSession({ createdAt: new Date(now - 60 * 60 * 1000).toISOString(), expiresAt: future }, now);
  assert.ok(Date.parse(extended) >= Date.parse(future), 'heartbeat no acorta la sesión');
  const maxed = extendStaffSession({
    createdAt: new Date(now - STAFF_SESSION_MAX_MS).toISOString(),
    expiresAt: new Date(now - 1000).toISOString()
  }, now);
  assert.ok(Date.parse(maxed) <= now, 'tope absoluto de 24 h');

  console.log('✓ §2 staffCredentials: roles, hash, mesas, URL fragmento, TTL/tope');

  // ── §3 mozoSession.js puro ──────────────────────────────────────────────────
  const mozoSession = await import('../public/js/mozo/mozoSession.js');
  assert.strictEqual(mozoSession.STAFF_SESSION_STORAGE_KEY, 'scango_staff_session');
  assert.strictEqual(mozoSession.END_SHIFT_ARM_MS, 4000);
  assert.strictEqual(mozoSession.MOZO_POLL_MS, 30000);
  assert.ok(mozoSession.MOZO_HEARTBEAT_MS > 0);

  const parsed = mozoSession.parseEnrollmentFromLocation({
    search: `?r=rest_a&w=${staffId}`,
    hash: `#k=${encodeURIComponent(secret)}`
  });
  assert.deepStrictEqual(parsed, {
    restaurantId: 'rest_a', staffId, secret, complete: true, partial: false
  }, 'QR completo → r/w/k');
  assert.deepStrictEqual(
    mozoSession.parseEnrollmentFromLocation({ search: '?r=rest_a&w=staff_abc123_def456', hash: '' }),
    { restaurantId: 'rest_a', staffId, secret: '', complete: false, partial: true },
    'sin secreto no se activa (parcial)'
  );
  assert.strictEqual(mozoSession.parseEnrollmentFromLocation(null).complete, false, 'location nula tolerada');
  assert.strictEqual(mozoSession.stripEnrollmentFragment('/mozo?r=r&w=w#k=secreto'), '/mozo?r=r&w=w');
  assert.strictEqual(mozoSession.stripEnrollmentFragment('/mozo#k=x'), '/mozo');
  assert.strictEqual(mozoSession.stripEnrollmentFragment(''), '');

  const clean = mozoSession.sanitizeStaffSession({
    token: 'x'.repeat(32),
    staffId,
    restaurantId: 'rest_a',
    staffName: ' Ana ',
    role: 'kitchen',
    tables: [{ number: '2', label: 'Mesa 2' }, { number: '2', label: 'Mesa 2' }, { number: 'Terraza 3' }],
    expiresAt: '2026-12-31T00:00:00.000Z',
    secret
  });
  assert.strictEqual(clean.token.length, 32);
  assert.strictEqual(clean.staffName, 'Ana');
  assert.strictEqual(clean.role, 'kitchen');
  assert.deepStrictEqual(clean.tables.map((t) => t.number), ['2', 'Terraza 3'], 'mesas únicas');
  assert.ok(!('secret' in clean), 'el secreto NUNCA entra a la sesión guardada');
  assert.strictEqual(mozoSession.sanitizeStaffSession({ token: 'corto' }), null, 'token corto rechazado');
  assert.strictEqual(mozoSession.sanitizeStaffSession(null), null, 'basura rechazada');

  const activation = mozoSession.buildStaffSessionFromActivation({
    token: 't'.repeat(32),
    expiresAt: future,
    staff: { id: staffId, name: 'Ana', role: 'waiter', roleLabel: 'Mozo' },
    restaurant: { id: 'rest_a', name: 'Local A' },
    tables: [{ number: '2', label: 'Mesa 2' }]
  });
  assert.strictEqual(activation.staffId, staffId);
  assert.strictEqual(activation.restaurantName, 'Local A');
  assert.deepStrictEqual(activation.tables.map((t) => t.number), ['2']);
  const merged = mozoSession.mergeStaffSessionFromMe(activation, {
    staff: { id: staffId, name: 'Ana María', role: 'waiter' },
    restaurant: { id: 'rest_a', name: 'Local A' },
    session: { expiresAt: future },
    tables: [{ number: '10', label: 'Mesa 10' }]
  });
  assert.strictEqual(merged.staffName, 'Ana María');
  assert.strictEqual(merged.token, activation.token, 'el token se conserva al refrescar');
  assert.deepStrictEqual(merged.tables.map((t) => t.number), ['10']);

  const storageMap = new Map();
  const fakeStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k)
  };
  assert.strictEqual(mozoSession.readStaffSessionFromStorage(fakeStorage), null, 'storage vacío');
  assert.ok(mozoSession.writeStaffSessionToStorage(fakeStorage, activation), 'guarda la sesión');
  assert.strictEqual(mozoSession.readStaffSessionFromStorage(fakeStorage).staffId, staffId);
  storageMap.set(mozoSession.STAFF_SESSION_STORAGE_KEY, '{basura');
  assert.strictEqual(mozoSession.readStaffSessionFromStorage(fakeStorage), null, 'JSON corrupto se descarta');
  mozoSession.clearStaffSessionStorage(fakeStorage);
  assert.strictEqual(storageMap.has(mozoSession.STAFF_SESSION_STORAGE_KEY), false, 'logout limpia storage');
  const brokenStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.strictEqual(mozoSession.readStaffSessionFromStorage(brokenStorage), null, 'storage bloqueado no rompe');
  assert.strictEqual(mozoSession.writeStaffSessionToStorage(brokenStorage, activation), false);
  assert.strictEqual(mozoSession.clearStaffSessionStorage(brokenStorage), false);

  const usableBase = { token: 'x'.repeat(32), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
  assert.ok(mozoSession.staffSessionIsUsable(usableBase), 'sesión futura usable');
  assert.ok(!mozoSession.staffSessionIsUsable({ ...usableBase, expiresAt: new Date(Date.now() + 1000).toISOString() }), 'margen de 5s');
  assert.ok(mozoSession.staffSessionMinutesLeft(usableBase) >= 55, 'minutos restantes');
  assert.ok(/^\d{2}:\d{2}$/.test(mozoSession.formatStaffExpiry(usableBase)), 'formato de vencimiento HH:MM');

  const t0 = 100000;
  const arm = mozoSession.nextEndShiftTap(null, t0);
  assert.strictEqual(arm.armed, true);
  assert.strictEqual(arm.confirm, false);
  assert.strictEqual(arm.armedAt, t0);
  const confirm = mozoSession.nextEndShiftTap({ armedAt: t0 }, t0 + 3000);
  assert.strictEqual(confirm.confirm, true);
  assert.strictEqual(confirm.armed, false);
  assert.strictEqual(confirm.armedAt, null);
  const expired = mozoSession.nextEndShiftTap({ armedAt: t0 }, t0 + 4001);
  assert.strictEqual(expired.confirm, false);
  assert.strictEqual(expired.armed, true);
  assert.strictEqual(expired.armedAt, t0 + 4001, 'fuera de 4 s se re-arma');

  const view = mozoSession.buildMozoView(merged, { online: true, pushConfigured: false });
  assert.strictEqual(view.online, true);
  assert.strictEqual(view.staffName, 'Ana María');
  assert.strictEqual(view.roleLabel, 'Mozo');
  assert.ok(view.tables.length === 1);
  assert.ok(!JSON.stringify(view).includes('secret'), 'la vista no filtra el secreto');

  console.log('✓ §3 mozoSession: QR, storage, expiración, dos toques, vista');

  // ── §4 staffManager.js puro ─────────────────────────────────────────────────
  const staffManager = await import('../public/js/studio/staffManager.js');
  assert.deepStrictEqual(
    staffManager.sortTableKeys(['10', '2', '1', 'Terraza 3', '2', 'Terraza 10']),
    ['1', '2', '10', 'Terraza 3', 'Terraza 10'],
    'mesas numéricas primero y luego texto'
  );
  const rows = staffManager.buildAssignmentRows({
    tableCount: 3,
    assignments: { '1': staffId, '2': 'staff_inexistente', 'Terraza 3': staffId },
    staff: [{ id: staffId, name: 'Ana' }]
  });
  assert.deepStrictEqual(rows.map((r) => r.key), ['1', '2', '3', 'Terraza 3'], 'mesas del local + extra');
  assert.strictEqual(rows[0].staffId, staffId);
  assert.strictEqual(rows[1].staffId, '', 'id inexistente no se pinta');
  assert.strictEqual(rows[1].label, 'Mesa 2');
  assert.deepStrictEqual(
    staffManager.collectAssignmentsFromRows([
      { table: ' 1 ', staffId },
      { table: '1', staffId: 'staff_otro' },
      { table: '2', staffId: '' },
      null
    ]),
    { '1': 'staff_otro' },
    'última asignación gana y vacío se descarta'
  );
  assert.strictEqual(staffManager.staffInitial('  ana'), 'A');
  assert.strictEqual(staffManager.staffInitial(''), '?');
  assert.strictEqual(staffManager.roleLabel('kitchen'), 'Cocina');
  assert.strictEqual(staffManager.roleLabel('wat'), 'Mozo');

  console.log('✓ §4 staffManager: orden, filas, asignaciones, inicial/rol');

  // ── §5 Runtime real ─────────────────────────────────────────────────────────
  const runTag = Date.now();
  const ownerA = await db.createUser({
    email: `staff-a-${runTag}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const ownerB = await db.createUser({
    email: `staff-b-${runTag}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  // El alta del usuario se replica en background; esperar antes del FK de
  // `restaurants.user_id` para ejercitar el dual-write REAL (no un fallo de
  // carrera del propio test).
  await db.flushCloudWrites();
  const restA = await db.saveRestaurant(ownerA.id, {
    name: 'Staff Local A',
    bizName: 'Staff Local A',
    slug: `staff-local-a-${runTag}`,
    phone: '59899111111',
    currency: 'USD',
    tableCount: 4,
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }]
  });
  const restB = await db.saveRestaurant(ownerB.id, {
    name: 'Staff Local B',
    bizName: 'Staff Local B',
    slug: `staff-local-b-${runTag}`,
    phone: '59899222222',
    currency: 'USD',
    tableCount: 2,
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Burger', price: 10, categoryId: 'cat1' }]
  });
  const tokenOwnerA = jwt.sign({ userId: ownerA.id }, JWT_SECRET, { expiresIn: '1h' });
  const tokenOwnerB = jwt.sign({ userId: ownerB.id }, JWT_SECRET, { expiresIn: '1h' });
  const authA = authHeaders(tokenOwnerA);
  const authB = authHeaders(tokenOwnerB);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  try {
    // 1) El equipo es privado del dueño.
    let out = await requestJson(base, '/api/studio/staff');
    assert.strictEqual(out.response.status, 401, 'GET equipo anónimo → 401');

    out = await requestJson(base, '/api/studio/staff', { headers: authA });
    assert.strictEqual(out.response.status, 200, 'GET equipo del dueño → 200');
    assert.ok(out.body.success, 'success del Studio');
    assert.deepStrictEqual(out.body.staff, [], 'local sin equipo');
    assert.deepStrictEqual(out.body.assignments, {}, 'sin asignaciones');
    assert.deepStrictEqual(out.body.tables, [], 'sin mesas asignadas');
    assert.strictEqual(out.body.restaurant.tableCount, 4, 'tableCount real del local');

    // 2) Alta: nombre vacío rechazado; roles allowlist con default seguro.
    out = await requestJson(base, '/api/studio/staff', {
      method: 'POST', headers: authA, body: JSON.stringify({ name: '   ', role: 'waiter' })
    });
    assert.strictEqual(out.response.status, 400, 'nombre vacío → 400');
    assert.strictEqual(out.body.code, 'INVALID_STAFF_NAME');

    out = await requestJson(base, '/api/studio/staff', {
      method: 'POST', headers: authA, body: JSON.stringify({ name: 'Ana Mozo', role: 'waiter' })
    });
    assert.strictEqual(out.response.status, 201, 'alta de mozo → 201');
    const ana = out.body.staff;
    const anaCredential = out.body.credential;
    const anaEnrollmentUrl = out.body.enrollmentUrl;
    assert.ok(ana && ana.id && ana.id.startsWith('staff_'), 'id server-side generado');
    assert.strictEqual(ana.name, 'Ana Mozo');
    assert.strictEqual(ana.role, 'waiter');
    assert.strictEqual(ana.roleLabel, 'Mozo');
    assert.strictEqual(ana.active, true);
    assert.strictEqual(ana.activeSessions, 0);
    assert.strictEqual(anaCredential.length, 32, 'secreto de 32 chars');
    assert.ok(anaEnrollmentUrl.includes('#k='), 'el QR lleva el secreto en el fragmento');
    assert.ok(!out.body.staff.credentialHash && !out.body.staff.credential_hash, 'la API nunca devuelve el hash');
    const anaQr = parseEnrollment(anaEnrollmentUrl);
    assert.strictEqual(anaQr.pathname, '/mozo');
    assert.strictEqual(anaQr.restaurantId, restA.id);
    assert.strictEqual(anaQr.staffId, ana.id);
    assert.strictEqual(anaQr.secret, anaCredential);
    assert.ok(!anaQr.query.includes(anaCredential), 'secreto fuera de la query');

    out = await requestJson(base, '/api/studio/staff', {
      method: 'POST', headers: authA, body: JSON.stringify({ name: 'Beto Cocina', role: 'kitchen' })
    });
    assert.strictEqual(out.response.status, 201, 'alta de cocina → 201');
    const beto = out.body.staff;
    const betoCredential = out.body.credential;
    const betoQr = parseEnrollment(out.body.enrollmentUrl);
    assert.strictEqual(beto.role, 'kitchen');
    assert.strictEqual(beto.roleLabel, 'Cocina');
    assert.strictEqual(betoQr.secret, betoCredential);

    out = await requestJson(base, '/api/studio/staff', {
      method: 'POST', headers: authA, body: JSON.stringify({ name: 'Rol Raro', role: 'admin' })
    });
    assert.strictEqual(out.response.status, 201, 'rol desconocido se degrada (allowlist)');
    assert.strictEqual(out.body.staff.role, 'waiter', 'nunca se persiste un rol fuera del catálogo');
    const raro = out.body.staff;

    out = await requestJson(base, '/api/studio/staff', { headers: authA });
    assert.strictEqual(out.body.staff.length, 3, '3 integrantes reales');
    assert.ok(out.body.staff.every((s) => !s.credentialHash && !s.credential_hash), 'lista sin hashes');
    assert.ok(out.body.staff.every((s) => s.activeSessions === 0), 'sin turnos al alta');

    // 3) Asignación de mesas: validada, ordenada, sin bumpear updatedAt.
    const beforeAssign = db.findRestaurantById(restA.id);
    const beforeUpdatedAt = beforeAssign.updatedAt;
    out = await requestJson(base, '/api/studio/staff/tables', {
      method: 'PATCH',
      headers: authA,
      body: JSON.stringify({ assignments: { '10': ana.id, '2': ana.id, 'Terraza 3': beto.id } })
    });
    assert.strictEqual(out.response.status, 200, 'asignar mesas → 200');
    assert.deepStrictEqual(out.body.assignments, { '10': ana.id, '2': ana.id, 'Terraza 3': beto.id });
    assert.deepStrictEqual(
      out.body.tables.map((t) => ({ number: t.number, label: t.label, name: t.staffName })),
      [
        { number: '2', label: 'Mesa 2', name: 'Ana Mozo' },
        { number: '10', label: 'Mesa 10', name: 'Ana Mozo' },
        { number: 'Terraza 3', label: 'Terraza 3', name: 'Beto Cocina' }
      ],
      'mesas numéricas primero, luego texto'
    );
    assert.strictEqual(
      db.findRestaurantById(restA.id).updatedAt,
      beforeUpdatedAt,
      'asignar mesas NO bumpea updatedAt (no dispara 409 de autosave)'
    );

    out = await requestJson(base, '/api/studio/staff', { headers: authA });
    const anaList = out.body.staff.find((s) => s.id === ana.id);
    assert.deepStrictEqual(anaList.tables.map((t) => t.label), ['Mesa 2', 'Mesa 10']);
    assert.deepStrictEqual(
      out.body.staff.find((s) => s.id === beto.id).tables.map((t) => t.label),
      ['Terraza 3']
    );

    out = await requestJson(base, '/api/studio/staff/tables', {
      method: 'PATCH', headers: authA, body: JSON.stringify({ assignments: { '1': 'staff_desconocido_1234' } })
    });
    assert.strictEqual(out.response.status, 400, 'staff ajeno/inexistente → 400');
    assert.strictEqual(out.body.code, 'INVALID_STAFF_ID');
    out = await requestJson(base, '/api/studio/staff/tables', {
      method: 'PATCH', headers: authA, body: JSON.stringify({ assignments: { '<script>': ana.id } })
    });
    assert.strictEqual(out.response.status, 400, 'mesa inválida → 400');
    assert.strictEqual(out.body.code, 'INVALID_TABLE_NUMBER');
    const afterBad = db.findRestaurantById(restA.id);
    assert.deepStrictEqual(afterBad.tableAssignments, { '10': ana.id, '2': ana.id, 'Terraza 3': beto.id }, 'un rechazo no muta el mapa');

    const tooMany = {};
    for (let i = 0; i < 201; i++) tooMany[String(i)] = ana.id;
    out = await requestJson(base, '/api/studio/staff/tables', {
      method: 'PATCH', headers: authA, body: JSON.stringify({ assignments: tooMany })
    });
    assert.strictEqual(out.response.status, 400, 'más de 200 mesas → 400');
    assert.strictEqual(out.body.code, 'TOO_MANY_TABLES');

    // 4) Activación del turno: el QR es una credencial, el token es opaco.
    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restA.id, staffId: ana.id, secret: 'x'.repeat(32) })
    });
    assert.strictEqual(out.response.status, 401, 'secreto incorrecto → 401');
    assert.strictEqual(out.body.code, 'STAFF_CREDENTIAL_INVALID');

    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restB.id, staffId: ana.id, secret: anaCredential })
    });
    assert.strictEqual(out.response.status, 401, 'QR de otro local → 401 (no enumera)');

    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restA.id, staffId: ana.id, secret: anaCredential })
    });
    assert.strictEqual(out.response.status, 200, 'QR válido activa turno → 200');
    const anaSession = out.body.data;
    assert.ok(anaSession && anaSession.token, 'token de sesión emitido');
    assert.notStrictEqual(anaSession.token, anaCredential, 'el token NO es el secreto del QR');
    assert.strictEqual(anaSession.token.length, 32);
    assert.strictEqual(anaSession.pushConfigured, false, 'sin VAPID se informa honestamente');
    assert.strictEqual(anaSession.staff.id, ana.id);
    assert.strictEqual(anaSession.staff.name, 'Ana Mozo');
    assert.ok(!anaSession.staff.credentialHash, 'la activación no filtra el hash');
    assert.strictEqual(anaSession.restaurant.id, restA.id);
    assert.ok(!anaSession.restaurant.userId, 'la PWA no recibe ids internos del dueño');
    assert.deepStrictEqual(anaSession.tables.map((t) => t.label), ['Mesa 2', 'Mesa 10']);
    const anaToken = anaSession.token;

    const sessionsAfterActivation = await db.listStaffSessions({ restaurantId: restA.id, staffId: ana.id });
    assert.strictEqual(sessionsAfterActivation.length, 1, 'una sesión persistida');
    assert.notStrictEqual(sessionsAfterActivation[0].tokenHash, anaToken, 'la nube/local guarda hash, nunca el token');
    assert.ok(sessionsAfterActivation[0].tokenHash.length === 64, 'hash HMAC persistido');

    // 5) /me, /tables, heartbeat y cierre idempotente.
    out = await requestJson(base, '/api/staff/me');
    assert.strictEqual(out.response.status, 401, 'me sin Bearer → 401');
    out = await requestJson(base, '/api/staff/me', { headers: { Authorization: 'Bearer corto' } });
    assert.strictEqual(out.response.status, 401, 'token inválido → 401');

    out = await requestJson(base, '/api/staff/me', { headers: authHeaders(anaToken) });
    assert.strictEqual(out.response.status, 200, 'me con token → 200');
    assert.strictEqual(out.body.data.staff.id, ana.id);
    assert.strictEqual(out.body.data.staff.name, 'Ana Mozo');
    assert.strictEqual(out.body.data.restaurant.id, restA.id);
    assert.ok(out.body.data.session.expiresAt, 'expiración visible');
    assert.deepStrictEqual(out.body.data.tables.map((t) => t.number), ['2', '10']);
    const meJson = JSON.stringify(out.body);
    for (const forbidden of ['credentialHash', 'credential_hash', 'tokenHash', 'token_hash', 'phone', 'email', 'userId']) {
      assert.ok(!meJson.includes(forbidden), `me no filtra ${forbidden}`);
    }

    out = await requestJson(base, '/api/staff/tables', { headers: authHeaders(anaToken) });
    assert.strictEqual(out.response.status, 200, 'tables con token → 200');
    assert.deepStrictEqual(out.body.data.tables.map((t) => t.label), ['Mesa 2', 'Mesa 10']);
    assert.strictEqual(out.body.data.staff.id, ana.id);

    out = await requestJson(base, '/api/staff/shift/heartbeat', {
      method: 'POST', headers: authHeaders(anaToken)
    });
    assert.strictEqual(out.response.status, 200, 'heartbeat → 200');
    assert.ok(out.body.data.expiresAt);
    assert.ok(Date.parse(out.body.data.expiresAt) >= Date.parse(anaSession.expiresAt), 'heartbeat no acorta');

    // 6) Push dirigido por staff_id: sin VAPID hay skip honesto, nunca a todos.
    const endpointShared = `https://example.com/staff-push/${runTag}/shared`;
    const fakeKeys = { p256dh: 'p'.repeat(24), auth: 'a'.repeat(12) };
    out = await requestJson(base, '/api/staff/push/subscribe', {
      method: 'POST',
      headers: authHeaders(anaToken),
      body: JSON.stringify({ endpoint: endpointShared, keys: fakeKeys })
    });
    assert.strictEqual(out.response.status, 200, 'suscribir push → 200');
    assert.strictEqual(out.body.data.pushConfigured, false);
    assert.strictEqual(out.body.data.delivered, 0);
    assert.strictEqual(out.body.data.skipped, 'PUSH_NOT_CONFIGURED', 'sin VAPID no se inventa entrega');

    let subs = await notificationsService.listSubscriptions({
      restaurantId: restA.id, role: 'waiter', staffId: ana.id
    });
    assert.ok(subs.some((s) => s.endpoint === endpointShared && (s.staff_id === ana.id || s.staffId === ana.id)), 'suscripción ligada a Ana');

    const dispatchOther = await notificationsService.sendStaffPush({
      restaurantId: restA.id,
      staffId: beto.id,
      title: 'Aviso',
      body: 'No debe cruzarse',
      type: 'staff_test'
    });
    assert.strictEqual(dispatchOther.skipped, 'NO_MATCHING_SUBSCRIBERS', 'el aviso de Beto no le llega a Ana');

    const dispatchAna = await notificationsService.sendStaffPush({
      restaurantId: restA.id,
      staffId: ana.id,
      title: 'Aviso',
      body: 'Solo Ana',
      type: 'staff_test'
    });
    assert.strictEqual(dispatchAna.checked, 1, 'un destinatario exacto');
    assert.strictEqual(dispatchAna.skipped, 'PUSH_NOT_CONFIGURED', 'sin VAPID el skip es honesto');
    const dispatchNoStaff = await notificationsService.sendStaffPush({ restaurantId: restA.id, title: 'x' });
    assert.strictEqual(dispatchNoStaff.skipped, 'STAFF_REQUIRED');

    out = await requestJson(base, '/api/staff/push/subscribe', {
      method: 'DELETE',
      headers: authHeaders(anaToken),
      body: JSON.stringify({ endpoint: `https://example.com/staff-push/${runTag}/ajena` })
    });
    assert.strictEqual(out.response.status, 404, 'no se puede borrar una suscripción ajena');
    assert.strictEqual(out.body.code, 'SUBSCRIPTION_NOT_FOUND');

    // Beto activa turno y usa la MISMA tablet/endpoint: el rebind deja la
    // suscripción apuntando a Beto, no a Ana (turno compartido).
    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restA.id, staffId: beto.id, secret: betoCredential })
    });
    assert.strictEqual(out.response.status, 200, 'turno de cocina activo');
    const betoToken = out.body.data.token;
    out = await requestJson(base, '/api/staff/push/subscribe', {
      method: 'POST',
      headers: authHeaders(betoToken),
      body: JSON.stringify({ endpoint: endpointShared, keys: fakeKeys })
    });
    assert.strictEqual(out.response.status, 200, 'el mismo endpoint se reasigna al nuevo turno');
    assert.strictEqual(out.body.data.skipped, 'PUSH_NOT_CONFIGURED');
    subs = await notificationsService.listSubscriptions({ restaurantId: restA.id, role: 'waiter', staffId: ana.id });
    assert.ok(!subs.some((s) => s.endpoint === endpointShared), 'Ana ya no recibe en la tablet compartida');
    subs = await notificationsService.listSubscriptions({ restaurantId: restA.id, role: 'waiter', staffId: beto.id });
    assert.ok(subs.some((s) => s.endpoint === endpointShared), 'Beto quedó ligado al endpoint');
    const dispatchAnaAfterRebind = await notificationsService.sendStaffPush({
      restaurantId: restA.id, staffId: ana.id, title: 'x', body: 'y'
    });
    assert.strictEqual(dispatchAnaAfterRebind.skipped, 'NO_MATCHING_SUBSCRIBERS', 'el rebind corta el aviso viejo');
    out = await requestJson(base, '/api/staff/push/subscribe', {
      method: 'DELETE',
      headers: authHeaders(betoToken),
      body: JSON.stringify({ endpoint: endpointShared })
    });
    assert.strictEqual(out.response.status, 200, 'baja de push propia → 200');

    // 7) Tabla fresca: el mapa se lee en cada request; no queda cacheado.
    out = await requestJson(base, '/api/studio/staff/tables', {
      method: 'PATCH', headers: authA, body: JSON.stringify({ assignments: { '2': ana.id, 'Terraza 3': beto.id } })
    });
    assert.strictEqual(out.response.status, 200);
    out = await requestJson(base, '/api/staff/tables', { headers: authHeaders(anaToken) });
    assert.deepStrictEqual(out.body.data.tables.map((t) => t.number), ['2'], 'Ana ve solo su mesa vigente');

    // 8) Revocar turnos sin rotar el QR; el mismo cartel vuelve a servir.
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}/sessions`, {
      method: 'DELETE', headers: authA
    });
    assert.strictEqual(out.response.status, 200, 'revocar sesiones → 200');
    assert.strictEqual(out.body.revoked, 1, 'revoca el turno vivo');
    out = await requestJson(base, '/api/staff/me', { headers: authHeaders(anaToken) });
    assert.strictEqual(out.response.status, 401, 'token revocado → 401');
    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restA.id, staffId: ana.id, secret: anaCredential })
    });
    assert.strictEqual(out.response.status, 200, 'el mismo QR sigue sirviendo tras revocar');
    const anaToken2 = out.body.data.token;

    // 9) Rotar QR: invalida el secreto viejo y TODAS las sesiones.
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}/credential`, {
      method: 'POST', headers: authA
    });
    assert.strictEqual(out.response.status, 200, 'rotar QR → 200');
    const newAnaCredential = out.body.credential;
    const newAnaQr = parseEnrollment(out.body.enrollmentUrl);
    assert.notStrictEqual(newAnaCredential, anaCredential, 'secreto nuevo');
    assert.strictEqual(newAnaQr.secret, newAnaCredential);
    assert.strictEqual(out.body.staff.activeSessions, 0, 'la rotación revoca turnos');
    out = await requestJson(base, '/api/staff/me', { headers: authHeaders(anaToken2) });
    assert.strictEqual(out.response.status, 401, 'rotar invalida el token anterior');
    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restA.id, staffId: ana.id, secret: anaCredential })
    });
    assert.strictEqual(out.response.status, 401, 'el QR viejo ya no sirve');
    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restA.id, staffId: ana.id, secret: newAnaCredential })
    });
    assert.strictEqual(out.response.status, 200, 'el QR nuevo activa');
    const anaToken3 = out.body.data.token;

    // 10) Desactivar: revoca turnos, bloquea el QR y la rotación; reactivar
    //     conserva el QR vigente y exige un turno nuevo.
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}`, {
      method: 'PATCH', headers: authA, body: JSON.stringify({ active: false })
    });
    assert.strictEqual(out.response.status, 200, 'desactivar → 200');
    assert.strictEqual(out.body.staff.active, false);
    assert.strictEqual(out.body.staff.activeSessions, 0);
    out = await requestJson(base, '/api/staff/me', { headers: authHeaders(anaToken3) });
    assert.strictEqual(out.response.status, 401, 'desactivar revoca el turno');
    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restA.id, staffId: ana.id, secret: newAnaCredential })
    });
    assert.strictEqual(out.response.status, 403, 'QR de persona desactivada → 403');
    assert.strictEqual(out.body.code, 'STAFF_INACTIVE');
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}/credential`, {
      method: 'POST', headers: authA
    });
    assert.strictEqual(out.response.status, 409, 'no se rota QR de persona inactiva');
    assert.strictEqual(out.body.code, 'STAFF_INACTIVE');
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}`, {
      method: 'PATCH', headers: authA, body: JSON.stringify({ active: true, name: 'Ana María' })
    });
    assert.strictEqual(out.response.status, 200, 'reactivar + renombrar → 200');
    assert.strictEqual(out.body.staff.active, true);
    assert.strictEqual(out.body.staff.name, 'Ana María');
    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restA.id, staffId: ana.id, secret: newAnaCredential })
    });
    assert.strictEqual(out.response.status, 200, 'reactivar sirve con el QR vigente');
    const anaToken4 = out.body.data.token;

    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}`, {
      method: 'PATCH', headers: authA, body: JSON.stringify({ role: 'admin' })
    });
    assert.strictEqual(out.response.status, 400, 'rol inválido → 400');
    assert.strictEqual(out.body.code, 'INVALID_STAFF_ROLE');

    // 11) Cross-tenant: ni lectura, ni asignación, ni edición, ni borrado.
    out = await requestJson(base, '/api/studio/staff', {
      method: 'POST', headers: authB, body: JSON.stringify({ name: 'Mozo B', role: 'waiter' })
    });
    assert.strictEqual(out.response.status, 201);
    const mozoB = out.body.staff;
    const mozoBCredential = out.body.credential;
    await requestJson(base, '/api/studio/staff/tables', {
      method: 'PATCH', headers: authB, body: JSON.stringify({ assignments: { '1': mozoB.id } })
    });
    out = await requestJson(base, '/api/studio/staff', { headers: authB });
    assert.strictEqual(out.body.staff.length, 1, 'B solo ve su equipo');
    assert.ok(!out.body.staff.some((s) => s.id === ana.id || s.id === beto.id), 'no ve el equipo de A');

    out = await requestJson(base, '/api/studio/staff/tables', {
      method: 'PATCH', headers: authB, body: JSON.stringify({ assignments: { '2': ana.id } })
    });
    assert.strictEqual(out.response.status, 400, 'B no puede asignar a un mozo de A');
    assert.strictEqual(out.body.code, 'INVALID_STAFF_ID');
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}`, {
      method: 'PATCH', headers: authB, body: JSON.stringify({ name: 'Hack' })
    });
    assert.strictEqual(out.response.status, 404, 'B no edita a A');
    assert.strictEqual(out.body.code, 'STAFF_NOT_FOUND');
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}/credential`, {
      method: 'POST', headers: authB
    });
    assert.strictEqual(out.response.status, 404, 'B no rota el QR de A');
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}/sessions`, {
      method: 'DELETE', headers: authB
    });
    assert.strictEqual(out.response.status, 404, 'B no revoca turnos de A');
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(ana.id)}`, {
      method: 'DELETE', headers: authB
    });
    assert.strictEqual(out.response.status, 404, 'B no borra a A');

    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restB.id, staffId: mozoB.id, secret: mozoBCredential })
    });
    assert.strictEqual(out.response.status, 200, 'turno de B activo');
    const mozoBToken = out.body.data.token;
    out = await requestJson(base, '/api/staff/tables', { headers: authHeaders(mozoBToken) });
    assert.deepStrictEqual(out.body.data.tables.map((t) => t.number), ['1'], 'B ve su mesa');
    assert.ok(!JSON.stringify(out.body).includes(restA.id), 'el turno de B no referencia el local A');

    // 12) Cierre de turno: idempotente, token muerto y push conservado.
    out = await requestJson(base, '/api/staff/shift/end', {
      method: 'POST', headers: authHeaders(mozoBToken)
    });
    assert.strictEqual(out.response.status, 200, 'cerrar turno → 200');
    out = await requestJson(base, '/api/staff/shift/end', {
      method: 'POST', headers: authHeaders(mozoBToken)
    });
    assert.strictEqual(out.response.status, 401, 'cerrar dos veces: el token ya no sirve (idempotente)');
    out = await requestJson(base, '/api/staff/me', { headers: authHeaders(mozoBToken) });
    assert.strictEqual(out.response.status, 401, 'turno cerrado no revive');

    // 13) Borrar persona: borra sesiones, libera mesas y quema el QR.
    out = await requestJson(base, `/api/studio/staff/${encodeURIComponent(beto.id)}`, {
      method: 'DELETE', headers: authA
    });
    assert.strictEqual(out.response.status, 200, 'borrar integrante → 200');
    assert.strictEqual(out.body.deleted, true);
    out = await requestJson(base, '/api/studio/staff', { headers: authA });
    assert.ok(!out.body.staff.some((s) => s.id === beto.id), 'ya no lista');
    assert.ok(!out.body.assignments['Terraza 3'], 'su mesa quedó libre');
    out = await requestJson(base, '/api/staff/shift/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restA.id, staffId: beto.id, secret: betoCredential })
    });
    assert.strictEqual(out.response.status, 401, 'cuenta borrada: QR muerto');
    await db.deleteStaff(raro.id, restA.id);

    // 14) Consentimiento/privacidad: la auditoría del equipo está registrada.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const logs = auditService.getAuditLogs(restA.id).map((a) => a.action);
    for (const action of ['STAFF_CREATED', 'STAFF_TABLE_ASSIGN', 'STAFF_SHIFT_START', 'STAFF_SESSIONS_REVOKED', 'STAFF_CREDENTIAL_ROTATED', 'STAFF_UPDATED', 'STAFF_DELETED']) {
      assert.ok(logs.includes(action), `auditoría ${action} registrada`);
    }

    // 15) RGPD: borrar la cuenta del dueño B arrastra equipo y sesiones.
    assert.ok((await db.listStaff(restB.id)).length > 0, 'B tenía equipo antes del borrado');
    await db.deleteRestaurantData(ownerB.id, restB.id);
    assert.strictEqual(db.findRestaurantById(restB.id), null, 'local B borrado');
    assert.deepStrictEqual(await db.listStaff(restB.id), [], 'staff B borrado');
    assert.deepStrictEqual(await db.listStaffSessions({ restaurantId: restB.id }), [], 'sesiones B borradas');

    console.log('✓ §5 Runtime: CRUD, QR/rotación/revocación, mesas, sesiones, push, cross-tenant, RGPD/audit');

    // ── §6 La PWA real servida por Express ────────────────────────────────────
    const page = await fetch(`${base}/mozo`);
    assert.strictEqual(page.status, 200, 'GET /mozo (dev express) → 200');
    const pageText = await page.text();
    assert.ok(pageText.includes('Mi Turno'), 'shell de la PWA servida');
    assert.ok(/script-src-attr\s+'none'/.test(page.headers.get('content-security-policy') || ''), 'CSP transitional en /mozo');
    assert.ok(/id="main-content"/.test(pageText), 'landmark main en la respuesta');
    console.log('✓ §6 PWA servida: /mozo 200 + CSP + main');

    console.log('✅ test-staff-waiter: Sistema de Mozos y Cocina (Fase 1) OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

runTests().catch((err) => {
  console.error('❌ test-staff-waiter falló:', err.stack || err.message);
  process.exit(1);
});
