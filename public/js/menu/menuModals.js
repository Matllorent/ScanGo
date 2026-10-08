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
 * Convierte una clave pública VAPID (base64url) a Uint8Array para subscribe().
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/**
 * Inicializa el banner diferido de notificaciones del comensal (opt-in).
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
 * Pide el permiso nativo y registra la suscripción REAL (VAPID) como rol
 * 'guest' con consentimiento explícito de marketing: así el comensal SOLO
 * recibe promos del local, nunca avisos de mesa (que son de role=owner).
 */
export async function requestPushPermission(onSuccessMsg = '¡Notificaciones activadas! Te avisaremos de novedades y tus pedidos 🔔', restaurantId = '', consentMarketing = true) {
  const banner = document.getElementById('pushPromptBanner');
  if (banner) banner.style.display = 'none';

  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  if (!supported) {
    // Sin push real no hay nada que registrar; no marcamos una suscripción trucha.
    localStorage.setItem('scango_push_status', 'granted');
    showPushToast('¡Notificaciones activadas con éxito! 🔔');
    return;
  }

  try {
    const perm = await Notification.requestPermission();
    localStorage.setItem('scango_push_status', perm);
    if (perm !== 'granted') {
      showPushToast('No activaste las notificaciones. Podés habilitarlas desde el navegador.');
      return;
    }

    const res = await fetch('/api/notifications/vapid-public-key');
    if (!res.ok) {
      // Servidor sin llaves VAPID: no podemos fingir una suscripción. El
      // restaurante verá el banner de nuevo en una próxima visita.
      localStorage.setItem('scango_push_status', 'granted');
      showPushToast('El local todavía no habilita notificaciones, ¡pero la promo también suma igual!');
      return;
    }
    const data = await res.json();
    if (!data || !data.data || !data.data.publicKey) {
      localStorage.setItem('scango_push_status', 'granted');
      showPushToast('El local todavía no habilita notificaciones por ahora.');
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.data.publicKey)
      });
    }

    const rid = String(restaurantId || (window.restaurantData && window.restaurantData.id) || '');
    const subscribeRes = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantId: rid,
        endpoint: subscription.endpoint,
        keys: subscription.toJSON().keys,
        role: 'guest', // comensal: nunca recibe avisos de mesa operativos
        consentMarketing: !!consentMarketing, // opt-in explícito para promos
        // Teléfono (si ya lo cargó): permite dirigir el aviso de estado del
        // pedido SOLO a él, no a todos los comensales.
        customerPhone: (typeof localStorage !== 'undefined' && localStorage.getItem('scango_loyalty_phone')) || ''
      })
    });

    if (subscribeRes.ok) {
      localStorage.setItem('scango_push_subscribed', 'true');
      localStorage.setItem('scango_push_status', 'granted');
      showPushToast(onSuccessMsg);
    } else {
      const errBody = await subscribeRes.json().catch(() => ({}));
      localStorage.setItem('scango_push_status', 'granted');
      showPushToast(errBody.error || 'No pudimos registrar tu dispositivo en las notificaciones. Probá de nuevo.');
    }
  } catch (e) {
    localStorage.setItem('scango_push_status', 'granted');
    showPushToast('No se pudieron activar las notificaciones en este momento.');
  }
}

/**
 * Si el comensal YA activó las notificaciones pero cargó su teléfono después,
 * re-suscribe (upsert por endpoint) con el teléfono para que el aviso de estado
 * de su pedido le llegue SOLO a él. No-op si no hay suscripción activa.
 */
export async function syncPushCustomerPhone(phone) {
  const value = String(phone || '').trim();
  if (!value) return false;
  if (typeof localStorage === 'undefined' || localStorage.getItem('scango_push_subscribed') !== 'true') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return false;
    const rid = String((window.restaurantData && window.restaurantData.id) || '');
    const res = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantId: rid,
        endpoint: subscription.endpoint,
        keys: subscription.toJSON().keys,
        role: 'guest',
        consentMarketing: true,
        customerPhone: value
      })
    });
    return res.ok;
  } catch (e) {
    return false;
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
