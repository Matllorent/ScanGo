/**
 * public/js/legalBack.js
 * Botón "Volver" de las páginas legales.
 *
 * Antes todas las páginas de public/legal/ hardcodeaban "← Volver al Panel"
 * con href="/studio": un visitante que llegaba desde la landing, Google o un
 * link directo terminaba en el panel de un producto que quizá ni conocía.
 *
 * Regla (sin forzar nunca /studio):
 *  - Si el referrer es del MISMO origen y su path es /studio o /studio.html
 *    (el dueño navegando dentro del panel, con o sin sesión activa porque el
 *    panel resuelve el login), el botón dice "← Volver al panel" y va a /studio.
 *  - En cualquier otro caso (landing, menú, búsqueda, referrer externo, vacío
 *    o inválido) el botón dice "← Volver al inicio" y va a /.
 *
 * El HTML trae SIEMPRE el default seguro (href="/" + "Volver al inicio"), así
 * que sin JS o si el navegador oculta el referrer el visitante nunca cae en
 * /studio por accidente. No se consulta la sesión ni se guarda nada: la
 * decisión es local y no agrega requests ni datos personales a una página
 * legal. CSP-safe: script externo same-origin, cero atributos on*= y cero
 * scripts inline (no requiere regenerar hashes).
 */
(function (global, factory) {
  'use strict';

  var api = factory();

  if (typeof module === 'object' && module.exports) module.exports = api;

  if (global) {
    global.ScangoLegalBack = api;
    if (global.document) {
      if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', function () {
          api.init(global.document, global.location);
        });
      } else {
        api.init(global.document, global.location);
      }
    }
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var TARGETS = {
    home: { href: '/', label: '← Volver al inicio' },
    studio: { href: '/studio', label: '← Volver al panel' }
  };

  function normalizePath(pathname) {
    var path = String(pathname || '/');
    while (path.length > 1 && path.charAt(path.length - 1) === '/') {
      path = path.slice(0, -1);
    }
    return path || '/';
  }

  /**
   * Decisión pura y testeable. Devuelve 'studio' SOLO para un referrer
   * same-origin que sea exactamente /studio o /studio.html.
   */
  function resolveLegalBackTarget(referrer, origin) {
    if (!referrer || !origin) return 'home';
    try {
      var url = new URL(referrer, origin);
      if (url.origin !== origin) return 'home';
      var path = normalizePath(url.pathname);
      return path === '/studio' || path === '/studio.html' ? 'studio' : 'home';
    } catch (err) {
      return 'home';
    }
  }

  function applyLegalBack(anchor, target) {
    if (!anchor || typeof anchor.setAttribute !== 'function') return;
    var key = target === 'studio' ? 'studio' : 'home';
    var config = TARGETS[key];
    anchor.setAttribute('href', config.href);
    anchor.textContent = config.label;
    anchor.setAttribute('data-legal-back-target', key);
  }

  function init(doc, loc) {
    if (!doc || !loc) return;
    var anchors = doc.querySelectorAll('[data-legal-back]');
    if (!anchors || typeof anchors.length !== 'number') return;
    var referrer = doc.referrer || '';
    var origin = loc.origin || '';
    var target = resolveLegalBackTarget(referrer, origin);
    for (var i = 0; i < anchors.length; i += 1) {
      applyLegalBack(anchors[i], target);
    }
  }

  return {
    TARGETS: TARGETS,
    resolveLegalBackTarget: resolveLegalBackTarget,
    applyLegalBack: applyLegalBack,
    init: init
  };
});
