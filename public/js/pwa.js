// ScanGo PWA Controller & Service Worker Manager
(function() {
  'use strict';

  // 1. Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          console.log('[PWA] Service Worker registrado con éxito:', reg.scope);
        })
        .catch(err => {
          console.warn('[PWA] Fallo al registrar Service Worker:', err);
        });
    });
  }

  // 2. Before Install Prompt Handling
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    deferredPrompt = e;
    window.deferredPWAPrompt = e;

    // Dispatch custom event for UI components that want to show install CTA
    window.dispatchEvent(new CustomEvent('pwa-install-ready', { detail: { prompt: e } }));
    console.log('[PWA] Evento beforeinstallprompt capturado y listo para instalación.');
  });

  window.triggerPWAInstall = async function() {
    if (!deferredPrompt) {
      console.log('[PWA] Prompt no disponible o la app ya está instalada.');
      return false;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Elección de instalación del usuario:', outcome);
    deferredPrompt = null;
    window.deferredPWAPrompt = null;
    return outcome === 'accepted';
  };

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] Aplicación instalada con éxito en el dispositivo.');
    deferredPrompt = null;
    window.deferredPWAPrompt = null;
    hideInstallBanner();
  });

  // 3. Install CTA (píldora discreta, con retardo + engagement)
  // El navegador dispara `beforeinstallprompt` sólo cuando la app es instalable
  // (Android/Chrome/Edge; iOS Safari no lo emite). Hasta ahora el evento se
  // capturaba pero NADIE mostraba un CTA: `triggerPWAInstall` quedaba huérfano.
  // Esta píldora es la superficie de instalación, deliberadamente DISCRETA:
  //   · no aparece al cargar: espera un retardo + que la persona scrollee
  //     (muestra interés real) — así no interrumpe la primera impresión;
  //   · es compacta (una línea, sin subtítulo ni botón relleno);
  //   · queda abajo a la izquierda, fuera del chat y del botón de WhatsApp.
  // Es descartable (se recuerda en localStorage) y usa addEventListener
  // (no atributos inline) para respetar la CSP `script-src-attr 'none'`.
  const DISMISS_KEY = 'scango_pwa_install_dismissed';
  const SHOW_DELAY_MS = 10000;   // retardo mínimo antes de poder mostrarse
  const SCROLL_MIN_PX = 400;     // exige haber bajado un poco (interés real)

  let promptReadyAt = 0;
  let bannerShown = false;

  function hideInstallBanner() {
    const existing = document.getElementById('pwaInstallBanner');
    if (existing) existing.remove();
  }

  function dismissInstallBannerForever() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* noop */ }
    hideInstallBanner();
  }

  function showInstallBanner() {
    if (bannerShown || document.getElementById('pwaInstallBanner')) return;
    if (!window.deferredPWAPrompt) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch (e) { /* localStorage puede estar bloqueado; mostramos igual */ }
    if (!document.body) return;
    bannerShown = true;
    window.removeEventListener('scroll', maybeShowInstallBanner);

    const banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-label', 'Instalar la aplicación');
    // Píldora compacta y tenue: fondo sutil, borde fino, sin botón relleno.
    banner.style.cssText = 'position:fixed; left:16px; bottom:16px; z-index:99998;'
      + ' display:flex; align-items:center; gap:8px; padding:7px 11px;'
      + ' background:rgba(16,22,20,0.90); color:#fff; border:1px solid var(--border-subtle, rgba(255,255,255,0.12));'
      + ' border-radius:999px; box-shadow:0 6px 18px rgba(0,0,0,0.30); font-family:inherit;'
      + ' max-width:min(92vw, 300px); opacity:0; transform:translateY(8px);'
      + ' transition:opacity 0.4s ease, transform 0.4s ease;';
    banner.innerHTML = '<span style="font-size:1rem; line-height:1;">📲</span>'
      + '<span style="font-size:0.76rem; opacity:0.85; white-space:nowrap;">Instalar app</span>'
      + '<button type="button" id="pwaInstallAccept" style="background:transparent; color:var(--accent-gold, #E1A938); border:none; padding:2px 3px; font-weight:700; cursor:pointer; font-size:0.76rem; white-space:nowrap;">Instalar</button>'
      + '<button type="button" id="pwaInstallDismiss" aria-label="Cerrar aviso de instalación" style="background:transparent; color:#fff; border:none; font-size:0.9rem; cursor:pointer; opacity:0.5; padding:0 2px; line-height:1;">✕</button>';

    document.body.appendChild(banner);
    // Fade-in suave para que no "salte" en pantalla.
    window.requestAnimationFrame(() => {
      banner.style.opacity = '1';
      banner.style.transform = 'translateY(0)';
    });

    const acceptBtn = document.getElementById('pwaInstallAccept');
    const dismissBtn = document.getElementById('pwaInstallDismiss');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', async () => {
        acceptBtn.disabled = true;
        try {
          const accepted = await window.triggerPWAInstall();
          if (!accepted) acceptBtn.disabled = false;
          else hideInstallBanner();
        } catch (e) {
          acceptBtn.disabled = false;
        }
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', dismissInstallBannerForever);
    }
  }

  // Sólo se muestra cuando ya pasó el retardo Y la persona scrolleó (interés
  // real). Si nunca baja, nunca se la molesta — lo importante es la landing.
  function maybeShowInstallBanner() {
    if (bannerShown) return;
    if (!window.deferredPWAPrompt) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch (e) { /* noop */ }
    if (!document.body) return;
    if (!promptReadyAt) promptReadyAt = Date.now();
    if (Date.now() - promptReadyAt < SHOW_DELAY_MS) return;   // aún muy pronto
    if (window.scrollY < SCROLL_MIN_PX) return;              // sin interés aún
    showInstallBanner();
  }

  function scheduleInstallBanner() {
    if (!promptReadyAt) promptReadyAt = Date.now();
    window.addEventListener('scroll', maybeShowInstallBanner, { passive: true });
    // Red de seguridad por si la persona scrolleó antes del retardo.
    window.setTimeout(maybeShowInstallBanner, SHOW_DELAY_MS + 500);
  }

  window.addEventListener('pwa-install-ready', scheduleInstallBanner);
  // El evento pudo haber disparado antes de cargar este script: re-chequeamos.
  if (window.deferredPWAPrompt) scheduleInstallBanner();
  window.showPWAInstallBanner = showInstallBanner;
})();
