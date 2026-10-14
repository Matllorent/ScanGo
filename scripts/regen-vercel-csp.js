/**
 * scripts/regen-vercel-csp.js
 * Regenera el bloque headers de vercel.json desde la fuente única
 * (api/utils/securityHeaders.js) — refleja los hashes SHA-256 actualizados
 * de los scripts inline de admin/index/reset-password.
 *
 * NOTA: Vercel rechaza negative lookahead en `source` (ni `(?!...)` ni
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
  '/admin',
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
const headerList = Object.entries(headers).map(([key, value]) => ({ key, value }));
vercel.headers = STATIC_SOURCES.map((source) => ({
  source,
  headers: headerList.map((h) => ({ ...h }))
}));

fs.writeFileSync(vercelPath, JSON.stringify(vercel, null, 2) + '\n');
console.log(`✓ vercel.json: ${STATIC_SOURCES.length} reglas de headers regeneradas — correr npm run test:csp`);

module.exports = { STATIC_SOURCES };
