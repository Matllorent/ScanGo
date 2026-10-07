/**
 * public/js/menu/menuModals.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Auxiliary UI Modals, Accessibility TTS, Push Notifications & Social Sharing
 * ─────────────────────────────────────────────────────────────────────────────
 */

// TTS Accessibility State
let _ttsAbortController = null;
let _ttsIsReading = false;

/**
 * Opens Wi-Fi connection modal
 */
export function openWifiModal() {
  const modal = document.getElementById('wifiModal');
  if (modal) modal.classList.add('active');
}

/**
 * Initializes global modal dismissal: ESC key + backdrop click
 * closes the topmost active .modal-overlay (a11y + mobile UX polish).
 */
export function initGlobalModalDismiss() {
  if (typeof document === 'undefined' || window.__modalDismissInit) return;
  window.__modalDismissInit = true;

  const getActiveOverlays = () =>
    [...document.querySelectorAll('.modal-overlay.active')];

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlays = getActiveOverlays();
    const top = overlays[overlays.length - 1];
    if (top) {
      top.classList.remove('active');
      top.setAttribute('aria-hidden', 'true');
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
      e.target.classList.remove('active');
      e.target.setAttribute('aria-hidden', 'true');
    }
  });
}

/**
 * Closes Wi-Fi connection modal
 */
export function closeWifiModal() {
  const modal = document.getElementById('wifiModal');
  if (modal) modal.classList.remove('active');
}

/**
 * Copies Wi-Fi password to user clipboard
 * @param {object} wifiConfig Wi-Fi config object { password: string }
 */
export function copyWifiPassword(wifiConfig = {}) {
  const pass = wifiConfig.password || '';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(pass).then(() => alert('Contraseña copiada al portapapeles'));
  } else {
    prompt('Copia la contraseña:', pass);
  }
}

/**
 * Stops ongoing SpeechSynthesis category reading
 */
export function stopCategoryTTS() {
  if (_ttsAbortController) {
    _ttsAbortController.abort();
    _ttsAbortController = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  _ttsIsReading = false;
}

/**
 * Pauses active speech synthesis
 */
export function pauseCategoryTTS() {
  if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
    window.speechSynthesis.pause();
  }
}

/**
 * Resumes paused speech synthesis
 */
export function resumeCategoryTTS() {
  if ('speechSynthesis' in window && window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }
}

/**
 * Reads out loud the dishes of the currently selected category via TTS.
 */
export function readSelectedCategoryTTS(selectedCategory, categories = [], dishes = []) {
  if (!('speechSynthesis' in window)) {
    alert('La síntesis de voz no está soportada en este navegador.');
    return;
  }

  if (_ttsIsReading) {
    stopCategoryTTS();
    return;
  }

  const category = selectedCategory === 'ALL'
    ? 'Todos los platos disponibles'
    : (categories.find(c => c.id === selectedCategory) || {}).name || 'Sección seleccionada';

  const filteredDishes = dishes.filter(d => selectedCategory === 'ALL' || d.categoryId === selectedCategory);
  let text = `Estás escuchando la sección ${category}. `;
  filteredDishes.forEach(d => {
    text += `${d.name}, precio ${d.price} pesos. ${d.description || ''}. `;
  });

  _ttsAbortController = new AbortController();
  const signal = _ttsAbortController.signal;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'es-ES';
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1;

  utter.onstart = () => { _ttsIsReading = true; };
  utter.onend = () => { _ttsIsReading = false; _ttsAbortController = null; };
  utter.onerror = () => { _ttsIsReading = false; _ttsAbortController = null; };

  signal.addEventListener('abort', () => {
    window.speechSynthesis.cancel();
    _ttsIsReading = false;
  }, { once: true });

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

/**
 * Initializes delayed banner for browser push notifications
 */
export function initPushPrompt() {
  const pushStatus = localStorage.getItem('scango_push_status');
  if (pushStatus === 'granted' || pushStatus === 'dismissed' || pushStatus === 'denied') {
    return;
  }
  setTimeout(() => {
    const banner = document.getElementById('pushPromptBanner');
    if (banner) banner.style.display = 'flex';
  }, 2500);
}

/**
 * Requests native notification permission
 */
export async function requestPushPermission(onSuccessMsg = '¡Notificaciones activadas! Te avisaremos de novedades y tus pedidos 🔔') {
  const banner = document.getElementById('pushPromptBanner');
  if (banner) banner.style.display = 'none';

  try {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      localStorage.setItem('scango_push_status', perm);
      if (perm === 'granted') {
        localStorage.setItem('scango_push_subscribed', 'true');
        showPushToast(onSuccessMsg);
      }
    } else {
      localStorage.setItem('scango_push_status', 'granted');
      localStorage.setItem('scango_push_subscribed', 'true');
      showPushToast('¡Notificaciones activadas con éxito! 🔔');
    }
  } catch (e) {
    localStorage.setItem('scango_push_status', 'granted');
    localStorage.setItem('scango_push_subscribed', 'true');
    showPushToast('¡Notificaciones activadas con éxito! 🔔');
  }
}

/**
 * Dismisses push notifications prompt
 */
export function dismissPushPrompt() {
  const banner = document.getElementById('pushPromptBanner');
  if (banner) banner.style.display = 'none';
  localStorage.setItem('scango_push_status', 'dismissed');
}

/**
 * Displays feedback toast for push notifications
 */
export function showPushToast(msg) {
  let toast = document.getElementById('pushToastFeedback');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pushToastFeedback';
    toast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#2D3748; color:#ECC94B; border:1px solid #ECC94B; border-radius:30px; padding:10px 20px; font-size:0.85rem; font-weight:700; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.5); display:flex; align-items:center; gap:8px; animation:slideDown 0.3s ease;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = 'flex';
  setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 3500);
}

/**
 * Opens restaurant details modal
 */
export function openRestaurantInfoModal() {
  const modal = document.getElementById('restaurantInfoModal');
  if (modal) modal.classList.add('active');
}

/**
 * Closes restaurant details modal
 */
export function closeRestaurantInfoModal() {
  const modal = document.getElementById('restaurantInfoModal');
  if (modal) modal.classList.remove('active');
}

/**
 * Native or fallback URL sharing for restaurant menu
 */
export function shareRestaurantUrl(title, text, url = window.location.href) {
  if (navigator.share) {
    navigator.share({ title, text, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => alert('Link del menú copiado al portapapeles 📋'));
  } else {
    prompt('Copiá este enlace para compartir:', url);
  }
}
