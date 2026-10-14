/**
 * Middleware: Kill-Switch de Emergencia para Suscripciones y Registro
 * Permite pausar temporalmente altas de cuentas y checkouts sin afectar menús públicos activos.
 */

const db = require('../../src/db/db');

// Estado en memoria global
let allowNewSubscriptions = true;

try {
  const currentSettings = db.getSettings();
  if (typeof currentSettings.allowNewSubscriptions === 'boolean') {
    allowNewSubscriptions = currentSettings.allowNewSubscriptions;
  }
} catch (e) {
  console.warn('[KillSwitch Init Warning]', e.message);
}

function getSubscriptionKillSwitch() {
  // El entorno manda: en Vercel el flag en memoria/archivo no sobrevive entre
  // instancias serverless. Con ALLOW_NEW_SUBSCRIPTIONS=false las altas quedan
  // pausadas en TODAS las instancias sin importar el estado en memoria.
  if (isEnvBlocked()) return false;
  return allowNewSubscriptions;
}

function setSubscriptionKillSwitch(status) {
  allowNewSubscriptions = Boolean(status);
  // Lanzamiento en background: una falla de persistencia no debe romper el request
  db.updateSettings({ allowNewSubscriptions })
    .catch((e) => console.warn('[KillSwitch Persist Warning]', e.message));
  return allowNewSubscriptions;
}

// Respaldo por entorno para producción serverless (Vercel): la memoria y el
// JSON local no sobreviven entre instancias frías. Con
// ALLOW_NEW_SUBSCRIPTIONS=false|0|no|off las altas quedan pausadas en todas
// las instancias aunque alguien reactive el toggle en una de ellas. Se lee en
// runtime (sin reinicio de código: basta cambiar la env en Vercel).
function isEnvBlocked() {
  const v = String(process.env.ALLOW_NEW_SUBSCRIPTIONS ?? '').trim().toLowerCase();
  return v === 'false' || v === '0' || v === 'no' || v === 'off';
}

function checkSubscriptionKillSwitch(req, res, next) {
  if (isEnvBlocked() || !allowNewSubscriptions) {
    return res.status(503).json({
      success: false,
      error: 'SuscripcionesPausadas',
      message: 'Las altas de cuentas y suscripciones están temporalmente pausadas por mantenimiento.'
    });
  }
  next();
}

module.exports = {
  getSubscriptionKillSwitch,
  setSubscriptionKillSwitch,
  checkSubscriptionKillSwitch
};
