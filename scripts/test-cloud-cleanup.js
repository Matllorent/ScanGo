/**
 * scripts/test-cloud-cleanup.js
 * ─────────────────────────────
 * Higiene de la nube para `npm test` (usado por scripts/test-data-guard.js).
 *
 * Los tests corren contra la nube REAL cuando hay credenciales (cero mocks):
 * cada corrida sembraba ~10 restaurantes de prueba (tracking-*, admin-*,
 * loyalty-*, ...) que terminaban indexados en el sitemap de producción.
 * Este helper saca una foto de los slugs cloud antes de la suite y al final
 * borra las filas NUEVAS cuyo slug matchea patrones de QA (+ sus datos
 * asociados y dueños de prueba). Nunca toca filas preexistentes ni
 * suscripciones con cobro real.
 */
try {
  require('dotenv').config();
} catch (e) { /* dotenv opcional */ }

const TEST_SLUG_RES = [
  /^(tracking|security-test|csp-guard|admin-(paying|trial|left|conv)|pay|horario|hardening|consent-qa|push-qa|loyalty-[ab]|discover-|schema-bistro|evento-preview|seo-local|seo-audit|claim|contract|analytics-qa|pent-[ab]|erasable|propdiff|recency|video|heladeria|drill|local-test|hardening)-/i,
  /^claim-\d+$/i,
];

function isTestSlug(slug) {
  return TEST_SLUG_RES.some((re) => re.test(String(slug || '')));
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

const CHILD_TABLES = ['telemetry_events', 'orders', 'reviews', 'customer_feedback', 'group_carts'];

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

async function cleanupCloudTests(slugsBefore) {
  const sb = getClient();
  if (!sb || !slugsBefore) {
    console.log('[cloud-cleanup] Sin nube o sin snapshot: nada que limpiar.');
    return { deleted: 0, skipped: 0 };
  }
  let fresh = [];
  try {
    const { data, error } = await sb.from('restaurants').select('id,slug,user_id,subscription').limit(5000);
    if (error) throw error;
    fresh = data || [];
  } catch (e) {
    console.warn('[cloud-cleanup] Limpieza omitida:', e.message);
    return { deleted: 0, skipped: 0 };
  }
  const victims = fresh.filter((r) => !slugsBefore.has(r.slug) && isTestSlug(r.slug));
  // Nota: también caen fixtures con provider stripe/mercadopago simulado
  // (ej. admin-paying-*): son de prueba por slug/nombre y sin cargos reales.
  // La seguridad está en (a) solo filas NUEVAS de esta corrida y (b) dueños
  // solo si su email es de prueba (@example.com/@test.local/@bistro.com).
  let deleted = 0;
  for (const r of victims) {
    try {
      for (const t of CHILD_TABLES) {
        try {
          await sb.from(t).delete().eq('restaurant_id', r.id);
        } catch (e) { /* tabla/columna ausente: se sigue */ }
      }
      const { error } = await sb.from('restaurants').delete().eq('id', r.id);
      if (error) throw error;
      if (r.user_id) {
        const { data: u } = await sb.from('users').select('id,email').eq('id', r.user_id).single();
        if (u && /@(example\.com|test\.local|bistro\.com)$/.test(u.email || '')) {
          await sb.from('users').delete().eq('id', r.user_id);
        }
      }
      deleted++;
    } catch (e) {
      console.warn(`[cloud-cleanup] No se pudo borrar ${r.slug}:`, e.message);
    }
  }
  console.log(`[cloud-cleanup] Restaurantes de prueba eliminados de la nube: ${deleted}.`);
  return { deleted, skipped: 0 };
}

module.exports = { snapshotCloudSlugs, cleanupCloudTests, isTestSlug };
