/**
 * api/utils/demoRestaurants.js
 * ───────────────────────────
 * Catálogo de restaurantes DEMO por rubro (in-memory, sin persistencia).
 *
 * Los 4 rubros de primera clase del producto tienen una demo navegable:
 *   restaurant → /m/demo-restaurante   (La Trattoria del Puerto)
 *   heladeria  → /m/demo-heladeria     (Heladería Frescura)
 *   perfumery  → /m/demo-perfumeria    (Casa Aromas)
 *   events     → /m/demo-evento        (Boda Martina & Santi)
 *
 * Diseño:
 * - Cero persistencia: no toca data/*.json ni Supabase. En serverless (/tmp
 *   efímero) y en dev es el mismo objeto determinista, así que no contamina
 *   tests ni requiere migraciones.
 * - Las cartas son REALES (categorías + platos con id propio) para que los
 *   motores data-driven funcionen: el wizard de helado deriva sabores de la
 *   carta (iceCreamHeuristics) y la vista de perfumería cotiza con ids reales
 *   (perfumeryHeuristics). Nada de catálogos inventados en el frontend.
 * - /api/menu/:slug y /m/:slug resuelven el slug demo ANTES de la DB y
 *   saltean verifyAccess (la demo siempre está online, no depende de trial).
 * - Imágenes 100% libres de derechos VERIFICADAS por API: fotos CC0/dominio
 *   público de Wikimedia Commons (licencia chequeada una por una) y video CC0
 *   de MDN. Nada hotlinkeado con copyright: el dueño reemplaza por sus
 *   fotos reales al importar (el banner de cobertura del Studio lo guía).
 */

const DEMO_VIDEO_CC0 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'; // CC0, demo del video en Stories

const DEMO_SLUGS = {
  restaurant: 'demo-restaurante',
  heladeria: 'demo-heladeria',
  perfumery: 'demo-perfumeria',
  events: 'demo-evento'
};

const DEMO_TYPES = Object.keys(DEMO_SLUGS);
const SLUG_TO_TYPE = Object.fromEntries(
  Object.entries(DEMO_SLUGS).map(([type, slug]) => [slug, type])
);

function baseDemo(overrides) {
  return {
    id: 'demo_' + overrides.slug.replace(/[^a-z0-9]/g, '_'),
    userId: 'demo-owner',
    currency: '$',
    phone: '59899000111',
    city: 'Montevideo',
    smartWeatherEnabled: false,
    themeFont: 'serif',
    layout: 'classic',
    bannerUrl: null,
    logoUrl: null,
    instagram: '',
    facebook: '',
    tiktok: '',
    x: '',
    googleReview: '',
    allowReservations: true,
    allowCoupons: true,
    allowBillSplitter: false,
    allowLoyaltyPoints: false,
    allowOnlinePayment: false,
    paymentLink: '',
    announcement: '✨ Esta es una demo navegable — mirá la carta como la vería un comensal.',
    deliveryZones: [],
    branches: [],
    modifierGroups: [],
    isDemo: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function demoRestaurant() {
  return baseDemo({
    slug: DEMO_SLUGS.restaurant,
    name: 'La Trattoria del Puerto',
    bizName: 'La Trattoria del Puerto',
    slogan: 'Pasta fresca, horno de leña y vinos de la casa',
    businessType: 'restaurant',
    allowIceCreamWizard: false,
    allowPerfumery: false,
    theme: 'emerald',
    phone: '59899000111',
    bannerUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5b/Japanese-style_spaghetti_in_Shirokane.jpg/500px-Japanese-style_spaghetti_in_Shirokane.jpg',
    logoUrl: null,
    scheduleActiveHours: '12:00-23:30',
    tableCount: 12,
    wifi: { ssid: 'Trattoria_Free', password: 'pasta2026' },
    deliveryZones: [
      { id: 'dz_centro', name: 'Centro', fee: 80 },
      { id: 'dz_pocitos', name: 'Pocitos', fee: 120 }
    ],
    categories: [
      { id: 'cat_entradas', name: 'Entradas' },
      { id: 'cat_principales', name: 'Principales' },
      { id: 'cat_postres', name: 'Postres' },
      { id: 'cat_bebidas', name: 'Bebidas' }
    ],
    dishes: [
      { id: 'dish_bruschetta', categoryId: 'cat_entradas', name: 'Bruschetta de la casa', description: 'Pan de masa madre, tomate confitado, albahaca y oliva', price: 320, tags: ['veggie'], is_chef_recommended: true, photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/Bruschetta.jpg/500px-Bruschetta.jpg' },
      { id: 'dish_rabas', categoryId: 'cat_entradas', name: 'Rabas del puerto', description: 'Calamares crocantes con limón y tártara artesanal', price: 580, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/81/Lemon_Pepper_Squid_%40_Waterloo_Station_Hotel%2C_Paralowie_20241127-122908.jpg/500px-Lemon_Pepper_Squid_%40_Waterloo_Station_Hotel%2C_Paralowie_20241127-122908.jpg' },
      { id: 'dish_milanga', categoryId: 'cat_principales', name: 'Milanesa napolitana clásica', description: 'Lomo empanado, salsa casera, jamón y muzzarella con fritas', price: 540, tags: ['star'], is_chef_recommended: true, photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b3/Pork_Schnitzel_With_Chips_%26_Gravy_%40_Cafe_De_Vili%27s_Elizabeth_-_RV90.jpg/500px-Pork_Schnitzel_With_Chips_%26_Gravy_%40_Cafe_De_Vili%27s_Elizabeth_-_RV90.jpg' },
      { id: 'dish_sorrentinos', categoryId: 'cat_principales', name: 'Sorrentinos de jamón y queso', description: 'Pasta fresca con salsa pomodoro y parmesano', price: 490, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/Ravioli_di_Faraona.JPG/500px-Ravioli_di_Faraona.JPG' },
      { id: 'dish_salmon', categoryId: 'cat_principales', name: 'Salmón a la manteca de hierbas', description: 'Filet a la plancha con puré rústico de calabaza', price: 790, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f1/Grilled_plated_salmon_fillet.jpg/500px-Grilled_plated_salmon_fillet.jpg' },
      { id: 'dish_flan', categoryId: 'cat_postres', name: 'Flan casero con dulce de leche', description: 'Receta tradicional con crema batida', price: 260, tags: ['star'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c9/Leche_flan_%28Philippines%29_01.jpg/500px-Leche_flan_%28Philippines%29_01.jpg' },
      { id: 'dish_volcan', categoryId: 'cat_postres', name: 'Volcán de chocolate', description: 'Bizcocho tibio con corazón fundente y helado de vainilla', price: 320, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e2/Vegan_chocolate_cake_with_sliced_strawberries.jpg/500px-Vegan_chocolate_cake_with_sliced_strawberries.jpg', videoUrl: DEMO_VIDEO_CC0 },
      { id: 'dish_limonada', categoryId: 'cat_bebidas', name: 'Limonada con menta y jengibre', description: 'Exprimido natural con miel', price: 180, tags: ['veggie'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Lemonade_pitcher_and_glass.jpg/500px-Lemonade_pitcher_and_glass.jpg' },
      { id: 'dish_ipa', categoryId: 'cat_bebidas', name: 'IPA artesanal (pinta)', description: 'Lúpulo aromático, amargor balanceado', price: 240, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bc/Glass_of_Marmotte_Ambr%C3%A9e_beer%2C_Saint-Gervais-les-Bains%2C_2025.jpg/500px-Glass_of_Marmotte_Ambr%C3%A9e_beer%2C_Saint-Gervais-les-Bains%2C_2025.jpg' }
    ]
  });
}

function demoHeladeria() {
  return baseDemo({
    slug: DEMO_SLUGS.heladeria,
    name: 'Heladería Frescura',
    bizName: 'Heladería Frescura',
    slogan: 'Armá tu helado a medida: elegí tamaño, sabores y toppings',
    businessType: 'heladeria',
    allowIceCreamWizard: true,
    allowPerfumery: false,
    theme: 'helado-fiesta',
    layout: 'classic',
    bannerUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/Gelato_ice_cream.jpg/500px-Gelato_ice_cream.jpg',
    logoUrl: null,
    iceCreamBuilderLabel: 'Armá tu helado a medida',
    iceCreamButtonStyle: 'fiesta',
    iceCreamContainers: [
      { id: 'demo_cont_cucurucho', name: 'Cucurucho Artesanal', capacityLabel: 'Hasta 2 sabores', maxFlavors: 2, price: 220, icon: '🍦', badge: 'Crocante' },
      { id: 'demo_cont_pote', name: 'Pote 1/4 Kg', capacityLabel: 'Hasta 2 sabores', maxFlavors: 2, price: 310, icon: '🥣', badge: 'Individual' },
      { id: 'demo_cont_familiar', name: 'Pote 1 Kg', capacityLabel: 'Hasta 4 sabores', maxFlavors: 4, price: 890, icon: '🍧', badge: 'Familiar' }
    ],
    iceCreamToppings: [
      { id: 'demo_top_oreo', name: 'Galletitas Oreo trituradas', price: 50, icon: '🍪', kind: 'topping' },
      { id: 'demo_top_chips', name: 'Chips de chocolate semiamargo', price: 40, icon: '🍫', kind: 'topping' },
      { id: 'demo_top_ddl', name: 'Salsa tibia de dulce de leche', price: 50, icon: '🍮', kind: 'salsa' },
      { id: 'demo_top_frutos', name: 'Salsa de frutos rojos', price: 50, icon: '🍓', kind: 'salsa' }
    ],
    phone: '59899000222',
    wifi: { ssid: 'Frescura_Free', password: 'helado2026' },
    categories: [
      { id: 'cat_choco', name: 'Chocolates' },
      { id: 'cat_ddl', name: 'Dulces de Leche' },
      { id: 'cat_cremas', name: 'Cremas Especiales' },
      { id: 'cat_frutales', name: 'Frutales al Agua' },
      { id: 'cat_bebidas_frias', name: 'Bebidas Heladas' }
    ],
    dishes: [
      { id: 'dish_choc_amargo', categoryId: 'cat_choco', name: 'Chocolate Amargo 70%', description: 'Cacao puro ecuatoriano, intenso y tostado', price: 320, tags: ['star'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/10/Righteously_Raw_chocolate.jpg/500px-Righteously_Raw_chocolate.jpg' },
      { id: 'dish_choc_marroc', categoryId: 'cat_choco', name: 'Chocolate Marroc Praliné', description: 'Chocolate con leche y praliné suave de maní', price: 350, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/00/Dark_chocolate_chip_ice_cream_cone_-_August_2025_-_Sarah_Stierch.jpg/500px-Dark_chocolate_chip_ice_cream_cone_-_August_2025_-_Sarah_Stierch.jpg' },
      { id: 'dish_ddl_tradi', categoryId: 'cat_ddl', name: 'Dulce de Leche Tradicional', description: 'Leche de campo, cocción lenta rioplatense', price: 310, tags: ['star'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Condensed_milk_hard_waffles.jpg/500px-Condensed_milk_hard_waffles.jpg' },
      { id: 'dish_ddl_granizado', categoryId: 'cat_ddl', name: 'Dulce de Leche Granizado', description: 'Con escamas crujientes de chocolate amargo', price: 320, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a6/Apple_cake_with_vanilla_ice_cream_2.jpg/500px-Apple_cake_with_vanilla_ice_cream_2.jpg' },
      { id: 'dish_tramontana', categoryId: 'cat_cremas', name: 'Tramontana Clásica', description: 'Crema americana con dulce de leche y crocante', price: 330, tags: ['star'], photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ae/StrawberrySundae.jpg', videoUrl: DEMO_VIDEO_CC0 },
      { id: 'dish_pistacho', categoryId: 'cat_cremas', name: 'Pistacho Siciliano', description: 'Pistachos tostados con pizca de sal marina', price: 380, tags: ['star'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2c/Salty_Snack_%28Unsplash%29.jpg/500px-Salty_Snack_%28Unsplash%29.jpg' },
      { id: 'dish_maracuya', categoryId: 'cat_frutales', name: 'Maracuyá Tropical', description: 'Pulpa de maracuyá con acidez exótica natural', price: 310, tags: ['vegan'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/35/Passion_fruit_lime_lemon_tea.jpg/500px-Passion_fruit_lime_lemon_tea.jpg' },
      { id: 'dish_limon', categoryId: 'cat_frutales', name: 'Limón Silvestre Natural', description: '100% zumo recién exprimido, liviano', price: 290, tags: ['vegan'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3a/Lemonade_and_teacup.jpg/500px-Lemonade_and_teacup.jpg' },
      { id: 'dish_milkshake', categoryId: 'cat_bebidas_frias', name: 'Milkshake de dulce de leche', description: 'Batido cremoso para tomar (no es un sabor)', price: 350, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/Strawberry_milk_shake_%28cropped%29.jpg/500px-Strawberry_milk_shake_%28cropped%29.jpg' }
    ]
  });
}

function demoPerfumery() {
  return baseDemo({
    slug: DEMO_SLUGS.perfumery,
    name: 'Casa Aromas',
    bizName: 'Casa Aromas',
    slogan: 'Fragancias de autor: descubrí tu pirámide olfativa',
    businessType: 'perfumery',
    allowIceCreamWizard: false,
    allowPerfumery: true,
    theme: 'terracotta',
    phone: '59899000333',
    bannerUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Museo%20del%20Perfume%20de%20Barcelona.JPG?width=1200',
    logoUrl: null,
    wifi: { ssid: '', password: '' },
    categories: [
      { id: 'cat_citricos', name: 'Cítricos Frescos' },
      { id: 'cat_florales', name: 'Florales' },
      { id: 'cat_amaderados', name: 'Amaderados' },
      { id: 'cat_orientales', name: 'Orientales de Nicho' }
    ],
    dishes: [
      { id: 'dish_aqua', categoryId: 'cat_citricos', name: 'Aqua Riviera Mandarine (EDT)', description: 'Salida: Mandarina Sicilia • Corazón: Neroli • Fondo: Vetiver', price: 1750, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/37/Patent_drawing_for_a_bottle_for_%27Sleeping%27_perfume_by_Elsa_Schiaparelli%2C_1939._USD116055_crop_01.png/500px-Patent_drawing_for_a_bottle_for_%27Sleeping%27_perfume_by_Elsa_Schiaparelli%2C_1939._USD116055_crop_01.png' },
      { id: 'dish_fleur', categoryId: 'cat_florales', name: 'Fleur Blanche de Soie (EDP)', description: 'Salida: Pera Nashi • Corazón: Jazmín Sambac • Fondo: Cachemira', price: 1950, tags: ['star'], is_chef_recommended: true, photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f0/Clear_Glass_Tube_Shaped_Perfume_Bottle_With_Flower_Design_and_to_stopper.jpg/500px-Clear_Glass_Tube_Shaped_Perfume_Bottle_With_Flower_Design_and_to_stopper.jpg' },
      { id: 'dish_santal', categoryId: 'cat_amaderados', name: 'Santal Majestueux (EDP)', description: 'Salida: Cardamomo • Corazón: Iris • Fondo: Sándalo Australiano', price: 2400, tags: ['star'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6c/Cologne_Bottle%2C_1893.png/500px-Cologne_Bottle%2C_1893.png' },
      { id: 'dish_ambre', categoryId: 'cat_orientales', name: 'Ambre Nuit Nocturne (EDP)', description: 'Salida: Bergamota • Corazón: Rosa Damascena • Fondo: Ámbar Gris', price: 2200, tags: ['star'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e9/Ambre_bleu_dominicain_21207.jpg/500px-Ambre_bleu_dominicain_21207.jpg' },
      { id: 'dish_vanille', categoryId: 'cat_orientales', name: 'Vanille Noire & Praliné (Body Splash)', description: 'Salida: Almendra • Corazón: Toffee • Fondo: Vainilla Bourbon', price: 1250, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6c/Saturnus_vaniljessens.jpg/500px-Saturnus_vaniljessens.jpg' }
    ]
  });
}

function demoEvent() {
  return baseDemo({
    slug: DEMO_SLUGS.events,
    name: 'Boda Martina & Santi',
    bizName: 'Boda Martina & Santi',
    slogan: 'Celebrá con nosotros: programa, menú e invitados en un solo QR',
    businessType: 'events',
    allowIceCreamWizard: false,
    allowPerfumery: false,
    theme: 'theme-wedding',
    layout: 'modern',
    phone: '59899000444',
    bannerUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d7/Wedding_Supper_-_Martin_van_Meytens_-_Google_Cultural_Institute.jpg/500px-Wedding_Supper_-_Martin_van_Meytens_-_Google_Cultural_Institute.jpg',
    logoUrl: null,
    eventDate: '2027-12-12T20:00:00.000Z',
    expiresAt: '2027-12-13T06:00:00.000Z',
    weddingItinerary: {
      enabled: true,
      title: 'Programa de la fiesta',
      coupleNames: 'Martina & Santi',
      date: '12 de diciembre de 2027',
      eventDay: '2027-12-12',
      venue: 'Estancia La Ribera — Canelones',
      items: [
        { time: '20:00', title: 'Recepción y welcome drink', icon: '🥂' },
        { time: '21:00', title: 'Ceremonia', icon: '💍' },
        { time: '22:00', title: 'Cena', icon: '🍽️' },
        { time: '23:30', title: 'Vals y apertura de pista', icon: '💃' },
        { time: '02:00', title: 'Mesa dulce y cierre', icon: '🎂' }
      ]
    },
    categories: [
      { id: 'cat_menu_fiesta', name: 'Menú de la Fiesta' },
      { id: 'cat_bebidas_evento', name: 'Bebidas' }
    ],
    dishes: [
      { id: 'dish_recepcion', categoryId: 'cat_menu_fiesta', name: 'Recepción: bocados fríos y calientes', description: 'Selección del chef para el cocktail de bienvenida', price: 0, tags: ['star'], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/37/WikiCon_2026_Wellington_evening_nibbles_PA01.jpg/500px-WikiCon_2026_Wellington_evening_nibbles_PA01.jpg' },
      { id: 'dish_plato', categoryId: 'cat_menu_fiesta', name: 'Plato principal: lomo al malbec', description: 'Con papas rústicas y vegetales de estación', price: 0, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/40/Vegetable_biryani_with_beef_roast.jpg/500px-Vegetable_biryani_with_beef_roast.jpg' },
      { id: 'dish_mesa_dulce', categoryId: 'cat_menu_fiesta', name: 'Mesa dulce', description: 'Mini postres, torta de bodas y café', price: 0, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cc/Wedding_cake_%28undecorated%29.JPG/500px-Wedding_cake_%28undecorated%29.JPG' },
      { id: 'dish_espumante', categoryId: 'cat_bebidas_evento', name: 'Espumante para el brindis', description: 'Copa de bienvenida incluida', price: 0, tags: [], photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/Champagne_glasses_used_by_President_Ford.JPG/500px-Champagne_glasses_used_by_President_Ford.JPG' }
    ]
  });
}

const BUILDERS = {
  restaurant: demoRestaurant,
  heladeria: demoHeladeria,
  perfumery: demoPerfumery,
  events: demoEvent
};

function normalizeDemoType(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (BUILDERS[raw]) return raw;
  if (raw === 'perfumeria') return 'perfumery';
  if (raw === 'evento' || raw === 'boda' || raw === 'wedding') return 'events';
  if (raw === 'heladería') return 'heladeria';
  if (SLUG_TO_TYPE[raw]) return SLUG_TO_TYPE[raw];
  return null;
}

/**
 * Devuelve una copia fresca de la demo (para que el caller nunca mutee el
 * catálogo). Acepta tipo ('heladeria') o slug ('demo-heladeria').
 */
function getDemoRestaurant(typeOrSlug) {
  const type = normalizeDemoType(typeOrSlug);
  if (!type) return null;
  return BUILDERS[type]();
}

function isDemoSlug(slug) {
  return Boolean(normalizeDemoType(slug));
}

function listDemoRestaurants() {
  return [
    { type: 'restaurant', slug: DEMO_SLUGS.restaurant, name: 'La Trattoria del Puerto', emoji: '🍽️', tagline: 'Restaurante clásico: entradas, principales, postres y delivery por zonas.' },
    { type: 'heladeria', slug: DEMO_SLUGS.heladeria, name: 'Heladería Frescura', emoji: '🍦', tagline: 'Heladería con armador a medida: tamaños, sabores y toppings.' },
    { type: 'perfumery', slug: DEMO_SLUGS.perfumery, name: 'Casa Aromas', emoji: '🌸', tagline: 'Perfumería con pirámide olfativa y cotización por fragancia.' },
    { type: 'events', slug: DEMO_SLUGS.events, name: 'Boda Martina & Santi', emoji: '🎉', tagline: 'Evento con itinerario en vivo, programa y menú de fiesta.' }
  ];
}

module.exports = {
  DEMO_SLUGS,
  DEMO_TYPES,
  getDemoRestaurant,
  isDemoSlug,
  listDemoRestaurants,
  normalizeDemoType
};
