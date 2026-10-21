/**
 * tests/test-review-nudge.js
 * ──────────────────────────
 * Nudge de reseña "el día siguiente" (R2). Cero mocks: email real vía el
 * servicio (Resend con credenciales en dev; local_mock sin ellas).
 *
 * Cubre:
 *  - Módulo puro reviewNudge: ventana 26..50h post `delivered`, teléfono
 *    normalizable, tope por corrida, orden, inputs basura sin lanzar.
 *  - sendReviewRequestEmail: respeta opt-outs (skipped OPT_OUT), copy NEUTRAL
 *    (jamás pide "5 estrellas": embudo 4-5★/1-3★ pro-política de Google).
 *  - Dedupe en notification_events (`review_nudge_request`): primera vez
 *    false, tras record → true, persistido en data/notification_events.json.
 *  - Cron runtime /api/cron/review-nudge: 401 sin secreto (con CRON_SECRET
 *    configurado), 200 con x-cron-secret y reporte { checked, sent, skipped }.
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../api/index');
const { collectReviewNudgeCandidates, normalizePhoneLoose } = require('../api/utils/reviewNudge');
const emailService = require('../api/services/email');
const notificationsService = require('../api/services/notifications');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const eventsFile = path.join(process.cwd(), 'data', 'notification_events.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

async function runTests() {
  console.log('🧪 Iniciando verificación del Nudge de Reseña (day-after)...');

  // ── 1) Módulo puro: ventana + filtros ────────────────────────────────────
  const mkOrder = (over = {}) => ({
    id: 'ord_x', restaurant_id: 'rA', status: 'delivered',
    status_updated_at: new Date(NOW - 30 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(NOW - 31 * 60 * 60 * 1000).toISOString(),
    customer_phone: '+598 99 123 456', customer_name: 'Ana', ...over
  });

  let sel = collectReviewNudgeCandidates([mkOrder()], { nowMs: NOW });
  assert.strictEqual(sel.count, 1, '30h post-delivered → candidata');
  assert.strictEqual(sel.candidates[0].orderId, 'ord_x');
  assert.strictEqual(sel.candidates[0].phone, '59899123456', 'teléfono normalizado');
  assert.strictEqual(sel.candidates[0].restaurantId, 'rA');
  assert.strictEqual(sel.checked, 1);

  // Bordes: 10h demasiado pronto, 80h demasiado tarde, 26h exactas DENTRO.
  sel = collectReviewNudgeCandidates([
    mkOrder({ id: 'fresh', status_updated_at: new Date(NOW - 10 * 60 * 60 * 1000).toISOString() }),
    mkOrder({ id: 'stale', status_updated_at: new Date(NOW - 80 * 60 * 60 * 1000).toISOString() }),
    mkOrder({ id: 'edge', status_updated_at: new Date(NOW - 26 * 60 * 60 * 1000).toISOString() })
  ], { nowMs: NOW });
  assert.deepStrictEqual(sel.candidates.map(o => o.orderId), ['edge'], 'solo 26h>=edad<=50h entra');

  // Sin estado delivered / teléfono inexistente o irreparable / filas basura.
  sel = collectReviewNudgeCandidates([
    mkOrder({ id: 'pending', status: 'on_the_way' }),
    mkOrder({ id: 'nophone', customer_phone: '' }),
    mkOrder({ id: 'badphone', customer_phone: 'jabalí' }),
    mkOrder({ id: 'norest', restaurant_id: '' }),
    null,
    'junk'
  ], { nowMs: NOW });
  assert.strictEqual(sel.count, 0, 'estado/telefono/restaurante faltantes → afuera');
  sel = collectReviewNudgeCandidates(null);
  assert.strictEqual(sel.count, 0, 'input nulo → reporte vacío');
  sel = collectReviewNudgeCandidates([
    mkOrder({ id: 'a' }), mkOrder({ id: 'b', status_updated_at: new Date(NOW - 40 * 60 * 60 * 1000).toISOString() })
  ], { nowMs: NOW, maxPerRun: 1 });
  assert.strictEqual(sel.count, 1, 'tope maxPerRun respetado');

  assert.strictEqual(normalizePhoneLoose('00598 34111222'), '59834111222');
  assert.strictEqual(normalizePhoneLoose('123'), null);
  console.log('✓ Módulo puro reviewNudge: ventana 26..50h + filtros + tope');

  // ── 2) Email de reseña neutral + opt-out ────────────────────────────────
  const emailSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'services', 'email.js'), 'utf8');
  assert.ok(emailSrc.includes("async sendReviewRequestEmail"), 'sendReviewRequestEmail vive en email.js');
  assert.ok(emailSrc.includes('Contar mi experiencia'), 'CTA del email apunta al embudo');
  const methodSrc = emailSrc.slice(emailSrc.indexOf('async sendReviewRequestEmail'), emailSrc.indexOf('async sendPromotionalEmail'));
  assert.ok(methodSrc.length > 200, 'sendReviewRequestEmail encontrada en email.js');
  assert.ok(!/estrellas|rating five|five stars/i.test(methodSrc), 'NUNCA pide estrellas (embudo neutral pro-política)');

  const optEmail = 'optout-review@mail.com';
  emailService.markOptOut(optEmail);
  const skipped = await emailService.sendReviewRequestEmail({ to: optEmail, restaurantName: 'Local', reviewUrl: 'https://app/m/x?review=1' });
  assert.strictEqual(skipped.skipped, true, 'opt-out NO recibe el day-after');
  assert.strictEqual(skipped.reason, 'OPT_OUT');
  try {
    await emailService.sendReviewRequestEmail({ to: 'alguien@mail.com' });
    assert.fail('sin reviewUrl debe lanzar');
  } catch (e) {
    assert.strictEqual(e.statusCode || e.status, 400, 'reviewUrl faltante → 400 MISSING_EMAIL_FIELDS');
  }
  console.log('✓ sendReviewRequestEmail: opt-out respetado + link obligatorio');

  // ── 3) Dedupe global en notification_events ─────────────────────────────
  const markerEvents = readJson(eventsFile) || [];
  const probeOrderId = `rn_probe_${Date.now()}`;
  assert.strictEqual(await notificationsService.hasOrderReviewNudge(probeOrderId), false, 'pedido sin nudge no lo tiene');
  const recorded = await notificationsService.recordOrderReviewNudge({ restaurantId: 'rA_probe', orderId: probeOrderId });
  assert.ok(recorded && recorded.id, 'marcador creado con id');
  assert.strictEqual(await notificationsService.hasOrderReviewNudge(probeOrderId), true, 'tras record → true');
  const after = readJson(eventsFile) || [];
  const probeRows = after.filter(e => e.type === 'review_nudge_request' && e.data && e.data.orderId === probeOrderId);
  assert.strictEqual(probeRows.length, 1, 'UN solo marcador (record idempotente)');
  assert.strictEqual(probeRows[0].isRead, true, 'el marcador NO ensucia el inbox del dueño');
  // Limpieza del probe (la suite aísla data/, pero una corrida standalone no debe dejar rastro)
  fs.writeFileSync(eventsFile, JSON.stringify(after.filter(e => e.id !== recorded.id), null, 2), 'utf8');
  console.log('✓ Dedupe review_nudge_request en notification_events (global + idempotente)');

  // ── 4) Cron runtime: auth fail-closed + reporte honesto ──────────────────
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const anon = await fetch(`${base}/api/cron/review-nudge`);
    if (process.env.CRON_SECRET) {
      assert.strictEqual(anon.status, 401, 'cron sin secreto → 401 (misma cadena que el resto)');
      const bad = await fetch(`${base}/api/cron/review-nudge`, { headers: { 'x-cron-secret': 'no-es-el-secreto' } });
      assert.strictEqual(bad.status, 401, 'secreto incorrecto → 401');
      const ok = await fetch(`${base}/api/cron/review-nudge`, { headers: { 'x-cron-secret': process.env.CRON_SECRET } });
      assert.strictEqual(ok.status, 200, 'cron con secreto → 200');
      const body = await ok.json();
      assert.strictEqual(body.success, true);
      assert.ok(Number.isFinite(body.data.checked) && Number.isFinite(body.data.sent) && Number.isFinite(body.data.skipped), 'reporte { checked, sent, skipped } numérico');
      assert.ok(typeof body.data.reasons === 'object', 'los skip son explicados (ALREADY_NUDGED / NO_EMAIL / ...)');
      console.log('✓ Cron /api/cron/review-nudge: 401 anónimo/no-sec + 200 con reporte honesto');
    } else {
      // Dev sin CRON_SECRET: cronAuth falla ABIERTO solo en no-producción.
      assert.strictEqual([200, 401, 503].includes(anon.status), true, 'estado ' + anon.status + ' esperable sin secreto en dev');
      console.log('✓ Cron sin CRON_SECRET en dev → ' + anon.status + ' (sin secret falla cerrado en prod por cronAuth)');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n✓ Todos los asserts del Nudge de Reseña pasaron.');
}

if (require.main === module) {
  runTests().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { runTests };
