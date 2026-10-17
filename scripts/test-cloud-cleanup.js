/**
 * scripts/test-cloud-cleanup.js
 * ─────────────────────────────
 * Higiene de la nube para `npm test` (usado por scripts/test-data-guard.js).
 *
 * Los tests corren contra la nube REAL cuando hay credenciales (cero mocks):
 * cada corrida siembra restaurantes y usuarios de prueba (tracking-*,
 * session-test-*, vanguardia-test-*, loyalty-*, ...) que terminaban
 * indexados en el sitemap de producción y acumulándose sin límite
 * (hallazgo oct-2026: 774 usuarios y ~20 restaurantes de prueba).
 *
 * Regla de selección (segura por definición):
 *   · DUEÑO con email de prueba ⇒ basura. Los dominios son reservados
 *     (RFC 2606: example.com/test.local) o el local-part es un prefijo
 *     sintético (test-*, session-owner-*, diag_api_*, qa-*): ninguna
 *     persona real puede recibir correo ahí, por lo que ningún cliente
 *     real puede quedar atrapado en la purga.
 *   · Fallback (dueño ya borrado / fila huérfana): slug de patrón de QA
 *     + foto previa (snapshot) — las filas preexistentes con dueño real
 *     jamás se tocan.
 *   · Webhooks con ID fixture (`evt_*_<epoch-13>`, `sub_evt_*`, `idem-*`):
 *     siempre, sin snapshot — los IDs reales de las pasarelas no tienen
 *     esa forma, así que no hay riesgo de borrar un registro contable real.
 *   · Perfiles de cliente: solo los enlazados a restaurantes víctima vía
 *     `loyalty_accounts` (capturados ANTES del barrido de cuentas).
 *
 * El espejo LOCAL de data/ se limpia con las mismas reglas en
 * scripts/test-data-guard.js (`purgeLocalFixtures`, post-restore).
 *
 * A diferencia del guard anterior (oct-2026), esto además purga la basura
 * que YA existía y detiene la acumulación futura de corridas standalone
 * (`node tests/test-x.js`), que no pasan por el data-guard.
 */
try {
  require('dotenv').config();
} catch (e) { /* dotenv opcional */ }

// Fallback por slug (huérfanos sin dueño). El guion final va FUERA del
// grupo: la rama `discover` debe matchear `discover-qa1-...`, no `discover--`.
const TEST_SLUG_RES = [
  /^(tracking|security-test|csp-guard|admin-(paying|trial|left|conv)|pay|horario|hardening|consent-qa|push-qa|loyalty-[ab]|discover|schema-bistro|evento-preview|seo-local|seo-audit|claim|contract|analytics-qa|pent-[ab]|erasable|propdiff|recency|video|heladeria|drill|local-test|session-test|vanguardia-test|esquina-gourmet|perfil-predeterminado|helader-a)-/i,
  /^(esquina-gourmet|perfil-predeterminado|helader-a-(test|off)|scan-go-bistro)$/i,
  /^claim-\d+$/i,
];

// Email de prueba: dominio reservado o prefijo sintético del local-part.
const TEST_EMAIL_RES = [
  /@(example\.com|test\.local|bistro\.com)$/i,
  /^(test[-._]|session-owner-|diag_api_|qa[-._])/i,
];

// Webhooks de idempotencia: cada corrida (también standalone) marca eventos
// con IDs fixture — `evt_test_<epoch-13>`, `evt_recency_*_<epoch>`,
// `sub_evt_<epoch>`, `idem-<epoch>` — y se replicaban a la nube SIN limpieza.
// Los IDs reales de las pasarelas nunca siguen esta forma (Stripe:
// `evt_`+24 alnum; Lemon/MP: numérico o UUID), así que la regla no puede
// tocar un registro contable real. Si un test nuevo inventa otro prefijo,
// agregarlo acá.
const TEST_WEBHOOK_EVENT_RES = [
  /^evt_[a-z_]+_\d{13}$/,
  /^sub_evt_\d+$/,
  /^idem-\d+$/,
];

function isTestSlug(slug) {
  return TEST_SLUG_RES.some((re) => re.test(String(slug || '')));
}

function isTestEmail(email) {
  return TEST_EMAIL_RES.some((re) => re.test(String(email || '')));
}

function isTestWebhookEventId(eventId) {
  return TEST_WEBHOOK_EVENT_RES.some((re) => re.test(String(eventId || '')));
}

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    // eslint-disable-next-line global-require
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key);
  } catch (e) {
    return null;
  }
}

// TODAS las tablas con restaurant_id (information_schema, oct-2026). Borrar
// solo 5 de 10 dejaba filas huérfanas que inflaban telemetry/pedidos.
const CHILD_TABLES = [
  'telemetry_events',
  'orders',
  'reviews',
  'customer_feedback',
  'group_carts',
  'loyalty_accounts',
  'loyalty_ledger',
  'loyalty_redemptions',
  'notification_events',
  'push_subscriptions',
];

/** Lee todos los usuarios (id, email) paginando. */
async function fetchUsers(sb) {
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from('users')
      .select('id,email')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** Lee todos los restaurantes (id, slug, user_id) paginando. */
async function fetchRestaurants(sb) {
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from('restaurants')
      .select('id,slug,user_id')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/**
 * Lee una columna paginando (ids, customer_id, restaurant_id…).
 * PostgREST no expone DISTINCT: el dedupe lo hace quien llama.
 * Si alguna tabla crece mucho en producción, mover a un RPC con DISTINCT
 * (precedente: `claim_loyalty_redemption`) en vez de paginar más.
 */
async function fetchIds(sb, table, col) {
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from(table)
      .select(col)
      .order(col, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []).map((r) => r[col]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

async function snapshotCloudSlugs() {
  const sb = getClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from('restaurants').select('slug').limit(5000);
    if (error) throw error;
    return new Set((data || []).map((r) => r.slug));
  } catch (e) {
    console.warn('[cloud-cleanup] Snapshot cloud omitido:', e.message);
    return null;
  }
}

/**
 * Purga los webhooks fixture de la nube (IDs de prueba). SIEMPRE corre:
 * no depende de restaurantes/usuarios víctimas.
 * @returns {Promise<number>} cuántas filas fixture borró.
 */
async function purgeTestWebhooks(sb) {
  try {
    const { data, error } = await sb.from('webhooks').select('id,event_id').limit(10000);
    if (error) throw error;
    const ids = (data || []).filter((r) => isTestWebhookEventId(r.event_id)).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      const { error: delErr } = await sb.from('webhooks').delete().in('id', ids.slice(i, i + 500));
      if (delErr) throw delErr;
    }
    return ids.length;
  } catch (e) {
    console.warn('[cloud-cleanup] webhooks:', e.message);
    return 0;
  }
}

/**
 * Barrido final de HUÉRFANOS: filas cuyo restaurante/dueño ya no (o nunca)
 * existió en la nube. Caza el dual-write asimétrico que los sweeps por
 * victimIds no alcanzan: hijos replicados con éxito mientras el padre fue
 * rechazado por FK o sigue pendiente (grupo_carts de ids fixture,
 * telemetry de locales que nunca aterrizaron, perfiles sin cuenta), y
 * auditoría escrita con tenant=dueño de fixture.
 *
 * Seguridad para datos reales:
 *  - Un hijo REAL siempre tiene su restaurante vivo → sobrevive el filtro.
 *  - El ancla de un perfil es su CUENTA viva (loyalty_accounts, siempre
 *    con restaurante): el ledger global `restaurant_id NULL` NO ancla (lo
 *    haría auto-sostenible el residuo). Espejo de la regla local; un
 *    cliente real siempre termina con su cuenta (creditOrder reintenta y
 *    /me la re-registra), y un perfil sin cuenta no tiene puntos que
 *    perder (visitas/puntos se incrementan junto a su ledger, que sale en
 *    cascada).
 *  - La auditoría solo se considera con `created_at >= since`: el registro
 *    de procesamiento de una cuenta real borrada (huérfano por diseño,
 *    invariant RGPD documentado) JAMÁS se toca. Y solo se borra fila con
 *    AMBAS entidades muertas y no-nulas; con entidades vivas o dudosas
 *    se conserva (conservador por defecto).
 *
 * @param {object} sb cliente supabase (service role).
 * @param {string} since ISO: corte "creado durante esta corrida".
 * @returns {Promise<Record<string, number>>} borradas por tabla.
 */
async function purgeOrphanResidue(sb, since) {
  const purged = {};
  const add = (table, n) => {
    if (n > 0) purged[table] = (purged[table] || 0) + n;
  };

  // Entidades vivas DESPUÉS de la purga de víctimas (locales/usuarios reales).
  let alive;
  try {
    const [restIds, userIds] = await Promise.all([
      fetchIds(sb, 'restaurants', 'id'),
      fetchIds(sb, 'users', 'id'),
    ]);
    alive = new Set([...restIds, ...userIds]);
  } catch (e) {
    console.warn('[cloud-cleanup] huérfanos (entidades vivas):', e.message);
    return purged;
  }

  // 1) Hijos con restaurante que ya no existe en la nube. Distinct en JS
  //    (acotado: valores únicos por tabla), delete por lotes.
  for (const t of CHILD_TABLES) {
    try {
      if (alive.size === 0) {
        // Sin entidades vivas todo hijo con restaurante no-nulo es huérfano.
        const { data, error } = await sb.from(t).delete().not('restaurant_id', 'is', null).select('id');
        if (error) throw error;
        add(t, (data || []).length);
        continue;
      }
      const rids = [...new Set(await fetchIds(sb, t, 'restaurant_id'))].filter((r) => r && !alive.has(r));
      if (rids.length === 0) continue;
      const { data, error } = await sb.from(t).delete().in('restaurant_id', rids).select('id');
      if (error) throw error;
      add(t, (data || []).length);
    } catch (e) {
      console.warn(`[cloud-cleanup] ${t} (huérfanos):`, e.message);
    }
  }

  // 2) Perfiles sin CUENTA viva. El ancla es loyalty_accounts (siempre
  //    tiene restaurante): el ledger GLOBAL es `restaurant_id NULL`, no
  //    puede anclar — con ancla "cuenta Ó ledger" el residuo de corrida se
  //    auto-sostenía (perfil ← ledger global ← perfil…). Espejo exacto de
  //    la regla local de purgeLocalFixtures (cuentas → perfiles). Los
  //    renglones de ledger/canjes de clientes sin columna viva salen en
  //    cascada acá (los de restaurante muerto ya salieron en 1).
  try {
    const [accountCustomers, profileIds, ledCustomers, redCustomers] = await Promise.all([
      fetchIds(sb, 'loyalty_accounts', 'customer_id'),
      fetchIds(sb, 'customer_profiles', 'id'),
      fetchIds(sb, 'loyalty_ledger', 'customer_id'),
      fetchIds(sb, 'loyalty_redemptions', 'customer_id'),
    ]);
    const anchored = new Set(accountCustomers.filter(Boolean));
    const orphans = profileIds.filter((id) => id && !anchored.has(id));
    for (let i = 0; i < orphans.length; i += 500) {
      const { data, error } = await sb
        .from('customer_profiles')
        .delete()
        .in('id', orphans.slice(i, i + 500))
        .select('id');
      if (error) throw error;
      add('customer_profiles', (data || []).length);
    }
    const unanchored = [...new Set([...ledCustomers, ...redCustomers].filter((c) => c && !anchored.has(c)))];
    for (let i = 0; i < unanchored.length; i += 500) {
      const batch = unanchored.slice(i, i + 500);
      const { data: l, error: le } = await sb.from('loyalty_ledger').delete().in('customer_id', batch).select('id');
      if (le) throw le;
      add('loyalty_ledger', (l || []).length);
      const { data: r, error: re } = await sb.from('loyalty_redemptions').delete().in('customer_id', batch).select('id');
      if (re) throw re;
      add('loyalty_redemptions', (r || []).length);
    }
  } catch (e) {
    console.warn('[cloud-cleanup] customer_profiles (huérfanos):', e.message);
  }

  // 3) Auditoría de ESTA corrida con ambas entidades (tenant + usuario)
  //    muertas y no-nulas. `since` protege el histórico real: las filas de
  //    una cuenta borrada son huérfanas por diseño y deben persistir.
  try {
    const { data, error } = await sb
      .from('audit_logs')
      .select('id,tenant_id,user_id')
      .gte('created_at', since)
      .limit(10000);
    if (error) throw error;
    const orphans = (data || [])
      .filter((a) => a.tenant_id && a.user_id && !alive.has(a.tenant_id) && !alive.has(a.user_id))
      .map((a) => a.id);
    for (let i = 0; i < orphans.length; i += 500) {
      const { data: gone, error: delErr } = await sb
        .from('audit_logs')
        .delete()
        .in('id', orphans.slice(i, i + 500))
        .select('id');
      if (delErr) throw delErr;
      add('audit_logs', (gone || []).length);
    }
  } catch (e) {
    console.warn('[cloud-cleanup] audit_logs (huérfanos):', e.message);
  }

  return purged;
}

/** Formatea el mapa de huérfanos para el log final ("" si no hay nada). */
function formatOrphans(purged) {
  const parts = Object.entries(purged).map(([t, n]) => `${t}: ${n}`);
  return parts.length ? ` Huérfanos: ${parts.join(', ')}.` : '';
}

/**
 * Borra la basura de prueba de la nube.
 * @param {Set<string>} [slugsBefore] foto opcional de slugs pre-correr
 *   (solo se usa como fallback para huérfanos sin dueño).
 * @param {object} [opts]
 * @param {string} [opts.runStartedAt] ISO de inicio de la corrida: corte
 *   para el barrido de auditoría huérfana (nunca toca el histórico real).
 */
async function cleanupCloudTests(slugsBefore, opts = {}) {
  const since = opts.runStartedAt || new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const sb = getClient();
  if (!sb) {
    console.log('[cloud-cleanup] Sin nube: nada que limpiar.');
    return { deleted: 0, skipped: 0 };
  }
  let users = [];
  let restaurants = [];
  try {
    users = await fetchUsers(sb);
    restaurants = await fetchRestaurants(sb);
  } catch (e) {
    console.warn('[cloud-cleanup] Limpieza omitida:', e.message);
    return { deleted: 0, skipped: 0 };
  }

  const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
  // Basura por definición: dueño con email de prueba (cualquier edad), o
  // slug de QA sin dueño conocido + no preexistente (huérfano de corrida).
  const victims = restaurants.filter((r) => {
    const email = emailByUserId.get(r.user_id);
    if (email && isTestEmail(email)) return true;
    if (!isTestSlug(r.slug)) return false;
    return !slugsBefore || !slugsBefore.has(r.slug);
  });
  const victimIds = new Set(victims.map((r) => r.id));
  // Dueños de prueba: todos los de email de prueba (propios de la basura).
  const victimUsers = users.filter((u) => isTestEmail(u.email));
  const victimUserIds = new Set(victimUsers.map((u) => u.id));

  // 1) Webhooks fixture: SIEMPRE (independe de víctimas; hoy la tabla solo
  //    acumula marcadores de corridas de tests).
  const webhooksDeleted = await purgeTestWebhooks(sb);

  if (victims.length === 0 && victimUsers.length === 0) {
    // Sin víctimas aún puede haber huérfanos de esta corrida (hijos con
    // padre rechazado por FK, auditoría con tenant=fixture, perfiles sin
    // enlace): el barrido corre igual contra las entidades vivas actuales.
    const orphans = await purgeOrphanResidue(sb, since);
    console.log(
      `[cloud-cleanup] Nube limpia: sin restaurantes ni usuarios de prueba`
      + `${webhooksDeleted ? ` (webhooks fixture: ${webhooksDeleted})` : ''}.`
      + formatOrphans(orphans)
    );
    return { deleted: 0, skipped: 0 };
  }

  // 2) Perfiles de cliente ligados a las víctimas: se capturan los ids ANTES
  //    del barrido de hijas, porque loyalty_accounts ES la evidencia de
  //    enlace — customer_profiles no tiene restaurant_id y restaurants_visited
  //    es un contador, no una lista de ids. Sin esta regla cada corrida
  //    re-sembraba perfiles fixture con teléfonos de prueba (291 al oct-2026).
  let victimProfileIds = [];
  if (victimIds.size > 0) {
    try {
      const { data: accs, error } = await sb
        .from('loyalty_accounts')
        .select('customer_id')
        .in('restaurant_id', [...victimIds])
        .limit(10000);
      if (error) throw error;
      victimProfileIds = [...new Set((accs || []).map((a) => a.customer_id).filter(Boolean))];
    } catch (e) {
      console.warn('[cloud-cleanup] perfiles (enlace):', e.message);
    }
  }
  // 3) Esos perfiles + su ledger/canjes (incluye el ledger GLOBAL con
  //    restaurant_id NULL — "order_global" — que ningún barrido por
  //    restaurant_id alcanzaba).
  for (let i = 0; i < victimProfileIds.length; i += 100) {
    const batch = victimProfileIds.slice(i, i + 100);
    try {
      await sb.from('customer_profiles').delete().in('id', batch);
      await sb.from('loyalty_ledger').delete().in('customer_id', batch);
      await sb.from('loyalty_redemptions').delete().in('customer_id', batch);
    } catch (e) {
      console.warn('[cloud-cleanup] perfiles/ledger:', e.message);
    }
  }

  let deleted = 0;
  // 4) Hijos por restaurant_id (todas las tablas; sin FK en la nube, el
  //    orden importa solo para no dejar huérfanos).
  for (const t of CHILD_TABLES) {
    try {
      await sb.from(t).delete().in('restaurant_id', [...victimIds]);
    } catch (e) {
      console.warn(`[cloud-cleanup] ${t}:`, e.message);
    }
  }
  // 5) Auditoría: por tenant (restaurante) y por usuario.
  try {
    await sb.from('audit_logs').delete().in('tenant_id', [...victimIds]);
    await sb.from('audit_logs').delete().in('user_id', [...victimUserIds]);
  } catch (e) {
    console.warn('[cloud-cleanup] audit_logs:', e.message);
  }
  // 6) Push también por user_id (suscripciones sin restaurante).
  try {
    await sb.from('push_subscriptions').delete().in('user_id', [...victimUserIds]);
  } catch (e) {
    console.warn('[cloud-cleanup] push_subscriptions(user_id):', e.message);
  }
  // 7) Restaurantes y usuarios (la FK restaurants.user_id → users es
  //    CASCADE: borrar el usuario borraría restaurantes sin limpiar sus
  //    hijos, por eso los hijos ya salieron en 4).
  try {
    await sb.from('restaurants').delete().in('id', [...victimIds]);
    deleted = victimIds.size;
  } catch (e) {
    console.warn('[cloud-cleanup] restaurants:', e.message);
  }
  for (let i = 0; i < victimUsers.length; i += 100) {
    const batch = victimUsers.slice(i, i + 100).map((u) => u.id);
    try {
      await sb.from('users').delete().in('id', batch);
    } catch (e) {
      console.warn('[cloud-cleanup] users:', e.message);
    }
  }

  // 8) Cierre de huérfanos DESPUÉS de borrar víctimas: `alive` queda como
  //    "entidades reales supervivientes" y cualquier hijo/auditoría/perfil
  //    cuyas entidades murieron (o nunca existieron en la nube) sale acá.
  const orphans = await purgeOrphanResidue(sb, since);

  console.log(
    `[cloud-cleanup] Eliminado de la nube: ${deleted} restaurant(es) de prueba, `
    + `${victimUsers.length} usuario(s) de prueba + datos asociados`
    + `${victimProfileIds.length ? `, ${victimProfileIds.length} perfil(s) de cliente` : ''}`
    + `${webhooksDeleted ? `, ${webhooksDeleted} webhook(s) fixture` : ''}.`
    + formatOrphans(orphans)
  );
  return { deleted, skipped: 0 };
}

module.exports = {
  snapshotCloudSlugs,
  cleanupCloudTests,
  isTestSlug,
  isTestEmail,
  isTestWebhookEventId,
};
