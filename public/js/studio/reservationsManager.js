/**
 * public/js/studio/reservationsManager.js
 * ─────────────────────────────────────────
 * Agenda de RESERVAS del dueño (backlog #2, oct-2026) — el complemento del
 * chip "Reservar Mesa" del menú, que dejó de ser solo WhatsApp.
 *
 * El dueño ve UN día a la vez (default: hoy en SU huso — el server lo resuelve
 * con `utcOffsetMinutes`), confirma o cancela solicitudes y ve el anillo del
 * Club (visitas de ese teléfono en ESTE local, leído de fidelización — el
 * teléfono ya es PK E.164 ahí, el cruce es gratis).
 *
 * Reglas de la casa:
 *  - Cero `on*=` / `window.confirm` / `alert`; cancelar y marcar no-show piden
 *    `showConfirmDialog` en modo promesa (sin UI disponible el default seguro
 *    es NO ejecutar la acción).
 *  - Render con DOM API (`createElement` + `textContent`), nunca `innerHTML`.
 *  - Los errores del server se muestran honestos (401 re-login, 403
 *    suscripción, 409 transición inválida) — nunca un verde falso.
 */
import { apiFetch } from './api.js';
import { showConfirmDialog } from './ui/confirmDialog.js';

// ── Constantes (espejo de api/utils/reservations.js — paridad testeada) ─────

const STATUS_META = Object.freeze({
  requested: { label: 'Solicitada', tone: 'warn' },
  confirmed: { label: 'Confirmada', tone: 'ok' },
  seated: { label: 'Sentada', tone: 'info' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
  no_show: { label: 'No vino', tone: 'muted' }
});

export function reservationStatusMeta(status) {
  return STATUS_META[status] || { label: 'Desconocida', tone: 'muted' };
}

/**
 * Acciones disponibles según el estado (misma máquina que el server:
 * requested→confirmed|cancelled, confirmed→seated|no_show|cancelled).
 */
export function allowedActions(status) {
  switch (status) {
    case 'requested':
      return { confirm: true, seat: false, noShow: false, cancel: true };
    case 'confirmed':
      return { confirm: false, seat: true, noShow: true, cancel: true };
    default:
      return { confirm: false, seat: false, noShow: false, cancel: false };
  }
}

/** Orden por hora (empate → id): la agenda se lee de arriba a abajo. */
export function sortReservationsByTime(list) {
  return (Array.isArray(list) ? list : []).slice().sort(
    (a, b) => String(a?.time || '').localeCompare(String(b?.time || '')) || String(a?.id || '').localeCompare(String(b?.id || ''))
  );
}

/** Contadores del resumen (puros, tolerantes a basura). */
export function summarizeReservations(list) {
  const out = { total: 0, requested: 0, confirmed: 0, seated: 0, cancelled: 0, noShow: 0 };
  for (const r of Array.isArray(list) ? list : []) {
    if (!r) continue;
    out.total++;
    if (r.status === 'requested') out.requested++;
    else if (r.status === 'confirmed') out.confirmed++;
    else if (r.status === 'seated') out.seated++;
    else if (r.status === 'cancelled') out.cancelled++;
    else if (r.status === 'no_show') out.noShow++;
  }
  return out;
}

/** "8+" gana sobre el número puro. */
export function paxText(reservation) {
  if (reservation && typeof reservation.paxLabel === 'string' && reservation.paxLabel) {
    return reservation.paxLabel;
  }
  const pax = parseInt(reservation && reservation.pax, 10);
  return Number.isFinite(pax) && pax > 0 ? String(pax) : '—';
}

/** Anillo del Club: solo si el teléfono tiene cuenta (texto listo para UI). */
export function clubText(club) {
  if (!club || !club.localVisits) return '';
  return `Club · ${club.localVisits} ${club.localVisits === 1 ? 'visita' : 'visitas'}${club.level ? ` · ${club.level}` : ''}`;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Etiqueta del día elegido: "Hoy · vie 26 oct" / "Mañana · sáb 27 oct" /
 * "sáb 27 oct" / ISO si la fecha es basura. Pura (hoy viene inyectado).
 */
export function dateLabel(dayIso, todayIso) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(dayIso || '')) ? dayIso : '';
  if (!day) return String(dayIso || '') || '';
  const ms = Date.parse(`${day}T12:00:00Z`);
  if (Number.isNaN(ms)) return day;
  const d = new Date(ms);
  const pretty = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(todayIso || ''))) {
    if (day === todayIso) return `Hoy · ${pretty}`;
    if (Date.parse(`${day}T00:00:00Z`) === Date.parse(`${todayIso}T00:00:00Z`) + 86400000) {
      return `Mañana · ${pretty}`;
    }
  }
  return pretty;
}

// ── DOM / wiring ────────────────────────────────────────────────────────────

let reservationsState = { date: '', reservations: [], counts: null, allowReservations: true };
const busyIds = new Set();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function setHidden(node, hidden) {
  if (!node) return;
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

function setStatus(message, tone = '') {
  const node = document.getElementById('reservationsBanner');
  if (!node) return;
  node.textContent = message || '';
  node.classList.remove('is-error', 'is-ok');
  if (tone === 'error') node.classList.add('is-error');
  if (tone === 'ok') node.classList.add('is-ok');
  setHidden(node, !message);
}

function errorMessage(err, fallback) {
  if (err && err.status === 401) return 'Tu sesión venció. Recargá la página e iniciá sesión de nuevo.';
  if (err && err.status === 403) return err.message || 'Tu suscripción no permite esta acción.';
  return (err && err.message) || fallback || 'No pudimos completar la operación.';
}

function todayLocalIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function createActionButton(label, { ariaLabel, tone = '', disabled = false, onClick }) {
  const button = el('button', `staff-action-btn${tone ? ` ${tone}` : ''}`, label);
  button.type = 'button';
  button.setAttribute('aria-label', ariaLabel || label);
  button.disabled = Boolean(disabled);
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function toneChip(status) {
  const meta = reservationStatusMeta(status);
  const chip = el('span', `res-status-chip res-tone-${meta.tone}`, meta.label);
  return chip;
}

function renderCounts(counts, dayIso) {
  const box = document.getElementById('reservationsCounts');
  if (!box) return;
  box.textContent = '';
  const c = counts || summarizeReservations(reservationsState.reservations);
  // El server manda `day` (total del día); el fallback local calcula `total`.
  const total = Number.isFinite(c.total) ? c.total : (Number(c.day) || 0);
  const items = [
    { label: dateLabel(dayIso, todayLocalIso()), value: `${total}`, cls: 'res-c-total' },
    { label: 'Sin confirmar', value: `${c.requested}`, cls: 'res-c-warn' },
    { label: 'Confirmadas', value: `${c.confirmed}`, cls: 'res-c-ok' },
    { label: 'Sentadas', value: `${c.seated}`, cls: 'res-c-info' },
    { label: 'Canceladas', value: `${c.cancelled}`, cls: 'res-c-danger' },
    { label: 'No vinieron', value: `${c.noShow}`, cls: 'res-c-muted' }
  ];
  for (const item of items) {
    const chip = el('span', `res-count-chip ${item.cls}`);
    const num = el('strong', null, item.value);
    const lab = el('span', null, ` ${item.label}`);
    chip.appendChild(num);
    chip.appendChild(lab);
    box.appendChild(chip);
  }
}

function renderRow(reservation) {
  const row = el('article', `res-row is-${reservation.status}`);
  row.dataset.reservationId = reservation.id || '';

  const time = el('div', 'res-time', reservation.time || '--:--');
  row.appendChild(time);

  const main = el('div', 'res-main');
  const head = el('div', 'res-head');
  head.appendChild(el('strong', 'res-name', reservation.name || 'Comensal'));
  head.appendChild(el('span', 'res-pax', ` · ${paxText(reservation)} pax`));
  if (reservation.club) {
    const club = clubText(reservation.club);
    if (club) head.appendChild(el('span', 'res-club', ` · ${club}`));
  }
  main.appendChild(head);

  main.appendChild(el('div', 'res-phone', `📱 ${reservation.phone || '—'}${reservation.email ? ` · ✉️ ${reservation.email}` : ''}`));
  if (reservation.notes) main.appendChild(el('div', 'res-note', `📝 ${reservation.notes}`));
  if (reservation.status === 'cancelled' && reservation.cancelReason) {
    main.appendChild(el('div', 'res-cancelled-reason', reservation.cancelReason));
  }
  row.appendChild(main);

  const side = el('div', 'res-side');
  side.appendChild(toneChip(reservation.status));

  const actions = allowedActions(reservation.status);
  if (actions.confirm || actions.seat || actions.noShow || actions.cancel) {
    const group = el('div', 'res-actions');
    if (actions.confirm) {
      group.appendChild(createActionButton('✓ Confirmar', {
        ariaLabel: `Confirmar la reserva de ${reservation.name || 'comensal'} a las ${reservation.time}`,
        tone: 'is-ok',
        disabled: busyIds.has(reservation.id),
        onClick: () => setReservationStatus(reservation.id, 'confirmed')
      }));
    }
    if (actions.seat) {
      group.appendChild(createActionButton('🪑 Sentada', {
        ariaLabel: `Marcar como sentada la reserva de ${reservation.name || 'comensal'}`,
        tone: 'is-info',
        disabled: busyIds.has(reservation.id),
        onClick: () => setReservationStatus(reservation.id, 'seated')
      }));
    }
    if (actions.noShow) {
      group.appendChild(createActionButton('🚫 No vino', {
        ariaLabel: `Marcar no-show la reserva de ${reservation.name || 'comensal'} a las ${reservation.time}`,
        tone: 'is-warn',
        disabled: busyIds.has(reservation.id),
        onClick: () => setReservationStatus(reservation.id, 'no_show')
      }));
    }
    if (actions.cancel) {
      group.appendChild(createActionButton('✕ Cancelar', {
        ariaLabel: `Cancelar la reserva de ${reservation.name || 'comensal'} a las ${reservation.time}`,
        tone: 'is-danger',
        disabled: busyIds.has(reservation.id),
        onClick: () => setReservationStatus(reservation.id, 'cancelled')
      }));
    }
    side.appendChild(group);
  }
  row.appendChild(side);
  return row;
}

function renderReservations() {
  const listEl = document.getElementById('reservationsList');
  const emptyEl = document.getElementById('reservationsEmpty');
  if (!listEl) return;
  listEl.textContent = '';
  const rows = reservationsState.reservations;
  for (const reservation of rows) listEl.appendChild(renderRow(reservation));
  setHidden(emptyEl, rows.length > 0);
  renderCounts(reservationsState.counts, reservationsState.date);
}

// ── Acciones ────────────────────────────────────────────────────────────────

/**
 * Carga la agenda de un día (default: el valor del date picker; si está
 * vacío, el server responde "hoy en el huso del dueño" y acá lo dejamos
 * escrito en el input para que el dueño vea qué día está mirando).
 */
export async function loadReservations(options = {}) {
  const listEl = document.getElementById('reservationsList');
  if (!listEl) return { ok: false, skipped: 'NO_DOM' };

  const input = document.getElementById('reservationsDate');
  const date = (options && options.date) || (input && input.value) || '';
  setHidden(emptySafe(), true);
  setStatus('');

  try {
    const payload = await apiFetch(`/api/reservations${date ? `?date=${encodeURIComponent(date)}` : ''}`);
    const data = payload.data || payload;
    reservationsState = {
      date: data.date || date,
      reservations: sortReservationsByTime(data.reservations || []),
      counts: data.counts || null,
      allowReservations: data.allowReservations !== false
    };
    if (input && !input.value && reservationsState.date) input.value = reservationsState.date;
    renderReservations();
    if (!reservationsState.allowReservations) {
      setStatus('El botón de reservas está apagado en Mi Local — podés atender lo que ya llegó.', '');
    }
    return { ok: true, data: reservationsState };
  } catch (err) {
    reservationsState = { date, reservations: [], counts: null, allowReservations: true };
    renderReservations();
    setStatus(errorMessage(err, 'No pudimos cargar las reservas.'), 'error');
    return { ok: false, error: err };
  }
}

function emptySafe() {
  return document.getElementById('reservationsEmpty');
}

/** Cambio de día en el date picker. */
export function changeReservationsDate(value) {
  const input = document.getElementById('reservationsDate');
  if (input && value) input.value = String(value);
  return loadReservations({ date: value });
}

/**
 * Transición del dueño. Cancelar y no-show piden confirmación explícita
 * (destructivos: liberan/queman la mesa); confirmar y sentar son directos.
 * v1: el motivo de cancelación es fijo ("Cancelada por el local") — el
 * diálogo compartido aún no soporta input de texto.
 */
export async function setReservationStatus(reservationId, status) {
  if (!reservationId || !status) return { ok: false };
  const needsConfirm = status === 'cancelled' || status === 'no_show';
  if (needsConfirm) {
    const ok = await showConfirmDialog({
      icon: status === 'cancelled' ? '🚫' : '🪑',
      title: status === 'cancelled' ? '¿Cancelar la reserva?' : '¿Marcar como no vino?',
      message: status === 'cancelled'
        ? 'El lugar queda libre. El comensal no recibe email en esta versión.'
        : 'Queda registrada como no-show para tu registro del día.',
      confirmText: status === 'cancelled' ? 'Sí, cancelar' : 'Sí, no vino',
      confirmClass: 'btn-danger'
    });
    if (!ok) return { ok: false, skipped: 'CONFIRM_CANCELLED' };
  }

  busyIds.add(reservationId);
  renderReservations();
  try {
    await apiFetch(`/api/reservations/${encodeURIComponent(reservationId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    setStatus(status === 'confirmed' ? 'Reserva confirmada ✓' : 'Reserva actualizada ✓', 'ok');
    await loadReservations({ date: reservationsState.date });
    return { ok: true };
  } catch (err) {
    setStatus(errorMessage(err, 'No pudimos actualizar la reserva.'), 'error');
    await loadReservations({ date: reservationsState.date });
    return { ok: false, error: err };
  } finally {
    busyIds.delete(reservationId);
  }
}
