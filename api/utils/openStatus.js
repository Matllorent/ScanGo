/**
 * api/utils/openStatus.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Autoridad de abierto/cerrado como función PURA (sin I/O, sin reloj real).
 *
 * Misma fórmula que el browser (public/js/menu/openStatus.js, espejo ESM):
 * dado el restaurante, el `utcOffsetMinutes` del cliente y un instante
 * (`nowMs`, INYECTABLE para poder congelar el reloj en tests) se decide si el
 * local acepta pedidos ahora.
 *
 * Reglas (idénticas en ambos espejos, exigidas por tests/test-business-hours.js):
 * - `forceClosed === true` gana siempre (cerrado aunque el horario diga abierto).
 * - Sin horario configurado, o con formato inválido → abierto (política
 *   explícita del producto: el dueño que no fija horario no queda bloqueado).
 * - Un rango invertido (inicio > fin) nunca matchea → cerrado siempre
 *   (config inválida a la vista del comensal, misma semántica que el frontend).
 * - La hora local del local se recalcula como UTC + offset (`getUTC*`), así la
 *   regla no depende del huso del server (Vercel corre en UTC).
 *
 * `nowMs` inyectable es lo que permite la tabla de decisión ejecutable de
 * horarios (fronteras de medianoche, ventanas nocturnas, offsets) sin sleeps
 * ni mocks. Las rutas la usan con el default `Date.now()`.
 */
function parseScheduleRange(scheduleActiveHours) {
  const [startH, endH] = String(scheduleActiveHours || '')
    .split('-')
    .map((t) => {
      const [h, m] = String(t || '').split(':').map(Number);
      return h + (m || 0) / 60;
    });
  if (startH === undefined || endH === undefined || Number.isNaN(startH) || Number.isNaN(endH)) return null;
  return { startH, endH };
}

/** Hora local (float, 0-24) del local en el instante `nowMs` con su offset de minutos. */
function localHourOfNow(nowMs, utcOffsetMinutes = 0) {
  const offsetMs = (Number(utcOffsetMinutes) || 0) * 60000;
  const localNow = new Date(nowMs + offsetMs);
  return localNow.getUTCHours() + localNow.getUTCMinutes() / 60;
}

/**
 * Decisión de abierto/cerrado. Nunca lanza: devuelve `{ open, reason }` con
 * `reason` ∈ `closed_force | closed_schedule | open | no_schedule` (en
 * `closed_schedule` también expone `hours` = la franja configurada).
 */
function computeOpenStatus(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  if (restaurant.forceClosed === true) return { open: false, reason: 'closed_force' };
  if (!restaurant.scheduleEnabled || !restaurant.scheduleActiveHours) return { open: true, reason: 'no_schedule' };

  const range = parseScheduleRange(restaurant.scheduleActiveHours);
  if (!range) return { open: true, reason: 'no_schedule' };

  const currentHour = localHourOfNow(nowMs, utcOffsetMinutes);
  // Misma semántica que el frontend (>= inicio y <= fin).
  if (currentHour < range.startH || currentHour > range.endH) {
    return { open: false, reason: 'closed_schedule', hours: restaurant.scheduleActiveHours };
  }
  return { open: true, reason: 'open' };
}

/** Conveniencia booleana para los gates del checkout. */
function isRestaurantOpenNow(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  return computeOpenStatus(restaurant, utcOffsetMinutes, nowMs).open;
}

module.exports = { parseScheduleRange, localHourOfNow, computeOpenStatus, isRestaurantOpenNow };