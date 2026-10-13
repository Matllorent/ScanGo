/**
 * public/js/modalA11y.js
 *
 * Accesibilidad de modales (WCAG 2.1: 2.1.2 sin trampa de foco, 2.4.3 orden de
 * foco, 4.1.2 nombre/rol/valor). Módulo COMPARTIDO por el menú público
 * (`menu.js`) y el Studio (`studio.js`).
 *
 * Ambas páginas abren sus modales agregando `.active` a un `.modal-overlay`
 * (o cambiando su `style.display`). Este módulo observa esos cambios y:
 *   - mantiene `aria-hidden` del overlay sincronizado con su visibilidad real;
 *   - al abrir, mueve el foco al primer control del diálogo;
 *   - al cerrar, devuelve el foco al disparador anterior;
 *   - encierra el foco dentro del modal abierto (Tab cicla, no escapa);
 *   - cierra el modal visible más alto con Escape (clic en su botón de cierre;
 *     si no hay, clic en el propio overlay cuando es backdrop).
 *
 * Los modales pueden ser ESTÁTICOS (en el HTML) o creados en runtime (armador de
 * helado, fidelización, pedido grupal del menú). Por eso también observa el
 * `body` y cablea los `.modal-overlay` que se agregan o eliminan después.
 *
 * Es genérico y no intrusivo: no requiere tocar cada función open/close.
 * Idempotente: si ya se cableó, no vuelve a hacerlo.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

// Botón de cierre del modal: `data-js-click="closeX"` (menú/Studio estáticos),
// `data-js-click="algo.close"` (fidelización) o la ✕ con clase `.modal-close`
// (armador de helado). Nunca se aterriza el foco en él al abrir.
const CLOSER_SELECTOR = '.modal-close, [data-js-click^="close"], [data-js-click$=".close"]';

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false });
  }
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function focusablesWithin(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
}

/**
 * Cablea la accesibilidad de todos los `.modal-overlay` de la página, presentes
 * ahora o agregados después. Idempotente: si ya se cableó, no vuelve a hacerlo.
 */
export function initModalA11y() {
  if (typeof document === 'undefined') return;
  if (window.__modalA11yReady) return;
  window.__modalA11yReady = true;

  const overlays = new Set();
  let opener = null;
  let activeOverlay = null;

  const openOverlays = () => Array.from(overlays).filter(isVisible);
  const topModal = () => {
    const open = openOverlays();
    if (!open.length) return null;
    return open.find((o) => o.contains(document.activeElement)) || open[open.length - 1];
  };

  function dialogBox(overlay) {
    return overlay.querySelector('[role="dialog"]') || overlay;
  }

  function handleOpen(overlay) {
    if (activeOverlay === overlay) return;
    if (!activeOverlay || !activeOverlay.isConnected) opener = document.activeElement;
    activeOverlay = overlay;
    overlay.setAttribute('aria-hidden', 'false');
    // Aterrizar en el primer control útil (no en la ✕) para no perder contexto.
    const focusables = focusablesWithin(dialogBox(overlay));
    const target =
      focusables.find((el) => !el.matches(CLOSER_SELECTOR)) || focusables[0] || dialogBox(overlay);
    if (target && !overlay.contains(document.activeElement)) {
      setTimeout(() => {
        try {
          target.focus();
        } catch (_) {
          /* foco best-effort */
        }
      }, 30);
    }
  }

  function handleClose(overlay) {
    overlay.setAttribute('aria-hidden', 'true');
    if (activeOverlay === overlay) {
      activeOverlay = null;
      if (opener && typeof opener.focus === 'function' && opener.isConnected) {
        try {
          opener.focus();
        } catch (_) {
          /* foco best-effort */
        }
      }
      opener = null;
    }
  }

  const attrObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes') continue;
      const overlay = mutation.target;
      if (!overlay.classList) continue;
      if (isVisible(overlay)) handleOpen(overlay);
      else handleClose(overlay);
    }
  });

  function wire(overlay) {
    if (!overlay || overlay.dataset.a11yReady === 'true') return;
    overlay.dataset.a11yReady = 'true';
    overlays.add(overlay);
    overlay.setAttribute('aria-hidden', isVisible(overlay) ? 'false' : 'true');
    attrObserver.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] });
    if (isVisible(overlay)) handleOpen(overlay);
  }

  function unwire(overlay) {
    if (!overlays.has(overlay)) return;
    handleClose(overlay);
    overlays.delete(overlay);
    delete overlay.dataset.a11yReady;
  }

  Array.from(document.querySelectorAll('.modal-overlay')).forEach(wire);

  // Modales creados o eliminados en runtime (helado, fidelización, pedido grupal).
  if (document.body) {
    const bodyObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('.modal-overlay')) wire(node);
          if (node.querySelectorAll) node.querySelectorAll('.modal-overlay').forEach(wire);
        });
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('.modal-overlay')) unwire(node);
          if (node.querySelectorAll) node.querySelectorAll('.modal-overlay').forEach(unwire);
        });
      }
    });
    bodyObserver.observe(document.body, { childList: true });
  }

  document.addEventListener('keydown', (event) => {
    const overlay = topModal();
    if (!overlay) return;

    if (event.key === 'Escape') {
      const closer = overlay.querySelector(CLOSER_SELECTOR);
      if (closer) {
        event.preventDefault();
        closer.click();
      } else if (overlay.hasAttribute('data-js-click-backdrop')) {
        // Último recurso: el overlay mismo es el control de cierre (backdrop).
        event.preventDefault();
        overlay.click();
      }
      return;
    }

    if (event.key !== 'Tab') return;
    const items = focusablesWithin(dialogBox(overlay));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
