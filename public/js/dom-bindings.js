/**
 * public/js/dom-bindings.js
 * Binder de eventos delegados para handlers inline convertidos a atributos data-js-*.
 *
 * MOTIVACIÓN (CSP estricto): el menú público (/m/*) usa Content-Security-Policy
 * estricta (script-src-attr 'none'), que BLOQUEA los atributos onclick/onchange/etc.
 * Este archivo (servido desde 'self', permitido por la CSP) re-ata los handlers
 * mediante delegación de eventos a nivel documento:
 *
 *   <button onclick="openCartModal()">            →  <button data-js-click="openCartModal">
 *   <button onclick="selectCategory('ALL')">      →  <button data-js-click="selectCategory|ALL">
 *   <input onchange="handleMozoVirtualToggle(this.checked)">
 *                                                →  <input data-js-change="handleMozoVirtualToggle|this.checked">
 *   <form onsubmit="submitReservation(event)">   →  <form data-js-submit="submitReservation|event">
 *   <div onclick="if(event.target===this)closeX()">
 *                                                →  <div data-js-click-backdrop="closeX">
 *   <button onclick="document.getElementById('f').click()">
 *                                                →  <button data-js-click="fireClick|f">
 *   <button onclick="this.style.color='#EF4444'"> →  <button data-js-click-style-color="#EF4444">
 *
 * ARGS (separados por |):
 *   event        → el objeto Event
 *   this         → el elemento que disparó (equivalente a `this`)
 *   this.ruta    → propiedad anidada del elemento (p.ej. this.dataset.dishId, this.checked)
 *   123 / 1.5    → número
 *   true / false → booleano
 *   resto        → string literal (o token de template ${...} ya interpolado)
 *
 * La delegación en `document` con `closest()` funciona también para nodos creados
 * dinámicamente (innerHTML) sin necesidad de re-binding ni MutationObserver.
 *
 * REGLA PARA CÓDIGO NUEVO: NUNCA escribir atributos on*= en HTML/JS del menú
 * (violación CSP). Usar data-js-* + este binder.
 */
(function () {
  'use strict';

  var BIND = {
    click: 'data-js-click',
    submit: 'data-js-submit',
    input: 'data-js-input',
    change: 'data-js-change',
    keydown: 'data-js-keydown',
    focus: 'data-js-focus',
    blur: 'data-js-blur',
    paste: 'data-js-paste',
    mouseover: 'data-js-mouseover',
    mouseout: 'data-js-mouseout'
  };

  function resolvePath(root, path) {
    return path.split('.').reduce(function (o, k) {
      if (o == null) return undefined;
      k = k.replace(/\?$/, ''); // optional chaining: A?.B
      return o[k];
    }, root);
  }

  function getArg(el, ev, token) {
    if (token === 'event') return ev;
    if (token === 'this') return el;
    if (token.indexOf('this.') === 0) return resolvePath(el, token.slice(5));
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    if (token === 'true') return true;
    if (token === 'false') return false;
    return token;
  }

  function runSpec(spec, el, ev) {
    if (!spec) return;
    var parts = spec.split('|');
    var fnPath = parts[0];
    if (fnPath === 'preventDefault') { ev.preventDefault(); return; }
    if (fnPath === 'fireClick') {
      var target = document.getElementById(parts[1]);
      if (target) target.click();
      return;
    }
    if (fnPath === 'reloadPage') { window.location.reload(); return; }
    var fn = resolvePath(window, fnPath);
    if (typeof fn !== 'function') return;
    var args = [];
    for (var i = 1; i < parts.length; i++) args.push(getArg(el, ev, parts[i]));
    if (el.tagName === 'A') ev.preventDefault();
    // Paths punteados (i18nManager.setLanguage) son llamadas de MÉTODO: el receiver
    // debe ser el objeto dueño (como el handler inline original), no el elemento.
    var receiver = el;
    var dot = fnPath.lastIndexOf('.');
    if (dot > 0) {
      var owner = resolvePath(window, fnPath.slice(0, dot));
      if (owner != null) receiver = owner;
    }
    fn.apply(receiver, args);
  }

  document.addEventListener('DOMContentLoaded', function () {
    Object.keys(BIND).forEach(function (type) {
      var attr = BIND[type];
      document.addEventListener(type, function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var el = t.closest('[' + attr + ']');
        if (!el) return;
        runSpec(el.getAttribute(attr), el, e);
      });
    });

    // Backdrop: onclick="if(event.target===this)closeX()" → data-js-click-backdrop="closeX"
    // Se dispara solo cuando el click apunta al overlay mismo, no a sus hijos.
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var el = t.closest('[data-js-click-backdrop]');
      if (!el || e.target !== el) return;
      runSpec(el.getAttribute('data-js-click-backdrop'), el, e);
    });

    // onerror="this.style.display='none'" → data-js-error-style-display="none"
    // onerror="fn(this)"                  → data-js-error-fn="fn" (fn recibe el elemento como `this`)
    // El evento error de recursos NO burbujea → listener en fase capture sobre document.
    document.addEventListener('error', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var styleEl = t.closest('[data-js-error-style-display]');
      if (styleEl) styleEl.style.display = styleEl.getAttribute('data-js-error-style-display');
      var fnEl = t.closest('[data-js-error-fn]');
      if (fnEl) {
        var fn = resolvePath(window, fnEl.getAttribute('data-js-error-fn'));
        if (typeof fn === 'function') fn.call(fnEl, e);
      }
    }, true);

    // data-js-<tipo>-style-<prop>: se aplica el.style[prop]=valor EN ese evento.
    //   onclick="this.style.color='X'"     → data-js-click-style-color="X"
    //   onmouseover="this.style.color='X'" → data-js-mouseover-style-color="X"
    //   (onerror va al listener de capture de arriba: data-js-error-style-display)
    var STYLE_PROPS = ['color', 'display'];
    ['click', 'mouseover', 'mouseout'].forEach(function (type) {
      STYLE_PROPS.forEach(function (prop) {
        var attr = 'data-js-' + type + '-style-' + prop;
        document.addEventListener(type, function (e) {
          var t = e.target;
          if (!t || !t.closest) return;
          var el = t.closest('[' + attr + ']');
          if (!el) return;
          el.style[prop] = el.getAttribute(attr);
        });
      });
    });
  });
})();