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
  const user = await db.createUser({ email: `test-layout-${Date.now()}@example.com`, password: 'test_password' });
  const testData = {
    bizName: 'Restaurante Vanguardia Test',
    slug: `vanguardia-test-${Date.now()}`,
    bannerUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4',
    businessType: 'events',
    layout: 'bento',
    theme: 'emerald',
    font: 'sans',
    categories: []
  };

  const saved = await db.saveRestaurant(user.id, testData);
  const fetched = db.findRestaurantById(saved.id);
  const defaultUser = await db.createUser({ email: `test-default-type-${Date.now()}@example.com`, password: 'test_password' });
  const defaultProfile = await db.saveRestaurant(defaultUser.id, { bizName: 'Perfil Predeterminado' });

  assert.strictEqual(fetched.bannerUrl, testData.bannerUrl, 'bannerUrl debe persistir en db');
  assert.strictEqual(fetched.businessType, 'events', 'businessType debe persistir en db');
  assert.strictEqual(fetched.layout, 'bento', 'layout debe persistir como bento en db');
  assert.strictEqual(defaultProfile.businessType, 'restaurant', 'businessType debe usar restaurant por defecto');

  // Heladería: rubro de primera clase. El asistente debe sobrevivir a la lectura
  // (antes se colapsaba a 'restaurant' y se apagaba la bandera en el siguiente read).
  const heladeriaUser = await db.createUser({ email: `test-heladeria-${Date.now()}@example.com`, password: 'test_password' });
  await db.saveRestaurant(heladeriaUser.id, { bizName: 'Heladería Test', businessType: 'heladeria', allowIceCreamWizard: true });
  const heladeria = db.findRestaurantByUserId(heladeriaUser.id);
  assert.strictEqual(heladeria.businessType, 'heladeria', 'Heladería debe conservar su rubro (no colapsar a restaurant)');
  assert.strictEqual(heladeria.allowIceCreamWizard, true, 'El asistente de heladería debe sobrevivir a la lectura');

  // Un `false` explícito del dueño nunca se pisa al leer.
  const heladeriaOffUser = await db.createUser({ email: `test-heladeria-off-${Date.now()}@example.com`, password: 'test_password' });
  await db.saveRestaurant(heladeriaOffUser.id, { bizName: 'Heladería Off', businessType: 'heladeria', allowIceCreamWizard: false });
  const heladeriaOff = db.findRestaurantByUserId(heladeriaOffUser.id);
  assert.strictEqual(heladeriaOff.businessType, 'heladeria', 'Heladería sigue siendo su rubro aunque apague el asistente');
  assert.strictEqual(heladeriaOff.allowIceCreamWizard, false, 'Un false explícito del dueño no debe pisarse');
  console.log('✓ Persistencia en DB de bannerUrl y layout validada exitosamente');
  console.log('✓ Rubro Heladería de primera clase + bandera del asistente sobreviven al round-trip');

  // 2. Verificación de layouts permitidos e integridad en api/index.js
  const apiFile = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
  const sanitizeFile = fs.readFileSync(path.join(__dirname, '../api/utils/sanitizeRestaurant.js'), 'utf8');
  assert.ok(sanitizeFile.includes("ALLOWED_LAYOUTS = ['classic', 'bento', 'minimalist', 'neon', 'billboard', 'ticker', 'sticker']"), 'allowedLayouts debe incluir classic, bento, minimalist, neon, billboard, ticker y sticker');
  assert.ok(apiFile.includes('bannerUrl:'), 'api/index.js debe sanitizar y devolver bannerUrl');
  console.log('✓ Saneamiento y lista blanca de layouts en el backend verificados');

  // 3. Verificación de public/css/menu.css
  const menuCss = fs.readFileSync(path.join(__dirname, '../public/css/menu.css'), 'utf8');

  // 3a. Hero banner
  assert.ok(menuCss.includes('.menu-banner-hero'), 'menu.css debe tener estilos para .menu-banner-hero');
  assert.ok(menuCss.includes('.menu-banner-img'), 'menu.css debe tener estilos para .menu-banner-img');
  assert.ok(menuCss.includes('body.has-hero-banner'), 'menu.css debe soportar el estado body.has-hero-banner');
  assert.ok(menuCss.includes('object-fit: cover;'), 'La foto del hero debe llenar el ancho del banner');
  assert.ok(menuCss.includes('linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, #0E1412 100%)'), 'El hero debe aplicar el degradado inferior solicitado');
  assert.ok(menuCss.includes('height: 220px !important;'), 'El hero debe conservar altura mínima en móviles estrechos');
  console.log('✓ Estilos de Banner Hero (portada superior) verificados en menu.css');

  // 3b. 3 Nuevos Layouts
  assert.ok(menuCss.includes('body.layout-bento'), 'menu.css debe definir body.layout-bento');
  assert.ok(menuCss.includes('body.layout-minimalist'), 'menu.css debe definir body.layout-minimalist');
  assert.ok(menuCss.includes('body.layout-neon'), 'menu.css debe definir body.layout-neon');
  console.log('✓ Morfologías Bento Grid, Minimalist Luxury y Neon Nightbar presentes en menu.css');

  // 3b2. Morfologías Fase E (Billboard, Ticker, Sticker)
  assert.ok(menuCss.includes('body.layout-billboard'), 'menu.css debe definir body.layout-billboard');
  assert.ok(menuCss.includes('body.layout-ticker'), 'menu.css debe definir body.layout-ticker');
  assert.ok(menuCss.includes('body.layout-sticker'), 'menu.css debe definir body.layout-sticker');
  assert.ok(menuCss.includes('counter-increment: board'), 'billboard debe numerar los platos con CSS counters');
  assert.ok(menuCss.includes('scroll-snap-type: x mandatory'), 'El carrusel superior debe ser táctil con scroll-snap para móviles');
  // 3b3. Overlay sticker por clase condicional dish-has-photo (sin :has(), robusto en WebViews)
  assert.ok(menuCss.includes('.dish-card.dish-has-photo .dish-body'), 'El overlay del sticker debe usar la clase condicional dish-has-photo');
  assert.ok(!menuCss.includes('.dish-card:has('), 'Fase E no debe depender de :has() — se usa la clase dish-has-photo (compat Capacitor/WebViews)');
  // 3b4. Temas de evento × morfologías: acentos derivados de las variables del tema
  assert.ok(menuCss.includes('background: var(--surface-card, rgba(22, 33, 28, 0.8)) !important;'), 'billboard debe adaptar su fondo a la variable del tema (--surface-card)');
  assert.ok(menuCss.includes('background: var(--chalk-gold, #ECC94B);'), 'El contador de billboard debe usar el dorado del tema activo');
  assert.ok(menuCss.includes('color: var(--chalk-gold, #ECC94B);'), 'Precios de las morfologías deben usar var(--chalk-gold)');
  assert.ok(menuCss.includes('background: var(--chalk-gold, #ECC94B) !important;'), 'El botón + de sticker debe usar var(--chalk-gold)');
  // 3b5. Sold-out legible en las morfologías + impresión/PDF de la carta
  assert.ok(menuCss.includes('body.layout-sticker .dish-card.dish-sold .dish-price'), 'El estado Agotado debe mantener contraste sobre el sticker dorado');
  assert.ok(menuCss.includes('@media print'), 'menu.css debe incluir estilos de impresión/PDF para la carta');
  assert.ok(menuCss.includes('break-inside: avoid'), 'Las tarjetas no deben cortarse entre páginas impresas');
  console.log('✓ Morfologías Billboard QSR, Ticker Tipográfico y Sticker Artesanal presentes en menu.css');
  console.log('✓ Overlay por clase dish-has-photo (sin :has), acentos por variable de tema, sold-out y print verificados');

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

  // 3e. Temas de heladería: coloridos/entretenidos + formales
  const iceCreamThemes = ['helado-fiesta', 'helado-menta', 'helado-tropical', 'helado-pastel', 'gelateria', 'cioccolato'];
  for (const theme of iceCreamThemes) {
    assert.ok(menuCss.includes(`body.theme-${theme}`), `menu.css debe incluir el tema de heladería ${theme}`);
  }
  console.log('✓ Los 6 temas de heladería (3 coloridos + 3 formales) presentes en menu.css');

  // 3d. object-fit: cover y adaptaciones mobile < 360px
  assert.ok(menuCss.includes('object-fit: cover'), 'menu.css debe forzar object-fit: cover');
  assert.ok(menuCss.includes('@media (max-width: 360px)'), 'menu.css debe incluir reglas para pantallas < 360px');
  console.log('✓ Aspect-ratio/object-fit y responsive <360px comprobados en menu.css');

  // 4. Verificación de Studio UI (studio.html y studio.js)
  const studioHtml = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  assert.ok(studioHtml.includes('inputBannerFile'), 'studio.html debe tener inputBannerFile');
  assert.ok(studioHtml.includes('inputBannerUrl'), 'studio.html debe tener inputBannerUrl');
  assert.ok(studioHtml.includes('inputMenuLayout'), 'studio.html debe tener selector inputMenuLayout');

  const studioJs = fs.readFileSync(path.join(__dirname, '../public/js/studio.js'), 'utf8');
  assert.ok(studioJs.includes('handleBannerUpload'), 'studio.js debe implementar handleBannerUpload');
  assert.ok(studioJs.includes('removeBanner'), 'studio.js debe implementar removeBanner');
  assert.ok(studioJs.includes('renderBannerPreviewUI'), 'studio.js debe implementar renderBannerPreviewUI');
  assert.ok(studioJs.includes("if (value === 'perfumeria') return 'perfumery';") && studioJs.includes("return 'restaurant';"), 'Studio debe normalizar businessType con restaurant por defecto');
  assert.ok(studioJs.includes('updateBusinessTypeControls'), 'Studio debe filtrar controles exclusivos según el rubro');
  assert.ok(studioHtml.includes('data-business-type="perfumery"'), 'Los controles exclusivos deben identificarse como perfumería');
  assert.ok(schemaSql.includes("business_type TEXT NOT NULL DEFAULT 'restaurant'"), 'Supabase debe tener business_type con restaurant por defecto');
  assert.ok(studioHtml.includes('<option value="heladeria">'), 'studio.html debe exponer Heladería como rubro de primera clase');
  assert.ok(studioHtml.includes('value="helado-fiesta"') && studioHtml.includes('value="cioccolato"'), 'studio.html debe ofrecer los temas de heladería en el selector de estética');

  const landingHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(landingHtml.includes('<option value="heladeria">'), 'El registro debe ofrecer Heladería como rubro de primera clase');
  console.log('✓ Controles de portada superior y switcher de layout validados en Studio');

  // 5. Verificación de menu.html y menu.js
  const menuHtml = fs.readFileSync(path.join(__dirname, '../public/menu.html'), 'utf8');
  assert.ok(menuHtml.includes('menuBannerHero'), 'menu.html debe tener el contenedor #menuBannerHero');

  const menuJs = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
  assert.ok(menuJs.includes("bannerEl.querySelector('.menu-banner-logo-slot').append(logoContainer)"), 'El logo debe superponerse al hero');
  assert.ok(menuJs.includes("bannerEl.querySelector('.menu-banner-status-slot').append(heroStatusBadge)"), 'La insignia de estado debe superponerse al hero');
  assert.ok(menuJs.includes('layoutClass'), 'menu.js debe computar layoutClass');
  assert.ok(menuJs.includes("'bento'"), 'menu.js debe contemplar bento en validLayouts');
  assert.ok(menuJs.includes("'minimalist'"), 'menu.js debe contemplar minimalist en validLayouts');
  assert.ok(menuJs.includes("'neon'"), 'menu.js debe contemplar neon en validLayouts');
  assert.ok(menuJs.includes("'billboard'"), 'menu.js debe contemplar billboard en validLayouts');
  assert.ok(menuJs.includes("'ticker'"), 'menu.js debe contemplar ticker en validLayouts');
  assert.ok(menuJs.includes("'sticker'"), 'menu.js debe contemplar sticker en validLayouts');
  assert.ok(menuJs.includes("'helado-fiesta'") && menuJs.includes("'cioccolato'"), 'menu.js debe aceptar los temas de heladería en validThemes');
  // El botón del asistente se ancla en el flag, no en el rubro: un `false` explícito del
  // dueño apaga el asistente aunque businessType sea 'heladeria'.
  assert.ok(menuJs.includes('const isHeladeria = restaurantData.allowIceCreamWizard === true;'), 'menu.js debe respetar allowIceCreamWizard=false para no mostrar el asistente apagado');
  assert.ok(!menuJs.includes("restaurantData.businessType === 'heladeria' || restaurantData.allowIceCreamWizard"), 'menu.js no debe forzar el asistente por rubro cuando el dueño lo apagó');
  assert.ok(menuJs.includes('Los Mejores Platos de la Casa'), 'El carrusel superior debe mostrar Los Mejores Platos en las morfologías board');
  // Fase E pulido: overlay por clase condicional y títulos del carrusel traducibles
  assert.ok(menuJs.includes("dish-has-photo"), 'menu.js debe marcar los cards con foto con la clase dish-has-photo');
  assert.ok(menuJs.includes("t('topDishesCarousel', 'Los Mejores Platos de la Casa')"), 'El título del carrusel debe salir de i18n con fallback en español');
  console.log('✓ Inyección reactiva de banner y clases morfológicas comprobada en el menú público');

  // 5b. i18n de los títulos del carrusel Fase E en los 3 idiomas
  const i18nFile = fs.readFileSync(path.join(__dirname, '../public/js/components/I18nCurrencyManager.js'), 'utf8');
  for (const key of ['topDishesCarousel', 'favoritesBadge', 'chefAndFavoritesLabel', 'favoriteRibbon', 'recommendationLabel', 'chefSpecialBadge', 'chefTitleDefault']) {
    const occurrences = (i18nFile.match(new RegExp(key + ':', 'g')) || []).length;
    assert.strictEqual(occurrences, 3, `La key i18n ${key} debe existir en es, en y pt (encontradas: ${occurrences})`);
  }
  console.log('✓ Las 7 keys i18n nuevas del carrusel existen en los 3 idiomas (es/en/pt)');

  console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE BANNER Y MORFOLOGÍAS PASARON AL 100%!');
}

runTests().catch(err => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});
