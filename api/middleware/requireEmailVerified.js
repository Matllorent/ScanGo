const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { errorResponse } = require('../utils/response');

/**
 * Middleware to ensure the user has verified their email address.
 * Blocks access and menu publishing for unverified accounts (email_confirmed_at === null).
 */
async function requireEmailVerified(req, res, next) {
  if (!req.user || !req.user.userId) {
    return errorResponse(res, 'No autorizado', 401, null, 'UNAUTHORIZED');
  }

  const userId = req.user.userId;
  let user = db.findUserById(userId);

  // Check Supabase Auth if connected
  const supabase = getSupabaseClient();
  let isConfirmed = false;

  if (supabase) {
    try {
      const { data: sbUser } = await supabase.auth.admin.getUserById(userId);
      if (sbUser && sbUser.user) {
        isConfirmed = Boolean(sbUser.user.email_confirmed_at);
      } else {
        // Fallback check on custom users table or local user
        isConfirmed = Boolean(user && (user.email_confirmed_at || user.emailConfirmedAt || user.emailConfirmed));
      }
    } catch (e) {
      isConfirmed = Boolean(user && (user.email_confirmed_at || user.emailConfirmedAt || user.emailConfirmed));
    }
  } else {
    // Local / JSON DB check
    // If field is not explicitly set in local legacy accounts, consider boolean check
    isConfirmed = user ? (user.email_confirmed_at !== null && user.email_confirmed_at !== undefined ? Boolean(user.email_confirmed_at) : (user.emailConfirmedAt ? Boolean(user.emailConfirmedAt) : true)) : false;
  }

  if (!isConfirmed) {
    return errorResponse(
      res,
      'Debés confirmar tu correo electrónico antes de realizar esta acción. Revisá tu casilla de entrada o correo no deseado.',
      403,
      { email: req.user.email, emailConfirmed: false },
      'EMAIL_NOT_VERIFIED'
    );
  }

  next();
}

module.exports = requireEmailVerified;
