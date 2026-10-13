/**
 * public/js/studio/googleReview.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Ayudas puras de conexión con Google (sin DOM en import, testeables):
 * - classifyGoogleReviewLink: reconoce los formatos reales del link de
 *   "Escribir reseña" (writereview?placeid=, g.page/r/, maps place/share,
 *   maps.app.goo.gl). Cualquier otra cosa → inválido (el dueño suele pegar
 *   el link de la ficha o del perfil, que NO abre el formulario).
 * - buildReviewLink: deep-link ?review=1 para QR de carpa/mesa.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Clasifica un link de reseñas de Google.
 * @param {*} raw URL cruda del input
 * @returns {{ok: boolean, kind: string}} kind: writereview|gpage|maps|short|''
 */
export function classifyGoogleReviewLink(raw) {
  const s = String(raw || '').trim();
  if (!/^https:\/\//i.test(s)) return { ok: false, kind: '' };
  let url = null;
  try {
    url = new URL(s);
  } catch (e) {
    return { ok: false, kind: '' };
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host === 'search.google.com' && path.includes('/local/writereview')) {
    return { ok: url.searchParams.has('placeid'), kind: 'writereview' };
  }
  if (host === 'g.page' || host.endsWith('.g.page')) return { ok: true, kind: 'gpage' };
  if (host.endsWith('google.com') && path.includes('/maps')) return { ok: true, kind: 'maps' };
  if (host === 'maps.app.goo.gl') return { ok: true, kind: 'short' };
  return { ok: false, kind: '' };
}

/**
 * Arma el deep-link que abre la carta con el modal de reseñas directo.
 * @param {string} origin location.origin del Studio
 * @param {string} slug slug del local
 * @returns {string} URL o '' si falta el slug
 */
export function buildReviewLink(origin, slug) {
  const clean = String(slug || '').trim().replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 80);
  if (!clean) return '';
  const base = String(origin || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return '';
  return `${base}/m/${clean}?review=1`;
}
