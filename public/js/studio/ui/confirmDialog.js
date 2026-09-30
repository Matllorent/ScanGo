// public/js/studio/ui/confirmDialog.js
// Diálogo de confirmación personalizado (reemplaza window.confirm).
// Estado interno: pendingConfirmAction.

let pendingConfirmAction = null;

export function showConfirmDialog({ icon = '⚠️', title = '¿Estás seguro?', message = '', confirmText = 'Sí, Continuar', confirmClass = 'btn-danger', onConfirm }) {
  document.getElementById('confirmDialogIcon').textContent = icon;
  document.getElementById('confirmDialogTitle').textContent = title;
  document.getElementById('confirmDialogMessage').textContent = message;
  const acceptBtn = document.getElementById('confirmDialogAcceptBtn');
  acceptBtn.textContent = confirmText;
  if (confirmClass === 'btn-danger') {
    acceptBtn.style.background = '#E53E3E';
    acceptBtn.style.borderColor = '#E53E3E';
    acceptBtn.style.color = '#fff';
  } else {
    acceptBtn.style.background = 'var(--accent-gold)';
    acceptBtn.style.borderColor = 'var(--accent-gold)';
    acceptBtn.style.color = '#101614';
  }
  pendingConfirmAction = onConfirm;
  document.getElementById('confirmActionModal').classList.add('active');
}

export function closeConfirmDialog(confirmed) {
  document.getElementById('confirmActionModal').classList.remove('active');
  if (confirmed && typeof pendingConfirmAction === 'function') {
    pendingConfirmAction();
  }
  pendingConfirmAction = null;
}

// Expuesto en window por main.js: closeConfirmDialog