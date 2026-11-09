/**
 * tests/test-frontend-esm-syntax.js
 * Regresión: el codemod quick-wins.js eliminó "function escapeHtml(str){...}" de
 * public/js/studio.js dejando un "export" huérfano → SyntaxError → el Studio
 * entero quedó en "Cargando..." infinito (imports jamás se pedían). El daño quedó
 * commiteado y ningún test lo detectaba.
 *
 * Guard 1: TODO archivo JS bajo public/js/ debe parsear como ES Module (V8/Node).
 * Guard 2: cada import local debe apuntar a un archivo existente y a un export
 *          realmente declarado (nombres, default, re-exports y `export *`).
 *          Un `node --check` NO detecta `import { x } from './mod'` cuando `mod`
 *          no exporta `x`: el SyntaxError recién aparece en el navegador y deja
 *          la página entera sin handlers (el bug real de revokeWinbackCoupon).
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

/** Reemplaza comentarios por espacios, preservando strings y saltos de línea. */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < source.length) { out += '  '; i += 2; }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\') {
          out += c;
          i++;
          if (i < source.length) { out += source[i]; i++; }
          continue;
        }
        out += c;
        i++;
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function isLocalSpecifier(spec) {
  return typeof spec === 'string' && (spec.startsWith('.') || spec.startsWith('/'));
}

function resolveLocalSpecifier(fromFile, spec) {
  const clean = String(spec || '').split(/[?#]/)[0];
  if (!isLocalSpecifier(clean)) return null;
  const target = clean.startsWith('/')
    ? path.join(root, 'public', clean.replace(/^\/+/, ''))
    : path.resolve(path.dirname(fromFile), clean);
  const candidates = [target, `${target}.js`, path.join(target, 'index.js')];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (e) { /* carrera de FS: se trata como inexistente */ }
  }
  return null;
}

function parseNamedItems(rawList) {
  const items = [];
  for (const raw of String(rawList || '').split(',')) {
    const item = raw.trim().replace(/^type\s+/, '');
    if (!item) continue;
    const parts = item.split(/\s+as\s+/).map((s) => s.trim());
    const original = parts[0];
    const alias = parts[1] || parts[0];
    if (!/^[A-Za-z_$][\w$]*$/.test(original)) continue;
    items.push({ original, alias });
  }
  return items;
}

/**
 * Extrae los exports de un módulo. Resuelve re-exports (`export { x } from`)
 * y `export *` recursivamente para que los barrels (menu/index.js) no den
 * falsos positivos.
 */
function collectModuleInfo(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const info = { names: new Set(), hasDefault: false, missingTargets: [] };
  cache.set(file, info);

  let source;
  try {
    source = stripComments(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    info.missingTargets.push({ spec: '(lectura)', reason: e.message });
    return info;
  }

  const declRes = [
    /export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  ];
  for (const re of declRes) {
    let m;
    while ((m = re.exec(source))) info.names.add(m[1]);
  }

  // export const { a, b: c } = obj → exporta a y c
  const destructuredRe = /export\s+(?:const|let|var)\s*\{([^}]*)\}/g;
  let dm;
  while ((dm = destructuredRe.exec(source))) {
    for (const raw of dm[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const binding = part.split(':').pop().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(binding)) info.names.add(binding);
    }
  }

  if (/(?:^|\n)\s*export\s+default\b/.test(source)) info.hasDefault = true;

  // export { a, b as c } [from './x.js']
  const reExportRe = /export\s*\{([\s\S]*?)\}\s*(?:from\s*['"]([^'"]+)['"])?/g;
  let rm;
  while ((rm = reExportRe.exec(source))) {
    const items = parseNamedItems(rm[1]);
    const spec = rm[2];
    let targetInfo = null;
    if (spec) {
      const target = resolveLocalSpecifier(file, spec);
      if (!target) {
        info.missingTargets.push({ spec, reason: 'el archivo no existe' });
        continue;
      }
      targetInfo = collectModuleInfo(target, cache);
    }
    for (const item of items) {
      if (item.original === 'default') {
        if (targetInfo) {
          if (!targetInfo.hasDefault) {
            info.missingTargets.push({ spec, reason: `no exporta default` });
          }
        } else {
          info.hasDefault = true;
        }
        continue;
      }
      if (targetInfo && !targetInfo.names.has(item.original)) {
        info.missingTargets.push({ spec, reason: `no exporta '${item.original}'` });
        continue;
      }
      info.names.add(item.alias);
    }
  }

  // export * from './x.js'
  const starRe = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
  let sm;
  while ((sm = starRe.exec(source))) {
    const spec = sm[1];
    const target = resolveLocalSpecifier(file, spec);
    if (!target) {
      info.missingTargets.push({ spec, reason: 'el archivo no existe' });
      continue;
    }
    const targetInfo = collectModuleInfo(target, cache);
    for (const name of targetInfo.names) info.names.add(name);
    for (const missing of targetInfo.missingTargets) info.missingTargets.push({ spec, reason: missing.reason });
  }

  return info;
}

function checkImports(file, cache, failures) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const source = stripComments(fs.readFileSync(file, 'utf8'));

  const importRe = /(?:^|\n)\s*import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(source))) {
    const clause = m[1].trim();
    const spec = m[2];
    if (!isLocalSpecifier(spec)) continue;
    const target = resolveLocalSpecifier(file, spec);
    if (!target) {
      failures.push(`${rel}: import '${spec}' → el archivo no existe`);
      continue;
    }
    const targetInfo = collectModuleInfo(target, cache);
    for (const missing of targetInfo.missingTargets) {
      failures.push(`${rel}: import '${spec}' → ${missing.reason}`);
    }

    const named = clause.match(/\{([\s\S]*?)\}/);
    if (named) {
      for (const item of parseNamedItems(named[1])) {
        if (item.original === 'default') {
          if (!targetInfo.hasDefault) {
            failures.push(`${rel}: import '${spec}' → no exporta default`);
          }
        } else if (!targetInfo.names.has(item.original)) {
          failures.push(`${rel}: import '${spec}' → no exporta '${item.original}'`);
        }
      }
    }

    // Default import: "Foo", "Foo, {...}", "Foo, * as ns". El namespace se ignora.
    const beforeBrace = clause.split('{')[0].replace(/\*[\s\S]*$/, '').trim();
    const defaultName = beforeBrace.split(',')[0].trim();
    if (defaultName && /^[A-Za-z_$][\w$]*$/.test(defaultName) && !targetInfo.hasDefault) {
      failures.push(`${rel}: import '${spec}' → no exporta default`);
    }
  }

  // Imports de efecto secundario: import './x.js'
  const sideEffectRe = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  let se;
  while ((se = sideEffectRe.exec(source))) {
    const spec = se[1];
    if (!isLocalSpecifier(spec)) continue;
    if (!resolveLocalSpecifier(file, spec)) {
      failures.push(`${rel}: import '${spec}' → el archivo no existe`);
    }
  }

  // Imports dinámicos: import('./x.js')
  const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let dy;
  while ((dy = dynamicRe.exec(source))) {
    const spec = dy[1];
    if (!isLocalSpecifier(spec)) continue;
    if (!resolveLocalSpecifier(file, spec)) {
      failures.push(`${rel}: import dinámico '${spec}' → el archivo no existe`);
    }
  }
}

function runFrontendEsmSyntaxTests() {
  console.log('🧪 Iniciando verificación de módulos ES del frontend (public/js) ...');

  const jsDir = path.join(root, 'public', 'js');
  assert.ok(fs.existsSync(jsDir), 'No existe public/js');
  const files = collectJsFiles(jsDir);
  assert.ok(files.length >= 30, `Se esperaban >=30 archivos JS, hay ${files.length}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esm-syntax-'));
  const syntaxFailures = [];

  try {
    for (const file of files) {
      const tmpFile = path.join(tmpDir, path.basename(file) + '.mjs');
      fs.copyFileSync(file, tmpFile);
      const res = spawnSync(process.execPath, ['--check', tmpFile], { encoding: 'utf8' });
      if (res.status !== 0) {
        const rel = path.relative(root, file).replace(/\\/g, '/');
        const errLine = (res.stderr || '').split('\n').find((l) => l.includes('SyntaxError')) || 'SyntaxError';
        syntaxFailures.push(`${rel}: ${errLine.trim()}`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.deepStrictEqual(
    syntaxFailures, [],
    `Archivos frontend con sintaxis ESM rota (rompen la carga de la página):\n  - ${syntaxFailures.join('\n  - ')}`
  );

  const moduleCache = new Map();
  const linkFailures = [];
  for (const file of files) checkImports(file, moduleCache, linkFailures);

  assert.deepStrictEqual(
    linkFailures, [],
    `Imports/exports ESM rotos (el navegador lanza SyntaxError y deja la página sin handlers):\n  - ${linkFailures.join('\n  - ')}`
  );

  console.log(`✓ ${files.length} archivos bajo public/js/ parsean como ES Module sin errores`);
  console.log('✓ Todos los imports locales resuelven archivos y exports declarados');
  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE MÓDULOS ES FRONTEND PASARON AL 100%!');
}

try {
  runFrontendEsmSyntaxTests();
  process.exit(0);
} catch (err) {
  console.error('❌ Falló:', err.message);
  process.exit(1);
}
