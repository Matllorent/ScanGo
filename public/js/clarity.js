/**
 * public/js/clarity.js
 * ─────────────────────
 * Microsoft Clarity (grabaciones + mapas de calor) con consentimiento
 * (Ley 18.331): el tag SOLO se inyecta si el visitante aceptó terceros
 * (`scango_cookie_consent === 'all'`) y hay un ID real en
 * <meta name="scango-clarity-id">. Sin ID (meta vacío) o sin aceptación →
 * no-op honesto: cero tráfico a Microsoft. Escucha el evento
 * `scango:consent-all` por si el consentimiento llega después de cargar.
 * Script clásico (sin imports) para usarlo desde cualquier página.
 * Sin atributos on* (CSP script-src-attr 'none'): todo con addEventListener.
 */
(function () {
  'use strict';

  var loaded = false;

  function getId() {
    try {
      var m = document.querySelector('meta[name="scango-clarity-id"]');
      var id = m && (m.getAttribute('content') || '').trim();
      // Placeholders nunca cargan (evita el tag roto a TU_CLARITY_ID).
      if (!id || /TU_CLARITY_ID|REEMPLAZAR|TU_ID|XXXX/i.test(id)) return '';
      return id;
    } catch (e) {
      return '';
    }
  }

  function hasThirdPartyConsent() {
    try {
      if (window.CookieConsent && typeof window.CookieConsent.hasThirdPartyConsent === 'function') {
        return window.CookieConsent.hasThirdPartyConsent();
      }
      return window.localStorage.getItem('scango_cookie_consent') === 'all';
    } catch (e) {
      return false;
    }
  }

  function inject(id) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r);
      t.async = 1;
      t.src = 'https://www.clarity.ms/tag/' + encodeURIComponent(i);
      y = l.getElementsByTagName(r)[0];
      y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', id);
  }

  function tryInit() {
    if (loaded) return true;
    var id = getId();
    if (!id || !hasThirdPartyConsent()) return false;
    try {
      inject(id);
      loaded = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  window.ClarityLoader = {
    tryInit: tryInit,
    isLoaded: function () { return loaded; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
  window.addEventListener('scango:consent-all', tryInit);
})();
