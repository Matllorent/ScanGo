/**
 * public/js/menu/orderTracking.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Seguimiento del pedido + engagement post-pedido (extraído de menu.js sin
 * cambios de comportamiento: misma lógica, mismas strings, mismo orden).
 * Todo lo que tocaba estado del módulo menu.js llega por `ctx`:
 * {
 *   getRestaurantData: () => restaurantData,
 *   getSlug: () => slug,
 *   selectCategory: (id) => void,
 *   openReviewModal: () => void,
 *   showToast: (msg) => void
 * }
 * Sin imports fuera de public/js. Sin DOM en import (seguro en Node).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { escapeHtml } from '../utils/escapeHtmlBrowser.js';

// ── Seguimiento del pedido ─────────────────────────────────────────────
// El comensal guarda el token firmado que devuelve POST /api/orders y con
// él consulta el estado público (sin datos personales) hasta que el pedido
// se entrega o se cancela. El push de estado reabre esta misma vista.
// Multi-pedido: se guardan hasta 5 (el nuevo NO pisa el anterior); el
// FAB abre la lista para cambiar y se oculta solo cuando todos cerraron.
const ORDER_TRACKING_KEY = 'scango_active_order';
const ORDER_TRACKING_LIST_KEY = 'scango_tracked_orders';
const ORDER_TRACKING_MAX = 5;
const ORDER_TRACKING_POLL_MS = 15000;
const ORDER_TRACKING_DONE = ['delivered', 'cancelled'];
let orderTrackingTimer = null;
let pollCtx = null;

function getActiveOrder() {
  try {
    const raw = localStorage.getItem(ORDER_TRACKING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function getTrackedOrders() {
  try {
    const raw = localStorage.getItem(ORDER_TRACKING_LIST_KEY);
    const list = raw ? JSON.parse(raw) : null;
    if (Array.isArray(list) && list.length) return list;
  } catch (e) {}
  // Migración: una sola entrada vieja → lista de uno.
  const single = getActiveOrder();
  return single && single.token ? [single] : [];
}

function persistTrackedOrders(list) {
  try {
    localStorage.setItem(ORDER_TRACKING_LIST_KEY, JSON.stringify(list.slice(0, ORDER_TRACKING_MAX)));
  } catch (e) {}
}

function saveOrderTracking(entry) {
  if (!entry || !entry.token) return;
  const list = getTrackedOrders().filter(o => o.token !== entry.token);
  list.unshift({ ...entry, done: false });
  persistTrackedOrders(list);
  try { localStorage.setItem(ORDER_TRACKING_KEY, JSON.stringify({ ...entry, done: false })); } catch (e) {}
}

function markTrackedOrderDone(token, status) {
  const list = getTrackedOrders();
  let changed = false;
  for (const o of list) {
    if (o.token === token && !o.done) {
      o.done = true;
      o.status = status;
      changed = true;
    }
  }
  if (changed) persistTrackedOrders(list);
  const active = getActiveOrder();
  if (active && active.token === token) {
    try { localStorage.setItem(ORDER_TRACKING_KEY, JSON.stringify({ ...active, done: true, status })); } catch (e) {}
  }
  // Sin pendientes: el FAB deja de ofrecer seguimiento (el historial
  // queda en la lista para consulta).
  if (list.length && list.every(o => o.done)) {
    const fab = document.getElementById('orderTrackingFab');
    if (fab) fab.style.display = 'none';
    if (typeof window !== 'undefined' && typeof window.updateFabVisibility === 'function') window.updateFabVisibility();
  }
}

// Nudge de reseña post-entrega: una sola vez por pedido (el token ya
// vive en localStorage como el resto del tracking; misma sensibilidad).
const REVIEW_NUDGE_KEY = 'scango_review_nudged';
const REVIEW_NUDGE_MAX = 20;
function wasReviewNudged(token) {
  try {
    const raw = localStorage.getItem(REVIEW_NUDGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) && list.includes(token);
  } catch (e) {
    return false;
  }
}
function markReviewNudged(token) {
  if (!token) return;
  try {
    const raw = localStorage.getItem(REVIEW_NUDGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? list.filter(t => t !== token) : [];
    next.unshift(token);
    localStorage.setItem(REVIEW_NUDGE_KEY, JSON.stringify(next.slice(0, REVIEW_NUDGE_MAX)));
  } catch (e) {}
}
function openReviewNudge(ctx) {
  const token = getActiveOrder()?.token;
  markReviewNudged(token);
  const getSlug = ctx && typeof ctx.getSlug === 'function' ? ctx.getSlug : () => '';
  try {
    fetch('/api/public/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: getSlug(), event: 'review_nudge_accept' })
    }).catch(() => {});
  } catch (e) {}
  if (ctx && typeof ctx.openReviewModal === 'function') ctx.openReviewModal();
}

function selectTrackedOrder(token, ctx) {
  const found = getTrackedOrders().find(o => o.token === token);
  if (!found) return;
  try { localStorage.setItem(ORDER_TRACKING_KEY, JSON.stringify(found)); } catch (e) {}
  showOrderTrackingFab();
  openOrderTracking(ctx);
}

function clearOrderTracking() {
  try {
    localStorage.removeItem(ORDER_TRACKING_KEY);
    localStorage.removeItem(ORDER_TRACKING_LIST_KEY);
  } catch (e) {}
  stopOrderTrackingPolling();
  const fab = document.getElementById('orderTrackingFab');
  if (fab) fab.style.display = 'none';
  if (typeof window !== 'undefined' && typeof window.updateFabVisibility === 'function') window.updateFabVisibility();
}

function showOrderTrackingFab() {
  // Solo si hay al menos un pedido sin cerrar.
  const pending = getTrackedOrders().some(o => !o.done);
  const active = getActiveOrder();
  if (!pending && !(active && !active.done)) return;
  const fab = document.getElementById('orderTrackingFab');
  if (fab) fab.style.display = 'flex';
  if (typeof window !== 'undefined' && typeof window.updateFabVisibility === 'function') window.updateFabVisibility();
}

function stopOrderTrackingPolling() {
  if (orderTrackingTimer) {
    clearInterval(orderTrackingTimer);
    orderTrackingTimer = null;
  }
}

function startOrderTrackingPolling(ctx) {
  stopOrderTrackingPolling();
  pollCtx = ctx || null;
  orderTrackingTimer = setInterval(() => {
    const modal = document.getElementById('orderTrackingModal');
    if (modal && modal.classList.contains('active')) refreshOrderTracking(pollCtx);
  }, ORDER_TRACKING_POLL_MS);
}

const ORDER_TRACKING_STEPS = [
  { key: 'pending', label: 'Pedido recibido' },
  { key: 'confirmed', label: 'Confirmado por el local' },
  { key: 'preparing', label: 'En preparación' },
  { key: 'ready', label: 'Listo para retirar' },
  { key: 'on_the_way', label: 'En camino' },
  { key: 'delivered', label: 'Entregado' }
];

function reviewNudgeCopy() {
  const i18n = typeof window !== 'undefined' ? window.i18nManager : null;
  const nt = (key, fallback) => (i18n && typeof i18n.t === 'function' && i18n.t(key) !== key) ? i18n.t(key) : fallback;
  return {
    title: nt('reviewNudgeTitle', '¡Buen provecho! ¿Todo bien?'),
    text: nt('reviewNudgeText', 'Tu reseña en Google nos ayuda un montón.'),
    cta: nt('reviewNudgeCta', '⭐ Calificar mi experiencia')
  };
}

// ── F7-v2 · pick del ETA por modalidad ─────────────────────────────────
// La modalidad del pedido manda SI tiene evidencia propia (≥20 entregados de
// ESE tipo); si no, la estimación general del local. Puro e importable en
// Node: lo usan el seguimiento y el checkout (menu.js) — una sola fuente para
// la decisión y para la palabra de la copy.
const PREP_MODE_WORDS = { LOCAL: 'en salón', DELIVERY: 'en delivery', TAKEAWAY: 'para llevar' };

/**
 * @returns {null | {label: string, byMode: boolean, word: string}}
 *   `byMode=true` cuando el número elegido es el de la modalidad (la copy
 *   nombra el tipo); `word` es la etiqueta de modalidad para esa copy.
 */
function resolvePrepEstimateForMode(prepEstimate, prepEstimateByMode, orderMode) {
  const overall = prepEstimate && typeof prepEstimate === 'object' ? prepEstimate : null;
  const byMode = prepEstimateByMode && typeof prepEstimateByMode === 'object' ? prepEstimateByMode : null;
  const normalizedMode = typeof orderMode === 'string' ? orderMode.trim().toUpperCase() : '';
  const modeKey = ['LOCAL', 'DELIVERY', 'TAKEAWAY'].includes(normalizedMode) ? normalizedMode : 'LOCAL';
  const modeEstimate = byMode && byMode[modeKey] && typeof byMode[modeKey] === 'object' ? byMode[modeKey] : null;
  if (modeEstimate && modeEstimate.label) return { ...modeEstimate, byMode: true, word: PREP_MODE_WORDS[modeKey] };
  if (overall && overall.label) return { ...overall, byMode: false, word: PREP_MODE_WORDS[modeKey] };
  return null;
}

function renderOrderTracking(data, ctx) {
  const body = document.getElementById('orderTrackingBody');
  if (!body) return;
  const status = data.status || 'pending';
  const subtitle = document.getElementById('orderTrackingSubtitle');
  const metaBits = [data.restaurantName || '', data.tableNumber ? String(data.tableNumber) : ''].filter(Boolean);
  if (subtitle) subtitle.textContent = metaBits.join(' · ') || 'Mirá en qué estado está tu pedido.';

  if (status === 'cancelled') {
    body.innerHTML = '<div style="text-align:center; padding:16px 4px; color:#FEB2B2; font-size:0.9rem;">❌ Tu pedido fue cancelado. Si fue un error, escribinos por WhatsApp.</div>';
    return;
  }

  const currentIndex = Math.max(0, ORDER_TRACKING_STEPS.findIndex(s => s.key === status));
  const warning = status === 'delayed'
    ? '<div style="background:rgba(237,137,54,0.15); border:1px solid rgba(237,137,54,0.5); color:#FBD38D; font-size:0.8rem; border-radius:8px; padding:8px 10px; margin-bottom:12px;">⏳ El local avisó una demora imprevista. Tu pedido sigue en marcha.</div>'
    : '';
  const stepsHtml = ORDER_TRACKING_STEPS.map((step, index) => {
    const done = index < currentIndex;
    const active = index === currentIndex;
    const dot = done ? '✓' : (active ? '●' : '○');
    const color = done ? '#68D391' : (active ? '#63B3ED' : 'rgba(255,255,255,0.3)');
    const labelColor = done ? 'var(--chalk-dim)' : (active ? '#fff' : 'rgba(255,255,255,0.4)');
    return `<div style="display:flex; align-items:center; gap:10px; padding:5px 0;">
      <span style="color:${color}; font-size:1.05rem; width:18px; text-align:center;">${dot}</span>
      <span style="color:${labelColor}; font-size:0.88rem; font-weight:${active ? '700' : '400'};">${escapeHtml(step.label)}</span>
    </div>`;
  }).join('');

  const totalLine = (data.total != null && data.currency)
    ? `<div style="border-top:1px solid rgba(255,255,255,0.1); margin-top:12px; padding-top:10px; color:var(--chalk-gold); font-weight:700; font-size:0.9rem;">Total: ${escapeHtml(String(data.currency))} ${Number(data.total).toFixed(2)}</div>`
    : '';
  // F7 "El Tiempo Real" + F7-v2: cuánto tardan los pedidos de este local, con
  // evidencia real (el servidor exige muestra mínima; si no hay, `prepEstimate`
  // es null y esta línea no existe). La modalidad del pedido manda cuando ESE
  // tipo tiene evidencia propia; si no, el número del local completo.
  // Informativo: el estado real manda.
  const prep = resolvePrepEstimateForMode(data && data.prepEstimate, data && data.prepEstimateByMode, data && data.orderMode);
  const prepLine = (prep && prep.label && status !== 'delivered' && status !== 'cancelled')
    ? `<div style="margin-top:12px; font-size:0.82rem; color:var(--chalk-dim);">⏱ ${prep.byMode ? `Los pedidos ${prep.word} suelen tardar` : 'En este local los pedidos suelen tardar'} ${escapeHtml(String(prep.label))}.</div>`
    : '';
  // Takeaway Programado (73ª suite): la franja de retiro confirmada en el alta
  // ("hoy 14:15 hs", en el huso del dueño). Solo informativa: el estado manda.
  const scheduleLine = data.scheduledLabel && status !== 'cancelled'
    ? `<div style="margin-top:12px; font-size:0.82rem; color:#B794F4;">⏰ Retiro programado: ${escapeHtml(String(data.scheduledLabel))}</div>`
    : '';
  // 💬 Nudge post-entrega (una vez por pedido): el momento de mayor
  // conversión para pedir la reseña. Solo si el dueño configuró su link
  // de Google (si no, el Studio lo empuja a configurarlo).
  let nudgeHtml = '';
  const restaurantData = ctx && typeof ctx.getRestaurantData === 'function' ? ctx.getRestaurantData() : null;
  if (status === 'delivered' && restaurantData && restaurantData.googleReview) {
    const activeToken = getActiveOrder()?.token;
    if (activeToken && !wasReviewNudged(activeToken)) {
      const copy = reviewNudgeCopy();
      nudgeHtml = `<div style="margin-top:14px; background:rgba(236,201,75,0.08); border:1px dashed var(--border-gold); border-radius:10px; padding:12px; text-align:center;">
        <div style="font-size:1.4rem;">😋</div>
        <div style="font-weight:700; font-size:0.9rem; margin:4px 0;">${escapeHtml(copy.title)}</div>
        <div style="font-size:0.8rem; color:var(--chalk-muted); margin-bottom:10px;">${escapeHtml(copy.text)}</div>
        <button type="button" class="btn-google-review-cta" style="font-size:0.85rem; padding:10px 14px;" data-js-click="openReviewNudge">${escapeHtml(copy.cta)}</button>
      </div>`;
    }
  }
  body.innerHTML = warning + stepsHtml + prepLine + scheduleLine + totalLine + nudgeHtml;
}

function renderOrderTrackingError(message) {
  const body = document.getElementById('orderTrackingBody');
  if (body) body.innerHTML = `<div style="color:#FEB2B2; font-size:0.85rem; padding:8px 0;">${escapeHtml(message || 'No pudimos cargar el estado.')}</div>`;
}

async function refreshOrderTracking(ctx) {
  const active = getActiveOrder();
  if (!active || !active.token) {
    renderOrderTrackingError('No hay un pedido activo para seguir.');
    return;
  }
  try {
    const res = await fetch(`/api/orders/track/${encodeURIComponent(active.token)}`);
    if (res.status === 404) {
      // Solo ese pedido venció: se saca de la lista, el resto sigue.
      persistTrackedOrders(getTrackedOrders().filter(o => o.token !== active.token));
      renderOrderTrackingError('Este pedido ya no está disponible (puede haber vencido o el local lo cerró).');
      return;
    }
    const payload = await res.json();
    if (!res.ok || !payload.success) throw new Error(payload.error || 'Error');
    renderOrderTracking(payload.data || {}, ctx);
    if (payload.data && ORDER_TRACKING_DONE.includes(payload.data.status)) {
      stopOrderTrackingPolling();
      markTrackedOrderDone(active.token, payload.data.status);
    }
  } catch (e) {
    renderOrderTrackingError('No pudimos actualizar el estado. Reintentando…');
  }
}

function openOrderTracking(ctx) {
  const active = getActiveOrder();
  const modal = document.getElementById('orderTrackingModal');
  if (!modal) return;
  const tracked = getTrackedOrders();
  if (!active || !active.token) {
    // Sin pedido guardado: no abrimos una vista vacía.
    const fab = document.getElementById('orderTrackingFab');
    if (fab) fab.style.display = 'none';
    if (typeof window !== 'undefined' && typeof window.updateFabVisibility === 'function') window.updateFabVisibility();
    return;
  }
  modal.classList.add('active');
  // Varios pedidos: selector para cambiar sin perder ninguno.
  const listHost = document.getElementById('orderTrackingList');
  if (listHost) {
    if (tracked.length > 1) {
      listHost.innerHTML = tracked.map(o => {
        const isActive = o.token === active.token;
        const label = [o.restaurantName, o.tableNumber ? `Mesa ${o.tableNumber}` : ''].filter(Boolean).join(' · ') || 'Pedido';
        return `<button type="button" data-js-click="selectTrackedOrder|${escapeHtml(o.token)}" style="display:flex; justify-content:space-between; align-items:center; gap:8px; width:100%; text-align:left; background:${isActive ? 'rgba(236,201,75,0.12)' : 'transparent'}; border:1px solid ${isActive ? 'var(--border-gold)' : 'var(--border-chalk)'}; color:var(--chalk-white); border-radius:8px; padding:8px 10px; margin-bottom:6px; cursor:pointer; font-size:0.8rem;">`
          + `<span>${escapeHtml(label)}${o.done ? ' ✓' : ''}</span>`
          + `<span style="color:var(--chalk-gold); font-weight:700;">${isActive ? 'Viéndolo' : 'Ver →'}</span>`
          + `</button>`;
      }).join('');
      listHost.style.display = 'block';
    } else {
      listHost.innerHTML = '';
      listHost.style.display = 'none';
    }
  }
  renderOrderTracking({ status: 'pending', restaurantName: active.restaurantName, tableNumber: active.tableNumber }, ctx);
  refreshOrderTracking(ctx);
  startOrderTrackingPolling(ctx);
}

function closeOrderTracking() {
  const modal = document.getElementById('orderTrackingModal');
  if (modal) modal.classList.remove('active');
  stopOrderTrackingPolling();
}

function forgetOrderTracking() {
  // Oculta SOLO el pedido en vista (el resto sigue en la lista).
  const active = getActiveOrder();
  if (active && active.token) {
    persistTrackedOrders(getTrackedOrders().filter(o => o.token !== active.token));
    const rest = getTrackedOrders();
    try {
      if (rest.length) localStorage.setItem(ORDER_TRACKING_KEY, JSON.stringify(rest[0]));
      else localStorage.removeItem(ORDER_TRACKING_KEY);
    } catch (e) {}
    if (!rest.some(o => !o.done)) {
      const fab = document.getElementById('orderTrackingFab');
      if (fab) fab.style.display = 'none';
      if (typeof window !== 'undefined' && typeof window.updateFabVisibility === 'function') window.updateFabVisibility();
    }
  } else {
    clearOrderTracking();
  }
  closeOrderTracking();
}

function reopenOrderWhatsApp(ctx) {
  const restaurantData = ctx && typeof ctx.getRestaurantData === 'function' ? ctx.getRestaurantData() : null;
  const rawPhone = String((restaurantData && restaurantData.phone) || '').replace(/[^0-9]/g, '');
  if (!rawPhone) return;
  const active = getActiveOrder();
  const local = (restaurantData && restaurantData.name) || 'el local';
  const tableBit = active && active.tableNumber ? ` (Mesa ${active.tableNumber})` : '';
  const msg = `¡Hola ${local}! 👋 Quería consultar por mi pedido${tableBit}.`;
  window.open(`https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Arranca el seguimiento si llega ?track=<token> (push del local) o si hay
// un pedido activo guardado de una visita anterior.
function initOrderTracking(ctx) {
  let urlToken = '';
  let paymentStatus = '';
  try {
    const params = new URLSearchParams(window.location.search);
    urlToken = params.get('track') || '';
    paymentStatus = params.get('payment') || '';
  } catch (e) { urlToken = ''; }

  // Retorno de Mercado Pago (?payment=success|failure|pending&ref=...):
  // se muestra el estado y cómo seguir, y se limpia la URL para no
  // repetir el aviso al recargar.
  if (paymentStatus) {
    try {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('payment');
      cleanUrl.searchParams.delete('ref');
      window.history.replaceState({}, '', cleanUrl.toString());
    } catch (e) {}
    const showToast = ctx && typeof ctx.showToast === 'function' ? ctx.showToast : () => {};
    if (paymentStatus === 'success') {
      showToast('¡Pago acreditado! Ahora enviá tu pedido por WhatsApp adjuntando el comprobante.');
    } else if (paymentStatus === 'failure') {
      showToast('El pago no se completó. Podés reintentarlo o pagar al recibir.');
    } else if (paymentStatus === 'pending') {
      showToast('Tu pago está pendiente de acreditación. Te avisaremos al confirmarse.');
    }
  }

  if (urlToken) {
    const getSlug = ctx && typeof ctx.getSlug === 'function' ? ctx.getSlug : () => '';
    const restaurantData = ctx && typeof ctx.getRestaurantData === 'function' ? ctx.getRestaurantData() : null;
    saveOrderTracking({
      token: urlToken,
      slug: getSlug(),
      restaurantName: (restaurantData && restaurantData.name) || '',
      tableNumber: '',
      createdAt: Date.now()
    });
  }

  const active = getActiveOrder();
  if (!active || !active.token) return;
  showOrderTrackingFab();
  if (urlToken) openOrderTracking(ctx);
}

// Nudge al pedir la cuenta (paridad mesa del post-entrega): programa el
// modal a los 90s, una vez por día. Lo llama sendWaiterCall (menu.js).
const BILL_NUDGE_KEY = 'scango_review_nudge_bill';
const BILL_NUDGE_DELAY_MS = 90000;
// Día calendario UTC para un instante dado (reloj inyectable: permite
// congelar el tiempo en tests sin sleeps ni depender de la máquina).
function billNudgeDayFor(nowMs = Date.now()) {
  try {
    const t = new Date(Number(nowMs));
    if (Number.isNaN(t.getTime())) return '';
    return t.toISOString().slice(0, 10);
  } catch (e) {
    return '';
  }
}
// Decisión pura del nudge: solo al pedir la cuenta, solo con link de Google
// configurado y solo si hoy todavía no se mostró. Sin DOM ni reloj real.
function shouldScheduleBillNudge({ type, hasGoogleReview, lastNudgeDay, todayDay }) {
  if (type !== 'cuenta_efectivo' && type !== 'cuenta_tarjeta') return false;
  if (!hasGoogleReview) return false;
  return lastNudgeDay !== todayDay;
}
function billNudgeDay() {
  return billNudgeDayFor(Date.now());
}
function wasBillNudgedToday() {
  try {
    return localStorage.getItem(BILL_NUDGE_KEY) === billNudgeDay();
  } catch (e) {
    return true;
  }
}
function markBillNudgedToday() {
  try {
    localStorage.setItem(BILL_NUDGE_KEY, billNudgeDay());
  } catch (e) {}
}
function scheduleBillNudge(type, ctx) {
  try {
    const restaurantData = ctx && typeof ctx.getRestaurantData === 'function' ? ctx.getRestaurantData() : null;
    let lastDay = null;
    let storageOk = true;
    try {
      lastDay = localStorage.getItem(BILL_NUDGE_KEY);
    } catch (e) { storageOk = false; }
    // Sin storage no hay "una vez por día" posible: no spamear (igual que antes).
    if (!storageOk) return;
    if (!shouldScheduleBillNudge({
      type,
      hasGoogleReview: Boolean(restaurantData && restaurantData.googleReview),
      lastNudgeDay: lastDay,
      todayDay: billNudgeDay()
    })) return;
    setTimeout(() => {
      try {
        markBillNudgedToday();
        if (ctx && typeof ctx.openReviewModal === 'function') ctx.openReviewModal();
      } catch (e) {}
    }, BILL_NUDGE_DELAY_MS);
  } catch (e) {}
}

// Deep-link de plato (?dish=:id, desde Descubrir): enfoca el plato en
// la carta del local (el pedido vive solo acá). Se consume una vez.
let dishLinkConsumed = false;
function maybeOpenDishDeepLink(ctx) {
  if (dishLinkConsumed) return;
  const restaurantData = ctx && typeof ctx.getRestaurantData === 'function' ? ctx.getRestaurantData() : null;
  if (!restaurantData) return;
  let params = null;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (e) {
    return;
  }
  const rawId = params.get('dish');
  if (!rawId) return;
  const dishId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);
  if (!dishId) return;
  dishLinkConsumed = true;
  try {
    params.delete('dish');
    const qs = params.toString();
    const clean = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState(null, '', clean);
  } catch (e) {}
  flashDishCard(dishId, ctx);
}

// Deep-link de reseñas (?review=1): QR de carpa/mesa → abre el modal de
// calificación directo. Se consume una vez (limpia la URL) y no molesta
// en visitas normales.
let reviewLinkConsumed = false;
function maybeOpenReviewFromLink(ctx) {
  if (reviewLinkConsumed) return;
  const restaurantData = ctx && typeof ctx.getRestaurantData === 'function' ? ctx.getRestaurantData() : null;
  if (!restaurantData) return;
  let params = null;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (e) {
    return;
  }
  const want = params.get('review');
  if (want !== '1' && want !== 'true') return;
  reviewLinkConsumed = true;
  try {
    params.delete('review');
    const qs = params.toString();
    const clean = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState(null, '', clean);
  } catch (e) {}
  try {
    ctx.openReviewModal();
  } catch (e) {}
}

/**
 * Enfoca un plato en la carta con flash dorado (deep-link ?dish= y
 * "Ver en carta" de Stories). Si el filtro lo oculta, vuelve a TODOS.
 * Canonical y única: storiesLayout.js la importa (antes duplicada).
 */
function flashDishCard(dishId, ctx = {}) {
  if (!dishId) return;
  let card = document.getElementById('dish_card_' + dishId);
  const selectFn = ctx.selectCategory
    || (typeof window !== 'undefined' && typeof window.selectCategory === 'function' ? window.selectCategory : null);
  if ((!card || card.offsetParent === null) && selectFn) {
    try {
      selectFn('ALL');
    } catch (e) {}
    card = document.getElementById('dish_card_' + dishId);
  }
  if (!card) return;
  try {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('st-flash');
    void card.offsetWidth;
    card.classList.add('st-flash');
    if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
    card.focus({ preventScroll: true });
    setTimeout(() => { card.classList.remove('st-flash'); }, 1800);
  } catch (e) {}
}

export {
  getActiveOrder,
  getTrackedOrders,
  saveOrderTracking,
  markTrackedOrderDone,
  clearOrderTracking,
  showOrderTrackingFab,
  stopOrderTrackingPolling,
  startOrderTrackingPolling,
  renderOrderTracking,
  renderOrderTrackingError,
  resolvePrepEstimateForMode,
  refreshOrderTracking,
  openOrderTracking,
  closeOrderTracking,
  selectTrackedOrder,
  forgetOrderTracking,
  reopenOrderWhatsApp,
  initOrderTracking,
  wasReviewNudged,
  markReviewNudged,
  openReviewNudge,
  billNudgeDay,
  billNudgeDayFor,
  shouldScheduleBillNudge,
  wasBillNudgedToday,
  markBillNudgedToday,
  scheduleBillNudge,
  maybeOpenDishDeepLink,
  maybeOpenReviewFromLink,
  flashDishCard,
  ORDER_TRACKING_DONE,
  ORDER_TRACKING_POLL_MS
};
