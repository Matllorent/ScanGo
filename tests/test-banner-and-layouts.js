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
  assert.ok(!renderSrc.includes('dish-videobadge'), 'badge "🎬 Video" eliminado de la carta (decisión del dueño): el video solo se vive en Stories');
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

  // 3f. Tema Explosivo — morfología + personalidad (neobrutalismo / fanzine punk)
  assert.ok(menuCss.includes('body.theme-explosivo.layout-classic .dishes-grid'),
    'menu.css debe definir el bloque body.theme-explosivo.layout-classic .dishes-grid');
  assert.ok(menuCss.includes('grid-template-columns: repeat(12, 1fr)'),
    'el tema explosivo en classic debe usar grilla asimétrica de 12 columnas');
  assert.ok(menuCss.includes('grid-column: span'),
    'la grilla asimétrica explosiva debe usar grid-column: span');
  assert.ok(/@keyframes\s+explosivoSlam/.test(menuCss),
    'debe existir al menos una animación @keyframes (explosivoSlam)');
  assert.ok(menuCss.includes('@media (prefers-reduced-motion: reduce)'),
    'prefers-reduced-motion debe desactivar las animaciones del tema explosivo');
  assert.ok(menuCss.includes('--explosivo-red-deep: #C81E2E'),
    'debe definir --explosivo-red-deep para fondos con texto pequeño');
  assert.ok(menuCss.includes('background: #FFF9E6') || menuCss.includes("background: '#FFF9E6'") || /background:\s*#FFF9E6/.test(menuCss),
    'las tarjetas del tema explosivo deben ser papel crema #FFF9E6');
  assert.ok(/box-shadow:\s*7px 7px 0 #FF3344, 13px 13px 0 #00C2FF/.test(menuCss),
    'las tarjetas explosivas deben tener doble sombra dura (rojo + azul)');
  assert.ok(menuCss.includes('position: sticky') && menuCss.includes('top: 0'),
    '.controls-wrapper del tema explosivo debe mantener position: sticky');
  assert.ok(menuCss.includes('rotate: -2deg') || menuCss.includes('rotate: 2deg') || menuCss.includes('rotate: 1deg') || menuCss.includes('rotate: -1deg') || menuCss.includes('rotate: 1.5deg') || menuCss.includes('rotate: -1.5deg'),
    'la grilla asimétrica explosiva debe usar rotate: (propiedad individual) en nth-child');
  console.log('✓ Tema Explosivo: bloque layout-classic .dishes-grid, grilla asimétrica span, keyframes, reduced-motion, rojo profundo, tarjetas crema, sticky controls y rotate individuales verificados');

  // 3g. Panel del probador de temas tema-agnóstico + tema "Cafetería Moderna"
  //     (bug oct-2026: con explosivo activo, el panel resolvía
  //     background=var(--surface-card)=crema #FFF9E6 y los pills heredaban el
  //     color crema del body ⇒ crema sobre crema, solo se leía el pill activo).
  const panelStart = menuCss.indexOf('#demoThemePanel {');
  const panelCss = menuCss.slice(panelStart, menuCss.indexOf('}', panelStart) + 1);
  assert.ok(panelCss.length > 0, 'menu.css define el panel #demoThemePanel');
  assert.ok(!panelCss.includes('var(--surface-card'), 'el panel NO depende de --surface-card (sin crema-sobre-crema con explosivo)');
  assert.ok(/background:\s*#131B17/.test(panelCss), 'el panel usa superficie carbón propia (fija)');
  assert.ok(/color:\s*#EAF2EC/.test(panelCss), 'el panel fija color de texto legible (no hereda el crema del body)');
  assert.ok(/\.demo-theme-pill\[aria-pressed="true"\]/.test(menuCss), 'pill activa por estado aria-pressed (a11y-driven)');
  assert.ok(/\.demo-theme-pill:hover/.test(menuCss), 'pill con hover visible independiente del tema');
  assert.ok(/\.demo-theme-pill:focus-visible/.test(menuCss), 'pill con focus-visible (navegación por teclado)');
  assert.ok(/body\.theme-moderna\s*\{[^}]*--bg-chalkboard:\s*#171310/.test(menuCss), 'Cafetería Moderna: fondo carbón negro mate #171310');
  assert.ok(/body\.theme-moderna\s*\{[^}]*--surface-card:\s*#241B15/.test(menuCss), 'Cafetería Moderna: cards espresso #241B15');
  assert.ok(/body\.theme-moderna\s*\{[^}]*--chalk-gold:\s*#D6A171/.test(menuCss), 'Cafetería Moderna: acento cobre suave #D6A171');
  assert.ok(/body\.theme-moderna\s*\{[^}]*--chalk-white:\s*#F3EADD/.test(menuCss), 'Cafetería Moderna: texto crema latte #F3EADD');
  assert.ok(/body\.theme-moderna\s*\{[^}]*--chalk-gold-ink:\s*#E5B078/.test(menuCss), 'Cafetería Moderna: precio reforzado #E5B078 (mayor contraste sobre card)');
  // Morfología "La carta de la barra" (rediseño oct-2026): lista tipográfica
  // corrida scoped a layout-classic — las cards mueren, la tipografía manda.
  assert.ok(/body\.theme-moderna\s*\{[^}]*background-image:\s*none/.test(menuCss), 'moderna: sin gradientes decorativos (fondo plano)');
  assert.ok(/body\.theme-moderna\.layout-classic \.dish-card\s*\{[^}]*background:\s*transparent/.test(menuCss), 'moderna/classic: cards transparentes (lista, no cajas)');
  assert.ok(/body\.theme-moderna\.layout-classic [^{]*\.dish-name\s*\{[^}]*display:\s*flex/.test(menuCss) && menuCss.includes('body.theme-moderna.layout-classic .dish-name::after'), 'moderna/classic: línea de puntos entre nombre y precio');
  assert.ok(/body\.theme-moderna\.layout-classic \.dish-body,\s*body\.theme-moderna\.layout-classic \.dish-title-line\s*\{[^}]*display:\s*contents/.test(menuCss), 'moderna/classic: cuerpo disuelto en la grilla de la fila (name+precio misma línea)');
  assert.ok(/body\.theme-moderna\.layout-classic [^{]*\.dish-price\s*\{[^}]*color:\s*var\(--chalk-white\)/.test(menuCss), 'moderna/classic: precio en tinta porcelana (no dorado como el resto de temas)');
  assert.ok(/body\.theme-moderna\.layout-classic [^{]*\.dish-thumb\s*\{[^}]*display:\s*none/.test(menuCss), 'moderna/classic: miniatura fuera de la fila (la foto vive en el detalle)');
  assert.ok(/body\.theme-moderna \.cat-pill\s*\{[^}]*border:\s*0/.test(menuCss), 'moderna: categorías como texto (sin píldora), activo con subrayado del tema');
  assert.ok(/body\.theme-moderna\.layout-classic \.category-title\s*\{[^}]*Plus Jakarta Sans/.test(menuCss), 'moderna: cabecera de categoría display Plus Jakarta 800');
  assert.ok(/body\.theme-moderna \.controls-wrapper\s*\{[^}]*background:\s*rgba\(23, 19, 16/.test(menuCss), 'moderna: barra sticky en carbón del tema (no el verde hardcodeado rgba(21,29,26))');
  console.log('✓ Panel de temas tema-agnóstico (fix crema-sobre-crema en explosivo) + Cafetería Moderna café de especialidad (cobre/carbón, AA)');

  // 3h. Tema Basketball "LA CANCHA" (morfología oct-2026): el menú ES la
  //     cancha — piso de madera con marcas pintadas (media pista + círculo,
  //     la zona/"key" con tiro libre, arco de tres, línea de fondo), precio
  //     según marcador (goma + LED ámbar mono) y filas con riel de la zona.
  //     Patrones: paleta AA verificada + morfología scoped a layout-classic.
  assert.ok(/body\.theme-basketball\s*\{[^}]*--bg-chalkboard:\s*#C79E63/.test(menuCss), 'basketball: madera de la cancha #C79E63');
  assert.ok(/body\.theme-basketball\s*\{[^}]*--surface-card:\s*#F8F1E4/.test(menuCss), 'basketball: papel de anotador #F8F1E4 (modals, no wood-sobre-tinta)');
  assert.ok(/body\.theme-basketball\s*\{[^}]*--chalk-white:\s*#26160D/.test(menuCss), 'basketball: tinta cacao #26160D sobre madera (~7:1)');
  assert.ok(/body\.theme-basketball\s*\{[^}]*--chalk-gold:\s*#E56A25/.test(menuCss), 'basketball: naranja bola #E56A25 con tinta encima (5.3:1)');
  assert.ok(/body\.theme-basketball\s*\{[^}]*--chalk-gold-ink:\s*#B14312/.test(menuCss), 'basketball: chapa profunda #B14312 para TEXTO acento sobre papel (~5.7:1)');
  assert.ok(/body\.theme-basketball\s*\{[^}]*--chalk-dim:\s*#452918/.test(menuCss), 'basketball: secundario café #452918 (nunca rgba claro heredado)');
  // La cancha pintada: shorthand background (pos/size/repeat por capa NO son
  // válidos dentro de background-image — el motor tira la declaración entera).
  assert.ok(/body\.theme-basketball\s*\{[^}]*radial-gradient\(circle 160px at 50% 260px/.test(menuCss), 'basketball: círculo central de la media pista');
  assert.ok(/body\.theme-basketball\s*\{[^}]*circle 330px at 97% 100%/.test(menuCss), 'basketball: arco de tres puntos en la esquina inferior');
  assert.ok(/body\.theme-basketball\s*\{[^}]*radial-gradient\(circle 66px at 142px calc\(100% - 300px\)/.test(menuCss), 'basketball: círculo de tiro libre de la zona (key)');
  assert.ok(/body\.theme-basketball\s*\{[^}]*0 258px \/ 100% 5px/.test(menuCss), 'basketball: línea de medio campo (banda de tiza)');
  assert.ok(menuCss.includes('body.theme-basketball .menu-container { background: transparent; }'), 'basketball: contenedor transparente — el piso vive en el body y el contenido flota sobre la cancha');
  // Header: el base re-scopea --chalk-white a claro ("header siempre oscuro");
  // basketball lo devuelve a tinta sobre madera (titular varsity Montserrat 900).
  const bbHeaderStart = menuCss.indexOf('body.theme-basketball .menu-header {');
  const bbHeaderCss = menuCss.slice(bbHeaderStart, menuCss.indexOf('}', bbHeaderStart) + 1);
  assert.ok(/--chalk-white:\s*#26160D/.test(bbHeaderCss), 'basketball: header re-scopea --chalk-white a tinta (contrario al re-scope claro del base)');
  assert.ok(/body\.theme-basketball \.restaurant-title\s*\{[^}]*font-weight:\s*900/.test(menuCss), 'basketball: titular wordmark Montserrat 900 uppercase');
  assert.ok(/body\.theme-basketball\.has-hero-banner \.restaurant-title\s*\{[^}]*color:\s*#F8F1E4/.test(menuCss), 'basketball: con portada la voz sale en crema con sombra (overlay foto)');
  // Morfología de filas con riel (solo layout-classic)
  assert.ok(/body\.theme-basketball\.layout-classic \.category-title\s*\{[^}]*background:\s*#1C1512/.test(menuCss) && /body\.theme-basketball\.layout-classic \.category-title\s*\{[^}]*border-left:\s*6px solid #E56A25/.test(menuCss), 'basketball: cabecera de categoría = tablero de goma con borde naranja');
  assert.ok(/body\.theme-basketball\.layout-classic \.category-badge-count\s*\{[^}]*color:\s*#FFC048/.test(menuCss) && /body\.theme-basketball\.layout-classic \.category-badge-count\s*\{[^}]*IBM Plex Mono/.test(menuCss), 'basketball: contador LED ámbar en IBM Plex Mono');
  assert.ok(/body\.theme-basketball\.layout-classic \.dishes-grid\s*\{[^}]*display:\s*block/.test(menuCss), 'basketball: lista corrida (no grid de cards); sizing-popularity puede re-griddar');
  assert.ok(/body\.theme-basketball\.layout-classic \.dish-card\s*\{[^}]*border-left:\s*4px solid #C45A1D/.test(menuCss), 'basketball: riel de la zona al costado de la fila');
  assert.ok(/body\.theme-basketball\.layout-classic \.dish-body,\s*body\.theme-basketball\.layout-classic \.dish-title-line\s*\{[^}]*display:\s*contents/.test(menuCss), 'basketball: cuerpo disuelto en la grilla de la fila');
  assert.ok(/body\.theme-basketball\.layout-classic \.dish-thumb\s*\{[^}]*display:\s*none/.test(menuCss), 'basketball: miniatura fuera de la fila (la foto vive en detalle/stories)');
  assert.ok(/body\.theme-basketball\.layout-classic \.dish-price\s*\{[^}]*background:\s*#1C1512/.test(menuCss) && /body\.theme-basketball\.layout-classic \.dish-price\s*\{[^}]*color:\s*#FFC048/.test(menuCss) && /body\.theme-basketball\.layout-classic \.dish-price\s*\{[^}]*IBM Plex Mono/.test(menuCss), 'basketball: precio = marcador (goma + LED ámbar, única voz mono del tema)');
  assert.ok(/body\.theme-basketball\.layout-classic \.dish-price:empty\s*\{[^}]*display:\s*none/.test(menuCss), 'basketball: $0 sin costo no pinta marcador vacío');
  assert.ok(/body\.theme-basketball\.layout-classic \.dish-card \.btn-add\s*\{[^}]*background:\s*#E56A25/.test(menuCss) && /body\.theme-basketball\.layout-classic \.dish-card \.btn-add:hover\s*\{[^}]*rotate/.test(menuCss), 'basketball: el botón + es la pelota (naranja, hover con giro de bola)');
  assert.ok(/body\.theme-basketball \.cat-pill.active,\s*body\.theme-basketball \.cat-pill\[aria-pressed="true"\]/.test(menuCss) && /background:\s*#E56A25;\s*\n\s*color:\s*#26160D !important;/.test(menuCss), 'basketball: pill varsity activa = pintada naranja con tinta (!important gana al color inline de "⭐ Populares")');
  assert.ok(/body\.theme-basketball\.layout-classic \.dish-badge\s*\{[^}]*grid-column:\s*1 \/ -1/.test(menuCss), 'basketball: badges ocupan línea propia dentro de la fila-grid');
  assert.ok(/body\.theme-basketball \.total-summary\s*\{[^}]*background:\s*#1C1512/.test(menuCss) && /body\.theme-basketball \.total-summary \.summary-row span\.total-amount\s*\{[^}]*color:\s*#FFC048/.test(menuCss), 'basketball: el total del checkout = marcador (goma + dígitos LED ámbar)');
  assert.ok(/body\.theme-basketball \.controls-wrapper\s*\{[^}]*border-bottom:\s*5px solid #E56A25/.test(menuCss), 'basketball: la barra sticky es el tablero con aro naranja de 5px al pie');
  assert.ok(/body\.theme-basketball \.controls-wrapper::before\s*\{[^}]*z-index:\s*-1/.test(menuCss), 'basketball: marco grabado pintado DETRÁS del contenido (z-index -1; el backdrop-filter del base crea el stacking context)');
  assert.ok(!/body\.theme-basketball \.controls-wrapper::after/.test(menuCss), 'basketball: el cuadrado de tiro libre NO flota en el wrapper (su altura varía por fila y se leía como artefacto de selección)');
  assert.ok(/body\.theme-basketball \.search-box\s*\{[^}]*border:\s*2px solid rgba\(229, 106, 37, 0\.5\)/.test(menuCss), 'basketball: el buscador es el cuadrado pintado del tablero (marco naranja estable)');
  assert.ok(/body\.theme-basketball \.i18n-currency-bar\s*\{[^}]*background:\s*rgba\(28, 21, 18, 0\.9\)/.test(menuCss), 'basketball: barra de idioma/moneda en goma (su base usa var(--surface-card) y resolvía papel sobre el tablero)');
  assert.ok(/body\.theme-basketball \.floating-cart-bar\s*\{[^}]*background:\s*#1C1512/.test(menuCss) && /body\.theme-basketball \.floating-cart-bar::before\s*\{[^}]*content:\s*'24'/.test(menuCss), 'basketball: la barra del carrito es el shot clock (goma + aro naranja + chip "24" en LED mono, no el verde WhatsApp #25D366 base)');
  assert.ok(/body\.theme-basketball \.cart-bar-emoji,\s*body\.theme-basketball \.pill-emoji,\s*body\.theme-basketball \.meta-emoji,\s*body\.theme-basketball \.i18n-currency-icon\s*\{[^}]*display:\s*none/.test(menuCss), 'basketball: cero emojis baratos — los emojis compartidos se envuelven en spans ocultables y el tema habla solo con tipografía');
  assert.ok(/body\.theme-basketball\.layout-classic \.category-title::after\s*\{[^}]*counter\(cancha-cat, decimal-leading-zero\)/.test(menuCss) && /body\.theme-basketball\.layout-classic \.category-section\s*\{[^}]*counter-increment:\s*cancha-cat/.test(menuCss), 'basketball: dorsal #01/#02… por categoría, contador CSS en LED ámbar');
  assert.ok(/linear-gradient\(90deg, transparent 0 4px, rgba\(38, 22, 13, 0\.5\) 4px 4\.8px, transparent 4\.8px\)/.test(menuCss), 'basketball: la pelota de los tableros tiene COSTURAS dibujadas (dos líneas goma cruzadas, no un círculo vacío)');
  assert.ok(/body\.theme-basketball \.controls-wrapper\s*\{[^}]*border-radius:\s*0 0 14px 14px/.test(menuCss), 'basketball: tablero con esquinas inferiores redondeadas (cristal completo, no banda infinita)');
  console.log('✓ Tema Basketball "LA CANCHA": piso pintado (media pista/zona/tiro tres), marcador LED, filas con riel, papel de anotador (AA) y barra sticky = tablero con aro');

  // ─────────────────────────────────────────────────────────────
  // §3i — EL BERILO (theme-emerald tallado): el fondo ES la piedra
  // ─────────────────────────────────────────────────────────────
  assert.ok(/body\.theme-emerald\s*\{\s*background:\s*\n?\s*linear-gradient\(112deg, transparent 0 19%/.test(menuCss) && /conic-gradient\(from 8deg at 50% 6%, #11432F 0deg 16\.6deg/.test(menuCss), 'emerald: el fondo ES la piedra — haz de luz + facetas del crown con conic hard stops');
  assert.ok(/#071911 359\.6deg 360deg\)[^;]*no-repeat;\s*background-color:\s*#0A271E;/.test(menuCss), 'emerald: vetas de corte #071911 entre facetas y background-color DESPUÉS del shorthand (el shorthand lo resetea)');
  assert.ok(/radial-gradient\(circle at 61px 97px, rgba\(226, 252, 240, 0\.12\)/.test(menuCss) && /radial-gradient\(circle at 143px 31px, rgba\(226, 252, 240, 0\.07\)/.test(menuCss), 'emerald: inclusiones del jardín (dos capas de puntitos desfasados)');
  assert.ok(/body\.theme-emerald \.menu-container\s*\{\s*background:\s*transparent/.test(menuCss), 'emerald: contenedor transparente — el crown facetado vive en el body y el contenido flota sobre la gema');
  assert.ok(/body\.theme-emerald\.layout-classic \.dish-card\s*\{[^}]*clip-path:\s*polygon\(16px 0, 100% 0, 100% calc\(100% - 16px\)/.test(menuCss), 'emerald: tarjeta = panel facetado con dos esquinas cortadas a diamante (step cut)');
  assert.ok(/body\.theme-emerald\.layout-classic \.btn-add\s*\{[^}]*clip-path:\s*polygon\(50% 0, 100% 50%, 50% 100%, 0 50%\)/.test(menuCss), 'emerald: el botón + es la gema engastada (corte de diamante, el + nunca rota)');
  assert.ok(/body\.theme-emerald\.layout-classic \.cat-pill\s*\{[^}]*clip-path:\s*polygon\(9px 0, 100% 0, calc\(100% - 9px\) 100%/.test(menuCss), 'emerald: pastillas con corte de talla (recorte diagonal)');
  assert.ok(/body\.theme-emerald\.layout-classic \.category-title::before\s*\{[^}]*transform:\s*rotate\(45deg\)/.test(menuCss) && /body\.theme-emerald\.layout-classic \.category-title\s*\{[^}]*border-bottom:\s*1px solid rgba\(236, 201, 75, 0\.28\)/.test(menuCss), 'emerald: cabecera de categoría con gema engastada (::before rotada 45deg) + filete de oro');
  assert.ok(/body\.theme-emerald\s*\{[^}]*--surface-card:\s*#12382B/.test(menuCss) && /body\.theme-emerald\s*\{[^}]*--chalk-dim:\s*#A9C8B8/.test(menuCss), 'emerald: beryl más profundo de superficie + dim beryl (AA sobre la faceta más clara)');
  console.log('✓ Tema Emerald "EL BERILO": fondo tallado (facetas conic + vetas + haz de luz + inclusiones), cards con chaflán de diamante y gema engastada (AA)');

  // ─────────────────────────────────────────────────────────────
  // §3j — NIGHTBAR (layout-neon, morfología completa)
  // ─────────────────────────────────────────────────────────────
  assert.ok(/body\.layout-neon\s*\{\s*background:\s*\n?\s*radial-gradient\(9px circle at 12% 8%/.test(menuCss) && /background-color:\s*#070B0A;/.test(menuCss), 'neon NIGHTBAR: la sala a oscuras con bokeh de luces ambientales (3 capas) — shorthand + background-color al final');
  assert.ok(/radial-gradient\(ellipse 85% 40% at 50% 0%, rgba\(var\(--neon-rgb\), 0\.08\)/.test(menuCss) && /linear-gradient\(180deg, transparent 0 78%/.test(menuCss), 'neon NIGHTBAR: el tinte del tubo llena la pared arriba y el piso refleja el glow abajo');
  assert.ok(/body\.layout-neon \.restaurant-title\s*\{\s*animation:\s*neonTubeFlicker/.test(menuCss) && /@keyframes neonTubeFlicker/.test(menuCss) && /prefers-reduced-motion: reduce\)\s*\{\s*body\.layout-neon \.restaurant-title\s*\{\s*animation:\s*none/.test(menuCss), 'neon NIGHTBAR: parpadeo sutil del cartel (9s) que se apaga con prefers-reduced-motion');
  assert.ok(/body\.layout-neon \.restaurant-title::after\s*\{[^}]*height:\s*2px/.test(menuCss) && /body\.layout-neon \.restaurant-title::after\s*\{[^}]*background:\s*var\(--neon\)/.test(menuCss), 'neon NIGHTBAR: tubo de bajada del cartel bajo el nombre');
  assert.ok(/body\.layout-neon \.category-title::before\s*\{[^}]*width:\s*6px/.test(menuCss) && /body\.layout-neon \.category-title::after\s*\{[^}]*linear-gradient\(90deg, var\(--neon\)/.test(menuCss), 'neon NIGHTBAR: cabeceras = tubos de letrero (soporte de porcelana + barra que se apaga)');
  assert.ok(/body\.layout-neon \.btn-add\s*\{[^}]*background:\s*#0B110F/.test(menuCss) && /body\.layout-neon \.btn-add:hover\s*\{[^}]*background:\s*var\(--neon\)/.test(menuCss), 'neon NIGHTBAR: el botón + es el tubo APAGADO que se enciende al hover (aro over vidrio → llenado)');
  assert.ok(/body\.layout-neon \.cat-pill\.active,\s*body\.layout-neon \.cat-pill\[aria-pressed="true"\]/.test(menuCss) && /background:\s*var\(--neon\) !important;\s*\n\s*color:\s*#070B0A !important;/.test(menuCss), 'neon NIGHTBAR: pill activa = tubo encendido (ink sobre neón, !important gana al inline de Populares)');
  assert.ok(/body\.layout-neon \.floating-cart-bar\s*\{[^}]*border:\s*1\.5px solid var\(--neon\)/.test(menuCss) && /body\.layout-neon \.floating-cart-bar\s*\{[^}]*border-radius:\s*999px/.test(menuCss) && /body\.layout-neon \.floating-cart-bar #cartTotalBadge\s*\{[^}]*color:\s*var\(--neon\)/.test(menuCss), 'neon NIGHTBAR: la barra del carrito es el alumbrado de la barra (píldora negra + aro de neón + LED del acento)');
  assert.ok(/body\.layout-neon \.chef-specials-section\s*\{[^}]*border:\s*1px solid rgba\(var\(--neon-rgb\), 0\.25\)/.test(menuCss) && /body\.layout-neon \.total-summary \.summary-row span\.total-amount\s*\{[^}]*color:\s*var\(--neon\)/.test(menuCss), 'neon NIGHTBAR: vidriera de promos con aro + total del checkout en LED del acento');
  assert.ok(/body\.layout-neon \.dish-card\s*\{[^}]*position:\s*relative/.test(menuCss) && /body\.layout-neon \.dish-card::after\s*\{[^}]*inset:\s*0/.test(menuCss), 'neon NIGHTBAR: bicó de vidrio — aro interior de luz (inset 0, pointer-events none)');
  console.log('✓ Layout Neon "NIGHTBAR": bokeh ambiental, cartel con tubo y parpadeo, cabeceras-tubo, botón que se enciende, píldora de carrito con aro (AA)');

  // ─────────────────────────────────────────────────────────────
  // §3k — BISTRÓ NORDICO (theme-nordico: mínimo nórdico de juice bar)
  // ─────────────────────────────────────────────────────────────
  assert.ok(/body\.theme-nordico\s*\{[^}]*--bg-chalkboard:\s*#F8F8F6/.test(menuCss) && /body\.theme-nordico\s*\{[^}]*--chalk-white:\s*#121212/.test(menuCss), 'nordico: off-white de tienda + tinta #121212 como texto del tema claro');
  assert.ok(/body\.theme-nordico\s*\{[^}]*--border-chalk:\s*#E9E9EA/.test(menuCss) && /--nordico-radius-card:\s*20px/.test(menuCss), 'nordico: hairline #E9E9EA opaco + radius de tarjeta 20px');
  assert.ok(/body\.theme-nordico\.layout-classic \.dish-card\s*\{[^}]*display:\s*grid/.test(menuCss) && /body\.theme-nordico\.layout-classic \.dish-card\s*\{[^}]*grid-template-columns:\s*112px 1fr auto/.test(menuCss), 'nordico: tarjeta = fila horizontal (miniatura | cuerpo | acción)');
  assert.ok(/body\.theme-nordico\.layout-classic \.dish-thumb\s*\{[^}]*width:\s*112px/.test(menuCss) && /body\.theme-nordico\.layout-classic \.dish-thumb\s*\{[^}]*border-radius:\s*var\(--nordico-radius-thumb\)/.test(menuCss), 'nordico: miniatura 112px con radio 8 (la figura de la fila)');
  assert.ok(/body\.theme-nordico\.layout-classic \.dish-body\s*\{[^}]*display:\s*flex/.test(menuCss) && /body\.theme-nordico\.layout-classic \.dish-price\s*\{[^}]*margin-top:\s*auto/.test(menuCss), 'nordico: cuerpo apilado con el precio pegado abajo (debito del tachado libre)');
  assert.ok(/\.dish-schedule-kicker\s*\{\s*display:\s*none;/.test(menuCss) && /body\.theme-nordico \.dish-schedule-kicker\s*\{[^}]*display:\s*block/.test(menuCss) && /text-transform:\s*uppercase/.test(menuCss.split('body.theme-nordico .dish-schedule-kicker')[1].slice(0, 400)), 'nordico: kicker de horario oculto por defecto en TODOS los temas y solo el nordico lo muestra (uppercase)');
  assert.ok(/body\.theme-nordico \.cat-pill\.active,\s*body\.theme-nordico \.cat-pill\[aria-pressed="true"\]/.test(menuCss), 'nordico: pastilla activa en tinta plena (aria-pressed aliñado con estado a11y)');
  assert.ok(/body\.theme-nordico \.controls-wrapper\s*\{[^}]*border:\s*1px solid #E9E9EA/.test(menuCss) && /body\.theme-nordico \.controls-wrapper\s*\{[^}]*border-radius:\s*var\(--nordico-radius-card\)/.test(menuCss), 'nordico: barra sticky = tarjeta blanca con hairline');
  assert.ok(/body\.theme-nordico\.layout-classic \.chef-special-card\s*\{[^}]*border-radius:\s*var\(--nordico-radius-card\)/.test(menuCss), 'nordico: chef specials visten la misma tarjeta fila');
  assert.ok(/body\.theme-nordico #floatingCart\s*\{[^}]*border-radius:\s*999px/.test(menuCss) && /body\.theme-nordico #cartTotalBadge\s*\{[^}]*background:\s*#121212/.test(menuCss), 'nordico: carrito flotante = barra blanca hairline con chip de tinta');
  assert.ok(/body\.theme-nordico \.dish-badge\s*\{\s*background:\s*none !important;/.test(menuCss), 'nordico: badges como texto mínimo sin chips de color (el AGOTADO rojo queda)');
  console.log('✓ Tema Nordico "BISTRÓ NORDICO": off-white+tinta, tarjeta fila (piedra/figure 112px), kicker horario latente, pills y sticky hairline (AA)');

  console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE BANNER Y MORFOLOGÍAS PASARON AL 100%!');
}

runTests().catch(err => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});
