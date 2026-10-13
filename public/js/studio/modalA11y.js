/**
 * public/js/studio/modalA11y.js
 *
 * Accesibilidad de modales del Studio (WCAG 2.1.2 sin trampa de foco,
 * 2.4.3 orden de foco, 4.1.2 nombre/rol/valor).
 *
 * El Studio abre sus modales agregando `.active` a un `.modal-overlay`
 * (o cambiando su `style.display`). Este módulo observa esos cambios y:
 *   - mantiene `aria-hidden` del overlay sincronizado con su visibilidad real;
 *   - al abrir, mueve el foco al primer control del diálogo;
 *   - al cerrar, devuelve el foco al disparador anterior;
 *   - encierra el foco dentro del modal abierto (Tab cicla, no escapa);
 *   - cierra el modal visible más alto con Escape (simula el botón ✕).
 *
 * Es genérico y no intrusivo: no requiere tocar cada función open/close.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

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
 * Cablea la accesibilidad de todos los `.modal-overlay` presentes en la página.
 * Idempotente: si ya se cableó, no vuelve a hacerlo.
 */
export function initModalA11y() {
  const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
  if (!overlays.length) return;
  if (overlays.some((o) => o.dataset.a11yReady === 'true')) return;

  let opener = null;
  let activeOverlay = null;

  const openOverlays = () => overlays.filter(isVisible);
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
    if (!activeOverlay) opener = document.activeElement;
    activeOverlay = overlay;
    overlay.setAttribute('aria-hidden', 'false');
    const target = focusablesWithin(dialogBox(overlay))[0] || dialogBox(overlay);
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

  const initiallyOpen = openOverlays();
  overlays.forEach((overlay) => {
    overlay.dataset.a11yReady = 'true';
    overlay.setAttribute('aria-hidden', initiallyOpen.includes(overlay) ? 'false' : 'true');
  });

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const overlay = mutation.target;
      if (!overlay.classList) continue;
      if (isVisible(overlay)) handleOpen(overlay);
      else handleClose(overlay);
    }
  });
  overlays.forEach((overlay) => observer.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] }));

  document.addEventListener('keydown', (event) => {
    const overlay = topModal();
    if (!overlay) return;

    if (event.key === 'Escape') {
      const closer = overlay.querySelector('[data-js-click^="close"]');
      if (closer) {
        event.preventDefault();
        closer.click();
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
