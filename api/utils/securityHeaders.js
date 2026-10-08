/**
 * api/utils/securityHeaders.js
 * Única fuente de verdad de los headers de seguridad del app. Se aplica en los
 * DOS caminos de producción (idénticos por contrato, verificado por tests/test-csp.js):
 *
 *  1. Express (api/index.js): middleware que setea estos headers en TODAS las
 *     respuestas (dev, APIs y SSR). El SSR de /m/* reemplaza la CSP por la variante
 *     estricta (strictMenu).
 *  2. Vercel (vercel.json): headers estáticos para las páginas servidas por el CDN
 *     (/studio, /admin, /terminos, /privacidad y cualquier estático) — Express no
 *     pasa por ellas en producción.
 *
 * CSP por capas:
 *  - strictMenu (menú público /m/*): renderiza contenido del restaurante → es el
 *    mayor blanco XSS. script-src-attr 'none' y NINGÚN 'unsafe-inline' en script-src.
 *    Exige que todo handler inline use atributos data-js-* (public/js/dom-bindings.js).
 *  - transitional (resto de páginas): script-src-elem estricto ('self' + CDNs de
 *    confianza + SHA-256 de los scripts inline estáticos) + script-src-attr
 *    'unsafe-inline' para los handlers onclick/onchange legacy de studio/admin/index.
 *    La Etapa 2 del CSP (migración data-js-*) eliminará ese 'unsafe-inline'.
 *
 * TODO lo que el frontend necesita cargar (fonts, CDNs, supabase realtime) está
 * explícitamente permitido; cualquier host nuevo debe agregarse acá Y en vercel.json.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

// ---------------------------------------------------------------------------
// Hashes SHA-256 de los bloques <script> inline (sin src) de las páginas estáticas.
// Se calculan una sola vez (cache) y se incluyen en la CSP transitional.
// Se SKIP: JSON-LD/JSON (inertes) y scripts dentro de comentarios HTML (no ejecutan).
// ---------------------------------------------------------------------------
let cachedHashes = null;
function computeInlineScriptHashes() {
  if (cachedHashes) return cachedHashes;
  const hashes = [];
  if (!fs.existsSync(PUBLIC_DIR)) return hashes;
  for (const file of fs.readdirSync(PUBLIC_DIR)) {
    if (!file.endsWith('.html')) continue;
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(raw))) {
      if (/type=["']application\/[\w.+-]+["']/.test(m[1])) continue; // ld+json / json
      const before = raw.slice(0, m.index);
      const commentDepth = (before.match(/<!--/g) || []).length - (before.match(/-->/g) || []).length;
      if (commentDepth > 0) continue; // dentro de un comentario HTML → no ejecuta
      const hash = crypto.createHash('sha256').update(m[2]).digest('base64');
      hashes.push(`'sha256-${hash}'`);
    }
  }
  cachedHashes = hashes;
  return hashes;
}

// Hosts externos de script autorizados en TODAS las páginas (transaccional).
const SCRIPT_EXTERNALS = [
  'https://cdn.jsdelivr.net', // supabase-js, qrcodejs, jspdf, Chart.js
  'https://cdnjs.cloudflare.com', // Font Awesome (studio)
  'https://accounts.google.com' // GIS / Sign In with Google (landing)
];

// ---------------------------------------------------------------------------
// Directivas CSP (array → serializado con cspToString). Helmet y el test usan
// el mismo objeto; Vercel recibe la string serializada.
// ---------------------------------------------------------------------------
function buildCspDirectives({ strictMenu = false } = {}) {
  const common = {
    'default-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'],
    'frame-ancestors': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'https://checkout.stripe.com', 'https://www.mercadopago.com']
  };
  if (strictMenu) {
    return {
      ...common,
      'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
      'script-src-attr': ["'none'"],
      'frame-src': ["'self'"]
    };
  }
  return {
    ...common,
    'script-src': ["'self'", ...SCRIPT_EXTERNALS, ...computeInlineScriptHashes()],
    'script-src-attr': ["'unsafe-inline'"],
    'frame-src': ["'self'", 'https://accounts.google.com']
  };
}

function cspToString(directives) {
  return Object.entries(directives)
    .map(([name, values]) => `${name}${values.length ? ' ' + values.join(' ') : ''}`)
    .join('; ');
}

const REFERRER_POLICY = 'strict-origin-when-cross-origin';
const PERMISSIONS_POLICY =
  'camera=(), geolocation=(), microphone=(), payment=(), usb=(), serial=(), ' +
  'magnetometer=(), gyroscope=(), ambient-light-sensor=()';
const HSTS = 'max-age=15552000; includeSubDomains';

function getSecurityHeaders({ strictMenu = false } = {}) {
  return {
    'Content-Security-Policy': cspToString(buildCspDirectives({ strictMenu })),
    'Referrer-Policy': REFERRER_POLICY,
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Strict-Transport-Security': HSTS
  };
}

// Middleware express: aplica el set de headers a cualquier respuesta.
function securityHeadersMiddleware(req, res, next) {
  const headers = getSecurityHeaders();
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  next();
}

module.exports = {
  buildCspDirectives,
  cspToString,
  computeInlineScriptHashes,
  getSecurityHeaders,
  securityHeadersMiddleware,
  SCRIPT_EXTERNALS,
  REFERRER_POLICY,
  PERMISSIONS_POLICY
};