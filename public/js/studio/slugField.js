/**
 * public/js/studio/slugField.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Espejo ESM de api/utils/menuSlug.js (misma regla de normalización) + helpers
 * de presentación para el bloque "Dirección de tu carta en internet".
 *
 * Puro: sin DOM ni red (importable en Node por los guards de sintaxis).
 */

export const MENU_SLUG_MAX_LENGTH = 30;
export const DEFAULT_PUBLIC_ORIGIN = 'https://www.scango.uy';

const ASCII_FALLBACKS = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l',
  'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i'
};

/**
 * Normaliza un slug de carta (minúsculas, sin acentos, guiones limpios).
 * @param {*} raw
 * @returns {string} slug válido o '' si no queda nada usable
 */
export function normalizeMenuSlug(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  let value = String(raw);
  value = value.replace(/[ßæœøłđðþı]/g, (ch) => ASCII_FALLBACKS[ch] || ch);
  try {
    value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) { /* motor sin normalize */ }
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
export function isValidMenuSlug(raw) {
  if (typeof raw !== 'string') return false;
  if (!raw || raw.length > MENU_SLUG_MAX_LENGTH) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw);
}

/**
 * Devuelve un origen http(s) confiable para armar links públicos.
 * - Vacío/basura/esquemas hostiles → dominio oficial de ScanGo.
 * - `https://localhost` (shell nativo Capacitor) → dominio oficial: el link
 *   tiene que poder abrirse desde el teléfono de un comensal, no en el WebView.
 * @param {*} raw
 * @returns {string} origen sin barra final
 */
export function sanitizeOrigin(raw) {
  const value = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!value) return DEFAULT_PUBLIC_ORIGIN;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_PUBLIC_ORIGIN;
    if (!url.hostname) return DEFAULT_PUBLIC_ORIGIN;
    const isNativeShell = (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.protocol === 'https:';
    if (isNativeShell) return DEFAULT_PUBLIC_ORIGIN;
    return url.origin;
  } catch (e) {
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

/**
 * URL pública completa de la carta, o '' si todavía no hay slug.
 * @param {string} origin
 * @param {string} slug
 * @returns {string}
 */
export function buildPublicMenuUrl(origin, slug) {
  const normalized = normalizeMenuSlug(slug);
  if (!normalized) return '';
  return `${sanitizeOrigin(origin)}/m/${normalized}`;
}
