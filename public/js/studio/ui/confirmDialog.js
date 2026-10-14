// public/js/studio/ui/confirmDialog.js
// Diálogo de confirmación personalizado (reemplaza window.confirm).
// Estado interno: pendingConfirmAction (callback) o pendingConfirmResolve
// (promesa, cuando se llama sin onConfirm).

let pendingConfirmAction = null;
let pendingConfirmResolve = null;

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
  if (typeof onConfirm === 'function') {
    pendingConfirmAction = onConfirm;
    pendingConfirmResolve = null;
    document.getElementById('confirmActionModal').classList.add('active');
    return undefined;
  }
  // Sin callback: modo promesa (no bloquea el hilo como window.confirm).
  // Cancelar/cerrar resuelve false; aceptar resuelve true.
  document.getElementById('confirmActionModal').classList.add('active');
  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
  });
}

export function closeConfirmDialog(confirmed) {
  document.getElementById('confirmActionModal').classList.remove('active');
  // El binder data-js-* ya convierte 'true'/'false' a booleanos, pero un
  // llamado directo con string 'false' NO debe contar como aceptación.
  const ok = confirmed === true || confirmed === 'true';
  if (ok && typeof pendingConfirmAction === 'function') {
    pendingConfirmAction();
  }
  if (typeof pendingConfirmResolve === 'function') {
    pendingConfirmResolve(ok);
  }
  pendingConfirmAction = null;
  pendingConfirmResolve = null;
}

// Expuesto en window por main.js: closeConfirmDialog