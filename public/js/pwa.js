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

  // 3. Install CTA (banner flotante)
  // El navegador dispara `beforeinstallprompt` sólo cuando la app es instalable
  // (Android/Chrome/Edge; iOS Safari no lo emite). Hasta ahora el evento se
  // capturaba pero NADIE mostraba un CTA: `triggerPWAInstall` quedaba huérfano.
  // Este banner es la superficie de instalación: aparece cuando el navegador lo
  // permite, es descartable (se recuerda en localStorage) y usa addEventListener
  // (no atributos inline) para respetar la CSP `script-src-attr 'none'`.
  const DISMISS_KEY = 'scango_pwa_install_dismissed';

  function hideInstallBanner() {
    const existing = document.getElementById('pwaInstallBanner');
    if (existing) existing.remove();
  }

  function showInstallBanner() {
    if (document.getElementById('pwaInstallBanner')) return;
    if (!window.deferredPWAPrompt) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch (e) { /* localStorage puede estar bloqueado; mostramos igual */ }
    if (!document.body) return;

    const banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Instalar la aplicación');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = 'position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:99999;'
      + ' display:flex; align-items:center; gap:10px; max-width:min(92vw, 420px); padding:10px 14px;'
      + ' background:#101614; color:#fff; border:1px solid var(--border-gold, #D4A853); border-radius:14px;'
      + ' box-shadow:0 12px 34px rgba(0,0,0,0.45); font-family:inherit;';
    banner.innerHTML = '<span style="font-size:1.35rem;">📲</span>'
      + '<div style="display:flex; flex-direction:column; line-height:1.2; min-width:0;">'
      + '<strong style="font-size:0.86rem;">Instalá la app</strong>'
      + '<span style="font-size:0.72rem; opacity:0.75;">Accedé más rápido desde tu pantalla de inicio</span>'
      + '</div>'
      + '<button type="button" id="pwaInstallAccept" style="margin-left:auto; background:var(--chalk-gold, #D4A853); color:#101614; border:none; border-radius:10px; padding:8px 12px; font-weight:800; cursor:pointer; font-size:0.78rem; white-space:nowrap;">Instalar</button>'
      + '<button type="button" id="pwaInstallDismiss" aria-label="Cerrar aviso de instalación" style="background:transparent; color:#fff; border:none; font-size:1.05rem; cursor:pointer; opacity:0.6; padding:0 4px;">✕</button>';

    document.body.appendChild(banner);

    const acceptBtn = document.getElementById('pwaInstallAccept');
    const dismissBtn = document.getElementById('pwaInstallDismiss');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', async () => {
        acceptBtn.disabled = true;
        try {
          const accepted = await window.triggerPWAInstall();
          if (!accepted) acceptBtn.disabled = false;
        } catch (e) {
          acceptBtn.disabled = false;
        }
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* noop */ }
        hideInstallBanner();
      });
    }
  }

  window.addEventListener('pwa-install-ready', showInstallBanner);
  // El evento pudo haber disparado antes de cargar este script: re-chequeamos.
  if (window.deferredPWAPrompt) showInstallBanner();
  window.showPWAInstallBanner = showInstallBanner;
})();
