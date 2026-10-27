#!/usr/bin/env node
/**
 * scripts/test-data-guard.js
 * ─────────────────────────
 * Guard de aislamiento de datos para `npm test`.
 *
 * Los tests mutan data/*.json (política del repo: cero mocks, flujos reales
 * con el store local). Este guard toma una foto de TODO data/ antes de correr
 * la suite y la restaura SIEMPRE al final (pase o falle), para que:
 *   1. Las mutaciones de QA jamás lleguen al commit.
 *   2. La suite sea repetible: cada corrida empieza desde el mismo estado.
 *   3. No haya que revertir a mano antes de commitear.
 * Además, tras el restore PURGA los residuos de prueba preexistentes
 * (`purgeLocalFixtures`, mismas reglas que la nube): las corridas
 * standalone (`node tests/test-x.js`) dejan basura que ni el restore ni
 * las corridas en CI deshacen. Protegidos por definición: `demo`
 * (fixture del preview del Studio), dueños con email real y settings.
 *
 * Uso: `npm test` → este guard → spawn de `npm run test:core` (la cadena real).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-data-backup-'));
const { snapshotCloudSlugs, cleanupCloudTests, isTestSlug, isTestEmail, isTestWebhookEventId } = require('./test-cloud-cleanup');

/** Copia todos los archivos actuales de data/ al backup. */
function snapshot() {
  if (!fs.existsSync(dataDir)) return [];
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => fs.statSync(path.join(dataDir, f)).isFile());
  for (const f of files) {
    fs.copyFileSync(path.join(dataDir, f), path.join(backupDir, f));
  }
  return files;
}

/** Borra archivos nuevos y restaura los originales desde el backup. */
function restore(originalFiles) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const now = new Set(fs.readdirSync(dataDir).filter((f) => fs.statSync(path.join(dataDir, f)).isFile()));
  // Archivos que aparecieron durante la suite (datos de QA) → se eliminan
  for (const f of now) {
    if (!originalFiles.includes(f)) {
      try {
        fs.unlinkSync(path.join(dataDir, f));
      } catch (e) {
        console.warn(`[data-guard] No se pudo borrar ${f}:`, e.message);
      }
    }
  }
  // Archivos originales → se restauran tal cual estaban
  for (const f of originalFiles) {
    try {
      fs.copyFileSync(path.join(backupDir, f), path.join(dataDir, f));
    } catch (e) {
      console.warn(`[data-guard] No se pudo restaurar ${f}:`, e.message);
    }
  }
}

/** Lee data/<file> como JSON; `fallback` si no existe o no parsea. */
function readData(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

/** Escribe data/<file> (2 espacios, igual que db.writeJson) solo si cambió. */
function writeDataIfChanged(file, value) {
  const p = path.join(dataDir, file);
  let before = null;
  try {
    before = fs.readFileSync(p, 'utf8');
  } catch (e) {
    /* no existía: no lo creamos */
  }
  if (before === null) return false;
  const next = JSON.stringify(value, null, 2);
  if (before === next) return false;
  fs.writeFileSync(p, next, 'utf8');
  return true;
}

/**
 * Purga local de residuos de tests (espejo de las reglas de la nube en
 * scripts/test-cloud-cleanup.js). Corre DESPUÉS del restore: además de
 * deshacer la corrida actual, saca la basura que dejaron corridas
 * standalone, que no pasan por este guard y que se acumulaba sin límite
 * (219 webhooks, 37 perfiles y 20 restaurantes de prueba al oct-2026).
 *
 * Nunca toca: settings.json, revoked_tokens.json (solo `jti`, sin enlace
 * verificable) ni nada que pertenezca a un dueño con email real.
 */
function purgeLocalFixtures() {
  const users = readData('users.json', null);
  const restaurants = readData('restaurants.json', null);
  if (!Array.isArray(users) || !Array.isArray(restaurants)) return;

  const isTestUser = (u) => u && isTestEmail(u.email);
  const keptUsers = users.filter((u) => !isTestUser(u));
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  // Dueño real ⇒ intacto (incluso con slug de QA); solo los huérfanos
  // (sin email resoluble) caen por patrón de slug — igual que en la nube.
  const keptRestaurants = restaurants.filter((r) => {
    const email = emailById.get(r.userId || r.user_id);
    if (email) return !isTestEmail(email);
    return !isTestSlug(r.slug);
  });
  const keptRestIds = new Set(keptRestaurants.map((r) => r.id));

  // Equipo operativo (Fase 1): personas de locales conservados y sus
  // sesiones de turno. Una sesión sin persona viva es residuo de una corrida
  // de QA (el borrado real de la persona ya las revoca).
  const staff = readData('staff.json', []);
  const keptStaff = Array.isArray(staff)
    ? staff.filter((s) => s && keptRestIds.has(s.restaurantId || s.restaurant_id))
    : [];
  const keptStaffIds = new Set(keptStaff.map((s) => s.id).filter(Boolean));
  const staffSessions = readData('staff_sessions.json', []);
  const keptStaffSessions = Array.isArray(staffSessions)
    ? staffSessions.filter((s) => s
      && keptRestIds.has(s.restaurantId || s.restaurant_id)
      && keptStaffIds.has(s.staffId || s.staff_id))
    : [];

  // Fidelización: cuentas solo sobreviven en restaurantes conservados; los
  // perfiles sin cuenta viva son residuo (un perfil real legítimo siempre
  // tiene su cuenta en un local conservado).
  const accounts = readData('loyalty_accounts.json', []);
  const keptAccounts = Array.isArray(accounts)
    ? accounts.filter((a) => a && keptRestIds.has(a.restaurantId))
    : [];
  const keptProfileIds = new Set(keptAccounts.map((a) => a.customerId).filter(Boolean));
  const profiles = readData('customer_profiles.json', []);
  const keptProfiles = Array.isArray(profiles)
    ? profiles.filter((p) => p && keptProfileIds.has(p.id))
    : [];
  const ledger = readData('loyalty_ledger.json', []);
  const keptLedger = Array.isArray(ledger)
    ? ledger.filter((e) => e
      && keptProfileIds.has(e.customerId)
      && (e.restaurantId == null || keptRestIds.has(e.restaurantId)))
    : [];
  const redemptions = readData('loyalty_redemptions.json', []);
  const keptRedemptions = Array.isArray(redemptions)
    ? redemptions.filter((r) => r
      && keptRestIds.has(r.restaurantId)
      && (r.customerId == null || keptProfileIds.has(r.customerId)))
    : [];

  const keptUserIds = new Set(keptUsers.map((u) => u.id));

  // Semántica de conservación: una fila solo sobrevive si su entidad
  // enlazada se conserva. Así también caen los HUÉRFANOS de purgas
  // anteriores (rid/userId que ya no existe en ningún archivo), no solo
  // lo purgado en esta corrida.
  const notifs = readData('notification_events.json', []);
  const keptNotifs = Array.isArray(notifs)
    ? notifs.filter((n) => n && (n.restaurantId == null || keptRestIds.has(n.restaurantId)))
    : [];
  const devTokens = readData('device_tokens.json', []);
  const keptDevTokens = Array.isArray(devTokens)
    ? devTokens.filter((t) => t && keptUserIds.has(t.userId))
    : [];
  const resetTokens = readData('reset_tokens.json', []);
  const keptResetTokens = Array.isArray(resetTokens)
    ? resetTokens.filter((t) => t && keptUserIds.has(t.userId))
    : [];
  const hooks = readData('webhooks.json', []);
  const keptHooks = Array.isArray(hooks)
    ? hooks.filter((h) => h && !isTestWebhookEventId(h.eventId || h.event_id))
    : [];

  const writes = [];
  const add = (file, before, after, label) => {
    if (Array.isArray(before) && before.length !== after.length) {
      writes.push([file, after, before.length - after.length, label]);
    }
  };
  add('users.json', users, keptUsers, 'usuarios');
  add('restaurants.json', restaurants, keptRestaurants, 'restaurantes');
  add('staff.json', staff, keptStaff, 'equipo');
  add('staff_sessions.json', staffSessions, keptStaffSessions, 'turnos del equipo');
  add('loyalty_accounts.json', accounts, keptAccounts, 'cuentas de fidelización');
  add('customer_profiles.json', profiles, keptProfiles, 'perfiles de cliente');
  add('loyalty_ledger.json', ledger, keptLedger, 'movimientos de ledger');
  add('loyalty_redemptions.json', redemptions, keptRedemptions, 'canjes');
  add('notification_events.json', notifs, keptNotifs, 'notificaciones');
  add('device_tokens.json', devTokens, keptDevTokens, 'device tokens');
  add('reset_tokens.json', resetTokens, keptResetTokens, 'reset tokens');
  add('webhooks.json', hooks, keptHooks, 'webhooks');

  // Pedidos/reseñas/feedback: mismo criterio (solo sobreviven los de
  // restaurantes conservados; hoy vacíos, pero las corridas standalone
  // también los acumulan).
  for (const f of ['orders.json', 'reviews.json', 'feedback.json']) {
    const rows = readData(f, null);
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const kept = rows.filter((r) => r
      && ((r.restaurantId || r.restaurant_id) == null
        || keptRestIds.has(r.restaurantId || r.restaurant_id)));
    add(f, rows, kept, f);
  }

  if (writes.length === 0) {
    console.log('[data-guard] Purga local: sin residuos de prueba.');
    return;
  }
  const parts = [];
  for (const [file, rows, n, label] of writes) {
    if (writeDataIfChanged(file, rows)) parts.push(`${n} ${label}`);
  }
  console.log(`[data-guard] Purga local: ${parts.join(', ')}.`);
}

const originalFiles = snapshot();

async function main() {
  // Corte "creado durante esta corrida" para el barrido de auditoría
  // huérfana (5 min de margen: el `created_at` lo pone Postgres y el reloj
  // local puede correr unos segundos; las filas reales tienen entidades
  // vivas y se conservan igual).
  const runStartedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  // La suite escribe en la nube REAL si hay credenciales: se borran los
  // restaurantes de prueba sembrados (el sitemap de prod los indexaba).
  const cloudBefore = await snapshotCloudSlugs();
  if (cloudBefore) console.log(`[data-guard] Snapshot cloud (${cloudBefore.size} slugs).`);

  console.log(`[data-guard] Snapshot de data/ (${originalFiles.length} archivos) → ${backupDir}`);

  const result = spawnSync('npm', ['run', 'test:core'], { stdio: 'inherit', shell: true });

  restore(originalFiles);
  console.log(`[data-guard] Data restaurada (${originalFiles.length} archivos): la suite dejó data/ como estaba antes de correr.`);
  purgeLocalFixtures();
  await cleanupCloudTests(cloudBefore, { runStartedAt });

  process.exit(result.status === null ? 1 : result.status);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[data-guard] Falló la guarda:', e.message);
    try { restore(originalFiles); } catch (_) { /* best-effort */ }
    process.exit(1);
  });
}

module.exports = { purgeLocalFixtures };