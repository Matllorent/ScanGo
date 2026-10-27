/**
 * public/js/mozo/mozo.js
 * ──────────────────────
 * PWA del TURNO del equipo operativo (Sistema de Mozos y Cocina, Fase 1).
 *
 * Flujo:
 *  1. El mozo escanea el QR de turno → `/mozo?r=<local>&w=<persona>#k=<secreto>`.
 *  2. La página extrae el secreto del FRAGMENTO (nunca viaja al servidor en un
 *     query string), limpia la barra de direcciones y lo canjea por un token
 *     de sesión opaco (`POST /api/staff/shift/activate`).
 *  3. Guarda SOLO el token en localStorage y lo manda como Bearer.
 *  4. Refresca `/api/staff/me` cada 30 s con la pestaña visible, renueva el
 *     turno cada 5 min y permite activar avisos push de su propia persona.
 *  5. Cerrar el turno exige DOS toques (sin `window.confirm`): el primero
 *     arma, el segundo confirma dentro de 4 s.
 *
 * Reglas de la casa: cero `on*=` (listeners), cero HTML inyectado con datos
 * (createElement + textContent), errores en banners propios (cero `alert`).
 */
import {
  STAFF_SESSION_STORAGE_KEY,
  MOZO_POLL_MS,
  MOZO_HEARTBEAT_MS,
  parseEnrollmentFromLocation,
  stripEnrollmentFragment,
  buildStaffSessionFromActivation,
  mergeStaffSessionFromMe,
  staffSessionIsUsable,
  staffSessionMinutesLeft,
  formatStaffExpiry,
  nextEndShiftTap,
  shouldRefreshStaffSession,
  readStaffSessionFromStorage,
  writeStaffSessionToStorage,
  clearStaffSessionStorage,
  buildMozoView
} from './mozoSession.js';

const API_TIMEOUT_MS = 15000;
const BANNER_MS = 7000;
const PUSH_SCOPE = '/mozo';

const dom = {};
let session = null;
let pendingEnrollment = null;
let pushConfigured = false;
let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
let pollTimer = null;
let heartbeatTimer = null;
let bannerTimer = null;
let endShiftTimer = null;
let endShiftState = { armedAt: null };
let pushBusy = false;
let swRegistration = null;
let booted = false;

function cacheDom() {
  const ids = [
    'mozoTitle',
    'mozoSubtitle',
    'mozoConnection',
    'mozoPushBtn',
    'mozoRefreshBtn',
    'mozoShiftCard',
    'mozoShiftTitle',
    'mozoRoleChip',
    'mozoExpires',
    'mozoMinutesLeft',
    'mozoBanner',
    'mozoTablesSection',
    'mozoTablesTitle',
    'mozoTablesCount',
    'mozoTablesHint',
    'mozoTablesGrid',
    'mozoEmptyTables',
    'mozoRefreshTablesBtn',
    'mozoHelpSection',
    'mozoEndSection',
    'mozoEndShiftBtn',
    'mozoEndHint',
    'mozoGate',
    'mozoGateTitle',
    'mozoGateMessage',
    'mozoGateRetryBtn'
  ];
  for (const id of ids) dom[id] = document.getElementById(id);
}

function setText(element, text) {
  if (element) element.textContent = text == null ? '' : String(text);
}

function setHidden(element, hidden) {
  if (!element) return;
  if (hidden) element.setAttribute('hidden', '');
  else element.removeAttribute('hidden');
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = String(text);
  return el;
}

function setConnection(mode) {
  const el = dom.mozoConnection;
  if (!el) return;
  el.classList.remove('is-offline', 'is-idle');
  if (!session) {
    el.classList.add('is-idle');
    el.textContent = 'Sin turno';
    return;
  }
  if (!mode || mode === 'online') {
    el.textContent = 'En línea';
    return;
  }
  if (mode === 'offline') {
    el.classList.add('is-offline');
    el.textContent = 'Sin conexión';
    return;
  }
  el.classList.add('is-idle');
  el.textContent = mode;
}

function showBanner(message, tone = 'info') {
  if (!dom.mozoBanner) return;
  if (bannerTimer) clearTimeout(bannerTimer);
  dom.mozoBanner.textContent = message || '';
  dom.mozoBanner.classList.remove('is-error', 'is-ok');
  if (tone === 'error') dom.mozoBanner.classList.add('is-error');
  if (tone === 'ok') dom.mozoBanner.classList.add('is-ok');
  setHidden(dom.mozoBanner, !message);
  if (message) {
    bannerTimer = setTimeout(() => setHidden(dom.mozoBanner, true), BANNER_MS);
  }
}

function showGate(title, message, { retry = false } = {}) {
  setText(dom.mozoGateTitle, title || 'Sin turno activo');
  setText(
    dom.mozoGateMessage,
    message || 'Escaneá el QR de turno que te dio el dueño para entrar.'
  );
  setHidden(dom.mozoGateRetryBtn, !retry);
  setHidden(dom.mozoGate, false);
}

function hideGate() {
  setHidden(dom.mozoGate, true);
}

function cleanupSessionView() {
  stopTimers();
  session = null;
  pendingEnrollment = null;
  setHidden(dom.mozoShiftCard, true);
  setHidden(dom.mozoTablesSection, true);
  setHidden(dom.mozoHelpSection, true);
  setHidden(dom.mozoEndSection, true);
  setHidden(dom.mozoPushBtn, true);
  setHidden(dom.mozoEmptyTables, true);
  if (dom.mozoTablesGrid) dom.mozoTablesGrid.replaceChildren();
  setText(dom.mozoTitle, 'ScanGo · Mi Turno');
  setText(dom.mozoSubtitle, 'Escaneá el QR de turno que te dio el dueño.');
  setText(dom.mozoShiftTitle, '—');
  setText(dom.mozoExpires, '—');
  setText(dom.mozoMinutesLeft, '');
  setConnection('idle');
  resetEndShiftArm();
  document.title = 'Mi Turno — ScanGo';
}

function clearStoredSession() {
  clearStaffSessionStorage(window.localStorage, STAFF_SESSION_STORAGE_KEY);
}

function persistSession() {
  if (!session) return false;
  return writeStaffSessionToStorage(window.localStorage, session, STAFF_SESSION_STORAGE_KEY);
}

function handleSessionLost(message) {
  clearStoredSession();
  cleanupSessionView();
  showGate(
    'Tu turno se cerró',
    message || 'La sesión venció o el dueño la revocó. Escaneá el QR de turno para volver a entrar.'
  );
}

/** fetch con timeout y lectura honesta del error del backend. */
async function apiFetch(path, { method = 'GET', body = null, token = '' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      credentials: 'omit',
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    const error = new Error(
      err && err.name === 'AbortError'
        ? 'El servidor tardó demasiado en responder. Probá de nuevo.'
        : 'No pudimos conectarnos. Revisá tu conexión.'
    );
    error.code = err && err.name === 'AbortError' ? 'FETCH_TIMEOUT' : 'NETWORK_ERROR';
    throw error;
  }
  clearTimeout(timer);

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (e) {
      payload = null;
    }
  }
  const data = payload && Object.prototype.hasOwnProperty.call(payload, 'data')
    ? payload.data
    : payload;
  const message =
    (payload && (payload.error || payload.message)) ||
    (response.ok ? '' : `El servidor respondió ${response.status}.`);
  return { ok: response.ok, status: response.status, data, payload, message };
}

function resultError(result, fallback) {
  return (result && result.message) || fallback || 'No pudimos completar la operación.';
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bufToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('/mozo-sw.js', { scope: PUSH_SCOPE });
    return swRegistration;
  } catch (err) {
    return null;
  }
}

async function readyRegistration() {
  if (!pushSupported()) return null;
  if (!swRegistration) swRegistration = await registerServiceWorker();
  if (!swRegistration) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch (e) {
    return swRegistration;
  }
}

function renderPushButton(hasSubscription) {
  const btn = dom.mozoPushBtn;
  if (!btn) return;
  if (!session) {
    setHidden(btn, true);
    return;
  }
  setHidden(btn, false);
  btn.disabled = false;
  btn.setAttribute('aria-pressed', hasSubscription ? 'true' : 'false');

  if (!pushSupported()) {
    btn.textContent = '🔔 Avisos no disponibles';
    btn.disabled = true;
    btn.title = 'Este navegador no soporta notificaciones push.';
    return;
  }
  if (!pushConfigured) {
    btn.textContent = '🔔 Avisos no configurados';
    btn.disabled = true;
    btn.title = 'El local todavía no configuró las notificaciones push.';
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    btn.textContent = '🔔 Avisos bloqueados';
    btn.disabled = true;
    btn.title = 'Habilitá las notificaciones de este sitio en los ajustes del navegador.';
    return;
  }
  btn.textContent = hasSubscription ? '🔕 Desactivar avisos' : '🔔 Activar avisos';
  btn.title = hasSubscription
    ? 'Desactivar los avisos de tu turno en este dispositivo'
    : 'Recibir avisos de tu turno en este dispositivo';
}

async function refreshPushButton() {
  if (!session) return;
  if (!pushSupported()) {
    renderPushButton(false);
    return;
  }
  try {
    const registration = await readyRegistration();
    if (!registration || !registration.pushManager) {
      renderPushButton(false);
      return;
    }
    const subscription = await registration.pushManager.getSubscription();
    renderPushButton(Boolean(subscription));
  } catch (e) {
    renderPushButton(false);
  }
}

async function bindExistingPushToShift() {
  if (!session || !pushSupported()) return;
  try {
    const registration = await readyRegistration();
    if (!registration || !registration.pushManager) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await apiFetch('/api/staff/push/subscribe', {
      method: 'POST',
      token: session.token,
      body: {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: bufToBase64Url(subscription.getKey('p256dh')),
          auth: bufToBase64Url(subscription.getKey('auth'))
        }
      }
    });
  } catch (e) {
    // Best-effort: la PWA sigue usable aunque no se pueda rebindear el push.
  }
}

async function subscribePush() {
  if (pushBusy || !session) return;
  pushBusy = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showBanner('No se activaron los avisos: el navegador no dio permiso.', 'error');
      return;
    }
    const keyResponse = await apiFetch('/api/notifications/vapid-public-key');
    if (!keyResponse.ok || !keyResponse.data || !keyResponse.data.publicKey) {
      showBanner(resultError(keyResponse, 'El local no tiene configurados los avisos push.'), 'error');
      return;
    }
    const registration = await readyRegistration();
    if (!registration || !registration.pushManager) {
      showBanner('Este navegador no puede recibir avisos push.', 'error');
      return;
    }
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyResponse.data.publicKey)
      });
    }
    const response = await apiFetch('/api/staff/push/subscribe', {
      method: 'POST',
      token: session.token,
      body: {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: bufToBase64Url(subscription.getKey('p256dh')),
          auth: bufToBase64Url(subscription.getKey('auth'))
        }
      }
    });
    if (response.status === 401) {
      handleSessionLost(resultError(response));
      return;
    }
    if (!response.ok) {
      showBanner(resultError(response, 'No pudimos activar los avisos.'), 'error');
      return;
    }
    const skipped = response.data && response.data.skipped;
    if (skipped === 'PUSH_NOT_CONFIGURED') {
      pushConfigured = false;
      showBanner('El local no tiene configurados los avisos push.', 'error');
    } else {
      showBanner('Avisos activados en este dispositivo.', 'ok');
    }
    await refreshPushButton();
  } catch (err) {
    showBanner(err && err.message ? err.message : 'No pudimos activar los avisos.', 'error');
  } finally {
    pushBusy = false;
  }
}

async function unsubscribePush() {
  if (pushBusy || !session) return;
  pushBusy = true;
  try {
    const registration = await readyRegistration();
    if (!registration || !registration.pushManager) {
      showBanner('Este navegador no puede administrar avisos push.', 'error');
      return;
    }
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      await refreshPushButton();
      return;
    }
    const response = await apiFetch('/api/staff/push/subscribe', {
      method: 'DELETE',
      token: session.token,
      body: { endpoint: subscription.endpoint }
    });
    if (response.status === 401) {
      handleSessionLost(resultError(response));
      return;
    }
    if (!response.ok && response.status !== 404) {
      showBanner(resultError(response, 'No pudimos desactivar los avisos.'), 'error');
      return;
    }
    await subscription.unsubscribe();
    showBanner('Avisos desactivados en este dispositivo.', 'ok');
    await refreshPushButton();
  } catch (err) {
    showBanner(err && err.message ? err.message : 'No pudimos desactivar los avisos.', 'error');
  } finally {
    pushBusy = false;
  }
}

function renderTables(tables) {
  if (!dom.mozoTablesGrid) return;
  dom.mozoTablesGrid.replaceChildren();
  const list = Array.isArray(tables) ? tables : [];
  setText(dom.mozoTablesCount, String(list.length));
  setHidden(dom.mozoEmptyTables, list.length > 0);
  setHidden(dom.mozoTablesGrid, list.length === 0);

  for (const table of list) {
    const card = createElement('article', 'mozo-table-card');
    const number = createElement(
      'span',
      `mozo-table-number${/^\d+$/.test(String(table.number)) ? '' : ' is-custom'}`,
      table.number
    );
    const label = createElement('h3', 'mozo-table-label', table.label || `Mesa ${table.number}`);
    const caption = createElement('span', 'mozo-table-caption', 'Asignada a tu turno');
    card.append(number, label, caption);
    dom.mozoTablesGrid.append(card);
  }
}

function minutesLabel(minutes) {
  const total = Math.max(0, Number(minutes) || 0);
  if (total >= 60) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest > 0 ? `Quedan ${hours} h ${rest} min` : `Quedan ${hours} h`;
  }
  return `Quedan ${total} min`;
}

function renderSessionView() {
  if (!session) return;
  const view = buildMozoView(session, { pushConfigured, online });
  if (!view) return;

  hideGate();
  setHidden(dom.mozoShiftCard, false);
  setHidden(dom.mozoTablesSection, false);
  setHidden(dom.mozoHelpSection, false);
  setHidden(dom.mozoEndSection, false);

  setText(dom.mozoTitle, view.restaurantName);
  setText(dom.mozoSubtitle, `Turno de ${view.staffName} · ${view.roleLabel}`);
  setText(dom.mozoShiftTitle, view.staffName);
  setText(dom.mozoRoleChip, view.roleLabel);
  setText(dom.mozoExpires, formatStaffExpiry(session));
  setText(dom.mozoMinutesLeft, minutesLabel(staffSessionMinutesLeft(session)));
  if (dom.mozoTablesHint) {
    dom.mozoTablesHint.textContent = online
      ? 'Solo ves las mesas que el dueño te asignó.'
      : 'Sin conexión: mostrando las mesas guardadas en este dispositivo.';
  }
  renderTables(view.tables);
  setConnection(online ? 'online' : 'offline');
  document.title = `${view.restaurantName} · Mi turno — ScanGo`;
  refreshPushButton();
}

function applyActivation(data) {
  const next = buildStaffSessionFromActivation(data);
  if (!next) return false;
  session = next;
  persistSession();
  return true;
}

async function activate(enrollment) {
  if (!enrollment || !enrollment.complete) {
    showGate(
      'El QR está incompleto',
      'Faltan datos en el QR de turno. Pedile al dueño que lo regenere desde el Studio.',
      { retry: false }
    );
    return;
  }
  pendingEnrollment = enrollment;
  showGate('Activando tu turno…', 'Estamos verificando tu QR. Un segundo.');
  setConnection('idle');
  try {
    const response = await apiFetch('/api/staff/shift/activate', {
      method: 'POST',
      body: {
        restaurantId: enrollment.restaurantId,
        staffId: enrollment.staffId,
        secret: enrollment.secret
      }
    });
    if (!response.ok || !response.data) {
      showGate(
        'No pudimos activar tu turno',
        resultError(response, 'El QR no es válido. Pedile uno nuevo al dueño.'),
        { retry: true }
      );
      return;
    }
    if (!applyActivation(response.data)) {
      showGate(
        'No pudimos activar tu turno',
        'El servidor devolvió una sesión incompleta. Probá de nuevo o pedile un QR nuevo al dueño.',
        { retry: true }
      );
      return;
    }
    pendingEnrollment = null;
    pushConfigured = Boolean(response.data.pushConfigured);
    online = navigator.onLine !== false;
    renderSessionView();
    startTimers();
    await refreshPushButton();
    await bindExistingPushToShift();
    showBanner(`Turno activado. ¡Buen servicio, ${session.staffName || 'equipo'}!`, 'ok');
  } catch (err) {
    showGate('No pudimos activar tu turno', err && err.message ? err.message : 'Revisá tu conexión.', {
      retry: true
    });
  }
}

async function refreshMe({ silent = false } = {}) {
  if (!session) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    online = false;
    setConnection('offline');
    if (!silent) showBanner('Sin conexión: mostrando las mesas guardadas.', 'error');
    renderSessionView();
    return;
  }
  try {
    const response = await apiFetch('/api/staff/me', { token: session.token });
    if (response.status === 401) {
      handleSessionLost(resultError(response));
      return;
    }
    if (!response.ok || !response.data) {
      online = true;
      setConnection('online');
      if (!silent) showBanner(resultError(response, 'No pudimos actualizar tu turno.'), 'error');
      return;
    }
    online = true;
    pushConfigured = Boolean(response.data.pushConfigured);
    const merged = mergeStaffSessionFromMe(session, response.data);
    if (merged) {
      session = merged;
      persistSession();
    }
    renderSessionView();
  } catch (err) {
    online = typeof navigator === 'undefined' ? false : navigator.onLine !== false;
    setConnection(online ? 'online' : 'offline');
    if (!silent) showBanner(err && err.message ? err.message : 'No pudimos actualizar tu turno.', 'error');
    renderSessionView();
  }
}

async function refreshTables({ silent = false } = {}) {
  if (!session) return;
  try {
    const response = await apiFetch('/api/staff/tables', { token: session.token });
    if (response.status === 401) {
      handleSessionLost(resultError(response));
      return;
    }
    if (!response.ok || !response.data) {
      if (!silent) showBanner(resultError(response, 'No pudimos actualizar tus mesas.'), 'error');
      return;
    }
    online = true;
    session.tables = Array.isArray(response.data.tables) ? response.data.tables : [];
    persistSession();
    renderSessionView();
    if (!silent) showBanner('Mesas actualizadas.', 'ok');
  } catch (err) {
    online = false;
    setConnection('offline');
    if (!silent) showBanner(err && err.message ? err.message : 'No pudimos actualizar tus mesas.', 'error');
    renderSessionView();
  }
}

async function heartbeat() {
  if (!session || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  try {
    const response = await apiFetch('/api/staff/shift/heartbeat', {
      method: 'POST',
      token: session.token
    });
    if (response.status === 401) {
      handleSessionLost(resultError(response));
      return;
    }
    if (response.ok && response.data && response.data.expiresAt) {
      session.expiresAt = response.data.expiresAt;
      persistSession();
      renderSessionView();
    }
  } catch (e) {
    // El próximo /me o el próximo heartbeat lo reintenta.
  }
}

function stopTimers() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startTimers() {
  stopTimers();
  pollTimer = setInterval(() => {
    if (!shouldRefreshStaffSession(document.visibilityState)) return;
    refreshMe({ silent: true });
  }, MOZO_POLL_MS);
  heartbeatTimer = setInterval(() => {
    if (!shouldRefreshStaffSession(document.visibilityState)) return;
    heartbeat();
  }, MOZO_HEARTBEAT_MS);
}

function resetEndShiftArm() {
  if (endShiftTimer) {
    clearTimeout(endShiftTimer);
    endShiftTimer = null;
  }
  endShiftState = { armedAt: null };
  if (dom.mozoEndShiftBtn) {
    dom.mozoEndShiftBtn.classList.remove('is-armed');
    dom.mozoEndShiftBtn.textContent = 'Cerrar turno';
    dom.mozoEndShiftBtn.disabled = false;
  }
  setText(
    dom.mozoEndHint,
    'El cierre pide un segundo toque para evitar cortar el turno sin querer.'
  );
}

async function performEndShift() {
  if (!session) return;
  const btn = dom.mozoEndShiftBtn;
  if (btn) btn.disabled = true;
  setText(dom.mozoEndHint, 'Cerrando tu turno…');
  try {
    const response = await apiFetch('/api/staff/shift/end', {
      method: 'POST',
      token: session.token
    });
    if (response.ok || response.status === 401) {
      clearStoredSession();
      cleanupSessionView();
      showGate(
        'Turno cerrado',
        'Listo, cerraste tu turno. Para volver a entrar escaneá el QR de turno.'
      );
      return;
    }
    showBanner(resultError(response, 'No pudimos cerrar el turno. Probá de nuevo.'), 'error');
    resetEndShiftArm();
  } catch (err) {
    showBanner(err && err.message ? err.message : 'No pudimos cerrar el turno. Probá de nuevo.', 'error');
    resetEndShiftArm();
  }
}

function handleEndShiftTap() {
  const next = nextEndShiftTap(endShiftState, Date.now());
  endShiftState = next;
  if (next.confirm) {
    if (endShiftTimer) {
      clearTimeout(endShiftTimer);
      endShiftTimer = null;
    }
    performEndShift();
    return;
  }
  if (dom.mozoEndShiftBtn) {
    dom.mozoEndShiftBtn.classList.add('is-armed');
    dom.mozoEndShiftBtn.textContent = 'Tocá de nuevo para cerrar';
  }
  setText(dom.mozoEndHint, 'Segundo toque para confirmar. Si no lo hacés, el turno sigue abierto.');
  if (endShiftTimer) clearTimeout(endShiftTimer);
  endShiftTimer = setTimeout(() => {
    resetEndShiftArm();
  }, 4000);
}

async function handlePushClick() {
  if (!session || pushBusy) return;
  try {
    const registration = await readyRegistration();
    const subscription = registration && registration.pushManager
      ? await registration.pushManager.getSubscription()
      : null;
    if (subscription) await unsubscribePush();
    else await subscribePush();
  } catch (e) {
    showBanner('No pudimos administrar los avisos push.', 'error');
  }
}

function bindEvents() {
  if (dom.mozoRefreshBtn) {
    dom.mozoRefreshBtn.addEventListener('click', () => {
      refreshMe({ silent: false });
      heartbeat();
    });
  }
  if (dom.mozoRefreshTablesBtn) {
    dom.mozoRefreshTablesBtn.addEventListener('click', () => refreshTables({ silent: false }));
  }
  if (dom.mozoPushBtn) {
    dom.mozoPushBtn.addEventListener('click', handlePushClick);
  }
  if (dom.mozoEndShiftBtn) {
    dom.mozoEndShiftBtn.addEventListener('click', handleEndShiftTap);
  }
  if (dom.mozoGateRetryBtn) {
    dom.mozoGateRetryBtn.addEventListener('click', () => {
      if (pendingEnrollment) activate(pendingEnrollment);
      else if (session) refreshMe({ silent: false });
    });
  }
  window.addEventListener('online', () => {
    online = true;
    setConnection(session ? 'online' : 'idle');
    if (session) {
      refreshMe({ silent: true });
      heartbeat();
      showBanner('Volviste a estar en línea.', 'ok');
    }
  });
  window.addEventListener('offline', () => {
    online = false;
    setConnection(session ? 'offline' : 'idle');
    if (session) showBanner('Sin conexión: tus mesas quedan guardadas.', 'error');
  });
  document.addEventListener('visibilitychange', () => {
    if (!session || !shouldRefreshStaffSession(document.visibilityState)) return;
    refreshMe({ silent: true });
    heartbeat();
  });
}

async function boot() {
  if (booted) return;
  booted = true;
  cacheDom();
  bindEvents();
  resetEndShiftArm();
  setConnection('idle');
  online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  registerServiceWorker();

  const enrollment = parseEnrollmentFromLocation({
    search: window.location.search,
    hash: window.location.hash
  });

  // El fragmento se limpia ANTES de cualquier await: el secreto no debe
  // quedar en la barra de direcciones ni en el historial del dispositivo.
  if (window.location.hash) {
    const cleanUrl = stripEnrollmentFragment(window.location.href);
    try {
      window.history.replaceState(null, '', cleanUrl);
    } catch (e) {
      // Sin History API la URL queda como está; el fragmento nunca se envía.
    }
  }

  if (enrollment.complete) {
    await activate(enrollment);
    return;
  }
  if (enrollment.partial) {
    showGate(
      'El QR está incompleto',
      'Faltan datos en el QR de turno. Pedile al dueño que lo regenere desde el Studio.'
    );
    return;
  }

  const stored = readStaffSessionFromStorage(window.localStorage, STAFF_SESSION_STORAGE_KEY);
  if (!stored || !staffSessionIsUsable(stored)) {
    clearStoredSession();
    showGate(
      'Sin turno activo',
      'Escaneá el QR de turno que te dio el dueño para entrar. No hace falta email ni contraseña.'
    );
    return;
  }

  session = stored;
  showGate('Verificando tu turno…', 'Estamos actualizando tus mesas. Un segundo.');
  await refreshMe({ silent: true });
  if (session) {
    startTimers();
    if (online) hideGate();
    else renderSessionView();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
