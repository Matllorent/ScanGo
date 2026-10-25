'use strict';

/**
 * api/utils/nightSummary.js — F1 "El Cierre" (oct-2026), módulo PURO (cero I/O,
 * cero requires). El "Z-report" del dueño sin POS: computa el resumen de UNA
 * jornada local (la que acabó) desde una LISTA de pedidos ya filtrados.
 *
 * Reglas (plan docs/plan-ejecucion-bloque-sistema-oct-2026.md §1):
 *   - Ingresos = total canónico del pedido (server-side en el alta) MENOS la
 *     propina; las propinas se reportan APARTE (mismo criterio que analytics:
 *     no distorsionan el ticket promedio).
 *   - Cancelados: cuentan (actividad real) pero NO suman plata ni platos.
 *   - Horas (pico / primera / última) en el HUSO DEL DUEÑO (utcOffsetMinutes,
 *     capturado en el save del Studio; default -180 UY/AR).
 *   - El cap de 500 lo conoce el LLAMADOR (fetch con límite): el módulo solo
 *     marca `counts.truncated` cuando se le avisa, para el "500+" del email.
 *   - La ventana del día es [00:00, 24:00) local → rango UTC exacto, así el
 *     mismo rango sirve para SQL (`created_at >= start AND < end`) y para el
 *     espejo local. Cero env vars por huso: el offset viaja por restaurante.
 */

// Instante → ms. La casa mezcla `Date.now()` con strings ISO (el reloj de
// telemetry/tests viaja como string): aceptamos ambos, NaN si es basura.
function toMs(dateLike) {
  if (dateLike instanceof Date) return dateLike.getTime();
  if (typeof dateLike === 'number') return dateLike;
  const parsed = Date.parse(String(dateLike));
  return Number.isNaN(parsed) ? NaN : parsed;
}

// Hora local (0..23) de un instante, en el huso del dueño (offset en minutos).
// Trick estándar de bucketing: unix + offset, leído con getUTC*. Devuelve null
// para fechas inválidas (nunca inventa).
function localHourOf(dateLike, utcOffsetMinutes = 0) {
  const ms = toMs(dateLike);
  if (Number.isNaN(ms)) return null;
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  return new Date(ms + off * 60000).getUTCHours();
}

// Día local 'YYYY-MM-DD' de un instante, en el huso del dueño. null si inválida.
function localDayKeyOf(dateLike, utcOffsetMinutes = 0) {
  const ms = toMs(dateLike);
  if (Number.isNaN(ms)) return null;
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  const local = new Date(ms + off * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}`;
}

function _pad(n) { return String(n).padStart(2, '0'); }

/**
 * Ventana UTC [start, end) que cubre UN día local completo, con desplazamiento
 * `dayShift` respecto a HOY local (0 = hoy, -1 = ayer local). Es la función
 * única de frontera del día: el cron la usa para el SQL y para la key de dedupe.
 * @returns {{ localDay: string, startUtc: string, endUtc: string }}
 */
function localDayWindow(nowMs, utcOffsetMinutes = 0, dayShift = 0) {
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  const ms = toMs(nowMs);
  if (Number.isNaN(ms)) return null;
  const shiftMs = (Number(dayShift) || 0) * 86400000;
  const local = new Date(ms + off * 60000 + shiftMs);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  const localDay = `${y}-${_pad(mo + 1)}-${_pad(d)}`;
  // local midnight → UTC es restando el offset (local = UTC + offset).
  const startUtc = new Date(Date.UTC(y, mo, d) - off * 60000);
  const endUtc = new Date(Date.UTC(y, mo, d + 1) - off * 60000);
  return { localDay, startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() };
}

/** La jornada que acabó: el día local ANTERIOR al instante dado. A las 3 AM
 *  del día 25, el cierre cuenta el día 24 (jornada completa). */
function prevLocalDay_window(nowMs, utcOffsetMinutes = 0) {
  return localDayWindow(nowMs, utcOffsetMinutes, -1);
}

/**
 * Resumen de la jornada. `orders` = pedidos del día YA recortados por el
 * llamador (los que lleguen; típicamente ≤500 del fetch). Opciones:
 *   - localDay: key del día que se está cerrando (para el email/dedupe).
 *   - currency: código de moneda del local (UYU/USD).
 *   - utcOffsetMinutes: huso del dueño para hora pico y ventanas.
 *   - truncated: true si el llamador cortó el fetch (muestra "500+").
 */
function computeNightSummary(orders, { localDay, currency = 'USD', utcOffsetMinutes = 0, truncated = false } = {}) {
  const off = Math.max(-840, Math.min(840, Number(utcOffsetMinutes) || 0));
  const list = (Array.isArray(orders) ? orders : []).filter((o) => o && typeof o === 'object');

  const counts = { total: list.length, delivered: 0, cancelled: 0, attempted: 0, truncated: Boolean(truncated) };
  let revenueInCents = 0;
  let tipsInCents = 0;
  const dishQty = new Map(); // name → qty (los ids de platos muertos no interesan: el nombre es lo que el dueño reconoce)
  const hourCounts = new Map(); // horaLocal → pedidos
  let firstTs = null;
  let lastTs = null;

  const num = (...candidates) => {
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return 0;
  };

  for (const order of list) {
    const status = String(order.status || '').toLowerCase();
    const cancelled = status === 'cancelled';
    if (cancelled) {
      counts.cancelled += 1;
    } else {
      if (status === 'delivered') counts.delivered += 1;
      counts.attempted += 1;
      const total = num(order.total, order.amount); // total canónico; fallback a platos viejos sin total
      const tip = num(order.tipAmount, order.tip_amount);
      if (total + tip > 0) {
        revenueInCents += Math.round((total - tip) * 100);
        tipsInCents += Math.round(tip * 100);
      }
      const items = order.items_snapshot || order.itemsSnapshot || order.items;
      if (Array.isArray(items)) {
        for (const line of items) {
          if (!line || typeof line !== 'object') continue;
          const name = line.name || (line.dishId ? `Plato ${line.dishId}` : '');
          if (!name) continue;
          const qty = Math.max(0, Math.round(Number(line.quantity ?? line.qty) || 0));
          if (qty <= 0) continue;
          dishQty.set(name, (dishQty.get(name) || 0) + qty);
        }
      }
    }
    // Actividad real de la jornada (incluye cancelados: la hora pico es tráfico).
    const ts = new Date(order.created_at || order.createdAt).getTime();
    if (!isNaN(ts)) {
      if (firstTs === null || ts < firstTs) firstTs = ts;
      if (lastTs === null || ts > lastTs) lastTs = ts;
    }
    const hour = localHourOf(ts, off);
    if (hour !== null) hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
  }

  let peak = null;
  for (const [hour, count] of hourCounts) {
    if (!peak || count > peak.count || (count === peak.count && hour < peak.hour)) {
      peak = { hour, count, label: `${_pad(hour)}:00` };
    }
  }

  const topDishes = [...dishQty.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
    .slice(0, 3);

  const labelOf = (ts) => {
    if (ts === null) return '';
    const local = new Date(ts + off * 60000);
    return `${_pad(local.getUTCHours())}:${_pad(local.getUTCMinutes())}`;
  };

  return {
    localDay: String(localDay || ''),
    currency: String(currency || 'USD'),
    counts,
    // La propina viaja aparte: revenue (con envíos/DSCTO del total canónico)
    // menos propina — la suma revenue + tips es lo cobrado en la noche.
    revenue: revenueInCents / 100,
    tips: tipsInCents / 100,
    avgTicket: counts.attempted > 0 ? revenueInCents / 100 / counts.attempted : 0,
    peakHour: peak,
    firstOrderLabel: firstTs !== null ? labelOf(firstTs) : '',
    lastOrderLabel: lastTs !== null ? labelOf(lastTs) : '',
    topDishes,
  };
}

module.exports = {
  localHourOf,
  localDayKeyOf,
  localDayWindow,
  prevLocalDay_window,
  computeNightSummary,
  MAX_SUMMARY_ORDERS: 500,
  DEFAULT_SUMMARY_HOUR: 3,   // v1 fija: el envío vive en la franja 3..5 local
  clampOffset: (v) => Math.max(-840, Math.min(840, Math.round(Number(v) || 0))),
};
