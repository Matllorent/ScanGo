const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { errorResponse } = require('../utils/response');
const AppError = require('../utils/AppError');

/**
 * Middleware to ensure the user has verified their email address.
 * Blocks menu creation/editing endpoints and publishing if email_confirmed_at is null.
 */
async function requireVerifiedEmail(req, res, next) {
  if (!req.user || !req.user.userId) {
    return next(new AppError('No autorizado', 401, 'UNAUTHORIZED'));
  }

  const userId = req.user.userId;
  const user = db.findUserById(userId);

  const supabase = getSupabaseClient();
  let emailConfirmedAt = null;

  if (supabase) {
    try {
      const { data: sbUser } = await supabase.auth.admin.getUserById(userId);
      if (sbUser && sbUser.user) {
        emailConfirmedAt = sbUser.user.email_confirmed_at || null;
      } else {
        emailConfirmedAt = user?.email_confirmed_at || user?.emailConfirmedAt || null;
      }
    } catch (e) {
      emailConfirmedAt = user?.email_confirmed_at || user?.emailConfirmedAt || null;
    }
  } else {
    // Local JSON DB: if email_confirmed_at explicitly set to null or false, block
    if (user && (user.email_confirmed_at === null || user.emailConfirmed === false)) {
      emailConfirmedAt = null;
    } else {
      // Default fallback for legacy accounts
      emailConfirmedAt = user?.email_confirmed_at || user?.createdAt || new Date().toISOString();
    }
  }

  if (emailConfirmedAt === null) {
    return res.status(403).json({
      success: false,
      error: 'Debés confirmar tu correo electrónico antes de crear, editar o publicar menús. Revisá tu casilla de correo.',
      code: 'EMAIL_NOT_CONFIRMED',
      timestamp: new Date().toISOString()
    });
  }

  req.user.email_confirmed_at = emailConfirmedAt;
  next();
}

module.exports = requireVerifiedEmail;
