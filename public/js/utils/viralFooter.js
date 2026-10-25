/**
 * public/js/utils/viralFooter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * F4 "El QR es la demo" — footer viral del menú público (espejo ESM del
 * módulo puro CJS `api/utils/viralRef.js`).
 *
 * Mismas firmas que el lado server (`sanitizeRefSlug`, `buildReferralHref`,
 * `buildKitLine`) para que el href de la carta y el del link del kit sean
 * idénticos byte a byte (paridad verificada por tests/test-viral-footer.js).
 *
 * Sin imports: importable en Node (tests) y en el navegador (menu.js /
 * qrGenerator.js) sin bundler.
 */

export const REF_SLUG_MAX = 64;
const REF_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const VIRAL_FOOTER_LABEL = 'Esta carta corre con ScanGo';
export const VIRAL_FOOTER_CTA = 'Hacé la tuya en 60s';

/**
 * Sanea el slug de la carta que trajo al dueño. '' si no es válido.
 * @param {*} raw
 * @returns {string}
 */
export function sanitizeRefSlug(raw) {
  if (typeof raw !== 'string') return '';
  const clean = raw.trim().toLowerCase().slice(0, REF_SLUG_MAX);
  if (!clean || !REF_SLUG_RE.test(clean)) return '';
  return clean;
}

function safeAppBase(appUrl) {
  const base = typeof appUrl === 'string' ? appUrl.trim() : '';
  if (!base) return '/';
  if (/^https?:\/\/[^\s]+$/i.test(base)) return base.replace(/\/+$/, '');
  return '/';
}

/**
 * Href del footer viral: `/?ref=<slug>`. '' si el slug no es válido.
 * @param {string} appUrl
 * @param {string} slug
 * @returns {string}
 */
export function buildReferralHref(appUrl, slug) {
  const cleanSlug = sanitizeRefSlug(slug);
  if (!cleanSlug) return '';
  const base = safeAppBase(appUrl);
  return `${base === '/' ? '' : base}/?ref=${encodeURIComponent(cleanSlug)}`;
}

/**
 * Línea del kit de mesa imprimible (misma cadena que el server).
 * @param {string} appUrl
 * @returns {string}
 */
export function buildKitLine(appUrl) {
  const base = safeAppBase(appUrl);
  return `${VIRAL_FOOTER_LABEL} · ${base === '/' ? 'scango.uy' : base}`;
}

/**
 * El footer SOLO existe en cartas reales: una demo es la vidriera de ScanGo,
 * no un cliente que se promociona.
 * @param {object} restaurant
 * @returns {boolean}
 */
export function shouldShowViralFooter(restaurant) {
  if (!restaurant || typeof restaurant !== 'object') return false;
  if (restaurant.isDemo === true) return false;
  return sanitizeRefSlug(restaurant.slug) !== '';
}

/**
 * Aplica el footer a un elemento ya presente en el DOM:
 *  - muestra/oculta con el atributo `hidden` (sin tocar estilos inline),
 *  - setea el href de `[data-viral-link]` con el ref del local,
 *  - engancha el tracking del click UNA sola vez (idempotente).
 *
 * Devuelve true si el footer quedó visible.
 * @param {HTMLElement|null} el
 * @param {object} restaurant
 * @param {{ appUrl?: string, onTrack?: Function }} [opts]
 * @returns {boolean}
 */
export function applyViralFooter(el, restaurant, opts = {}) {
  if (!el) return false;
  const show = shouldShowViralFooter(restaurant);
  el.hidden = !show;
  if (!show) return false;

  const href = buildReferralHref(opts.appUrl || '', restaurant.slug);
  if (!href) {
    el.hidden = true;
    return false;
  }

  const link = typeof el.querySelector === 'function' ? el.querySelector('[data-viral-link]') : null;
  if (link) {
    link.setAttribute('href', href);
    if (typeof opts.onTrack === 'function' && link.dataset.viralTracked !== '1') {
      link.dataset.viralTracked = '1';
      link.addEventListener('click', () => {
        try {
          opts.onTrack(restaurant.slug, href);
        } catch (e) {
          /* el tracking nunca bloquea la navegación */
        }
      });
    }
  }
  return true;
}
