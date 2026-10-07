const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../../src/db/db');
const emailService = require('../services/email');
const { hashPassword, comparePassword } = require('../utils/hash');
const { registerSchema, loginSchema, validateBody } = require('../middleware/validation');
const { getSupabaseClient } = require('../utils/supabase');
const { successResponse, errorResponse } = require('../utils/response');
const AppError = require('../utils/AppError');
const { checkSubscriptionKillSwitch } = require('../middleware/killSwitch');

const router = express.Router();

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET debe estar definido en el entorno de producción para garantizar la seguridad');
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 3600 * 1000
};

/**
 * Middleware to normalize email in request body before validation
 */
function normalizeEmailInput(req, res, next) {
  if (req.body && req.body.email) {
    req.body.email = String(req.body.email).trim().toLowerCase();
  }
  next();
}

/**
 * GET /api/auth/supabase-config
 * Exposes Supabase URL and anon key to the browser client for OAuth flows.
 * The anon key is intentionally public — it is protected by Row Level Security (RLS).
 */
router.get('/supabase-config', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

/**
 * GET /api/auth/google/config
 * Exposes Google OAuth Client ID for GIS initialization.
 */
router.get('/google/config', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

/**
 * POST /api/auth/google
 * Validates Google ID token via verifyIdToken, checks email_verified,
 * creates or logs in the user, and returns a JWT session.
 */
router.post('/google', checkSubscriptionKillSwitch, async (req, res, next) => {
  try {
    const { credential, restaurantName, businessType } = req.body;

    if (!credential) {
      throw new AppError('No Google credential received.', 400, 'GOOGLE_CREDENTIAL_REQUIRED');
    }

    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
    if (!GOOGLE_CLIENT_ID) {
      throw new AppError('Google sign-in is not configured on the server.', 503, 'GOOGLE_AUTH_NOT_CONFIGURED');
    }

    const client = new OAuth2Client(GOOGLE_CLIENT_ID);

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const googleProfile = ticket.getPayload();

    if (!googleProfile?.email) {
      throw new AppError('Could not retrieve email from Google profile.', 401, 'GOOGLE_EMAIL_MISSING');
    }

    if (googleProfile.email_verified !== true) {
      throw new AppError('Google account must have a verified email.', 401, 'GOOGLE_EMAIL_NOT_VERIFIED');
    }

    const email = googleProfile.email.trim().toLowerCase();
    const requestedType = ['restaurant', 'perfumery', 'events'].includes(businessType)
      ? businessType
      : 'restaurant';
    const requestedRestaurantName = String(restaurantName || '').trim().slice(0, 80);

    let user = db.findUserByEmail(email);
    let restaurant = user ? db.findRestaurantByUserId(user.id) : null;

    const isNewUser = !user;
    if (!user) {
      const randomPassword = crypto.randomBytes(48).toString('hex');
      user = await db.createUser({
        id: 'usr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
        email,
        password: await hashPassword(randomPassword),
        name: String(googleProfile.name || 'Responsable').slice(0, 80),
        email_confirmed_at: new Date().toISOString()
      });
    }

    if (!restaurant) {
      const displayName = googleProfile.name || 'Responsable';
      const restaurantNameFinal = requestedRestaurantName || String(`Mi local (${displayName})`).slice(0, 80);
      restaurant = await db.saveRestaurant(user.id, {
        name: restaurantNameFinal,
        bizName: restaurantNameFinal,
        businessType: requestedType,
        currency: '$',
        theme: 'emerald',
        city: '',
        smartWeatherEnabled: false,
        ...buildStarterMenu()
      });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('auth_token', token, COOKIE_OPTIONS);

    // Welcome email for new Google Auth users (same template as register)
    if (isNewUser && restaurant) {
      const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
      emailService.sendWelcomeEmail({
        to: user.email,
        restaurantName: restaurant.name || restaurant.bizName,
        menuUrl: `${appUrl}/m/${restaurant.slug}`,
        studioUrl: `${appUrl}/studio`
      }).catch((err) => console.error('❌ [WelcomeEmail]', err.message));
    }

    const { password: _, ...safeUser } = user;
    return successResponse(res, { user: safeUser, restaurant, token }, 'Acceso con Google exitoso', 200, { flatData: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/google/callback
 * Handles the redirect-based Google OAuth flow (popup fallback).
 * Expects ID token in URL fragment or query params from Google's OAuth endpoint.
 * This is the fallback when One Tap is not available.
 */
router.get('/google/callback', async (req, res, next) => {
  try {
    // Google OAuth redirect returns the token in the URL fragment (#id_token=...)
    // Since fragments are not sent to the server, this endpoint serves an HTML page
    // that extracts the token from the fragment and posts it to /api/auth/google via fetch.
    
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    
    // HTML page that extracts ID token from fragment and completes auth
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Completando acceso con Google...</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0E1412; color: #F7FAFC; }
    .container { text-align: center; padding: 2rem; }
    .spinner { width: 40px; height: 40px; border: 3px solid rgba(236,201,75,0.3); border-top: 3px solid #ECC94B; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1.5rem; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .msg { font-size: 1rem; color: #A0AEC0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <div class="msg">Completando acceso con Google...</div>
  </div>
  <script>
    (function() {
      // Extract ID token from URL fragment (Google returns it in #id_token=...)
      const fragment = window.location.hash.substring(1);
      const params = new URLSearchParams(fragment);
      const idToken = params.get('id_token');
      
      if (!idToken) {
        // Fallback: check query params (some configurations)
        const searchParams = new URLSearchParams(window.location.search);
        const queryToken = searchParams.get('id_token') || searchParams.get('credential');
        if (queryToken) {
          return completeAuth(queryToken);
        }
        document.body.innerHTML = '<div class="container"><div style="color:#FC8181;">Error: No se recibió token de Google.</div></div>';
        return;
      }
      
      completeAuth(idToken);
      
      async function completeAuth(token) {
        try {
          const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              credential: token,
              restaurantName: '',
              businessType: 'restaurant'
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Error en autenticación');
          
          // Store session and redirect to Studio
          localStorage.setItem('menu_pizarron_token', data.token);
          localStorage.setItem('menu_pizarron_user', JSON.stringify(data.user));
          localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(data.restaurant));
          window.opener?.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', data }, '*');
          window.close();
          window.location.href = '/studio.html';
        } catch (e) {
          document.body.innerHTML = '<div class="container"><div style="color:#FC8181;">Error: ' + e.message + '</div></div>';
        }
      }
    })();
  </script>
</body>
</html>
    `;
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

router.post('/supabase-callback', checkSubscriptionKillSwitch, async (req, res, next) => {
  try {
    const accessToken = String(req.body?.accessToken || '');
    if (!accessToken || accessToken.length > 10000) {
      throw new AppError('No se recibió una sesión válida de Supabase.', 400, 'SUPABASE_ACCESS_TOKEN_REQUIRED');
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new AppError('La autenticación de Supabase no está disponible.', 503, 'SUPABASE_AUTH_UNAVAILABLE');
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const supabaseUser = authData?.user;
    if (authError || !supabaseUser?.id || !supabaseUser.email) {
      throw new AppError('La sesión de Supabase no es válida o expiró.', 401, 'INVALID_SUPABASE_SESSION');
    }

    const providers = supabaseUser.app_metadata?.providers || [];
    if (supabaseUser.app_metadata?.provider !== 'google' && !providers.includes('google')) {
      throw new AppError('La sesión recibida no corresponde a una cuenta Google.', 401, 'GOOGLE_PROVIDER_REQUIRED');
    }

    if (!supabaseUser.email_confirmed_at) {
      throw new AppError('La cuenta de Google debe tener un correo verificado.', 401, 'GOOGLE_EMAIL_NOT_VERIFIED');
    }

    const email = supabaseUser.email.trim().toLowerCase();
    const requestedType = ['restaurant', 'perfumery', 'events'].includes(req.body?.businessType)
      ? req.body.businessType
      : 'restaurant';
    const requestedRestaurantName = String(req.body?.restaurantName || '').trim().slice(0, 80);
    let user = db.findUserByEmail(email);
    let restaurant = user ? db.findRestaurantByUserId(user.id) : null;

    if (!user) {
      const randomPassword = crypto.randomBytes(48).toString('hex');
      user = await db.createUser({
        id: supabaseUser.id,
        email,
        password: await hashPassword(randomPassword),
        name: String(supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || 'Responsable').slice(0, 80),
        email_confirmed_at: new Date().toISOString()
      });
    }

    if (!restaurant) {
      const displayName = supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name;
      const restaurantName = requestedRestaurantName || String(displayName ? `Mi local (${displayName})` : 'Mi Restaurante').slice(0, 80);
      restaurant = await db.saveRestaurant(user.id, {
        name: restaurantName,
        bizName: restaurantName,
        businessType: requestedType,
        currency: '$',
        theme: 'emerald',
        city: '',
        smartWeatherEnabled: false,
        ...buildStarterMenu()
      });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('auth_token', token, COOKIE_OPTIONS);
    const { password: _, ...safeUser } = user;
    return successResponse(res, { user: safeUser, restaurant, token }, 'Google sign-in successful', 200, { flatData: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Menú de ejemplo con el que arranca toda cuenta nueva (registro con correo o
 * con Google): el usuario ve un menú publicable de inmediato en lugar de un
 * Studio vacío, y sirve para probar el flujo completo sin cargar datos.
 */
function buildStarterMenu() {
  return {
    categories: [
      { id: 'cat_hamburguesas', name: 'Burgers Artesanales' },
      { id: 'cat_milanesas', name: 'Milanesas de la Casa' },
      { id: 'cat_postres', name: 'Postres Rioplatenses' },
      { id: 'cat_bebidas', name: 'Bebidas & Cafetería' }
    ],
    dishes: [
      { id: 'd_1', categoryId: 'cat_hamburguesas', name: 'Burger Criolla de Entraña', price: 490, description: 'Pan brioche, provoleta fundida y chimichurri', tags: ['star'] },
      { id: 'd_2', categoryId: 'cat_milanesas', name: 'Milanesa Napolitana Clásica', price: 540, description: 'Lomo empanado, salsa casera, jamón y muzzarella', tags: [] },
      { id: 'd_3', categoryId: 'cat_postres', name: 'Flan Casero con Dulce de Leche', price: 260, description: 'Receta tradicional con crema batida', tags: ['star'] },
      { id: 'd_4', categoryId: 'cat_bebidas', name: 'Flat White Cremoso', price: 190, description: 'Café de especialidad con leche texturizada', tags: ['veggie'] }
    ]
  };
}

/**
 * POST /api/auth/register
 * Handles user registration with email normalization and Supabase Auth email confirmation
 */
router.post('/register', checkSubscriptionKillSwitch, normalizeEmailInput, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password, name, restaurantName, bizName, businessType } = req.body;

    // Disposable domains check
    const disposableDomains = ['yopmail.com','tempmail.com','guerrillamail.com','10minutemail.com','throwaway.email','mailinator.com','trashmail.com','fakeinbox.com','sharklasers.com','guerrillamailblock.com','grr.la','dispostable.com','temp-mail.org','mohmal.com','maildrop.cc'];
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (disposableDomains.includes(emailDomain)) {
      throw new AppError('No se permiten correos temporales o desechables. Usá tu email profesional.', 400, 'DISPOSABLE_EMAIL_REJECTED');
    }

    const existing = db.findUserByEmail(email);
    if (existing) {
      throw new AppError('El email ya está registrado', 400, 'EMAIL_ALREADY_EXISTS');
    }

    // Supabase Auth SignUp with email confirmation redirect URL
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const redirectUrl = `${appUrl}/email-verified.html`;
    let sbUser = null;

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectUrl,
            data: { name, restaurantName: restaurantName || bizName, businessType }
          }
        });
        if (!authError && authData) {
          sbUser = authData.user;
        } else if (authError) {
          // Casos reales: dominio rechazado ("invalid email") o cuota de envíos
          // ("email rate limit exceeded"). Se degrada a cuenta local sin
          // verificación, pero tiene que quedar visible en los logs.
          console.warn('[Supabase Auth SignUp Error]', authError.message, '| email:', email);
        }
      } catch (err) {
        console.warn('[Supabase Auth SignUp Warning]', err.message);
      }
    }

    // Hash password locally
    const hashedPassword = await hashPassword(password);
    const userId = sbUser ? sbUser.id : undefined;

    const user = await db.createUser({
      ...(userId ? { id: userId } : {}),
      email,
      password: hashedPassword,
      name: name || 'Responsable',
      email_confirmed_at: sbUser ? (sbUser.email_confirmed_at || null) : new Date().toISOString()
    });

    const finalBizName = restaurantName || bizName || 'Mi Restaurante';
    const restaurant = await db.saveRestaurant(user.id, {
      name: finalBizName,
      bizName: finalBizName,
      slogan: 'Especialidad, masas artesanales y cocina de autor',
      currency: '$',
      phone: '59899123456',
      theme: 'emerald',
      businessType,
      allowPerfumery: businessType === 'perfumery',
      wifi: { ssid: 'Restaurante_Clientes', password: 'pizarronrico' },
      ...buildStarterMenu()
    });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('auth_token', token, COOKIE_OPTIONS);

    // Send welcome email
    emailService.sendWelcomeEmail({
      to: user.email,
      restaurantName: restaurant.name || restaurant.bizName,
      menuUrl: `${appUrl}/m/${restaurant.slug}`,
      studioUrl: `${appUrl}/studio`
    }).catch((err) => {
      // Fire-and-forget: un fallo de email jamás debe tumbar el proceso
      console.error('❌ [WelcomeEmail]', err.message);
    });

    const { password: _, ...safeUser } = user;
    // Con Supabase activo, la casilla recién se confirma desde el link del correo:
    // el frontend usa este flag para mostrar la pantalla "revisá tu correo"
    // en vez de tirar al usuario a un Studio donde no puede guardar nada (403).
    const requiresEmailVerification = Boolean(sbUser && !sbUser.email_confirmed_at);
    return successResponse(
      res,
      { user: safeUser, restaurant, token, requiresEmailVerification },
      requiresEmailVerification
        ? 'Registro exitoso. Te enviamos un correo para confirmar tu casilla: abrí el enlace para empezar a editar tu menú.'
        : 'Registro exitoso. Tu cuenta está lista: ya podés editar y publicar tu menú.',
      200,
      { flatData: true }
    );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', normalizeEmailInput, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = db.findUserByEmail(email);

    if (!user) {
      throw new AppError('Credenciales incorrectas', 401, 'INVALID_CREDENTIALS');
    }

    const isMatch = user.password.startsWith('$2')
      ? await comparePassword(password, user.password)
      : user.password === password;

    if (!isMatch) {
      throw new AppError('Credenciales incorrectas', 401, 'INVALID_CREDENTIALS');
    }

    const restaurant = db.findRestaurantByUserId(user.id);
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('auth_token', token, COOKIE_OPTIONS);

    const { password: _, ...safeUser } = user;
    return successResponse(res, { user: safeUser, restaurant, token }, 'Inicio de sesión exitoso', 200, { flatData: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', (req, res, next) => {
  try {
    const token = req.cookies.auth_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    if (!token) {
      throw new AppError('No autorizado', 401, 'UNAUTHORIZED');
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.findUserById(decoded.userId);
    const restaurant = db.findRestaurantByUserId(decoded.userId);

    if (!user) {
      throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
    }

    const { password: _, ...safeUser } = user;
    return successResponse(res, { user: safeUser, restaurant }, 'Operación exitosa', 200, { flatData: true });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(new AppError('Token inválido o expirado', 401, 'INVALID_TOKEN'));
    }
    next(err);
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  return successResponse(res, null, 'Cierre de sesión exitoso');
});

/**
 * POST /api/auth/forgot-password
 * Handles automated password recovery email with single-use JTI and strict 15m expiration
 */
router.post('/forgot-password', normalizeEmailInput, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      throw new AppError('El email es requerido', 400, 'EMAIL_REQUIRED');
    }
    const user = db.findUserByEmail(email);
    if (user) {
      const jti = crypto.randomUUID();
      const expiresInSeconds = 15 * 60; // 15 minutos estrictos (entre 15 y 30 minutos)
      const resetToken = jwt.sign(
        { userId: user.id, email: user.email, purpose: 'reset-password' },
        JWT_SECRET,
        { expiresIn: expiresInSeconds, jwtid: jti }
      );

      // Persist active token and jti in DB to guarantee single-use and prevent reuse
      await db.savePasswordResetToken(user.id, jti, Date.now() + expiresInSeconds * 1000);

      const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
      const resetUrl = `${appUrl}/reset-password.html?token=${resetToken}`;
      try {
        await emailService.sendEmail({
          to: user.email,
          subject: 'Recuperación de contraseña - ScanGo',
          html: `<div style="font-family:sans-serif; max-width:600px; margin:0 auto; padding:20px; background:#111; color:#eee; border-radius:8px;">
            <h2 style="color:#d4af37;">Recuperación de Contraseña - ScanGo</h2>
            <p>Hola <strong>${user.name || 'Usuario'}</strong>,</p>
            <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta de restaurante.</p>
            <p style="margin:24px 0;">
              <a href="${resetUrl}" style="background:#d4af37; color:#111; padding:12px 24px; text-decoration:none; font-weight:bold; border-radius:6px; display:inline-block;">Restablecer mi Contraseña</a>
            </p>
            <p style="font-size:12px; color:#888;">Este enlace es de un solo uso y es válido durante 15 minutos. Si no solicitaste este cambio, podés ignorar este mensaje o contactarnos directamente por WhatsApp.</p>
          </div>`
        });
      } catch (mailErr) {
        console.warn('Advertencia al enviar email de recuperación:', mailErr.message);
      }
    }
    return successResponse(res, null, 'Si el correo está registrado en ScanGo, recibirás las instrucciones para restablecer tu contraseña en los próximos minutos.');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/verify-reset-token
 * Validates reset token and JTI single-use status before rendering UI
 */
router.get('/verify-reset-token', (req, res, next) => {
  try {
    const token = req.query.token;
    if (!token) {
      throw new AppError('Token de recuperación requerido', 400, 'TOKEN_REQUIRED');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        throw new AppError('El enlace de recuperación ha expirado (límite de 15 minutos). Por favor solicita uno nuevo.', 401, 'TOKEN_EXPIRED');
      }
      throw new AppError('Token de recuperación inválido o alterado', 401, 'INVALID_TOKEN');
    }

    if (decoded.purpose !== 'reset-password' || !decoded.jti) {
      throw new AppError('Token no válido para recuperación de contraseña', 400, 'INVALID_TOKEN_PURPOSE');
    }

    const isValid = db.isResetTokenValid(decoded.userId, decoded.jti);
    if (!isValid) {
      throw new AppError('Este enlace de recuperación ya ha sido utilizado o ha sido invalidado.', 400, 'TOKEN_ALREADY_USED');
    }

    return successResponse(res, { valid: true, email: decoded.email }, 'Token válido para restablecimiento');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/reset-password
 * Executes password update, verifying single-use JTI and revoking token immediately
 */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password, newPassword } = req.body;
    const finalPassword = password || newPassword;

    if (!token) {
      throw new AppError('Token de recuperación requerido', 400, 'TOKEN_REQUIRED');
    }
    if (!finalPassword || String(finalPassword).length < 6) {
      throw new AppError('La nueva contraseña debe tener al menos 6 caracteres', 400, 'PASSWORD_TOO_SHORT');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        throw new AppError('El enlace de recuperación ha expirado (límite de 15 minutos). Por favor solicita uno nuevo.', 401, 'TOKEN_EXPIRED');
      }
      throw new AppError('Token de recuperación inválido o alterado', 401, 'INVALID_TOKEN');
    }

    if (decoded.purpose !== 'reset-password' || !decoded.jti) {
      throw new AppError('Token no válido para restablecimiento de contraseña', 400, 'INVALID_TOKEN_PURPOSE');
    }

    // Verify JTI has not been consumed yet
    const isValid = db.isResetTokenValid(decoded.userId, decoded.jti);
    if (!isValid) {
      throw new AppError('Este enlace de recuperación ya fue utilizado previamente o ha expirado.', 400, 'TOKEN_ALREADY_USED');
    }

    const user = db.findUserById(decoded.userId);
    if (!user) {
      throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
    }

    // Immediately revoke/invalidate the JTI to prevent reuse
    await db.invalidateResetToken(decoded.jti);

    // Hash new password and update in database
    const hashedPassword = await hashPassword(finalPassword);
    await db.updateUserPassword(user.id, hashedPassword);

    return successResponse(res, null, 'Contraseña restablecida exitosamente. Ya podés iniciar sesión.');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
