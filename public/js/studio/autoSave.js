/**
 * public/js/studio/autoSave.js
 * ─────────────────────────────
 * Módulo ES para el guardado automático y sincronización del preview en vivo.
 * Extraído de studio.js: triggerAutoSave, saveStudioChanges, reloadPreviewIframe, setPreviewView.
 */

const TOKEN_KEY = 'menu_pizarron_token'; // legacy: ya no se emite ni se usa

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

  // Sesión por cookie httpOnly (web) o dispositivo (nativo): el backend
  // responde 401 si expiró; el catch degrada a guardado local igual que antes.
  try {
    const headers = window.AuthClient
      ? window.AuthClient.getAuthHeaders({ 'Content-Type': 'application/json' })
      : { 'Content-Type': 'application/json' };
    const res = await fetch('/api/studio/save', {
      method: 'POST',
      headers,
      body: JSON.stringify({ restaurantId: restaurant.id, data: restaurant })
    });
    if (res.status === 401) {
      finishSave('⚠️ Sesión vencida — recargá la página', 'error');
      showSaveFeedback('error');
      return;
    }
    if (res.status === 409) {
      // Concurrencia optimista: otra pestaña/empleado guardó desde nuestra
      // última lectura. Opciones honestas: sobrescribir o no guardar y
      // recargar para ver la versión más reciente. Diálogo propio no
      // bloqueante (nunca window.confirm); sin UI disponible el default
      // seguro es NO sobrescribir.
      const body = await res.json().catch(() => ({}));
      if (body.code === 'MENU_CONCURRENCY_CONFLICT') {
        let overwrite = false;
        if (window.showConfirmDialog) {
          try {
            overwrite = await Promise.resolve(window.showConfirmDialog({
              icon: '⚠️',
              title: 'Edición en otro lado',
              message: 'Tu menú fue actualizado en otra pestaña o por otro empleado. Si aceptás, sobrescribís los cambios ajenos con los tuyos. Si cancelás, no se guarda nada: recargá la página para ver la versión más reciente.',
              confirmText: 'Sobrescribir igual',
              confirmClass: 'btn-danger'
            })) || false;
          } catch {
            overwrite = false;
          }
        }
        if (overwrite) {
          // Reconocer la versión ajena como base → el servidor nos deja guardar
          // (es el "sobrescribir" que el dueño eligió), y el próximo save ya
          // vuelve a la cadena normal de versiones.
          restaurant.updatedAt = body.currentUpdatedAt || restaurant.updatedAt;
          if (btn) {
            btn.dataset.saving = 'false';
            btn.disabled = false;
          }
          return saveStudioChanges(restaurant, showSaveFeedback, reloadPreviewIframeFn);
        }
        finishSave('⚠️ Conflicto de edición — recargá para ver la versión más nueva', 'error');
        showSaveFeedback('error');
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const savedBody = await res.json().catch(() => ({}));
    // La respuesta devuelve el restaurante con su updatedAt fresco: lo tomamos
    // como nuestra nueva base de versionado (evita falsos 409 en el próximo save).
    if (savedBody && savedBody.restaurant && savedBody.restaurant.updatedAt) {
      restaurant.updatedAt = savedBody.restaurant.updatedAt;
    }
    finishSave('✓ Guardado', 'saved');
    showSaveFeedback('saved');
    if (typeof reloadPreviewIframeFn === 'function') reloadPreviewIframeFn();
  } catch (err) {
    // Offline o error de red: quedó guardado local, se reintenta al volver.
    finishSave('📶 Sin conexión — guardado local', 'error');
    showSaveFeedback('error');
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
    iframe.contentWindow.postMessage({ type: 'UPDATE_LIVE_PREVIEW', data: restaurant }, window.location.origin);
  }
}
