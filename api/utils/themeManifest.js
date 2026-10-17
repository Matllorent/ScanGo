/**
 * api/utils/themeManifest.js
 * ──────────────────────────
 * MANIFEST CANÓNICO del motor de plantillas. Fuente única de verdad de:
 *   - las 10 morfologías (layouts) y sus capacidades por layout
 *     (`defaultImageMode`, `imageModes` soportados y `menuSizing` soportado);
 *   - los modos de imagen (`imageMode`: miniatura por plato / sin fotos /
 *     foto protagonista por categoría) y los modos de sizing
 *     (`menuSizing`: uniforme / popularidad);
 *   - los ids de tema (17 clásicas + 12 de heladería).
 *
 * El frontend plano (ESM sin bundler) no puede require() este módulo (CJS),
 * así que `scripts/regen-theme-manifest.js` genera el espejo ESM en
 * `public/js/menu/themeManifest.js` y `tests/test-theme-manifest.js` falla si
 * hay drift (mismo patrón que securityHeaders.js ↔ vercel.json ↔ test-csp.js).
 * El Studio consume el manifest importando ese espejo desde studio.js.
 *
 * Puro: cero I/O y cero requires (guard de arquitectura B de api/utils).
 */

/** Valores válidos de `restaurant.imageMode` (más 'auto' = default del layout). */
const IMAGE_MODES = ['grid', 'none', 'hero'];
/** Valores válidos de `restaurant.menuSizing`. */
const MENU_SIZING_MODES = ['uniform', 'popularity'];

/**
 * Capacidades por morfología:
 *  - defaultImageMode: qué ve el comensal si el dueño no elige nada.
 *  - imageModes: modos que el layout implementa en CSS/JS (el Studio solo
 *    ofrece estos; el sanitizer y el payload resuelven contra esta lista).
 *  - menuSizing: 'popularity' solo donde el grid admite cartas destacadas
 *    (las listas tipográficas y el overlay de stories no escalan por ancho).
 */
const LAYOUTS = [
  { id: 'classic', defaultImageMode: 'grid', imageModes: ['grid', 'none', 'hero'], menuSizing: ['uniform', 'popularity'] },
  { id: 'bento', defaultImageMode: 'grid', imageModes: ['grid', 'none', 'hero'], menuSizing: ['uniform', 'popularity'] },
  { id: 'minimalist', defaultImageMode: 'hero', imageModes: ['hero', 'grid', 'none'], menuSizing: ['uniform', 'popularity'] },
  { id: 'neon', defaultImageMode: 'grid', imageModes: ['grid', 'none', 'hero'], menuSizing: ['uniform', 'popularity'] },
  { id: 'billboard', defaultImageMode: 'grid', imageModes: ['grid', 'none'], menuSizing: ['uniform', 'popularity'] },
  { id: 'ticker', defaultImageMode: 'none', imageModes: ['none'], menuSizing: ['uniform'] },
  { id: 'sticker', defaultImageMode: 'grid', imageModes: ['grid'], menuSizing: ['uniform'] },
  { id: 'delivery', defaultImageMode: 'grid', imageModes: ['grid'], menuSizing: ['uniform'] },
  { id: 'stories', defaultImageMode: 'grid', imageModes: ['grid'], menuSizing: ['uniform'] },
  { id: 'brutalist', defaultImageMode: 'grid', imageModes: ['grid', 'none', 'hero'], menuSizing: ['uniform', 'popularity'] }
];

/** 17 paletas clásicas (rubros que no son heladería). */
const CLASSIC_THEME_IDS = [
  'classic', 'emerald', 'rustic', 'taqueria', 'bar', 'moderna', 'foodtruck', 'gamer',
  'otaku', 'explosivo', 'infantil', 'alegre', 'basketball', 'football',
  'smash-urban', 'glass-gastro', 'ticket'
];
/** 12 paletas exclusivas de heladería (rubro de primera clase). */
const HELADERIA_THEME_IDS = [
  'helado-fiesta', 'helado-menta', 'helado-tropical', 'helado-pastel', 'gelateria', 'cioccolato',
  'helado-fresa', 'helado-dulce', 'helado-pistacho', 'helado-cielo', 'helado-mora', 'helado-crema'
];

const LAYOUT_IDS = LAYOUTS.map((l) => l.id);
const THEME_IDS = [...CLASSIC_THEME_IDS, ...HELADERIA_THEME_IDS];

/** Devuelve la entrada del layout o null (id huérfano ⇒ null, nunca inventa). */
function getLayout(id) {
  return LAYOUTS.find((l) => l.id === id) || null;
}

function layoutSupportsImageMode(layoutId, mode) {
  const layout = getLayout(layoutId);
  return Boolean(layout && IMAGE_MODES.includes(mode) && layout.imageModes.includes(mode));
}

function layoutSupportsMenuSizing(layoutId, sizing) {
  const layout = getLayout(layoutId);
  return Boolean(layout && MENU_SIZING_MODES.includes(sizing) && layout.menuSizing.includes(sizing));
}

/**
 * Resuelve el modo de imagen EFECTIVO de un layout: 'auto' (o cualquier
 * valor fuera de la lista del layout) cae al default de la morfología.
 * Así un combo viejo o manual (p.ej. 'hero' en ticker) nunca cuele.
 */
function resolveImageMode(layoutId, rawMode) {
  const layout = getLayout(layoutId) || getLayout('classic');
  const mode = typeof rawMode === 'string' ? rawMode.trim().toLowerCase() : '';
  if (!mode || mode === 'auto') return layout.defaultImageMode;
  return layout.imageModes.includes(mode) ? mode : layout.defaultImageMode;
}

/**
 * Resuelve el sizing EFECTIVO: 'popularity' solo si el layout lo soporta;
 * cualquier otra cosa ⇒ 'uniform' (tamaño parejo, el estado histórico).
 */
function resolveMenuSizing(layoutId, rawSizing) {
  const layout = getLayout(layoutId) || getLayout('classic');
  const sizing = typeof rawSizing === 'string' ? rawSizing.trim().toLowerCase() : '';
  return layout.menuSizing.includes(sizing) ? sizing : 'uniform';
}

function isValidTheme(id) {
  return THEME_IDS.includes(id);
}

module.exports = {
  IMAGE_MODES,
  MENU_SIZING_MODES,
  LAYOUTS,
  LAYOUT_IDS,
  CLASSIC_THEME_IDS,
  HELADERIA_THEME_IDS,
  THEME_IDS,
  getLayout,
  layoutSupportsImageMode,
  layoutSupportsMenuSizing,
  resolveImageMode,
  resolveMenuSizing,
  isValidTheme
};
