/**
 * tests/test-p0-multireplica.js
 * ─────────────────────────────
 * Regresión del Lote 0 (P0) de la auditoría multi-réplica:
 *
 *  P0-1 · El Studio no puede guardar una carta vacía sobre la real ni crear un
 *         local duplicado en un cold start. `/api/auth/me` espera la
 *         hidratación cloud; un fallo de infraestructura es 503 (nunca
 *         "usuario sin local"); `/api/studio/save` rechaza `id:''` cuando el
 *         local ya existe; el frontend solo scaffoldea con
 *         `canCreateRestaurant:true`.
 *
 *  P0-3 · El listado de locales no puede depender del espejo efímero. En Vercel
 *         `data/` vive en /tmp (vacío en cada cold start) y solo se hidrataba
 *         por slug/id: los crons, el sitemap, `/ciudades`, `/descubrir` y el
 *         chequeo de slug único del Studio veían 0 locales hasta que alguien
 *         visitaba cada carta. `db.getAllRestaurantsAsync()` pagina la nube,
 *         fusiona con el espejo local y cachea ~60 s; el hot path del menú
 *         mantiene la hidratación lazy.
 *
 * Cero mocks: server HTTP real + store real. La parte cloud corre como probe
 * real con un PROCESO HIJO que tiene `SCANGO_DATA_DIR` vacío (otra réplica) y
 * la misma Supabase; si no hay credenciales, el probe se SKIPea honestamente.
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const app = require('../api/index');
const db = require('../src/db/db');

const SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const HAS_CLOUD = Boolean(process.env.SUPABASE_URL && SERVICE_KEY);
const REPO_ROOT = path.join(__dirname, '..');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(port, method, route, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? null : JSON.stringify(opts.body);
    const headers = { ...(opts.headers || {}) };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.cookie) headers.Cookie = opts.cookie;

    const req = http.request(
      { hostname: '127.0.0.1', port, path: route, method, headers, agent: false },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { /* body no JSON */ }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

function sessionToken(user) {
  // Mismo payload que mintSessionToken (auth.js): pwdTs permite verificar el
  // reset cross-réplica. Sin pwdTs el token es "legacy" y muere ante cualquier
  // updatedAt, que es justo lo que NO queremos medir acá.
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      pwdTs: user.updatedAt || user.createdAt || null
    },
    SECRET,
    { expiresIn: '10m' }
  );
}

function startChild(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'helpers', 'p0-cold-start-server.js')], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (e) { /* best-effort */ }
      reject(new Error(`cold-start child timeout.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 25000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/P0_PORT=(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          child,
          port: Number(match[1]),
          getOutput: () => ({ stdout, stderr })
        });
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`cold-start child exited (${code}).\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { /* best-effort */ }
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { child.kill('SIGTERM'); } catch (e) { clearTimeout(timer); resolve(); }
  });
}

/**
 * Corre un helper en un proceso hijo y resuelve cuando su stdout contiene
 * `marker` (p. ej. `P0_LIST=`). El proceso se mata al resolver y el probe
 * FALLA si nunca imprime el marcador o si excede `timeoutMs`: nunca hay un
 * "pasó por silencio".
 */
function runChildScript(scriptRel, env, marker, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, scriptRel)], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { child.kill(); } catch (e) { /* best-effort */ }
      fn(value);
    };
    timer = setTimeout(() => {
      finish(reject, new Error(`child ${scriptRel} timeout.\\nstdout:\\n${stdout}\\nstderr:\\n${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (!settled && stdout.includes(marker)) finish(resolve, { stdout, stderr });
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => {
      finish(reject, new Error(`child ${scriptRel} exited (${code}) sin "${marker}".\\nstdout:\\n${stdout}\\nstderr:\\n${stderr}`));
    });
  });
}

function readMarkerPayload(stdout, marker) {
  const at = stdout.indexOf(marker);
  assert.ok(at >= 0, `el hijo debe imprimir ${marker}`);
  const rest = stdout.slice(at + marker.length);
  const line = rest.split('\n')[0].trim();
  return JSON.parse(line);
}

async function waitCloudRow(cloud, table, column, value, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data, error } = await cloud.from(table).select('id').eq(column, value).limit(1);
    if (error) throw new Error(`waitCloudRow(${table}.${column}): ${error.message}`);
    if (Array.isArray(data) && data.length) return data[0];
    await sleep(250);
  }
  throw new Error(`La fila cloud ${table}.${column}=${value} no apareció en ${timeoutMs}ms`);
}

/**
 * Archivos que NECESITAN la lista COMPLETA de locales (no solo el local del
 * request): crons que recorren TODO el padrón, sitemap/ciudades y el chequeo de
 * unicidad de slug del Studio/Admin. Todos deben usar la variante async
 * (nube ∪ espejo). El hot path del menú (`/m/*`, `/api/menu/:slug`) sigue con
 * la hidratación lazy a propósito: no se le suma un full-scan por request.
 */
const FULL_LISTING_CONSUMERS = [
  'api/cron/billing-dunning.js',
  'api/cron/night-summary.js',
  'api/cron/review-nudge.js',
  'api/cron/reservation-reminders.js',
  'api/cron/seo-audit.js',
  'api/routes/studio.js',
  'api/routes/discover.js',
  'api/routes/admin.js',
  'api/routes/discovery.js'
];

/**
 * Guard estático P0-3: la primitiva del listado completo vive en UN lugar y los
 * consumidores de padrón completo no pueden volver al listado síncrono (que en
 * una réplica fría devuelve 0). Sin este guard el bug reaparece en silencio en
 * el próximo refactor.
 */
function guardListRestaurantsSources() {
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

  const dbSource = read('src/db/db.js');
  assert.ok(
    /async function fetchAllCloudRestaurants\s*\(/.test(dbSource),
    'src/db/db.js debe paginar la nube (fetchAllCloudRestaurants)'
  );
  assert.ok(
    dbSource.includes('async getAllRestaurantsAsync(opts)'),
    'src/db/db.js debe exponer getAllRestaurantsAsync(opts)'
  );
  assert.ok(
    dbSource.includes('ALL_RESTAURANTS_TTL_MS'),
    'src/db/db.js debe cachear el listado completo (ALL_RESTAURANTS_TTL_MS)'
  );

  for (const rel of FULL_LISTING_CONSUMERS) {
    const src = read(rel);
    assert.ok(
      src.includes('getAllRestaurantsAsync'),
      `${rel} debe listar con db.getAllRestaurantsAsync() (en una réplica fría el espejo local está vacío)`
    );
  }

  const discovery = read('api/routes/discovery.js');
  assert.ok(
    discovery.includes('async function publicMenuRestaurants'),
    'discovery.js: publicMenuRestaurants() debe ser async (nube ∪ espejo)'
  );
  assert.ok(
    discovery.includes("router.get('/sitemap.xml', async"),
    'discovery.js: /sitemap.xml debe esperar el listado async'
  );

  console.log(`✓ P0-3 static: ${FULL_LISTING_CONSUMERS.length} consumidores usan el listado completo (nube ∪ espejo)`);
}

/**
 * Guard estático de las reglas de limpieza cloud (`scripts/test-cloud-cleanup.js`).
 * Oct-2026: el fix P0-3 hizo visible que 92 locales fixture sobrevivían a cada
 * corrida (60 con `@example.test`, 15 `refund-owner_*@pizarron.com`, 17
 * `@example.com`) porque la regla de email solo cubría `example.com`. Los
 * dominios reservados por RFC 2606/6761 no pueden pertenecer a un cliente real,
 * y los tombstones RGPD NUNCA son víctimas (borrarlos habilitaría la
 * resurrección de una cuenta borrada).
 */
function guardCloudCleanupRules() {
  const { isTestEmail, isTestSlug } = require('../scripts/test-cloud-cleanup');

  const fixtures = [
    // Dominios reservados RFC 2606/6761 (cualquier local-part).
    'takeaway-r1-1790000000000@example.test',
    'owner@example.com',
    'owner@example.org',
    'owner@example.net',
    'owner@sub.example.test',
    'persona@dev.localhost',
    'printer@casa.invalid',
    'dueno@test.local',
    // Prefijos sintéticos sobre dominios de la casa.
    'refund-owner_1792726267027@pizarron.com',
    'test-restaurante@pizarron.com',
    'qa_owner@pizarron.com',
    'session-owner-123@pizarron.com',
    'diag_api_user@pizarron.com',
    'owner@bistro.com'
  ];
  for (const email of fixtures) {
    assert.strictEqual(isTestEmail(email), true, `${email} debe reconocerse como fixture`);
  }

  const real = [
    'matias@gmail.com',
    'duena@parrilla.uy',
    'hola@scango.uy',
    'info@restaurante.com.uy',
    'contacto@pizzeria.testimonial.com'
  ];
  for (const email of real) {
    assert.strictEqual(isTestEmail(email), false, `${email} NO es fixture (nunca borrar un dueño real)`);
  }

  assert.strictEqual(
    isTestEmail('deleted+abc123@deleted.invalid'),
    false,
    'un tombstone RGPD jamás es víctima del cleanup (resucitaría la cuenta borrada)'
  );

  // Fallback por slug: huérfanos cuyo dueño ya no existe en el archivo.
  const fixtureSlugs = [
    'refund-test-1792512713986',
    'mi-local',
    'demo',
    'dbg1793248054506',
    'tracking-1790000000000',
    'claim-123'
  ];
  for (const slug of fixtureSlugs) {
    assert.strictEqual(isTestSlug(slug), true, `el slug fixture ${slug} debe limpiarse`);
  }

  const realSlugs = [
    'parrilla-del-puerto',
    'demo-heladeria',
    'casa-aromas',
    'mi-local-nuevo',
    'demolicion'
  ];
  for (const slug of realSlugs) {
    assert.strictEqual(isTestSlug(slug), false, `el slug real ${slug} NO debe borrarse`);
  }

  console.log('✓ P0-3 static: las reglas de limpieza cloud cubren dominios reservados y respetan tombstones');
}

async function runLocalRegression() {
  const stamp = Date.now();
  const email = `p0-local-${stamp}@example.com`;
  const user = await db.createUser({
    email,
    password: bcrypt.hashSync('test_password', 10),
    name: 'P0 Local Owner',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'P0 Bistro',
    bizName: 'P0 Bistro',
    slug: `p0-local-${stamp}`,
    categories: [{ id: 'cat_p0', name: 'Carta' }],
    dishes: [{ id: 'dish_p0', categoryId: 'cat_p0', name: 'Milanesa', price: 100 }]
  });
  const token = sessionToken(user);
  const cookie = `auth_token=${token}`;

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  let newUserId = null;
  let newRestaurantId = null;
  try {
    // 1. /me devuelve el local REAL y NO autoriza crear otro.
    const me = await request(port, 'GET', '/api/auth/me', { cookie });
    assert.strictEqual(me.status, 200, '/me con sesión válida → 200');
    assert.ok(me.body && me.body.restaurant, '/me debe devolver el restaurante');
    assert.strictEqual(me.body.restaurant.id, restaurant.id, '/me devuelve el restaurante del dueño');
    assert.strictEqual(me.body.canCreateRestaurant, false, 'con local existente canCreateRestaurant=false');

    // 2. El payload del cold start (id:'' y restaurantId:'') NO puede pisar la carta.
    const emptyPayload = {
      restaurantId: '',
      data: { id: '', name: 'Vacío', categories: [], dishes: [] }
    };
    const emptySave = await request(port, 'POST', '/api/studio/save', { cookie, body: emptyPayload });
    assert.strictEqual(emptySave.status, 409, 'save con id vacío sobre un local existente → 409');
    assert.strictEqual(emptySave.body.code, 'RESTAURANT_ID_REQUIRED');
    const afterEmpty = db.findRestaurantById(restaurant.id);
    assert.ok(afterEmpty, 'el local sigue existiendo');
    assert.strictEqual(afterEmpty.dishes.length, 1, 'la carta NO se vació');
    assert.strictEqual(afterEmpty.dishes[0].id, 'dish_p0');

    // 3. Un id de otro local tampoco se acepta.
    const mismatch = await request(port, 'POST', '/api/studio/save', {
      cookie,
      body: { restaurantId: restaurant.id, data: { id: 'rest_otro', name: 'Otro' } }
    });
    assert.strictEqual(mismatch.status, 409, 'save con id ajeno → 409');
    assert.strictEqual(mismatch.body.code, 'RESTAURANT_ID_MISMATCH');

    // 4. El cliente legacy que no manda id sigue guardando (compatibilidad).
    const legacy = await request(port, 'POST', '/api/studio/save', {
      cookie,
      body: { data: { name: 'P0 Bistro Renovado' } }
    });
    assert.strictEqual(legacy.status, 200, 'cliente legacy sin id sigue guardando → 200');
    assert.strictEqual(db.findRestaurantById(restaurant.id).name, 'P0 Bistro Renovado');

    // 5. Un usuario SIN local sí puede crear el suyo (canCreateRestaurant=true).
    const newUser = await db.createUser({
      email: `p0-new-${stamp}@example.com`,
      password: bcrypt.hashSync('test_password', 10),
      name: 'P0 New Owner',
      email_confirmed_at: new Date().toISOString()
    });
    newUserId = newUser.id;
    const newToken = sessionToken(newUser);
    const newCookie = `auth_token=${newToken}`;

    const meNew = await request(port, 'GET', '/api/auth/me', { cookie: newCookie });
    assert.strictEqual(meNew.status, 200, '/me de usuario sin local → 200');
    assert.strictEqual(meNew.body.restaurant, null, 'usuario sin local devuelve restaurant:null');
    assert.strictEqual(meNew.body.canCreateRestaurant, true, 'sin local canCreateRestaurant=true');

    const create = await request(port, 'POST', '/api/studio/save', {
      cookie: newCookie,
      body: { restaurantId: '', data: { id: '', name: 'Nuevo Local P0', slug: `p0-new-${stamp}` } }
    });
    assert.strictEqual(create.status, 200, 'el alta legítima de un local nuevo → 200');
    assert.ok(create.body.restaurant && create.body.restaurant.id, 'el alta devuelve el local creado');
    newRestaurantId = create.body.restaurant.id;

    const meAfter = await request(port, 'GET', '/api/auth/me', { cookie: newCookie });
    assert.strictEqual(meAfter.status, 200);
    assert.strictEqual(meAfter.body.restaurant.id, newRestaurantId);
    assert.strictEqual(meAfter.body.canCreateRestaurant, false, 'tras crear el local ya no puede crear otro');

    // 6. P0-3 · El listado COMPLETO incluye los locales recién creados. Sin
    // Supabase el async ES el espejo local: cero comportamiento nuevo en modo
    // JSON (los tests corren con datos locales y no deben cambiar de forma).
    const asyncList = await db.getAllRestaurantsAsync();
    assert.ok(Array.isArray(asyncList), 'getAllRestaurantsAsync() devuelve un array');
    assert.ok(
      asyncList.some((r) => r && r.id === restaurant.id),
      'el listado completo incluye el local del dueño'
    );
    assert.ok(
      asyncList.some((r) => r && r.id === newRestaurantId),
      'el listado completo incluye el local recién creado'
    );
    if (!HAS_CLOUD) {
      const syncIds = db.getAllRestaurants().map((r) => r && r.id).sort();
      const asyncIds = asyncList.map((r) => r && r.id).sort();
      assert.deepStrictEqual(asyncIds, syncIds, 'sin Supabase el listado async ES el espejo local');
    }

    // 7. El frontend solo scaffoldea con la autorización explícita del server.
    const authSource = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'studio', 'auth.js'), 'utf8');
    assert.ok(
      authSource.includes('data.canCreateRestaurant !== true'),
      'studio/auth.js debe exigir canCreateRestaurant===true para scaffoldear'
    );
    assert.ok(
      authSource.includes('showRestaurantLoadError'),
      'studio/auth.js debe mostrar error honesto cuando el local no carga'
    );

    console.log('✓ P0-1: /me espera el local, save rechaza id vacío/ajeno y el alta legítima sigue funcionando');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    // El borrado ahora es cloud-first y puede lanzar ACCOUNT_DELETE_FAILED:
    // el cleanup de un test nunca debe tumbar la suite.
    try { await db.deleteRestaurantData(user.id, restaurant.id); } catch (e) { /* best-effort */ }
    if (newUserId) {
      try { await db.deleteRestaurantData(newUserId, newRestaurantId); } catch (e) { /* best-effort */ }
    }
  }
}

async function runCloudColdStartProbe() {
  const { createClient } = require('@supabase/supabase-js');
  const cloud = createClient(process.env.SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const stamp = Date.now();
  const email = `p0-coldstart-${stamp}@example.com`;
  const user = await db.createUser({
    email,
    password: bcrypt.hashSync('test_password', 10),
    name: 'P0 Cold Owner',
    email_confirmed_at: new Date().toISOString()
  });
  // La FK restaurants.user_id exige que el usuario exista en cloud ANTES del
  // insert del local. createUser/saveRestaurant son fire-and-forget: drenamos
  // entre ambos para que el probe no dependa de una carrera de red.
  await db.flushCloudWrites();
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'P0 Cold Bistro',
    bizName: 'P0 Cold Bistro',
    slug: `p0-cold-${stamp}`,
    categories: [{ id: 'cat_cold', name: 'Carta' }],
    dishes: [{ id: 'dish_cold', categoryId: 'cat_cold', name: 'Milanesa', price: 120 }]
  });

  let child = null;
  let tempDir = null;
  try {
    await db.flushCloudWrites();
    await waitCloudRow(cloud, 'users', 'id', user.id);
    await waitCloudRow(cloud, 'restaurants', 'id', restaurant.id);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scango-p0-cold-'));
    child = await startChild({
      ...process.env,
      SCANGO_DATA_DIR: tempDir,
      JWT_SECRET: SECRET,
      NODE_ENV: process.env.NODE_ENV || 'test'
    });

    const token = sessionToken(user);
    const me = await request(child.port, 'GET', '/api/auth/me', { token });
    assert.strictEqual(me.status, 200, 'cold start: /me → 200');
    assert.ok(me.body && me.body.restaurant, 'cold start: /me hidrata el local desde Supabase');
    assert.strictEqual(me.body.restaurant.id, restaurant.id, 'cold start: es el MISMO local');
    assert.strictEqual(me.body.canCreateRestaurant, false, 'cold start: NO ofrece crear un duplicado');

    const localRows = JSON.parse(fs.readFileSync(path.join(tempDir, 'restaurants.json'), 'utf8'));
    assert.ok(localRows.some((r) => r.id === restaurant.id), 'cold start: el local quedó persistido en el JSON local');

    const emptySave = await request(child.port, 'POST', '/api/studio/save', {
      token,
      body: { restaurantId: '', data: { id: '', name: 'Vacío', categories: [], dishes: [] } }
    });
    assert.strictEqual(emptySave.status, 409, 'cold start: save con id vacío → 409');
    assert.strictEqual(emptySave.body.code, 'RESTAURANT_ID_REQUIRED');

    const goodSave = await request(child.port, 'POST', '/api/studio/save', {
      token,
      body: { restaurantId: restaurant.id, data: { id: restaurant.id, name: 'P0 Cold Renovado' } }
    });
    assert.strictEqual(goodSave.status, 200, 'cold start: save con id correcto → 200');

    console.log('✓ P0-1 cloud: réplica con DATA_DIR vacío hidrata el local por /me y no lo pisa');
  } finally {
    await stopChild(child);
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
    }
    try { await db.deleteRestaurantData(user.id, restaurant.id); } catch (e) { /* best-effort */ }
  }
}

function readJsonFile(dir, name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

async function startReplica(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const child = await startChild({
    ...process.env,
    SCANGO_DATA_DIR: dir,
    JWT_SECRET: SECRET,
    NODE_ENV: process.env.NODE_ENV || 'test',
    // Sin caché de frescura: cada request de la réplica consulta la nube, que
    // es exactamente lo que hay que probar (token viejo vs tombstone/reset).
    USER_FRESH_TTL_MS: '0'
  });
  return { child, dir };
}

async function stopReplica(replica) {
  if (!replica) return;
  await stopChild(replica.child);
  if (replica.dir) {
    try { fs.rmSync(replica.dir, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
  }
}

/**
 * P0-2 · Borrado cross-réplica: una réplica borra la cuenta y las demás deben
 * ver el tombstone (nunca resucitar desde su JSON viejo).
 */
async function runCloudDeleteProbe() {
  const { createClient } = require('@supabase/supabase-js');
  const cloud = createClient(process.env.SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const stamp = Date.now();
  const email = `p0-del-${stamp}@example.com`;
  const user = await db.createUser({
    email,
    password: bcrypt.hashSync('delete_password', 10),
    name: 'P0 Delete Owner',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'P0 Delete Bistro',
    bizName: 'P0 Delete Bistro',
    slug: `p0-del-${stamp}`,
    categories: [{ id: 'cat_del', name: 'Carta' }],
    dishes: [{ id: 'dish_del', categoryId: 'cat_del', name: 'Milanesa', price: 130 }]
  });
  const token = sessionToken(user);
  let replicaB = null;
  let replicaC = null;
  try {
    await db.flushCloudWrites();
    await waitCloudRow(cloud, 'users', 'id', user.id);
    await waitCloudRow(cloud, 'restaurants', 'id', restaurant.id);

    // Réplica B: arranca con DATA_DIR vacío y borra la cuenta por la API real.
    replicaB = await startReplica('scango-p0-del-b-');
    const del = await request(replicaB.child.port, 'POST', '/api/account/delete-request', {
      cookie: `auth_token=${token}`,
      body: { confirm: true, reason: 'P0-2 cross-replica delete' }
    });
    assert.strictEqual(del.status, 200, 'borrado cross-réplica → 200');
    assert.strictEqual(del.body.deleted, true, 'el borrado confirma deleted:true');

    const meDead = await request(replicaB.child.port, 'GET', '/api/auth/me', { token });
    assert.strictEqual(meDead.status, 401, 'token viejo en la réplica que borró → 401');

    // Nube: tombstone sin PII + restaurante realmente borrado.
    const { data: cloudUser, error: userErr } = await cloud
      .from('users')
      .select('email,email_confirmed_at')
      .eq('id', user.id)
      .maybeSingle();
    if (userErr) throw userErr;
    assert.ok(cloudUser, 'la fila cloud sigue existiendo como tombstone');
    assert.ok(/^deleted\+.+@deleted\.invalid$/i.test(cloudUser.email), 'tombstone con email marcador, sin PII');
    assert.strictEqual(cloudUser.email_confirmed_at, null, 'tombstone sin email confirmado');

    const { data: cloudRest, error: restErr } = await cloud
      .from('restaurants')
      .select('id')
      .eq('id', restaurant.id)
      .maybeSingle();
    if (restErr) throw restErr;
    assert.strictEqual(cloudRest, null, 'el restaurante cloud se borró (el tombstone no dispara el CASCADE)');

    // Réplica A (padre): el lookup fresco ve el tombstone y tombstonea su JSON.
    const state = await db.getUserSessionState(user.id);
    assert.strictEqual(state.status, 'deleted', 'la réplica A ve deleted por la nube');
    assert.strictEqual(db.findUserById(user.id), null, 'findUserById ya no devuelve la cuenta');
    assert.strictEqual(db.findUserByEmail(email), null, 'findUserByEmail tampoco');

    // Réplica C: cold start de cero; el boot hidrata el tombstone y no resucita.
    replicaC = await startReplica('scango-p0-del-c-');
    const meCold = await request(replicaC.child.port, 'GET', '/api/auth/me', { token });
    assert.strictEqual(meCold.status, 401, 'cold start con tombstone → 401');

    const loginCold = await request(replicaC.child.port, 'POST', '/api/auth/login', {
      body: { email, password: 'delete_password' }
    });
    assert.strictEqual(loginCold.status, 401, 'login de una cuenta borrada → 401');

    const localUsers = readJsonFile(replicaC.dir, 'users.json', []);
    const tombstone = localUsers.find((u) => u && u.id === user.id);
    assert.ok(tombstone, 'la réplica C hidrató el tombstone');
    assert.ok(/^deleted\+/.test(tombstone.email), 'el tombstone local no guarda el email original');
    assert.strictEqual(tombstone.email_confirmed_at, null, 'el tombstone local no conserva confirmación');

    const localRests = readJsonFile(replicaC.dir, 'restaurants.json', []);
    assert.ok(
      !localRests.some((r) => r && r.id === restaurant.id),
      'la réplica C no resucita el restaurante borrado'
    );

    console.log('✓ P0-2 cloud: borrado cross-réplica deja tombstone, mata el token viejo y no resucita en cold start');
  } finally {
    await stopReplica(replicaB);
    await stopReplica(replicaC);
    try { await db.deleteRestaurantData(user.id, restaurant.id); } catch (e) { /* best-effort */ }
  }
}

/**
 * P0-2 · Reset cross-réplica: el `pwdTs` se persiste en la nube ANTES de
 * responder; otra réplica con DATA_DIR vacío rechaza el token viejo y acepta
 * la clave nueva.
 */
async function runCloudResetProbe() {
  const { createClient } = require('@supabase/supabase-js');
  const cloud = createClient(process.env.SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const stamp = Date.now();
  const email = `p0-reset-${stamp}@example.com`;
  const user = await db.createUser({
    email,
    password: bcrypt.hashSync('old_password', 10),
    name: 'P0 Reset Owner',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'P0 Reset Bistro',
    bizName: 'P0 Reset Bistro',
    slug: `p0-reset-${stamp}`,
    categories: [{ id: 'cat_reset', name: 'Carta' }],
    dishes: [{ id: 'dish_reset', categoryId: 'cat_reset', name: 'Milanesa', price: 140 }]
  });
  const oldToken = sessionToken(user);
  let replica = null;
  try {
    await db.flushCloudWrites();
    await waitCloudRow(cloud, 'users', 'id', user.id);
    await waitCloudRow(cloud, 'restaurants', 'id', restaurant.id);

    // Reset en la réplica A (padre): cloud-first, pwdTs = updated_at nuevo.
    const updated = await db.updateUserPassword(user.id, bcrypt.hashSync('new_password', 10));
    assert.ok(updated && updated.updatedAt, 'updateUserPassword devuelve updatedAt');
    assert.notStrictEqual(
      updated.updatedAt,
      user.updatedAt || user.createdAt,
      'el reset cambia el pwdTs'
    );
    await db.flushCloudWrites();

    const { data: cloudRow, error: cloudErr } = await cloud
      .from('users')
      .select('updated_at')
      .eq('id', user.id)
      .maybeSingle();
    if (cloudErr) throw cloudErr;
    assert.ok(cloudRow && cloudRow.updated_at, 'el updated_at del reset está en la nube');
    assert.strictEqual(
      new Date(cloudRow.updated_at).getTime(),
      new Date(updated.updatedAt).getTime(),
      'la nube tiene EXACTAMENTE el pwdTs del reset'
    );

    // Réplica B: DATA_DIR vacío, sin caché de frescura.
    replica = await startReplica('scango-p0-reset-');
    const meOld = await request(replica.child.port, 'GET', '/api/auth/me', { token: oldToken });
    assert.strictEqual(meOld.status, 401, 'token emitido antes del reset → 401 en otra réplica');

    const loginOld = await request(replica.child.port, 'POST', '/api/auth/login', {
      body: { email, password: 'old_password' }
    });
    assert.strictEqual(loginOld.status, 401, 'la clave vieja ya no entra');

    const loginNew = await request(replica.child.port, 'POST', '/api/auth/login', {
      body: { email, password: 'new_password' }
    });
    assert.strictEqual(loginNew.status, 200, 'la clave nueva entra en la réplica fría');
    assert.ok(loginNew.body && loginNew.body.user, 'el login devuelve el usuario');

    console.log('✓ P0-2 cloud: reset cross-réplica persiste pwdTs, mata el token viejo y la clave nueva entra');
  } finally {
    await stopReplica(replica);
    try { await db.deleteRestaurantData(user.id, restaurant.id); } catch (e) { /* best-effort */ }
  }
}

/**
 * P0-3 · Listado completo cross-réplica: una réplica FRÍA (`SCANGO_DATA_DIR`
 * vacío, como /tmp en Vercel) no ve NADA en su espejo local, pero
 * `getAllRestaurantsAsync()` debe traer la nube paginada. Es exactamente el bug
 * que dejaba `checked:0` en los crons y un sitemap sin `/m/*` hasta que alguien
 * visitaba cada carta.
 */
async function runCloudListProbe() {
  const { createClient } = require('@supabase/supabase-js');
  const cloud = createClient(process.env.SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const stamp = Date.now();
  const email = `p0-list-${stamp}@example.com`;
  const user = await db.createUser({
    email,
    password: bcrypt.hashSync('test_password', 10),
    name: 'P0 List Owner',
    email_confirmed_at: new Date().toISOString()
  });
  // La FK restaurants.user_id exige el usuario en cloud ANTES del local.
  await db.flushCloudWrites();
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'P0 List Bistro',
    bizName: 'P0 List Bistro',
    slug: `p0-list-${stamp}`,
    categories: [{ id: 'cat_list', name: 'Carta' }],
    dishes: [{ id: 'dish_list', categoryId: 'cat_list', name: 'Milanesa', price: 130 }]
  });

  let tempDir = null;
  try {
    await db.flushCloudWrites();
    await waitCloudRow(cloud, 'users', 'id', user.id);
    await waitCloudRow(cloud, 'restaurants', 'id', restaurant.id);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scango-p0-list-'));
    const { stdout } = await runChildScript(
      'helpers/p0-list-restaurants.js',
      { ...process.env, SCANGO_DATA_DIR: tempDir },
      'P0_LIST='
    );
    const payload = readMarkerPayload(stdout, 'P0_LIST=');

    assert.ok(Array.isArray(payload.sync), 'el hijo reporta el listado síncrono como array');
    assert.ok(Array.isArray(payload.full), 'el hijo reporta el listado completo como array');
    assert.ok(
      !payload.sync.includes(restaurant.slug),
      `el espejo local de la réplica fría NO ve ${restaurant.slug} (el bug original)`
    );
    assert.ok(
      payload.full.includes(restaurant.slug),
      `getAllRestaurantsAsync() trae ${restaurant.slug} desde la nube en una réplica fría`
    );
    assert.ok(
      payload.full.length > payload.sync.length,
      'el listado completo supera al espejo efímero de una réplica fría'
    );

    console.log(
      `✓ P0-3 cloud: réplica fría ve ${payload.sync.length} locales en el espejo y ${payload.full.length} con el listado completo`
    );
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    try { await db.deleteRestaurantData(user.id, restaurant.id); } catch (e) { /* best-effort */ }
  }
}

async function runTests() {
  assert.ok(db.ready && typeof db.ready.then === 'function', 'db.ready debe existir');
  await db.ready;

  await runLocalRegression();
  guardListRestaurantsSources();
  guardCloudCleanupRules();
  if (HAS_CLOUD) {
    await runCloudColdStartProbe();
    await runCloudDeleteProbe();
    await runCloudResetProbe();
    await runCloudListProbe();
  } else {
    console.log('↷ P0-1/P0-2/P0-3 cloud probes SKIP: sin SUPABASE_URL + service key (no se inventan resultados)');
  }

  console.log('\n🎉 LOTE 0 / P0-1 + P0-2 + P0-3 VERIFICADO CON SERVER REAL');
}

runTests()
  .then(() => {
    console.log('✅ test-p0-multireplica.js OK');
    // El cliente Supabase y el server dejan handles keep-alive; el patrón de
    // la casa es salir explícitamente una vez que todo el cleanup terminó.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
