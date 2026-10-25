/**
 * tests/helpers/viral-register.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Proceso HIJO de `tests/test-viral-footer.js`. NO es un test por sí solo.
 *
 * ¿Por qué un subproceso? El alta (`POST /api/auth/register`) toca Supabase
 * Auth (`signUp`) y manda el email de bienvenida. Correr 4-5 registros REALES
 * en cada `npm test` con credenciales cloud dejaría usuarios de Auth
 * huérfanos y gastaría la cuota de emails. Acá levantamos el MISMO server
 * (mismo código, misma DB, mismo HTTP) pero en el entorno del hijo NO hay
 * credenciales cloud ni de Resend: el modo dual degrada a local (política del
 * repo) y el email cae al fallback local. Cero mocks: es el flujo real, solo
 * que sin infraestructura externa en ese proceso.
 *
 * Recibe por argv: <slugReferente> <tag>. Imprime una única línea
 * `__VIRAL_RESULT__<json>` que el test padre parsea.
 */
const http = require('http');
const app = require('../../api/index');
const db = require('../../src/db/db');

const MARKER = '__VIRAL_RESULT__';

async function main() {
  const referrerSlug = process.argv[2];
  const tag = process.argv[3];

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  const post = async (body) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const payload = (suffix, extra = {}) => ({
    email: `viral-${suffix}-${tag}@example.com`,
    password: 'test_password',
    ageConfirmed: true,
    name: 'Dueño Viral',
    restaurantName: `Viral ${suffix}`,
    businessType: 'restaurant',
    ...extra
  });

  const results = { statuses: {}, persisted: {} };
  results.statuses.withRef = await post(payload('ref', { ref: referrerSlug }));
  results.statuses.upperRef = await post(payload('upper', { ref: String(referrerSlug).toUpperCase() }));
  results.statuses.noRef = await post(payload('plain'));
  results.statuses.badRef = await post(payload('bad', { ref: 'no-existe-jamas-9999' }));
  results.statuses.demoRef = await post(payload('demo', { ref: 'demo-heladeria' }));

  const readPersisted = (suffix) => {
    const user = db.findUserByEmail(`viral-${suffix}-${tag}@example.com`);
    if (!user) return null;
    const rest = db.findRestaurantByUserId(user.id);
    return rest
      ? { userId: user.id, restaurantId: rest.id, slug: rest.slug, acquiredVia: rest.acquiredVia || '' }
      : { userId: user.id, restaurantId: null, slug: null, acquiredVia: null };
  };
  results.persisted.withRef = readPersisted('ref');
  results.persisted.upperRef = readPersisted('upper');
  results.persisted.noRef = readPersisted('plain');
  results.persisted.badRef = readPersisted('bad');
  results.persisted.demoRef = readPersisted('demo');

  // Payload público de la carta atribuida: el origen NUNCA se expone.
  if (results.persisted.withRef && results.persisted.withRef.slug) {
    const menuRes = await fetch(`${base}/api/menu/${encodeURIComponent(results.persisted.withRef.slug)}`);
    const menuBody = await menuRes.json().catch(() => ({}));
    results.publicMenuStatus = menuRes.status;
    results.publicMenuHasAcquiredVia = Boolean(
      menuBody && menuBody.restaurant && 'acquiredVia' in menuBody.restaurant
    );
  }

  await new Promise((resolve) => server.close(resolve));
  process.stdout.write(`\n${MARKER}${JSON.stringify(results)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`viral-register child failed: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
