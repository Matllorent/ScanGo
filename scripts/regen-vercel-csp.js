/**
 * scripts/regen-vercel-csp.js
 * Regenera el valor Content-Security-Policy del bloque headers de vercel.json
 * desde la fuente única (api/utils/securityHeaders.js) — refleja los hashes
 * SHA-256 actualizados de los scripts inline de admin/index/reset-password.
 *
 * Uso: node scripts/regen-vercel-csp.js   (verifica tests/test-csp.js después)
 */
const fs = require('fs');
const path = require('path');
const { buildCspDirectives, cspToString, getSecurityHeaders } = require('../api/utils/securityHeaders');

const vercelPath = path.resolve(__dirname, '..', 'vercel.json');
const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

const rule = (vercel.headers || []).find(r => r.source.includes('(?!m/|api/)'));
if (!rule) throw new Error('vercel.json: no se encontró la regla de headers con negative lookahead');

const csp = cspToString(buildCspDirectives());
const headers = getSecurityHeaders();
let changed = 0;
for (const [key, value] of Object.entries(headers)) {
  const h = (rule.headers || []).find(x => x.key === key);
  if (!h) throw new Error('vercel.json: falta header ' + key);
  if (h.value !== value) {
    h.value = value;
    changed++;
  }
}

fs.writeFileSync(vercelPath, JSON.stringify(vercel, null, 2) + '\n');
console.log(changed === 0
  ? '✓ vercel.json ya estaba al día (CSP: ' + csp.slice(0, 60) + '…)'
  : '✓ vercel.json actualizado (' + changed + ' header(s)) — correr npm run test:csp');
