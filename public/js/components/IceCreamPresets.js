/**
 * IceCreamPresets.js
 * Catálogo estático (Mock) de más de 30 sabores clásicos y artesanales de heladería
 * con categorías, descripción, tags y precio sugerido.
 * Respeta la estructura de tipos Dish de api/types/index.d.ts.
 */

export const ICE_CREAM_PRESETS = [
  // --- CHOCOLATES ---
  {
    id: 'sabor_choco_amargo',
    categoryId: 'helados_chocolates',
    categoryName: 'Chocolates',
    name: 'Chocolate Amargo 70%',
    price: 320,
    description: 'Cacao puro de origen ecuatoriano al 70%, intenso, profundo y con notas tostadas.',
    tags: ['star', 'celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_choco_almendras',
    categoryId: 'helados_chocolates',
    categoryName: 'Chocolates',
    name: 'Chocolate con Almendras Tostadas',
    price: 330,
    description: 'Cremoso chocolate con leche cargado de almendras tostadas al punto justo.',
    tags: ['celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_choco_suizo',
    categoryId: 'helados_chocolates',
    categoryName: 'Chocolates',
    name: 'Chocolate Suizo con Dulce de Leche',
    price: 340,
    description: 'Chocolate semiamargo veteado con dulce de leche natural y trocitos de chocolate crocante.',
    tags: ['star'],
    outOfStock: false
  },
  {
    id: 'sabor_choco_blanco',
    categoryId: 'helados_chocolates',
    categoryName: 'Chocolates',
    name: 'Chocolate Blanco Patagónico',
    price: 320,
    description: 'Crema pura de manteca de cacao con lluvia de crocante de avellanas y chocolate blanco.',
    tags: ['celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_chocotorta',
    categoryId: 'helados_chocolates',
    categoryName: 'Chocolates',
    name: 'Chocotorta Helada Especial',
    price: 350,
    description: 'Fiel réplica con galletitas de chocolate embebidas en café y crema de queso con dulce de leche.',
    tags: ['star'],
    outOfStock: false
  },
  {
    id: 'sabor_mousse_chocolate',
    categoryId: 'helados_chocolates',
    categoryName: 'Chocolates',
    name: 'Mousse de Chocolate Aireado',
    price: 320,
    description: 'Textura extra ligera y esponjosa de chocolate con granizado de finas hebras de cacao.',
    tags: ['celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_choco_marroc',
    categoryId: 'helados_chocolates',
    categoryName: 'Chocolates',
    name: 'Chocolate Marroc Praliné',
    price: 350,
    description: 'Combinación artesanal de chocolate con leche y pasta suave de maní tostado estilo bombón.',
    tags: [],
    outOfStock: false
  },

  // --- DULCES DE LECHE ---
  {
    id: 'sabor_ddl_clasico',
    categoryId: 'helados_dulce_de_leche',
    categoryName: 'Dulces de Leche',
    name: 'Dulce de Leche Tradicional Rioplatense',
    price: 310,
    description: 'La receta madre con leche de campo y cocción lenta, súper cremoso y caramelizado.',
    tags: ['star', 'celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_ddl_granizado',
    categoryId: 'helados_dulce_de_leche',
    categoryName: 'Dulces de Leche',
    name: 'Dulce de Leche Granizado',
    price: 320,
    description: 'Cremoso dulce de leche con abundantes escamas crujientes de chocolate semiamargo.',
    tags: ['celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_ddl_tentacion',
    categoryId: 'helados_dulce_de_leche',
    categoryName: 'Dulces de Leche',
    name: 'Dulce de Leche Tentación',
    price: 340,
    description: 'Base de dulce de leche con generoso veteado de dulce de leche repostero repostero puro.',
    tags: ['star', 'celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_ddl_brownie',
    categoryId: 'helados_dulce_de_leche',
    categoryName: 'Dulces de Leche',
    name: 'Dulce de Leche con Brownie & Nuez',
    price: 350,
    description: 'Con tropezones húmedos de brownie de chocolate casero y nueces pecan seleccionadas.',
    tags: ['star'],
    outOfStock: false
  },
  {
    id: 'sabor_ddl_bombon',
    categoryId: 'helados_dulce_de_leche',
    categoryName: 'Dulces de Leche',
    name: 'Dulce de Leche Bombón',
    price: 340,
    description: 'Veteado con pasta de avellanas crocantes y bocaditos de dulce de leche bañados.',
    tags: [],
    outOfStock: false
  },
  {
    id: 'sabor_ddl_alfajor',
    categoryId: 'helados_dulce_de_leche',
    categoryName: 'Dulces de Leche',
    name: 'Dulce de Leche Alfajor Marplatense',
    price: 350,
    description: 'Con trocitos de masa especiada de alfajor artesanal bañado en cacao fino.',
    tags: [],
    outOfStock: false
  },

  // --- CREMAS ARTESANALES ---
  {
    id: 'sabor_crema_americana',
    categoryId: 'helados_cremas',
    categoryName: 'Cremas',
    name: 'Crema Americana (Vainilla Bourbon)',
    price: 300,
    description: 'Crema de leche pura batida infusionada con chaucha de vainilla natural.',
    tags: ['celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_tramontana',
    categoryId: 'helados_cremas',
    categoryName: 'Cremas',
    name: 'Tramontana Clásica',
    price: 330,
    description: 'Crema americana con dulce de leche natural y micro galletitas crocantes de chocolate.',
    tags: ['star'],
    outOfStock: false
  },
  {
    id: 'sabor_mascarpone_frutos',
    categoryId: 'helados_cremas',
    categoryName: 'Cremas',
    name: 'Mascarpone con Frutos del Bosque',
    price: 350,
    description: 'Queso mascarpone fresco con una reducción casera de frambuesas, moras y arándanos silvestres.',
    tags: ['star', 'celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_sambayon',
    categoryId: 'helados_cremas',
    categoryName: 'Cremas',
    name: 'Sambayón al Oporto y Marsala',
    price: 340,
    description: 'Yemas de huevo batidas al baño maría con vino Oporto añejado y almendras tostadas.',
    tags: ['celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_banana_split',
    categoryId: 'helados_cremas',
    categoryName: 'Cremas',
    name: 'Banana Split Criolla',
    price: 330,
    description: 'Crema elaborada con bananas frescas maduras, veteado de dulce de leche y chocolate picado.',
    tags: ['celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_frutilla_crema',
    categoryId: 'helados_cremas',
    categoryName: 'Cremas',
    name: 'Frutilla a la Crema de Campo',
    price: 310,
    description: 'Frutillas frescas seleccionadas procesadas con crema de leche fresca pasteurizada.',
    tags: ['celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_crema_rusa',
    categoryId: 'helados_cremas',
    categoryName: 'Cremas',
    name: 'Crema Rusa con Nueces Mariposa',
    price: 340,
    description: 'Suave crema aromatizada con esencia de nuez y abundantes mitades de nueces frescas.',
    tags: ['celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_menta_granizada',
    categoryId: 'helados_cremas',
    categoryName: 'Cremas',
    name: 'Menta Granizada Silvestre',
    price: 310,
    description: 'Crema refrescante de menta natural con abundante granizado de chocolate amargo crocante.',
    tags: ['celiac'],
    outOfStock: false
  },

  // --- FRUTALES AL AGUA (VEGANOS & LIVIANOS) ---
  {
    id: 'sabor_limon_menta',
    categoryId: 'helados_frutales',
    categoryName: 'Frutales',
    name: 'Limón Silvestre con Albahaca o Menta',
    price: 290,
    description: '100% zumo natural de limones recién exprimidos con toque aromático refrescante.',
    tags: ['vegano', 'celiac', 'veggie'],
    outOfStock: false
  },
  {
    id: 'sabor_frutilla_agua',
    categoryId: 'helados_frutales',
    categoryName: 'Frutales',
    name: 'Frutilla Natural al Agua',
    price: 290,
    description: 'Frutillas maduras procesadas al momento con almíbar liviano. Fruta pura sin aditivos.',
    tags: ['vegano', 'celiac', 'veggie'],
    outOfStock: false
  },
  {
    id: 'sabor_maracuya',
    categoryId: 'helados_frutales',
    categoryName: 'Frutales',
    name: 'Maracuyá Tropical con Semillitas',
    price: 310,
    description: 'Pulpa exótica de fruta de la pasión con su acidez característica y semillitas crujientes.',
    tags: ['star', 'vegano', 'celiac', 'veggie'],
    outOfStock: false
  },
  {
    id: 'sabor_frambuesa_patagonica',
    categoryId: 'helados_frutales',
    categoryName: 'Frutales',
    name: 'Frambuesa Patagónica al Agua',
    price: 320,
    description: 'Frambuesas enteras del sur con un balance exquisito de dulzor y acidez.',
    tags: ['vegano', 'celiac', 'veggie'],
    outOfStock: false
  },
  {
    id: 'sabor_mango_naranja',
    categoryId: 'helados_frutales',
    categoryName: 'Frutales',
    name: 'Mango & Naranja Jugosa',
    price: 310,
    description: 'Sorbet aterciopelado de mango Tommy Atkins con jugo recién exprimido de naranjas.',
    tags: ['vegano', 'celiac', 'veggie'],
    outOfStock: false
  },
  {
    id: 'sabor_arandanos',
    categoryId: 'helados_frutales',
    categoryName: 'Frutales',
    name: 'Arándanos & Moras del Bosque',
    price: 310,
    description: 'Frutos morados repletos de antioxidantes en un sorbete intenso y refrescante.',
    tags: ['vegano', 'celiac', 'veggie'],
    outOfStock: false
  },

  // --- ESPECIALES DE LA CASA (GOURMET) ---
  {
    id: 'sabor_pistacho',
    categoryId: 'helados_especiales',
    categoryName: 'Especiales',
    name: 'Pistacho Siciliano 100% Puro',
    price: 380,
    description: 'Elaborado exclusivamente con pistachos tostados de Bronte (Italia) y sal marina.',
    tags: ['star', 'celiac'],
    outOfStock: false
  },
  {
    id: 'sabor_kinder',
    categoryId: 'helados_especiales',
    categoryName: 'Especiales',
    name: 'Kinder Bueno Blanco & Avellanas',
    price: 360,
    description: 'Crema con pasta pura de avellanas, oblea crocante y crema de leche chocolatada.',
    tags: ['star'],
    outOfStock: false
  },
  {
    id: 'sabor_tiramisu',
    categoryId: 'helados_especiales',
    categoryName: 'Especiales',
    name: 'Tiramisú con Bizcocho al Espresso',
    price: 350,
    description: 'Queso mascarpone, vainillas bañadas en café espresso recién tostado y cacao amargo.',
    tags: ['star'],
    outOfStock: false
  },
  {
    id: 'sabor_cheesecake',
    categoryId: 'helados_especiales',
    categoryName: 'Especiales',
    name: 'Cheesecake de Frutos Rojos',
    price: 350,
    description: 'Queso crema estilo New York con base crocante de galletitas Graham y salsa de frutos rojos.',
    tags: [],
    outOfStock: false
  },
  {
    id: 'sabor_nutella_crunch',
    categoryId: 'helados_especiales',
    categoryName: 'Especiales',
    name: 'Nutella Gianduia Crunch',
    price: 360,
    description: 'Chocolate con avellanas y pasta pura de cacao con praliné crujiente de almendras.',
    tags: ['star'],
    outOfStock: false
  },
  {
    id: 'sabor_crema_flan',
    categoryId: 'helados_especiales',
    categoryName: 'Especiales',
    name: 'Crema Flan con Caramelo y DDL',
    price: 330,
    description: 'Sabor casero a flan de yemas con abundante caramelo líquido y dulce de leche de tambo.',
    tags: ['celiac'],
    outOfStock: false
  }
];

export const ICE_CREAM_CONTAINERS = [
  {
    id: 'container_1kg',
    name: 'Pote 1 Kilogramo',
    capacityLabel: 'Hasta 4 sabores',
    maxFlavors: 4,
    price: 890,
    icon: '🍧',
    badge: 'Familiar'
  },
  {
    id: 'container_halfkg',
    name: 'Pote 1/2 Kilogramo',
    capacityLabel: 'Hasta 3 sabores',
    maxFlavors: 3,
    price: 520,
    icon: '🍨',
    badge: 'Para compartir'
  },
  {
    id: 'container_quarterkg',
    name: 'Pote 1/4 Kilogramo',
    capacityLabel: 'Hasta 2 sabores',
    maxFlavors: 2,
    price: 310,
    icon: '🥣',
    badge: 'Individual'
  },
  {
    id: 'container_pinta',
    name: 'Pinta Térmica (500 ml)',
    capacityLabel: 'Hasta 3 sabores',
    maxFlavors: 3,
    price: 480,
    icon: '🥤',
    badge: 'Gourmet'
  },
  {
    id: 'container_cucurucho',
    name: 'Cucurucho Artesanal Especial',
    capacityLabel: 'Hasta 2 sabores',
    maxFlavors: 2,
    price: 220,
    icon: '🍦',
    badge: 'Crocante'
  },
  {
    id: 'container_barquillo',
    name: 'Barquillo Simple',
    capacityLabel: '1 sabor',
    maxFlavors: 1,
    price: 150,
    icon: '🧇',
    badge: 'Al paso'
  }
];

export const ICE_CREAM_TOPPINGS = [
  { id: 'top_almendras', name: 'Almendras caramelizadas', price: 60, icon: '🌰' },
  { id: 'top_mani', name: 'Crocante de maní tostado', price: 30, icon: '🥜' },
  { id: 'top_chips', name: 'Chips de chocolate semiamargo', price: 40, icon: '🍫' },
  { id: 'top_oreo', name: 'Galletitas Oreo trituradas', price: 50, icon: '🍪' },
  { id: 'top_rocklets', name: 'Confites de chocolate tipo Rocklets', price: 40, icon: '🍬' },
  { id: 'top_bano_choco', name: 'Baño de repostería crocante', price: 60, icon: '✨' },
  { id: 'salsa_choco', name: 'Salsa tibia de chocolate', price: 50, icon: '🍯' },
  { id: 'salsa_frutos', name: 'Salsa de frutos rojos silvestres', price: 50, icon: '🍓' },
  { id: 'salsa_ddl', name: 'Salsa tibia de dulce de leche', price: 50, icon: '🍮' }
];
