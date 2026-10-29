/**
 * public/js/utils/pickupSlots.js — Espejo ESM de api/utils/pickupSlots.js
 * (Takeaway Programado V1, 73ª suite, oct-2026). Paridad EXACTA testeada
 * sobre corpus determinista (mismo patrón que dishStation/viralRef).
 *
 * Módulo PURO: cero I/O, cero DOM, cero imports fuera de public/js (CSP).
 * `pickupVerdictError` queda SOLO backend (requiere ./AppError, que en el
 * frontend no existe: la grilla no valida nada client-side, el alta es la
 * autoridad). Los relojes de frontera del día se replican de nightSummary
 * con la MISMA fórmula (local = UTC + offset con getUTC*).
 */

// Intervalos que dividen 1440 (una vuelta completa): la grilla nunca se
// desalinea entre un día y el siguiente. Fuera de la lista → default.
export const PICKUP_INTERVALS = [5, 10, 15, 20, 30, 60];
export const DEFAULT_INTERVAL_MINUTES = 15;
export const DEFAULT_MAX_PER_SLOT = 4;
export const MAX_LEAD_MINUTES = 240;      // hasta 4 horas de anticipación declarada
export const MAX_MAX_PER_SLOT = 50;
export const PICKUP_HORIZON_DAYS = 2;     // hoy + mañana
export const PICKUP_AUTO_MARGIN_MINUTES = 10; // margen del lead derivado de F7
export const MAX_SLOTS = 48;              // tope de la grilla en el payload
export const MINUTES_PER_DAY = 1440;

/** Sanea `restaurant.pickupConfig`. Basura/vacío → null (campo ABSENT). */
export function sanitizePickupConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cfg = {};
  const iv = Math.round(Number(value.intervalMinutes));
  cfg.intervalMinutes = PICKUP_INTERVALS.includes(iv) ? iv : DEFAULT_INTERVAL_MINUTES;
  const mps = Math.round(Number(value.maxPerSlot));
  cfg.maxPerSlot = Number.isFinite(mps) ? Math.max(1, Math.min(MAX_MAX_PER_SLOT, mps)) : DEFAULT_MAX_PER_SLOT;
  // lead ABSENT si vacío/basura ('' → 0 NO vale: '' significa "auto")
  const rawLead = value.leadMinutes;
  if (rawLead !== '' && rawLead != null) {
    const lead = Math.round(Number(rawLead));
    if (Number.isFinite(lead)) cfg.leadMinutes = Math.max(0, Math.min(MAX_LEAD_MINUTES, lead));
  }
  return cfg;
}

/**
 * Lead del local en minutos: el explícito del dueño gana; si no, p50 de
 * TAKEAWAY (F7-v2) + margen; sin ninguno → null (no opera).
 */
export function computeLeadMinutes(pickupConfig, prepEstimateByMode) {
  const cfg = sanitizePickupConfig(pickupConfig) || {};
  if (cfg.leadMinutes != null) return cfg.leadMinutes;
  const take = prepEstimateByMode && typeof prepEstimateByMode === 'object' ? prepEstimateByMode.TAKEAWAY : null;
  const p50 = take ? Number(take.p50) : NaN;
  if (Number.isFinite(p50) && p50 > 0) return Math.round(p50) + PICKUP_AUTO_MARGIN_MINUTES;
  return null;
}

function toMs(dateLike) {
  if (typeof dateLike === 'number') return Number.isFinite(dateLike) ? dateLike : NaN;
  return Date.parse(String(dateLike || ''));
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Día local 'YYYY-MM-DD' de un instante, en el huso del dueño. null si inválida.
// (copia verbatim de nightSummary.localDayKeyOf)
function localDayKeyOf(dateLike, utcOffsetMinutes = 0) {
  const ms = toMs(dateLike);
  if (Number.isNaN(ms)) return null;
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  const local = new Date(ms + off * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}`;
}

// Ventana UTC [start, end) que cubre UN día local completo, con desplazamiento
// `dayShift` respecto a HOY local (0 = hoy). (copia verbatim de nightSummary.localDayWindow)
function localDayWindow(nowMs, utcOffsetMinutes = 0, dayShift = 0) {
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  const ms = toMs(nowMs);
  if (Number.isNaN(ms)) return null;
  const shiftMs = (Number(dayShift) || 0) * 86400000;
  const local = new Date(ms + off * 60000 + shiftMs);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  // local midnight → UTC es restando el offset (local = UTC + offset).
  const startUtc = new Date(Date.UTC(y, mo, d) - off * 60000);
  const endUtc = new Date(Date.UTC(y, mo, d + 1) - off * 60000);
  return { localDay: `${y}-${pad2(mo + 1)}-${pad2(d)}`, startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() };
}

/** Minutos locales (float, 0..1440) del instante en el huso del dueño. */
export function localMinutesOfDay(ms, utcOffsetMinutes = 0) {
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  const local = new Date(ms + off * 60000);
  return local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60 + local.getUTCMilliseconds() / 60000;
}

/**
 * La UNICA regla de alineación de la grilla (la usan buildPickupSlots y
 * verifyScheduledFor — cero drift entre la carta y el alta): el retiro es
 * "horario limpio" ⟺ minuto LOCAL entero (sin segundos) alineado al
 * intervalo EN EL HUSO DEL DUEÑO. Con offsets no divisibles por el intervalo
 * (ej. India +330 con grilla de 20) cualquier otra fórmula generaría slots
 * que la verificación rechazaría.
 */
export function isAlignedSlot(slotMs, utcOffsetMinutes, interval) {
  const localMinutes = localMinutesOfDay(slotMs, utcOffsetMinutes);
  return Number.isInteger(localMinutes) && localMinutes % interval === 0;
}

/** 'HH:MM-HH:MM' → { startH, endH } float; basura → null (espejo de openStatus). */
export function parseRange(str) {
  const [a, b] = String(str || '').split('-').map((t) => {
    const [h, m] = String(t || '').trim().split(':').map(Number);
    return h + (m || 0) / 60;
  });
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { startH: a, endH: b };
}

/**
 * Franjas abiertas del horizonte como rangos UTC ms [inicio, fin] inclusivos.
 * Sin horario configurado (política = abierto 24/7) → [] que significa
 * "todo vale". Ventana nocturna (inicio > fin): termina a fin+24h del MISMO
 * día base, así no se duplica con la franja del día siguiente.
 */
export function openShiftRanges(scheduleActiveHours, scheduleEnabled, utcOffsetMinutes, nowMs, horizonDays = PICKUP_HORIZON_DAYS) {
  if (!scheduleEnabled || !scheduleActiveHours) return [];
  const r = parseRange(scheduleActiveHours);
  if (!r) return [];
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  const ranges = [];
  for (let d = 0; d < Math.max(1, horizonDays); d++) {
    const win = localDayWindow(nowMs, off, d);
    if (!win) return [];
    const mid = Date.parse(win.startUtc);
    const start = mid + r.startH * 3600000;
    const end = mid + r.endH * 3600000;
    ranges.push(r.startH <= r.endH ? [start, end] : [start, end + 24 * 3600000]);
  }
  return ranges;
}

function insideAnyRange(slotMs, ranges) {
  if (!ranges.length) return true; // sin horario = abierto 24/7
  return ranges.some(([s, e]) => slotMs >= s && slotMs <= e);
}

/**
 * Grilla de slots del payload público (hoy + mañana). Cada uno:
 * `{ scheduledFor (ISO), minutes (local), time ('HH:MM'), dayKey ('hoy'|'mañana') }`.
 * Alineada a `intervalMinutes`, arrancando en `nowMs + lead` (TOO_SOON fuera)
 * y recortada a `MAX_SLOTS`. Sin lead → [] (no opera).
 */
export function buildPickupSlots(opts) {
  const {
    scheduleActiveHours = '', scheduleEnabled = false,
    utcOffsetMinutes = 0, nowMs = Date.now(),
    pickupConfig = null, prepEstimateByMode = null, maxSlots = MAX_SLOTS
  } = opts || {};
  const cfg = sanitizePickupConfig(pickupConfig) || {};
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  const lead = computeLeadMinutes(cfg, prepEstimateByMode);
  if (lead == null) return [];
  // Date.parse(number) → NaN (string numérica); con ms-numérico va directo.
  const base = typeof nowMs === 'number' ? nowMs : Date.parse(String(nowMs));
  if (Number.isNaN(base)) return [];
  const interval = cfg.intervalMinutes || DEFAULT_INTERVAL_MINUTES;
  const intervalMs = interval * 60000;
  const horizonMs = PICKUP_HORIZON_DAYS * 86400000;
  const ranges = openShiftRanges(scheduleActiveHours, scheduleEnabled, utcOffsetMinutes, base);
  const cap = Math.max(1, Math.min(MAX_SLOTS, Math.round(Number(maxSlots)) || MAX_SLOTS));
  const baseDay = localDayKeyOf(base, off);
  const out = [];
  const seen = new Set();
  let k = Math.ceil((base + lead * 60000) / 60000);
  // Frontera alineada: k ≡ -off (mod intervalo) — LA MISMA regla isAlignedSlot
  // que verifica el alta. Los siguientes candidatos avanzan de a intervalo y
  // el conjunto de múltiplos es cerrado bajo +interval (siguen limpios).
  const shiftMod = ((-off % interval) + interval) % interval;
  let steps = 0;
  while (k % interval !== shiftMod && steps < interval) { k++; steps++; }
  if (k % interval !== shiftMod) return [];
  for (; k * 60000 <= base + horizonMs && out.length < cap; k += interval) {
    const slotMs = k * 60000;
    if (!insideAnyRange(slotMs, ranges)) continue;
    if (seen.has(slotMs)) continue;
    seen.add(slotMs);
    const minutes = localMinutesOfDay(slotMs, off);
    const slotDay = localDayKeyOf(slotMs, off);
    out.push({
      scheduledFor: new Date(slotMs).toISOString(),
      minutes: Math.round(minutes),
      time: `${pad2(Math.floor(minutes / 60))}:${pad2(Math.round(minutes) % 60)}`,
      dayKey: slotDay === baseDay ? 'hoy' : 'mañana'
    });
  }
  return out;
}

/**
 * Verificación de un `scheduledFor` concreto (las reglas del módulo arriba).
 * Nunca lanza: devuelve veredicto con `reason` ∈
 * MALFORMED | PAST | TOO_SOON | NOT_OFFERED | SLOT_UNAVAILABLE — y `{ ok:true }` cuando pasa.
 */
export function verifyScheduledFor(opts) {
  const {
    scheduledFor = '', scheduleActiveHours = '', scheduleEnabled = false,
    utcOffsetMinutes = 0, nowMs = Date.now(), pickupConfig = null, prepEstimateByMode = null
  } = opts || {};
  const cfg = sanitizePickupConfig(pickupConfig) || {};
  const interval = cfg.intervalMinutes || DEFAULT_INTERVAL_MINUTES;
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  // Ojo: Date.parse(number) interpreta los ms como string numérica → NaN.
  // Con reloj ya-numérico se usa el ms directo (patrón reloj inyectable).
  const base = typeof nowMs === 'number' ? nowMs : Date.parse(String(nowMs));
  if (Number.isNaN(base)) return { ok: false, reason: 'SLOT_UNAVAILABLE' };
  const lead = computeLeadMinutes(cfg, prepEstimateByMode);
  if (lead == null) return { ok: false, reason: 'NOT_OFFERED' };

  const raw = String(scheduledFor || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return { ok: false, reason: 'MALFORMED' };
  const slotMs = Date.parse(raw);
  if (Number.isNaN(slotMs)) return { ok: false, reason: 'MALFORMED' };
  if (slotMs < base) return { ok: false, reason: 'PAST' };
  const minutesAhead = (slotMs - base) / 60000;
  if (minutesAhead < lead) return { ok: false, reason: 'TOO_SOON', leadMinutes: lead };
  if (minutesAhead > PICKUP_HORIZON_DAYS * MINUTES_PER_DAY) return { ok: false, reason: 'SLOT_UNAVAILABLE' };

  const localMinutes = localMinutesOfDay(slotMs, off);
  // Un slot válido es "horario limpio" — LA MISMA regla isAlignedSlot que
  // construye la grilla (sin segundos + alineado al intervalo en el huso).
  if (!isAlignedSlot(slotMs, off, interval)) return { ok: false, reason: 'SLOT_UNAVAILABLE' };
  const rounded = Math.round(localMinutes);
  const ranges = openShiftRanges(scheduleActiveHours, scheduleEnabled, utcOffsetMinutes, base);
  if (!insideAnyRange(slotMs, ranges)) return { ok: false, reason: 'SLOT_UNAVAILABLE' };
  return { ok: true, reason: null, slotMinutes: rounded, leadMinutes: lead };
}

/** Copy honesta por veredicto (la escribe el server, patrón Fase 3). */
export function scheduledForVerdictMessage(reason, { leadMinutes = null } = {}) {
  switch (reason) {
    case 'MALFORMED':
      return 'El horario programado no es válido. Elegí uno de la grilla.';
    case 'PAST':
      return 'Ese horario ya pasó. Elegí otro de la grilla.';
    case 'TOO_SOON':
      return leadMinutes != null
        ? `El primer retiro programado disponible es dentro de ${leadMinutes} min.`
        : 'Ese horario es demasiado pronto. Elegí uno más adelante.';
    case 'NOT_OFFERED':
      return 'Este local no acepta retiros programados por el momento.';
    case 'SLOT_UNAVAILABLE':
      return 'Ese horario de retiro no está disponible. Elegí otro de la grilla.';
    default:
      return '';
  }
}

/** Etiqueta "hoy 14:15 hs" | "mañana 12:15 hs" en el huso del dueño. */
export function localPickupLabel(scheduledFor, utcOffsetMinutes = 0, nowMs = Date.now()) {
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  const slotMs = Date.parse(String(scheduledFor || ''));
  // Date.parse(number) → NaN; mismo patrón que los otros dos relojes.
  const base = typeof nowMs === 'number' ? nowMs : Date.parse(String(nowMs));
  if (Number.isNaN(slotMs) || Number.isNaN(base)) return '';
  const dayKey = localDayKeyOf(slotMs, off) === localDayKeyOf(base, off) ? 'hoy' : 'mañana';
  const local = new Date(slotMs + off * 60000);
  return `${dayKey} ${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())} hs`;
}

/** Cuándo debe "despertar" la cocina: retiro − lead. null sin lead. */
export function computeWakeAt(scheduledFor, leadMinutes) {
  const slotMs = Date.parse(String(scheduledFor || ''));
  const lead = Number(leadMinutes);
  if (Number.isNaN(slotMs) || !Number.isFinite(lead)) return null;
  return new Date(slotMs - lead * 60000).toISOString();
}

/**
 * Capacidad por slot (v1 in-request): pedidos ACTIVOS con el mismo instante
 * de retiro. Cancelados no saturan (nunca salieron) y entregados tampoco
 * (ya se retiraron). Tolerante a filas basura y camel/snake.
 */
export function countOrdersInSlot(orders, scheduledForMs) {
  const target = Number(scheduledForMs);
  if (!Number.isFinite(target)) return 0;
  return (Array.isArray(orders) ? orders : []).filter((o) => {
    if (!o || typeof o !== 'object') return false;
    const iso = o.scheduled_for != null ? o.scheduled_for : o.scheduledFor;
    const ms = Date.parse(String(iso || ''));
    if (Number.isNaN(ms) || ms !== target) return false;
    const status = String(o.status || 'pending');
    return status !== 'cancelled' && status !== 'delivered';
  }).length;
}
