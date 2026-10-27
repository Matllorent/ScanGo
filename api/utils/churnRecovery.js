/**
 * churnRecovery.js — Detección de clientes en riesgo de no volver (R1).
 *
 * Módulo PURO (cero I/O, requiere nada del repo): el mismo contrato de pureza
 * que orderMoney/geo/openStatus en api/utils. La data entra por parámetro
 * ( colecciones espejo local o filas cloud, camel-case como las escribe el
 * servicio de fidelización ) y la decisión sale como candidatos ordenados.
 *
 * Filosofía (aprendida de Fornno, adaptada honestamente): convertimos la data
 * que YA tenemos (loyalty_accounts por restaurante: visits + lastVisitAt) en
 * una lista accionable de recupero. NO inventamos scoring de IA: "no volvió"
 * se mide contra su PROPIA frecuencia (pasaron N días desde su última visita).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function maskLocalPhone(phone) {
  if (!phone) return '';
  const normalized = String(phone).replace(/[^\d]/g, '');
  if (normalized.length <= 5) return '*'.repeat(normalized.length || 3);
  return normalized.slice(0, 3) + '***' + normalized.slice(-2);
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const t = Date.parse(value);
  // Solo timestamps pasados (un reloj mal seteado en el cliente no inventa
  // candidatos "del futuro"): un lastVisitAt futuro NO cuenta como reciente,
  // se ignora para no enmascarar clientes realmente ausentes.
  if (!Number.isFinite(t)) return null;
  return t <= Date.now() ? t : null;
}

/**
 * @param {object} options
 * @param {Array} options.accounts - loyalty_accounts (camelCase local o cruída cloud ya espejada)
 * @param {Array} options.customers - customer_profiles
 * @param {string} options.restaurantId - tenant del dueño
 * @param {number} [options.nowMs] - reloj inyectable (testeable, borde a borde)
 * @param {number} [options.daysSinceLastVisit=45] - umbral de ausencia en días (7..365, default 45)
 * @param {number} [options.minVisits=2] - mínimo de visitas para "era recurrente"
 * @returns {{ thresholdDays:number, minVisits:number, count:number, candidates:Array }}
 */
function computeChurnCandidates({ accounts, customers, restaurantId, nowMs = Date.now(), daysSinceLastVisit = 45, minVisits = 2 }) {
  if (!Array.isArray(accounts) || !Array.isArray(customers)) {
    return { thresholdDays: daysSinceLastVisit, minVisits, count: 0, candidates: [] };
  }
  const thresholdDays = clampInt(daysSinceLastVisit, 7, 365, 45);
  // minVisits=1 abre el segmento "probaron UNA vez y no volvieron" (el cliente
  // más barato de reactivar); el tope 10 acota un segmento que de otra forma
  // sería una lista vacía (nadie tiene 999 visitas) y la basura cae al default.
  const thresholdVisits = clampInt(minVisits, 1, 10, 2);
  const cutoffMs = nowMs - thresholdDays * DAY_MS;

  const byId = new Map(customers.map(c => [c && c.id, c]));
  const candidates = [];

  for (const account of accounts) {
    if (!account || account.restaurantId !== restaurantId) continue;
    const visits = Math.max(0, Math.floor(Number(account.visits)) || 0);
    if (visits < thresholdVisits) continue; // nunca fue recurrente: no es churn
    const lastMs = parseTimestamp(account.lastVisitAt);
    if (lastMs === null || lastMs > cutoffMs) continue; // activo (o dato incierto): no flag

    const customer = byId.get(account.customerId) || null;
    const email = customer && typeof customer.email === 'string' ? customer.email.trim() : '';
    const phoneMasked = maskLocalPhone(customer && customer.phone);
    candidates.push({
      customerId: account.customerId,
      phoneMasked,
      name: customer && typeof customer.name === 'string' ? customer.name.slice(0, 60) : '',
      email: email ? domainOnly(email) : '',
      hasEmail: Boolean(email),
      visits,
      points: Math.max(0, Math.floor(Number(account.points)) || 0),
      levelId: account.levelId || (customer && customer.levelId) || 'bronce',
      lastVisitAt: account.lastVisitAt,
      daysSince: Math.floor((nowMs - lastMs) / DAY_MS),
      consentBlocked: Boolean(customer && customer.consentMarketing === false)
    });
  }

  // Los más ausentes primero (riesgo de perderlos hace más tiempo).
  candidates.sort((a, b) => b.daysSince - a.daysSince || b.points - a.points);
  return { thresholdDays, minVisits: thresholdVisits, count: candidates.length, candidates };
}

/** El dueño nunca ve el email crudo: solo el dominio (privacy como loyalty /customers). */
function domainOnly(email) {
  const idx = String(email).lastIndexOf('@');
  return idx >= 0 ? String(email).slice(idx + 1).slice(0, 40) : '';
}

module.exports = { computeChurnCandidates, maskLocalPhone, _DAY_MS: DAY_MS };
