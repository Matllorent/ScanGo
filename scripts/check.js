#!/usr/bin/env node
/**
 * scripts/check.js — `npm run check`
 * ─────────────────────────────────
 * Cadena de verificación rápida y estructural del Nivel A, construida sobre la
 * infra de tests existente (cero duplicación de lógica: cada frente corre su
 * propio test como subproceso).
 *
 * HARD (fallan el check si salen mal):
 *   test-openapi-contract.js   contrato OpenAPI 3.1 vs handlers reales
 *   test-csp.js                CSP real + headers duros + cero on*= en public/
 *   test-architecture-guards.js guards estructurales de capas (Bloque 4)
 *   test-money-properties.js   propiedades del dinero, PRNG seed fijo (Bloque 2)
 *   test-differential.js       differential escapeHtml/máquina/telemetría (Bloque 3)
 *   test-business-hours.js     tabla de decisión ejecutable de horarios (Bloque 1)
 *
 * SOFT (no bloquean; avisan en el resumen):
 *   test-semgrep.js            estático Semgrep (hace SKIP exit 0 si no está instalado)
 *   db:parity                  scripts/verify-dual-write-parity.js (read-only;
 *                              exit 2 sin credenciales → SKIP informado; divergencias
 *                              se reportan, no bloquean el drill mensual)
 *   mutation (stryker)         SOLO si el binario local existe (probe de
 *                              node_modules/.bin — sin npx, sin red): `npm run
 *                              test:mutation` queda como camino manual.
 *
 * data/*.json queda EXACTAMENTE como estaba al arrancar (snapshot + restore,
 * mismo patrón que scripts/test-data-guard.js) pase o falle.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dataDir = path.join(ROOT, 'data');
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-check-data-'));
const node = process.execPath;

// ── snapshot/restore de data/ (misma política que npm test) ─────────────────
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

function restore(originalFiles) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const now = new Set(
    fs.readdirSync(dataDir).filter((f) => fs.statSync(path.join(dataDir, f)).isFile())
  );
  for (const f of now) {
    if (!originalFiles.includes(f)) {
      try {
        fs.unlinkSync(path.join(dataDir, f));
      } catch (e) {
        console.warn(`[check] No se pudo borrar ${f}: ${e.message}`);
      }
    }
  }
  for (const f of originalFiles) {
    try {
      fs.copyFileSync(path.join(dataDir, f), path.join(backupDir, f));
      fs.copyFileSync(path.join(backupDir, f), path.join(dataDir, f));
    } catch (e) {
      console.warn(`[check] No se pudo restaurar ${f}: ${e.message}`);
    }
  }
}

function runStep(step) {
  const t0 = Date.now();
  const res = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: step.shellNeeded === true
  });
  const ms = Date.now() - t0;
  const code = res.status === null ? 1 : res.status;
  return { ...step, code, ms };
}

const originalFiles = snapshot();
console.log(`[check] Snapshot de data/ (${originalFiles.length} archivos) → ${backupDir}\n`);

const steps = [];
const results = [];

// ── HARD ────────────────────────────────────────────────────────────────────
const hard = [
  { key: 'contract', label: 'contrato OpenAPI', args: ['tests/test-openapi-contract.js'] },
  { key: 'csp', label: 'CSP + headers duros', args: ['tests/test-csp.js'] },
  { key: 'architecture', label: 'guards de arquitectura', args: ['tests/test-architecture-guards.js'] },
  { key: 'money', label: 'propiedades del dinero', args: ['tests/test-money-properties.js'] },
  { key: 'differential', label: 'differential testing', args: ['tests/test-differential.js'] },
  { key: 'hours', label: 'tabla de horarios (Bloque 1)', args: ['tests/test-business-hours.js'] }
];
for (const s of hard) {
  steps.push({ ...s, cmd: node, soft: false });
}

// ── SOFT ────────────────────────────────────────────────────────────────────
steps.push({ key: 'semgrep', label: 'semgrep (SKIP si no instalado)', cmd: node, args: ['tests/test-semgrep.js'], soft: true });

steps.push({
  key: 'parity',
  label: 'paridad dual-write JSON↔cloud (SKIP sin creds)',
  cmd: node,
  args: ['scripts/verify-dual-write-parity.js'],
  soft: true,
  softSkips: [2] // sin SUPABASE_URL/service key → modo local-only, nada que comparar
});

// Mutation SÓLO con binario local (probe; sin npx/red). Si no está, avisa cómo.
// Prefiere el bin .js del paquete (corre con node.exe, sin shell → immune a
// rutas con espacios); el shim .cmd/.bin solo como fallback (shell:true).
const strykerCoreBin = path.join(ROOT, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js');
const strykerCmd = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'stryker.cmd' : 'stryker');
if (fs.existsSync(strykerCoreBin)) {
  steps.push({
    key: 'mutation',
    label: 'mutation testing (stryker local)',
    cmd: node,
    args: [strykerCoreBin, 'run'],
    soft: true
  });
} else if (fs.existsSync(strykerCmd)) {
  steps.push({
    key: 'mutation',
    label: 'mutation testing (stryker local, shim)',
    cmd: process.platform === 'win32' ? 'cmd' : strykerCmd,
    args: process.platform === 'win32' ? ['/c', strykerCmd, 'run'] : ['run'],
    soft: true,
    shellNeeded: process.platform !== 'win32'
  });
} else {
  console.log('ℹ️  stryker no está instalado localmente → mutation SKIP (instalá con `npm i -D @stryker-mutator/core` para activarlo; es un check soft).\n');
}

for (const step of steps) {
  const r = runStep(step);
  const verdict =
    r.code === 0 ? '✅' :
    step.softSkips && step.softSkips.includes(r.code) ? '⏭️  SKIP' :
    step.soft ? '⚠️  (soft)' : '❌';
  console.log(`\n── [check] ${r.label}: ${verdict} (${r.code}, ${r.ms}ms) ──`);
  results.push(r);
}

restore(originalFiles);
console.log(`\n[check] Data restaurada (${originalFiles.length} archivos): data/ quedó como estaba.`);

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log('\n════════ RESUMEN npm run check ════════');
let failedHard = 0;
for (const r of results) {
  const skipped = r.softSkips && r.softSkips.includes(r.code);
  const ok = r.code === 0 || skipped;
  const mark = skipped ? '⏭️' : ok ? '✅' : r.soft ? '⚠️' : '❌';
  console.log(`  ${mark}  ${r.label.padEnd(42)} (${r.code}, ${r.ms}ms)${r.soft ? ' [soft]' : ''}`);
  if (!r.soft && !ok) failedHard++;
}

if (failedHard > 0) {
  console.log(`\n${failedHard} check(s) HARD fallaron → correr el test individual (npm run test:*).`);
  process.exitCode = 1;
} else {
  console.log('\nTodos los checks HARD en verde. Soft warnings (si hay) no bloquean.');
  process.exitCode = 0;
}