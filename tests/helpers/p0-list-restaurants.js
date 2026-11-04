/**
 * tests/helpers/p0-list-restaurants.js
 * ─────────────────────────────────────
 * Proceso hijo del probe P0-3: arranca el módulo de DB real con un
 * `SCANGO_DATA_DIR` vacío (otra réplica de Vercel, cold start) y reporta DOS
 * listados de locales:
 *
 *   - sync: `db.getAllRestaurants()`  → espejo local efímero (/tmp vacío)
 *   - full: `await db.getAllRestaurantsAsync()` → nube paginada ∪ espejo
 *
 * El bug real que este probe fija: con el listado SÍNCRONO, una réplica fría
 * veía 0 locales y los crons (dunning, El Cierre, review-nudge…), el sitemap y
 * `/ciudades` publicaban/operaban sobre una lista vacía hasta que alguien
 * visitaba cada slug (hidratación lazy).
 *
 * Imprime `P0_LIST={"sync":["slug"],"full":["slug"]}` y sale explícitamente
 * (el cliente Supabase deja handles keep-alive; patrón de la casa).
 */
const db = require('../../src/db/db');

function slugsOf(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => (r && typeof r.slug === 'string' ? r.slug : null))
    .filter(Boolean);
}

(async () => {
  await db.ready;
  const sync = slugsOf(db.getAllRestaurants ? db.getAllRestaurants() : []);
  const full = slugsOf(
    db.getAllRestaurantsAsync ? await db.getAllRestaurantsAsync() : []
  );
  process.stdout.write(`P0_LIST=${JSON.stringify({ sync, full })}\n`);
  process.exit(0);
})().catch((err) => {
  console.error('[p0-list-restaurants]', err && err.stack ? err.stack : err);
  process.exit(1);
});
