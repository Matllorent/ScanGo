/**
 * tests/test-a11y.js — Guard de accesibilidad (WCAG 2.1 nivel AA) del frontend.
 *
 * Es un guard de FUENTE (estilo house: test-frontend-structure/test-csp), sin DOM:
 * escanea todo public/**\/*.html + los módulos JS/CSS que dan estado accesible.
 * Complementa la verificación real en navegador (Playwright) con la regresión
 * determinista que corre en cada `npm test`.
 *
 * Cubre:
 *   A) Estructura por página: lang="es", UN landmark <main>, sin tabindex
 *      positivo, <img alt> siempre presente, orden de encabezados sin saltos,
 *      sin ids duplicados.
 *   B) Modales: cada .modal-overlay expone role=dialog + aria-modal="true" y un
 *      nombre accesible (aria-label o aria-labelledby a un id existente).
 *   C) Clickables no nativos (data-js-click en div/span/…): role + tabindex.
 *   D) Campos: todo input/select/textarea tiene nombre accesible (label for,
 *      envoltura implícita, aria-label/labelledby/title) y ningún label[for]
 *      apunta a un id inexistente.
 *   E) Nombres accesibles de íconos-botón (botón vacío ⇒ aria-label/title).
 *   F) Estado accesible dinámico en JS: aria-expanded (FAQ), aria-selected
 *      (pestañas de auth), aria-pressed (estrellas de reseña), live region del
 *      carrito, y el enhancer de modales compartido por el menú y el Studio
 *      (foco/Escape/aria-hidden).
 *   G) Utilidades CSS: :focus-visible y .sr-only en las 3 hojas; .skip-link en
 *      las 4 páginas principales.
 *   H) Skip-link presente y apuntando a un destino focusable (tabindex="-1").
 *
 * Falla si alguien vuelve a introducir una regresión; no requiere navegador.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function walkHtml(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(p, acc);
    else if (/\.html$/i.test(entry.name)) acc.push(p);
  }
  return acc;
}

/** Quita comentarios, <script> y <style> para analizar solo el marcado. */
function markupOnly(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
}

/** Quita comentarios (para análisis sobre el marcado completo). */
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

const NATIVE_ACTIVATABLE = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'summary',
  'option',
  'label'
]);

const FIELD_RE = /<(input|select|textarea)\b([^>]*)>/gi;
const NON_LABEL_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);

function runA11yTests() {
  console.log('♿ Iniciando guard de accesibilidad (WCAG AA) del frontend ...');

  const htmlFiles = walkHtml(publicDir);
  assert.ok(htmlFiles.length >= 14, `Se esperaban al menos 14 HTML en public/, se hallaron ${htmlFiles.length}`);

  const allProblems = [];

  // ---------------------------------------------------------------- A, B, C, E
  for (const abs of htmlFiles) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    const raw = stripComments(fs.readFileSync(abs, 'utf8'));
    const markup = markupOnly(raw);
    const problems = [];

    // A.1) lang="es"
    if (!/<html[^>]*\blang\s*=\s*["']es["']/i.test(raw)) {
      problems.push(`${rel}: <html> debe declarar lang="es"`);
    }

    // A.2) exactamente un landmark <main> (o role="main")
    const mainOpen = (markup.match(/<main\b/gi) || []).length;
    const mainRole = (markup.match(/\brole\s*=\s*["']main["']/gi) || []).length;
    if (mainOpen + mainRole !== 1) {
      problems.push(`${rel}: debe haber exactamente 1 landmark <main> (o role="main"); hay ${mainOpen + mainRole}`);
    }

    // A.3) sin tabindex positivo
    for (const m of markup.matchAll(/\btabindex\s*=\s*["'](\d+)["']/gi)) {
      if (Number(m[1]) > 0) problems.push(`${rel}: tabindex positivo (${m[1]}) rompe el orden natural de foco`);
    }

    // A.4) todo <img> con alt (aunque sea vacío para decorativas)
    for (const m of markup.matchAll(/<img\b([^>]*)>/gi)) {
      if (!/\balt\s*=/i.test(m[1])) problems.push(`${rel}: <img> sin atributo alt`);
    }

    // A.5) orden de encabezados sin saltos (h2→h4, etc.)
    let prev = 0;
    for (const m of markup.matchAll(/<h([1-6])\b/gi)) {
      const level = Number(m[1]);
      if (prev && level > prev + 1) problems.push(`${rel}: salto de encabezado h${prev} → h${level}`);
      prev = level;
    }

    // A.6) sin ids duplicados
    const ids = [...markup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
    if (dupes.length) problems.push(`${rel}: ids duplicados: ${dupes.join(', ')}`);

    // B) modales: cada contenedor de modal → role=dialog + aria-modal + nombre accesible.
    //    El rol puede estar en el overlay (menú) o en la caja interna (studio/index/admin).
    const idSet = new Set(ids);
    const modalOpens = [
      ...markup.matchAll(
        /<[a-z][a-z0-9]*\b[^>]*(?:class\s*=\s*["'][^"']*modal-overlay[^"']*["']|id\s*=\s*["']inviteModal["'])[^>]*>/gi
      )
    ];
    for (let i = 0; i < modalOpens.length; i++) {
      const start = modalOpens[i].index;
      const end = i + 1 < modalOpens.length ? modalOpens[i + 1].index : markup.length;
      const seg = markup.slice(start, end);
      const dialogTag = seg.match(/<[^>]*\brole\s*=\s*["'](?:dialog|alertdialog)["'][^>]*>/i);
      if (!dialogTag) {
        problems.push(`${rel}: un contenedor de modal sin role="dialog" (${modalOpens[i][0].slice(0, 60)}…)`);
        continue;
      }
      if (!/\baria-modal\s*=\s*["']true["']/i.test(dialogTag[0])) {
        problems.push(`${rel}: el modal #${i + 1} no declara aria-modal="true"`);
      }
      const hasLabel = /\baria-label\s*=/i.test(dialogTag[0]);
      const labelledBy = (dialogTag[0].match(/\baria-labelledby\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (!hasLabel && !labelledBy) {
        problems.push(`${rel}: el modal #${i + 1} no tiene nombre accesible (aria-label/aria-labelledby)`);
      } else if (labelledBy && !idSet.has(labelledBy.trim())) {
        problems.push(`${rel}: aria-labelledby="${labelledBy}" no apunta a ningún id existente`);
      }
    }

    // C) clickables no nativos con data-js-click → role + tabindex
    for (const m of markup.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
      const tag = m[1].toLowerCase();
      const attrs = m[2];
      if (!/data-js-click\s*=/.test(attrs)) continue;
      const hasRole = /\brole\s*=/.test(attrs);
      const hasTabindex = /\btabindex\s*=/.test(attrs);
      if (!NATIVE_ACTIVATABLE.has(tag) && (!hasRole || !hasTabindex)) {
        problems.push(`${rel}: <${tag}> con data-js-click necesita role y tabindex (no es un control nativo)`);
      }
    }

    // E) botones sin nombre accesible (íconos-botón): contenido vacío ⇒ aria-label/title
    for (const m of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const attrs = m[1];
      const inner = m[2];
      const named = /\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/i.test(attrs);
      const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      if (named || type === 'submit' || type === 'reset') continue;
      // texto visible (quitando tags, entidades, espacios y emojis)
      const text = inner
        .replace(/<[^>]*>/g, '')
        .replace(/&[a-z#0-9]+;/gi, '')
        .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]/gu, '')
        .trim();
      if (!text) problems.push(`${rel}: <button> sin nombre accesible (vacío y sin aria-label/title)`);
    }

    allProblems.push(...problems);
  }

  assert.deepStrictEqual(
    allProblems,
    [],
    `Problemas de accesibilidad (WCAG AA):\n  - ${allProblems.join('\n  - ')}`
  );
  console.log(`✓ Estructura/ARIA de ${htmlFiles.length} HTML: lang, <main> único, sin tabindex positivo, img alt, encabezados, ids únicos, modales y botones`);

  // ------------------------------------------------------------------ D) Campos
  const fieldProblems = [];
  for (const abs of htmlFiles) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    const markup = markupOnly(fs.readFileSync(abs, 'utf8'));
    const labelled = new Set(
      [...markup.matchAll(/<label[^>]*\bfor\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
    );
    const ids = new Set([...markup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));

    // D.1) label[for] siempre apunta a un id real
    for (const id of labelled) {
      if (!ids.has(id)) fieldProblems.push(`${rel}: <label for="${id}"> apunta a un id inexistente`);
    }

    // D.2) todo campo tiene nombre accesible
    for (const m of markup.matchAll(FIELD_RE)) {
      const tag = m[1].toLowerCase();
      const attrs = m[2];
      const type = ((attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
      if (NON_LABEL_TYPES.has(type)) continue;
      const idM = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
      const id = idM ? idM[1] : null;
      const named = /\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/i.test(attrs);
      const forOk = id && labelled.has(id);
      // envoltura implícita: el último <label> abierto no fue cerrado antes del campo
      const before = markup.slice(0, m.index);
      const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
      if (!named && !forOk && !wrapped) {
        fieldProblems.push(`${rel}: <${tag} id="${id || '(sin id)'}"> (type=${type || 'text'}) sin nombre accesible`);
      }
    }
  }
  assert.deepStrictEqual(
    fieldProblems,
    [],
    `Campos sin nombre accesible o labels colgantes:\n  - ${fieldProblems.join('\n  - ')}`
  );
  console.log('✓ Campos: todo input/select/textarea con nombre accesible y sin label[for] colgantes');

  // -------------------------------------------------- F) Estado ARIA dinámico (JS)
  const indexJs = read('public/js/index.js');
  assert.ok(/function\s+toggleFaq\s*\(/.test(indexJs), 'index.js debe definir toggleFaq()');
  assert.ok(
    /aria-expanded/.test(indexJs),
    'REGRESIÓN: toggleFaq debe exponer aria-expanded en el acordeón de FAQ'
  );
  assert.ok(
    /aria-selected/.test(indexJs),
    'REGRESIÓN: switchAuthTab debe marcar la pestaña activa con aria-selected'
  );
  assert.ok(
    /addEventListener\(\s*['"]keydown['"]/.test(indexJs) && /['"]Escape['"]/.test(indexJs),
    'REGRESIÓN: los modales de la landing deben cerrarse con la tecla Escape'
  );
  assert.ok(
    /function\s+focusModal\s*\(/.test(indexJs) && /function\s+restoreModalFocus\s*\(/.test(indexJs),
    'REGRESIÓN: abrir/cerrar modales de la landing debe mover y restaurar el foco'
  );
  console.log('✓ index.js: FAQ (aria-expanded), tabs de auth (aria-selected), Escape + gestión de foco');

  const smartReviews = read('public/js/menu/smartReviews.js');
  assert.ok(
    /setAttribute\(\s*['"]aria-pressed['"]/.test(smartReviews),
    'REGRESIÓN: las estrellas de reseña deben reflejar la selección con aria-pressed'
  );
  console.log('✓ smartReviews.js: estrellas con aria-pressed');

  const menuJs = read('public/js/menu.js');
  assert.ok(
    /cartLiveAnnounce/.test(menuJs) && /getElementById\(['"]cartLiveAnnounce['"]\)/.test(menuJs),
    'REGRESIÓN: el carrito del menú debe anunciar cambios en la live region #cartLiveAnnounce'
  );
  console.log('✓ menu.js: live region del carrito (role=status) para lectores de pantalla');

  const menuHtml = stripComments(read('public/menu.html'));
  assert.ok(
    /aria-pressed=/.test(menuJs),
    'REGRESIÓN: los filtros del menú (categorías/dietas) deben exponer su estado con aria-pressed'
  );
  assert.ok(
    /id=["']categoryPills["'][^>]*role=["']group["']/.test(menuHtml) &&
      /id=["']dietaryFilterPills["'][^>]*role=["']group["']/.test(menuHtml),
    'Los grupos de pills del menú deben declarar role="group" con aria-label'
  );
  console.log('✓ menu.html/js: filtros agrupados (role=group) con estado aria-pressed');

  // Enhancer COMPARTIDO por el menú público y el Studio (accesibilidad de modales).
  const modalA11y = read('public/js/modalA11y.js');
  assert.ok(/export function initModalA11y/.test(modalA11y), 'modalA11y.js debe exportar initModalA11y()');
  assert.ok(/aria-hidden/.test(modalA11y), 'modalA11y.js debe sincronizar aria-hidden de los modales');
  assert.ok(/['"]Escape['"]/.test(modalA11y), 'modalA11y.js debe cerrar el modal con Escape');
  assert.ok(/['"]Tab['"]/.test(modalA11y), 'modalA11y.js debe atrapar el foco dentro del modal (Tab)');
  assert.ok(/MutationObserver/.test(modalA11y), 'modalA11y.js debe observar la apertura/cierre de modales');

  const studioJs = read('public/js/studio.js');
  assert.ok(
    /import\s*\{\s*initModalA11y\s*\}\s*from\s*['"]\.\/modalA11y\.js['"]/.test(studioJs) &&
      /initModalA11y\s*\(\s*\)/.test(studioJs),
    'REGRESIÓN: studio.js debe importar y ejecutar initModalA11y()'
  );
  assert.ok(
    /import\s*\{\s*initModalA11y\s*\}\s*from\s*['"]\.\/modalA11y\.js['"]/.test(menuJs) &&
      /initModalA11y\s*\(\s*\)/.test(menuJs),
    'REGRESIÓN: menu.js debe importar y ejecutar initModalA11y() (foco/Escape en los modales del menú)'
  );
  const menuModals = read('public/js/menu/menuModals.js');
  assert.ok(
    !/addEventListener\(\s*['"]keydown['"]/.test(menuModals),
    'menu/menuModals.js no debe manejar keydown (Escape) por duplicado: la fuente única es modalA11y.js'
  );
  // Modales creados en runtime: el enhancer debe cablearlos al agregarse/eliminarse
  // del DOM, y esos modales deben declarar role/aria-modal como los estáticos.
  assert.ok(
    /childList:\s*true/.test(modalA11y) && /addedNodes/.test(modalA11y) && /removedNodes/.test(modalA11y),
    'modalA11y.js debe cablear modales creados/eliminados en runtime (body childList + addedNodes/removedNodes)'
  );
  const loyaltyModalJs = read('public/js/components/LoyaltyRewardsModal.js');
  assert.ok(
    /setAttribute\(['"]role['"],\s*['"]dialog['"]\)/.test(loyaltyModalJs) && /aria-modal/.test(loyaltyModalJs),
    'El modal de fidelización (creado en JS) debe declarar role="dialog" + aria-modal'
  );
  const groupCartJs = read('public/js/components/GroupCartManager.js');
  assert.ok(
    /id="groupUserNameModal"[^>]*role="dialog"[^>]*aria-modal/.test(groupCartJs),
    'El modal de nombre del comensal (creado en JS) debe declarar role="dialog" + aria-modal'
  );
  console.log('✓ modalA11y.js (menú + Studio): foco inicial/restaurado, Escape, trampa de Tab y aria-hidden, incl. modales dinámicos');

  // --------------------------------------------------------------- G) Utilidades CSS
  const cssExpectations = [
    ['public/css/index.css', ':focus-visible', '.sr-only'],
    ['public/css/menu.css', ':focus-visible', '.sr-only'],
    ['public/css/studio.css', ':focus-visible', '.sr-only']
  ];
  for (const [file, focus, srOnly] of cssExpectations) {
    const css = read(file);
    assert.ok(css.includes(focus), `${file} debe definir ${focus} (WCAG 2.4.7)`);
    assert.ok(css.includes(srOnly), `${file} debe definir ${srOnly} (texto solo para lectores)`);
  }
  const adminCss = read('public/admin.html');
  assert.ok(adminCss.includes(':focus-visible'), 'admin.html debe definir :focus-visible');
  assert.ok(adminCss.includes('.sr-only'), 'admin.html debe definir .sr-only');
  console.log('✓ CSS: :focus-visible + .sr-only en index/menu/studio y admin');

  // -------------------------------------------------------- H) Skip-link accesible
  const skipPages = [
    ['public/index.html', 'main-content'],
    ['public/menu.html', 'main-content'],
    ['public/studio.html', 'tab-content-scroll'],
    ['public/admin.html', 'main-content']
  ];
  for (const [file, target] of skipPages) {
    const html = stripComments(read(file));
    assert.ok(
      /class=["'][^"']*skip-link/.test(html),
      `${file} debe incluir un .skip-link (WCAG 2.4.1)`
    );
    assert.ok(
      new RegExp(`id=["']${target}["'][^>]*tabindex=["']-1["']`).test(html),
      `El destino del skip-link #${target} en ${file} debe existir con tabindex="-1"`
    );
    assert.ok(
      new RegExp(`href=["']#${target}["']`).test(html),
      `El skip-link de ${file} debe apuntar a #${target}`
    );
  }
  assert.ok(
    read('public/css/studio.css').includes('.skip-link') && read('public/css/index.css').includes('.skip-link'),
    'Las hojas de index/studio deben estilizar .skip-link'
  );
  console.log('✓ Skip-link en landing, menú, Studio y Admin, con destino focusable (tabindex="-1")');

  console.log('\n🎉 GUARD DE ACCESIBILIDAD (WCAG AA): TODO EN VERDE');
}

try {
  runA11yTests();
  process.exit(0);
} catch (err) {
  console.error('❌ Falló:', err.message);
  process.exit(1);
}
