const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');
const SRC = path.join(ROOT, 'src');
const PUBLIC_JS = path.join(ROOT, 'public', 'js');

/**
 * Bloque 4 — Guards de arquitectura.
 *
 * Cuatro invariantes estructurales que se rompen con intención, no por
 * accidente (cada uno documenta por qué existe y cómo pedir permiso):
 *
 *   A) La telemetría es la fuente única de verdad de analytics:
 *      `restaurant.analytics` es una PROYECCIÓN derivada que SOLO escribe
 *      `db.setAnalyticsSnapshot()` (src/db/db.js). Nadie más puede mutar el
 *      contador, ni por campo ni en bloque:
 *        - cero `.analytics.<campo> ++/--/+=/-/=` en todo api/ y src/;
 *        - exactamente UNA asignación whole-object `.analytics =`: el
 *          `rest.analytics = { ... }` dentro de setAnalyticsSnapshot.
 *      Si un webhook/cron/admin necesita tocar analytics a mano → rediseñar
 *      con eventos de telemetría, nunca el contador directo.
 *
 *   B) api/utils es pura: no importa db, billing, routers ni middleware
 *      (dependencias hacia dentro rompen la capa y el testeo directo).
 *      Única excepción documentada: tokenRevocation.js requiere ../../src/db
 *      LAZY (dentro de un método, no top-level) para purgar tokens con la
 *      sesión sin dependencia circular en carga.
 *
 *   C) public/js es frontend plano: cero CommonJS (`require(`) y todos los
 *      specifiers de import/export/import() resuelven DENTRO de public/js
 *      (root-relative `/js/...` o relativos `./` `../`); un specifier que
 *      escape (npm, abs, ../ por encima de public/js) viola la CSP
 *      (script-src 'self' + CDNs) y el bundling-less.
 *
 *   D) El dominio nunca importa transporte: src/**, api/services/** y
 *      api/utils/** NO pueden requerir api/index, api/routes/**,
 *      api/cron/** ni api/middleware/**. La dependencia va en un solo
 *      sentido (transporte → dominio); invertirla acopla la lógica de
 *      negocio al HTTP y rompe el testeo directo en Node. Los requires
 *      cruzados dentro de la misma capa o hacia src están permitidos (misma
 *      capa o hacia adentro).
 */

console.log('🧪 Guards de arquitectura: analytics proyección, capas api/, frontend plano, dirección dominio→transporte...');

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/** Quita comentarios // y /* *\/ para no disparar falsos positivos. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/(.*)$/gm, '$1');
}

// ── A) analytics = proyección, solo via setAnalyticsSnapshot ────────────────
function guardAnalyticsProjection() {
  const perField = /\.analytics\.\w+\s*(?:\+\+|--|\+=|-=|\=(?!=))/;
  const wholeObj = /\.analytics\s*=(?!=)/;

  const violations = [];
  const wholeMatches = [];
  for (const file of [...walk(API), ...walk(SRC)]) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const stripped = stripComments(line);
      if (!stripped.trim()) return;
      if (perField.test(stripped)) {
        violations.push(`${rel(file)}:${i + 1}: ${stripped.trim()}`);
      }
      if (wholeObj.test(stripped)) {
        wholeMatches.push({ file: rel(file), line: i + 1, text: stripped.trim() });
      }
    });
  }

  assert.deepStrictEqual(violations, [],
    `A: cero mutaciones por campo de .analytics en api/+src/ (recibidas: ${violations.length})`);
  assert.strictEqual(wholeMatches.length, 1,
    `A: exactamente una asignación whole-object de .analytics (recibidas: ${wholeMatches.length})`);
  assert.ok(wholeMatches[0].file.endsWith('src/db/db.js'), `A: la asignación vive en db.js (${wholeMatches[0].file})`);
  assert.ok(wholeMatches[0].text.startsWith('rest.analytics = {'),
    `A: es el snapshot de setAnalyticsSnapshot (${wholeMatches[0].text})`);
  console.log(`✓ A: analytics es proyección — única escritura ${wholeMatches[0].file}:${wholeMatches[0].line}`);
}

// ── B) api/utils puro (sin db/billing/routes/middleware) ────────────────────
function guardUtilsLayer() {
  const banned = /require\(\s*['"](\.[.]\/\.[.]\/src\/(?:db|billing)|\.[.]\/routes\/|\.\.\/middleware\/)/;
  const ALLOW = ['api/utils/tokenRevocation.js']; // lazy ../../src/db (purga de tokens)
  const violations = [];
  const allowMatches = [];
  for (const file of walk(API + path.sep + 'utils')) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = banned.exec(stripComments(line));
      if (!m) return;
      const entry = `${rel(file)}:${i + 1}: ${line.trim()}`;
      if (ALLOW.includes(rel(file))) allowMatches.push({ file: rel(file), line: i + 1, text: line });
      else violations.push(entry);
    });
  }
  assert.deepStrictEqual(violations, [],
    `B: api/utils no importa db/billing/routes/middleware (recibidas: ${violations.length})`);
  for (const m of allowMatches) {
    assert.ok(/^\s+/.test(m.text), `B: la excepción ${m.file} es LAZY (dentro de método): ${m.text.trim()}`);
  }
  console.log(`✓ B: api/utils puro — ${allowMatches.length} excepción documentada (tokenRevocation, require lazy)`);
}

// ── C) public/js plano: cero require, imports internos ──────────────────────
function guardPlainFrontend() {
  const requireRe = /\brequire\s*\(/;
  // Imports anclados a inicio de línea (así viven en el codebase): evita que
  // `\bimport` matchee el `import'` de una URL tipo '/api/ai-import'.
  const importWithFrom = /(^|\n)\s*import\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const exportFrom = /(^|\n)\s*export\s*(?:\*\s*)?from\s*['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
  const sideEffectImport = /(^|\n)\s*import\s*['"]([^'"]+)['"]/g;

  const violations = [];
  const seen = new Set();
  for (const file of walk(PUBLIC_JS)) {
    const src = fs.readFileSync(file, 'utf8');
    const stripped = stripComments(src);

    if (requireRe.test(stripped)) {
      violations.push(`${rel(file)}: usa require() (CommonJS prohibido en frontend)`);
    }

    const checkSpec = (spec, label) => {
      const key = `${rel(file)} -> ${spec}`;
      if (seen.has(key)) return;
      seen.add(key);

      let resolved = null;
      if (spec.startsWith('/')) {
        resolved = path.join(ROOT, 'public', spec.replace(/^\/+/, ''));
      } else if (spec.startsWith('.')) {
        resolved = path.resolve(path.dirname(file), spec);
      }
      if (!resolved) {
        violations.push(`${key}: specifier bare (resuelve fuera de public/js → viola CSP)`);
        return;
      }
      const fromPublic = path.relative(PUBLIC_JS, resolved);
      if (fromPublic.startsWith('..') || path.isAbsolute(fromPublic)) {
        violations.push(`${key}: escapa de public/js (→ ${resolved})`);
      }
    };

    for (const re of [importWithFrom, exportFrom, dynamicImport, sideEffectImport]) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(stripped)) !== null) {
        checkSpec(m[m.length - 1], re.source);
      }
    }
  }

  assert.deepStrictEqual(violations, [],
    `C: public/js sin require() y con imports que resuelven dentro de public/js (recibidas: ${violations.length})`);
  console.log(`✓ C: frontend plano — 0 require(), ${seen.size} specifiers internos verificados`);
}

// ── D) dominio nunca importa transporte ───────────────────────────────────
// Dominios: src/**, api/services/**, api/utils/**. Destinos prohibidos:
// api/index.js, api/routes/**, api/cron/**, api/middleware/**.
// Solo se inspeccionan requires relativos (los de npm/builtins no cruzan
// capas del repo).
function guardLayerDirection() {
  const domainDirs = [
    path.join(SRC),
    path.join(API, 'services'),
    path.join(API, 'utils')
  ];
  const bannedPrefixes = [
    path.join(API, 'index.js'),
    path.join(API, 'routes') + path.sep,
    path.join(API, 'cron') + path.sep,
    path.join(API, 'middleware') + path.sep
  ];
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const violations = [];
  const hitsBanned = (resolved) => {
    // El require omite extensión: se prueban las 3 resoluciones reales.
    const candidates = [resolved, resolved + '.js', path.join(resolved, 'index.js')];
    return candidates.some(c => bannedPrefixes.some(p => c === p || c.startsWith(p)));
  };
  for (const dir of domainDirs) {
    for (const file of walk(dir)) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      let m;
      requireRe.lastIndex = 0;
      while ((m = requireRe.exec(src)) !== null) {
        const spec = m[1];
        if (!spec.startsWith('.')) continue; // npm/builtin: no cruza capas
        const resolved = path.normalize(path.join(path.dirname(file), spec));
        if (hitsBanned(resolved)) violations.push(`${rel(file)} -> ${rel(resolved) || spec}`);
      }
    }
  }
  assert.deepStrictEqual(violations, [],
    `D: el dominio (src, api/services, api/utils) no importa transporte (recibidas: ${violations.length})`);
  console.log('✓ D: dirección única transporte → dominio (0 requires invertidos)');
}

guardAnalyticsProjection();
guardUtilsLayer();
guardPlainFrontend();
guardLayerDirection();

console.log('\n🎉 ¡ARQUITECTURA EN VERDE: guards estructurales sin violaciones activas!\n');