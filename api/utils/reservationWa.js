/**
 * api/utils/reservationWa.js
 * ──────────────────────────
 * Recordatorio de reserva por WhatsApp (backlog #9, oct-2026) — módulo puro,
 * cero I/O. El cron horario ya cubre email + push (65ª suite); el canal que el
 * comensal más abre en UY/AR es WhatsApp y NO hay Cloud API: el dueño lo opera
 * con un link `wa.me` prefilled desde SU agenda (patrón F8-v2: el waLink es
 * para reenvío manual, "💬 WhatsApp" como acción del dueño — no automatiza
 * envíos).
 *
 * - Copys por estado: `requested` → el dueño confirma; `confirmed` →
 *   recordatorio. Los terminales (seated/cancelled/no_show) NO llevan link.
 * - La etiqueta del día se calcula EN el huso del dueño (`localDayKeyOf`,
 *   reloj inyectable — patrón de la casa): hoy / mañana / "el sáb 27 oct".
 * - Privacidad: el número completo vive SOLO dentro del `waLink` operativo
 *   (excepción documentada, igual que winback); nunca como campo suelto ni en
 *   logs/auditoría (ahí viaja enmascarado). El frontend muestra el link, no el
 *   número.
 * - Honestidad: teléfono/hora inválida o entrada basura → null/'' — nunca un
 *   link roto ni un mensaje sin hora.
 */
'use strict';

const {
  ACTIVE_STATUSES,
  localDayKeyOf,
  normalizeReservationPhone
} = require('./reservations');

const WA_BASE = 'https://wa.me/';
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MAX_NAME_LEN = 40;
const MAX_RESTAURANT_NAME_LEN = 60;

function _cleanText(raw, maxLen) {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/** 'sáb 27 oct' (fecha ISO local, presentada con UTC 12:00 — misma técnica del Studio). */
function prettyDate(dateIso) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || '')) ? dateIso : '';
  if (!day) return '';
  const ms = Date.parse(`${day}T12:00:00Z`);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Etiqueta del día de la reserva contra AHORA en el huso del dueño:
 * 'hoy' | 'mañana' | 'el sáb 27 oct' | ''. Pura (reloj inyectable).
 */
function reservationDayLabel(dateIso, { nowMs = Date.now(), utcOffsetMinutes = 0 } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || '')) ? dateIso : '';
  if (!day) return '';
  const today = localDayKeyOf(nowMs, utcOffsetMinutes);
  if (today && day === today) return 'hoy';
  const tomorrow = localDayKeyOf(Number(nowMs) + 86400000, utcOffsetMinutes);
  if (tomorrow && day === tomorrow) return 'mañana';
  const pretty = prettyDate(day);
  return pretty ? `el ${pretty}` : '';
}

/** '2 personas' / '1 persona' / '8+ personas' ('8+' gana sobre el número). */
function paxPhrase(reservation) {
  if (!reservation || typeof reservation !== 'object') return '';
  const label = typeof reservation.paxLabel === 'string' ? reservation.paxLabel.trim() : '';
  if (label) return `${label} personas`;
  const pax = parseInt(reservation.pax, 10);
  if (!Number.isFinite(pax) || pax < 1) return '';
  return pax === 1 ? '1 persona' : `${pax} personas`;
}

function _timeText(raw) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw || '')) ? String(raw) : '';
}

/**
 * Texto del mensaje prefilled según el estado:
 *  - requested → el dueño CONFIRMA ("¿Te la confirmamos?")
 *  - confirmed → recordatorio ("Si algo cambió, respondé este mensaje")
 *  - terminales / entrada basura / sin hora válida → '' (la ruta no attacha link).
 */
function buildReservationWaText(reservation, { restaurantName = '', nowMs = Date.now(), utcOffsetMinutes = 0 } = {}) {
  if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)) return '';
  if (!ACTIVE_STATUSES.includes(reservation.status)) return '';
  const time = _timeText(reservation.time);
  if (!time) return '';
  const name = _cleanText(reservation.name, MAX_NAME_LEN);
  const where = _cleanText(restaurantName, MAX_RESTAURANT_NAME_LEN);
  const dayLabel = reservationDayLabel(reservation.date, { nowMs, utcOffsetMinutes });
  const pax = paxPhrase(reservation);

  const intro = name ? `¡Hola ${name}!` : '¡Hola!';
  const when = [where, dayLabel ? `para ${dayLabel}` : ''].filter(Boolean).join(' ');
  const what = pax ? `${when} a las ${time}, ${pax}` : `${when} a las ${time}`;
  return reservation.status === 'requested'
    ? `💬 ${intro} Recibimos tu pedido de mesa en ${what}. ¿Te la confirmamos?`
    : `⏰ ${intro} Te recordamos tu reserva en ${what}. Si algo cambió, respondé este mensaje 🙏`;
}

/**
 * Link `wa.me` operativo con el mensaje prefilled, o null cuando no hay con
 * qué construirlo (estado terminal, teléfono inválido, hora inválida). Nunca lanza.
 */
function buildReservationWaLink(reservation, opts = {}) {
  if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)) return null;
  const digits = normalizeReservationPhone(reservation.phone);
  if (!digits) return null;
  const text = buildReservationWaText(reservation, opts);
  if (!text) return null;
  return `${WA_BASE}${digits}?text=${encodeURIComponent(text)}`;
}

module.exports = {
  WA_BASE,
  prettyDate,
  reservationDayLabel,
  paxPhrase,
  buildReservationWaText,
  buildReservationWaLink
};
