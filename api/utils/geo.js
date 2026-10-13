/**
 * api/utils/geo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Geografía pura para Descubrir (cero I/O, testeable en Node):
 * - isValidLatLng: rangos reales ±90/±180, finitos.
 * - roundCoord: recorta a 3 decimales (~100m, privacidad del comensal: la
 *   ubicación exacta nunca viaja al servidor).
 * - haversineKm: distancia de círculo máximo (Tierra R=6371km).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (Number(deg) * Math.PI) / 180;
}

function isValidLat(lat) {
  const n = Number(lat);
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

function isValidLng(lng) {
  const n = Number(lng);
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

function isValidLatLng(lat, lng) {
  return isValidLat(lat) && isValidLng(lng);
}

function roundCoord(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  if (!isValidLatLng(lat1, lng1) || !isValidLatLng(lat2, lng2)) return null;
  const dLat = toRad(lat2) - toRad(lat1);
  const dLng = toRad(lng2) - toRad(lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

module.exports = {
  EARTH_RADIUS_KM,
  isValidLat,
  isValidLng,
  isValidLatLng,
  roundCoord,
  haversineKm
};
