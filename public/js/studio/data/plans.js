// public/js/studio/data/plans.js
// Plan único de suscripción (precios en USD). Las claves pro_* legacy
// resuelven al Starter equivalente (no se venden más desde oct-2026).
// Importado por modules/billing.js y modules/branches.js para evitar ciclo.

export const PLANS = {
  starter_monthly: { name: 'Plan Mensual', priceUsd: 9 },
  starter_annual: { name: 'Plan Anual', priceUsd: 79 },
  pro_monthly: { name: 'Plan Mensual', priceUsd: 9 },
  pro_annual: { name: 'Plan Anual', priceUsd: 79 },
  event_once: { name: 'Evento Único', priceUsd: 12 }
};