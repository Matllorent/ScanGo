/**
 * tests/test-storage-video.js
 * ───────────────────────────
 * Subida de videos de plato por URL firmada (solo Stories).
 *
 * Cero mocks: server HTTP real + store real. Los bytes NUNCA tocan el
 * servidor: el test pide la URL firmada y valida gates + forma, sin hacer el
 * PUT (no se almacena ningún objeto).
 *
 * Cubre:
 *  - 401 anónimo (authMiddleware antes que nada).
 *  - 400 mime inválido (solo video/mp4|webm) y tamaño >50 MB / ausente (zod).
 *  - 403 VIDEO_LIMIT_EXCEEDED con 10 videos ya en la carta.
 *  - 201 con forma { uploadUrl, publicUrl, path, bucket, videosUsed, videosMax }
 *    cuando hay nube, o 503 VIDEO_UPLOAD_NOT_AVAILABLE honesto sin nube.
 *  - Constantes del servicio (bucket, topes, mimes).
 */
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const db = require('../src/db/db');
const app = require('../api/index');
const storageService = require('../api/services/storage');
const { getSupabaseClient } = require('../api/utils/supabase');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

async function runTests() {
  console.log('🧪 Subida de video por URL firmada (solo Stories)...');

  // ── 0) Constantes del servicio ───────────────────────────────────────
  assert.strictEqual(storageService.VIDEO_BUCKET, 'videos', 'bucket videos');
  assert.strictEqual(storageService.MAX_VIDEO_BYTES, 50 * 1024 * 1024, 'tope 50 MB');
  assert.strictEqual(storageService.MAX_VIDEOS_PER_RESTAURANT, 10, 'cupo 10 por carta');
  assert.deepStrictEqual(storageService.ALLOWED_VIDEO_MIME_TYPES, ['video/mp4', 'video/webm'], 'mimes mp4/webm');
  console.log('✓ Constantes: bucket videos, 50 MB, cupo 10, mp4/webm');

  const stamp = Date.now();
  const user = await db.createUser({ email: `vid-${stamp}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const rest = await db.saveRestaurant(user.id, {
    name: 'Video Local', bizName: 'Video Local',
    slug: `video-${stamp}`,
    phone: '59891111111',
    currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const postJson = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });

  try {
    // ── 1) 401 anónimo ────────────────────────────────────────────────
    const anon = await postJson('/api/storage/video-upload-url', { mimeType: 'video/mp4', sizeBytes: 1000 });
    assert.strictEqual(anon.status, 401, 'sin auth → 401 (no 404)');
    console.log('✓ 401 anónimo');

    // ── 2) 400 mime/tamaño/forma ───────────────────────────────────────
    const badMime = await postJson('/api/storage/video-upload-url', { mimeType: 'audio/mpeg', sizeBytes: 1000 }, auth);
    assert.strictEqual(badMime.status, 400, 'mime no-video → 400');
    const big = await postJson('/api/storage/video-upload-url', { mimeType: 'video/mp4', sizeBytes: 60 * 1024 * 1024 }, auth);
    assert.strictEqual(big.status, 400, '>50 MB → 400');
    const empty = await postJson('/api/storage/video-upload-url', {}, auth);
    assert.strictEqual(empty.status, 400, 'body vacío → 400 (zod)');
    console.log('✓ 400 mime/tamaño/forma');

    // ── 3) 403 cupo: 10 videos en carta ───────────────────────────────
    const fullDishes = Array.from({ length: 10 }, (_, i) => ({
      id: `vdish${i}`, name: `Plato ${i}`, price: 10, categoryId: 'cat1',
      videoUrl: `https://cdn.example.com/v${i}.mp4`
    }));
    await db.saveRestaurant(user.id, { dishes: fullDishes });
    const capped = await postJson('/api/storage/video-upload-url', { mimeType: 'video/mp4', sizeBytes: 1000 }, auth);
    assert.strictEqual(capped.status, 403, 'carta con 10 videos → 403');
    assert.strictEqual((await capped.json()).code, 'VIDEO_LIMIT_EXCEEDED', 'código VIDEO_LIMIT_EXCEEDED');
    console.log('✓ 403 cupo por carta (10 videos)');
    await db.saveRestaurant(user.id, { dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }] });

    // ── 4) 201 con nube / 503 honesto sin nube ────────────────────────
    const okRes = await postJson('/api/storage/video-upload-url', { fileName: 'plato.mp4', mimeType: 'video/mp4', sizeBytes: 1024 }, auth);
    if (getSupabaseClient()) {
      assert.strictEqual(okRes.status, 201, 'con nube → 201');
      const data = (await okRes.json()).data;
      assert.ok(data.uploadUrl && data.uploadUrl.startsWith('https://'), 'uploadUrl https');
      assert.ok(data.publicUrl && data.publicUrl.endsWith('.mp4'), 'publicUrl .mp4');
      assert.strictEqual(data.bucket, 'videos', 'bucket videos');
      assert.strictEqual(data.videosUsed, 0, 'contador de uso');
      assert.strictEqual(data.videosMax, 10, 'cupo informado');
      console.log('✓ 201 con URL firmada real (sin subir bytes)');
    } else {
      assert.strictEqual(okRes.status, 503, 'sin nube → 503 honesto');
      assert.strictEqual((await okRes.json()).code, 'VIDEO_UPLOAD_NOT_AVAILABLE', 'código honesto sin nube');
      console.log('✓ 503 honesto sin nube (link externo sigue valiendo)');
    }

    console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE VIDEO POR URL FIRMADA PASARON!');
  } finally {
    server.close();
  }
}

module.exports = { runTests };

if (require.main === module) {
  runTests()
    .then(() => { console.log('✅ test-storage-video.js OK'); process.exit(0); })
    .catch((err) => { console.error('❌ test-storage-video falló:', err.message); process.exit(1); });
}
