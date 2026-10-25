/**
 * public/js/kitchen/kitchen.js
 * ─────────────────────────────────────────────────────────────────────────────
 * KDS "Vista Kitchen" (F2 del bloque "El Sistema", oct-2026) — pizarra de
 * cocina para el dueño: tablet fullscreen dedicada, SIN navegación y SIN
 * endpoints nuevos. Reutiliza TODO lo que ya existe:
 *  - Sesión: cookie del Studio (window.AuthClient, mismo flujo) + `GET
 *    /api/auth/me` para resolver el local; sin sesión no hay data (gate
 *    honesto, la pizarra no inventa).
 *  - Data: `GET /api/orders/restaurant/:id` (dual-mode + outbox) y avance de
 *    estado con `PATCH /api/orders/status/:orderId` — cero contrato nuevo.
 *  - Lógica: tabla de decisión + modelo de tarjeta en el módulo puro
 *    `kitchenColumns.js`; antigüedad en `orderAging.js`; confirmación
 *    destructiva en `studio/ui/confirmDialog.js` (nunca diálogos nativos);
 *    accesibilidad de modales en `modalA11y.js`.
 *
 * Reglas de la casa: cero `on*=` (listeners por addEventListener), cero
 * HTML-injection en el render (todo createElement + textContent), errores en
 * banner/gate propios (nunca diálogos nativos de bloqueo), polling de 20s
 * solo con la pestaña visible (mismo patrón de Pedidos en vivo) y beep
 * WebAudio sin assets.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  KITCHEN_COLUMNS,
  buildKitchenCardModel,
  KITCHEN_STATUS_LABELS,
  nextKitchenStatus
} from './kitchenColumns.js';
import { formatOrderAge, orderAgeLevel, orderAgeStyle } from '../studio/orderAging.js';
import { showConfirmDialog, closeConfirmDialog } from '../studio/ui/confirmDialog.js';
import { initModalA11y } from '../modalA11y.js';

const POLL_MS = 20000;
const CLOCK_MS = 30000;
const MAX_CARDS = 60;         // el archivo no es cocina: 60 pedidos alcanzan
const MAX_PER_COLUMN = 12;    // los entregados no acumulan tarjeta eterna

let restaurantId = null;
let orders = [];
let pollTimer = null;
let seenNewIds = new Set();   // pedidos YA avisados (beep solo ante novedades)
let baselineDone = false;

const el = (id) => document.getElementById(id);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── Sesión + data ──────────────────────────────────────────────────────────

function authHeaders(extra) {
  const base = window.AuthClient ? window.AuthClient.getAuthHeaders({}) : {};
  return Object.assign({}, base, extra || {});
}

async function checkSession() {
  try {
    const res = await fetch('/api/auth/me', { headers: authHeaders(), cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.restaurant ? body : null;
  } catch {
    return null;
  }
}

async function fetchOrders() {
  if (!restaurantId) return;
  showBanner('');
  let res;
  try {
    res = await fetch(`/api/orders/restaurant/${encodeURIComponent(restaurantId)}`, {
      headers: authHeaders(),
      cache: 'no-store'
    });
  } catch {
    showBanner('Sin conexión con el server: la pizarra reintenta sola en 20s.');
    return;
  }
  if (res.status === 401) {
    stopPolling();
    renderBoard();
    openGate('Tu sesión venció. Volvé a entrar desde el Studio para seguir cocinando.');
    return;
  }
  if (!res.ok) {
    showBanner('No se pudieron cargar los pedidos (la pizarra sigue mostrando lo último que vio).');
    return;
  }
  const body = await res.json();
  const list = body && Array.isArray(body.data) ? body.data : [];
  orders = list.slice(0, MAX_CARDS);
  announceNew();
  renderBoard();
}

// ── Avisos de pedidos nuevos (beep WebAudio + live region) ────────────────

function announceNew() {
  const fresh = orders.filter((o) => !seenNewIds.has(o.id) && (o.status || 'pending') === 'pending');
  if (!fresh.length) return;
  if (baselineDone) {
    playOrderAlert();
    const live = el('kdsLive');
    if (live) {
      live.textContent = fresh.length === 1
        ? 'Nuevo pedido en cola'
        : `${fresh.length} pedidos nuevos en cola`;
    }
  }
  for (const o of fresh) seenNewIds.add(o.id);
}

function playOrderAlert() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const at = i * 0.22;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.18);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* el beep jamás rompe la pizarra */ }
}

// ── Render (DOM API pura: cero HTML-injection con data) ─────────────────────────

function renderBoard() {
  const buckets = new Map(KITCHEN_COLUMNS.map((c) => [c.id, []]));
  let cancelledCount = 0;

  for (const order of orders) {
    const model = buildKitchenCardModel(order);
    if (!model) continue;
    if (model.cancelled) { cancelledCount += 1; continue; }
    const bucket = buckets.get(model.columnId);
    if (bucket) bucket.push(model);
  }

  for (const col of KITCHEN_COLUMNS) {
    const body = el(`colBody${cap(col.id)}`);
    const count = el(`colCount${cap(col.id)}`);
    if (!body || !count) continue;
    body.textContent = '';
    const bucket = buckets.get(col.id);
    count.textContent = String(bucket.length);
    const list = col.id === 'delivered' ? bucket.slice(0, MAX_PER_COLUMN) : bucket;

    if (!bucket.length) {
      const empty = document.createElement('div');
      empty.className = 'kds-col-empty';
      empty.textContent = col.id === 'queue' ? 'Sin pedidos en cola' : '—';
      body.appendChild(empty);
      continue;
    }
    for (const model of list) body.appendChild(renderCard(model));
  }

  noteCancelled(cancelledCount);
  baselineDone = true;
}

function noteCancelled(n) {
  // Los cancelados del día quedan informados de forma discreta: la cocina no
  // los trabaja, pero el dueño ve que existieron (nada desaparece en silencio).
  const note = el('kdsCancelledNote');
  if (!note) return;
  if (!n) {
    note.hidden = true;
    note.textContent = '';
    return;
  }
  note.hidden = false;
  note.textContent = n === 1
    ? '1 pedido del día fue cancelado (no pinta en la pizarra).'
    : `${n} pedidos del día fueron cancelados (no pintan en la pizarra).`;
}

function renderCard(model) {
  const card = document.createElement('article');
  card.className = 'kds-card';
  card.dataset.orderId = model.id;
  if (model.pending) card.dataset.orderPending = 'true';
  if (model.delayed) card.classList.add('kds-card-delayed');

  // Fila 1: ticket + mesa + antigüedad (lo importante, en grande)
  const head = document.createElement('div');
  head.className = 'kds-card-head';
  const ticket = document.createElement('strong');
  ticket.className = 'kds-ticket';
  ticket.textContent = model.ticketNumber;
  head.appendChild(ticket);

  if (model.table) {
    const chip = document.createElement('span');
    chip.className = 'kds-chip';
    chip.textContent = `Mesa ${model.table}`;
    head.appendChild(chip);
  }
  if (model.pending) {
    const chip = document.createElement('span');
    chip.className = 'kds-chip kds-chip-new';
    chip.textContent = '● NUEVO';
    head.appendChild(chip);
  }
  if (model.delayed) {
    const chip = document.createElement('span');
    chip.className = 'kds-chip kds-chip-delayed';
    chip.textContent = 'Demorado';
    head.appendChild(chip);
  }
  const age = document.createElement('span');
  age.className = 'kds-age';
  const level = orderAgeLevel(model.createdAt, Date.now(), model.status);
  const style = orderAgeStyle(level);
  age.style.color = style.color;
  age.style.fontWeight = style.weight;
  age.textContent = `⏱ ${formatOrderAge(model.createdAt, Date.now())}`;
  head.appendChild(age);
  card.appendChild(head);

  // Fila 2: cliente (sirve al entregar en mostrador)
  if (model.customer) {
    const cust = document.createElement('div');
    cust.className = 'kds-customer';
    cust.textContent = model.customer;
    card.appendChild(cust);
  }

  // Fila 3: ítems con qty, modificadores y nota por ítem (alérgenos) en rojo
  const items = document.createElement('ul');
  items.className = 'kds-items';
  for (const line of model.items) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'kds-item-name';
    name.textContent = line.label;
    li.appendChild(name);
    for (const mod of line.mods) {
      const modEl = document.createElement('span');
      modEl.className = 'kds-item-mod';
      modEl.textContent = mod;
      li.appendChild(modEl);
    }
    if (line.note) {
      const noteEl = document.createElement('span');
      noteEl.className = 'kds-item-note';
      noteEl.textContent = line.note;
      li.appendChild(noteEl);
    }
    items.appendChild(li);
  }
  if (model.items.length) card.appendChild(items);

  // Fila 4: nota general del comensal en rojo
  if (model.notes) {
    const notes = document.createElement('div');
    notes.className = 'kds-notes';
    notes.textContent = model.notes;
    card.appendChild(notes);
  }

  // Fila 5: acciones — avanzar un estado por toque; cancelar SOLO con
  // confirmación (showConfirmDialog, nunca window.confirm).
  if (!model.terminal) {
    const next = nextKitchenStatus(model.status);
    const actions = document.createElement('div');
    actions.className = 'kds-actions';
    if (next) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'kds-btn kds-btn-primary kds-btn-advance';
      go.textContent = `⬆ ${KITCHEN_STATUS_LABELS[next] || next}`;
      go.setAttribute('aria-label', `Marcar ${model.ticketNumber} como ${KITCHEN_STATUS_LABELS[next] || next}`);
      go.addEventListener('click', () => patchStatus(model.id, next));
      actions.appendChild(go);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'kds-btn kds-btn-danger kds-btn-cancel';
    cancel.textContent = '✕ Cancelar';
    cancel.setAttribute('aria-label', `Cancelar pedido ${model.ticketNumber}`);
    cancel.addEventListener('click', () => cancelOrder(model.id));
    actions.appendChild(cancel);
    card.appendChild(actions);
  }

  return card;
}

// ── Mutaciones (avanzar / cancelar): el mismo PATCH del Studio ────────────

async function patchStatus(orderId, status) {
  let res;
  try {
    res = await fetch(`/api/orders/status/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status })
    });
  } catch {
    showBanner('Sin conexión: el estado no cambió (probá de nuevo en segundos).');
    return;
  }
  if (res.status === 401) {
    stopPolling();
    openGate('Tu sesión venció. Entrá de nuevo desde el Studio.');
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    showBanner(body.error || 'No se pudo actualizar el estado del pedido.');
    return;
  }
  // Optimista: el PATCH ya confirmó el estado, movemos la tarjeta al toque.
  const o = orders.find((x) => x && x.id === orderId);
  if (o) o.status = status;
  renderBoard();
  fetchOrders(); // el refresco de fondo corrige cualquier drift con la nube
}

async function cancelOrder(orderId) {
  let ok = false;
  try {
    ok = Boolean(await Promise.resolve(showConfirmDialog({
      icon: '⚠️',
      title: 'Cancelar pedido',
      message: 'El comensal lo verá como cancelado al instante. ¿Continuar?',
      confirmText: 'Sí, cancelar'
    })));
  } catch {
    ok = false;
  }
  if (ok) await patchStatus(orderId, 'cancelled');
}

// ── Polling 20s + reloj + banner/gate ──────────────────────────────────────

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') fetchOrders();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fetchOrders();
  });
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

let bannerTimer = null;
function showBanner(text) {
  const banner = el('kdsBanner');
  if (!banner) return;
  if (bannerTimer) clearTimeout(bannerTimer);
  if (!text) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  banner.hidden = false;
  banner.textContent = text;
  bannerTimer = setTimeout(() => {
    banner.hidden = true;
    banner.textContent = '';
  }, 8000);
}

function openGate(message) {
  const gate = el('kdsGate');
  if (!gate) return;
  const msg = el('kdsGateMessage');
  if (msg && message) msg.textContent = message;
  gate.hidden = false;
}

function tickClock() {
  const clock = el('kdsClock');
  if (!clock) return;
  clock.textContent = new Date().toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
  // Antigüedades vivas sin re-fetch: los chips ⏱ re-renderizan con el estado
  // local que ya confirmó el server (mismo patrón del ticker del Studio).
  if (restaurantId && document.visibilityState === 'visible') renderBoard();
}

function wireConfirmModal() {
  const accept = el('confirmDialogAcceptBtn');
  const cancel = el('confirmDialogCancelBtn');
  const close = el('confirmDialogCloseBtn');
  const modal = el('confirmActionModal');
  if (accept) accept.addEventListener('click', () => closeConfirmDialog(true));
  if (cancel) cancel.addEventListener('click', () => closeConfirmDialog(false));
  if (close) close.addEventListener('click', () => closeConfirmDialog(false));
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeConfirmDialog(false);
    });
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
  initModalA11y();
  wireConfirmModal();
  tickClock();
  setInterval(tickClock, CLOCK_MS);

  const refreshBtn = el('kdsRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => fetchOrders());

  const session = await checkSession();
  if (!session) {
    renderBoard(); // columnas vacías; el gate tapa la data (no hay nada)
    openGate('Necesitás iniciar sesión en el Studio para ver la pizarra de cocina.');
    return;
  }
  const restaurant = session.restaurant || {};
  restaurantId = restaurant.id || restaurant.slug || null;
  const place = el('kdsRestaurantName');
  if (place) place.textContent = restaurant.bizName || restaurant.name || '';
  if (!restaurantId) {
    openGate('Tu usuario todavía no tiene un local asociado. Crealo desde el Studio.');
    return;
  }
  await fetchOrders();
  startPolling();
}

document.addEventListener('DOMContentLoaded', boot);
