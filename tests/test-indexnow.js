/**
 * Test Suite: IndexNow — api/utils/indexNow.js + verificación /{key}.txt
 *
 * IndexNow (Bing, Yandex, Seznam, Naver) notifica a los buscadores que una URL
 * cambió para solicitar indexación casi inmediata. Todo es best-effort — jamás
 * bloquea ni rompe el save. Esto verifica:
 *
 *   1. Módulo puro: validación de key (patrón [0-9a-fA-F-]{8,64} = UUID/hex con
 *      guiones, el MISMO de la ruta de vercel.json que desvía /{key}.txt al API),
 *      GETTERS de config fail-closed (INDEXNOW_ENABLED=false apaga el ping),
 *      buildIndexNowUrl nunca acepta javascript:/data:, getMenuUrlsForPing
 *      devuelve la canonical + cada sucursal real (?branch=).
 *   2. Dispatch POST bulk con fetch INYECTADO (cero red): payload exacto
 *      {host, key, keyLocation, urlList} con un único host por lote.
 *   3. Ruta runtime GET /{key}.txt: 200 text/plain con la key exacta; key
 *      distinta → 404; y /llms.txt (4 chars, estático) SEGUE sirviéndose —
 *      regresión: la ruta no pisa el .txt estático de GEO.
 *   4. Hook del Studio: el save llama a dispatchIndexNowPing protegido por
 *      isIndexNowEnabled (análisis de fuente, no de runtime).
 *
 * Sin mocks de red: el fetchIndexNow se inyecta SOLO en la fase 2 (patrón
 * test-weather); el resto usa flujos reales (server + db).
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const app = require('../api/index');
const indexNow = require('../api/utils/indexNow');
const {
  INDEXNOW_ENDPOINT,
  isValidIndexNowKey,
  getIndexNowKey,
  isIndexNowEnabled,
  buildIndexNowUrl,
  getMenuUrlsForPing,
  dispatchIndexNowPing
} = indexNow;

const VALID_KEY = '01234567-89ab-cdef-0123-456789abcdef'; // UUID hex (patrón válido)

/**
 * Snapshot/restore de las variables de entorno que toca la suite. Async-aware:
 * si `fn` devuelve una promesa, el restore espera a que resuelva (si no, la fase
 * de runtime arrancaría con el env YA restaurado).
 */
async function withIndexNowEnv(keyValue, enabledValue, fn) {
  const prevKey = process.env.INDEXNOW_KEY;
  const prevEnabled = process.env.INDEXNOW_ENABLED;
  if (keyValue === undefined) delete process.env.INDEXNOW_KEY;
  else process.env.INDEXNOW_KEY = keyValue;
  if (enabledValue === undefined) delete process.env.INDEXNOW_ENABLED;
  else process.env.INDEXNOW_ENABLED = enabledValue;
  try {
    return await fn();
  } finally {
    if (prevKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = prevKey;
    if (prevEnabled === undefined) delete process.env.INDEXNOW_ENABLED;
    else process.env.INDEXNOW_ENABLED = prevEnabled;
  }
}

async function runTests() {
  // ── Fase 1: módulo puro ────────────────────────────────────────────────────
  console.log('🧪 IndexNow: key fail-closed, URLs de ping, payload bulk, verificación .txt...');

  // 1a. Validación de key (el patrón ES el contrato con vercel.json).
  assert.ok(isValidIndexNowKey(VALID_KEY), 'UUID con guiones es válido');
  assert.ok(isValidIndexNowKey('a1b2c3d4e5f67890'), 'hex sin guiones es válido');
  assert.ok(!isValidIndexNowKey('short'), '< 8 chars inválido');
  assert.ok(!isValidIndexNowKey(''), 'vacío inválido');
  assert.ok(!isValidIndexNowKey(null), 'null inválido');
  assert.ok(!isValidIndexNowKey(12345678), 'número inválido');
  assert.ok(!isValidIndexNowKey('llms-full'), 'letras no-hex inválidas (no pisa llms-full.txt estático)');
  assert.ok(
    !isValidIndexNowKey('a'.repeat(65)),
    '> 64 chars inválido (tocha el tope de la ruta vercel)'
  );

  // 1b. Getter de key + fail-closed del flag.
  await withIndexNowEnv(VALID_KEY, undefined, () => {
    assert.strictEqual(getIndexNowKey(), VALID_KEY, 'key válida configurada → se lee');
    assert.strictEqual(isIndexNowEnabled(), true, 'con key válida el ping está habilitado');
  });
  await withIndexNowEnv('clave-invalida', undefined, () => {
    assert.strictEqual(getIndexNowKey(), '', 'key fuera de patrón → vacía (fail-closed)');
    assert.strictEqual(isIndexNowEnabled(), false, 'sin key válida el ping NO se dispara');
  });
  await withIndexNowEnv(VALID_KEY, 'false', () => {
    assert.strictEqual(isIndexNowEnabled(), false, 'INDEXNOW_ENABLED=false apaga aunque haya key');
  });
  await withIndexNowEnv(VALID_KEY, '0', () => {
    assert.strictEqual(isIndexNowEnabled(), false, 'INDEXNOW_ENABLED=0 también apaga');
  });
  await withIndexNowEnv(undefined, undefined, () => {
    assert.strictEqual(getIndexNowKey(), '', 'sin env → sin key');
    assert.strictEqual(isIndexNowEnabled(), false, 'sin env → deshabilitado');
  });

  // 1c. buildIndexNowUrl: ping GET por URL (spec), nunca contra esquemas raros.
  const ping = buildIndexNowUrl({ key: VALID_KEY, url: 'https://scango.app/m/bistro' });
  assert.ok(ping && ping.startsWith(INDEXNOW_ENDPOINT), 'ping apunta al endpoint de IndexNow');
  assert.ok(ping.includes(`key=${VALID_KEY}`), 'la key viaja en el ping');
  assert.ok(ping.includes('url=https%3A%2F%2Fscango.app%2Fm%2Fbistro'), 'la url viaja encodeada');
  assert.strictEqual(buildIndexNowUrl({ key: VALID_KEY, url: 'javascript:alert(1)' }), null, 'javascript: jamás');
  assert.strictEqual(buildIndexNowUrl({ key: VALID_KEY, url: 'data:text/html,x' }), null, 'data: jamás');
  assert.strictEqual(buildIndexNowUrl({ key: VALID_KEY, url: 'no-es-url' }), null, 'URL malformada → null');
  assert.strictEqual(buildIndexNowUrl({ key: 'invalida', url: 'https://x.com' }), null, 'key inválida → null');

  // 1d. getMenuUrlsForPing: canonical + cada sucursal real.
  const restaurant = {
    slug: 'bistro',
    branches: [
      { id: 'b-centro', slug: 'centro' },
      { id: 'b-ldn', slug: 'laguna del diario' },
      { nombre: 'sin identidad' } // sin slug ni id: se descarta
    ]
  };
  const urls = getMenuUrlsForPing('https://scango.app/', restaurant);
  assert.deepStrictEqual(urls, [
    'https://scango.app/m/bistro',
    'https://scango.app/m/bistro?branch=centro',
    'https://scango.app/m/bistro?branch=laguna%20del%20diario'
  ], 'canonical + sucursales reales (slug encodeado, sin-slug fuera)');
  assert.deepStrictEqual(getMenuUrlsForPing('', restaurant), [], 'sin appUrl → []');
  assert.deepStrictEqual(getMenuUrlsForPing('https://x.com', {}), [], 'sin slug → []');

  // ── Fase 2: dispatch POST bulk con fetch inyectado (cero red) ──────────────
  let capturedRequest;
  const fakeFetch = async (url, opts) => {
    capturedRequest = { url, opts, body: JSON.parse(opts.body) };
    return { status: 202, ok: true };
  };
  const rest = {
    slug: 'bistro',
    branches: [{ slug: 'centro' }]
  };
  const result = await dispatchIndexNowPing({
    key: VALID_KEY,
    urls: getMenuUrlsForPing('https://scango.app', rest),
    fetchImpl: fakeFetch
  });
  assert.strictEqual(result.status, 202, 'estado 202 (IndexNow acepta)');
  assert.strictEqual(result.submitted, 2, 'se enviaron 2 URLs');
  assert.strictEqual(capturedRequest.url, INDEXNOW_ENDPOINT, 'POST al endpoint de IndexNow');
  assert.strictEqual(capturedRequest.opts.method, 'POST');
  assert.strictEqual(capturedRequest.body.host, 'scango.app', 'un único host en el lote');
  assert.strictEqual(capturedRequest.body.key, VALID_KEY, 'la key en el payload');
  assert.strictEqual(
    capturedRequest.body.keyLocation,
    `https://scango.app/${VALID_KEY}.txt`,
    'keyLocation apunta al archivo de verificación'
  );
  assert.deepStrictEqual(capturedRequest.body.urlList, [
    'https://scango.app/m/bistro',
    'https://scango.app/m/bistro?branch=centro'
  ], 'urlList = canonical + sucursal');

  // Host mixto: solo las URLs del primer host entran al lote.
  const mixed = await dispatchIndexNowPing({
    key: VALID_KEY,
    urls: ['https://scango.app/m/a', 'https://otro.host/m/b', 'https://scango.app/m/c'],
    fetchImpl: fakeFetch
  });
  assert.deepStrictEqual(mixed.body.urlList, ['https://scango.app/m/a', 'https://scango.app/m/c'], 'hosts ajenos descartados');
  assert.strictEqual(mixed.submitted, 2);

  // Key inválida / sin URLs válidas → skip, jamás fetch.
  const badKey = await dispatchIndexNowPing({ key: 'no-valida', urls: ['https://x.com'], fetchImpl: fakeFetch });
  assert.strictEqual(badKey.skipped, 'invalid_key', 'key inválida → skipped sin tocar red');
  const noUrls = await dispatchIndexNowPing({ key: VALID_KEY, urls: [], fetchImpl: fakeFetch });
  assert.strictEqual(noUrls.skipped, 'no_valid_urls', 'sin URLs → skipped');
  const relUrls = await dispatchIndexNowPing({
    key: VALID_KEY,
    urls: ['/m/relative-only'],
    fetchImpl: fakeFetch
  });
  assert.strictEqual(relUrls.skipped, 'no_valid_urls', 'URL relativa (sin APP_URL) → skipped honesto');

  // Error del endpoint → ok:false, NUNCA lanza.
  const boomFetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const errored = await dispatchIndexNowPing({
    key: VALID_KEY,
    urls: ['https://scango.app/m/a'],
    fetchImpl: boomFetch
  });
  assert.strictEqual(errored.ok, false, 'fallo de red → ok:false');
  assert.ok(errored.error && errored.error.includes('ECONNREFUSED'), 'el error viaja en el resumen');

  // ── Fase 3: ruta runtime GET /{key}.txt ────────────────────────────────────
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();

    // Con key configurada: el archivo de verificación responde 200 text/plain.
    await withIndexNowEnv(VALID_KEY, undefined, async () => {
      const good = await fetch(`http://localhost:${port}/${VALID_KEY}.txt`);
      assert.strictEqual(good.status, 200, 'verificación con la key correcta → 200');
      const text = await good.text();
      assert.strictEqual(text, VALID_KEY, 'el body es la key exacta');
      assert.strictEqual(good.headers.get('content-type').startsWith('text/plain'), true, 'content-type text/plain');

      // Key distinta / malformada → 404 (fail-closed, sin archivo adivinable).
      const wrong = await fetch(`http://localhost:${port}/deadbeefdeadbeef.txt`);
      assert.strictEqual(wrong.status, 404, 'key distinta → 404');
      const shortTxt = await fetch(`http://localhost:${port}/short.txt`);
      assert.strictEqual(shortTxt.status, 404, 'segmento corto (< 8 hex) → ni pasa por la ruta del API');
    });

    // Sin key configurada en absoluto → no existe archivo.
    await withIndexNowEnv(undefined, undefined, async () => {
      const none = await fetch(`http://localhost:${port}/${'a1b2c3d4e5f67890'.repeat(1)}.txt`);
      assert.strictEqual(none.status, 404, 'sin INDEXNOW_KEY no hay archivo (fail-closed)');
    });

    // Regresión: el .txt estático de GEO sigue sirviéndose (express.static corre
    // ANTES de la ruta /:key.txt; y "llms" no matchea el patrón hex).
    const llms = await fetch(`http://localhost:${port}/llms.txt`);
    assert.strictEqual(llms.status, 200, '/llms.txt estático no se pisa');
    const llmsFull = await fetch(`http://localhost:${port}/llms-full.txt`);
    assert.strictEqual(llmsFull.status, 200, '/llms-full.txt estático no se pisa');
  } finally {
    server.close();
  }

  // ── Fase 4: hook del Studio (análisis de fuente, guard de regresión) ───────
  const studioSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'routes', 'studio.js'), 'utf8');
  assert.ok(
    studioSource.includes('indexNow.isIndexNowEnabled()') &&
      studioSource.includes('indexNow.dispatchIndexNowPing'),
    'el save del Studio dispara el ping SOLO si indexNow está habilitado'
  );

  console.log('✓ IndexNow validado: key fail-closed, payload bulk, verificación {key}.txt y .txt estático intacto');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});