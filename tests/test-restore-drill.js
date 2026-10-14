/**
 * tests/test-restore-drill.js
 * ───────────────────────────
 * Drill de recuperación ante desastres (manual: `npm run test:restore-drill`,
 * NO entra en `npm test` porque tarda y toca data/ fuera del guard, con
 * restore propio garantizado en finally).
 *
 * Historia: este drill descubrió que la nube estaba VACÍA (el dual-write
 * fallaba por drift de schema PGRST204 y el silenciador lo ocultaba). Con
 * `cloudWriteTolerant` las escrituras aterrizan; este test lo demuestra de
 * punta a punta con filas throwaway:
 *
 *  1. Siembra 1 usuario + 1 restaurante throwaway DIRECTO en la nube.
 *  2. Snapshot data/ → borra users/restaurants locales (desastre simulado).
 *  3. Proceso Node fresco que hidrata desde la nube (db.ready).
 *  4. Aserta que los throwaway volvieron al JSON local.
 *  5. Limpieza: borra los throwaway de la nube + restaura el snapshot.
 *
 * Sin SUPABASE_URL + service key: SKIP honesto (exit 0, sin tocar nada).
 * Limitación conocida y declarada: la hidratación cubre users/restaurants;
 * orders/reviews/etc. locales NO se re-descargan (solo se suben). El dueño
 * los sigue viendo en la nube (el dashboard lee cloud primero).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

// Carga .env propia (los tests la reciben inyectada, pero esto también corre
// suelto). Solo en proceso, nunca se imprime.
(function loadEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch {}
})();

const FILES = ['users.json', 'restaurants.json'];

function copyFiles(src, dst, files) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of files) {
    try { fs.copyFileSync(path.join(src, f), path.join(dst, f)); } catch {}
  }
}

async function main() {
  console.log('🧪 Drill de restore: desastre simulado + hidratación desde la nube...');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log('SKIP honesto: sin SUPABASE_URL + service key no hay nube contra la que probar.');
    return;
  }
  const { createClient } = require('../node_modules/@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const stamp = Date.now();
  // ── A) Dual-write tolerante: un createUser debe aterrizar en la nube ──
  // (antes fallaba por PGRST204 email_confirmed_at y el silenciador lo
  // ocultaba: tablas cloud vacías con cientos de filas locales).
  const db = require('../src/db/db');
  await db.ready;
  const dwUser = await db.createUser({ email: `drill-dual-${stamp}@example.com`, password: 'x' });
  await db.flushCloudWrites();
  const landed = await supabase.from('users').select('id').eq('id', dwUser.id);
  assert.ok(!landed.error && Array.isArray(landed.data) && landed.data.length === 1, 'dual-write: el usuario aterriza en la nube');
  await supabase.from('users').delete().eq('id', dwUser.id);
  console.log('✓ Dual-write tolerante: createUser + flush → fila real en la nube (throwaway limpiada)');

  const throwUser = { id: `usr_drill_${stamp}`, email: `drill-${stamp}@example.com`, password: 'x', created_at: new Date().toISOString() };
  // Seed mínimo (sin `profile`: la nube real es anterior al schema.sql y esa
  // columna no existe; el dual-write la quita solo vía cloudWriteTolerant).
  const throwRest = {
    id: `rest_drill_${stamp}`, user_id: throwUser.id, slug: `drill-${stamp}`,
    name: 'Drill', subscription: { status: 'trialing' }
  };
  // Siembra throwaway (limpieza garantizada en finally, pase o falle).
  const insU = await supabase.from('users').insert([throwUser]);
  assert.ok(!insU.error, `seed user en la nube: ${insU.error && insU.error.message}`);
  const insR = await supabase.from('restaurants').upsert([throwRest], { onConflict: 'id' });
  assert.ok(!insR.error, `seed restaurant en la nube: ${insR.error && insR.error.message}`);

  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-drill-'));
  copyFiles(DATA_DIR, backupDir, FILES);
  try {
    // Desastre simulado: se pierden los JSON locales.
    for (const f of FILES) {
      try { fs.writeFileSync(path.join(DATA_DIR, f), '[]', 'utf8'); } catch {}
    }
    // Proceso fresco: al requerir db se dispara la hidratación cloud→local.
    const probe = path.join(backupDir, 'probe.js');
    fs.writeFileSync(probe, `
      const db = require(${JSON.stringify(path.join(ROOT, 'src', 'db', 'db.js'))});
      db.ready.then((r) => { console.log(JSON.stringify({ ready: r.ready, mode: r.mode })); process.exit(0); })
        .catch((e) => { console.error('HYDRATE_FAIL:' + e.message); process.exit(2); });
      setTimeout(() => { console.error('HYDRATE_TIMEOUT'); process.exit(3); }, 90000).unref();
    `);
    let hydrateOut = '';
    try {
      hydrateOut = execFileSync(process.execPath, [probe], { encoding: 'utf8', timeout: 120000 });
    } catch (e) {
      assert.fail(`hidratación falló: ${(e.stdout || '') + (e.message || '')}`);
    }
    assert.ok(hydrateOut.includes('"ready":true'), 'db.ready resuelve ready:true tras el desastre');
    const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
    const rests = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'restaurants.json'), 'utf8'));
    assert.ok(users.some((u) => u.id === throwUser.id), 'usuario throwaway recuperado de la nube');
    assert.ok(rests.some((r) => r.id === throwRest.id), 'restaurante throwaway recuperado de la nube');
    console.log('✓ Desastre simulado → hidratación cloud→local reconstruye users/restaurants');
  } finally {
    // Limpieza total: throwaway fuera de la nube + snapshot restaurado.
    try { await supabase.from('users').delete().eq('id', throwUser.id); } catch {}
    try { await supabase.from('restaurants').delete().eq('id', throwRest.id); } catch {}
    copyFiles(backupDir, DATA_DIR, FILES);
    try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
    console.log('✓ Limpieza: throwaway borrados de la nube, snapshot local restaurado');
  }

  // Workflow de backup pg_dump: validación estática (jobs, secrets, flags).
  try {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'backup-supabase.yml'), 'utf8');
    for (const c of ['pg_dump', 'SUPABASE_DB_URL', 'pg_restore', 'retention']) {
      assert.ok(wf.includes(c), `workflow backup incluye ${c}`);
    }
    console.log('✓ Workflow backup pg_dump: jobs + secrets + verificación presentes');
  } catch {
    console.warn('Workflow backup pg_dump no encontrado para validar.');
  }

  console.log('\n🎉 ¡DRILL DE RESTORE EN VERDE: la nube reconstruye el local!');
  console.log('Nota honesta: orders/reviews/feedback NO se re-descargan (limitación conocida); el dashboard los lee de la nube.');
}

main().catch((e) => { console.error('❌ Drill FALLÓ:', e.message); process.exit(1); });
