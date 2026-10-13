/**
 * api/utils/seoSolutions.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor SEO/GEO de "soluciones por rubro" (función PURA, sin I/O).
 *
 * Convierte un catálogo declarativo de rubros en páginas server-rendered
 * pensadas para capturar búsquedas long-tail ("menú digital para heladerías",
 * "carta QR para eventos"…) y para que los motores de IA citen al producto:
 *
 *   - getAllSolutions()/getSolutionBySlug()  → acceso al catálogo
 *   - buildSolutionsIndexJsonLd(appUrl)     → CollectionPage + ItemList (hub)
 *   - buildSolutionJsonLd(solution, appUrl) → WebPage + BreadcrumbList + FAQPage
 *   - renderSolutionsIndexHtml({ appUrl })  → HTML del hub /soluciones
 *   - renderSolutionHtml(solution, {appUrl})→ HTML de una landing por rubro
 *
 * Reglas de diseño (no romper):
 *   - CERO scripts inline y CERO atributos on*= (la CSP tiene script-src-attr
 *     'none'); los CTA son links a `/?registro=1` (el landing abre el registro).
 *   - Todo dato se escapa antes de entrar al HTML; el JSON-LD pasa por un
 *     escape de `< > &` (equivalente a safeJsonLd del SSR).
 *   - Precios/planes NO se hardcodean acá: la copia enlaza a `/#precios` para
 *     que la única fuente de verdad siga siendo plans.json (cero drift).
 */

const DEFAULT_BASE_URL = 'https://scango.uy';
const SOLUTION_BASE_PATH = '/soluciones';
const TRIAL_DAYS = 7;

/**
 * Catálogo de rubros. `demoSlug` enlaza a un demo REAL (/m/demo-*) y todas las
 * features corresponden a funcionalidad ya existente del producto (ver
 * AGENTS.md). Editar acá = actualizar hub, landings, JSON-LD y sitemap a la vez.
 */
const SOLUTIONS = [
  {
    key: 'restaurant',
    slug: 'menu-digital-para-restaurantes',
    icon: '🍽️',
    businessType: 'restaurant',
    demoSlug: 'demo-restaurante',
    shortName: 'Restaurantes',
    title: 'Menú Digital QR para Restaurantes y Pedidos por WhatsApp | ScanGo',
    metaDescription:
      'Menú digital QR para restaurantes con pedidos por WhatsApp y 0% de comisiones. Actualizá precios al instante, sumá delivery por zonas y probá 7 días gratis.',
    h1: 'El menú digital QR que hace pedir a tus clientes por WhatsApp',
    eyebrow: 'Para restaurantes, bares y cafés',
    lead:
      'Tus clientes escanean el QR, ven la carta con fotos y arman el pedido; vos lo recibís por WhatsApp con el total listo. Sin comisiones por venta y con la carta siempre al día.',
    highlights: [
      '0% de comisiones sobre tus ventas',
      'Pedidos por WhatsApp con el total calculado',
      'Actualizaciones de precio en segundos, sin reimprimir',
      'Delivery por zonas, propina y pago online opcionales'
    ],
    pains: [
      {
        title: 'Las comisiones se comen tu margen',
        text: 'Los marketplaces de delivery cobran entre 20% y 30% por pedido. Acá pagás una suscripción fija y el 100% de la venta queda en tu caja.'
      },
      {
        title: 'La carta de papel queda vieja',
        text: 'Cambiar un precio obliga a reimprimir todo. En el Studio editás un plato o un precio en 10 segundos y el cambio aparece al instante en el menú.'
      },
      {
        title: 'El pedido llega desordenado',
        text: 'Con llamadas y chat suelto se pierden platos y se cobra mal. Acá el pedido llega numerado, con mesa o dirección, aclaraciones y monto total exacto.'
      }
    ],
    features: [
      {
        icon: '📱',
        title: 'Menú QR con fotos',
        text: 'Se abre en el navegador al instante, sin descargar ninguna app. Categorías, fotos, descripciones y filtros.'
      },
      {
        icon: '💬',
        title: 'Pedidos por WhatsApp',
        text: 'El comensal elige y el pedido te llega armado al WhatsApp del local, con el total calculado.'
      },
      {
        icon: '🤖',
        title: 'El Mozo Virtual',
        text: 'Sugiere complementos según lo que el cliente ya eligió (bebida, guarnición, postre) y sube el ticket promedio.'
      },
      {
        icon: '🛵',
        title: 'Delivery por zonas',
        text: 'Definís zonas y el envío se cotiza solo, sin que el cliente ni vos tengan que calcularlo a mano.'
      },
      {
        icon: '💳',
        title: 'Propina y pago online',
        text: 'Activás el pago online (Mercado Pago) y la propina del comensal cuando quieras; los dos son opcionales.'
      },
      {
        icon: '📊',
        title: 'Analítica del negocio',
        text: 'Ticket promedio, ingresos, platos más vendidos y horas pico para tomar decisiones con datos, no con intuición.'
      },
      {
        icon: '🏢',
        title: 'Varias sucursales',
        text: 'Cada sucursal tiene su propia página, su QR y sus precios, con descuento escalonado por sucursal.'
      },
      {
        icon: '⭐',
        title: 'Reseñas inteligentes',
        text: 'A los clientes contentos los guía a Google Maps; los comentarios a mejorar te llegan de forma privada.'
      }
    ],
    faqs: [
      {
        q: '¿ScanGo cobra comisión por cada pedido vendido?',
        a: 'No. ScanGo cobra solo la suscripción fija. El 100% de las ventas va directo a tu negocio, sea en efectivo, transferencia o por tu pasarela de pago.'
      },
      {
        q: '¿Mis clientes tienen que instalar una app?',
        a: 'No. Apuntan la cámara al código QR y la carta se abre en el navegador del teléfono en menos de un segundo.'
      },
      {
        q: '¿Puedo recibir pagos online?',
        a: 'Sí, es opcional. Podés activar el pago online del comensal con Mercado Pago y también sumar la propina desde el checkout.'
      },
      {
        q: '¿Cómo me llegan los pedidos?',
        a: 'Al WhatsApp del restaurante, armados y numerados: mesa o dirección de entrega, platos, aclaraciones, método de pago y total.'
      },
      {
        q: '¿Puedo tener más de un local?',
        a: 'Sí. Cargás cada sucursal con su dirección, teléfono y precios propios; el abono se calcula con descuento por cantidad de sucursales.'
      }
    ]
  },
  {
    key: 'heladeria',
    slug: 'menu-digital-para-heladerias',
    icon: '🍦',
    businessType: 'heladeria',
    demoSlug: 'demo-heladeria',
    shortName: 'Heladerías',
    title: 'Menú Digital para Heladerías: Armá tu Helado a Medida por QR | ScanGo',
    metaDescription:
      'Carta digital QR para heladerías con armador de helado a medida (tamaño, sabores y toppings), pedidos por WhatsApp y 0% de comisiones. Probá 7 días gratis.',
    h1: 'La carta QR para heladerías donde cada cliente arma su helado',
    eyebrow: 'Para heladerías, gelaterías y postres',
    lead:
      'Tus clientes eligen el tamaño, los sabores y los toppings con el total en vivo, y te mandan el pedido exacto por WhatsApp. Sin malentendidos y sin comisiones.',
    highlights: [
      'Armador de helado paso a paso (tamaño → sabores → toppings)',
      'Sabores tomados de tu propia carta, sin cargarlos dos veces',
      'Pedidos por WhatsApp con el combo exacto',
      '6 estéticas pensadas para heladerías'
    ],
    pains: [
      {
        title: 'Un helado a medida es imposible de tomar por chat',
        text: '“Dos bochas, una de dulce de leche y una de chocolate, con oreo”. El armador guía el pedido paso a paso y evita errores.'
      },
      {
        title: 'Cada temporada hay que rehacer la carta',
        text: 'Sumás sabores de verano o sacás los de invierno y la carta impresa queda vieja. En el Studio los activás o desactivás al instante.'
      },
      {
        title: 'El menú no alcanza para mostrar los combos',
        text: 'Fotos, descripciones y nombres de cada sabor hacen que el cliente elija más rápido y con más ganas.'
      }
    ],
    features: [
      {
        icon: '🍨',
        title: 'Armador de helado',
        text: 'Flujo de una sola vista: elige el tamaño y se despliegan sabores y toppings, con el resumen y el total siempre a la vista.'
      },
      {
        icon: '📋',
        title: 'Sabores desde tu carta',
        text: 'El catálogo de sabores se arma con tus propios platos y categorías; no hay que volver a escribir nada.'
      },
      {
        icon: '🎨',
        title: 'Estéticas de heladería',
        text: 'Seis temas (fiesta, menta, tropical, pastel, gelateria y cioccolato) para que la carta tenga el tono de tu marca.'
      },
      {
        icon: '💬',
        title: 'Pedidos por WhatsApp',
        text: 'El combo armado llega al WhatsApp del local tal cual lo eligió el cliente, con el total listo.'
      },
      {
        icon: '🏷️',
        title: 'Promos de temporada',
        text: 'Comunicás promos y novedades a tus clientes con consentimiento, directo por WhatsApp.'
      },
      {
        icon: '🚫',
        title: '0% de comisiones',
        text: 'Pagás una suscripción fija y todas las ventas del mostrador quedan para tu heladería.'
      }
    ],
    faqs: [
      {
        q: '¿Cómo se pide un helado a medida desde el menú?',
        a: 'El cliente abre el armador, elige el tamaño y se despliegan los sabores y los toppings. Ve el resumen y el total en vivo y confirma el pedido por WhatsApp.'
      },
      {
        q: '¿Tengo que cargar cada sabor a mano?',
        a: 'No. El armador deriva los sabores de tu propia carta (platos y categorías); una heladería sin pistas por nombre usa toda su carta de postres.'
      },
      {
        q: '¿Puedo mostrar combos y promos de temporada?',
        a: 'Sí. Cargás los combos como platos o categorías y los activás o desactivás cuando cambia la temporada.'
      },
      {
        q: '¿El armador tiene costo extra?',
        a: 'No. Está incluido en la suscripción, igual que el resto de las funciones.'
      }
    ]
  },
  {
    key: 'perfumery',
    slug: 'menu-digital-para-perfumerias',
    icon: '🌸',
    businessType: 'perfumery',
    demoSlug: 'demo-perfumeria',
    shortName: 'Perfumerías',
    title: 'Catálogo Digital para Perfumerías con Pedidos por WhatsApp | ScanGo',
    metaDescription:
      'Catálogo digital QR para perfumerías: fragancias con notas y descripción, pedidos por WhatsApp y 0% de comisiones. Sin marketplaces ni comisiones por venta.',
    h1: 'El catálogo digital para perfumerías que vende por WhatsApp',
    eyebrow: 'Para perfumerías y cosmética',
    lead:
      'Mostrá cada fragancia con sus notas y su historia, y recibí los pedidos por WhatsApp sin pagar comisión a ningún marketplace.',
    highlights: [
      'Fragancias con notas, descripción y foto',
      'Notas del pedido adaptadas al rubro',
      'Pedidos por WhatsApp, sin intermediarios',
      '0% de comisiones sobre tus ventas'
    ],
    pains: [
      {
        title: 'Un catálogo de fragancias no se cuenta en un PDF',
        text: 'Un PDF pesado no se ve bien en el celular ni se actualiza. Acá cada fragancia tiene su ficha con notas y descripción.'
      },
      {
        title: 'Se pierden pedidos por WhatsApp',
        text: 'Cuando el pedido llega como texto suelto, se mezcla. Acá llega con los productos elegidos y el total.'
      },
      {
        title: 'Los marketplaces cobran comisión',
        text: 'Vender por una plataforma de terceros cuesta comisión por venta. En ScanGo el canal es tuyo y no pagás comisión.'
      }
    ],
    features: [
      {
        icon: '🧴',
        title: 'Ficha por fragancia',
        text: 'Nombre, notas, descripción y foto para que el cliente sepa exactamente qué está eligiendo.'
      },
      {
        icon: '📝',
        title: 'Notas del pedido',
        text: 'La etiqueta y el texto de la nota se adaptan a perfumería (“Nota del pedido”), no a cocina.'
      },
      {
        icon: '💬',
        title: 'Pedidos por WhatsApp',
        text: 'El cliente elige y el pedido te llega organizado al WhatsApp del negocio, con el total.'
      },
      {
        icon: '🚫',
        title: '0% de comisiones',
        text: 'Sin comisión por venta: tu único costo es la suscripción fija.'
      },
      {
        icon: '🔎',
        title: 'Buscable por Google y por IA',
        text: 'Tu catálogo queda indexado y listo para que los buscadores y los asistentes de IA lo citen.'
      }
    ],
    faqs: [
      {
        q: '¿Sirve para vender perfumes por WhatsApp?',
        a: 'Sí. El cliente arma el pedido desde el catálogo y te llega por WhatsApp con los productos y el total exactos.'
      },
      {
        q: '¿Puedo describir las notas de cada fragancia?',
        a: 'Sí. Cada producto tiene su ficha con nombre, descripción, notas y foto.'
      },
      {
        q: '¿Tengo que pagar comisión por venta?',
        a: 'No. ScanGo no cobra comisión; solo la suscripción fija.'
      },
      {
        q: '¿Puedo personalizar la estética?',
        a: 'Sí. Elegís tema, tipografía y colores para que el catálogo se vea como tu marca.'
      }
    ]
  },
  {
    key: 'events',
    slug: 'menu-digital-para-eventos',
    icon: '💍',
    businessType: 'events',
    demoSlug: 'demo-evento',
    shortName: 'Eventos',
    title: 'Menú Digital para Eventos: Invitaciones por WhatsApp e Itinerario | ScanGo',
    metaDescription:
      'Menú digital para bodas, 15 años y eventos: invitaciones por WhatsApp una por invitado, itinerario con progreso en vivo y carta por QR. Pago único, sin suscripción.',
    h1: 'El menú digital que también invita a tus invitados',
    eyebrow: 'Para bodas, 15 años y catering',
    lead:
      'Cada invitado recibe su invitación por WhatsApp, ve el itinerario en vivo y consulta el menú desde el QR de su mesa. Un pago único para todo el evento.',
    highlights: [
      'Invitaciones por WhatsApp, una por invitado',
      'Itinerario visual con progreso en vivo',
      'Menú desde el QR de cada mesa',
      'Pago único, sin suscripción mensual'
    ],
    pains: [
      {
        title: 'Coordinar invitados por WhatsApp es un caos',
        text: 'Reenviás el mismo link a todos y se pierde. Acá mandás una invitación personalizada por invitado, con su nombre y su mesa.'
      },
      {
        title: 'Las tarjetas impresas se pierden',
        text: 'Un link no se pierde y se actualiza. Cambiás un horario o un plato y todos ven la versión nueva.'
      },
      {
        title: 'El itinerario no se sigue',
        text: 'El timeline muestra qué momento está pasando AHORA, cuáles ya pasaron y cuál es el siguiente, en la hora real de la fiesta.'
      }
    ],
    features: [
      {
        icon: '💌',
        title: 'Invitación por invitado',
        text: 'Cargás nombre y WhatsApp de cada invitado, y le mandás su invitación personal con mesa asignada.'
      },
      {
        icon: '🗓️',
        title: 'Itinerario en vivo',
        text: 'Timeline de la celebración con estados: faltan días, comienza a las…, en vivo con barra de avance, y cierre de agradecimiento.'
      },
      {
        icon: '🍽️',
        title: 'Menú por QR en la mesa',
        text: 'Cada mesa tiene su QR; los invitados ven la carta del evento sin pedir la carta impresa.'
      },
      {
        icon: '🥂',
        title: 'Adaptado a cada fiesta',
        text: 'Boda, 15 años, cumpleaños o catering: cambia el tema, el texto de la invitación y el itinerario.'
      },
      {
        icon: '💳',
        title: 'Pago único',
        text: 'Para eventos no hay suscripción: pagás una vez por el evento, sin costos recurrentes.'
      }
    ],
    faqs: [
      {
        q: '¿Puedo invitar a cada invitado por separado?',
        a: 'Sí. Cargás nombre y WhatsApp por invitado y le enviás una invitación personal con su mesa. Si no hay un teléfono válido, la app no abre un chat roto.'
      },
      {
        q: '¿El menú muestra el itinerario del evento?',
        a: 'Sí. El timeline muestra el progreso en la hora real de la fiesta, con el momento actual destacado.'
      },
      {
        q: '¿Es un pago mensual?',
        a: 'No. Para eventos es un pago único: no hay suscripción recurrente.'
      },
      {
        q: '¿Puedo cambiar el menú hasta el día del evento?',
        a: 'Sí. Editás el menú y el itinerario cuando quieras; los invitados siempre ven la última versión.'
      }
    ]
  }
];

// ── Utilidades puras ────────────────────────────────────────────────────────

function cleanBase(appUrl) {
  return String(appUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

/** JSON-LD seguro: JSON.stringify + escape de caracteres que romperían <script>. */
function safeJsonLd(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029'
  })[character]);
}

function getAllSolutions() {
  return SOLUTIONS.slice();
}

function getSolutionBySlug(slug) {
  const wanted = String(slug || '').toLowerCase().trim();
  return SOLUTIONS.find((solution) => solution.slug === wanted) || null;
}

// ── JSON-LD ─────────────────────────────────────────────────────────────────

function buildSolutionsIndexJsonLd(appUrl) {
  const base = cleanBase(appUrl);
  const hubUrl = `${base}${SOLUTION_BASE_PATH}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Soluciones', item: hubUrl }
        ]
      },
      {
        '@type': 'CollectionPage',
        '@id': `${hubUrl}#webpage`,
        url: hubUrl,
        name: 'Soluciones por rubro — ScanGo',
        description:
          'Menú digital QR para restaurantes, heladerías, perfumerías y eventos: pedidos por WhatsApp, 0% de comisiones y 7 días de prueba.',
        inLanguage: 'es',
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: getAllSolutions().map((solution, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: solution.shortName,
            url: `${base}${SOLUTION_BASE_PATH}/${solution.slug}`
          }))
        }
      }
    ]
  };
}

function buildSolutionJsonLd(solution, appUrl) {
  const base = cleanBase(appUrl);
  const url = `${base}${SOLUTION_BASE_PATH}/${solution.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Soluciones', item: `${base}${SOLUTION_BASE_PATH}` },
          { '@type': 'ListItem', position: 3, name: solution.shortName, item: url }
        ]
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: solution.title,
        description: solution.metaDescription,
        inLanguage: 'es'
      },
      {
        '@type': 'FAQPage',
        mainEntity: solution.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text: faq.a }
        }))
      }
    ]
  };
}

// ── Render ──────────────────────────────────────────────────────────────────

const BRAND_HTML = '<span class="brand-name">Scan<span>Go</span></span>';

/** URL de registro de la landing, con el rubro preseleccionado (opcional). */
function registerUrl(businessType) {
  const rubro = ['restaurant', 'heladeria', 'perfumery', 'events'].includes(businessType) ? businessType : '';
  return rubro ? `/?registro=1&rubro=${rubro}` : '/?registro=1';
}

function renderHead({ title, description, canonical, jsonLd, keywords = '' }) {
  return [
    '<!DOCTYPE html>',
    '<html lang="es">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${escapeHtml(title)}</title>`,
    `  <meta name="description" content="${escapeHtml(description)}">`,
    keywords ? `  <meta name="keywords" content="${escapeHtml(keywords)}">` : '',
    '  <meta name="robots" content="index,follow">',
    `  <link rel="canonical" href="${escapeHtml(canonical)}">`,
    `  <meta property="og:title" content="${escapeHtml(title)}">`,
    `  <meta property="og:description" content="${escapeHtml(description)}">`,
    '  <meta property="og:type" content="website">',
    `  <meta property="og:url" content="${escapeHtml(canonical)}">`,
    `  <meta property="og:image" content="${escapeHtml(cleanBase(canonical.split('/').slice(0, 3).join('/')))}/og-cover.png">`,
    '  <meta property="og:locale" content="es_UY">',
    '  <meta name="twitter:card" content="summary_large_image">',
    `  <meta name="twitter:title" content="${escapeHtml(title)}">`,
    `  <meta name="twitter:description" content="${escapeHtml(description)}">`,
    '  <meta name="theme-color" content="#121A18">',
    '  <link rel="icon" type="image/x-icon" href="/favicon.ico">',
    '  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">',
    '  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '  <link rel="manifest" href="/manifest.json">',
    '  <link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/nuFiD-vYSZviVYUb_rj3ij__anPXDTzYgA.woff2">',
    '  <link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/nuFRD-vYSZviVYUb_rj3ij__anPXDTnCjmHKM4nYO7KN_qiTXtHA-Q.woff2">',
    '  <link rel="stylesheet" href="/fonts/fonts.css">',
    '  <link rel="stylesheet" href="/css/index.css">',
    '  <link rel="stylesheet" href="/css/solutions.css">',
    `  <script type="application/ld+json">${safeJsonLd(jsonLd)}</script>`,
    '</head>'
  ]
    .filter(Boolean)
    .join('\n');
}

function renderHeader(registerHref = '/?registro=1') {
  return [
    '<header class="site-header">',
    '  <div class="header-container">',
    '    <a href="/" class="brand-link" aria-label="ScanGo — inicio">',
    '      <img src="/logo-scango.png" alt="ScanGo" width="45" height="44" fetchpriority="high" decoding="async" style="height:44px;width:auto;object-fit:contain;">',
    `      ${BRAND_HTML}`,
    '    </a>',
    '    <nav class="main-nav" aria-label="Navegación principal">',
    '      <a href="/#funcionalidades" class="nav-link">Funcionalidades</a>',
    '      <a href="/soluciones" class="nav-link">Soluciones</a>',
    '      <a href="/#precios" class="nav-link">Precios</a>',
    '      <a href="/#faq" class="nav-link">Preguntas</a>',
    '    </nav>',
    '    <div class="nav-actions">',
    '      <a href="/#precios" class="btn btn-outline btn-sm">Ver precios</a>',
    `      <a href="${escapeHtml(registerHref)}" class="btn btn-gold btn-sm">Comenzar ${TRIAL_DAYS} días gratis</a>`,
    '    </div>',
    '  </div>',
    '</header>'
  ].join('\n');
}

function renderFooter(registerHref = '/?registro=1') {
  const solutionLinks = getAllSolutions()
    .map((s) => `            <li><a href="${SOLUTION_BASE_PATH}/${s.slug}">${escapeHtml(s.shortName)}</a></li>`)
    .join('\n');
  return [
    '<footer class="site-footer">',
    '  <div class="container">',
    '    <div class="footer-grid">',
    '      <div>',
    '        <div class="footer-brand-title" style="margin:0 0 12px;font-size:1.25rem;font-weight:800;">Scan<span style="color:var(--accent-gold);">Go</span></div>',
    '        <p class="footer-desc">Plataforma para cartas digitales interactivas, generación de cartelería QR y pedidos directos por WhatsApp, sin intermediarios ni comisiones.</p>',
    '      </div>',
    '      <div>',
    '        <div class="footer-heading">Soluciones</div>',
    '        <ul class="footer-links">',
    solutionLinks,
    '        </ul>',
    '      </div>',
    '      <div>',
    '        <div class="footer-heading">Acceso y Legal</div>',
    '        <ul class="footer-links">',
    '          <li><a href="/">Inicio</a></li>',
    '          <li><a href="/#precios">Planes y Precios</a></li>',
    `          <li><a href="${escapeHtml(registerHref)}">Registrar negocio (${TRIAL_DAYS} días gratis)</a></li>`,
    '          <li><a href="/terminos">Términos del Servicio</a></li>',
    '          <li><a href="/privacidad">Política de Privacidad</a></li>',
    '          <li><a href="/cookies">Política de Cookies</a></li>',
    '          <li><a href="/reembolsos">Reembolsos</a></li>',
    '          <li><a href="/aviso-legal">Aviso Legal</a></li>',
    '        </ul>',
    '      </div>',
    '    </div>',
    '    <div class="footer-bottom">',
    '      <p>© 2026 ScanGo. Todos los derechos reservados. • <a href="/terminos" style="color:inherit;text-decoration:underline;">Términos</a> • <a href="/privacidad" style="color:inherit;text-decoration:underline;">Privacidad</a> • <a href="/cookies" style="color:inherit;text-decoration:underline;">Cookies</a></p>',
    '    </div>',
    '  </div>',
    '</footer>'
  ].join('\n');
}

function renderBreadcrumb(items) {
  const lis = items
    .map((item, index) => {
      const last = index === items.length - 1;
      const label = escapeHtml(item.name);
      const inner = item.href && !last ? `<a href="${escapeHtml(item.href)}">${label}</a>` : `<span aria-current="page">${label}</span>`;
      return `      <li>${inner}</li>`;
    })
    .join('\n');
  return [
    '  <nav class="sol-breadcrumb" aria-label="Miga de pan">',
    '    <div class="container">',
    '      <ol>',
    lis,
    '      </ol>',
    '    </div>',
    '  </nav>'
  ].join('\n');
}

function renderFaqs(faqs) {
  return faqs
    .map(
      (faq) => [
        '        <details class="sol-faq-item">',
        `          <summary>${escapeHtml(faq.q)}</summary>`,
        `          <p>${escapeHtml(faq.a)}</p>`,
        '        </details>'
      ].join('\n')
    )
    .join('\n');
}

function renderSolutionHtml(solution, { appUrl } = {}) {
  const base = cleanBase(appUrl);
  const canonical = `${base}${SOLUTION_BASE_PATH}/${solution.slug}`;
  const jsonLd = buildSolutionJsonLd(solution, base);
  const registerHref = registerUrl(solution.businessType);
  const pains = solution.pains
    .map(
      (pain) => [
        '        <article class="sol-card">',
        `          <h3 class="sol-card-title">${escapeHtml(pain.title)}</h3>`,
        `          <p class="sol-card-text">${escapeHtml(pain.text)}</p>`,
        '        </article>'
      ].join('\n')
    )
    .join('\n');
  const features = solution.features
    .map(
      (feature) => [
        '        <article class="sol-feature">',
        `          <div class="sol-feature-icon" aria-hidden="true">${escapeHtml(feature.icon)}</div>`,
        `          <h3 class="sol-feature-title">${escapeHtml(feature.title)}</h3>`,
        `          <p class="sol-feature-text">${escapeHtml(feature.text)}</p>`,
        '        </article>'
      ].join('\n')
    )
    .join('\n');
  const highlights = solution.highlights
    .map((item) => `          <li>${escapeHtml(item)}</li>`)
    .join('\n');

  return [
    renderHead({
      title: solution.title,
      description: solution.metaDescription,
      canonical,
      jsonLd,
      keywords: `menú digital, ${solution.shortName.toLowerCase()}, carta QR, pedidos WhatsApp, ScanGo`
    }),
    '<body>',
    '  <a href="#main-content" class="skip-link">Saltar al contenido principal</a>',
    renderHeader(registerHref),
    renderBreadcrumb([
      { name: 'Inicio', href: '/' },
      { name: 'Soluciones', href: SOLUTION_BASE_PATH },
      { name: solution.shortName }
    ]),
    '  <main id="main-content">',
    '    <section class="sol-hero">',
    '      <div class="container">',
    `        <span class="section-badge">${escapeHtml(solution.icon)} ${escapeHtml(solution.eyebrow)}</span>`,
    `        <h1>${escapeHtml(solution.h1)}</h1>`,
    `        <p class="lead sol-lead">${escapeHtml(solution.lead)}</p>`,
    '        <div class="sol-hero-actions">',
    `          <a class="btn btn-gold" href="${escapeHtml(registerHref)}">Comenzar ${TRIAL_DAYS} días gratis →</a>`,
    `          <a class="btn btn-outline" href="/m/${escapeHtml(solution.demoSlug)}">Ver menú demo en vivo</a>`,
    '        </div>',
    `        <p class="sol-hero-note">Sin tarjeta de crédito · 0% de comisiones · Cancelás cuando quieras</p>`,
    '        <ul class="sol-highlights">',
    highlights,
    '        </ul>',
    '      </div>',
    '    </section>',
    '    <section class="sol-section">',
    '      <div class="container">',
    '        <div class="sol-section-header">',
    '          <h2>Los problemas que resolvemos</h2>',
    '        </div>',
    '        <div class="sol-grid">',
    pains,
    '        </div>',
    '      </div>',
    '    </section>',
    '    <section class="sol-section sol-section-alt">',
    '      <div class="container">',
    '        <div class="sol-section-header">',
    `          <h2>Qué incluye ScanGo para ${escapeHtml(solution.shortName.toLowerCase())}</h2>`,
    '        </div>',
    '        <div class="sol-features-grid">',
    features,
    '        </div>',
    '      </div>',
    '    </section>',
    '    <section class="sol-section">',
    '      <div class="container">',
    '        <div class="sol-section-header">',
    '          <h2>Preguntas frecuentes</h2>',
    '        </div>',
    '        <div class="sol-faq">',
    renderFaqs(solution.faqs),
    '        </div>',
    '      </div>',
    '    </section>',
    '    <section class="sol-cta">',
    '      <div class="container">',
    `        <h2>Poné a vender tu carta de ${escapeHtml(solution.shortName.toLowerCase())} hoy</h2>`,
    `        <p>${TRIAL_DAYS} días gratis, sin tarjeta de crédito y sin comisiones por venta.</p>`,
    '        <div class="sol-hero-actions">',
    `          <a class="btn btn-gold" href="${escapeHtml(registerHref)}">Crear mi menú gratis →</a>`,
    `          <a class="btn btn-outline" href="/m/${escapeHtml(solution.demoSlug)}">Probar el demo</a>`,
    '        </div>',
    '      </div>',
    '    </section>',
    '  </main>',
    renderFooter(registerHref),
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

function renderSolutionsIndexHtml({ appUrl } = {}) {
  const base = cleanBase(appUrl);
  const canonical = `${base}${SOLUTION_BASE_PATH}`;
  const jsonLd = buildSolutionsIndexJsonLd(base);
  const cards = getAllSolutions()
    .map(
      (solution) => [
        '        <article class="sol-card sol-card-link">',
        `          <div class="sol-card-icon" aria-hidden="true">${escapeHtml(solution.icon)}</div>`,
        `          <h3 class="sol-card-title">${escapeHtml(solution.shortName)}</h3>`,
        `          <p class="sol-card-text">${escapeHtml(solution.lead)}</p>`,
        `          <a class="sol-card-cta" href="${SOLUTION_BASE_PATH}/${solution.slug}">Ver solución →</a>`,
        '        </article>'
      ].join('\n')
    )
    .join('\n');

  return [
    renderHead({
      title: 'Soluciones por rubro — Menú Digital QR | ScanGo',
      description:
        'Menú digital QR para restaurantes, heladerías, perfumerías y eventos: pedidos por WhatsApp, 0% de comisiones y 7 días de prueba gratis.',
      canonical,
      jsonLd,
      keywords: 'menú digital, QR, restaurantes, heladerías, perfumerías, eventos, pedidos WhatsApp'
    }),
    '<body>',
    '  <a href="#main-content" class="skip-link">Saltar al contenido principal</a>',
    renderHeader(),
    renderBreadcrumb([{ name: 'Inicio', href: '/' }, { name: 'Soluciones' }]),
    '  <main id="main-content">',
    '    <section class="sol-hero">',
    '      <div class="container">',
    '        <span class="section-badge">🗂️ Soluciones por rubro</span>',
    '        <h1>Un menú digital pensado para tu rubro</h1>',
    '        <p class="lead sol-lead">El mismo motor, adaptado a cómo vende cada negocio: carta de restaurante, armador de helado, catálogo de perfumería o menú de evento.</p>',
    '        <div class="sol-hero-actions">',
    `          <a class="btn btn-gold" href="/?registro=1">Comenzar ${TRIAL_DAYS} días gratis →</a>`,
    '          <a class="btn btn-outline" href="/#precios">Ver precios</a>',
    '        </div>',
    '      </div>',
    '    </section>',
    '    <section class="sol-section">',
    '      <div class="container">',
    '        <div class="sol-grid">',
    cards,
    '        </div>',
    '      </div>',
    '    </section>',
    '  </main>',
    renderFooter(),
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

module.exports = {
  SOLUTIONS,
  SOLUTION_BASE_PATH,
  TRIAL_DAYS,
  getAllSolutions,
  getSolutionBySlug,
  buildSolutionsIndexJsonLd,
  buildSolutionJsonLd,
  renderSolutionsIndexHtml,
  renderSolutionHtml,
  escapeHtml,
  safeJsonLd
};
