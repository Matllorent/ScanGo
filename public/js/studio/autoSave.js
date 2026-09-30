/**
 * public/js/studio/autoSave.js
 * ─────────────────────────────
 * Módulo ES para el guardado automático y sincronización del preview en vivo.
 * Extraído de studio.js: triggerAutoSave, saveStudioChanges, reloadPreviewIframe, setPreviewView.
 */

const TOKEN_KEY = 'menu_pizarron_token';

/**
 * Dispara el guardado automático con debounce de 1200ms.
 * @param {{ autoSaveTimeout: number|null }} state  — objeto mutable del estado
 * @param {Function} showSaveFeedback  — callback UI
 * @param {Function} saveStudioChangesFn  — función de guardado real
 * @returns {void}
 */
export function triggerAutoSave(state, showSaveFeedback, saveStudioChangesFn) {
  showSaveFeedback('saving');
  clearTimeout(state.autoSaveTimeout);
  state.autoSaveTimeout = setTimeout(saveStudioChangesFn, 1200);
}

/**
 * Guarda los cambios del Studio en el backend y localStorage.
 * @param {object} restaurant  — objeto restaurant del estado global
 * @param {Function} showSaveFeedback  — callback UI
 * @param {Function} reloadPreviewIframeFn  — callback para recargar el iframe
 */
export async function saveStudioChanges(restaurant, showSaveFeedback, reloadPreviewIframeFn) {
  const btn = document.getElementById('btnSaveStudio');
  const btnText = document.getElementById('saveBtnText');

  if (btn) {
    if (btn.dataset.saving === 'true') return;
    btn.dataset.saving = 'true';
    btn.disabled = true;
  }
  if (btnText) btnText.textContent = '⏳ Guardando...';
  showSaveFeedback('saving');

  const token = localStorage.getItem(TOKEN_KEY);

  // Always persist locally first (works offline)
  try {
    localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(restaurant));
  } catch (e) { /* quota exceeded — ignore */ }

  const finishSave = (label, feedbackState = 'saved') => {
    if (btnText) btnText.textContent = label;
    showSaveFeedback(feedbackState);
    setTimeout(() => {
      if (btnText) btnText.textContent = '💾 Guardar Cambios';
      if (btn) {
        btn.disabled = false;
        btn.dataset.saving = 'false';
      }
    }, 1800);
  };

  if (!token) {
    setTimeout(() => finishSave('✓ Guardado', 'saved'), 350);
    return;
  }

  try {
    const res = await fetch('/api/studio/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ restaurantId: restaurant.id, data: restaurant })
    });
    if (!res.ok) throw new Error('Error al guardar');
    finishSave('✓ Guardado', 'saved');
    if (typeof reloadPreviewIframeFn === 'function') reloadPreviewIframeFn();
  } catch (err) {
    // Offline or server error — still saved locally
    finishSave('✓ Guardado (Local)', 'saved');
  }
}

/**
 * Recarga el iframe de preview con cache-buster.
 * @param {string} slug — slug del restaurante
 */
export function reloadPreviewIframe(slug) {
  const iframe = document.getElementById('previewIframe');
  if (iframe) iframe.src = `/m/${slug}?t=${Date.now()}`;
}

/**
 * Sincroniza el iframe de preview en vivo via postMessage.
 * @param {object} restaurant  — datos completos del restaurante
 */
export function syncLivePreviewIframe(restaurant) {
  const iframe = document.getElementById('previewIframe');
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'UPDATE_LIVE_PREVIEW', data: restaurant }, '*');
  }
}
