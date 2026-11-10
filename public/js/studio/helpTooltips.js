/**
 * public/js/studio/helpTooltips.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sistema ligero de ayuda contextual (tooltips) para configuraciones
 * complejas del Studio.
 *
 * Uso: poner un icono "i" con el atributo `data-js-help="texto de ayuda"` al
 * lado de cualquier campo. Al pasar el mouse o dar foco se muestra un popover
 * breve que orienta al dueño sin saturar la interfaz.
 *
 * Reglas del proyecto:
 *  - Cero atributos `on*=` (CSP script-src-attr 'none').
 *  - Se comunica mediante `data-js-*` + delegación de eventos en document.
 *  - Auto-ocultación tras 9 s y cierre al hacer clic en cualquier lado.
 */

(function () {
  'use strict';

  const TOOLTIP_ID = 'scango-help-tooltip';
  let hideTimer = null;

  function getTooltipEl() {
    let el = document.getElementById(TOOLTIP_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOOLTIP_ID;
      el.setAttribute('role', 'tooltip');
      el.style.cssText =
        'position:fixed; z-index:5000; max-width:260px; padding:8px 10px; ' +
        'border-radius:8px; background:var(--bg-base,#16201c); color:#fff; ' +
        'font-size:11px; line-height:1.4; border:1px solid var(--border, rgba(255,255,255,0.12)); ' +
        'box-shadow:0 8px 24px rgba(0,0,0,0.35); pointer-events:none; opacity:0; ' +
        'transform:translateY(4px); transition:opacity .15s ease, transform .15s ease; ' +
        'white-space:normal; text-align:left;';
      document.body.appendChild(el);
    }
    return el;
  }

  function position(target, el) {
    const rect = target.getBoundingClientRect();
    const above = rect.top - 10;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - 130, 8), window.innerWidth - 268);
    el.style.top = (above < 8 ? rect.bottom + 8 : above) + 'px';
    el.style.left = left + 'px';
  }

  function show(target, text) {
    hide();
    const el = getTooltipEl();
    el.textContent = text;
    position(target, el);
    el.style.transform = 'translateY(0)';
    el.style.opacity = '1';
    hideTimer = setTimeout(hide, 9000);
  }

  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const el = document.getElementById(TOOLTIP_ID);
    if (el) el.style.opacity = '0';
  }

  document.addEventListener('mouseenter', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const el = t.closest('[data-js-help]');
    if (!el) return;
    show(el, el.getAttribute('data-js-help'));
  }, true);

  document.addEventListener('mouseleave', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const el = t.closest('[data-js-help]');
    if (!el) return;
    hide();
  }, true);

  document.addEventListener('focus', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const el = t.closest('[data-js-help]');
    if (!el) return;
    show(el, el.getAttribute('data-js-help'));
  }, true);

  document.addEventListener('blur', hide, true);
  document.addEventListener('click', hide);

  window.showHelpTooltip = show;
  window.hideHelpTooltip = hide;
})();
