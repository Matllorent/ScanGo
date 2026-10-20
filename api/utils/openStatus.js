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
 * - Rango normal (inicio <= fin): abierto si `horaLocal >= inicio && <= fin`
 *   (bordes inclusivos).
 * - Rango invertido (inicio > fin) = VENTANA NOCTURNA (cruza medianoche, p.ej.
 *   `18:00-02:00`): abierto si `horaLocal >= inicio || horaLocal <= fin`.
 *   `23:00-00:00` cubre [23:00, 24:00) más la medianoche exacta; `inicio == fin`
 *   se trata como rango normal (abre solo ese instante, config degenerada).
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
  // Fórmula de ventana: normal (inicio<=fin) → dentro de [inicio,fin]; invertida
  // (inicio>fin) = ventana nocturna que cruza medianoche → después del inicio
  // O antes/igual del fin (bordes inclusivos en ambos tramos).
  const inWindow =
    range.startH <= range.endH
      ? currentHour >= range.startH && currentHour <= range.endH
      : currentHour >= range.startH || currentHour <= range.endH;
  if (!inWindow) {
    return { open: false, reason: 'closed_schedule', hours: restaurant.scheduleActiveHours };
  }
  return { open: true, reason: 'open' };
}

/** Conveniencia booleana para los gates del checkout. */
function isRestaurantOpenNow(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  return computeOpenStatus(restaurant, utcOffsetMinutes, nowMs).open;
}

/**
 * Minutos COMPLETOS que faltan para el fin de la franja vigente (Math.floor),
 * o `null` cuando no corresponde el contador: sin restaurante, `forceClosed`,
 * horario deshabilitado, sin franja, formato inválido o local cerrado AHORA.
 *
 * Ventana nocturna (rango invertido): si el reloj está en el tramo inicio
 * (antes de medianoche) el cierre es al día siguiente; si está en el tramo fin
 * (después de medianoche) es hoy. En el borde de cierre el local sigue
 * "abierto" (bordes inclusivos) pero ya no quedan minutos → 0 (nunca negativo).
 */
function minutesUntilClose(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
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
 * vigente (null/0) o si falta una hora o más (>= 60: el requisito del
 * producto es "menos de 60 minutos"). Si corresponde → `{ minutes, label }`.
 */
function getClosingCountdown(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  if (!restaurant || restaurant.showClosingCountdown === false) return null;
  const minutes = minutesUntilClose(restaurant, utcOffsetMinutes, nowMs);
  if (!minutes || minutes >= 60) return null;
  return { minutes, label: `Cierra en ${minutes} min` };
}

module.exports = {
  parseScheduleRange,
  localHourOfNow,
  computeOpenStatus,
  isRestaurantOpenNow,
  minutesUntilClose,
  getClosingCountdown
};