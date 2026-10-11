/**
 * public/js/menu/eventInvitations.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Invitaciones de boda/evento por WhatsApp, una por invitado (sin DOM en
 * import, testeable en Node):
 * - normalizeGuestPhone: dígitos del teléfono del invitado (vale con ≥8).
 * - buildGuestInviteLink: link personal `/m/<slug>?invitado=&qr=` (el token
 *   lo resuelve el endpoint de invitado que ya expone mesa y dieta).
 * - resolveEventInviteCopy: copy por tipo de evento (boda/15/cumpleaños/catering).
 * - buildGuestInviteMessage: texto de invitación en español rioplatense.
 * - buildGuestInviteUrl: wa.me listo para abrir (null sin teléfono válido).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Dígitos del teléfono del invitado (con código de país). Válido con 8+.
 * @param {*} value Teléfono crudo
 * @returns {string} solo dígitos ('' si no alcanza el mínimo)
 */
export function normalizeGuestPhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits.length >= 8 ? digits : '';
}

/**
 * Link personal del invitado al evento (nombre + token QR).
 * @param {string} origin https://origen (sin barra final)
 * @param {string} slug Slug del evento
 * @param {object} guest { name, qrToken }
 * @returns {string} URL lista para compartir ('' sin slug)
 */
export function buildGuestInviteLink(origin, slug, guest = {}) {
  const cleanSlug = String(slug || '').trim();
  if (!cleanSlug) return '';
  const base = `${String(origin || '').replace(/\/+$/, '')}/m/${encodeURIComponent(cleanSlug)}`;
  const params = new URLSearchParams();
  const name = String(guest.name || '').trim();
  if (name) params.set('invitado', name);
  const token = String(guest.qrToken || '').trim();
  if (token) params.set('qr', token);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Copy de la invitación por tipo de evento (data-driven). Antes el mensaje
 * decía "su boda" siempre, incluso en un cumpleaños de 15 o un catering.
 */
const EVENT_INVITE_COPY = {
  wedding: { verb: 'celebrar su boda', celebration: '🎉', closing: '¡Te esperamos!' },
  cumple_15: { verb: 'celebrar sus 15 años', celebration: '👑', closing: '¡No faltes!' },
  birthday: { verb: 'celebrar su cumpleaños', celebration: '🎂', closing: '¡Te esperamos!' },
  catering: { verb: 'acompañarnos en su evento', celebration: '🍽️', closing: '¡Te esperamos!' }
};

/**
 * Resuelve el copy de la invitación según el tipo de evento.
 * @param {string} eventType 'wedding' | 'cumple_15' | 'birthday' | 'catering' (default wedding)
 * @returns {{verb: string, celebration: string, closing: string}}
 */
export function resolveEventInviteCopy(eventType) {
  const key = String(eventType || '').trim().toLowerCase();
  return EVENT_INVITE_COPY[key] || EVENT_INVITE_COPY.wedding;
}

/**
 * Texto de invitación por WhatsApp (una por invitado, con su link).
 * Solo incluye fecha/lugar si el dueño los cargó (nunca "undefined").
 * El verbo/nombre de la celebración depende de `eventType` (boda, 15, cumpleaños, catering).
 */
export function buildGuestInviteMessage({
  coupleNames = '',
  date = '',
  venue = '',
  guestName = '',
  link = '',
  eventType = ''
} = {}) {
  const copy = resolveEventInviteCopy(eventType);
  const couple = String(coupleNames || '').trim() || 'Los anfitriones';
  const guest = String(guestName || '').trim();
  let msg = `Hola ${guest || 'te'} 💛\n\n${couple} te invitan a ${copy.verb} ${copy.celebration}\n`;
  const when = String(date || '').trim();
  if (when) msg += `📅 ${when}\n`;
  const where = String(venue || '').trim();
  if (where) msg += `📍 ${where}\n`;
  const url = String(link || '').trim();
  if (url) msg += `\nTu invitación personal con todos los detalles:\n${url}\n`;
  msg += `\n_${copy.closing}_`;
  return msg;
}

/**
 * URL wa.me para invitar al invitado (null si no hay teléfono válido).
 */
export function buildGuestInviteUrl(phone, message) {
  const digits = normalizeGuestPhone(phone);
  if (!digits || !String(message || '').trim()) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
