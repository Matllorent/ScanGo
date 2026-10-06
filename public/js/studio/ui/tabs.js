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
    const fallbackBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
    if (fallbackBtn) fallbackBtn.classList.add('active');
  }

}