/**
 * public/js/cookieConsent.js
 * ──────────────────────────
 * Banner de consentimiento de cookies (Ley 18.331 UY + estándar internacional):
 * - Necesarias (sesión httpOnly, preferencias): siempre activas.
 * - Terceros (Google GIS, Turnstile): solo con aceptación explícita.
 * Sin atributos on* (CSP script-src-attr 'none'): todo con addEventListener.
 * Script clásico (sin imports) para usarlo desde cualquier página.
 */
(function () {
  'use strict';

  var KEY = 'scango_cookie_consent';
  var BANNER_ID = 'scangoCookieBanner';

  function getConsent() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  function hasThirdPartyConsent() {
    return getConsent() === 'all';
  }

  function setConsent(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (e) { /* storage bloqueado: se pregunta de nuevo */ }
    hideBanner();
    // Avisa a los cargadores diferidos (Clarity, etc.): solo actúan con 'all'.
    try {
      window.dispatchEvent(new CustomEvent('scango:consent', { detail: { consent: value } }));
      if (value === 'all') window.dispatchEvent(new CustomEvent('scango:consent-all'));
    } catch (e) { /* CustomEvent no disponible: los loaders reintentan al cargar */ }
  }

  function hideBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.remove();
  }

  function showBanner() {
    if (document.getElementById(BANNER_ID)) return;
    if (getConsent() !== null) return;
    var bar = document.createElement('div');
    bar.id = BANNER_ID;
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Aviso de cookies');
    bar.style.cssText = 'position:fixed; left:12px; right:12px; bottom:12px; z-index:99990;'
      + 'background:#141d1a; border:1px solid rgba(225,169,56,0.4); border-radius:12px;'
      + 'padding:12px 14px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;'
      + 'box-shadow:0 12px 32px rgba(0,0,0,0.5); font-size:0.8rem; color:#D1DDD9;';
    var text = document.createElement('div');
    text.style.cssText = 'flex:1; min-width:220px;';
    text.textContent = 'Usamos cookies necesarias para la sesión y, si aceptás, las de terceros (Google, control anti-robots, medición de uso). ';
    var policy = document.createElement('a');
    policy.href = '/cookies';
    policy.textContent = 'Ver política';
    policy.style.cssText = 'color:#E1A938; text-decoration:underline;';
    text.appendChild(policy);
    text.appendChild(document.createTextNode('.'));
    var btnAll = document.createElement('button');
    btnAll.type = 'button';
    btnAll.textContent = 'Aceptar todas';
    btnAll.style.cssText = 'background:#E1A938; color:#101614; border:none; border-radius:8px; padding:8px 14px; font-weight:800; cursor:pointer;';
    btnAll.addEventListener('click', function () { setConsent('all'); });
    var btnMin = document.createElement('button');
    btnMin.type = 'button';
    btnMin.textContent = 'Solo necesarias';
    btnMin.style.cssText = 'background:transparent; color:#D1DDD9; border:1px solid rgba(255,255,255,0.25); border-radius:8px; padding:8px 14px; font-weight:700; cursor:pointer;';
    btnMin.addEventListener('click', function () { setConsent('necessary'); });
    bar.appendChild(text);
    bar.appendChild(btnAll);
    bar.appendChild(btnMin);
    document.body.appendChild(bar);
  }

  function reshow() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    showBanner();
  }

  window.CookieConsent = {
    get: getConsent,
    hasThirdPartyConsent: hasThirdPartyConsent,
    show: showBanner,
    reshow: reshow
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner);
  } else {
    showBanner();
  }
})();
