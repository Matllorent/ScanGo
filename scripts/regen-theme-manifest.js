/**
 * scripts/regen-theme-manifest.js
 * ───────────────────────────────
 * Genera el espejo ESM del manifest canónico de plantillas en
 * `public/js/menu/themeManifest.js` desde `api/utils/themeManifest.js` (CJS).
 *
 * ¿Por qué un espejo? El frontend es ESM plano sin bundler y el backend es
 * CJS con guard de pureza: no pueden compartir un módulo en runtime. El
 * patrón del repo (securityHeaders.js ↔ vercel.json) resuelve esto con un
 * artefacto generado + test de paridad que falla ante drift.
 *
 * Uso: node scripts/regen-theme-manifest.js   (verificar con npm run test:theme-manifest)
 */
const fs = require('fs');
const path = require('path');
const manifest = require('../api/utils/themeManifest');

const TARGET = path.resolve(__dirname, '..', 'public', 'js', 'menu', 'themeManifest.js');

/**
 * Construye el contenido ESM del espejo. Exporta SOLO datos (JSON puro);
 * las funciones viven en el canónico CJS y en los consumidores.
 */
function buildManifestEsm() {
  const data = {
    IMAGE_MODES: manifest.IMAGE_MODES,
    MENU_SIZING_MODES: manifest.MENU_SIZING_MODES,
    LAYOUTS: manifest.LAYOUTS,
    LAYOUT_IDS: manifest.LAYOUT_IDS,
    CLASSIC_THEME_IDS: manifest.CLASSIC_THEME_IDS,
    HELADERIA_THEME_IDS: manifest.HELADERIA_THEME_IDS,
    PERFUMERY_THEME_IDS: manifest.PERFUMERY_THEME_IDS,
    THEME_IDS: manifest.THEME_IDS
  };
  const lines = Object.entries(data).map(
    ([key, value]) => `export const ${key} = ${JSON.stringify(value, null, 2)};`
  );
  return [
    '// ARCHIVO GENERADO — NO EDITAR A MANO.',
    '// Fuente canónica: api/utils/themeManifest.js (CJS, backend).',
    '// Regenerar: node scripts/regen-theme-manifest.js',
    '// Paridad: tests/test-theme-manifest.js falla si hay drift.',
    '',
    ...lines,
    ''
  ].join('\n');
}

function main() {
  fs.writeFileSync(TARGET, buildManifestEsm(), 'utf8');
  console.log(`✓ public/js/menu/themeManifest.js regenerado desde el manifest canónico — correr npm run test:theme-manifest`);
}

if (require.main === module) main();

module.exports = { TARGET, buildManifestEsm };
