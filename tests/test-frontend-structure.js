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
 *   D) El CTA de instalación PWA está cableado (pwa-install-ready → triggerPWAInstall).
 *   E) Menú: las pills de categoría y los filtros dietéticos son toggle (tocar el
 *      activo vuelve a "Todos"), y ni las categorías ni los filtros sin platos se muestran.
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

  // ---------- D: CTA de instalación PWA cableado ----------
  // El evento beforeinstallprompt se capturaba pero nadie mostraba un CTA y
  // window.triggerPWAInstall quedaba huérfano (nunca invocado). Este guard evita
  // que vuelva a pasar: debe existir un consumidor de pwa-install-ready que
  // llame a triggerPWAInstall, y sin atributos inline on* (CSP script-src-attr none).
  const pwa = read('public/js/pwa.js');
  assert.ok(
    /addEventListener\(\s*['"]pwa-install-ready['"]/.test(pwa),
    'pwa.js debe escuchar el evento pwa-install-ready para mostrar el CTA de instalación'
  );
  assert.ok(
    /window\.triggerPWAInstall\s*\(/.test(pwa),
    'REGRESIÓN: triggerPWAInstall existe pero nadie lo invoca — el CTA de instalación quedó huérfano'
  );
  assert.ok(
    !/\son[a-z]+\s*=/i.test(pwa),
    'pwa.js no debe declarar atributos inline on* (CSP script-src-attr none)'
  );
  console.log('✓ pwa.js: CTA de instalación cableado (pwa-install-ready → triggerPWAInstall), sin on*=');

  // ---------- E: filtros y categorías del menú ----------
  // E.1) Toggle de categoría: tocar la activa la deselecciona y vuelve a "Todos"
  //      (el modal de categorías sigue usando selectCategory, siempre selecciona).
  // E.2) Toggle de filtro dietético: tocar el activo vuelve a "Todos los estilos".
  // E.3) Categorías sin platos no aparecen (ni en pills ni en el modal).
  // E.4) Filtros dietéticos sin platos tampoco.
  const menu = read('public/js/menu.js');
  assert.ok(
    /function\s+toggleCategory\s*\(\s*catId\s*\)/.test(menu),
    'menu.js debe definir toggleCategory(catId) para el toggle de categorías'
  );
  assert.ok(
    /data-js-click="toggleCategory\|/.test(menu),
    'REGRESIÓN: las pills de categoría deben usar toggleCategory (no selectCategory) para poder deseleccionar'
  );
  assert.ok(
    /selectedCategory\s*===\s*catId/.test(menu),
    'REGRESIÓN: toggleCategory debe comparar la categoría tocada con selectedCategory para deseleccionar'
  );
  assert.ok(
    /selectCategory\('ALL'\)/.test(menu),
    'REGRESIÓN: toggleCategory debe volver a ALL al deseleccionar'
  );
  assert.ok(
    /^\s*toggleCategory,\s*$/m.test(menu),
    'REGRESIÓN: toggleCategory debe exponerse en window (binder data-js-* de dom-bindings)'
  );
  console.log('✓ menu.js: pills de categoría con toggle (tocar la activa vuelve a "Todos")');

  // E.2) Toggle de filtro dietético
  assert.ok(
    /selectedDietFilter\s*===\s*diet/.test(menu),
    'REGRESIÓN: selectDietFilter debe togglear (tocar el filtro activo vuelve a "Todos los estilos")'
  );
  console.log('✓ menu.js: filtros dietéticos con toggle (tocar el activo vuelve a "Todos los estilos")');

  // E.3) Categorías sin platos no aparecen (pills + modal): deben existir al
  // menos 2 filtros por `dishes.some(d => d.categoryId === c.id)`.
  const catEmptyGuards = menu.match(/dishes\.some\(d => d\.categoryId === c\.id\)/g) || [];
  assert.ok(
    catEmptyGuards.length >= 2,
    'REGRESIÓN: renderCategories y openCategoriesMenuModal deben ocultar categorías sin platos (dishes.some ... categoryId)'
  );
  console.log('✓ menu.js: categorías sin platos ocultas en pills y modal');

  // E.4) Filtros dietéticos sin platos ocultos
  assert.ok(
    /btn\.style\.display\s*=\s*'none'/.test(menu),
    'REGRESIÓN: renderDietaryFilters debe ocultar los filtros dietéticos sin platos'
  );
  console.log('✓ menu.js: filtros dietéticos sin platos ocultos');

  // ---------- F: armador de helado (CTA protagonista + data-driven) ----------
  // F.1) El menú tiene un CTA protagonista de heladería cableado al armador.
  // F.2) menu.js lo muestra sólo para heladerías.
  // F.3) Los chips de categoría de sabores son data-driven (nunca hardcodeados:
  //      antes mostraban categorías que llevaban a listas vacías).
  // F.4) El resumen/total se ve en vivo (barra fija), no recién en el último paso.
  const menuHtml = read('public/menu.html');
  assert.ok(
    /id=["']iceCreamHeroCTA["']/.test(menuHtml) && /data-js-click=["']openIceCreamWizard["']/.test(menuHtml),
    'menu.html debe exponer el CTA protagonista #iceCreamHeroCTA cableado a openIceCreamWizard'
  );
  assert.ok(
    /getElementById\(['"]iceCreamHeroCTA['"]\)/.test(menu),
    'REGRESIÓN: menu.js debe mostrar el hero de heladería según el rubro (isHeladeria)'
  );

  const iceCreamWizardSrc = read('public/js/components/IceCreamWizard.js');
  assert.ok(
    /data-icw-cat/.test(iceCreamWizardSrc) && /getFlavorBuckets\s*\(/.test(iceCreamWizardSrc),
    'REGRESIÓN: los chips de categorías de sabores deben derivarse de la carta (getFlavorBuckets)'
  );
  assert.ok(
    !/data-flavor-cat=["']?(Chocolates|Cremas|Frutales)/.test(iceCreamWizardSrc),
    'REGRESIÓN: los chips de sabores no pueden estar hardcodeados (llevaban a listas vacías)'
  );
  assert.ok(
    /iceCreamSummaryLine/.test(iceCreamWizardSrc) && /renderSummary\s*\(/.test(iceCreamWizardSrc),
    'REGRESIÓN: el armador debe mostrar resumen y total en vivo (barra inferior fija)'
  );
  assert.ok(
    !/\.onclick\s*=\s*["']/.test(iceCreamWizardSrc) && !/\son[a-z]+\s*=\s*["']/.test(iceCreamWizardSrc),
    'IceCreamWizard.js no debe declarar atributos inline on* (CSP script-src-attr none)'
  );
  assert.ok(
    !/id=["']btnOpenIceCreamWizard["']/.test(menuHtml),
    'REGRESIÓN: no debe existir el botón duplicado #btnOpenIceCreamWizard (el hero es el único acceso al armador)'
  );
  assert.ok(
    /id=["']iceCreamHeroLabel["']/.test(menuHtml) && /iceCreamBuilderLabel/.test(menu),
    'REGRESIÓN: el texto del botón del armador debe ser configurable por el dueño (iceCreamBuilderLabel)'
  );
  console.log('✓ Heladería: CTA protagonista + armador data-driven con resumen y total en vivo');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE ESTRUCTURA FRONTEND PASARON AL 100%!');
}

try {
  runFrontendStructureTests();
  process.exit(0);
} catch (err) {
  console.error('❌ Falló:', err.message);
  process.exit(1);
}
