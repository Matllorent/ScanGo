// public/js/studio/ui/saveFeedback.js
// Pill de feedback de guardado en header (Guardando... / Guardado / Error).

let saveFeedbackTimer = null;

export function showSaveFeedback(state) {
  const badge = document.getElementById('saveFeedbackBadge');
  const icon = document.getElementById('saveFeedbackIcon');
  const text = document.getElementById('saveFeedbackText');
  if (!badge || !icon || !text) return;

  clearTimeout(saveFeedbackTimer);
  badge.style.display = 'inline-flex';

  if (state === 'saving') {
    badge.style.background = 'rgba(225, 169, 56, 0.15)';
    badge.style.border = '1px solid rgba(225, 169, 56, 0.4)';
    badge.style.color = 'var(--accent-gold)';
    icon.textContent = '🔄';
    text.textContent = 'Guardando...';
  } else if (state === 'saved') {
    badge.style.background = 'rgba(56, 161, 105, 0.15)';
    badge.style.border = '1px solid rgba(56, 161, 105, 0.4)';
    badge.style.color = '#48BB78';
    icon.textContent = '✓';
    text.textContent = '¡Cambios guardados!';
    saveFeedbackTimer = setTimeout(() => {
      badge.style.display = 'none';
    }, 2200);
  } else if (state === 'error') {
    badge.style.background = 'rgba(229, 62, 62, 0.15)';
    badge.style.border = '1px solid rgba(229, 62, 62, 0.4)';
    badge.style.color = '#FC8181';
    icon.textContent = '⚠️';
    text.textContent = 'Error al sincronizar';
    saveFeedbackTimer = setTimeout(() => {
      badge.style.display = 'none';
    }, 3500);
  }
}