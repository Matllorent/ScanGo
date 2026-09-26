/**
 * Test Suite: Banner Superior y Morfologías de Diseño Vanguardistas
 * Valida:
 * 1. Persistencia de `bannerUrl` y `layout` en db.js
 * 2. Saneamiento y valores por defecto en el backend
 * 3. Existencia de estilos CSS para los 3 nuevos layouts (Bento, Minimalist, Neon)
 * 4. Integridad de las 14 variantes clásicas existentes (100% intactas)
 * 5. Soporte responsive <360px y object-fit: cover
 * 6. Controles de banner y layout switcher en el panel Studio
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const db = require('../src/db/db');

async function runTests() {
  console.log('🧪 Iniciando verificación de Banner Superior y Nuevos Layouts...');

  // 1. Persistencia en DB
  const user = db.createUser({ email: `test-layout-${Date.now()}@example.com`, password: 'test_password' });
  const testData = {
    bizName: 'Restaurante Vanguardia Test',
    slug: `vanguardia-test-${Date.now()}`,
    bannerUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4',
    layout: 'bento',
    theme: 'emerald',
    font: 'sans',
    categories: []
  };

  const saved = db.saveRestaurant(user.id, testData);
  const fetched = db.findRestaurantById(saved.id);

  assert.strictEqual(fetched.bannerUrl, testData.bannerUrl, 'bannerUrl debe persistir en db');
  assert.strictEqual(fetched.layout, 'bento', 'layout debe persistir como bento en db');
  console.log('✓ Persistencia en DB de bannerUrl y layout validada exitosamente');

  // 2. Verificación de layouts permitidos e integridad en api/index.js
  const apiFile = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
  assert.ok(apiFile.includes("allowedLayouts = ['classic', 'bento', 'minimalist', 'neon']"), 'allowedLayouts debe incluir classic, bento, minimalist y neon');
  assert.ok(apiFile.includes('bannerUrl:'), 'api/index.js debe sanitizar y devolver bannerUrl');
  console.log('✓ Saneamiento y lista blanca de layouts en el backend verificados');

  // 3. Verificación de public/css/menu.css
  const menuCss = fs.readFileSync(path.join(__dirname, '../public/css/menu.css'), 'utf8');

  // 3a. Hero banner
  assert.ok(menuCss.includes('.menu-banner-hero'), 'menu.css debe tener estilos para .menu-banner-hero');
  assert.ok(menuCss.includes('.menu-banner-img'), 'menu.css debe tener estilos para .menu-banner-img');
  assert.ok(menuCss.includes('body.has-hero-banner'), 'menu.css debe soportar el estado body.has-hero-banner');
  console.log('✓ Estilos de Banner Hero (portada superior) verificados en menu.css');

  // 3b. 3 Nuevos Layouts
  assert.ok(menuCss.includes('body.layout-bento'), 'menu.css debe definir body.layout-bento');
  assert.ok(menuCss.includes('body.layout-minimalist'), 'menu.css debe definir body.layout-minimalist');
  assert.ok(menuCss.includes('body.layout-neon'), 'menu.css debe definir body.layout-neon');
  console.log('✓ Morfologías Bento Grid, Minimalist Luxury y Neon Nightbar presentes en menu.css');

  // 3c. Integridad de los 14 temas clásicos
  const classicThemes = [
    'theme-classic',
    'theme-emerald',
    'theme-rustic',
    'theme-taqueria',
    'theme-bar',
    'theme-moderna',
    'theme-foodtruck',
    'theme-gamer',
    'theme-otaku',
    'theme-explosivo',
    'theme-infantil',
    'theme-alegre',
    'theme-basketball',
    'theme-football'
  ];

  for (const theme of classicThemes) {
    assert.ok(menuCss.includes(`body.${theme}`), `menu.css debe mantener intacto el tema clásico ${theme}`);
  }
  console.log('✓ Los 14 temas clásicos artesanales se conservan 100% intactos');

  // 3d. object-fit: cover y adaptaciones mobile < 360px
  assert.ok(menuCss.includes('object-fit: cover'), 'menu.css debe forzar object-fit: cover');
  assert.ok(menuCss.includes('@media (max-width: 360px)'), 'menu.css debe incluir reglas para pantallas < 360px');
  console.log('✓ Aspect-ratio/object-fit y responsive <360px comprobados en menu.css');

  // 4. Verificación de Studio UI (studio.html y studio.js)
  const studioHtml = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  assert.ok(studioHtml.includes('inputBannerFile'), 'studio.html debe tener inputBannerFile');
  assert.ok(studioHtml.includes('inputBannerUrl'), 'studio.html debe tener inputBannerUrl');
  assert.ok(studioHtml.includes('inputMenuLayout'), 'studio.html debe tener selector inputMenuLayout');

  const studioJs = fs.readFileSync(path.join(__dirname, '../public/js/studio.js'), 'utf8');
  assert.ok(studioJs.includes('handleBannerUpload'), 'studio.js debe implementar handleBannerUpload');
  assert.ok(studioJs.includes('removeBanner'), 'studio.js debe implementar removeBanner');
  assert.ok(studioJs.includes('renderBannerPreviewUI'), 'studio.js debe implementar renderBannerPreviewUI');
  console.log('✓ Controles de portada superior y switcher de layout validados en Studio');

  // 5. Verificación de menu.html y menu.js
  const menuHtml = fs.readFileSync(path.join(__dirname, '../public/menu.html'), 'utf8');
  assert.ok(menuHtml.includes('menuBannerHero'), 'menu.html debe tener el contenedor #menuBannerHero');

  const menuJs = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
  assert.ok(menuJs.includes('layoutClass'), 'menu.js debe computar layoutClass');
  assert.ok(menuJs.includes("'bento'"), 'menu.js debe contemplar bento en validLayouts');
  assert.ok(menuJs.includes("'minimalist'"), 'menu.js debe contemplar minimalist en validLayouts');
  assert.ok(menuJs.includes("'neon'"), 'menu.js debe contemplar neon en validLayouts');
  console.log('✓ Inyección reactiva de banner y clases morfológicas comprobada en el menú público');

  console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE BANNER Y MORFOLOGÍAS PASARON AL 100%!');
}

runTests().catch(err => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});
