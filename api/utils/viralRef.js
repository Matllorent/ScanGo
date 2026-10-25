/**
 * api/utils/viralRef.js
 * ─────────────────────────────────────────────────────────────────────────────
 * F4 "El QR es la demo" — atribución de altas + footer viral.
 *
 * Módulo PURO (cero I/O, sin require de src/routes/middleware) con las tres
 * reglas compartidas del feature:
 *   1. `sanitizeRefSlug`: el `?ref=` de la landing es un slug de carta real,
 *      nunca texto libre (allowlist `[a-z0-9-]`, máx 64).
 *   2. `buildReferralHref`: arma `/?ref=<slug>` con base http(s) o raíz
 *      relativa. NUNCA devuelve `javascript:`/`data:`.
 *   3. `buildKitLine`: la línea del kit de mesa imprimible
 *      ("Esta carta corre con ScanGo · <app_url>").
 *
 * Espejo ESM: `public/js/utils/viralFooter.js` (mismas firmas). La paridad
 * exacta entre los dos lados la verifica `tests/test-viral-footer.js` (mismo
 * patrón que openStatus / themeManifest).
 */

const REF_SLUG_MAX = 64;
// Un slug real del menú: minúsculas, dígitos y guiones internos.
const REF_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const VIRAL_FOOTER_LABEL = 'Esta carta corre con ScanGo';

/**
 * Sanea el slug de la carta que trajo al dueño. Devuelve '' si no es un slug
 * válido (nunca lanza, nunca devuelve basura).
 * @param {*} raw
 * @returns {string}
 */
function sanitizeRefSlug(raw) {
  if (typeof raw !== 'string') return '';
  const clean = raw.trim().toLowerCase().slice(0, REF_SLUG_MAX);
  if (!clean || !REF_SLUG_RE.test(clean)) return '';
  return clean;
}

/**
 * Base segura para URLs de la app: http(s) absoluto o raíz relativa. Cualquier
 * otro esquema (`javascript:`, `data:`, …) cae a '/'.
 * @param {*} appUrl
 * @returns {string}
 */
function safeAppBase(appUrl) {
  const base = typeof appUrl === 'string' ? appUrl.trim() : '';
  if (!base) return '/';
  if (/^https?:\/\/[^\s]+$/i.test(base)) return base.replace(/\/+$/, '');
  return '/';
}

/**
 * Href del footer viral: `/?ref=<slug>` (o `<origin>/?ref=<slug>` cuando se
 * pasa una base absoluta). '' si el slug no es válido.
 * @param {string} appUrl
 * @param {string} slug
 * @returns {string}
 */
function buildReferralHref(appUrl, slug) {
  const cleanSlug = sanitizeRefSlug(slug);
  if (!cleanSlug) return '';
  const base = safeAppBase(appUrl);
  return `${base === '/' ? '' : base}/?ref=${encodeURIComponent(cleanSlug)}`;
}

/**
 * Línea del kit de mesa imprimible. Sin URL válida usa el dominio de marca.
 * @param {string} appUrl
 * @returns {string}
 */
function buildKitLine(appUrl) {
  const base = safeAppBase(appUrl);
  return `${VIRAL_FOOTER_LABEL} · ${base === '/' ? 'scango.uy' : base}`;
}

module.exports = {
  REF_SLUG_MAX,
  VIRAL_FOOTER_LABEL,
  sanitizeRefSlug,
  buildReferralHref,
  buildKitLine
};
