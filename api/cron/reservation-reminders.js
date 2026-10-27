/**
 * GET /api/cron/reservation-reminders
 * ───────────────────────────────────
 * Recordatorio 24h de reservas confirmadas (backlog #2, oct-2026): recorre
 * TODOS los locales y avisa al comensal de cada reserva CONFIRMADA que
 * empieza dentro de la ventana [23, 25] horas — el cron horario (0 * * * *)
 * la atrapa siempre, y el dedupe por reserva evita reenvíos si el tick se
 * corre dos veces (mismas réplica de Vercel, mismo marcador global).
 *
 * Canales: email al comensal (lo pidió en el alta; opcional) + push si está
 * suscrito con consentimiento (mismo filtro que el aviso de estado del
 * pedido). Sin NINGÚN canal → skip NO_CHANNEL sin marcar (un comensal que
 * se suscribe más tarde todavía puede recibirlo en las próximas horas).
 *
 * Honesto y fallando cerrado:
 *   - Demos fuera (nunca inventan tráfico), sin slug fuera (el push linkea
 *     el menú), reserva no confirmada fuera (requested no promete mesa).
 *   - Sin CRON_SECRET en prod: 401 (middleware compartido cronAuth).
 *   - `?nowMs=` reloj inyectable GATED a NODE_ENV !== 'production': la suite
 *     congela "ahora" sin depender de la hora de la corrida. En producción
 *     el cron usa SIEMPRE el reloj del server (un query param nunca lo mueve).
 *
 * Idempotencia: marcador en notification_events type `reservation_reminder`
 * con data.reservationId (isRead: true — no ensucia el inbox del dueño).
 */
const express = require('express');
const db = require('../../src/db/db');
const { verifyCronAuth } = require('../middleware/cronAuth');
const { selectReservationReminders } = require('../utils/reservations');
const notificationsService = require('../services/notifications');
const emailService = require('../services/email');
const auditService = require('../services/audit');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/reservation-reminders', verifyCronAuth, async (req, res) => {
  const startedAt = Date.now();
  try {
    // Reloj inyectable (patrón de la casa, GATED a no-producción).
    const injectedNow = process.env.NODE_ENV !== 'production' && req.query.nowMs
      ? Number(req.query.nowMs)
      : NaN;
    const nowMs = Number.isFinite(injectedNow) ? injectedNow : startedAt;

    // Ventana configurable SOLO en no-producción (la suite la acota para
    // aislar casos); en producción siempre [23, 25].
    let windowHours;
    if (process.env.NODE_ENV !== 'production' && req.query.windowHours) {
      const parsed = String(req.query.windowHours).split(',').map(Number);
      if (parsed.length === 2 && parsed.every(Number.isFinite)) windowHours = parsed;
    }

    const restaurants = (db.getAllRestaurants ? db.getAllRestaurants() : []);
    const candidates = selectReservationReminders(restaurants, { nowMs, ...(windowHours ? { windowHours } : {}) });

    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const results = { checked: restaurants.length, considered: candidates.length, sent: 0, skipped: 0, reasons: {} };
    const bump = (reason) => { results.skipped++; results.reasons[reason] = (results.reasons[reason] || 0) + 1; };

    for (const cand of candidates) {
      try {
        // Dedupe GLOBAL (nube + espejo local): la segunda corrida de la misma
        // hora —en esta u otra réplica— vuelve con sent 0.
        if (await notificationsService.hasReservationReminder(cand.reservationId)) {
          bump('ALREADY_SENT');
          continue;
        }

        // Push al comensal (best-effort, nunca rompe el email).
        const push = await notificationsService.sendReservationReminderNotification({
          restaurantId: cand.restaurantId,
          customerPhone: cand.phone,
          date: cand.date,
          time: cand.time,
          slug: cand.restaurantSlug,
          restaurantName: cand.restaurantName
        });
        const pushSent = push && push.delivered > 0;

        // Email al comensal si dejó su email (el recordatorio es
        // transaccional: no mira el opt-out de promos).
        let emailSent = false;
        if (cand.email) {
          try {
            const result = await emailService.sendReservationReminderEmail({
              to: cand.email,
              customerName: cand.name,
              restaurantName: cand.restaurantName,
              date: cand.date,
              time: cand.time,
              menuUrl: `${appUrl}/m/${encodeURIComponent(cand.restaurantSlug)}`
            });
            emailSent = !(result && result.skipped);
          } catch (e) {
            emailSent = false;
          }
        }

        if (!pushSent && !emailSent) {
          // Sin canal NO se marca: si el comensal se suscribe o deja email
          // más tarde, las próximas horas todavía lo alcanzan.
          bump('NO_CHANNEL');
          continue;
        }

        results.sent++;
        const channels = [pushSent ? 'push' : null, emailSent ? 'email' : null].filter(Boolean);
        // El marcador se persiste SIEMPRE al haber enviado (no re-enviar).
        await notificationsService.recordReservationReminder({
          restaurantId: cand.restaurantId,
          reservationId: cand.reservationId,
          channels
        });

        // Auditoría (fire-and-forget): teléfono enmascarado en details.
        auditService.logAction({
          tenantId: cand.restaurantId,
          userId: 'cron',
          requestId: req.requestId,
          action: 'RESERVATION_REMINDER_SENT',
          entity: 'reservation',
          details: {
            reservationId: cand.reservationId,
            channels,
            forWhen: `${cand.date} ${cand.time}`
          }
        });
      } catch (e) {
        bump('ERROR');
        logger.info('[Reservation Reminder] error por reserva, se continúa', { details: String(e.message || e) });
      }
    }

    logger.info('[Reservation Reminder] ejecutado', {
      details: `checked=${results.checked} considered=${results.considered} sent=${results.sent} skipped=${results.skipped} ms=${Date.now() - startedAt}`
    });

    return res.json({ success: true, windowHours: windowHours || [23, 25], data: results });
  } catch (e) {
    console.error('[Reservation Reminder Cron Error]', e.message);
    return res.status(500).json({ success: false, error: 'El cron de recordatorios falló consultando' });
  }
});

module.exports = router;
