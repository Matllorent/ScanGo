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
 */

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
    announcement: '✨ Esta es una demo navegable — podés editarla en el Studio sin registrarte.',
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
      { id: 'dish_bruschetta', categoryId: 'cat_entradas', name: 'Bruschetta de la casa', description: 'Pan de masa madre, tomate confitado, albahaca y oliva', price: 320, tags: ['veggie'], is_chef_recommended: true },
      { id: 'dish_rabas', categoryId: 'cat_entradas', name: 'Rabas del puerto', description: 'Calamares crocantes con limón y tártara artesanal', price: 580, tags: [] },
      { id: 'dish_milanga', categoryId: 'cat_principales', name: 'Milanesa napolitana clásica', description: 'Lomo empanado, salsa casera, jamón y muzzarella con fritas', price: 540, tags: ['star'], is_chef_recommended: true },
      { id: 'dish_sorrentinos', categoryId: 'cat_principales', name: 'Sorrentinos de jamón y queso', description: 'Pasta fresca con salsa pomodoro y parmesano', price: 490, tags: [] },
      { id: 'dish_salmon', categoryId: 'cat_principales', name: 'Salmón a la manteca de hierbas', description: 'Filet a la plancha con puré rústico de calabaza', price: 790, tags: [] },
      { id: 'dish_flan', categoryId: 'cat_postres', name: 'Flan casero con dulce de leche', description: 'Receta tradicional con crema batida', price: 260, tags: ['star'] },
      { id: 'dish_volcan', categoryId: 'cat_postres', name: 'Volcán de chocolate', description: 'Bizcocho tibio con corazón fundente y helado de vainilla', price: 320, tags: [] },
      { id: 'dish_limonada', categoryId: 'cat_bebidas', name: 'Limonada con menta y jengibre', description: 'Exprimido natural con miel', price: 180, tags: ['veggie'] },
      { id: 'dish_ipa', categoryId: 'cat_bebidas', name: 'IPA artesanal (pinta)', description: 'Lúpulo aromático, amargor balanceado', price: 240, tags: [] }
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
    layout: 'modern',
    iceCreamBuilderLabel: 'Armá tu helado a medida',
    iceCreamButtonStyle: 'fiesta',
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
      { id: 'dish_choc_amargo', categoryId: 'cat_choco', name: 'Chocolate Amargo 70%', description: 'Cacao puro ecuatoriano, intenso y tostado', price: 320, tags: ['star'] },
      { id: 'dish_choc_marroc', categoryId: 'cat_choco', name: 'Chocolate Marroc Praliné', description: 'Chocolate con leche y praliné suave de maní', price: 350, tags: [] },
      { id: 'dish_ddl_tradi', categoryId: 'cat_ddl', name: 'Dulce de Leche Tradicional', description: 'Leche de campo, cocción lenta rioplatense', price: 310, tags: ['star'] },
      { id: 'dish_ddl_granizado', categoryId: 'cat_ddl', name: 'Dulce de Leche Granizado', description: 'Con escamas crujientes de chocolate amargo', price: 320, tags: [] },
      { id: 'dish_tramontana', categoryId: 'cat_cremas', name: 'Tramontana Clásica', description: 'Crema americana con dulce de leche y crocante', price: 330, tags: ['star'] },
      { id: 'dish_pistacho', categoryId: 'cat_cremas', name: 'Pistacho Siciliano', description: 'Pistachos tostados con pizca de sal marina', price: 380, tags: ['star'] },
      { id: 'dish_maracuya', categoryId: 'cat_frutales', name: 'Maracuyá Tropical', description: 'Pulpa de maracuyá con acidez exótica natural', price: 310, tags: ['vegan'] },
      { id: 'dish_limon', categoryId: 'cat_frutales', name: 'Limón Silvestre Natural', description: '100% zumo recién exprimido, liviano', price: 290, tags: ['vegan'] },
      { id: 'dish_milkshake', categoryId: 'cat_bebidas_frias', name: 'Milkshake de dulce de leche', description: 'Batido cremoso para tomar (no es un sabor)', price: 350, tags: [] }
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
    wifi: { ssid: '', password: '' },
    categories: [
      { id: 'cat_citricos', name: 'Cítricos Frescos' },
      { id: 'cat_florales', name: 'Florales' },
      { id: 'cat_amaderados', name: 'Amaderados' },
      { id: 'cat_orientales', name: 'Orientales de Nicho' }
    ],
    dishes: [
      { id: 'dish_aqua', categoryId: 'cat_citricos', name: 'Aqua Riviera Mandarine (EDT)', description: 'Salida: Mandarina Sicilia • Corazón: Neroli • Fondo: Vetiver', price: 1750, tags: [] },
      { id: 'dish_fleur', categoryId: 'cat_florales', name: 'Fleur Blanche de Soie (EDP)', description: 'Salida: Pera Nashi • Corazón: Jazmín Sambac • Fondo: Cachemira', price: 1950, tags: ['star'], is_chef_recommended: true },
      { id: 'dish_santal', categoryId: 'cat_amaderados', name: 'Santal Majestueux (EDP)', description: 'Salida: Cardamomo • Corazón: Iris • Fondo: Sándalo Australiano', price: 2400, tags: ['star'] },
      { id: 'dish_ambre', categoryId: 'cat_orientales', name: 'Ambre Nuit Nocturne (EDP)', description: 'Salida: Bergamota • Corazón: Rosa Damascena • Fondo: Ámbar Gris', price: 2200, tags: ['star'] },
      { id: 'dish_vanille', categoryId: 'cat_orientales', name: 'Vanille Noire & Praliné (Body Splash)', description: 'Salida: Almendra • Corazón: Toffee • Fondo: Vainilla Bourbon', price: 1250, tags: [] }
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
      { id: 'dish_recepcion', categoryId: 'cat_menu_fiesta', name: 'Recepción: bocados fríos y calientes', description: 'Selección del chef para el cocktail de bienvenida', price: 0, tags: ['star'] },
      { id: 'dish_plato', categoryId: 'cat_menu_fiesta', name: 'Plato principal: lomo al malbec', description: 'Con papas rústicas y vegetales de estación', price: 0, tags: [] },
      { id: 'dish_mesa_dulce', categoryId: 'cat_menu_fiesta', name: 'Mesa dulce', description: 'Mini postres, torta de bodas y café', price: 0, tags: [] },
      { id: 'dish_espumante', categoryId: 'cat_bebidas_evento', name: 'Espumante para el brindis', description: 'Copa de bienvenida incluida', price: 0, tags: [] }
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
