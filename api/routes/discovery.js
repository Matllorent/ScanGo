/**
 * api/routes/discovery.js
 * ───────────────────────
 * Descubrimiento SEO/GEO (robots.txt + rastreadores IA, sitemap dinámico,
 * landings /soluciones y verificación IndexNow /{key}.txt). Extraído de
 * api/index.js sin cambios. Se monta en la raíz (app.use('/', ...)): las
 * rutas ya traen su path absoluto.
 */
const express = require('express');
const path = require('path');
const db = require('../../src/db/db');
const seoDiscovery = require('../utils/seoDiscovery');
const seoSolutions = require('../utils/seoSolutions');
const indexNow = require('../utils/indexNow');
const { PUBLIC_DIR, SEND_FILE_OPTIONS } = require('../utils/paths');

const router = express.Router();

// SEO: Dynamic Robots.txt Route (política de rastreo + IA desde el compilador
// puro api/utils/seoDiscovery.js; /robots.txt también se sirve por Express en
// Vercel — ver routes en vercel.json).
router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(seoDiscovery.buildRobotsTxt(process.env.APP_URL));
});

// SEO: Dynamic XML Sitemap (menús activos + sucursales + legales, con lastmod
// por restaurante; los estáticos public/robots.txt y public/sitemap.xml fueron
// ELIMINADOS a propósito: en Vercel el archivo estático pisaba al dinámico y
// dejaba a los /m/* fuera del sitemap de producción).
router.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  const restaurants = db.getAllRestaurants().filter(r => r.subscription && r.subscription.status !== 'canceled');
  res.send(seoDiscovery.buildSitemapXml({
    appUrl: process.env.APP_URL,
    restaurants,
    solutions: seoSolutions.getAllSolutions()
  }));
});

// SEO: landings de "soluciones por rubro" (/soluciones y /soluciones/:slug).
// HTML 100% server-rendered desde el módulo puro api/utils/seoSolutions.js:
// capturan búsquedas long-tail por rubro y exponen WebPage + BreadcrumbList +
// FAQPage a buscadores e IA. Sin JS ni on*= (CSP script-src-attr 'none'); los
// CTA apuntan a /?registro=1 (el landing abre el registro solo).
router.get('/soluciones', (req, res) => {
  res.type('html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
  res.send(seoSolutions.renderSolutionsIndexHtml({ appUrl: process.env.APP_URL }));
});

router.get('/soluciones/:slug', (req, res) => {
  const solution = seoSolutions.getSolutionBySlug(req.params.slug);
  if (!solution) {
    return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), SEND_FILE_OPTIONS);
  }
  res.type('html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
  // `solution` sale del catálogo puro (no de input libre) y todo dato se
  // escapa en renderSolutionHtml (escapeHtml/safeJsonLd): falso positivo.
  res.send(seoSolutions.renderSolutionHtml(solution, { appUrl: process.env.APP_URL })); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
});

// IndexNow: archivo de verificación de dominio en /{key}.txt (espec de Bing,
// Yandex, Seznam, Naver). SOLO responde 200 si el segmento coincide EXACTO con
// INDEXNOW_KEY (mismo patrón [0-9a-fA-F-]{8,64} que la ruta de vercel.json que
// desvía acá el .txt en producción); sin key configurada no existe archivo.
// Se registra DESPUÉS de express.static (línea ~281): los .txt estáticos
// (robots, llms, llms-full) ya fueron servidos; acá solo llegan los hex-dash.
router.get('/:key.txt', (req, res) => {
  const configuredKey = indexNow.getIndexNowKey();
  if (!configuredKey || req.params.key !== configuredKey) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  res.type('text/plain').send(configuredKey);
});

module.exports = router;
