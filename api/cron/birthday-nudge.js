const express = require('express');
const { selectBirthdayCandidates, buildBirthdayPushPayload, buildBirthdayEmailBody } = require('../utils/birthdayNudge');
const loyaltyService = require('../services/loyalty');
const emailService = require('../services/email');
const notificationsService = require('../services/notifications');
const auditService = require('../services/audit');
const { verifyCronAuth } = require('../middleware/cronAuth');
const { successResponse } = require('../utils/response');
const { normalizePhone } = require('../utils/birthdayNudge');
const db = require('../../src/db/db');
const fs = require('fs');
const path = require('path');

const router = express.Router();

/**
 * GET /api/cron/birthday-nudge
 * Cron diario (07:00 UTC en vercel.json): envía push + email de cumpleaños
 * a clientes del local que hoy cumplen años, tienen consentMarketing + push activo.
 * Fail-closed: 401 sin CRON_SECRET, 200 con reporte { sentPush, sentEmail, skipped }.
 * Clientes: datos locales (JSON) | Push subscriptions: local JSON (consistente con test)
 */
router.get('/birthday-nudge', verifyCronAuth, async (req, res, next) => {
  try {
    const restaurantId = req.query.restaurantId;
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId requerido (query param)' });
    }

    // Reloj inyectable (patrón de la casa, GATED a no-producción): la suite
    // congela el "hoy" para no depender del día en que se corre. En producción
    // el cron usa SIEMPRE el reloj del server (un query param nunca lo mueve).
    const injectedNow = process.env.NODE_ENV !== 'production' && req.query.nowMs
      ? Number(req.query.nowMs)
      : NaN;
    const now = new Date(Number.isFinite(injectedNow) ? injectedNow : Date.now());
    const todayMonth = now.getUTCMonth();
    const todayDay = now.getUTCDate();

    // Clientes: datos locales (JSON) - consistente con el resto del sistema
    const customers = loyaltyService.readCollection('customers').filter(c => c && c.id);
    console.log('[CRON] Customers loaded:', customers.length);
    if (customers.length > 0) {
      console.log('[CRON] First customer:', JSON.stringify({
        id: customers[0].id,
        phone: customers[0].phone,
        birthdate: customers[0].birthdate,
        consent_marketing: customers[0].consent_marketing,
        consentMarketing: customers[0].consentMarketing
      }, null, 2));
    }

    // Push subscriptions: local JSON (consistente con test y resto del sistema)
    const DATA_DIR = process.env.VERCEL === '1' || process.env.VERCEL === 'true'
      ? path.join(require('os').tmpdir(), 'menu-pizarron-saas')
      : path.join(__dirname, '..', '..', 'data');
    const PUSH_SUBS_FILE = path.join(DATA_DIR, 'push_subscriptions.json');
    let pushSubscriptions = [];
    if (fs.existsSync(PUSH_SUBS_FILE)) {
      try { pushSubscriptions = JSON.parse(fs.readFileSync(PUSH_SUBS_FILE, 'utf8')); } catch (e) { pushSubscriptions = []; }
    }
    console.log('[CRON] Push subscriptions loaded:', pushSubscriptions.length);

    // Filtrar candidatos de cumpleaños
    const candidates = [];
    // now, todayMonth, todayDay ya definidos arriba

    for (const profile of customers) {
      // Verificar cumpleaños hoy (UTC)
      if (!profile.birthdate) {
        console.log('[CRON] Profile missing birthdate:', profile.id);
        continue;
      }
      const match = String(profile.birthdate).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!match) {
        console.log('[CRON] Profile birthdate format invalid:', profile.id, profile.birthdate);
        continue;
      }
      const birthMonth = parseInt(match[2], 10) - 1;
      const birthDay = parseInt(match[3], 10);
      if (birthMonth !== todayMonth || birthDay !== todayDay) {
        console.log('[CRON] Profile birthday not today:', profile.id, birthMonth, birthDay, 'vs', todayMonth, todayDay);
        continue;
      }
      
      const consentMarketing = profile.consent_marketing === true || profile.consentMarketing === true;
      if (!consentMarketing) {
        console.log('[CRON] Profile consent not true:', profile.id, profile.consent_marketing, profile.consentMarketing);
        continue;
      }
      
      const phone = normalizePhone(profile.phone);
      if (!phone) {
        console.log('[CRON] Profile phone invalid:', profile.id, profile.phone);
        continue;
      }

      // Buscar suscripción push del restaurante para este teléfono
      const pushSub = pushSubscriptions.find(s => 
        s.restaurantId === restaurantId &&
        s.role === 'guest' &&
        s.consent_marketing === true &&
        normalizePhone(s.customer_phone) === phone
      );
      if (!pushSub) {
        console.log('[CRON] No push sub found for phone:', phone);
        continue; // Solo los que tienen push activo
      }

      const email = profile.email && typeof profile.email === 'string' && profile.email.includes('@')
        ? profile.email.trim().toLowerCase()
        : null;

      candidates.push({
        customerId: profile.id,
        phone,
        phoneMasked: phone.slice(0, 3) + '***' + phone.slice(-2),
        name: profile.name || 'Amigo',
        email,
        pushSubscription: pushSubscriptions.find(s => 
          s.restaurantId === restaurantId &&
          s.role === 'guest' &&
          s.consent_marketing === true &&
          normalizePhone(s.customer_phone) === phone
        ),
        birthdate: profile.birthdate
      });
    }

    console.log('[CRON] Total candidates found:', candidates.length);

    let sentPush = 0;
    let sentEmail = 0;
    const skipped = { noPushSub: 0, noEmail: 0, noConsent: 0, optOut: 0, emailFailed: 0 };

    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const restaurant = db.findRestaurantById(restaurantId);
    const menuSlug = restaurant && restaurant.slug;
    const menuUrl = menuSlug ? `${process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`}/m/${menuSlug}` : (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`);
    const restaurantName = restaurant && restaurant.name || 'Tu local favorito';

    for (const cand of candidates) {
      // Push
      try {
        const payload = buildBirthdayPushPayload({
          name: cand.name,
          restaurantName: restaurant && restaurant.name || 'Tu local favorito',
          slug: restaurant && restaurant.slug
        });
        await notificationsService.dispatchToSubscriptions([cand.pushSubscription], payload);
        sentPush++;
      } catch (e) {
        // Push falló (red, VAPID, etc.) - no incrementamos skipped, solo log
      }

      // Email (si tiene email y no está en opt-out)
      if (cand.email) {
        if (emailService.isOptedOut(cand.email)) {
          skipped.optOut++;
        } else {
          try {
            const body = buildBirthdayEmailBody({
              name: cand.name,
              restaurantName: restaurant && restaurant.name || 'Tu local favorito',
              menuUrl
            });
            await emailService.sendPromotionalEmail({
              to: cand.email,
              subject: `🎂 ¡Feliz cumpleaños de ${restaurant && restaurant.name || 'Tu local favorito'}!`,
              body,
              restaurantName: restaurant && restaurant.name || 'Tu local favorito',
              promoLink: menuUrl
            });
            sentEmail++;
          } catch (e) {
            skipped.emailFailed++;
          }
        }
      } else {
        skipped.noEmail++;
      }

      // Auditoría
      auditService.logAction({
        tenantId: restaurantId,
        userId: 'cron',
        requestId: req.requestId,
        action: 'BIRTHDAY_NUDGE_SENT',
        entity: 'loyalty',
        details: {
          phone: cand.phoneMasked,
          hasEmail: !!cand.email,
          pushSent: true
        }
      });
    }

    return successResponse(res, {
      sentPush,
      sentEmail,
      totalCandidates: candidates.length,
      skipped
    }, `Birthday nudge: ${sentPush} push + ${sentEmail} emails enviados`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;