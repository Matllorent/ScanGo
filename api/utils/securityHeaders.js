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
 *    mayor blanco XSS. script-src solo 'self' + supabase-js (jsdelivr) +
 *    Turnstile invisible (challenges.cloudflare.com, anti-spam del checkout) +
 *    Clarity (www.clarity.ms, solo con consentimiento 'all').
 *  - transitional (resto de páginas): script-src-elem estricto ('self' + CDNs de
 *    confianza + SHA-256 de los scripts inline estáticos).
 *  - Ambas variantes usan script-src-attr 'none' (Etapa 2 completa): NO existe
 *    ningún atributo on* en todo public/ — todo handler pasa por data-js-*
 *    (public/js/dom-bindings.js). tests/test-csp.js lo verifica con scan estático.
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
// OJO: el browser NORMALIZA los line-endings (CRLF→LF) del cuerpo del script antes
// de hashear (CSP spec) — si el archivo es CRLF y se hashea crudo, el hash no
// coincide y el script inline queda BLOQUEADO (bug latente con admin.html).
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
      const body = m[2].replace(/\r\n/g, '\n').replace(/\r/g, '\n'); // como hace el browser
      const hash = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
      hashes.push(`'sha256-${hash}'`);
    }
  }
  cachedHashes = hashes;
  return hashes;
}

// Hosts externos de script autorizados en TODAS las páginas (transaccional).
const SCRIPT_EXTERNALS = [
  'https://cdn.jsdelivr.net', // supabase-js, qrcodejs, jspdf, Chart.js
  'https://cdnjs.cloudflare.com', // qrcodejs, jspdf y Chart.js del Studio (scripts)
  'https://accounts.google.com' // GIS / Sign In with Google (landing)
];

// ---------------------------------------------------------------------------
// Directivas CSP (array → serializado con cspToString). Helmet y el test usan
// el mismo objeto; Vercel recibe la string serializada.
// ---------------------------------------------------------------------------
function buildCspDirectives({ strictMenu = false } = {}) {
  const common = {
    'default-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"], // fuentes auto-hospedadas en /fonts (cero requests a Google/cdnjs: RGPD, sentencia Múnich)
    'font-src': ["'self'", 'data:'], // woff2 locales + fuentes decorativas; FA local en /fonts/fa
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    // Video de Stories por plato (link MP4 directo del dueño): media separado
    // de img (nunca data:/blob: — un base64 de video inflaría filas y ciega
    // la cuota). El navegador igual exige gesto/política para autoplay.
    'media-src': ["'self'", 'https:'],
    'connect-src': ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://www.clarity.ms', 'https://*.clarity.ms'],
    'frame-ancestors': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'https://checkout.stripe.com', 'https://www.mercadopago.com']
  };
  if (strictMenu) {
    return {
      ...common,
      // Turnstile invisible (anti-spam en el checkout del comensal) +
      // Microsoft Clarity (medición de uso, solo con consentimiento 'all').
      // La cadena de Clarity es www.clarity.ms/tag/... que DESPUÉS carga el
      // loader real desde scripts.clarity.ms: sin ese host la CSP bloqueaba
      // el loader y el tag quedaba mudo (bug cazado en QA con navegador).
      'script-src': ["'self'", 'https://cdn.jsdelivr.net', 'https://challenges.cloudflare.com', 'https://www.clarity.ms', 'https://scripts.clarity.ms'],
      'script-src-attr': ["'none'"],
      'connect-src': [...common['connect-src'], 'https://challenges.cloudflare.com'],
      'frame-src': ["'self'", 'https://challenges.cloudflare.com']
    };
  }
  return {
    ...common,
    // Microsoft Clarity (medición de uso, solo con consentimiento 'all'):
    // www.clarity.ms/tag carga el loader real desde scripts.clarity.ms.
    'script-src': ["'self'", ...SCRIPT_EXTERNALS, 'https://www.clarity.ms', 'https://scripts.clarity.ms', ...computeInlineScriptHashes()],
    'script-src-attr': ["'none'"], // Etapa 2 completa: cero handlers inline en TODO public/
    'frame-src': ["'self'", 'https://accounts.google.com']
  };
}

function cspToString(directives) {
  return Object.entries(directives)
    .map(([name, values]) => `${name}${values.length ? ' ' + values.join(' ') : ''}`)
    .join('; ');
}

const REFERRER_POLICY = 'strict-origin-when-cross-origin';
// `usb=(self)` (y NO `usb=()`): el Studio usa WebUSB para la impresora térmica
// ESC/POS (public/js/studio.js, §27). Denegarlo por completo deshabilitaba la
// función en producción. `self` = el propio origen (el dueño conecta SU
// impresora con un gesto), no iframes de terceros.
// Sin `ambient-light-sensor`: Chrome ya no reconoce esa feature y el header
// ensuciaba la consola con "Unrecognized feature" en cada carga.
const PERMISSIONS_POLICY =
  'camera=(), geolocation=(), microphone=(), payment=(), usb=(self), serial=(), ' +
  'magnetometer=(), gyroscope=()';
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