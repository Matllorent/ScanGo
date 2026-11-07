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
 *   J) Páginas legales: botón "Volver" con default seguro "/" y decisión por
 *      referrer same-origin (/studio o /studio.html → panel; resto → inicio).
 *      Nunca se hardcodea /studio en el HTML.
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

/** Balance de <section> para detectar cierres mal formados (ej: </div</section>). */
function scanSections(markup) {
  const tokenRe = /<(\/?)section\b[^>]*>/gi;
  let depth = 0;
  let minDepth = 0;
  let negatives = 0;

  let m;
  while ((m = tokenRe.exec(markup)) !== null) {
    if (m[1] === '/') {
      depth -= 1;
      if (depth < 0) negatives += 1;
      if (depth < minDepth) minDepth = depth;
    } else {
      depth += 1;
    }
  }
  return { finalDepth: depth, minDepth, negatives };
}

/** Profundidad de `tagName` justo antes de `index` (0 = top-level). */
function depthBeforeTag(markup, tagName, index) {
  const re = new RegExp(`<(\\/?)${tagName}\\b[^>]*>`, 'gi');
  let depth = 0;
  let m;
  while ((m = re.exec(markup)) !== null && m.index < index) {
    depth += m[1] ? -1 : 1;
  }
  return depth;
}

function runFrontendStructureTests() {
  console.log('🧪 Iniciando verificación de estructura HTML frontend + orden de importación IA ...');

  // ---------- A + B: balance de <div> y modales de nivel body ----------
  const htmlFiles = ['public/index.html', 'public/studio.html', 'public/menu.html', 'public/admin.html'];
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

  // ---------- A.2: landing — FAQ en el flujo principal, no dentro del pricing grid ----------
  // Bug real: un cierre mal formado (`</div</section>`) dejó abierto
  // #pricingEventGrid (display:none), así que Testimonios y FAQ quedaron
  // anidados dentro de un contenedor invisible (FAQ medía 0px en producción).
  // La FAQ debe ser una <section> top-level dentro de <main>, con sus links
  // de navegación y sin abrir pestañas nuevas para rutas internas.
  const landingMarkup = markupOnly(read('public/index.html'));
  const sectionScan = scanSections(landingMarkup);
  assert.strictEqual(
    sectionScan.finalDepth,
    0,
    `index.html: <section> desbalanceados — profundidad final ${sectionScan.finalDepth} (cierres mal formados como </div</section>)`
  );
  assert.strictEqual(
    sectionScan.minDepth,
    0,
    `index.html: ${sectionScan.negatives} </section> sin apertura correspondiente`
  );

  const faqOpenIndex = landingMarkup.indexOf('<section id="faq"');
  assert.notStrictEqual(faqOpenIndex, -1, 'index.html: falta la sección #faq');
  assert.strictEqual(
    depthBeforeTag(landingMarkup, 'section', faqOpenIndex),
    0,
    'REGRESIÓN: #faq está anidada dentro de otra <section> (el pricing grid oculto la volvía invisible)'
  );
  const mainOpenIndex = landingMarkup.indexOf('<main');
  const mainCloseIndex = landingMarkup.indexOf('</main>');
  assert.ok(
    mainOpenIndex !== -1 && mainCloseIndex !== -1 && faqOpenIndex > mainOpenIndex && faqOpenIndex < mainCloseIndex,
    'REGRESIÓN: #faq debe estar dentro de <main>, antes de </main>'
  );
  assert.strictEqual(
    (landingMarkup.match(/class="faq-question"/g) || []).length,
    6,
    'REGRESIÓN: la landing debe publicar las 6 preguntas frecuentes'
  );
  const faqLinks = landingMarkup.match(/<a\b[^>]*href=["']#faq["'][^>]*>/gi) || [];
  assert.ok(
    faqLinks.length >= 2,
    'REGRESIÓN: la FAQ debe estar enlazada desde la navegación y el footer (href="#faq")'
  );
  const internalAnchors = [
    ...landingMarkup.matchAll(/<a\b[^>]*href=["'](?:#|\/)[^"']*["'][^>]*>/gi)
  ].map((m) => m[0]);
  const internalBlank = internalAnchors.filter((tag) => /\btarget\s*=\s*["']_blank["']/i.test(tag));
  assert.deepStrictEqual(
    internalBlank,
    [],
    `REGRESIÓN: los enlaces internos de la landing no deben abrir pestaña nueva:\n  - ${internalBlank.join('\n  - ')}`
  );
  console.log('✓ Landing: #faq top-level dentro de <main>, 6 preguntas y links internos sin target="_blank"');

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
  const menuHeaderSrcF = read('public/js/menu/menuHeader.js');
  assert.ok(
    /getElementById\(['"]iceCreamHeroCTA['"]\)/.test(menuHeaderSrcF),
    'REGRESIÓN: menuHeader.js debe mostrar el hero de heladería según el rubro (isHeladeria)'
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
  const menuHeaderF = read('public/js/menu/menuHeader.js');
  assert.ok(
    /id=["']iceCreamHeroLabel["']/.test(menuHtml) && /iceCreamBuilderLabel/.test(menuHeaderF),
    'REGRESIÓN: el texto del botón del armador debe ser configurable por el dueño (iceCreamBuilderLabel)'
  );
  console.log('✓ Heladería: CTA protagonista + armador data-driven con resumen y total en vivo');

  // ---------- G: el Service Worker NO intercepta requests cross-origin ----------
  // Bug real (QA en navegador): el SW re-descargaba con `fetch()` las imágenes y
  // fuentes de OTRO origen. El fetch del SW queda sujeto al CSP de /sw.js
  // (`connect-src 'self' + supabase`), así que las bloqueaba — aunque el CSP de
  // la página ya las permite por `img-src`/`font-src` (https:). Los <img>
  // cross-origin (demos con Unsplash, fotos del dueño en cualquier host fuera de
  // Supabase) disparaban violaciones de `connect-src` y no cargaban con el SW
  // activo. Debe devolver el control al navegador para todo lo cross-origin.
  const sw = read('public/sw.js');
  assert.ok(
    /if\s*\(\s*url\.origin\s*!==\s*self\.location\.origin\s*\)\s*return\s*;/.test(sw),
    'REGRESIÓN (bug real): sw.js debe devolver el control al navegador para requests cross-origin ' +
    '(if (url.origin !== self.location.origin) return;) — interceptarlas las re-descarga bajo el connect-src del SW y las bloquea'
  );
  const swRespondWith = sw.match(/event\.respondWith\(/g) || [];
  assert.ok(
    swRespondWith.length === 1,
    'REGRESIÓN: sw.js debe tener UN solo event.respondWith (solo same-origin); interceptar cross-origin rompe imágenes/fuentes externas'
  );
  const guardIdx = sw.indexOf('!== self.location.origin');
  const respondIdx = sw.indexOf('event.respondWith(');
  assert.ok(
    guardIdx !== -1 && respondIdx !== -1 && guardIdx < respondIdx,
    'REGRESIÓN: el early-return cross-origin debe ir ANTES del event.respondWith same-origin'
  );
  const cacheVer = (sw.match(/const CACHE_NAME = 'scango-cache-v(\d+)'/) || [])[1];
  assert.ok(
    cacheVer && Number(cacheVer) >= 6,
    'REGRESIÓN: CACHE_NAME debe ser v6+ — el handler de fetch cambió y hay que invalidar el cache viejo del cliente'
  );
  console.log('✓ sw.js: no intercepta cross-origin (imágenes/fuentes externas cargan con el CSP de la página)');

  // ---------- H: banner de cookies con atraso + entrada única + sin solapes ----------
  // QA en navegador: el aviso aparecía en la primera pintura (sobrecarga al
  // visitante) y el flotante de WhatsApp tapaba sus botones — y al subirlo,
  // tapaba la demo del hero. Una sola entrada orquestada (sube + aparece) y
  // mientras el banner decide, el chat se oculta (vuelve al elegir).
  const consent = read('public/js/cookieConsent.js');
  assert.ok(
    /var SHOW_DELAY_MS = 2500;/.test(consent),
    'REGRESIÓN: cookieConsent debe esperar 2,5s antes del primer aviso (SHOW_DELAY_MS)'
  );
  assert.ok(
    /setTimeout\(showBanner,\s*SHOW_DELAY_MS\)/.test(consent),
    'REGRESIÓN: el auto-aviso va con setTimeout (el show() manual sigue siendo inmediato)'
  );
  assert.ok(
    consent.includes("classList.add('has-cookie-banner')") && consent.includes("classList.remove('has-cookie-banner')"),
    'REGRESIÓN: cookieConsent debe marcar body.has-cookie-banner al mostrar/ocultar'
  );
  assert.ok(
    /scangoCookieIn/.test(consent) && /cubic-bezier\(\.22,1,\.36,1\)/.test(consent),
    'REGRESIÓN: entrada única orquestada (keyframes scangoCookieIn, sin rebotes)'
  );
  assert.ok(
    /prefers-reduced-motion/.test(consent),
    'REGRESIÓN: la animación del banner debe respetar prefers-reduced-motion'
  );
  const indexCss = read('public/css/index.css');
  assert.ok(
    /body\.has-cookie-banner\s+\.whatsapp-float-container\s*\{\s*display:\s*none;/.test(indexCss),
    'REGRESIÓN: index.css debe OCULTAR el flotante de WhatsApp con el banner visible (subirlo solo mueve el solape a la demo)'
  );
  console.log('✓ Cookies: aviso con atraso de 2,5s, entrada única y chat sin solapes');

  // ---------- I: landing — un CTA primario, simulador honesto, tooltip que se
  // retira y nav hamburguesa móvil (QA en navegador + skill frontend-design) --
  const landingHtml = read('public/index.html');
  const landingJs = read('public/js/index.js');
  const heroActions = (landingHtml.match(/<div class="hero-actions">[\s\S]*?<\/div>/) || [''])[0];
  assert.ok(
    (heroActions.match(/btn-gold/g) || []).length === 1 && !heroActions.includes('btn-google'),
    'REGRESIÓN: el hero lleva UN solo CTA primario (Google es link secundario, no segundo botón)'
  );
  assert.ok(
    landingHtml.includes('class="hero-google-link"') && landingHtml.includes('data-js-click="startGoogleSignup"'),
    'REGRESIÓN: el acceso con Google sigue en el hero como link tranquilo (sin on*=)'
  );
  assert.ok(
    landingJs.includes('Carrito vacío') && landingJs.includes('Tocá + para agregar'),
    'REGRESIÓN: el simulador no muestra ($0) con el carrito vacío (indica agregar)'
  );
  assert.ok(
    /DOMContentLoaded[\s\S]*?updateSimUI\(\)/.test(landingJs),
    'REGRESIÓN: updateSimUI corre al cargar (el HTML estático trae el texto viejo con $0)'
  );
  assert.ok(
    consent.includes('pwaInstallBanner'),
    'REGRESIÓN: el instalador PWA también se oculta mientras decide (tapaba las cookies en móvil)'
  );
  assert.ok(
    landingJs.includes('wa-rested') && landingJs.includes('8000'),
    'REGRESIÓN: el cartelito de WhatsApp se retira solo a los 8s (vuelve al hover)'
  );
  assert.ok(
    /wa-rested:hover/.test(indexCss) && /wa-rested:focus-within/.test(indexCss),
    'REGRESIÓN: el cartelito retirado vuelve al hover/foco (no desaparece para siempre)'
  );
  assert.ok(
    landingHtml.includes('class="nav-burger"') && landingHtml.includes('data-js-click="toggleMobileNav|this"'),
    'REGRESIÓN: la landing tiene botón hamburguesa con data-js-* (sin on*=)'
  );
  assert.ok(
    landingHtml.includes('aria-controls="mobileNav"') || landingHtml.includes('aria-expanded="false"'),
    'REGRESIÓN: la hamburguesa expone estado accesible (aria-expanded)'
  );
  assert.ok(
    landingJs.includes('function toggleMobileNav') && landingJs.includes("key === 'Escape'"),
    'REGRESIÓN: toggleMobileNav existe y Escape cierra el panel móvil'
  );
  assert.ok(
    /@media\s*\(max-width:\s*900px\)[\s\S]*?\.nav-burger\s*\{\s*display:\s*inline-flex;/.test(indexCss),
    'REGRESIÓN: la hamburguesa solo aparece en ≤900px'
  );
  assert.ok(
    /\.site-header\.nav-open\s+\.main-nav\s*\{/.test(indexCss),
    'REGRESIÓN: el panel móvil muestra los links con .nav-open'
  );
  console.log('✓ Landing: un CTA primario, simulador sin ($0), tooltip que se retira y nav hamburguesa móvil');

  // ---------- J: botón "Volver" de las páginas legales ----------
  // Bug real: las 5 páginas de public/legal/ hardcodeaban "Volver al Panel" con
  // href="/studio"; un visitante que llegaba desde la landing, Google o un link
  // directo terminaba en el panel. El HTML trae el default seguro "/" y el
  // script externo solo mejora a /studio cuando el referrer same-origin es
  // /studio o /studio.html (dueño navegando dentro del panel).
  const legalBackPages = [
    'public/legal/privacy.html',
    'public/legal/terms.html',
    'public/legal/cookies.html',
    'public/legal/refunds.html',
    'public/legal/disclaimer.html',
    'public/privacidad.html',
    'public/terminos.html'
  ];

  for (const rel of legalBackPages) {
    const html = read(rel);
    const backTag = (html.match(/<a\b[^>]*\bdata-legal-back\b[^>]*>[\s\S]*?<\/a>/i) || [])[0] || '';
    assert.ok(backTag, `${rel}: falta el botón con data-legal-back`);
    assert.ok(
      /href\s*=\s*["']\/["']/.test(backTag),
      `${rel}: el default sin JS debe ser href="/" (nunca /studio)`
    );
    assert.ok(
      /Volver al inicio/i.test(backTag),
      `${rel}: el label default debe ser "Volver al inicio"`
    );
    assert.ok(
      !/href\s*=\s*["']\/studio(?:\/|\.html)?["']/i.test(backTag),
      `${rel}: el botón no debe hardcodear /studio`
    );

    const scriptTag = (html.match(/<script\b[^>]*\bsrc\s*=\s*["']\/js\/legalBack\.js["'][^>]*><\/script>/i) || [])[0] || '';
    assert.ok(scriptTag, `${rel}: falta el script externo CSP-safe /js/legalBack.js`);
    assert.ok(/\bdefer\b/i.test(scriptTag), `${rel}: legalBack.js debe cargarse con defer`);
  }

  const legalBack = require(path.join(root, 'public/js/legalBack.js'));
  const legalOrigin = 'https://www.scango.uy';
  const legalBackCases = [
    ['https://www.scango.uy/studio', 'studio'],
    ['https://www.scango.uy/studio/', 'studio'],
    ['https://www.scango.uy/studio?tab=billing', 'studio'],
    ['https://www.scango.uy/studio.html', 'studio'],
    ['https://www.scango.uy/studio.html?x=1', 'studio'],
    ['https://www.scango.uy/', 'home'],
    ['https://www.scango.uy/privacidad', 'home'],
    ['https://www.scango.uy/terminos.html', 'home'],
    ['https://www.google.com/', 'home'],
    ['https://www.scango.uy.evil.com/studio', 'home'],
    ['//evil.example/studio', 'home'],
    ['javascript:alert(1)', 'home'],
    ['', 'home']
  ];
  for (const [referrer, expected] of legalBackCases) {
    assert.strictEqual(
      legalBack.resolveLegalBackTarget(referrer, legalOrigin),
      expected,
      `legalBack: ${JSON.stringify(referrer)} debe resolver ${expected}`
    );
  }
  assert.strictEqual(
    legalBack.resolveLegalBackTarget('https://www.scango.uy/studio', ''),
    'home',
    'legalBack: sin origin no se puede confiar en el referrer'
  );

  const fakeAnchor = {
    attrs: {},
    textContent: '',
    setAttribute(name, value) {
      this.attrs[name] = value;
    }
  };
  legalBack.applyLegalBack(fakeAnchor, 'studio');
  assert.strictEqual(fakeAnchor.attrs.href, '/studio');
  assert.strictEqual(fakeAnchor.textContent, '← Volver al panel');
  assert.strictEqual(fakeAnchor.attrs['data-legal-back-target'], 'studio');
  legalBack.applyLegalBack(fakeAnchor, 'home');
  assert.strictEqual(fakeAnchor.attrs.href, '/');
  assert.strictEqual(fakeAnchor.textContent, '← Volver al inicio');
  assert.strictEqual(fakeAnchor.attrs['data-legal-back-target'], 'home');

  console.log(`✓ Legal: ${legalBackPages.length} páginas con default "/" y decisión por referrer same-origin /studio`);

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE ESTRUCTURA FRONTEND PASARON AL 100%!');
}

try {
  runFrontendStructureTests();
  process.exit(0);
} catch (err) {
  console.error('❌ Falló:', err.message);
  process.exit(1);
}
