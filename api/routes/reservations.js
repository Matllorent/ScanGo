/**
 * api/routes/reservations.js
 * ──────────────────────────
 * "Reservas de verdad" (backlog #2, oct-2026) — el chip "Reservar Mesa" deja
 * de ser solo WhatsApp: la reserva EXISTE en el sistema y el dueño la opera.
 *
 *  - POST /api/reservations         — pública (comensal): alta + capacidad + captcha.
 *  - GET  /api/reservations         — dueño: agenda de UN día (default hoy local)
 *                                     con el anillo del Club (visitas del teléfono)
 *                                     y `waLink` wa.me prefilled (backlog #9) para
 *                                     avisar/recordar por WhatsApp desde la agenda.
 *  - PATCH /api/reservations/:id    — dueño: requested→confirmed, confirmed→
 *                                     seated|no_show|cancelled (máquina en el
 *                                     módulo puro; el PATCH nunca la saltea).
 *
 * Persistencia: `restaurant.reservations[]` dentro del doc del local (dual-write
 * JSON↔Supabase en la columna `profile` — cero migración). El array es
 * SERVER-OWNED: `reservations` está en PRIVILEGED_FIELDS, el autosave del
 * Studio no lo pisa y el sanitizer del save no puede crearlo.
 *
 * Honesto en la notificación: el email al dueño es best-effort (fire-and-forget
 * — la reserva ya está guardada cuando el comensal recibe su 201; sin Resend
 * configurado NO falla el alta). El WhatsApp prefilled lo arma el MENÚ con el
 * mismo formatter de siempre (cero duplicación de copy en el server).
 *
 * Auditoría: RESERVATION_CREATED (alta del comensal, teléfono enmascarado) y
 * RESERVATION_STATUS_CHANGE (de qué estado a cuál + motivo). Catálogo cerrado
 * en api/services/audit.js.
 */
const express = require('express');
const db = require('../../src/db/db');
const { successResponse, errorResponse } = require('../utils/response');
const { verifyTurnstile, isCaptchaEnforced } = require('../utils/captcha');
const {
  RESERVATION_STATUSES,
  parseReservationInput,
  assertSlotAvailable,
  describeReservationStatus,
  deriveCountryCodeFromPhone,
  localDayKeyOf,
  normalizeReservationPhone
} = require('../utils/reservations');
const loyaltyService = require('../services/loyalty');
const emailService = require('../services/email');
const auditService = require('../services/audit');
const { authMiddleware } = require('../middleware/auth');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');
const { requireActiveSubscription } = require('../middleware/subscriptionGuard');
const { reservationsPublicLimiter } = require('../middleware/rateLimits');
const { normalizeDemoType } = require('../utils/demoRestaurants');
const {
  buildReservationWaLink
} = require('../utils/reservationWa');

const router = express.Router();

/**
 * Resolve el local por slug con hidratación lazy de cloud (patrón del menú:
 * la primera visita de un doc frío no queda vacía).
 */
async function findRestaurantBySlugWithHydration(slug) {
  let restaurant = db.findRestaurantBySlug(slug);
  if (!restaurant) restaurant = await db.lazyLoadRestaurant(slug);
  return restaurant || null;
}

/** Reserva lista para DEVOLVER (dueño o comensal): sin campos internos. */
function publicReservation(r) {
  if (!r) return null;
  const meta = describeReservationStatus(r.status);
  return {
    id: r.id,
    name: r.name || '',
    phone: r.phone || '',
    email: r.email || '',
    date: r.date || '',
    time: r.time || '',
    pax: r.pax || 0,
    ...(r.paxLabel ? { paxLabel: r.paxLabel } : {}),
    notes: r.notes || '',
    status: r.status,
    statusLabel: meta.label,
    source: r.source || 'menu',
    cancelReason: r.cancelReason || '',
    createdAt: r.createdAt || '',
    statusUpdatedAt: r.statusUpdatedAt || r.updatedAt || ''
  };
}

// ── POST /api/reservations — alta pública del comensal ──────────────────────
router.post('/', reservationsPublicLimiter, async (req, res, next) => {
  try {
    const { slug, name, date, time, pax, phone, email, notes, captchaToken } = req.body || {};
    if (!slug || typeof slug !== 'string') {
      return errorResponse(res, 'Falta el slug del local', 400, null, 'VALIDATION_ERROR');
    }

    // Demos públicas por rubro: catálogo in-memory (el menú las resuelve igual).
    // NUNCA registran data real: no-op honesto ANTES de consultar la DB.
    if (normalizeDemoType(slug.trim())) {
      return successResponse(res, { demo: true }, 'Demo: la reserva no se registra');
    }

    const restaurant = await findRestaurantBySlugWithHydration(slug.trim());
    if (!restaurant) {
      return errorResponse(res, 'Local no encontrado', 404, null, 'RESTAURANT_NOT_FOUND');
    }

    // Las demos NUNCA registran data real: no-op honesto (mismo patrón que el
    // canal público de analytics). El menú demo de todas formas mantiene el
    // flujo WhatsApp puro client-side; este es el respaldo server-side.
    if (restaurant.isDemo === true) {
      return successResponse(res, { demo: true }, 'Demo: la reserva no se registra');
    }

    // El dueño decide si ofrece reservas (toggle "Activar Botón Reservar Mesa").
    if (restaurant.allowReservations === false) {
      return errorResponse(res, 'Este local no está aceptando reservas en línea', 403, null, 'RESERVATIONS_DISABLED');
    }

    // CAPTCHA invisible: solo se exige si el server tiene TURNSTILE_SECRET
    // (fail-open igual que el pedido — un CF inalcanzable no bloquea mesas).
    if (isCaptchaEnforced()) {
      const captcha = await verifyTurnstile(captchaToken, req.ip);
      if (!captcha.ok) {
        const msg = captcha.reason === 'CAPTCHA_REQUIRED'
          ? 'Verificá el control anti-robots e intentá de nuevo.'
          : 'La verificación anti-robots falló. Intentá de nuevo.';
        return errorResponse(res, msg, 403, null, captcha.reason || 'CAPTCHA_INVALID');
      }
    }

    const config = restaurant.reservationConfig || {};
    const offset = restaurant.utcOffsetMinutes;
    // v2 · teléfonos nacionales (leftover del backlog #9): el código de país
    // lo aporta el local (derivado de SU teléfono de pedidos) — '099 123 456'
    // completa a '59899123456' y el wa.me rutea + el Club matchea.
    const countryPrefix = deriveCountryCodeFromPhone(
      normalizeReservationPhone(restaurant.phone)
    );
    const parsed = parseReservationInput(
      { name, date, time, pax, phone, email, notes },
      { utcOffsetMinutes: offset, config, countryPrefix }
    );
    if (!parsed.ok) {
      const first = parsed.errors[0];
      return errorResponse(res, first.message, 400, { errors: parsed.errors }, first.code);
    }

    const existing = Array.isArray(restaurant.reservations) ? restaurant.reservations : [];
    const slot = assertSlotAvailable(existing, parsed.value, config);
    if (!slot.ok) {
      // Un solo código público: no se filtra el detalle de la agenda.
      return errorResponse(res, 'Esa franja ya no tiene lugar disponible. Probá otro horario.', 409, null, 'SLOT_UNAVAILABLE');
    }

    const nowIso = new Date().toISOString();
    const reservation = {
      id: `resv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...parsed.value,
      status: 'requested',
      source: 'menu',
      createdAt: nowIso,
      statusUpdatedAt: nowIso
    };
    // v2: el alta es ATÓMICA (db.addReservation): cloud → RPC 011 que re-cuenta
    // la capacidad contra el doc actual y agrega en la misma sentencia; local →
    // re-chequeo de capacidad DENTRO del mutex. El pre-chequeo de arriba sigue
    // siendo el fail-fast de UX; la decisión final es la atómica.
    const saved = await db.addReservation(restaurant.id, reservation, {
      config,
      slotInput: parsed.value
    });
    if (!saved || !saved.success) {
      if (saved && saved.code === 'SLOT_UNAVAILABLE') {
        // La franja se llenó entre el pre-chequeo y el alta (claim atómico).
        // Un solo código público: no se filtra el detalle de la agenda.
        return errorResponse(res, 'Esa franja ya no tiene lugar disponible. Probá otro horario.', 409, null, 'SLOT_UNAVAILABLE');
      }
      return errorResponse(res, 'No se pudo registrar la reserva. Probá de nuevo.', 500, null, 'RESERVATION_SAVE_FAILED');
    }

    // Email al DUEÑO (fire-and-forget: la reserva ya existe; sin Resend no
    // rompe el alta). Transaccional, con pie legal automático de sendEmail.
    const owner = restaurant.userId ? db.findUserById(restaurant.userId) : null;
    const ownerEmail = owner && typeof owner.email === 'string' ? owner.email.trim() : '';
    if (ownerEmail) {
      emailService.sendReservationRequestEmail({
        to: ownerEmail,
        restaurantName: restaurant.name || restaurant.bizName || 'Tu local',
        reservation
      }).catch(() => {});
    }

    // Auditoría (no-bloqueante): el teléfono viaja enmascarado.
    auditService.logAction({
      tenantId: restaurant.id,
      userId: restaurant.userId,
      requestId: req.requestId,
      action: 'RESERVATION_CREATED',
      entity: 'reservation',
      details: {
        reservationId: reservation.id,
        name: reservation.name,
        phoneMasked: maskPhoneForAudit(reservation.phone),
        date: reservation.date,
        time: reservation.time,
        pax: reservation.pax,
        channel: 'menu'
      }
    });

    return successResponse(res, {
      reservation: publicReservation(reservation)
    }, 'Reserva registrada — esperá la confirmación del local', 201);
  } catch (e) {
    return next(e);
  }
});

// ── GET /api/reservations — agenda del dueño ────────────────────────────────
router.get('/', authMiddleware, requireVerifiedEmail, async (req, res, next) => {
  try {
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) {
      return errorResponse(res, 'Restaurante no encontrado', 404, null, 'RESTAURANT_NOT_FOUND');
    }

    // Día default: HOY en el huso del dueño (la agenda empieza por la tarde
    // de su mismo "hoy", nunca por la del server).
    const offset = restaurant.utcOffsetMinutes;
    const dayParam = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : localDayKeyOf(Date.now(), offset);

    const all = Array.isArray(restaurant.reservations) ? restaurant.reservations : [];
    const list = all
      .filter(r => r && r.date === day)
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')) || String(a.id).localeCompare(String(b.id)));

    // Pendientes de responder (todas las requested vivas, cualquier día):
    // el badge "N sin confirmar" del tab.
    const pendingCount = all.filter(r => r && r.status === 'requested').length;

    // Anillo con el Club: visitas de ese teléfono en ESTE local (lectura,
    // nunca crea). n por día es chico: el costo es aceptable.
    const seen = new Map();
    const withClub = [];
    const nowMs = Date.now();
    const restaurantName = restaurant.name || restaurant.bizName || '';
    for (const r of list) {
      let club = null;
      const phone = r.phone;
      if (phone) {
        if (seen.has(phone)) club = seen.get(phone);
        else {
          try {
            const card = await loyaltyService.getCustomerCard({ phone, restaurantId: restaurant.id });
            club = card && card.customer ? {
              level: card.level ? card.level.label : '',
              localVisits: card.account ? card.account.visits || 0 : 0,
              globalVisits: card.global ? card.global.visits || 0 : 0
            } : null;
          } catch (e) {
            club = null; // el anillo es un plus: su fallo no rompe la agenda
          }
          seen.set(phone, club);
        }
      }
      // Backlog #9: link wa.me prefilled para avisar/recordar por WhatsApp —
      // SOLO estados pre-visita (requested/confirmed) con teléfono válido;
      // terminales y filas sin teléfono → null (campo SIEMPRE presente,
      // estable para el frontend como `soldOutToday` en F3).
      withClub.push({
        ...publicReservation(r),
        club,
        waLink: buildReservationWaLink(r, {
          restaurantName,
          nowMs,
          utcOffsetMinutes: offset
        })
      });
    }

    return successResponse(res, {
      date: day,
      allowReservations: restaurant.allowReservations !== false,
      reservations: withClub,
      counts: {
        day: list.length,
        pending: pendingCount,
        requested: list.filter(r => r.status === 'requested').length,
        confirmed: list.filter(r => r.status === 'confirmed').length,
        seated: list.filter(r => r.status === 'seated').length,
        cancelled: list.filter(r => r.status === 'cancelled').length,
        noShow: list.filter(r => r.status === 'no_show').length
      }
    });
  } catch (e) {
    return next(e);
  }
});

// ── PATCH /api/reservations/:id — acción del dueño ──────────────────────────
router.patch('/:id', authMiddleware, requireActiveSubscription, async (req, res, next) => {
  try {
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) {
      return errorResponse(res, 'Restaurante no encontrado', 404, null, 'RESTAURANT_NOT_FOUND');
    }

    const reservationId = String(req.params.id || '');
    const { status, cancelReason } = req.body || {};
    if (!RESERVATION_STATUSES.includes(status)) {
      return errorResponse(res, 'Estado inválido', 400, null, 'INVALID_RESERVATION_STATUS');
    }

    // Aislamiento por local: una reserva ajena es 404 (igual que orders).
    const current = restaurant.reservations && Array.isArray(restaurant.reservations)
      ? restaurant.reservations.find(r => r && r.id === reservationId)
      : null;
    if (!current) {
      return errorResponse(res, 'Reserva no encontrada', 404, null, 'RESERVATION_NOT_FOUND');
    }

    const nowIso = new Date().toISOString();
    const result = await db.updateReservationStatus(restaurant.id, reservationId, {
      status,
      cancelReason: typeof cancelReason === 'string' ? cancelReason : undefined
    }, nowIso);
    if (!result || !result.success) {
      const code = result && result.code ? result.code : 'RESERVATION_UPDATE_FAILED';
      const status2 = code === 'INVALID_RESERVATION_TRANSITION' ? 409 : 500;
      return errorResponse(res, result && result.error ? result.error : 'No se pudo actualizar la reserva', status2, null, code);
    }

    auditService.logAction({
      tenantId: restaurant.id,
      userId: req.user.userId,
      requestId: req.requestId,
      action: 'RESERVATION_STATUS_CHANGE',
      entity: 'reservation',
      details: {
        reservationId,
        from: current.status,
        to: status,
        ...(status === 'cancelled' ? { cancelReason: typeof cancelReason === 'string' ? cancelReason.slice(0, 200) : 'Cancelada por el local' } : {})
      }
    });

    // Reservas v2: ciclo de vida al COMENSAL (best-effort, fire-and-forget —
    // la transición ya persistió; sin Resend no rompe el PATCH). Solo estados
    // con copy definida y solo si el comensal dejó un email en el alta.
    const guestEmail = typeof current.email === 'string' ? current.email.trim() : '';
    if (guestEmail && ['confirmed', 'cancelled', 'no_show'].includes(status)) {
      emailService.sendReservationStatusEmail({
        to: guestEmail,
        reservation: result.reservation,
        restaurantName: restaurant.name || restaurant.bizName || 'Tu local',
        status
      }).catch(() => {});
    }

    return successResponse(res, { reservation: publicReservation(result.reservation) });
  } catch (e) {
    return next(e);
  }
});

/** Teléfono enmascarado para auditoría/logs (nunca crudo). */
function maskPhoneForAudit(phone) {
  const digits = normalizeReservationPhone(phone);
  if (!digits) return '';
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

module.exports = router;
