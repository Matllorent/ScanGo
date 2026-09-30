// public/js/studio/data/plans.js
// Planes de suscripción (precios en USD).
// Importado por modules/billing.js y modules/branches.js para evitar ciclo.

export const PLANS = {
  starter_monthly: { name: 'Starter Mensual', priceUsd: 9 },
  starter_annual: { name: 'Starter Anual', priceUsd: 79 },
  pro_monthly: { name: 'Pro Mensual', priceUsd: 19 },
  pro_annual: { name: 'Pro Anual', priceUsd: 159 }
};