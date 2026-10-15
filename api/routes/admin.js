/**
 * api/routes/admin.js
 * ───────────────────
 * Panel maestro (/api/admin/*): login 2FA, overview en español llano, estado
 * de suscripciones, invitaciones, moderación de reseñas, pricing y kill-switch.
 * Extraído de api/index.js sin cambios de comportamiento (mismo orden y mismos
 * middleware por ruta: login solo con adminLimiter, el resto con adminMiddleware).
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../../src/db/db');
const billingOrchestrator = require('../../src/billing/orchestrator');
const emailService = require('../services/email');
const { adminMiddleware } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimits');
const { verifyTotpToken } = require('../utils/totp');
const { successResponse, errorResponse } = require('../utils/response');
const { getSubscriptionKillSwitch, setSubscriptionKillSwitch } = require('../middleware/killSwitch');
const {
  JWT_SECRET,
  ADMIN_KEY,
  COOKIE_OPTIONS,
  ADMIN_SESSION_IDLE_TIMEOUT_SECONDS,
  timingSafeEqualHex
} = require('../utils/adminSession');

const router = express.Router();

router.post('/login', adminLimiter, (req, res) => {
  const { key, adminKey, totp } = req.body || {};
  const providedKey = key || adminKey || req.headers['x-admin-key'];
  // Fail-closed: sin ADMIN_TOTP_SECRET no hay 2FA posible (nunca un secreto
  // default: sería público y el "2FA" no autenticaría nada).
  const adminTotpSecret = process.env.ADMIN_TOTP_SECRET || '';

  if (timingSafeEqualHex(providedKey, ADMIN_KEY)) {
    const cleanTotp = (totp ? String(totp) : '').trim();
    if (!cleanTotp) {
      return res.status(401).json({ error: 'El código 2FA de Google Authenticator es obligatorio para ingresar al panel de administración' });
    }
    if (!verifyTotpToken(cleanTotp, adminTotpSecret)) {
      return res.status(401).json({ error: 'Código Google Authenticator (TOTP) incorrecto o expirado' });
    }
    const adminToken = jwt.sign(
      { role: 'admin_master', timestamp: Date.now() },
      JWT_SECRET,
      { expiresIn: ADMIN_SESSION_IDLE_TIMEOUT_SECONDS }
    );
    res.cookie('admin_token', adminToken, COOKIE_OPTIONS);
    return res.json({
      success: true,
      message: 'Acceso autorizado como administrador maestro'
    });
  }
  return res.status(401).json({ error: 'Clave de administración incorrecta' });
});

router.post('/logout', (req, res) => {
  res.clearCookie('admin_key', COOKIE_OPTIONS);
  res.clearCookie('admin_token', COOKIE_OPTIONS);
  return res.json({ success: true });
});

router.get('/overview', adminMiddleware, async (req, res) => {
  try {
    const { getSupabaseClient } = require('../utils/supabase');
    const supabase = getSupabaseClient();
    let restaurants = [];
    let users = [];

    if (supabase) {
      try {
        const { data: rData, error: rError } = await supabase.from('restaurants').select('*');
        if (!rError && Array.isArray(rData)) {
          restaurants = rData.map(r => ({
            id: r.id,
            userId: r.user_id,
            slug: r.slug,
            name: r.name || r.biz_name,
            bizName: r.biz_name || r.name,
            slogan: r.slogan,
            currency: r.currency,
            phone: r.phone,
            theme: r.theme,
            logoUrl: r.logo_url,
            wifi: r.wifi,
            categories: r.categories || [],
            dishes: r.dishes || [],
            modifierGroups: r.modifier_groups || [],
            deliveryZones: r.delivery_zones || [],
            branches: r.branches || [],
            subscription: r.subscription || {},
            analytics: r.analytics || { visits: 0, orders: 0, reservations: 0, waiterCalls: 0 },
            createdAt: r.created_at,
            updatedAt: r.updated_at
          }));
        } else if (rError) {
          console.warn('⚠️ [Supabase Overview Warning]', rError.message);
        }

        const { data: uData, error: uError } = await supabase.from('users').select('id, email, name, created_at');
        if (!uError && Array.isArray(uData)) {
          users = uData.map(u => ({
            id: u.id,
            email: u.email,
            name: u.name,
            createdAt: u.created_at
          }));
        } else if (uError) {
          console.warn('⚠️ [Supabase Users Overview Warning]', uError.message);
        }
      } catch (err) {
        console.warn('⚠️ [Supabase Query Exception]', err.message);
      }
    }

    // Fuente dual: la nube es eventualmente consistente (los writes van en
    // background) y puede estar atrás de altas locales de hace ms; el local
    // es sincrónico pero efímero en Vercel. Se fusionan por id (local gana
    // conflictos) en vez de preferir una sola fuente. Antes: si la nube tenía
    // filas se IGNORABA todo lo local → el overview daba plata/mes 0 para
    // restaurantes creados hace ms (rompió test-admin-panel al reparar el
    // dual-write, que llenó la nube con filas viejas).
    {
      const localR = db.getAllRestaurants();
      if (Array.isArray(localR) && localR.length) {
        const byId = new Map();
        for (const r of restaurants) {
          if (r && r.id) byId.set(String(r.id), r);
        }
        for (const r of localR) {
          if (r && r.id) byId.set(String(r.id), r);
        }
        restaurants = [...byId.values()];
      } else if (!restaurants.length && Array.isArray(localR)) {
        restaurants = localR;
      }
    }
    {
      const localU = db.getAllUsers();
      if (Array.isArray(localU) && localU.length) {
        const byId = new Map();
        for (const u of users) {
          if (u && u.id) byId.set(String(u.id), u);
        }
        for (const u of localU) {
          if (u && u.id) byId.set(String(u.id), u);
        }
        users = [...byId.values()];
      } else if (!users.length && Array.isArray(localU)) {
        users = localU;
      }
    }

    const now = new Date();
    // ¿Trial vencido? Se calcula sin mutar: escribir `isTrialExpired` sobre el
    // objeto compartido del caché dejaba basura que data/restaurants.json
    // persistía en la siguiente escritura.
    const isTrialEnded = (r) => {
      const s = r.subscription;
      return Boolean(s && s.status === 'trialing' && s.trialEndsAt && new Date(s.trialEndsAt) < now);
    };

    // ── Métricas en español llano (sin jerga de negocio) ──
    // KNOWN_PLANS incluye los legacy pro_* (siguen contando plata: sus
    // suscripciones viejas pagan hasta migrar al plan único).
    const DAY_MS = 24 * 60 * 60 * 1000;
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const KNOWN_PLANS = ['starter_monthly', 'starter_annual', 'pro_monthly', 'pro_annual'];
    // Nombres desde el orquestador (fuente única: legacy pro_* → Starter).
    const planNameOf = (p) => { try { return billingOrchestrator.getPlanName(p); } catch { return p; } };
    // Cuánta plata entra al mes por un restaurante que paga (el plan anual se
    // reparte entre 12; el descuento multi-sucursal es el real del orquestador).
    const monthlyEquivalent = (r) => {
      const s = r.subscription || {};
      if (s.status !== 'active' || !KNOWN_PLANS.includes(s.plan)) return 0;
      const pricing = billingOrchestrator.getPlanPricing(r, s.plan);
      return round2(String(s.plan).endsWith('_annual') ? pricing.totalPrice / 12 : pricing.totalPrice);
    };

    const fromSevenDays = new Date(now.getTime() - 7 * DAY_MS);
    const inSevenDays = new Date(now.getTime() + 7 * DAY_MS);

    const payingNow = restaurants.filter(r => (r.subscription || {}).status === 'active');
    const monthlyIncomeEstimate = round2(payingNow.reduce((sum, r) => sum + monthlyEquivalent(r), 0));

    // Renovaciones: clientes que pagan y se les renueva el pago dentro de 7 días
    const renewalsList = payingNow
      .filter(r => {
        const end = r.subscription.currentPeriodEnd && new Date(r.subscription.currentPeriodEnd);
        return Boolean(end && end > now && end <= inSevenDays);
      })
      .map(r => ({
        id: r.id,
        name: r.name || r.bizName || 'Sin nombre',
        slug: r.slug,
        plan: r.subscription.plan,
        planName: planNameOf(r.subscription.plan),
        renewsAt: r.subscription.currentPeriodEnd,
        amountMonthly: monthlyEquivalent(r)
      }))
      .sort((a, b) => new Date(a.renewsAt) - new Date(b.renewsAt));

    // Pruebas que terminan dentro de 7 días (les queda poco de prueba gratis)
    const trialsEndingList = restaurants
      .filter(r => {
        const s = r.subscription || {};
        const end = s.status === 'trialing' && s.trialEndsAt && new Date(s.trialEndsAt);
        return Boolean(end && end > now && end <= inSevenDays);
      })
      .map(r => ({
        id: r.id,
        name: r.name || r.bizName || 'Sin nombre',
        slug: r.slug,
        trialEndsAt: r.subscription.trialEndsAt
      }))
      .sort((a, b) => new Date(a.trialEndsAt) - new Date(b.trialEndsAt));

    // Conversión de la prueba, en criollo: de los que ya terminaron su prueba
    // gratis, ¿cuántos siguen pagando hoy?
    const trialFinished = restaurants.filter(r => {
      const t = r.subscription && r.subscription.trialEndsAt;
      return Boolean(t && new Date(t) < now);
    });
    const trialBecamePaying = trialFinished.filter(r => (r.subscription || {}).status === 'active').length;
    const trialConversionPercent = trialFinished.length
      ? Math.round((trialBecamePaying / trialFinished.length) * 100)
      : 0;

    const totalRestaurants = restaurants.length;
    const activeSubs = restaurants.filter(r => r.subscription && r.subscription.status === 'active').length;
    const trialingSubs = restaurants.filter(r => r.subscription && r.subscription.status === 'trialing' && !isTrialEnded(r)).length;
    const pastDueSubs = restaurants.filter(r => r.subscription && r.subscription.status === 'past_due').length;
    const expiredSubs = restaurants.filter(r => {
      const s = r.subscription || {};
      return s.status === 'expired' || s.status === 'canceled' || isTrialEnded(r);
    }).length;
    const mrrEst = monthlyIncomeEstimate; // alias legacy: misma plata, nombre claro en la UI

    res.json({
      metrics: {
        totalRestaurants,
        totalUsers: users.length,
        activeSubs,
        trialingSubs,
        pastDueSubs,
        expiredSubs,
        mrrEst,
        // Números en criollo (lo que el panel muestra con palabras simples)
        monthlyIncomeEstimate,
        newThisWeek: restaurants.filter(r => r.createdAt && new Date(r.createdAt) >= fromSevenDays).length,
        renewalsCount: renewalsList.length,
        renewalsList,
        trialsEndingCount: trialsEndingList.length,
        trialsEndingList,
        trialFinished: trialFinished.length,
        trialBecamePaying,
        trialConversionPercent
      },
      restaurants,
      users
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/restaurant/:id/status', adminMiddleware, async (req, res) => {
  const { status } = req.body;
  const valid = ['active', 'trialing', 'past_due', 'canceled', 'paused', 'expired'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Estado de suscripción inválido' });

  const { getSupabaseClient } = require('../utils/supabase');
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('restaurants').update({
        subscription: { status, updatedAt: new Date().toISOString() },
        updated_at: new Date().toISOString()
      }).eq('id', req.params.id);
    } catch (e) {
      console.warn('[Supabase status update error]', e.message);
    }
  }

  const updated = await db.setRestaurantStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Restaurante no encontrado' });
  res.json({ success: true, restaurant: updated });
});

router.post('/restaurant/:id/remove-trial', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { getSupabaseClient } = require('../utils/supabase');
    const supabase = getSupabaseClient();

    const updatedSub = {
      status: 'expired',
      provider: 'admin_revoked',
      trialEndsAt: new Date(Date.now() - 1000).toISOString(),
      canceledAt: new Date().toISOString(),
      revokedByAdmin: true
    };

    if (supabase) {
      try {
        await supabase.from('restaurants').update({
          subscription: updatedSub,
          updated_at: new Date().toISOString()
        }).eq('id', id);
      } catch (e) {
        console.warn('[Supabase remove-trial error]', e.message);
      }
    }

    await db.updateSubscription(id, updatedSub);
    res.json({ success: true, message: 'Prueba gratuita revocada exitosamente', subscription: updatedSub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/invite-restaurant', adminMiddleware, async (req, res, next) => {
  try {
    const rawEmail = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || 'Dueño de Restaurante').trim();
    const rawSlug = String(req.body.slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-')).trim();

    if (!rawEmail || !rawEmail.includes('@')) {
      return errorResponse(res, 'Email válido requerido para enviar la invitación', 400, null, 'INVALID_EMAIL');
    }

    const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
    const redirectUrl = `${appUrl}/studio`;
    const { getSupabaseClient } = require('../utils/supabase');
    const supabase = getSupabaseClient();

    let sbUserId = null;
    if (supabase) {
      try {
        const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(rawEmail, {
          redirectTo: redirectUrl,
          data: { name, slug: rawSlug }
        });
        if (!inviteError && inviteData?.user) {
          sbUserId = inviteData.user.id;
        } else if (inviteError) {
          console.warn('[Supabase Invite Warning]', inviteError.message);
        }
      } catch (err) {
        console.warn('[Supabase Invite Exception]', err.message);
      }
    }

    // Create user in local DB
    const user = await db.createUser({
      ...(sbUserId ? { id: sbUserId } : {}),
      email: rawEmail,
      name,
      email_confirmed_at: new Date().toISOString()
    });

    const finalBizName = req.body.restaurantName || req.body.bizName || name;
    const cleanSlug = rawSlug.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);

    const restaurant = await db.saveRestaurant(user.id, {
      name: finalBizName,
      bizName: finalBizName,
      slug: cleanSlug,
      slogan: 'Especialidad, masas artesanales y cocina de autor',
      currency: '$',
      phone: req.body.phone || '59899123456',
      subscription: {
        status: 'active',
        plan: 'starter_monthly',
        provider: 'admin_invite',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    // Send real invitation email using Resend
    const inviteResult = await emailService.sendAdminInvitationEmail({
      to: rawEmail,
      name,
      restaurantName: finalBizName,
      inviteLink: redirectUrl
    });

    const { password: _, ...safeUser } = user;
    return successResponse(
      res,
      { user: safeUser, restaurant, emailDispatch: inviteResult },
      `Invitación enviada exitosamente a ${rawEmail} mediante Resend. El cliente podrá establecer su contraseña mediante el enlace recibido.`,
      201
    );
  } catch (err) {
    next(err);
  }
});

router.get('/reviews', adminMiddleware, (req, res) => {
  try {
    const reviews = db.getAllReviews();
    res.json({ reviews });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/reviews/:id/moderate', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Estado debe ser approved o rejected' });
    }
    const review = await db.updateReviewStatus(req.params.id, status);
    if (!review) return res.status(404).json({ error: 'Reseña no encontrada' });
    res.json({ success: true, review });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/settings/pricing', adminMiddleware, async (req, res) => {
  try {
    const {
      monthlyPrice,
      annualPrice,
      annualDiscountPercent,
      promoBannerEnabled,
      promoDiscountPercent,
      promoBannerText
    } = req.body;

    const payload = {};
    if (monthlyPrice !== undefined) payload.monthlyPrice = Number(monthlyPrice);
    if (annualPrice !== undefined) payload.annualPrice = Number(annualPrice);
    if (annualDiscountPercent !== undefined) payload.annualDiscountPercent = Number(annualDiscountPercent);
    if (promoBannerEnabled !== undefined) payload.promoBannerEnabled = Boolean(promoBannerEnabled);
    if (promoDiscountPercent !== undefined) payload.promoDiscountPercent = Number(promoDiscountPercent);
    if (promoBannerText !== undefined) payload.promoBannerText = String(promoBannerText).trim();

    const updated = await db.updateSettings(payload);
    res.json({ success: true, settings: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Admin Kill-Switch Control para Suscripciones y Registro
router.get('/killswitch', adminMiddleware, (req, res) => {
  res.json({ success: true, allowNewSubscriptions: getSubscriptionKillSwitch() });
});

router.post('/killswitch', adminMiddleware, (req, res) => {
  try {
    const { allowNewSubscriptions } = req.body;
    if (typeof allowNewSubscriptions !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Se requiere allowNewSubscriptions como booleano' });
    }
    const updated = setSubscriptionKillSwitch(allowNewSubscriptions);
    res.json({ success: true, allowNewSubscriptions: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
