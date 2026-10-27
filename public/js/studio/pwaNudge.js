/**
 * public/js/studio/pwaNudge.js — Quick Win #8: "Nudge de instalación PWA del dueño".
 *
 * El Studio ya es instalable (manifest + pwa.js registran todo), pero NADIE se
 * enteraba: la píldora de pwa.js exige scroll ≥400px y el layout del Studio
 * (sidebar + paneles) scrollea adentro — el CTA nunca aparecía. Este módulo es
 * la superficie propia del Studio:
 *
 *  · Aparece 20s después de que el navegador reporte la app instalable
 *    (`pwa-install-ready` — señal de interés real, sin scroll-gate que el
 *    layout no puede cumplir).
 *  · NO aparece si ya está instalada (display-mode: standalone) o si el dueño
 *    la descartó (localStorage `scango_studio_pwa_dismissed`).
 *  · Setea `window.__SCANGO_PWA_SUPPRESS_BANNER__` para que la píldora del
 *    menú (pwa.js) no compita en esta página.
 *  · El botón delega en `window.triggerPWAInstall()` (ya global desde pwa.js)
 *    y se oculta con `appinstalled`.
 *
 * Pureza: el top-level del módulo NO toca window/document (el test lo importa
 * en Node); todo el DOM vive dentro de `initStudioPwaNudge()`. Cero `on*=`
 * (CSP `script-src-attr 'none'`) y render con DOM API (cero innerHTML).
 */

export const STUDIO_PWA_DISMISS_KEY = 'scango_studio_pwa_dismissed';
export const STUDIO_PWA_SHOW_DELAY_MS = 20000;

/**
 * Decisión pura de mostrar el nudge. `elapsedMs` mide desde que el prompt
 * quedó disponible (la señal de interés del dueño), no desde la carga.
 */
export function shouldShowStudioPwaNudge({ dismissed, standalone, hasPrompt, elapsedMs }) {
  if (dismissed || standalone || !hasPrompt) return false;
  const elapsed = Number(elapsedMs);
  return Number.isFinite(elapsed) && elapsed >= STUDIO_PWA_SHOW_DELAY_MS;
}

/** ¿La app ya corre instalada (standalone)? Tolerante a entornos sin matchMedia. */
export function isStandaloneDisplay(win) {
  try {
    return Boolean(win && win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
  } catch (e) {
    return false;
  }
}

/**
 * Wiring del nudge en el Studio. Idempotente (re-invocar no duplica banners ni
 * listeners). Devuelve la API interna `{ tryShow, removeBanner }` para tests.
 */
export function initStudioPwaNudge(win = (typeof window !== 'undefined' ? window : undefined)) {
  if (!win || !win.document) return null;

  // La píldora del menú (pwa.js) no aplica a esta página: superficie propia.
  win.__SCANGO_PWA_SUPPRESS_BANNER__ = true;

  let readyAt = 0;
  let scheduled = false;

  const readDismissed = () => {
    try { return win.localStorage.getItem(STUDIO_PWA_DISMISS_KEY) === '1'; } catch (e) { return false; }
  };
  const hasPrompt = () => Boolean(win.deferredPWAPrompt);

  function removeBanner() {
    const existing = win.document.getElementById('studioPwaNudge');
    if (existing) existing.remove();
  }

  function showBanner() {
    const doc = win.document;
    if (doc.getElementById('studioPwaNudge') || !doc.body) return;

    const banner = doc.createElement('div');
    banner.id = 'studioPwaNudge';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-label', 'Instalar el Studio como aplicación');
    banner.style.cssText = 'position:fixed; left:16px; bottom:16px; z-index:99998;'
      + ' display:flex; align-items:center; gap:8px; padding:7px 11px;'
      + ' background:var(--surface-card, #101614); color:#fff;'
      + ' border:1px solid var(--border, rgba(255,255,255,0.12));'
      + ' border-radius:999px; box-shadow:0 6px 18px rgba(0,0,0,0.30); font-family:inherit;'
      + ' max-width:min(92vw, 300px); opacity:0; transform:translateY(8px);'
      + ' transition:opacity 0.4s ease, transform 0.4s ease;';

    const icon = doc.createElement('span');
    icon.textContent = '📲';
    icon.style.cssText = 'font-size:1rem; line-height:1;';

    const text = doc.createElement('span');
    text.textContent = 'Instalá el Studio';
    text.style.cssText = 'font-size:0.76rem; opacity:0.85; white-space:nowrap;';

    const acceptBtn = doc.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.textContent = 'Instalar';
    acceptBtn.style.cssText = 'background:transparent; color:var(--accent-gold, #E1A938); border:none;'
      + ' padding:2px 3px; font-weight:700; cursor:pointer; font-size:0.76rem; white-space:nowrap;';

    const dismissBtn = doc.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.textContent = '✕';
    dismissBtn.setAttribute('aria-label', 'Cerrar aviso de instalación');
    dismissBtn.style.cssText = 'background:transparent; color:#fff; border:none; font-size:0.9rem;'
      + ' cursor:pointer; opacity:0.5; padding:0 2px; line-height:1;';

    acceptBtn.addEventListener('click', async () => {
      acceptBtn.disabled = true;
      try {
        const accepted = await win.triggerPWAInstall();
        if (accepted) removeBanner();
        else acceptBtn.disabled = false;
      } catch (e) {
        acceptBtn.disabled = false;
      }
    });
    dismissBtn.addEventListener('click', () => {
      try { win.localStorage.setItem(STUDIO_PWA_DISMISS_KEY, '1'); } catch (e) { /* noop */ }
      removeBanner();
    });

    banner.append(icon, text, acceptBtn, dismissBtn);
    doc.body.appendChild(banner);
    // Fade-in suave para que no "salte" en pantalla.
    win.requestAnimationFrame(() => {
      banner.style.opacity = '1';
      banner.style.transform = 'translateY(0)';
    });
  }

  function tryShow() {
    const info = {
      dismissed: readDismissed(),
      standalone: isStandaloneDisplay(win),
      hasPrompt: hasPrompt(),
      elapsedMs: readyAt ? (Date.now() - readyAt) : 0
    };
    if (!shouldShowStudioPwaNudge(info)) return;
    showBanner();
  }

  function schedule() {
    if (!readyAt) readyAt = Date.now();
    if (scheduled) return;
    scheduled = true;
    win.setTimeout(() => {
      scheduled = false;
      tryShow();
    }, STUDIO_PWA_SHOW_DELAY_MS + 500);
  }

  win.addEventListener('pwa-install-ready', schedule);
  // El evento pudo haber disparado antes de cargar este módulo: re-chequeamos.
  if (hasPrompt()) schedule();
  win.addEventListener('appinstalled', removeBanner);

  return { tryShow, removeBanner };
}
