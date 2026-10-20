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
  const menuRouterSrc = fs.readFileSync(path.join(__dirname, '../api/routes/menu.js'), 'utf8');
  const sanitizeFile = fs.readFileSync(path.join(__dirname, '../api/utils/sanitizeRestaurant.js'), 'utf8');
  // La lista blanca vive en el MANIFEST CANÓNICO (api/utils/themeManifest.js) y
  // el sanitizer la importa; la paridad completa (incluido el espejo ESM del
  // frontend) la garantiza npm run test:theme-manifest.
  const { LAYOUT_IDS } = require('../api/utils/themeManifest');
  assert.deepStrictEqual(
    LAYOUT_IDS,
    ['classic', 'bento', 'minimalist', 'neon', 'billboard', 'ticker', 'sticker', 'delivery', 'stories', 'brutalist'],
    'el manifest canónico declara las 10 morfologías (incluye brutalist)'
  );
  assert.ok(sanitizeFile.includes("require('./themeManifest')") && sanitizeFile.includes('LAYOUT_IDS'), 'sanitizeRestaurant debe derivar ALLOWED_LAYOUTS del manifest canónico');
  assert.ok(menuRouterSrc.includes('bannerUrl:'), 'routes/menu.js debe sanitizar y devolver bannerUrl');
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
  assert.ok(menuCss.includes('body.layout-delivery'), 'menu.css debe definir body.layout-delivery');
  assert.ok(menuCss.includes('body.layout-delivery .dish-card'), 'delivery debe estilizar .dish-card en lista horizontal');
  assert.ok(menuCss.includes('body.layout-delivery .btn-add'), 'delivery debe tener botón + circular propio');
  assert.ok(menuCss.includes('counter-increment: board'), 'billboard debe numerar los platos con CSS counters');
  assert.ok(menuCss.includes('scroll-snap-type: x mandatory'), 'El carrusel superior debe ser táctil con scroll-snap para móviles');
  // 3b2b. Fine Dining (minimalist reconstruido) + Brutalista (10ª morfología)
  assert.ok(menuCss.includes('--bg-chalkboard: #F7F4ED'), 'minimalist (Fine Dining) debe usar la paleta marfil, no la lista oscura con dorado');
  assert.ok(menuCss.includes('body.layout-brutalist'), 'menu.css debe definir body.layout-brutalist');
  const studioHtmlLayouts = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  assert.ok(studioHtmlLayouts.includes('<option value="brutalist">'), 'studio.html debe ofrecer el layout Brutalista en el selector');
  assert.ok(menuCss.includes('body.image-none') && menuCss.includes('body.image-hero'), 'menu.css debe estilizar los modos de imagen image-none/image-hero');
  assert.ok(menuCss.includes('body.sizing-popularity'), 'menu.css debe estilizar el sizing por popularidad (body.sizing-popularity)');
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
  // 3e2. Gelato Crema (bottega artesanal): paleta crema/menta/rosa/chocolate + lluvia de dots.
  assert.ok(menuCss.includes('body.theme-helado-crema'), 'menu.css debe incluir el tema helado-crema');
  assert.ok(menuCss.includes('--chalk-gold: #D9777F;') || menuCss.includes('--chalk-gold:#D9777F'), 'helado-crema tiñe el acento al rosa quemado de la bottega');
  const studioHtmlThemes = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  assert.ok(studioHtmlThemes.includes('<option value="helado-crema">'), 'studio.html debe ofrecer helado-crema en el selector');
  console.log('✓ Tema Gelato Crema presente en menu.css y en el selector del Studio');

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
  assert.ok(studioHtml.includes('<option value="delivery">'), 'studio.html debe ofrecer el layout Delivery App en el selector');

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
  // Filtro simétrico por rubro: heladería SOLO ve lo suyo y el resto SOLO ve
  // clásicos (un confeti rosa no es una parrilla). Las options siguen en el
  // HTML (se ocultan por JS); el server corrige lo que cuele por payload.
  assert.ok(studioJs.includes('const hide = isHeladeria ? !isHela : isHela;'), 'el filtro de temas es simétrico por rubro');
  assert.ok(studioJs.includes("restaurant.theme = 'emerald'"), 'restaurante con theme de heladería se corrige a emerald');
  const { sanitizeRestaurantPayload } = require('../api/utils/sanitizeRestaurant');
  assert.strictEqual(
    sanitizeRestaurantPayload({ name: 'R', businessType: 'restaurant', theme: 'helado-fiesta' }).theme,
    'emerald', 'server: restaurante con theme de heladería → emerald'
  );
  assert.strictEqual(
    sanitizeRestaurantPayload({ name: 'H', businessType: 'heladeria', theme: 'emerald' }).theme,
    'helado-fiesta', 'server: heladería con theme clásico → helado-fiesta'
  );
  assert.strictEqual(
    sanitizeRestaurantPayload({ name: 'H', businessType: 'heladeria', theme: 'gelateria' }).theme,
    'gelateria', 'server: heladería con theme propio se preserva'
  );

  const landingHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(landingHtml.includes('<option value="heladeria">'), 'El registro debe ofrecer Heladería como rubro de primera clase');
  console.log('✓ Controles de portada superior y switcher de layout validados en Studio');

  // 5. Verificación de menu.html y menu.js
  const menuHtml = fs.readFileSync(path.join(__dirname, '../public/menu.html'), 'utf8');
  assert.ok(menuHtml.includes('menuBannerHero'), 'menu.html debe tener el contenedor #menuBannerHero');

  const menuJs = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
  const headerModSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu/menuHeader.js'), 'utf8');
  assert.ok(headerModSrc.includes("bannerEl.querySelector('.menu-banner-logo-slot').append(logoContainer)"), 'El logo debe superponerse al hero');
  assert.ok(headerModSrc.includes("bannerEl.querySelector('.menu-banner-status-slot').append(heroStatusBadge)"), 'La insignia de estado debe superponerse al hero');
  assert.ok(headerModSrc.includes('layoutClass'), 'menuHeader.js debe computar layoutClass');
  // Las morfologías viven en el MANIFEST generado (frontend): menuHeader.js las
  // importa en vez de duplicar el listado. La paridad canónico↔espejo↔CSS↔Studio
  // es de npm run test:theme-manifest; acá verificamos que el espejo exista y
  // que el header lo consuma (así el listado duplicado no puede volver).
  const feManifestSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu/themeManifest.js'), 'utf8');
  assert.ok(headerModSrc.includes("from './themeManifest.js'"), 'menuHeader.js debe importar el manifest generado');
  for (const id of ['bento', 'minimalist', 'neon', 'billboard', 'ticker', 'sticker', 'delivery']) {
    assert.ok(feManifestSrc.includes(`"id": "${id}"`), `el manifest generado debe declarar la morfología ${id}`);
  }
  // Modo dual Stories: overlay de historias (mesa=carta clásica, casa=?morph=stories)
  assert.ok(feManifestSrc.includes('"id": "stories"'), 'el manifest generado debe declarar la morfología stories');
  assert.ok(menuJs.includes('toggleStoriesMode'), 'menu.js debe conservar toggleStoriesMode (anillos/overlay + binder)');
  assert.ok(menuJs.includes('maybeAutoEnterStoriesMod'), 'menu.js debe auto-entrar a stories con layout=stories tras renderizar');
  assert.ok(menuCss.includes('body.layout-stories'), 'menu.css debe definir body.layout-stories');
  assert.ok(menuCss.includes('#storiesOverlay'), 'menu.css debe estilizar el overlay #storiesOverlay (snap + segmentos + glass)');
  assert.ok(menuCss.includes('#storiesOverlay .st-add'), 'el overlay stories debe tener botón Agregar propio con acento del tema');
  assert.ok(studioHtml.includes('<option value="stories">'), 'studio.html debe ofrecer el layout Stories (modo dual) en el selector');
  const storiesMod = fs.readFileSync(path.join(__dirname, '../public/js/menu/storiesLayout.js'), 'utf8');
  assert.ok(storiesMod.includes('collectStories') && storiesMod.includes('enterStoriesMode') && storiesMod.includes('exitStoriesMode'), 'storiesLayout.js debe exportar collect/enter/exit');
  assert.ok(!/\.innerHTML\s*=(?!=)/.test(storiesMod), 'storiesLayout.js debe construir solo con DOM API (cero innerHTML con data, CSP-safe)');
  assert.ok(!storiesMod.includes('onClick') && !storiesMod.includes('onclick'), 'storiesLayout.js no debe usar handlers inline (CSP script-src-attr none)');
  assert.ok(storiesMod.includes("window.addToCart"), 'stories debe reutilizar window.addToCart (flujo real de notas/modificadores)');
  assert.ok(!menuHtml.includes('data-js-click="toggleStoriesMode"'), 'menu.html ya no tiene el botón 📖 suelto: las historias se abren desde los anillos de destacados');
  assert.ok(menuHtml.includes('id="storiesTray"'), 'menu.html debe tener la bandeja de destacados #storiesTray (anillos por categoría)');
  assert.ok(storiesMod.includes('renderStoriesTray'), 'stories debe renderizar anillos de destacados que abren en esa categoría');
  assert.ok(storiesMod.includes('scango_stories_pos_'), 'stories debe reanudar donde quedó (índice por slug, sin PII)');
  assert.ok(storiesMod.includes('touchend') && storiesMod.includes('SWIPE_EXIT_PX'), 'stories debe salir con swipe-down en la primera historia');
  assert.ok(storiesMod.includes('focusDishId'), 'stories debe enlazar "Ver en carta" (sale + enfoca el plato)');
  const trackingSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu/orderTracking.js'), 'utf8');
  assert.ok(trackingSrc.includes('st-flash') && trackingSrc.includes('function flashDishCard'), 'flashDishCard canónica vive en orderTracking.js (stories la importa, antes duplicada)');
  assert.ok(storiesMod.includes('st-share') && storiesMod.includes('shareRestaurantUrl'), 'cada historia debe poder compartirse');
  assert.ok(storiesMod.includes('emptyPhoto') && storiesMod.includes("addEventListener('error'"), 'foto rota del dueño debe caer a placeholder, nunca ícono roto');
  assert.ok(storiesMod.includes('st-logo'), 'la cabecera debe mostrar el logo real del local');
  assert.ok(storiesMod.includes('st-hint'), 'la primera historia debe enseñar los gestos (pista que se desvanece)');
  assert.ok(storiesMod.includes("removeEventListener('pointerup'"), 'el overlay debe liberar sus listeners globales al cerrar (sin fugas)');
  assert.ok(menuCss.includes('100vh;') && menuCss.includes('#storiesOverlay'), 'stories debe tener fallback 100vh para navegadores sin dvh');
  assert.ok(menuCss.includes('#storiesOverlay { display: none !important; }'), 'imprimir con stories abierto debe ocultar el overlay');
  // Escalabilidad: virtualización por ventana (cartas de hasta 400 platos)
  assert.ok(storiesMod.includes('IntersectionObserver') && storiesMod.includes('rootMargin'), 'stories debe virtualizar medios con IntersectionObserver (±2 pantallas)');
  assert.ok(storiesMod.includes('mountMedia') && storiesMod.includes('unmountMedia'), 'stories debe montar/desmontar medios al entrar/salir de ventana');
  assert.ok(storiesMod.includes('onStoriesResize'), 'stories debe re-anclar ante resize/rotación');
  assert.ok(storiesMod.includes('.st-media'), 'cada historia debe tener slot de medios de alto fijo');
  // Video del plato en Stories (link MP4 directo, foto de póster)
  assert.ok(sanitizeFile.includes('sanitizeVideoUrl'), 'sanitize debe exponer sanitizeVideoUrl para el video del plato');
  assert.ok(sanitizeFile.includes("'.mp4'") && sanitizeFile.includes("'.webm'"), 'video: solo contenedores cross-browser (.mp4/.webm), .mov afuera');
  assert.ok(sanitizeFile.includes('videoUrl: sanitizeVideoUrl'), 'sanitizeDish debe persistir videoUrl saneado');
  assert.ok(studioHtml.includes('id="modalDishVideo"'), 'studio debe pedir el link MP4 en el editor del plato');
  const renderSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu/menuRender.js'), 'utf8');
  assert.ok(renderSrc.includes('dish-videobadge'), 'la carta clásica debe señalizar con 🎬 los platos con video');
  assert.ok(storiesMod.includes('lookupDishVideo') && storiesMod.includes('window.restaurantData'), 'stories debe leer el video del puente vivo (sin duplicar estado)');
  assert.ok(storiesMod.includes("setAttribute('playsinline'") && storiesMod.includes('STORY_VIDEO_MAX_MS'), 'video: playsinline + avance atado a duración con tope 15s');
  assert.ok(storiesMod.includes('saveData') && storiesMod.includes('.catch('), 'video: respeta save-data y el play() con catch (iOS ahorro)');
  assert.ok(menuCss.includes('video.st-bg') || menuCss.includes('.st-bg'), 'el video debe llenar la historia como la foto (object-fit cover)');
  // Tema Ticket térmico (recibo de mostrador)
  assert.ok(menuCss.includes('body.theme-ticket'), 'menu.css debe definir body.theme-ticket');
  assert.ok(menuCss.includes('body.theme-ticket .menu-container::after'), 'ticket debe tener borde dentado inferior en el papel');
  assert.ok(menuCss.includes('body.theme-ticket .cat-pill'), 'ticket debe tener sellos por categoría');
  assert.ok(feManifestSrc.includes('"ticket"'), 'el manifest generado debe contemplar el tema ticket en validThemes');
  assert.ok(studioHtml.includes('<option value="ticket">'), 'studio.html debe ofrecer el tema Ticket en el selector');
  assert.ok(menuCss.includes('body.stories-open #scangoCookieBanner'), 'stories debe diferir banners flotantes (cookies/PWA/loyalty) mientras está abierto');
  assert.ok(storiesMod.includes('ArrowDown') && storiesMod.includes('Escape'), 'stories debe navegar con teclado (flechas + Escape)');
  assert.ok(storiesMod.includes("ev.key === 'Tab'"), 'stories debe atrapar el Tab dentro del overlay (diálogo inmersivo)');
  assert.ok(feManifestSrc.includes('"helado-fiesta"') && feManifestSrc.includes('"cioccolato"'), 'el manifest generado debe aceptar los temas de heladería en validThemes');
  // El botón del asistente se ancla en el flag, no en el rubro: un `false` explícito del
  // dueño apaga el asistente aunque businessType sea 'heladeria'.
  assert.ok(headerModSrc.includes('const isHeladeria = ctx.getRestaurantData().allowIceCreamWizard === true;'), 'menuHeader.js debe respetar allowIceCreamWizard=false para no mostrar el asistente apagado');
  assert.ok(!headerModSrc.includes("ctx.getRestaurantData().businessType === 'heladeria' || ctx.getRestaurantData().allowIceCreamWizard"), 'menuHeader.js no debe forzar el asistente por rubro cuando el dueño lo apagó');
  assert.ok(renderSrc.includes('Los Mejores Platos de la Casa'), 'El carrusel superior debe mostrar Los Mejores Platos en las morfologías board');
  // Fase E pulido: overlay por clase condicional y títulos del carrusel traducibles
  assert.ok(renderSrc.includes("dish-has-photo"), 'menuRender.js debe marcar los cards con foto con la clase dish-has-photo');
  assert.ok(renderSrc.includes("t('topDishesCarousel', 'Los Mejores Platos de la Casa')"), 'El título del carrusel debe salir de i18n con fallback en español');
  console.log('✓ Inyección reactiva de banner y clases morfológicas comprobada en el menú público');

  // 5b. i18n de los títulos del carrusel Fase E en los 3 idiomas
  const i18nFile = fs.readFileSync(path.join(__dirname, '../public/js/components/I18nCurrencyManager.js'), 'utf8');
  for (const key of ['topDishesCarousel', 'favoritesBadge', 'chefAndFavoritesLabel', 'favoriteRibbon', 'recommendationLabel', 'chefSpecialBadge', 'chefTitleDefault']) {
    const occurrences = (i18nFile.match(new RegExp(key + ':', 'g')) || []).length;
    assert.strictEqual(occurrences, 3, `La key i18n ${key} debe existir en es, en y pt (encontradas: ${occurrences})`);
  }
  console.log('✓ Las 7 keys i18n nuevas del carrusel existen en los 3 idiomas (es/en/pt)');

  // 5c. i18n de Stories + reseñas + nudge (overlay, modal y bandeja en 3 idiomas)
  for (const key of ['storiesViewMenu', 'storiesTrayTitle', 'storiesHint', 'storiesClose', 'storiesAdd', 'storiesSoldOut', 'storiesOrder', 'storiesSeeInMenu', 'storiesShareLocal', 'storiesViewCart', 'reviewNudgeTitle', 'reviewNudgeText', 'reviewNudgeCta', 'reviewAltPrivate', 'reviewAltGoogle', 'reviewStar1', 'reviewStar2', 'reviewStar3', 'reviewStar4', 'reviewStar5', 'reviewTitle', 'reviewGoogleTitle', 'reviewGoogleText', 'reviewGoogleCta', 'reviewDismiss', 'reviewPrivateTitle', 'reviewPrivateText', 'reviewPrivateSubmit', 'reviewCommentLabel', 'reviewCommentPh', 'reviewNameLabel', 'reviewNamePh', 'reviewContactLabel', 'reviewContactPh', 'reviewSuccessTitle', 'reviewSuccessText', 'reviewNeedComment', 'reviewSendError', 'reviewConnError']) {
    const occurrences = (i18nFile.match(new RegExp(key + ':', 'g')) || []).length;
    assert.strictEqual(occurrences, 3, `La key i18n ${key} debe existir en es, en y pt (encontradas: ${occurrences})`);
  }
  console.log('✓ Las 39 keys i18n de stories/reseñas existen en los 3 idiomas (es/en/pt)');

  console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE BANNER Y MORFOLOGÍAS PASARON AL 100%!');
}

runTests().catch(err => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});
