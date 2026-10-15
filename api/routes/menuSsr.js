/**
 * api/routes/menuSsr.js
 * ─────────────────────
 * SSR del menú público (/m/:slug): HTML con OG/canonical/JSON-LD por
 * restaurante, CSP estricta y ETag con s-maxage. Extraído de api/index.js sin
 * cambios de comportamiento. Se monta como app.use('/m', menuSsrRouter).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../../src/db/db');
const billingOrchestrator = require('../../src/billing/orchestrator');
const seoDiscovery = require('../utils/seoDiscovery');
const securityHeaders = require('../utils/securityHeaders');
const { getDemoRestaurant } = require('../utils/demoRestaurants');
const { resolveBranchOverridePrice, normalizeBranchCustomDishes } = require('../utils/menuResponse');
const { PUBLIC_DIR, SEND_FILE_OPTIONS } = require('../utils/paths');

const router = express.Router();

// SEO & OpenGraph Dynamic Public Menu Route
router.get('/:slug', (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  // Demos por rubro: se resuelven sin DB (in-memory, siempre online).
  const restaurant = db.findRestaurantBySlug(slug) || getDemoRestaurant(slug);
  const menuHtmlPath = path.join(PUBLIC_DIR, 'menu.html');

  if (fs.existsSync(menuHtmlPath) && restaurant) {
    let html = fs.readFileSync(menuHtmlPath, 'utf8');
    const appUrl = (process.env.APP_URL || 'https://scango.uy').replace(/\/+$/, '');
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
    const toAbsoluteUrl = (value, fallback = null) => {
      if (!value) return fallback;
      try {
        const url = new URL(value, `${appUrl}/`);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
      } catch (e) {
        return fallback;
      }
    };
    const requestedBranch = String(req.query.branch || req.query.sucursal || '').toLowerCase().trim();
    const activeBranch = (restaurant.branches || []).find(branch =>
      requestedBranch && [branch.id, branch.slug].some(value => String(value || '').toLowerCase() === requestedBranch)
    ) || null;
    const restaurantName = activeBranch
      ? `${restaurant.name || restaurant.bizName || 'Menú Digital'} — ${activeBranch.name}`
      : (restaurant.name || restaurant.bizName || 'Menú Digital');
    // Evento (boda/15/cumpleaños/catering): el preview al compartir debe contar la
    // celebración (pareja/fecha/lugar), no el genérico "ScanGo".
    const eventCfg = restaurant.eventConfig || {};
    const isEventMenu = Boolean(
      restaurant.businessType === 'events' ||
        restaurant.eventType ||
        eventCfg.eventType ||
        eventCfg.coupleNames ||
        (restaurant.weddingItinerary && restaurant.weddingItinerary.enabled)
    );
    const resolveEventTypeLabel = eventType => {
      switch (String(eventType || '').toLowerCase()) {
        case 'cumple_15':
          return 'Cumpleaños de 15';
        case 'birthday':
          return 'Cumpleaños';
        case 'catering':
          return 'Evento';
        case 'wedding':
          return 'Boda';
        default:
          return 'Evento';
      }
    };
    const eventTypeLabel = resolveEventTypeLabel(restaurant.eventType || eventCfg.eventType || 'wedding');
    const eventCouple = String(
      (restaurant.weddingItinerary && restaurant.weddingItinerary.coupleNames) || eventCfg.coupleNames || ''
    ).trim();
    const eventWhere = [
      (restaurant.weddingItinerary && restaurant.weddingItinerary.date) || eventCfg.date,
      (restaurant.weddingItinerary && restaurant.weddingItinerary.venue) || eventCfg.venue
    ]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    const title = isEventMenu
      ? `${eventTypeLabel}${eventCouple ? `: ${eventCouple}` : ''} — ${restaurantName} — ScanGo`
      : `${restaurantName} — ScanGo`;
    const slogan =
      isEventMenu && eventWhere.length
        ? eventWhere.join(' · ')
        : restaurant.slogan || 'Especialidad, masas artesanales y cocina de autor';
    const ogImage = toAbsoluteUrl(
      restaurant.bannerUrl || restaurant.logoUrl || eventCfg.heroImage,
      `${appUrl}/og-cover.png`
    );
    const branchQuery = activeBranch ? `?branch=${encodeURIComponent(activeBranch.slug || activeBranch.id)}` : '';
    const menuUrl = `${appUrl}/m/${encodeURIComponent(restaurant.slug || slug)}${branchQuery}`;
    const normalized = normalizeBranchCustomDishes(restaurant.categories, restaurant.dishes, activeBranch?.customDishes || null);
    const categories = normalized.categories;
    // Defensa para verticales sin carta cargada (eventos/heladerías frescas):
    // normalizeBranchCustomDishes puede devolver dishes: undefined.
    let dishes = Array.isArray(normalized.dishes) ? normalized.dishes : [];

    if (activeBranch?.overridePrices && typeof activeBranch.overridePrices === 'object') {
      dishes = dishes.map(dish => ({
        ...dish,
        price: resolveBranchOverridePrice(activeBranch.overridePrices, dish.id, dish.price)
      }));
    }

    const currencyAliases = {
      '$U': 'UYU', U$U: 'UYU', UYU: 'UYU',
      USD: 'USD', 'US$': 'USD', 'U$S': 'USD',
      ARS: 'ARS', 'AR$': 'ARS', BRL: 'BRL', 'R$': 'BRL',
      CLP: 'CLP', MXN: 'MXN', COP: 'COP', EUR: 'EUR', '€': 'EUR', GBP: 'GBP', '£': 'GBP'
    };
    const currencyInput = String(restaurant.currency || '').trim().toUpperCase();
    const priceCurrency = currencyAliases[currencyInput] || (/^[A-Z]{3}$/.test(currencyInput) ? currencyInput : null);
    const toMenuItem = dish => {
      const item = {
        '@type': 'MenuItem',
        name: String(dish.name || 'Plato'),
        ...(dish.description ? { description: String(dish.description) } : {})
      };
      const image = toAbsoluteUrl(dish.photoUrl || dish.imageUrl || dish.image || dish.photo);
      if (image) item.image = image;

      const price = dish.price;
      if (price !== null && price !== undefined && price !== '' && Number.isFinite(Number(price))) {
        item.offers = {
          '@type': 'Offer',
          price: String(Number(price)),
          ...(priceCurrency ? { priceCurrency } : {})
        };
      }
      return item;
    };
    const menuSections = categories.map(category => ({
      '@type': 'MenuSection',
      name: String(category.name || 'Categoría'),
      hasMenuItem: dishes.filter(dish => dish.categoryId === category.id).map(toMenuItem)
    }));
    const uncategorizedDishes = dishes.filter(dish => !categories.some(category => category.id === dish.categoryId));
    if (uncategorizedDishes.length) {
      menuSections.push({
        '@type': 'MenuSection',
        name: 'Otros',
        hasMenuItem: uncategorizedDishes.map(toMenuItem)
      });
    }

    const address = activeBranch?.address || restaurant.address || '';
    const city = restaurant.city || '';
    const imageUrl = toAbsoluteUrl(
      restaurant.bannerUrl || restaurant.logoUrl || eventCfg.heroImage,
      `${appUrl}/og-cover.png`
    );
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      '@id': `${menuUrl}#restaurant`,
      name: restaurantName,
      url: menuUrl,
      image: imageUrl,
      description: String(slogan),
      ...(activeBranch?.phone || restaurant.phone ? { telephone: activeBranch?.phone || restaurant.phone } : {}),
      ...(address || city ? {
        address: {
          '@type': 'PostalAddress',
          ...(address ? { streetAddress: String(address) } : {}),
          ...(city ? { addressLocality: String(city) } : {}),
          ...(restaurant.addressCountry ? { addressCountry: String(restaurant.addressCountry) } : {})
        }
      } : {}),
      hasMenu: {
        '@type': 'Menu',
        '@id': `${menuUrl}#menu`,
        name: `Menú de ${restaurantName}`,
        inLanguage: 'es',
        hasMenuSection: menuSections
      },
      // SEO local: zona de servicio para búsquedas "cerca de mí".
      ...(city ? { areaServed: String(city) } : {}),
      ...(seoDiscovery.buildOpeningHoursFromSchedule(restaurant) || {}),
      ...(restaurant.priceRange ? { priceRange: restaurant.priceRange } : {}),
      ...(Array.isArray(restaurant.sameAs) && restaurant.sameAs.length ? { sameAs: restaurant.sameAs } : {}),
      ...(Number.isFinite(Number(restaurant.latitude)) && Number.isFinite(Number(restaurant.longitude)) ? {
        geo: {
          '@type': 'GeoCoordinates',
          latitude: Number(restaurant.latitude),
          longitude: Number(restaurant.longitude)
        }
      } : {}),
      ...(restaurant.servesCuisine ? { servesCuisine: restaurant.servesCuisine } : (restaurant.categories && restaurant.categories.length > 0 ? { servesCuisine: restaurant.categories.map(c => c.name) } : {}))
    };
    const safeJsonLd = JSON.stringify(structuredData).replace(/[<>&\u2028\u2029]/g, character => ({
      '<': '\\u003c',
      '>': '\\u003e',
      '&': '\\u0026',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029'
    })[character]);
    const ogTags = `
      <meta name="description" content="${escapeHtml(slogan)}" />
      <link rel="canonical" href="${escapeHtml(menuUrl)}" />
      <meta property="og:title" content="${escapeHtml(title)}" />
      <meta property="og:description" content="${escapeHtml(slogan)}" />
      <meta property="og:image" content="${escapeHtml(ogImage)}" />
      <meta property="og:url" content="${escapeHtml(menuUrl)}" />
      <meta property="og:type" content="restaurant.menu" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${escapeHtml(title)}" />
      <meta name="twitter:description" content="${escapeHtml(slogan)}" />
      <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
      <script type="application/ld+json">${safeJsonLd}</script>
    `;

    // IMPORTANTE: replace con FUNCIÓN, no con string. String.prototype.replace
    // interpreta patrones `$` en el reemplazo ($&, $$, $', ...): si el título o el
    // JSON-LD inyectado contienen `$` (p.ej. priceRange "$$$" o un nombre con $),
    // un reemplazo-string los corrompe (V8 colapsa "$$$" → "$$"). Una función
    // devuelve el texto literal sin procesar los `$`. (Bug real cazado por
    // test-seo-discovery al agregar priceRange "$$$" al JSON-LD del SSR.)
    html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`);
    html = html.replace('</head>', () => `${ogTags}\n</head>`);
    // Falso positivo verificado: TODO dato de restaurante inyectado en `html` pasa por
    // escapeHtml() (ogTags, title) o por safeJsonLd (JSON.stringify + escape de <>& y \u2028\u2029);
    // la base `html` es el template estático de menu.html, sin interpolación de usuario.
    // CSP estricto del menú público (/m/*): sin 'unsafe-inline' en script-src ni
    // script-src-attr (todo handler vía data-js-* + dom-bindings.js). El resto de
    // headers ya vienen del middleware securityHeaders.
    res.setHeader(
      'Content-Security-Policy',
      securityHeaders.getSecurityHeaders({ strictMenu: true })['Content-Security-Policy']
    );
    // ETag + CDN cache del SSR público: revalidación barata para crawlers/CDN
    // sin cambiar contenido ni CSP. La clave incluye updatedAt/createdAt para
    // invalidar al editar la carta, MÁS subscription.updatedAt: un flip de
    // suscripción por webhook/cron también cambia el HTML (menú pausado ↔
    // online) y sin esto el navegador/CDN respondería 304 con lo viejo.
    const subTs = (restaurant.subscription && restaurant.subscription.updatedAt) || '';
    const menuEtag = 'W/"m-' + restaurant.slug + '-' + (restaurant.updatedAt || restaurant.createdAt || '') + '-' + subTs + '-' + html.length + '"';
    res.setHeader('ETag', menuEtag);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    if (req.headers['if-none-match'] === menuEtag) {
      return res.status(304).end();
    }
    return res.send(html); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
  }

  res.sendFile(menuHtmlPath, SEND_FILE_OPTIONS);
});

module.exports = router;
