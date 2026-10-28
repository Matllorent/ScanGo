/**
 * api/utils/seoCities.js
 * ──────────────────────
 * SEO programático por CIUDAD (función PURA, sin I/O). Espeja el motor de
 * /soluciones (seoSolutions.js, del que recicla escapeHtml/safeJsonLd y las
 * piezas compartidas de render: head/header/footer/breadcrumb/FAQ) y deriva
 * TODO de los locales REALES que le pasa la ruta — cero ciudades inventadas,
 * cero PII.
 *
 * Qué produce:
 *   - buildCityIndex(restaurants)           → ciudades agrupadas por slug
 *     ("Montevideo" y "montevideo" son la MISMA ciudad: el slug manda y el
 *     nombre mostrado es la grafía más frecuente), orden count desc + nombre
 *     asc, demos fuera, locales sin ciudad fuera, cap honesto por página.
 *   - buildCitiesIndexJsonLd(cities, appUrl) → CollectionPage + ItemList de
 *     ciudades + BreadcrumbList para el hub /ciudades.
 *   - buildCityJsonLd(city, appUrl)          → BreadcrumbList + WebPage +
 *     FAQPage + ItemList de menús para /ciudades/:slug.
 *   - renderCitiesIndexHtml / renderCityHtml → HTML 100% server-rendered
 *     SEGURO: cero JS, cero on*= (la CSP de estas rutas es la transitional con
 *     script-src-attr 'none'), todo dato escapado.
 *
 * Reglas de honestidad de la casa:
 *   - Solo existen páginas de ciudades con ≥1 local publicado; el título, la
 *     meta description y el lead dicen el count REAL ("1 local", "N locales"),
 *     nunca lo inflan.
 *   - La lista de cartas por ciudad lleva SOLO {name, href, businessLabel} —
 *     teléfono/dirección del local viven en su propio menú /m/:slug.
 *   - El filtro de negocio (sin canceladas) lo aplica la RUTA — la MISMA lista
 *     ya filtrada que alimenta el sitemap; este módulo solo excluye basura
 *     estructural (demo, sin slug válido, sin ciudad, sin nombre).
 */
const {
  escapeHtml,
  safeJsonLd,
  cleanBase: sharedCleanBase,
  renderHead,
  renderHeader,
  renderFooter,
  renderBreadcrumb,
  renderFaqs,
  TRIAL_DAYS
} = require('./seoSolutions');

const DEFAULT_BASE_URL = 'https://scango.uy';
const CITY_BASE_PATH = '/ciudades';
const CITY_SLUG_MAX = 48;
const CITY_NAME_MAX = 40;
const LOCAL_NAME_MAX = 60;
const MAX_RESTAURANTS_PER_CITY = 50;
const MENU_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const BUSINESS_LABELS = {
  restaurant: 'Restaurante',
  heladeria: 'Heladería',
  perfumery: 'Perfumería',
  events: 'Eventos'
};

const BUSINESS_ICONS = {
  Restaurante: '🍽️',
  Heladería: '🍦',
  Perfumería: '🧴',
  Eventos: '🎉',
  Local: '🍽️'
};

function cleanBase(appUrl) {
  return String(appUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** Nombre de ciudad para MOSTRAR: espacios colapsados + cap 40. '' si basura. */
function sanitizeCityName(raw) {
  if (typeof raw !== 'string') return '';
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, CITY_NAME_MAX).trim();
}

/**
 * Slug de ciudad: minúsculas + sin diacríticos ("Málaga"→"malaga",
 * "Ñuñoa"→"nunoa") + [a-z0-9-] + cap 48. '' si basura (nunca un slug roto).
 */
function citySlugOf(raw) {
  const name = sanitizeCityName(raw);
  if (!name) return '';
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, CITY_SLUG_MAX)
      .replace(/-$/g, '')
  );
}

/** "1 local" / "N locales" — copy honesta con el count real. */
function countText(n) {
  const count = Number(n);
  return count === 1 ? '1 local' : `${count} locales`;
}

/**
 * Índice de ciudades desde restaurantes ya publicados. Acepta basura
 * (null/strings/números) sin lanzar y NUNCA muta la entrada. Los grupos son
 * por SLUG; el nombre mostrado es la grafía más frecuente de cada grupo
 * (empate → la alfabéticamente menor), determinista siempre.
 */
function buildCityIndex(restaurants, { maxPerCity = MAX_RESTAURANTS_PER_CITY } = {}) {
  const cap =
    Number.isFinite(maxPerCity) && maxPerCity > 0 ? Math.floor(maxPerCity) : MAX_RESTAURANTS_PER_CITY;
  const groups = new Map();
  for (const r of Array.isArray(restaurants) ? restaurants : []) {
    if (!r || typeof r !== 'object' || r.isDemo) continue;
    const menuSlug = typeof r.slug === 'string' ? r.slug : '';
    if (!MENU_SLUG_RE.test(menuSlug)) continue;
    const cityName = sanitizeCityName(r.city);
    if (!cityName) continue;
    const citySlug = citySlugOf(cityName);
    if (!citySlug) continue;
    const localName = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, LOCAL_NAME_MAX) : '';
    if (!localName) continue;
    let group = groups.get(citySlug);
    if (!group) {
      group = { items: [], spellings: new Map() };
      groups.set(citySlug, group);
    }
    group.items.push({
      name: localName,
      href: `/m/${menuSlug}`,
      businessLabel: BUSINESS_LABELS[r.businessType] || 'Local'
    });
    group.spellings.set(cityName, (group.spellings.get(cityName) || 0) + 1);
  }
  return [...groups.entries()]
    .map(([slug, group]) => {
      const spellings = [...group.spellings.entries()].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      );
      return {
        slug,
        name: spellings[0][0],
        count: group.items.length,
        extraCount: Math.max(0, group.items.length - cap),
        restaurants: group.items
          .slice()
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.href < b.href ? -1 : 1))
          .slice(0, cap)
      };
    })
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Busca una ciudad del índice por el slug crudo del URL (case-insensitivo:
 * "MONTEVIDEO" normaliza a "montevideo" y matchea). Desconocida → null. */
function getCityBySlug(cities, rawSlug) {
  const slug = citySlugOf(String(rawSlug || ''));
  if (!slug) return null;
  return (Array.isArray(cities) ? cities : []).find((c) => c && c.slug === slug) || null;
}

// ── Copy derivada (siempre con el count real) ───────────────────────────────

function cityMetaDescription(city) {
  return `Cartas digitales QR con pedidos por WhatsApp en ${city.name}: ${countText(city.count)} real${city.count === 1 ? '' : 'es'} operando con ScanGo, 0% comisiones. Probá ${TRIAL_DAYS} días gratis.`;
}

function cityLead(city) {
  return city.count === 1
    ? `En ${city.name} ya opera una carta real con ScanGo — mirala en vivo:`
    : `En ${city.name} ya operan ${city.count} cartas reales con ScanGo — miralas en vivo:`;
}

function cityFaqs(city) {
  return [
    {
      q: '¿Qué es ScanGo?',
      a: 'La plataforma de cartas digitales con QR y pedidos por WhatsApp: el comensal escanea el QR, ve la carta en su teléfono y el pedido llega directo al WhatsApp del local, sin apps de terceros ni comisiones por venta.'
    },
    {
      q: `¿Cómo funciona una carta digital QR en ${city.name}?`,
      a: `Cada local de la lista tiene su propia página con la carta completa, su QR de mesa y su horario. El comensal pide desde su teléfono y el dueño recibe el pedido directo, con fidelización y analíticas incluidas.`
    },
    {
      q: `¿Cómo aparece mi local de ${city.name} en esta página?`,
      a: `Registrá tu negocio con la prueba de ${TRIAL_DAYS} días, cargá tu carta en el Studio y completá la ciudad de tu local: tu menú se publica con QR, entra al sitemap y aparece en esta lista de ${city.name}.`
    }
  ];
}

// ── JSON-LD ─────────────────────────────────────────────────────────────────

function buildCitiesIndexJsonLd(cities, appUrl) {
  const base = cleanBase(appUrl);
  const hubUrl = `${base}${CITY_BASE_PATH}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Ciudades', item: hubUrl }
        ]
      },
      {
        '@type': 'CollectionPage',
        '@id': `${hubUrl}#webpage`,
        url: hubUrl,
        name: 'Cartas digitales QR por ciudad — ScanGo',
        description: `Cartas digitales con QR y pedidos por WhatsApp operando en ciudades reales: 0% de comisiones y ${TRIAL_DAYS} días de prueba.`,
        inLanguage: 'es',
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: (Array.isArray(cities) ? cities : []).map((city, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: city.name,
            url: `${base}${CITY_BASE_PATH}/${city.slug}`
          }))
        }
      }
    ]
  };
}

function buildCityJsonLd(city, appUrl) {
  const base = cleanBase(appUrl);
  const url = `${base}${CITY_BASE_PATH}/${city.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Ciudades', item: `${base}${CITY_BASE_PATH}` },
          { '@type': 'ListItem', position: 3, name: city.name, item: url }
        ]
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: `Cartas digitales QR en ${city.name} — ScanGo`,
        description: cityMetaDescription(city),
        inLanguage: 'es'
      },
      {
        '@type': 'FAQPage',
        mainEntity: cityFaqs(city).map((faq) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text: faq.a }
        }))
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#menus`,
        name: `Cartas que operan en ${city.name}`,
        numberOfItems: city.restaurants.length,
        itemListElement: city.restaurants.map((r, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: r.name,
          url: `${base}${r.href}`
        }))
      }
    ]
  };
}

// ── Render (HTML server-side, cero JS, cero on*=) ───────────────────────────

function renderCityHtml(city, { appUrl } = {}) {
  const base = cleanBase(appUrl);
  const canonical = `${base}${CITY_BASE_PATH}/${city.slug}`;
  const jsonLd = buildCityJsonLd(city, base);
  const registerHref = '/?registro=1';
  const title = `Cartas digitales QR en ${city.name} — ScanGo`;
  const cards = city.restaurants
    .map((r) =>
      [
        '        <article class="sol-card sol-card-link">',
        `          <div class="sol-card-icon" aria-hidden="true">${escapeHtml(BUSINESS_ICONS[r.businessLabel] || '🍽️')}</div>`,
        `          <h3 class="sol-card-title">${escapeHtml(r.name)}</h3>`,
        `          <p class="sol-card-text">${escapeHtml(r.businessLabel)}</p>`,
        `          <a class="sol-card-cta" href="${escapeHtml(r.href)}">Ver carta →</a>`,
        '        </article>'
      ].join('\n')
    )
    .join('\n');
  const extraLine =
    city.extraCount > 0
      ? `        <p class="sol-hero-note">Y ${escapeHtml(String(city.extraCount))} cartas más operando en ${escapeHtml(city.name)}.</p>`
      : '';

  return [
    renderHead({
      title,
      description: cityMetaDescription(city),
      canonical,
      jsonLd,
      keywords: `carta digital ${city.name}, menú QR ${city.name}, cartas QR ${city.name}, ScanGo`
    }),
    '<body>',
    '  <a href="#main-content" class="skip-link">Saltar al contenido principal</a>',
    renderHeader(registerHref),
    renderBreadcrumb([{ name: 'Inicio', href: '/' }, { name: 'Ciudades', href: CITY_BASE_PATH }, { name: city.name }]),
    '  <main id="main-content">',
    '    <section class="sol-hero">',
    '      <div class="container">',
    `        <span class="section-badge">🏙️ Cartas en ${escapeHtml(city.name)}</span>`,
    `        <h1>${escapeHtml(`Cartas digitales QR en ${city.name}`)}</h1>`,
    `        <p class="lead sol-lead">${escapeHtml(cityLead(city))}</p>`,
    '        <div class="sol-hero-actions">',
    `          <a class="btn btn-gold" href="${registerHref}">Abrir mi carta en ${escapeHtml(city.name)} →</a>`,
    `          <a class="btn btn-outline" href="${CITY_BASE_PATH}">Ver otras ciudades</a>`,
    '        </div>',
    `        <p class="sol-hero-note">0% de comisiones · Pedidos por WhatsApp · ${TRIAL_DAYS} días gratis</p>`,
    '      </div>',
    '    </section>',
    '    <section class="sol-section">',
    '      <div class="container">',
    '        <div class="sol-section-header">',
    `          <h2>Cartas que ya operan en ${escapeHtml(city.name)}</h2>`,
    '        </div>',
    '        <div class="sol-grid">',
    cards,
    '        </div>',
    extraLine,
    '      </div>',
    '    </section>',
    '    <section class="sol-section sol-section-alt">',
    '      <div class="container">',
    '        <div class="sol-section-header">',
    '          <h2>Preguntas frecuentes</h2>',
    '        </div>',
    '        <div class="sol-faq">',
    renderFaqs(cityFaqs(city)),
    '        </div>',
    '      </div>',
    '    </section>',
    '    <section class="sol-cta">',
    '      <div class="container">',
    `        <h2>Abrí tu carta digital en ${escapeHtml(city.name)}</h2>`,
    `        <p>${TRIAL_DAYS} días gratis, sin tarjeta de crédito y sin comisiones por venta.</p>`,
    '        <div class="sol-hero-actions">',
    `          <a class="btn btn-gold" href="${registerHref}">Crear mi menú gratis →</a>`,
    '          <a class="btn btn-outline" href="/#precios">Ver precios</a>',
    '        </div>',
    '      </div>',
    '    </section>',
    '  </main>',
    renderFooter(registerHref),
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

function renderCitiesIndexHtml({ appUrl, cities = [] } = {}) {
  const base = cleanBase(appUrl);
  const canonical = `${base}${CITY_BASE_PATH}`;
  const jsonLd = buildCitiesIndexJsonLd(cities, base);
  const registerHref = '/?registro=1';
  const list = Array.isArray(cities) ? cities : [];
  const cards = list
    .map((city) =>
      [
        '        <article class="sol-card sol-card-link">',
        '          <div class="sol-card-icon" aria-hidden="true">🏙️</div>',
        `          <h3 class="sol-card-title">${escapeHtml(city.name)}</h3>`,
        `          <p class="sol-card-text">${escapeHtml(`${countText(city.count)} con cartas reales`)}</p>`,
        `          <a class="sol-card-cta" href="${CITY_BASE_PATH}/${city.slug}">Ver cartas →</a>`,
        '        </article>'
      ].join('\n')
    )
    .join('\n');

  return [
    renderHead({
      title: 'Cartas digitales QR por ciudad — ScanGo',
      description: `Descubrí cartas digitales con QR y pedidos por WhatsApp operando en tu ciudad: locales reales con ScanGo, 0% de comisiones y ${TRIAL_DAYS} días de prueba gratis.`,
      canonical,
      jsonLd,
      keywords: 'carta digital, menú QR, ciudades, carta por ciudad, ScanGo'
    }),
    '<body>',
    '  <a href="#main-content" class="skip-link">Saltar al contenido principal</a>',
    renderHeader(registerHref),
    renderBreadcrumb([{ name: 'Inicio', href: '/' }, { name: 'Ciudades' }]),
    '  <main id="main-content">',
    '    <section class="sol-hero">',
    '      <div class="container">',
    '        <span class="section-badge">🏙️ Cartas por ciudad</span>',
    '        <h1>Cartas digitales QR, por ciudad</h1>',
    '        <p class="lead sol-lead">Estas son las ciudades donde ya opera ScanGo. Elegí la tuya y mirá las cartas reales en vivo.</p>',
    '        <div class="sol-hero-actions">',
    `          <a class="btn btn-gold" href="${registerHref}">Comenzar ${TRIAL_DAYS} días gratis →</a>`,
    '          <a class="btn btn-outline" href="/#precios">Ver precios</a>',
    '        </div>',
    '      </div>',
    '    </section>',
    '    <section class="sol-section">',
    '      <div class="container">',
    '        <div class="sol-grid">',
    cards,
    '        </div>',
    list.length
      ? ''
      : '        <p class="sol-hero-note">Todavía no hay cartas publicadas con ciudad completa — la tuya puede ser la primera.</p>',
    '      </div>',
    '    </section>',
    '  </main>',
    renderFooter(registerHref),
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

module.exports = {
  CITY_BASE_PATH,
  CITY_SLUG_MAX,
  CITY_NAME_MAX,
  MAX_RESTAURANTS_PER_CITY,
  BUSINESS_LABELS,
  sanitizeCityName,
  citySlugOf,
  countText,
  buildCityIndex,
  getCityBySlug,
  cityMetaDescription,
  cityFaqs,
  buildCitiesIndexJsonLd,
  buildCityJsonLd,
  renderCitiesIndexHtml,
  renderCityHtml,
  cleanBase
};
