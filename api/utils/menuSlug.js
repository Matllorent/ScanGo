/**
 * api/utils/menuSlug.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Dirección pública de la carta (/m/:slug). UNA sola regla para todo el
 * backend: el Studio la espeja en public/js/studio/slugField.js y el sanitizer
 * + saveRestaurant la aplican al persistir.
 *
 * Reglas (deterministas e idempotentes):
 *  - minúsculas, sin acentos (NFD + marcas diacríticas fuera)
 *  - todo lo que no sea [a-z0-9] se convierte en un guion
 *  - guiones repetidos colapsan y no queda guion al principio/final
 *  - tope MENU_SLUG_MAX_LENGTH; si el corte deja un guion al final, se quita
 *  - vacío/basura → '' (nunca un slug inventado)
 *
 * Puro: sin requires de src/, routes/ ni middleware/ (guard de arquitectura).
 */

const MENU_SLUG_MAX_LENGTH = 30;

// Letras que NFD no descompone en ASCII (nombres nórdicos/europeos comunes).
const ASCII_FALLBACKS = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l',
  'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i'
};

/**
 * Normaliza un slug de carta.
 * @param {*} raw
 * @returns {string} slug válido o '' si no queda nada usable
 */
function normalizeMenuSlug(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  let value = String(raw);
  value = value.replace(/[ßæœøłđðþı]/g, (ch) => ASCII_FALLBACKS[ch] || ch);
  try {
    value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    // Motores sin String.prototype.normalize: seguimos con la allowlist.
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MENU_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * Verifica que un valor YA sea un slug canónico (no lo transforma).
 * @param {*} raw
 * @returns {boolean}
 */
function isValidMenuSlug(raw) {
  if (typeof raw !== 'string') return false;
  if (!raw || raw.length > MENU_SLUG_MAX_LENGTH) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw);
}

module.exports = {
  MENU_SLUG_MAX_LENGTH,
  normalizeMenuSlug,
  isValidMenuSlug
};
