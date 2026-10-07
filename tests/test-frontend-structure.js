/**
 * tests/test-frontend-structure.js
 * Regresiones estructurales del frontend detectadas con Playwright E2E:
 *
 * 1) studio.html: faltaban 2 `</div>` tras el form de modifierGroupManagerModal →
 *    #aiMenuImportModal quedó ANIDADADO dentro de ese modal (display:none) →
 *    el botón "📷 Importar Carta con IA" abría el modal pero NUNCA se veía.
 *
 * 2) aiMenuImport.js: en runAiMenuAnalysis, closeAiMenuImportModal() (que ejecuta
 *    resetAiImportState() → parsedResult = null) se llamaba DESPUÉS de asignar
 *    parsedResult → el preview recibía null y explotaba con
 *    "Cannot read properties of null (reading 'isDemoFallback')".
 *
 * Guardas:
 *   A) Los <div> de los HTML balancean a profundidad 0 (cierre completo).
 *   B) Todo .modal-overlay es hijo directo de body (profundidad 0 al abrirse).
 *   C) En runAiMenuAnalysis: close ANTES de asignar parsedResult, y open DESPUÉS.
 *
 * Son assert de fuente (estilo house: test-menu-componentization §9/§10) — sin DOM.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** Sustrae comments, bloques <script> y <style> para contar <div> solo en markup. */
function markupOnly(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
}

/**
 * Recorre los tags <div> y devuelve:
 *  - finalDepth: profundidad al terminar (0 = balanceado)
 *  - minDepth: nunca negativo
 *  - modals: [{ id, depth }] para cada apertura con class modal-overlay
 *  - negatives: cantidad de </div> sin <div> correspondiente
 */
function scanDivs(markup) {
  const tokenRe = /<(\/?)div\b[^>]*>/gi;
  let depth = 0;
  let minDepth = 0;
  let negatives = 0;
  const modals = [];

  let m;
  while ((m = tokenRe.exec(markup)) !== null) {
    const closing = m[1] === '/';
    const tag = m[0];
    if (closing) {
      depth -= 1;
      if (depth < 0) negatives += 1;
      if (depth < minDepth) minDepth = depth;
    } else {
      if (/class\s*=\s*["'][^"']*modal-overlay/i.test(tag)) {
        const idMatch = tag.match(/id\s*=\s*["']([^"']+)["']/i);
        modals.push({ id: idMatch ? idMatch[1] : '(sin id)', depth });
      }
      depth += 1;
    }
  }
  return { finalDepth: depth, minDepth, negatives, modals };
}

function runFrontendStructureTests() {
  console.log('🧪 Iniciando verificación de estructura HTML frontend + orden de importación IA ...');

  // ---------- A + B: balance de <div> y modales de nivel body ----------
  const htmlFiles = ['public/studio.html', 'public/menu.html', 'public/admin.html'];
  const problems = [];

  for (const rel of htmlFiles) {
    const { finalDepth, minDepth, negatives, modals } = scanDivs(markupOnly(read(rel)));

    if (finalDepth !== 0) {
      problems.push(`${rel}: <div> desbalanceados — profundidad final ${finalDepth} (faltan o sobran cierres)`);
    }
    if (minDepth < 0 || negatives > 0) {
      problems.push(`${rel}: ${negatives} </div> sin apertura correspondiente (profundidad mínima ${minDepth})`);
    }
    for (const modal of modals) {
      if (modal.depth !== 0) {
        problems.push(
          `${rel}: modal #${modal.id} está anidado a profundidad ${modal.depth} — ` +
          `un .modal-overlay debe ser hijo directo de <body> (si su padre está display:none el modal NUNCA se ve)`
        );
      }
    }
    console.log(`✓ ${rel}: <div> balanceados (profundidad final 0), ${modals.length} modales todos a nivel body`);
  }

  assert.deepStrictEqual(problems, [], `Estructura HTML rota:\n  - ${problems.join('\n  - ')}`);

  // ---------- C: orden en runAiMenuAnalysis ----------
  const src = read('public/js/studio/aiMenuImport.js');
  const fnStart = src.indexOf('export async function runAiMenuAnalysis');
  assert.ok(fnStart !== -1, 'No se encontró runAiMenuAnalysis en aiMenuImport.js');
  const fnEnd = src.indexOf('\nexport ', fnStart + 10);
  const fnBody = fnStart !== -1 ? src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd) : '';

  const idxClose = fnBody.indexOf('closeAiMenuImportModal();');
  const idxAssign = fnBody.indexOf('parsedResult = data.data');
  const idxOpen = fnBody.indexOf('openAiMenuPreviewModal(parsedResult)');

  assert.ok(idxClose !== -1, 'runAiMenuAnalysis ya no cierra el modal de importación antes del preview');
  assert.ok(idxAssign !== -1, 'runAiMenuAnalysis ya no asigna parsedResult desde la respuesta');
  assert.ok(idxOpen !== -1, 'runAiMenuAnalysis ya no abre el preview con parsedResult');

  assert.ok(
    idxClose < idxAssign,
    'REGRESIÓN (bug real): closeAiMenuImportModal() debe ir ANTES de asignar parsedResult — ' +
    'close ejecuta resetAiImportState() que pone parsedResult = null y destruye el resultado del análisis'
  );
  assert.ok(
    idxAssign < idxOpen,
    'REGRESIÓN: openAiMenuPreviewModal(parsedResult) debe ir DESPUÉS de asignar parsedResult (recibía null)'
  );
  console.log('✓ aiMenuImport.js: orden close → assign → open correcto (parsedResult no se anula)');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE ESTRUCTURA FRONTEND PASARON AL 100%!');
}

try {
  runFrontendStructureTests();
  process.exit(0);
} catch (err) {
  console.error('❌ Falló:', err.message);
  process.exit(1);
}
