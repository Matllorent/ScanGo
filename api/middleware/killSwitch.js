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
  return allowNewSubscriptions;
}

function setSubscriptionKillSwitch(status) {
  allowNewSubscriptions = Boolean(status);
  try {
    db.updateSettings({ allowNewSubscriptions });
  } catch (e) {
    console.warn('[KillSwitch Persist Warning]', e.message);
  }
  return allowNewSubscriptions;
}

function checkSubscriptionKillSwitch(req, res, next) {
  if (!allowNewSubscriptions) {
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
