/**
 * api/utils/seoDiscovery.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Compilador de descubrimiento SEO/GEO del SaaS (función PURA, sin I/O):
 * transforma la MISMA data validada de cada restaurante en los artefactos que
 * buscan Google y los buscadores de IA, sin escritura manual ni drift:
 *
 *   - buildRobotsTxt(appUrl)        → política de rastreo (buscadores + IA)
 *   - buildSitemapXml({...})        → sitemap con menús activos, sucursales y
 *                                     páginas legales (lastmod por restaurante)
 *   - buildOpeningHoursFromSchedule → OpeningHoursSpecification DERIVADO del
 *                                     horario real (scheduleActiveHours, la
 *                                     misma fuente de verdad que computeOpenStatus
 *                                     del Bloque 1), con soporte de ventana
 *                                     nocturna (18:00-02:00 = dos tramos).
 *
 * Prioridad 1+3 de la estrategia SEO/GEO: HTML rastreable, datos estructurados
 * coherentes con lo visible y acceso controlado a los rastreadores de IA.
 * Los artefactos se sirven desde Express (/robots.txt, /sitemap.xml y el
 * JSON-LD del SSR /m/:slug) también en Vercel (ver routes en vercel.json).
 */

const DEFAULT_BASE_URL = 'https://scango.uy';

/** Días de la semana (schema.org DayOfWeek). */
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Rastreadores de IA con política explícita. Distinción documentada:
 *  - De BÚSQUEDA (querés que citen al restaurante): OAI-SearchBot (ChatGPT
 *    Search), ChatGPT-User, PerplexityBot, Google-Extended (Gemini/Google AI),
 *    Bing Copilot (cae en Bingbot), Applebot (Siri/Spotlight).
 *  - De ENTRENAMIENTO/otro uso: GPTBot, ClaudeBot + anthropic-ai, CCBot,
 *    Meta-ExternalAgent, Bytespider, cohere-ai.
 * Los menús /m/* son deliberadamente 100% públicos (un restaurante QUIERE ser
 * descubierto y citado), así que a todos se les permite `/` y se les bloquean
 * los paneles privados. Si algún día la política cambia (p.ej. bloquear
 * entrenamiento), la regla se cambia SOLO acá.
 */
const AI_USER_AGENTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Google-Extended',
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'CCBot',
  'Meta-ExternalAgent',
  'Bytespider',
  'cohere-ai',
  'Applebot'
];

/** Rutas que NUNCA deben indexarse (paneles, API). El panel maestro vive en
 *  ruta ofuscada (/el-jefe, default en vercel.json); /admin queda prohibido
 *  también por la redirección legacy. */
const PRIVATE_PATHS = ['/el-jefe', '/admin', '/studio', '/api/'];

/** Páginas legales estáticas (fijas por dominio; ver vercel.json). */
const LEGAL_PAGES = [
  { path: '/terminos', changefreq: 'yearly', priority: 0.3 },
  { path: '/privacidad', changefreq: 'yearly', priority: 0.3 },
  { path: '/cookies', changefreq: 'yearly', priority: 0.3 },
  { path: '/reembolsos', changefreq: 'yearly', priority: 0.3 },
  { path: '/aviso-legal', changefreq: 'yearly', priority: 0.3 }
];

function cleanBase(appUrl) {
  return String(appUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * Política de rastreo completa (buscadores clásicos + IA). Cada user-agent de
 * IA repite el bloque privado para que ninguna sección se "coman" las reglas.
 */
function buildRobotsTxt(appUrl) {
  const base = cleanBase(appUrl);
  const disallow = PRIVATE_PATHS.map((p) => `Disallow: ${p}`).join('\n');
  const aiSections = AI_USER_AGENTS.map(
    (ua) => `User-agent: ${ua}\nAllow: /\n${disallow}`
  ).join('\n\n');
  return [
    '# Política de rastreo de ScanGo — fuente única: api/utils/seoDiscovery.js.',
    '# Los menús públicos /m/* están abiertos a buscadores y a rastreadores de IA',
    '# de búsqueda (ChatGPT Search, Perplexity, Google AI…). Los paneles /studio,',
    '# /el-jefe (redirección desde /admin) y /api/ quedan fuera del índice. Para',
    '# cambiar la política de IA, editá AI_USER_AGENTS en el módulo (un solo lugar).',
    '',
    'User-agent: *',
    ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
    'Allow: /m/',
    'Allow: /',
    '',
    aiSections,
    '',
    `Sitemap: ${base}/sitemap.xml`,
    ''
  ].join('\n');
}

function urlToXml(base, loc, { changefreq = 'daily', priority = 0.5, lastmod = '' } = {}) {
  const lines = [`  <url>`, `    <loc>${base}${loc}</loc>`];
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push(`    <changefreq>${changefreq}</changefreq>`, `    <priority>${priority}</priority>`, `  </url>`);
  return lines.join('\n');
}

/**
 * Sitemap XML: `/`, legales, las landings de soluciones por rubro
 * (/soluciones y /soluciones/:slug, si se pasan), el hub de ciudades
 * (/ciudades y /ciudades/:slug, si se pasan), cada menú activo (/m/:slug) y
 * CADA sucursal real (/m/:slug?branch=x). `restaurants` debe venir YA filtrada
 * por el negocio (p.ej. sin canceladas); el módulo no decide suscripciones.
 */
function buildSitemapXml({ appUrl, restaurants = [], legalPages = LEGAL_PAGES, solutions = [], cities = [] }) {
  const base = cleanBase(appUrl);
  const parts = [urlToXml(base, '/', { changefreq: 'daily', priority: 1.0 })];
  for (const lp of legalPages) {
    parts.push(urlToXml(base, lp.path, { changefreq: lp.changefreq, priority: lp.priority }));
  }
  if (Array.isArray(solutions) && solutions.length) {
    parts.push(urlToXml(base, '/soluciones', { changefreq: 'monthly', priority: 0.7 }));
    for (const s of solutions) {
      const slug = encodeURIComponent((s && s.slug) || '');
      if (!slug) continue;
      parts.push(urlToXml(base, `/soluciones/${slug}`, { changefreq: 'monthly', priority: 0.7 }));
    }
  }
  if (Array.isArray(cities) && cities.length) {
    parts.push(urlToXml(base, '/ciudades', { changefreq: 'weekly', priority: 0.6 }));
    for (const c of cities) {
      const slug = encodeURIComponent((c && c.slug) || '');
      if (!slug) continue;
      parts.push(urlToXml(base, `/ciudades/${slug}`, { changefreq: 'weekly', priority: 0.6 }));
    }
  }
  for (const r of restaurants) {
    const slug = encodeURIComponent(r.slug || '');
    if (!slug) continue;
    const lastmod = r.updatedAt || r.createdAt || '';
    parts.push(urlToXml(base, `/m/${slug}`, { changefreq: 'daily', priority: 0.8, lastmod }));
    // Sucursales reales (páginas independientes, no duplicados artificiales):
    for (const b of Array.isArray(r.branches) ? r.branches : []) {
      const branchKey = b && (b.slug || b.id);
      if (branchKey && (b.name || b.address)) {
        parts.push(
          urlToXml(base, `/m/${slug}?branch=${encodeURIComponent(branchKey)}`, {
            changefreq: 'daily',
            priority: 0.6,
            lastmod
          })
        );
      }
    }
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    parts.join('\n') +
    '\n</urlset>\n'
  );
}

// ── Horarios → Schema.org ───────────────────────────────────────────────────

function parseScheduleRange(scheduleActiveHours) {
  const [startH, endH] = String(scheduleActiveHours || '')
    .split('-')
    .map((t) => {
      const [h, m] = String(t || '').split(':').map(Number);
      return h + (m || 0) / 60;
    });
  if (startH === undefined || endH === undefined || Number.isNaN(startH) || Number.isNaN(endH)) return null;
  return { startH, endH };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toHHMM(hourFloat) {
  const h = Math.floor(hourFloat);
  const m = Math.round((hourFloat - h) * 60) % 60;
  return `${pad2(((h % 24) + 24) % 24)}:${pad2(m)}`;
}

/**
 * Deriva `openingHours` + `OpeningHoursSpecification` desde el horario REAL del
 * restaurante (scheduleEnabled/scheduleActiveHours — la misma fuente que
 * computeOpenStatus). Devuelve null cuando no hay horario publicado (no
 * configurado, deshabilitado o formato inválido) → el JSON-LD lo omite.
 *
 * Ventana nocturna (inicio>fin, p.ej. 18:00-02:00): dos OpeningHoursSpecification
 * por día: [18:00 → 23:59] y [00:00 → 02:00]. Un tramo que termina en la
 * medianoche exacta (23:00-00:00) deja solo [23:00 → 23:59] (el [00:00 → 00:00]
 * es vacío y no se emite).
 */
function buildOpeningHoursFromSchedule(restaurant) {
  if (!restaurant || restaurant.scheduleEnabled !== true || !restaurant.scheduleActiveHours) return null;
  const range = parseScheduleRange(restaurant.scheduleActiveHours);
  if (!range) return null;
  const { startH, endH } = range;
  const spec = (opens, closes) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: DAYS.slice(),
    opens,
    closes
  });
  const openingHours = `Mo-Su ${toHHMM(startH)}-${toHHMM(endH)}`;
  if (startH <= endH) {
    return { openingHours, openingHoursSpecification: [spec(toHHMM(startH), toHHMM(endH))] };
  }
  const specs = [spec(toHHMM(startH), '23:59')];
  if (endH > 0) specs.push(spec('00:00', toHHMM(endH)));
  return { openingHours, openingHoursSpecification: specs };
}

module.exports = {
  buildRobotsTxt,
  buildSitemapXml,
  buildOpeningHoursFromSchedule,
  AI_USER_AGENTS,
  PRIVATE_PATHS,
  LEGAL_PAGES,
  DEFAULT_BASE_URL
};