// public/js/studio/ui/tabs.js
// Cambio de pestañas del panel lateral.
// Recibe tabId ('local', 'dishes', 'theme', 'delivery', 'qr', 'stats', 'branches', 'reviews', 'notifications', 'analytics')
// y opcionalmente el botón clicado para gestionar clase .active.

export function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const pane = document.getElementById(`tab-${tabId}`);
  if (pane) pane.classList.add('active');
  if (btn) btn.classList.add('active');
  else {
    // Fallback: el botón se identifica por su spec data-js-* (los atributos onclick
    // fueron eliminados por la migración CSP — ver scripts/codemod-csp-events.js).
    const fallbackBtn = document.querySelector(`.tab-btn[data-js-click="switchTab|${tabId}"]`);
    if (fallbackBtn) fallbackBtn.classList.add('active');
  }

}