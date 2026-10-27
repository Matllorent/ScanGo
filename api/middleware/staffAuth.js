/**
 * api/middleware/staffAuth.js
 * ────────────────────────────
 * Autenticación del EQUIPO OPERATIVO (mozos / cocina). No es el JWT del dueño
 * ni la credencial de dispositivo: es un token opaco de sesión de turno,
 * emitido al escanear el QR y guardado hasheado en `staff_sessions`.
 *
 * Garantías:
 *  - Sin token → 401 `STAFF_TOKEN_REQUIRED`.
 *  - Token inválido, vencido, terminado o revocado → 401 `STAFF_SESSION_INVALID`.
 *  - Persona desactivada o de otro local → 401 (misma respuesta, sin filtrar).
 *  - El restaurante se hidrata en cold start antes de exponerlo.
 *  - `last_seen_at` se toca como máximo 1 vez por minuto por sesión.
 */
const db = require('../../src/db/db');
const {
  hashStaffSecret,
  isStaffSessionActive,
  extendStaffSession
} = require('../utils/staffCredentials');

const TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_TOUCH_ENTRIES = 2000;
const lastTouchBySession = new Map();

function unauthorized(res, code, message) {
  return res.status(401).json({ success: false, error: message, code });
}

const STAFF_ERRORS = {
  STAFF_TOKEN_REQUIRED: 'Falta la credencial del turno (Bearer token).',
  STAFF_SESSION_INVALID: 'Tu turno venció o no es válido. Escaneá el QR de nuevo.',
  STAFF_RESTAURANT_NOT_FOUND: 'El local de este turno no está disponible.'
};

/**
 * Resolución OPCIONAL de sesión de turno (Comandero, Fase 2). Devuelve
 * `{ ok:true, ctx }` (ctx=null si el request no trae Authorization) o
 * `{ ok:false, code }` cuando el token EXISTE pero no sirve. Un Bearer
 * inválido en una ruta pública NO se degrada a comensal: se rechaza con 401
 * (fail-closed honesto — el mozo ve "turno venció" en vez de un pedido sin
 * atribución que cree que quedó firmado).
 */
async function resolveOptionalStaff(req) {
  const header = String(req.headers.authorization || '').trim();
  if (!header) return { ok: true, ctx: null };
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return { ok: false, code: 'STAFF_TOKEN_REQUIRED' };

  const token = match[1].trim();
  // Los tokens son base64url de 32 bytes (43 chars). Un mínimo holgado evita
  // hashear basura en cada request sin rechazar formatos futuros.
  if (token.length < 24 || token.length > 200) {
    return { ok: false, code: 'STAFF_SESSION_INVALID' };
  }

  const tokenHash = hashStaffSecret(token);
  const session = await db.findStaffSessionByTokenHash(tokenHash);
  if (!session || !isStaffSessionActive(session)) {
    return { ok: false, code: 'STAFF_SESSION_INVALID' };
  }

  const staff = await db.findStaffById(session.staffId);
  if (!staff || staff.active === false || staff.restaurantId !== session.restaurantId) {
    return { ok: false, code: 'STAFF_SESSION_INVALID' };
  }

  let restaurant = db.findRestaurantById(staff.restaurantId);
  if (!restaurant && typeof db.lazyLoadRestaurantById === 'function') {
    restaurant = await db.lazyLoadRestaurantById(staff.restaurantId);
  }
  if (!restaurant) {
    return { ok: false, code: 'STAFF_RESTAURANT_NOT_FOUND' };
  }

  return { ok: true, ctx: { staff, session, restaurant } };
}

async function staffAuthMiddleware(req, res, next) {
  try {
    const result = await resolveOptionalStaff(req);
    if (!result.ok) {
      return unauthorized(res, result.code, STAFF_ERRORS[result.code] || STAFF_ERRORS.STAFF_SESSION_INVALID);
    }
    if (!result.ctx) {
      // Ruta OBLIGATORIA sin Bearer: el resolver opcional es solo para el
      // comandero (`POST /api/orders`); acá un turno ausente es 401, no 500.
      return unauthorized(res, 'STAFF_TOKEN_REQUIRED', STAFF_ERRORS.STAFF_TOKEN_REQUIRED);
    }
    const { staff, session, restaurant } = result.ctx;

    req.staff = staff;
    req.staffSession = session;
    req.staffRestaurant = restaurant;

    // Touch throttled: el polling del mozo pega cada 30 s; escribir la sesión
    // en cada request sería ruido puro. Se estira el TTL sin pasar el tope
    // absoluto de 24 h desde la activación.
    const now = Date.now();
    const previous = lastTouchBySession.get(session.id) || 0;
    if (now - previous > TOUCH_INTERVAL_MS) {
      lastTouchBySession.set(session.id, now);
      if (lastTouchBySession.size > MAX_TOUCH_ENTRIES) {
        const oldest = lastTouchBySession.keys().next().value;
        lastTouchBySession.delete(oldest);
      }
      const expiresAt = extendStaffSession(session, now);
      const lastSeenAt = new Date(now).toISOString();
      db.touchStaffSession(session.id, { lastSeenAt, expiresAt }).catch(() => {});
      req.staffSession = { ...session, lastSeenAt, expiresAt };
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { staffAuthMiddleware, resolveOptionalStaff };
