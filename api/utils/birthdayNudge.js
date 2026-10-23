/**
 * api/utils/birthdayNudge.js
 * ────────────────────────────
 * Módulo PURO — selección de clientes con cumpleaños hoy para nudge automático.
 * Cero I/O, cero requires de src/db/routes/middleware (guard arquitectura B).
 *
 * Filosofía: usamos la data que YA tenemos (customer_profiles.birthdate) para
 * disparar un gesto de cumpleaños (push + email) SOLO a quien tenga consentimiento
 * de marketing + suscripción push activa. Sin scoring mágico, solo fecha.
 *
 * @param {object} options
 * @param {Array} options.customers - customer_profiles (camelCase local o espejo cloud)
 * @param {Array} options.pushSubscriptions - push_subscriptions (guest con consent_marketing + customer_phone)
 * @param {string} options.restaurantId - tenant del dueño
 * @param {number} [options.nowMs] - reloj inyectable (testeable)
 * @returns {{ candidates: Array, sentPush: number, sentEmail: number, skipped: object }}
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

function isBirthdayToday(birthdate, nowMs) {
  if (!birthdate) return false;
  // Parse YYYY-MM-DD manually to avoid timezone issues (birthdate is a calendar date, not a timestamp)
  const match = String(birthdate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const birthMonth = parseInt(match[2], 10) - 1; // 0-indexed
  const birthDay = parseInt(match[3], 10);
  const now = new Date(nowMs);
  // Use UTC for both to avoid timezone drift (cron runs at 07:00 UTC)
  return birthMonth === now.getUTCMonth() && birthDay === now.getUTCDate();
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return '';
  if (normalized.length <= 5) return '*'.repeat(normalized.length);
  return normalized.slice(0, 3) + '***' + normalized.slice(-2);
}

/**
 * Selecciona cumpleañeros del día con consentimiento + suscripción push.
 * @returns {Array} candidatos listos para envío (cada uno con phone, name, email, pushSubscription)
 */
function selectBirthdayCandidates({ customers, pushSubscriptions, restaurantId, nowMs = Date.now() }) {
  if (!Array.isArray(customers) || !Array.isArray(pushSubscriptions)) return [];

  // Mapa de suscripciones push por teléfono normalizado (solo guests con consent_marketing)
  const pushByPhone = new Map();
  for (const sub of pushSubscriptions) {
    if (sub.restaurantId !== restaurantId) continue;
    if (sub.role !== 'guest') continue;
    if (sub.consent_marketing !== true) continue;
    const phone = normalizePhone(sub.customer_phone);
    if (phone) pushByPhone.set(phone, sub);
  }

  const candidates = [];
  for (const cust of customers) {
    // birthdate es ISO string "YYYY-MM-DD" o "YYYY-MM-DDT..."
    if (!isBirthdayToday(cust.birthdate, nowMs)) continue;
    if (cust.consentMarketing !== true) continue;
    
    const phone = normalizePhone(cust.phone);
    if (!phone) continue;

    const pushSub = pushByPhone.get(phone);
    if (!pushSub) continue; // Solo los que tienen push activo

    const email = cust.email && typeof cust.email === 'string' && cust.email.includes('@')
      ? cust.email.trim().toLowerCase()
      : null;

    candidates.push({
      customerId: cust.id,
      phone,
      phoneMasked: maskPhone(phone),
      name: cust.name || 'Amigo',
      email,
      pushSubscription: pushSub,
      birthdate: cust.birthdate
    });
  }

  return candidates;
}

/**
 * Genera el payload de push para cumpleaños.
 */
function buildBirthdayPushPayload({ name, restaurantName, slug }) {
  return {
    title: `🎂 ¡Feliz cumpleaños, ${name}!`,
    body: `Desde ${restaurantName} te regalamos un detalle especial. ¡Abrí tu Club para verlo!`,
    icon: '/icon-192.png',
    url: slug ? `/m/${slug}#club` : '/',
    type: 'birthday_nudge',
    tag: 'birthday-nudge',
    renotify: false,
    requireInteraction: false,
    data: { type: 'birthday' },
    timestamp: new Date().toISOString()
  };
}

/**
 * Genera el cuerpo de email para cumpleaños (HTML simple).
 */
function buildBirthdayEmailBody({ name, restaurantName, menuUrl }) {
  return [
    `¡Feliz cumpleaños, ${name}! 🎂`,
    `El equipo de ${restaurantName} te desea un día genial.`,
    `Como regalo, tenés un detalle esperándote en tu Club.`,
    `Abrí tu Club acá: <a href="${menuUrl}#club">${menuUrl}#club</a>`,
    `¡Que lo disfrutes!`
  ].join('<br><br>');
}

module.exports = {
  selectBirthdayCandidates,
  buildBirthdayPushPayload,
  buildBirthdayEmailBody,
  normalizePhone,
  isBirthdayToday,
  _DAY_MS: DAY_MS
};