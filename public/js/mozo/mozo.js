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
import { initModalA11y } from '../modalA11y.js';
import {
  MAX_LINE_QTY,
  normalizeComanderoMenu,
  findComanderoDish,
  dishNeedsOptions,
  dishGroupsOf,
  createDraft,
  setDraftTable,
  addDraftLine,
  removeDraftLine,
  clearDraftLines,
  validateLineAgainstGroups,
  describeDraftChoices,
  buildComanderoBody,
  draftIsSubmittable,
  comanderoTicketNumber
} from './comandero.js';

const API_TIMEOUT_MS = 15000;
const BANNER_MS = 7000;
const PUSH_SCOPE = '/mozo';
const COMANDERO_QUOTE_DEBOUNCE_MS = 600;

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

// ── Estado del comandero (Fase 2) ────────────────────────────────────────────
const comandero = {
  menu: null,          // modelo normalizado (normalizeComanderoMenu)
  menuBusy: false,
  activeCategory: '',  // '' = todas
  draft: createDraft(),
  pendingDish: null,   // plato abierto en el modal de opciones
  pendingQty: 1,
  pendingSelections: new Map(), // groupId → Map(optionId → qty)
  quoteTimer: null,
  quoteAmount: null,
  quoteCurrency: '',
  idempotencyKey: '',
  sending: false
};

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
    'mozoComanderoSection',
    'mozoComanderoCount',
    'mozoComanderoHint',
    'mozoComanderoTables',
    'mozoComanderoCats',
    'mozoComanderoDishes',
    'mozoComanderoEmpty',
    'mozoComanderoEmptyTitle',
    'mozoComanderoEmptyHint',
    'mozoDraftLines',
    'mozoComanderoCart',
    'mozoCartCount',
    'mozoCartTable',
    'mozoCartTotal',
    'mozoCartSendBtn',
    'mozoOptionsModal',
    'mozoOptionsTitle',
    'mozoOptionsClose',
    'mozoOptionsGroups',
    'mozoOptionsNote',
    'mozoOptionsError',
    'mozoOptionsMinus',
    'mozoOptionsQty',
    'mozoOptionsPlus',
    'mozoOptionsAdd',
    'mozoSentModal',
    'mozoSentDetail',
    'mozoSentNew',
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
  resetComanderoState();
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
async function apiFetch(path, { method = 'GET', body = null, token = '', idempotencyKey = '' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
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
  // Comandero (Fase 2): solo el mozo comanda (cocina ve mesas/avisos).
  const canComand = session.role === 'waiter' && view.tables.length > 0;
  setHidden(dom.mozoComanderoSection, !canComand);
  setHidden(dom.mozoComanderoCart, !(canComand && comandero.draft.lines.length > 0));
  if (canComand) {
    ensureComanderoMenu();
    renderComanderoAll();
  }
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

// ── Comandero (Fase 2 del Sistema de Mozos) ──────────────────────────────────
// El mozo arma el pedido EN la mesa: mesa asignada → carta real del local →
// opciones → envío con atribución (`source='staff'` la decide el SERVER desde
// la sesión; este lado jamás la envía). El subtotal mostrado viene del
// `/api/orders/quote` existente (mismo schema); el autoritativo es el 201.

function deviceOffset() {
  try {
    return -new Date().getTimezoneOffset();
  } catch (e) {
    return 0;
  }
}

function formatMoney(amount, currency = '$') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  return `${currency || '$'} ${value.toFixed(2)}`;
}

function newIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `cmd_${crypto.randomUUID()}`;
    }
  } catch (e) {
    // Fallback determinista abajo.
  }
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function canComandNow() {
  return Boolean(
    session &&
      session.role === 'waiter' &&
      Array.isArray(session.tables) &&
      session.tables.length > 0
  );
}

function resetComanderoState() {
  if (comandero.quoteTimer) {
    clearTimeout(comandero.quoteTimer);
    comandero.quoteTimer = null;
  }
  comandero.menu = null;
  comandero.menuBusy = false;
  comandero.activeCategory = '';
  comandero.draft = createDraft();
  comandero.pendingDish = null;
  comandero.pendingQty = 1;
  comandero.pendingSelections = new Map();
  comandero.quoteAmount = null;
  comandero.quoteCurrency = '';
  comandero.idempotencyKey = '';
  comandero.sending = false;
  closeModalEl(dom.mozoOptionsModal);
  closeModalEl(dom.mozoSentModal);
  setHidden(dom.mozoComanderoSection, true);
  setHidden(dom.mozoComanderoCart, true);
}

function resetComanderoDraft() {
  comandero.draft = createDraft();
  comandero.pendingDish = null;
  comandero.pendingQty = 1;
  comandero.pendingSelections = new Map();
  comandero.quoteAmount = null;
  comandero.quoteCurrency = '';
  comandero.idempotencyKey = newIdempotencyKey();
  renderComanderoAll();
}

function renderComanderoEmpty(title, hint) {
  setHidden(dom.mozoComanderoEmpty, false);
  setText(dom.mozoComanderoEmptyTitle, title);
  setText(dom.mozoComanderoEmptyHint, hint);
  if (dom.mozoComanderoTables) dom.mozoComanderoTables.replaceChildren();
  if (dom.mozoComanderoCats) dom.mozoComanderoCats.replaceChildren();
  if (dom.mozoComanderoDishes) dom.mozoComanderoDishes.replaceChildren();
  if (dom.mozoDraftLines) dom.mozoDraftLines.replaceChildren();
  if (dom.mozoDraftLines) setHidden(dom.mozoDraftLines, true);
}

async function ensureComanderoMenu() {
  if (!session) return;
  if (!session.slug) {
    renderComanderoEmpty(
      'Sin carta disponible',
      'El dueño todavía no publicó la carta para tu local.'
    );
    return;
  }
  if (comandero.menu || comandero.menuBusy) return;
  comandero.menuBusy = true;
  renderComanderoEmpty('Cargando la carta…', 'Un segundo.');
  try {
    const response = await apiFetch(`/api/menu/${encodeURIComponent(session.slug)}`);
    if (response.status === 401) {
      handleSessionLost(resultError(response));
      return;
    }
    // `/api/menu/:slug` responde JSON crudo `{restaurant: {...}}` (sin el
    // wrapper success/data de las rutas del Studio): apiFetch lo entrega tal
    // cual en `data` → unwrap a la carta real.
    const menuPayload = response.data && response.data.restaurant
      ? response.data.restaurant
      : response.data;
    if (!response.ok || !menuPayload) {
      renderComanderoEmpty(
        'No pudimos cargar la carta',
        resultError(response, 'Reintentá con el botón ⟳ de la cabecera.')
      );
      return;
    }
    const menu = normalizeComanderoMenu(menuPayload);
    if (!menu || !menu.dishes.length) {
      renderComanderoEmpty('Carta sin platos', 'El local todavía no tiene platos publicados.');
      return;
    }
    comandero.menu = menu;
    renderComanderoAll();
  } catch (err) {
    renderComanderoEmpty(
      'No pudimos cargar la carta',
      err && err.message ? err.message : 'Reintentá con el botón ⟳ de la cabecera.'
    );
  } finally {
    comandero.menuBusy = false;
  }
}

function renderComanderoAll() {
  if (!canComandNow()) return;
  if (!comandero.menu) {
    ensureComanderoMenu();
    return;
  }
  const hasDishes = comandero.menu.dishes.length > 0;
  setHidden(dom.mozoComanderoEmpty, hasDishes);
  if (!hasDishes) return;
  renderComanderoTables();
  renderComanderoCats();
  renderComanderoDishes();
  renderDraftLines();
  updateComanderoCart();
}

function renderComanderoTables() {
  const host = dom.mozoComanderoTables;
  if (!host) return;
  host.replaceChildren();
  for (const table of session.tables || []) {
    const selected = comandero.draft.tableNumber === String(table.number);
    const chip = createElement('button', 'mozo-table-chip' + (selected ? ' is-selected' : ''));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
    chip.dataset.tableNumber = String(table.number);
    chip.textContent = table.label || `Mesa ${table.number}`;
    host.appendChild(chip);
  }
}

function renderComanderoCats() {
  const host = dom.mozoComanderoCats;
  if (!host) return;
  host.replaceChildren();
  const cats = comandero.menu.categories || [];
  const buttons = [{ id: '', name: 'Todos' }].concat(cats);
  for (const cat of buttons) {
    const selected = comandero.activeCategory === cat.id;
    const chip = createElement('button', 'mozo-cat-chip' + (selected ? ' is-selected' : ''));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
    chip.dataset.categoryId = cat.id;
    chip.textContent = cat.name || 'General';
    host.appendChild(chip);
  }
}

function renderComanderoDishes() {
  const host = dom.mozoComanderoDishes;
  if (!host) return;
  host.replaceChildren();
  const filter = comandero.activeCategory;
  const dishes = (comandero.menu.dishes || []).filter(
    (dish) => !filter || dish.categoryId === filter
  );
  if (!dishes.length) {
    host.appendChild(createElement('p', 'mozo-dishes-empty', 'No hay platos en esta categoría.'));
    return;
  }
  for (const dish of dishes) {
    const card = createElement('button', 'mozo-dish-btn' + (dish.soldOut ? ' is-soldout' : ''));
    card.type = 'button';
    card.dataset.dishId = dish.id;
    if (dish.soldOut) card.disabled = true;
    card.appendChild(createElement('span', 'mozo-dish-name', dish.name));
    const priceText = dish.free
      ? 'Sin costo'
      : dish.price != null
        ? formatMoney(dish.price, comandero.menu.currency)
        : '';
    if (priceText) card.appendChild(createElement('span', 'mozo-dish-price', priceText));
    if (dish.needsOptions) card.appendChild(createElement('span', 'mozo-dish-options', '⚙ opciones'));
    if (dish.soldOut) card.appendChild(createElement('span', 'mozo-dish-badge', 'AGOTADO'));
    host.appendChild(card);
  }
}

function renderDraftLines() {
  const host = dom.mozoDraftLines;
  if (!host) return;
  host.replaceChildren();
  const lines = comandero.draft.lines || [];
  setHidden(host, !lines.length);
  lines.forEach((line, index) => {
    const row = createElement('div', 'mozo-draft-line');
    const text = line.note ? `${line.label} · ${line.note}` : line.label;
    row.appendChild(createElement('span', 'mozo-draft-text', text));
    const remove = createElement('button', 'mozo-draft-remove', '✕');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Quitar ${line.dishName} del pedido`);
    remove.dataset.lineIndex = String(index);
    row.appendChild(remove);
    host.appendChild(row);
  });
}

function updateComanderoCart() {
  const lines = comandero.draft.lines || [];
  const canComand = canComandNow();
  setHidden(dom.mozoComanderoCart, !(canComand && lines.length > 0));
  setText(dom.mozoComanderoCount, String(lines.length));
  setText(dom.mozoCartCount, lines.length === 1 ? '1 plato' : `${lines.length} platos`);
  setText(dom.mozoCartTable, comandero.draft.tableLabel || '');
  setText(
    dom.mozoCartTotal,
    comandero.quoteAmount != null
      ? formatMoney(comandero.quoteAmount, comandero.quoteCurrency || '$')
      : ''
  );
  const check = draftIsSubmittable(comandero.draft, comandero.menu);
  if (dom.mozoCartSendBtn) dom.mozoCartSendBtn.disabled = !check.ok || comandero.sending;
}

function scheduleComanderoQuote() {
  if (comandero.quoteTimer) clearTimeout(comandero.quoteTimer);
  comandero.quoteTimer = setTimeout(runComanderoQuote, COMANDERO_QUOTE_DEBOUNCE_MS);
}

async function runComanderoQuote() {
  comandero.quoteTimer = null;
  if (!session || !comandero.draft.lines.length) {
    comandero.quoteAmount = null;
    updateComanderoCart();
    return;
  }
  const body = buildComanderoBody(comandero.draft, {
    restaurantId: session.restaurantId,
    utcOffsetMinutes: deviceOffset()
  });
  if (!body) return;
  try {
    const response = await apiFetch('/api/orders/quote', { method: 'POST', body });
    const amount = response.ok && response.data ? Number(response.data.amount) : NaN;
    if (Number.isFinite(amount)) {
      comandero.quoteAmount = amount;
      comandero.quoteCurrency = String((response.data && response.data.currency) || '$');
    } else {
      // Error de quote (mínimo, cerrado, opciones): total "—" y el banner
      // honesto sale al intentar enviar — el server es la autoridad final.
      comandero.quoteAmount = null;
    }
  } catch (err) {
    comandero.quoteAmount = null;
  }
  updateComanderoCart();
}

/* ── Modal de opciones ─────────────────────────────────────────────────────── */

function openModalEl(el) {
  if (!el) return;
  el.classList.add('active');
  el.removeAttribute('hidden');
}

function closeModalEl(el) {
  if (!el) return;
  el.classList.remove('active');
  el.setAttribute('hidden', '');
}

function setOptionsError(message) {
  if (!dom.mozoOptionsError) return;
  setText(dom.mozoOptionsError, message);
  setHidden(dom.mozoOptionsError, !message);
}

function openComanderoOptions(dish) {
  const menu = comandero.menu;
  if (!menu || !dish) return;
  comandero.pendingDish = dish;
  comandero.pendingQty = 1;
  comandero.pendingSelections = new Map();
  setText(dom.mozoOptionsTitle, dish.name);
  setText(dom.mozoOptionsQty, '1');
  if (dom.mozoOptionsNote) dom.mozoOptionsNote.value = '';
  setOptionsError('');
  renderOptionsGroups();
  openModalEl(dom.mozoOptionsModal);
}

function closeComanderoOptions() {
  comandero.pendingDish = null;
  comandero.pendingQty = 1;
  comandero.pendingSelections = new Map();
  closeModalEl(dom.mozoOptionsModal);
}

function renderOptionsGroups() {
  const host = dom.mozoOptionsGroups;
  if (!host) return;
  host.replaceChildren();
  const dish = comandero.pendingDish;
  const menu = comandero.menu;
  if (!dish || !menu) return;
  for (const group of dishGroupsOf(dish, menu.groups)) {
    const fieldset = createElement('div', 'mozo-opt-group');
    fieldset.setAttribute('role', 'group');
    fieldset.setAttribute('aria-label', group.name || 'Opciones');
    fieldset.appendChild(
      createElement('p', 'mozo-opt-group-name', `${group.name || 'Opciones'}${group.required ? ' · obligatorio' : ''}`)
    );
    const isPresentation = group.kind === 'presentation';
    const mode = isPresentation
      ? 'single'
      : ['multiple', 'quantity', 'quantity_split'].includes(group.selectionMode)
        ? group.selectionMode
        : 'single';
    const isQtyMode = mode === 'quantity' || mode === 'quantity_split';
    for (const option of group.options || []) {
      if (!option || option.active === false) continue;
      if (!isQtyMode) {
        const btn = createElement('button', 'mozo-opt-btn');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
        btn.dataset.groupId = group.id;
        btn.dataset.optionId = option.id;
        btn.dataset.mode = mode;
        btn.appendChild(createElement('span', 'mozo-opt-name', option.name));
        const deltaCents = Number(option.priceDeltaCents) || 0;
        if (deltaCents > 0) {
          btn.appendChild(
            createElement('span', 'mozo-opt-delta', `+${formatMoney(deltaCents / 100, menu.currency)}`)
          );
        }
        fieldset.appendChild(btn);
      } else {
        const row = createElement('div', 'mozo-opt-qty-row');
        const deltaCents = Number(option.priceDeltaCents) || 0;
        const name = deltaCents > 0
          ? `${option.name} (+${formatMoney(deltaCents / 100, menu.currency)})`
          : option.name;
        row.appendChild(createElement('span', 'mozo-opt-name', name));
        const minus = createElement('button', 'mozo-opt-step', '−');
        minus.type = 'button';
        minus.setAttribute('aria-label', `Quitar una unidad de ${option.name}`);
        minus.dataset.groupId = group.id;
        minus.dataset.optionId = option.id;
        minus.dataset.step = '-1';
        const value = createElement('span', 'mozo-opt-value', '0');
        value.dataset.groupId = group.id;
        value.dataset.optionId = option.id;
        const plus = createElement('button', 'mozo-opt-step', '+');
        plus.type = 'button';
        plus.setAttribute('aria-label', `Agregar una unidad de ${option.name}`);
        plus.dataset.groupId = group.id;
        plus.dataset.optionId = option.id;
        plus.dataset.step = '1';
        row.appendChild(minus);
        row.appendChild(value);
        row.appendChild(plus);
        fieldset.appendChild(row);
      }
    }
    host.appendChild(fieldset);
  }
  syncOptionsPressed();
}

function syncOptionsPressed() {
  const host = dom.mozoOptionsGroups;
  if (!host) return;
  host.querySelectorAll('button.mozo-opt-btn[data-group-id]').forEach((btn) => {
    const groupSel = comandero.pendingSelections.get(btn.dataset.groupId);
    const selected = Boolean(groupSel && groupSel.get(btn.dataset.optionId));
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    btn.classList.toggle('is-selected', selected);
  });
  host.querySelectorAll('.mozo-opt-value[data-option-id]').forEach((el) => {
    const groupSel = comandero.pendingSelections.get(el.dataset.groupId);
    const qty = groupSel && groupSel.get(el.dataset.optionId) ? groupSel.get(el.dataset.optionId) : 0;
    el.textContent = String(qty);
  });
}

function toggleOption(groupId, optionId, mode) {
  if (!groupId || !optionId) return;
  let groupSel = comandero.pendingSelections.get(groupId);
  if (!groupSel) {
    groupSel = new Map();
    comandero.pendingSelections.set(groupId, groupSel);
  }
  if (mode === 'single') {
    groupSel.clear();
    groupSel.set(optionId, 1);
  } else if (groupSel.get(optionId)) {
    groupSel.delete(optionId);
  } else {
    groupSel.set(optionId, 1);
  }
  syncOptionsPressed();
}

function adjustOptionQty(groupId, optionId, step) {
  if (!groupId || !optionId || !comandero.pendingDish || !comandero.menu) return;
  const group = dishGroupsOf(comandero.pendingDish, comandero.menu.groups)
    .find((candidate) => candidate.id === groupId);
  const option = group && Array.isArray(group.options)
    ? group.options.find((candidate) => candidate && candidate.id === optionId)
    : null;
  if (!option) return;
  const maxQty = Number(option.maxQuantity) > 0 ? Number(option.maxQuantity) : 100;
  let groupSel = comandero.pendingSelections.get(groupId);
  if (!groupSel) {
    groupSel = new Map();
    comandero.pendingSelections.set(groupId, groupSel);
  }
  const next = Math.max(0, Math.min(maxQty, (groupSel.get(optionId) || 0) + (step > 0 ? 1 : -1)));
  if (next === 0) groupSel.delete(optionId);
  else groupSel.set(optionId, next);
  syncOptionsPressed();
}

function choicesFromPending() {
  const menu = comandero.menu;
  const dish = comandero.pendingDish;
  if (!menu || !dish) return [];
  const out = [];
  for (const group of dishGroupsOf(dish, menu.groups)) {
    const groupSel = comandero.pendingSelections.get(group.id);
    if (!groupSel || !groupSel.size) continue;
    const isQtyMode =
      group.kind !== 'presentation' &&
      (group.selectionMode === 'quantity' || group.selectionMode === 'quantity_split');
    const selections = [];
    for (const [optionId, qty] of groupSel.entries()) {
      selections.push(isQtyMode && qty > 1 ? { optionId, quantity: qty } : { optionId });
    }
    out.push({ groupId: group.id, selections });
  }
  return out;
}

function handleOptionsQty(step) {
  const next = Math.max(1, Math.min(MAX_LINE_QTY, comandero.pendingQty + step));
  comandero.pendingQty = next;
  setText(dom.mozoOptionsQty, String(next));
}

function handleOptionsAdd() {
  const dish = comandero.pendingDish;
  const menu = comandero.menu;
  if (!dish || !menu) return;
  const choices = choicesFromPending();
  const validation = validateLineAgainstGroups(dish, choices, menu.groups);
  if (!validation.ok) {
    setOptionsError(validation.error);
    return;
  }
  const added = addDraftLine(comandero.draft, {
    dishId: dish.id,
    dishName: dish.name,
    quantity: comandero.pendingQty,
    note: dom.mozoOptionsNote ? dom.mozoOptionsNote.value : '',
    choices
  });
  if (!added) {
    setOptionsError('El pedido llegó al máximo de líneas. Enviá este pedido primero.');
    return;
  }
  const choicesText = describeDraftChoices(dish, choices, menu.groups);
  added.label = describeDraftLine(added) + (choicesText ? ` · ${choicesText}` : '');
  closeComanderoOptions();
  renderComanderoAll();
  scheduleComanderoQuote();
  showBanner('Agregado al pedido.', 'ok');
}

/* ── Envío del pedido ──────────────────────────────────────────────────────── */

function showSentModal(order) {
  const lines = (comandero.draft.lines || []).length;
  const parts = [
    `Ticket ${comanderoTicketNumber(order)}`,
    comandero.draft.tableLabel || 'Mesa',
    lines === 1 ? '1 plato' : `${lines} platos`
  ];
  const total = Number(order && order.total);
  if (Number.isFinite(total)) {
    parts.push(`Total ${formatMoney(total, (order && order.currency) || comandero.menu.currency || '$')}`);
  }
  setText(dom.mozoSentDetail, parts.join(' · '));
  openModalEl(dom.mozoSentModal);
}

async function handleCartSend() {
  if (comandero.sending || !session) return;
  const check = draftIsSubmittable(comandero.draft, comandero.menu);
  if (!check.ok) {
    showBanner(check.error || 'Completá el pedido antes de enviarlo.', 'error');
    return;
  }
  const menu = comandero.menu;
  for (const line of comandero.draft.lines) {
    const dish = findComanderoDish(menu, line.dishId);
    const validation = validateLineAgainstGroups(dish, line.choices, menu.groups);
    if (!validation.ok) {
      showBanner(`${line.dishName}: ${validation.error}`, 'error');
      return;
    }
  }
  const body = buildComanderoBody(comandero.draft, {
    restaurantId: session.restaurantId,
    utcOffsetMinutes: deviceOffset()
  });
  if (!body) return;
  // Una clave por borrador: un retry tras un error de red reutiliza la MISMA
  // clave y el idempotency middleware deduplica (adiós pedido doble por
  // doble tap). Solo un envío exitoso genera una nueva.
  if (!comandero.idempotencyKey) comandero.idempotencyKey = newIdempotencyKey();
  comandero.sending = true;
  if (dom.mozoCartSendBtn) dom.mozoCartSendBtn.disabled = true;
  try {
    const response = await apiFetch('/api/orders', {
      method: 'POST',
      token: session.token,
      idempotencyKey: comandero.idempotencyKey,
      body
    });
    if (response.status === 401) {
      handleSessionLost(resultError(response));
      return;
    }
    if (!response.ok) {
      showBanner(resultError(response, 'No pudimos enviar el pedido. Reintentá.'), 'error');
      return;
    }
    // 201 (o 200 de idempotencia: el pedido ya existía). Éxito = modal + reset.
    showSentModal(response.data || {});
    resetComanderoDraft();
  } catch (err) {
    showBanner(err && err.message ? err.message : 'No pudimos enviar el pedido. Reintentá.', 'error');
  } finally {
    comandero.sending = false;
    if (dom.mozoCartSendBtn && comandero.draft.lines.length) {
      dom.mozoCartSendBtn.disabled = !draftIsSubmittable(comandero.draft, comandero.menu).ok;
    }
    updateComanderoCart();
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
  // ── Comandero (Fase 2) ──
  if (dom.mozoCartSendBtn) dom.mozoCartSendBtn.addEventListener('click', handleCartSend);
  if (dom.mozoOptionsClose) dom.mozoOptionsClose.addEventListener('click', closeComanderoOptions);
  if (dom.mozoOptionsAdd) dom.mozoOptionsAdd.addEventListener('click', handleOptionsAdd);
  if (dom.mozoOptionsMinus) dom.mozoOptionsMinus.addEventListener('click', () => handleOptionsQty(-1));
  if (dom.mozoOptionsPlus) dom.mozoOptionsPlus.addEventListener('click', () => handleOptionsQty(1));
  if (dom.mozoSentNew) dom.mozoSentNew.addEventListener('click', () => closeModalEl(dom.mozoSentModal));
  // Delegados (grids re-renderizados: un solo listener sobre el contenedor).
  if (dom.mozoComanderoTables) {
    dom.mozoComanderoTables.addEventListener('click', (event) => {
      const chip = event.target && event.target.closest
        ? event.target.closest('button[data-table-number]')
        : null;
      if (!chip || !session) return;
      const table = (session.tables || []).find(
        (candidate) => candidate && String(candidate.number) === chip.dataset.tableNumber
      );
      if (!table) return;
      setDraftTable(comandero.draft, table);
      renderComanderoTables();
      updateComanderoCart();
      scheduleComanderoQuote();
    });
  }
  if (dom.mozoComanderoCats) {
    dom.mozoComanderoCats.addEventListener('click', (event) => {
      const chip = event.target && event.target.closest
        ? event.target.closest('button[data-category-id]')
        : null;
      if (!chip) return;
      comandero.activeCategory = chip.dataset.categoryId || '';
      renderComanderoCats();
      renderComanderoDishes();
    });
  }
  if (dom.mozoComanderoDishes) {
    dom.mozoComanderoDishes.addEventListener('click', (event) => {
      const card = event.target && event.target.closest
        ? event.target.closest('button[data-dish-id]')
        : null;
      if (!card || !comandero.menu) return;
      const dish = findComanderoDish(comandero.menu, card.dataset.dishId);
      if (!dish || dish.soldOut) return;
      if (dishNeedsOptions(dish, comandero.menu.groups)) {
        openComanderoOptions(dish);
        return;
      }
      const added = addDraftLine(comandero.draft, {
        dishId: dish.id,
        dishName: dish.name,
        quantity: 1,
        note: '',
        choices: []
      });
      if (!added) {
        showBanner('El pedido llegó al máximo de líneas. Enviá este pedido primero.', 'error');
        return;
      }
      renderComanderoAll();
      scheduleComanderoQuote();
      showBanner('Agregado al pedido.', 'ok');
    });
  }
  if (dom.mozoDraftLines) {
    dom.mozoDraftLines.addEventListener('click', (event) => {
      const btn = event.target && event.target.closest
        ? event.target.closest('button[data-line-index]')
        : null;
      if (!btn) return;
      removeDraftLine(comandero.draft, Number(btn.dataset.lineIndex));
      renderComanderoAll();
      scheduleComanderoQuote();
    });
  }
  if (dom.mozoOptionsGroups) {
    dom.mozoOptionsGroups.addEventListener('click', (event) => {
      const target = event.target && event.target.closest
        ? event.target.closest('button[data-group-id], button[data-step]')
        : null;
      if (!target || !comandero.pendingDish) return;
      if (target.dataset.step) {
        adjustOptionQty(target.dataset.groupId, target.dataset.optionId, Number(target.dataset.step));
        return;
      }
      toggleOption(target.dataset.groupId, target.dataset.optionId, target.dataset.mode);
    });
  }
  if (dom.mozoOptionsModal) {
    dom.mozoOptionsModal.addEventListener('click', (event) => {
      if (event.target === dom.mozoOptionsModal) closeComanderoOptions();
    });
  }
  if (dom.mozoSentModal) {
    dom.mozoSentModal.addEventListener('click', (event) => {
      if (event.target === dom.mozoSentModal) closeModalEl(dom.mozoSentModal);
    });
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
  // El enhancer COMPARTIDO de modales (menú + Studio + PWA del mozo): trampa
  // de foco, Escape y restauración del disparador para los 2 modales nuevos.
  initModalA11y();
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
