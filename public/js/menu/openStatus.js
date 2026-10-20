/**
 * public/js/menu/openStatus.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Espejo ESM del backend (api/utils/openStatus.js). Bloque 1 — Regla pura de
 * abierto/cerrado con reloj INYECTABLE: el browser pasa
 * `utcOffsetMinutes = -new Date().getTimezoneOffset()` y la hora local del
 * local se recalcula como UTC + offset con getUTC*, así la regla no depende
 * del huso del server (back) ni de que el dispositivo esté en el huso del
 * local (front). La tabla de decisión ejecutable de horarios
 * (tests/test-business-hours.js) exige que ambos espejos produzcan
 * `{ open, reason }` idénticos para los mismos (restaurant, offset, nowMs).
 * Ventana nocturna: rango invertido `inicio > fin` (p.ej. 18:00-02:00) abre
 * cuando `horaLocal >= inicio || horaLocal <= fin`.
 */
export function parseScheduleRange(scheduleActiveHours) {
  const [startH, endH] = String(scheduleActiveHours || '')
    .split('-')
    .map((t) => {
      const [h, m] = String(t || '').split(':').map(Number);
      return h + (m || 0) / 60;
    });
  if (startH === undefined || endH === undefined || Number.isNaN(startH) || Number.isNaN(endH)) return null;
  return { startH, endH };
}

export function localHourOfNow(nowMs, utcOffsetMinutes = 0) {
  const offsetMs = (Number(utcOffsetMinutes) || 0) * 60000;
  const localNow = new Date(nowMs + offsetMs);
  return localNow.getUTCHours() + localNow.getUTCMinutes() / 60;
}

export function computeOpenStatus(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  if (restaurant.forceClosed === true) return { open: false, reason: 'closed_force' };
  if (!restaurant.scheduleEnabled || !restaurant.scheduleActiveHours) return { open: true, reason: 'no_schedule' };

  const range = parseScheduleRange(restaurant.scheduleActiveHours);
  if (!range) return { open: true, reason: 'no_schedule' };

  const currentHour = localHourOfNow(nowMs, utcOffsetMinutes);
  // Misma fórmula que el backend: normal (inicio<=fin) → dentro de [inicio,fin];
  // invertida (inicio>fin) = ventana nocturna (cruza medianoche) → después del
  // inicio O antes/igual del fin. Bordes inclusivos en ambos tramos.
  const inWindow =
    range.startH <= range.endH
      ? currentHour >= range.startH && currentHour <= range.endH
      : currentHour >= range.startH || currentHour <= range.endH;
  if (!inWindow) {
    return { open: false, reason: 'closed_schedule', hours: restaurant.scheduleActiveHours };
  }
  return { open: true, reason: 'open' };
}

export function isRestaurantOpenNow(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  return computeOpenStatus(restaurant, utcOffsetMinutes, nowMs).open;
}

/**
 * Minutos COMPLETOS que faltan para el fin de la franja vigente (Math.floor),
 * o `null` cuando no corresponde el contador: sin restaurante, `forceClosed`,
 * horario deshabilitado, sin franja, formato inválido o local cerrado AHORA.
 * Ventana nocturna: en el tramo inicio (antes de medianoche) el cierre es al
 * día siguiente; en el tramo fin es hoy. Borde de cierre → 0 (nunca negativo).
 * Espejo idéntico de api/utils/openStatus.js (paridad en test-business-hours).
 */
export function minutesUntilClose(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  if (!restaurant || restaurant.forceClosed === true) return null;
  if (!restaurant.scheduleEnabled || !restaurant.scheduleActiveHours) return null;
  const range = parseScheduleRange(restaurant.scheduleActiveHours);
  if (!range) return null;
  if (!computeOpenStatus(restaurant, utcOffsetMinutes, nowMs).open) return null;

  const DAY_MS = 86400000;
  // Instante del día local en ms (misma aritmética de offset que
  // computeOpenStatus, aquí con segundos: el countdown es fino).
  const offsetMs = (Number(utcOffsetMinutes) || 0) * 60000;
  const nowLocalMs = (((nowMs + offsetMs) % DAY_MS) + DAY_MS) % DAY_MS;
  const startMs = Math.round(range.startH * 3600000);
  const endMs = Math.round(range.endH * 3600000);
  // Normal → fin hoy. Nocturna en el tramo inicio (>= inicio) → fin mañana.
  const closeLocalMs = (startMs > endMs && nowLocalMs >= startMs) ? endMs + DAY_MS : endMs;
  const minutes = Math.floor((closeLocalMs - nowLocalMs) / 60000);
  return minutes > 0 ? minutes : 0;
}

/**
 * Contador de cierre para el badge del menú: `null` si el dueño lo apagó
 * (`showClosingCountdown === false`; default encendido), si no hay franja
 * vigente (null/0) o si falta una hora o más (>= 60). Si corresponde →
 * `{ minutes, label }` con N entero 1..59.
 */
export function getClosingCountdown(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  if (!restaurant || restaurant.showClosingCountdown === false) return null;
  const minutes = minutesUntilClose(restaurant, utcOffsetMinutes, nowMs);
  if (!minutes || minutes >= 60) return null;
  return { minutes, label: `Cierra en ${minutes} min` };
}