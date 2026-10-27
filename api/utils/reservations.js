/**
 * api/utils/reservations.js
 * ──────────────────────────
 * "Reservas de verdad" (backlog #2, oct-2026) — módulo puro, cero I/O.
 * Hoy "Reservar Mesa" es solo un chip que abre WhatsApp con el mensaje
 * prefilled: el dueño no sabe quién reservó, no puede confirmar ni marcar
 * no-show, y el comensal nunca recibe recordatorio (30/50% de no-shows
 * según el patrón Fornno — docs/competitor-fornno.md R1).
 *
 * Este módulo concentra TODA la decisión (como openStatus/reviewNudge/
 * churnRecovery): parseo del alta, capacidad por franja, máquina de estados
 * y selección de recordatorios para el cron. Las capas con I/O (db.js,
 * routes/reservations.js, cron) solo consultan acá.
 *
 * Estados mínimos (docs/kds-reservas-roadmap.md §4):
 *   requested → confirmed | cancelled        (el comensal pide; el dueño confirma)
 *   confirmed → seated | no_show | cancelled (llegó / no vino / canceló)
 *   seated | cancelled | no_show → terminales (no hay ida y vuelta)
 *
 * Persistencia: `restaurant.reservations[]` DENTRO del documento del local
 * (dual-write JSON↔Supabase vía la columna `profile` de restaurants — misma
 * vía que branches/tableAssignments). Cero migración: la data nueva viaja en
 * el doc que ya se replica. El array es SERVER-OWNED: `reservations` está en
 * PRIVILEGED_FIELDS, así el autosave del Studio jamás lo pisa con un
 * snapshot vago (el mismo tratamiento que `recoveryCoupons`).
 *
 * Honesto ante la carrera (deliberate skip de v1, mismo patrón que F8-v2):
 * dos POST para la MISMA franja en el mismo instante pueden pasar la
 * capacidad (el mutex serializa la ESCRITURA, no check+escritura). Un slot
 * sobrecargado por 1 se ve en el Studio y el dueño cancela; nunca corrompe
 * el documento.
 */

'use strict';

// ── Catálogos ────────────────────────────────────────────────────────────────

const RESERVATION_STATUSES = ['requested', 'confirmed', 'seated', 'cancelled', 'no_show'];
/** Reservas que ocupan una franja futura (las terminales y `seated` no). */
const ACTIVE_STATUSES = ['requested', 'confirmed'];
const TERMINAL_STATUSES = ['cancelled', 'no_show'];

/** Máquina de estados: tabla total (la que consume transitionReservationStatus). */
const RESERVATION_TRANSITIONS = Object.freeze({
  requested: ['confirmed', 'cancelled'],
  confirmed: ['seated', 'no_show', 'cancelled'],
  seated: [],
  cancelled: [],
  no_show: []
});

/** Límites honestos del roadmap §4: defaults server-side, sin config del dueño en v1. */
const RESERVATION_CONFIG_DEFAULTS = Object.freeze({
  maxPerSlot: 4,          // reservas activas simultáneas en la MISMA fecha+hora
  slotBufferMinutes: 30,  // separación mínima entre reservas del mismo día
  maxPax: 12,             // tope de comensales por reserva ("8+" cuenta como 8)
  maxAdvanceDays: 60      // no se reserva más lejos de 60 días
});

/** Cap del array persistido: un local jamás acumula reservas sin cota. */
const MAX_RESERVATIONS = 500;
/** Tope de recordatorios por corrida del cron (mismo patrón que review-nudge 150). */
const REMINDER_MAX_PER_RUN = 200;

// ── Helpers de tiempo (convención de la casa: local = UTC + offset) ─────────

function _pad(n) { return String(n).padStart(2, '0'); }

function clampOffset(raw) {
  const off = Number(raw);
  if (!Number.isFinite(off)) return -180; // UY/AR, default del producto (F1)
  return Math.max(-840, Math.min(840, Math.round(off)));
}

/** Día local 'YYYY-MM-DD' de un instante (espejo de nightSummary.localDayKeyOf). */
function localDayKeyOf(dateLike, utcOffsetMinutes = 0) {
  const ms = toMs(dateLike);
  if (Number.isNaN(ms)) return null;
  const local = new Date(ms + clampOffset(utcOffsetMinutes) * 60000);
  return `${local.getUTCFullYear()}-${_pad(local.getUTCMonth() + 1)}-${_pad(local.getUTCDate())}`;
}

function toMs(dateLike) {
  if (dateLike instanceof Date) return dateLike.getTime();
  const n = Number(dateLike);
  if (Number.isFinite(n) && String(dateLike).trim() !== '') return n;
  const parsed = Date.parse(String(dateLike || ''));
  return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * Instante UTC de una reserva local `date` + `time` en el huso del dueño.
 * La carta parsea la fecha/hora que el comensal vio SIEMPRE en hora local:
 * utcMs = Date.parse(date + 'T' + time + 'Z') − off*60000.
 * Devuelve null ante fecha/hora inválida (nunca inventa).
 */
function localReservationStartUtcMs({ date, time }, utcOffsetMinutes = 0) {
  const off = clampOffset(utcOffsetMinutes);
  const day = typeof date === 'string' ? date : '';
  const hhmm = typeof time === 'string' ? time : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const asUtc = Date.parse(`${day}T${hhmm}:00Z`);
  if (Number.isNaN(asUtc)) return null;
  return asUtc - off * 60000;
}

// ── Teléfono ────────────────────────────────────────────────────────────────

/**
 * Teléfono del comensal por DÍGITOS (misma semántica que recoveryCoupons):
 * '+598 99 123 456', '598-99-123-456' y '0059899123456' son el mismo número.
 * El servicio de notificaciones push y fidelización normalizan por su lado
 * (findCustomerByPhone/suscripciones), así que dígito puro matchea E.164.
 */
function normalizeReservationPhone(raw) {
  if (typeof raw !== 'string') return '';
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 8 || digits.length > 20) return '';
  return digits;
}

// ── Parseo del alta del comensal ────────────────────────────────────────────

function _sanitizeShortText(raw, maxLen) {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/**
 * Valida y normaliza el input de alta. NO decide capacidad (eso hace
 * assertSlotAvailable contra las reservas existentes). Devuelve
 * { ok, errors: [{field, code, message}], value } — errors VACÍO cuando ok.
 */
function parseReservationInput(raw, { nowMs = Date.now(), utcOffsetMinutes = 0, config = {} } = {}) {
  const cfg = resolveReservationConfig(config);
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [{ field: 'body', code: 'VALIDATION_ERROR', message: 'Body inválido' }], value: null };
  }

  const value = {};

  // Nombre del titular (obligatorio: es lo primero que lee el mozo).
  const name = _sanitizeShortText(raw.name, 80);
  if (!name) errors.push({ field: 'name', code: 'RESERVATION_NAME_REQUIRED', message: 'Ingresá tu nombre.' });
  else value.name = name;

  // Teléfono del comensal (obligatorio: recordatorio + anillo con el Club).
  const phone = normalizeReservationPhone(raw.phone);
  if (!phone) errors.push({ field: 'phone', code: 'RESERVATION_PHONE_INVALID', message: 'Ingresá un teléfono válido (mínimo 8 dígitos).' });
  else value.phone = phone;

  // Email opcional: el recordatorio 24h también viaja por push si hay
  // suscripción; el email es el canal que no requiere nada previo.
  const emailRaw = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  if (emailRaw) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) || emailRaw.length > 120) {
      errors.push({ field: 'email', code: 'RESERVATION_EMAIL_INVALID', message: 'El email no parece válido.' });
    } else {
      value.email = emailRaw;
    }
  }

  // Fecha local (YYYY-MM-DD): ni pasada ni más lejos de maxAdvanceDays.
  const date = typeof raw.date === 'string' ? raw.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    errors.push({ field: 'date', code: 'RESERVATION_DATE_INVALID', message: 'Elegí una fecha válida.' });
  } else {
    const localToday = localDayKeyOf(nowMs, utcOffsetMinutes);
    const maxDate = localDayKeyOf(Number(nowMs) + cfg.maxAdvanceDays * 86400000, utcOffsetMinutes);
    if (localToday && date < localToday) {
      errors.push({ field: 'date', code: 'RESERVATION_DATE_PAST', message: 'La fecha no puede ser anterior a hoy.' });
    } else if (maxDate && date > maxDate) {
      errors.push({ field: 'date', code: 'RESERVATION_DATE_TOO_FAR', message: `No se reserva con más de ${cfg.maxAdvanceDays} días de anticipación.` });
    } else {
      value.date = date;
    }
  }

  // Hora local (HH:MM 24h).
  const time = typeof raw.time === 'string' ? raw.time.trim() : '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    errors.push({ field: 'time', code: 'RESERVATION_TIME_INVALID', message: 'Elegí un horario (HH:MM).' });
  } else {
    value.time = time;
  }

  // Comensales: el select del menú manda '8+' para mesa larga.
  const paxRaw = raw.pax;
  if (paxRaw === '8+') {
    value.pax = 8;
    value.paxLabel = '8+';
  } else {
    const pax = parseInt(paxRaw, 10);
    if (!Number.isFinite(pax) || pax < 1 || pax > cfg.maxPax) {
      errors.push({ field: 'pax', code: 'RESERVATION_PAX_INVALID', message: `Elegí la cantidad de comensales (1 a ${cfg.maxPax}).` });
    } else {
      value.pax = pax;
    }
  }

  // Nota del comensal (ocasión especial, alergias).
  const notes = _sanitizeShortText(raw.notes, 200);
  if (notes) value.notes = notes;

  if (errors.length) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value };
}

/** Config con defaults coaccionados (nunca NaN/0 loco): regla única compartida. */
function resolveReservationConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const int = (v, fallback, min, max) => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };
  return {
    maxPerSlot: int(src.maxPerSlot, RESERVATION_CONFIG_DEFAULTS.maxPerSlot, 1, 50),
    slotBufferMinutes: int(src.slotBufferMinutes, RESERVATION_CONFIG_DEFAULTS.slotBufferMinutes, 0, 240),
    maxPax: int(src.maxPax, RESERVATION_CONFIG_DEFAULTS.maxPax, 1, 50),
    maxAdvanceDays: int(src.maxAdvanceDays, RESERVATION_CONFIG_DEFAULTS.maxAdvanceDays, 1, 365)
  };
}

// ── Capacidad por franja ────────────────────────────────────────────────────

function _timeToMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ''));
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * ¿Hay lugar en la franja pedida? Solo cuentan reservas ACTIVAS
 * (requested/confirmed) del MISMO día: una cancelada o un no-show libera.
 * - `SLOT_FULL`: ya hay maxPerSlot reservas activas a esa hora exacta.
 * - `BUFFER_TOO_CLOSE`: otra reserva activa empieza a menos de
 *   slotBufferMinutes de distancia (p.ej. 20:00 vs 20:15 con buffer 30).
 * El route mapea ambos a UN código público (409 SLOT_UNAVAILABLE) para no
 * darle al comensal el detalle interno de la agenda.
 */
function assertSlotAvailable(existingReservations, input, config = {}) {
  const cfg = resolveReservationConfig(config);
  const list = Array.isArray(existingReservations) ? existingReservations : [];
  const startMin = _timeToMinutes(input && input.time);
  if (startMin === null) return { ok: false, reason: 'RESERVATION_TIME_INVALID' };

  const sameDay = list.filter(r =>
    r && r.date === input.date && ACTIVE_STATUSES.includes(r.status)
  );

  const sameTime = sameDay.filter(r => _timeToMinutes(r.time) === startMin);
  if (sameTime.length >= cfg.maxPerSlot) return { ok: false, reason: 'SLOT_FULL' };

  for (const r of sameDay) {
    const otherMin = _timeToMinutes(r.time);
    if (otherMin === null) continue; // fila basura no bloquea (fail-open)
    if (otherMin === startMin) continue; // la MISMA hora la gobierna maxPerSlot (no el buffer: |0| < 30 la mataría siempre)
    if (Math.abs(otherMin - startMin) < cfg.slotBufferMinutes) {
      return { ok: false, reason: 'BUFFER_TOO_CLOSE' };
    }
  }
  return { ok: true };
}

/**
 * Cap del array persistido: el overflow (len − max) se DROPEA por conteo —
 * ANTES las terminales más viejas (basura que ya no decide nada), después
 * las más viejas que queden. Nunca dropea una activa si hay una terminal
 * más vieja disponible. Pura: devuelve array nuevo en el orden original
 * (más vieja primero): el Studio ordena por hora y el cron busca por id.
 */
function trimReservationsList(list, max = MAX_RESERVATIONS) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (arr.length <= max) return arr;
  const overflow = arr.length - max;
  const dropped = new Set();
  // 1) terminales más viejas primero (son las que liberan lugar sin coste)
  for (const r of arr) {
    if (dropped.size >= overflow) break;
    if (TERMINAL_STATUSES.includes(r.status)) dropped.add(r);
  }
  // 2) si aún falta, las más viejas que queden (activas incluidas)
  for (const r of arr) {
    if (dropped.size >= overflow) break;
    dropped.add(r);
  }
  return arr.filter(r => !dropped.has(r));
}

// ── Máquina de estados (tabla manda) ────────────────────────────────────────

/**
 * { ok: true } | { ok: false, reason: 'INVALID_RESERVATION_STATUS' | 'INVALID_RESERVATION_TRANSITION' }.
 * La tabla es la especificación: requested y confirmed son los únicos estados
 * con salida; seated/cancelled/no_show son terminales.
 */
function transitionReservationStatus(current, next) {
  const from = String(current || '');
  const to = String(next || '');
  if (!RESERVATION_STATUSES.includes(to)) {
    return { ok: false, reason: 'INVALID_RESERVATION_STATUS' };
  }
  const allowed = RESERVATION_TRANSITIONS[from];
  if (!allowed) return { ok: false, reason: 'INVALID_RESERVATION_STATUS' };
  if (!allowed.includes(to)) return { ok: false, reason: 'INVALID_RESERVATION_TRANSITION' };
  return { ok: true };
}

/** Etiquetas ES + tono para el chip del Studio (mirroring describeOrderStatus). */
function describeReservationStatus(status) {
  switch (status) {
    case 'requested': return { label: 'Solicitada', tone: 'warn' };
    case 'confirmed': return { label: 'Confirmada', tone: 'ok' };
    case 'seated': return { label: 'Sentada', tone: 'info' };
    case 'cancelled': return { label: 'Cancelada', tone: 'danger' };
    case 'no_show': return { label: 'No vino', tone: 'muted' };
    default: return { label: 'Desconocida', tone: 'muted' };
  }
}

// ── Selección de recordatorios (cron 24h) ───────────────────────────────────

/**
 * Candidatos a recordatorio: reservas CONFIRMADAS que empiezan dentro de la
 * ventana [windowHours[0], windowHours[1]] horas hacia adelante (default
 * [23, 25]: el cron horario atrapa todas con dedupe por reserva). Demos
 * fuera (nunca inventan tráfico); sin slug fuera (el push/email linkean el
 * menú); start inválido fuera (no se inventa la hora de una reserva rota).
 * Pura: nunca muta el array de entrada.
 */
function selectReservationReminders(restaurants, { nowMs = Date.now(), windowHours = [23, 25], max = REMINDER_MAX_PER_RUN } = {}) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  const [loH, hiH] = Array.isArray(windowHours) && windowHours.length === 2 && Number.isFinite(windowHours[0]) && Number.isFinite(windowHours[1])
    ? windowHours
    : [23, 25];
  const lo = Math.min(loH, hiH), hi = Math.max(loH, hiH);
  const candidates = [];
  for (const restaurant of list) {
    if (!restaurant || !restaurant.id || !restaurant.slug) continue;
    if (restaurant.isDemo === true) continue;
    const reservations = Array.isArray(restaurant.reservations) ? restaurant.reservations : [];
    const offset = clampOffset(restaurant.utcOffsetMinutes);
    for (const reservation of reservations) {
      if (!reservation || !reservation.id) continue;
      if (reservation.status !== 'confirmed') continue;
      const startUtcMs = localReservationStartUtcMs({ date: reservation.date, time: reservation.time }, offset);
      if (startUtcMs === null) continue;
      const deltaHours = (startUtcMs - nowMs) / 3600000;
      if (deltaHours < lo || deltaHours > hi) continue;
      candidates.push({
        restaurantId: restaurant.id,
        restaurantSlug: restaurant.slug,
        restaurantName: restaurant.name || restaurant.bizName || '',
        reservationId: reservation.id,
        date: reservation.date,
        time: reservation.time,
        pax: reservation.pax,
        name: reservation.name || '',
        phone: reservation.phone || '',
        email: typeof reservation.email === 'string' ? reservation.email : '',
        startUtcMs
      });
      if (candidates.length >= max) return candidates;
    }
  }
  return candidates;
}

module.exports = {
  RESERVATION_STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  RESERVATION_TRANSITIONS,
  RESERVATION_CONFIG_DEFAULTS,
  MAX_RESERVATIONS,
  REMINDER_MAX_PER_RUN,
  localDayKeyOf,
  localReservationStartUtcMs,
  normalizeReservationPhone,
  parseReservationInput,
  resolveReservationConfig,
  assertSlotAvailable,
  trimReservationsList,
  transitionReservationStatus,
  describeReservationStatus,
  selectReservationReminders
};
