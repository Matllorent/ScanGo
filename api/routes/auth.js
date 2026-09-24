const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../../src/db/db');
const emailService = require('../../src/email/emailService');
const { hashPassword, comparePassword } = require('../utils/hash');
const { registerSchema, loginSchema, validateBody } = require('../middleware/validation');
const { getSupabaseClient } = require('../utils/supabase');
const { successResponse, errorResponse } = require('../utils/response');
const AppError = require('../utils/AppError');

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
 * POST /api/auth/register
 * Handles user registration with email normalization and Supabase Auth email confirmation
 */
router.post('/register', normalizeEmailInput, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password, name, restaurantName, bizName } = req.body;

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
            data: { name, restaurantName: restaurantName || bizName }
          }
        });
        if (!authError && authData) {
          sbUser = authData.user;
        }
      } catch (err) {
        console.warn('[Supabase Auth SignUp Warning]', err.message);
      }
    }

    // Hash password locally
    const hashedPassword = await hashPassword(password);
    const userId = sbUser ? sbUser.id : undefined;

    const user = db.createUser({
      ...(userId ? { id: userId } : {}),
      email,
      password: hashedPassword,
      name: name || 'Responsable',
      email_confirmed_at: sbUser?.email_confirmed_at || null
    });

    const finalBizName = restaurantName || bizName || 'Mi Restaurante';
    const restaurant = db.saveRestaurant(user.id, {
      name: finalBizName,
      bizName: finalBizName,
      slogan: 'Especialidad, masas artesanales y cocina de autor',
      currency: '$',
      phone: '59899123456',
      theme: 'emerald',
      wifi: { ssid: 'Restaurante_Clientes', password: 'pizarronrico' },
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
    });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('auth_token', token, COOKIE_OPTIONS);

    // Send welcome email
    emailService.sendWelcome({
      to: user.email,
      restaurantName: restaurant.name || restaurant.bizName,
      menuUrl: `${appUrl}/m/${restaurant.slug}`,
      studioUrl: `${appUrl}/studio`
    });

    const { password: _, ...safeUser } = user;
    return successResponse(res, { user: safeUser, restaurant, token }, 'Registro exitoso. Se ha enviado un correo de confirmación.', 201);
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
    return successResponse(res, { user: safeUser, restaurant, token }, 'Inicio de sesión exitoso');
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
    return successResponse(res, { user: safeUser, restaurant });
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

module.exports = router;
