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
  });
})();
