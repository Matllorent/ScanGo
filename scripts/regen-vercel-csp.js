/**
 * scripts/regen-vercel-csp.js
 * Regenera las reglas de headers de vercel.json desde la fuente única
 * (api/utils/securityHeaders.js) — refleja los hashes SHA-256 actualizados
 * de los scripts inline de admin/index/reset-password.
 *
 * CORRECCIÓN IMPORTANTE (oct-2026): este proyecto usa la config LEGACY de
 * Vercel (`builds` + `routes`), no `functions`/`rewrites`. En ese modo el
 * bloque top-level `headers` NO se aplica (SecurityHeaders.com daba nota D:
 * sin CSP/Referrer/Permissions/Frame/Nosniff en producción, aunque el JSON
 * tuviera las 9 reglas). Los headers declarados como reglas dentro de
 * `routes` SÍ se aplican: cada regla lleva `continue: true` para que la
 * request alcance su `dest` y salga con los headers pegados.
 *
 * NOTA: Vercel rechaza negative lookahead en `src` (ni `(?!...)` ni
 * `^...`), así que NO hay una sola regla catch-all: hay UNA regla por página
 * estática servida directo por el CDN (`STATIC_SOURCES`). Las rutas que sirve
 * Express (`/m/*`, `/api/*`, `/soluciones*`, `/robots.txt`, `/sitemap.xml`,
 * `/{key}.txt`) reciben sus headers del middleware y quedan FUERA a propósito
 * (si el CDN les sumara la CSP transitional, el browser aplicaría AMBAS y la
 * estricta de `/m/*` se rompería).
 *
 * Uso: node scripts/regen-vercel-csp.js   (verifica tests/test-csp.js después)
 */
const fs = require('fs');
const path = require('path');
const { getSecurityHeaders } = require('../api/utils/securityHeaders');

// Páginas HTML que Vercel sirve como estáticos (ver `routes` en vercel.json).
// Deben cubrir EXACTAMENTE esas rutas: ni `/m/*` ni `/api/*` (Express).
const STATIC_SOURCES = [
  '/',
  '/studio',
  '/kitchen',
  '/mozo',
  '/el-jefe',
  '/terminos',
  '/privacidad',
  '/cookies',
  '/reembolsos',
  '/aviso-legal',
  '/descubrir'
];

const vercelPath = path.resolve(__dirname, '..', 'vercel.json');
const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

const headers = getSecurityHeaders();

// En modo legacy `routes` los headers van APLANADOS (objeto key→value) en cada
// regla, con `continue: true` para no cortar el routing (la request sigue y
// llega a su `dest` estático con los headers de seguridad adjuntos).
const headerObjects = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, value]));

// Sanidad: Vercel rechaza `(?!...)` en los patterns de rutas legacy.
for (const source of STATIC_SOURCES) {
  if (source.includes('(?!') || source.startsWith('^')) {
    throw new Error(`source inválido para Vercel (lookahead/anchor): ${source}`);
  }
}

// Reglas de headers: SIEMPRE al frente del array `routes` (antes de cualquier
// regla con `dest`) para que la anotación suceda antes del match de destino.
const headerRouteRules = STATIC_SOURCES.map((src) => ({
  src,
  headers: { ...headerObjects },
  continue: true
}));

const priorRules = (vercel.routes || []).filter((r) => !(r.continue === true && r.headers && !r.dest));
vercel.routes = [...headerRouteRules, ...priorRules];

// El bloque top-level `headers` quedó sin efecto con `builds`+`routes`: se
// elimina para que no existan dos fuentes de verdad (una muerta y una viva).
delete vercel.headers;

fs.writeFileSync(vercelPath, JSON.stringify(vercel, null, 2) + '\n');
console.log(`✓ vercel.json: ${headerRouteRules.length} reglas de headers dentro de routes (legacy builds) — correr npm run test:csp`);

module.exports = { STATIC_SOURCES };
