/**
 * tests/test-semgrep.js
 * Guard de análisis de código estático con Semgrep (rulesets comunitarias, gratis).
 *
 * Verifica que `api/`, `src/` y `public/js/` no tengan hallazgos de las reglas:
 *   p/security-audit + p/owasp-top-ten + p/javascript
 *
 * Hace SKIP (exit 0) si `semgrep` no está instalado en la máquina
 * (instalar: `python -m pip install --upgrade semgrep` — soporta Windows nativo desde 2025).
 * NO está en `npm test` (chain) — correrlo a mano con `npm run test:semgrep`
 * (mismo patrón que test-e2e/test-db-write/test-escape-html).
 */
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIGS = ['p/security-audit', 'p/owasp-top-ten', 'p/javascript'];
const TARGETS = ['api', 'src', 'public/js'];

function hasSemgrep() {
  try {
    execFileSync('semgrep', ['--version'], { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

async function run() {
  console.log(`🔍 Análisis estático Semgrep (${CONFIGS.join(' + ')}) en ${TARGETS.join(', ')}...`);
  if (!hasSemgrep()) {
    console.log('⏭️  SKIP: semgrep no está instalado (instalar: python -m pip install --upgrade semgrep).');
    return;
  }

  const args = ['--metrics=off'];
  for (const c of CONFIGS) args.push('--config', c);
  args.push('--timeout=60', '--json', ...TARGETS);

  let out = '';
  try {
    out = execFileSync('semgrep', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 300000 });
  } catch (e) {
    // semgrep sale con exit != 0 cuando hay hallazgos; parseamos su stdout igual.
    out = (e.stdout || '').toString();
  }

  const report = JSON.parse(out);
  const hits = report.results || [];
  assert.strictEqual(hits.length, 0,
    `Semgrep encontró ${hits.length} hallazgo(s):\n` + hits.map(h =>
      `  ${h.path}:${h.start?.line} [${h.extra?.severity}] ${h.check_id} — ` +
      (h.extra?.message || '').split('\n')[0].slice(0, 140)).join('\n'));

  console.log(`✓ Semgrep: 0 hallazgos en ${TARGETS.join(', ')}`);
  console.log('🎉 ¡ANÁLISIS ESTÁTICO CON SEMGREP LIMPIO AL 100%!');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Falló:', err.message);
    process.exit(1);
  });