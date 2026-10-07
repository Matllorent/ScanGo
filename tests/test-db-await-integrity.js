/**
 * tests/test-db-await-integrity.js
 * Regresión: commit 47ea3f7 convirtió createUser/saveRestaurant/updateSubscription/... en
 * async sin actualizar los call sites. Resultado: respuestas {}, 404 muertos,
 * persistencia con race y crashes por unhandled rejection (registro tumbró el proceso).
 *
 * Este test detecta TODO método async de src/db/db.js llamado desde api/ o src/
 * sin await / .then / return / .catch explícito.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function collectAsyncDbMethods(dbSrc) {
  const methods = new Set();
  for (const m of dbSrc.matchAll(/^\s{2}async\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    methods.add(m[1]);
  }
  return methods;
}

function findMissingAwaits(dir, asyncMethods) {
  const issues = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      for (const meth of asyncMethods) {
        const re = new RegExp(`db\\.${meth}\\s*\\(`, 'g');
        for (const m of src.matchAll(re)) {
          const before = src.slice(Math.max(0, m.index - 120), m.index);
          if (/\bawait\s+$/.test(before)) continue;   // await db.x(
          if (/\.then\(\s*$/.test(before)) continue;  // .then(db.x(
          if (/return\s+$/.test(before)) continue;    // return db.x(
          // Lanzamiento intencional en background con manejo de errores explícito
          if (/\.catch\(/.test(src.slice(m.index, m.index + 300))) continue;
          const lineNo = src.slice(0, m.index).split('\n').length;
          issues.push(`${path.relative(root, full).replace(/\\/g, '/')}:${lineNo}  db.${meth}() sin await/.catch`);
        }
      }
    }
  };
  walk(dir);
  return issues;
}

function runDbAwaitIntegrityTests() {
  console.log('🧪 Iniciando verificación de integridad await en capa de datos (db) ...');

  const dbSrc = fs.readFileSync(path.join(root, 'src', 'db', 'db.js'), 'utf8');
  const asyncMethods = collectAsyncDbMethods(dbSrc);
  assert.ok(asyncMethods.size >= 10,
    `Se esperaban >=10 métodos async en db.js, se detectaron ${asyncMethods.size}`);
  console.log(`✓ ${asyncMethods.size} métodos async detectados en src/db/db.js`);

  const issues = [
    ...findMissingAwaits(path.join(root, 'api'), asyncMethods),
    ...findMissingAwaits(path.join(root, 'src'), asyncMethods)
  ];

  assert.deepStrictEqual(
    issues, [],
    `Llamadas a métodos async de db sin await ni .catch (rompen persistencia y pueden tumbar el proceso):\n  - ${issues.join('\n  - ')}`
  );
  console.log('✓ Todas las llamadas db.*() desde api/ y src/ usan await o .catch explícito');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE INTEGRIDAD AWAIT EN DB PASARON AL 100%!');
}

try {
  runDbAwaitIntegrityTests();
  process.exit(0);
} catch (err) {
  console.error('❌ Falló:', err.message);
  process.exit(1);
}
