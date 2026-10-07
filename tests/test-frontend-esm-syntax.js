/**
 * tests/test-frontend-esm-syntax.js
 * Regresión: el codemod quick-wins.js eliminó "function escapeHtml(str){...}" de
 * public/js/studio.js dejando un "export" huérfano → SyntaxError → el Studio
 * entero quedó en "Cargando..." infinito (imports jamás se pedían). El daño quedó
 * commiteado y ningún test lo detectaba.
 *
 * Guard: TODO archivo JS bajo public/js/ debe parsear como ES Module (V8/Node).
 * Si un codemod, merge o copy-paste rompe la sintaxis, esto falla al instante.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function runFrontendEsmSyntaxTests() {
  console.log('🧪 Iniciando verificación de sintaxis ESM de archivos frontend (public/js) ...');

  const jsDir = path.join(root, 'public', 'js');
  assert.ok(fs.existsSync(jsDir), 'No existe public/js');
  const files = collectJsFiles(jsDir);
  assert.ok(files.length >= 30, `Se esperaban >=30 archivos JS, hay ${files.length}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esm-syntax-'));
  const failures = [];

  try {
    for (const file of files) {
      const tmpFile = path.join(tmpDir, path.basename(file) + '.mjs');
      fs.copyFileSync(file, tmpFile);
      const res = spawnSync(process.execPath, ['--check', tmpFile], { encoding: 'utf8' });
      if (res.status !== 0) {
        const rel = path.relative(root, file).replace(/\\/g, '/');
        const errLine = (res.stderr || '').split('\n').find((l) => l.includes('SyntaxError')) || 'SyntaxError';
        failures.push(`${rel}: ${errLine.trim()}`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.deepStrictEqual(
    failures, [],
    `Archivos frontend con sintaxis ESM rota (rompen la carga de la página):\n  - ${failures.join('\n  - ')}`
  );

  console.log(`✓ ${files.length} archivos bajo public/js/ parsean como ES Module sin errores`);
  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE SINTAXIS ESM FRONTEND PASARON AL 100%!');
}

try {
  runFrontendEsmSyntaxTests();
  process.exit(0);
} catch (err) {
  console.error('❌ Falló:', err.message);
  process.exit(1);
}
