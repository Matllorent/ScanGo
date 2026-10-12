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
  // Misma semántica que el frontend original (>= inicio y <= fin).
  if (currentHour < range.startH || currentHour > range.endH) {
    return { open: false, reason: 'closed_schedule', hours: restaurant.scheduleActiveHours };
  }
  return { open: true, reason: 'open' };
}

export function isRestaurantOpenNow(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  return computeOpenStatus(restaurant, utcOffsetMinutes, nowMs).open;
}