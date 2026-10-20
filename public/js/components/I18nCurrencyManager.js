/**
 * I18nCurrencyManager.js
 * Gestor dinámico de Internacionalización (i18n) y Selector de Moneda en vivo para ScanGo.
 * 
 * Idiomas: Español (es), English (en), Português (pt)
 * Monedas: $UYU, $USD, $ARS con conversión y actualización de formato en vivo.
 */

export const TRANSLATIONS = {
  es: {
    searchPlaceholder: '🔍 Buscar plato, ingrediente…',
    allCategories: 'Todos',
    popularCategory: '⭐ Populares',
    a11yNotice: '👁️ Menú adaptado para lectores de pantalla y accesibilidad visual',
    listenCategory: '🔊 Escuchar categoría',
    outOfStock: '✕ AGOTADO HOY',
    featured: '⭐ Destacado',
    veggie: '🥬 Vegetariano',
    vegan: '🌱 Vegano',
    celiac: '🌾 Sin TACC',
    lactoseFree: '🥛 Sin Lactosa',
    spicy: '🌶️ Picante',
    inCart: 'en carrito',
    floatingCartItems: 'ítems',
    viewCart: 'Ver Carrito',
    cartTitle: '🛒 Tu Carrito / Pedido',
    orderMode: 'Tipo de Pedido:',
    modeLocal: '🍽️ Consumo en el Local / Mesa',
    modeTakeaway: '🛍️ Para Llevar / Retiro (Take Away)',
    modeDelivery: '🛵 Envío a Domicilio (Delivery)',
    tableLabel: 'Número de Mesa:',
    tablePlaceholder: 'Ej: Mesa 4, Barra, Terraza',
    deliveryZoneLabel: 'Zona de Entrega:',
    deliveryAddressLabel: 'Dirección de Entrega:',
    deliveryAddressPlaceholder: 'Calle, número de puerta y esquina',
    customerNameLabel: 'Tu Nombre:',
    customerNamePlaceholder: 'Ej: Juan Pérez',
    notesLabel: 'Aclaraciones o Notas para la Cocina:',
    notesPlaceholder: 'Ej: Sin sal, salsa aparte, servilletas extra…',
    paymentMethodLabel: 'Forma de Pago Prevista:',
    payCash: '💵 Efectivo al recibir',
    payCard: '💳 Tarjeta de Débito / Crédito',
    payTransfer: '🏦 Transferencia Bancaria',
    payMercadoPago: '📱 Mercado Pago / QR Online',
    couponTitle: '🎟️ ¿Tenés un Cupón de Descuento?',
    applyCoupon: 'Aplicar',
    subtotal: 'Subtotal:',
    discount: 'Descuento aplicado:',
    deliveryFee: 'Costo de envío:',
    total: 'Total a pagar:',
    billSplitterTitle: '🧮 Dividir Cuenta entre:',
    persons: 'personas',
    each: 'c/u',
    submitOrderWA: '📲 Confirmar y Enviar Pedido por WhatsApp',
    waiterFabTitle: 'Llamar al Mozo o Pedir la Cuenta',
    waiterModalTitle: '🔔 Servicio de Mesa',
    waiterCallBtn: '🙋 Llamar al Mozo',
    waiterBillCash: '🧾 Pedir la Cuenta (Efectivo)',
    waiterBillCard: '💳 Pedir la Cuenta (Tarjeta)',
    wifiModalTitle: '📶 Conexión Wi-Fi Clientes',
    wifiCopySuccess: '¡Copiado al portapapeles!',
    reservationTitle: '📅 Reservar Mesa',
    reservationSubmit: 'Confirmar Reserva por WhatsApp',
    loyaltyChip: '⭐ Club Puntos',
    iceCreamWizardBtn: '🍧 Armá tu Helado Artesanal',
    perfumeryCatalogBtn: '✨ Catálogo de Perfumería',
    allDishesLoaded: 'No hay platos cargados aún.',
    topDishesCarousel: 'Los Mejores Platos de la Casa',
    favoritesBadge: '⭐ Los Favoritos',
    chefAndFavoritesLabel: 'Sugerencia del Chef & Los Favoritos',
    favoriteRibbon: '⭐ Favorito',
    recommendationLabel: 'Recomendación',
    chefSpecialBadge: '⭐ Especial del Día',
    chefTitleDefault: 'Sugerencia del Chef & Menú del Día',
    storiesViewMenu: 'Ver como historias',
    storiesTrayTitle: '📖 Historias',
    storiesHint: '↓ Deslizá para salir · Mantené para pausar',
    storiesClose: 'Cerrar historias y ver carta completa',
    storiesAdd: '+ Agregar',
    storiesSoldOut: 'Agotado por el momento',
    storiesOrder: 'Pedir →',
    storiesSeeInMenu: '📍 Ver en carta',
    storiesShareLocal: 'Compartir este local',
    storiesViewCart: 'Ver pedido',
    reviewNudgeTitle: '¡Buen provecho! ¿Todo bien?',
    reviewNudgeText: 'Tu reseña en Google nos ayuda un montón.',
    reviewNudgeCta: '⭐ Calificar mi experiencia',
    reviewAltPrivate: 'o contanos en privado →',
    reviewAltGoogle: 'o dejala en Google →',
    reviewStar1: '😞 Muy mala',
    reviewStar2: '😕 Regular',
    reviewStar3: '🙂 Buena',
    reviewStar4: '😊 Muy buena',
    reviewStar5: '🤩 ¡Excelente!',
    reviewTitle: '¿Cómo estuvo tu experiencia?',
    reviewGoogleTitle: '¡Nos alegra un montón que te haya encantado!',
    reviewGoogleText: '¿Nos regalarías 10 segundos de tu tiempo para dejar tu reseña en Google Maps? Tu calificación nos impulsa enormemente.',
    reviewGoogleCta: '⭐ Publicar Reseña en Google Maps ➔',
    reviewDismiss: 'Listo, ¡muchas gracias!',
    reviewPrivateTitle: 'Queremos escucharte y mejorar',
    reviewPrivateText: 'Lamentamos no haber alcanzado la perfección. Tu mensaje llegará de forma directa y privada a la administración:',
    reviewPrivateSubmit: '📩 Enviar Comentario Privado a la Gerencia',
    reviewCommentLabel: '¿En qué podemos mejorar o qué sucedió?',
    reviewCommentPh: 'Contanos tu experiencia (atención, tiempos, sabor, presentación…)',
    reviewNameLabel: 'Tu Nombre (opcional)',
    reviewNamePh: 'Ej: Juan',
    reviewContactLabel: 'WhatsApp o E-mail (opcional)',
    reviewContactPh: 'Para contactarte…',
    reviewSuccessTitle: '✓ ¡Mensaje recibido!',
    reviewSuccessText: 'Tu comentario fue enviado directamente a la gerencia. Gracias por ayudarnos a perfeccionar nuestro servicio.',
    reviewNeedComment: 'Por favor escribí un comentario antes de enviar.',
    reviewSendError: 'No se pudo enviar el comentario. Intentá nuevamente.',
    reviewConnError: 'Error de conexión. Por favor, intentá nuevamente.'
  },
  en: {
    searchPlaceholder: '🔍 Search dish, ingredient…',
    allCategories: 'All',
    popularCategory: '⭐ Popular',
    a11yNotice: '👁️ Accessible menu adapted for screen readers & visual comfort',
    listenCategory: '🔊 Listen category',
    outOfStock: '✕ SOLD OUT TODAY',
    featured: '⭐ Featured',
    veggie: '🥬 Vegetarian',
    vegan: '🌱 Vegan',
    celiac: '🌾 Gluten Free',
    lactoseFree: '🥛 Lactose Free',
    spicy: '🌶️ Spicy',
    inCart: 'in order',
    floatingCartItems: 'items',
    viewCart: 'View Order',
    cartTitle: '🛒 Your Order Summary',
    orderMode: 'Order Type:',
    modeLocal: '🍽️ Dine-in / Table',
    modeTakeaway: '🛍️ Take Away / Pickup',
    modeDelivery: '🛵 Home Delivery',
    tableLabel: 'Table Number:',
    tablePlaceholder: 'e.g. Table 4, Bar, Terrace',
    deliveryZoneLabel: 'Delivery Area:',
    deliveryAddressLabel: 'Delivery Address:',
    deliveryAddressPlaceholder: 'Street, door number and cross street',
    customerNameLabel: 'Your Name:',
    customerNamePlaceholder: 'e.g. John Doe',
    notesLabel: 'Kitchen Notes or Special Requests:',
    notesPlaceholder: 'e.g. No salt, dressing on the side, extra napkins…',
    paymentMethodLabel: 'Preferred Payment Method:',
    payCash: '💵 Cash upon delivery',
    payCard: '💳 Debit / Credit Card',
    payTransfer: '🏦 Bank Transfer',
    payMercadoPago: '📱 Mobile / QR Online Pay',
    couponTitle: '🎟️ Do you have a promo coupon?',
    applyCoupon: 'Apply',
    subtotal: 'Subtotal:',
    discount: 'Applied discount:',
    deliveryFee: 'Delivery fee:',
    total: 'Total to pay:',
    billSplitterTitle: '🧮 Split bill among:',
    persons: 'people',
    each: 'each',
    submitOrderWA: '📲 Confirm & Send Order via WhatsApp',
    waiterFabTitle: 'Call Waiter or Request the Bill',
    waiterModalTitle: '🔔 Table Service',
    waiterCallBtn: '🙋 Call Waiter',
    waiterBillCash: '🧾 Request Bill (Cash)',
    waiterBillCard: '💳 Request Bill (Card)',
    wifiModalTitle: '📶 Customer Wi-Fi',
    wifiCopySuccess: 'Copied to clipboard!',
    reservationTitle: '📅 Book a Table',
    reservationSubmit: 'Confirm Reservation on WhatsApp',
    loyaltyChip: '⭐ Rewards Club',
    iceCreamWizardBtn: '🍧 Build Your Ice Cream',
    perfumeryCatalogBtn: '✨ Perfumery Catalog',
    allDishesLoaded: 'No dishes available yet.',
    topDishesCarousel: "The House's Best Dishes",
    favoritesBadge: '⭐ Favorites',
    chefAndFavoritesLabel: "Chef's Pick & Favorites",
    favoriteRibbon: '⭐ Favorite',
    recommendationLabel: "Chef's Pick",
    chefSpecialBadge: "⭐ Chef's Special",
    chefTitleDefault: "Chef's Pick & Today's Menu",
    storiesViewMenu: 'View as stories',
    storiesTrayTitle: '📖 Stories',
    storiesHint: '↓ Swipe down to exit · Hold to pause',
    storiesClose: 'Close stories and view full menu',
    storiesAdd: '+ Add',
    storiesSoldOut: 'Sold out for now',
    storiesOrder: 'Order →',
    storiesSeeInMenu: '📍 View in menu',
    storiesShareLocal: 'Share this place',
    storiesViewCart: 'View order',
    reviewNudgeTitle: 'Enjoy your meal! All good?',
    reviewNudgeText: 'Your Google review helps us a lot.',
    reviewNudgeCta: '⭐ Rate my experience',
    reviewAltPrivate: 'or tell us privately →',
    reviewAltGoogle: 'or leave it on Google →',
    reviewStar1: '😞 Very bad',
    reviewStar2: '😕 Meh',
    reviewStar3: '🙂 Good',
    reviewStar4: '😊 Very good',
    reviewStar5: '🤩 Excellent!',
    reviewTitle: 'How was your experience?',
    reviewGoogleTitle: "We're thrilled you loved it!",
    reviewGoogleText: 'Could you spare 10 seconds to leave your review on Google Maps? Your rating helps us enormously.',
    reviewGoogleCta: '⭐ Post Review on Google Maps ➔',
    reviewDismiss: 'Done, thank you so much!',
    reviewPrivateTitle: 'We want to hear you and improve',
    reviewPrivateText: "We're sorry we fell short. Your message goes directly and privately to management:",
    reviewPrivateSubmit: '📩 Send Private Comment to Management',
    reviewCommentLabel: 'What can we improve or what happened?',
    reviewCommentPh: 'Tell us about your experience (service, timing, flavor, presentation…)',
    reviewNameLabel: 'Your Name (optional)',
    reviewNamePh: 'e.g. John',
    reviewContactLabel: 'WhatsApp or Email (optional)',
    reviewContactPh: 'To reach you…',
    reviewSuccessTitle: '✓ Message received!',
    reviewSuccessText: 'Your comment was sent directly to management. Thanks for helping us perfect our service.',
    reviewNeedComment: 'Please write a comment before sending.',
    reviewSendError: 'Could not send your comment. Please try again.',
    reviewConnError: 'Connection error. Please try again.'
  },
  pt: {
    searchPlaceholder: '🔍 Buscar prato, ingrediente…',
    allCategories: 'Todos',
    popularCategory: '⭐ Populares',
    a11yNotice: '👁️ Cardápio acessível adaptado para leitores de tela',
    listenCategory: '🔊 Ouvir categoria',
    outOfStock: '✕ ESGOTADO HOJE',
    featured: '⭐ Destaque',
    veggie: '🥬 Vegetariano',
    vegan: '🌱 Vegano',
    celiac: '🌾 Sem Glúten',
    lactoseFree: '🥛 Sem Lactose',
    spicy: '🌶️ Apimentado',
    inCart: 'no carrinho',
    floatingCartItems: 'itens',
    viewCart: 'Ver Carrinho',
    cartTitle: '🛒 Seu Carrinho / Pedido',
    orderMode: 'Tipo de Pedido:',
    modeLocal: '🍽️ Consumo no Local / Mesa',
    modeTakeaway: '🛍️ Para Viagem / Retirada',
    modeDelivery: '🛵 Entrega em Domicílio (Delivery)',
    tableLabel: 'Número da Mesa:',
    tablePlaceholder: 'Ex: Mesa 4, Balcão, Varanda',
    deliveryZoneLabel: 'Área de Entrega:',
    deliveryAddressLabel: 'Endereço de Entrega:',
    deliveryAddressPlaceholder: 'Rua, número e ponto de referência',
    customerNameLabel: 'Seu Nome:',
    customerNamePlaceholder: 'Ex: João Silva',
    notesLabel: 'Observações para a Cozinha:',
    notesPlaceholder: 'Ex: Sem sal, molho à parte, guardanapos extras…',
    paymentMethodLabel: 'Forma de Pagamento:',
    payCash: '💵 Dinheiro na entrega',
    payCard: '💳 Cartão de Débito / Crédito',
    payTransfer: '🏦 Pix / Transferência Bancária',
    payMercadoPago: '📱 Pagamento Digital / QR Code',
    couponTitle: '🎟️ Tem um Cupom de Desconto?',
    applyCoupon: 'Aplicar',
    subtotal: 'Subtotal:',
    discount: 'Desconto aplicado:',
    deliveryFee: 'Taxa de entrega:',
    total: 'Total a pagar:',
    billSplitterTitle: '🧮 Dividir Conta entre:',
    persons: 'pessoas',
    each: 'cada',
    submitOrderWA: '📲 Confirmar e Enviar Pedido pelo WhatsApp',
    waiterFabTitle: 'Chamar o Garçom ou Pedir a Conta',
    waiterModalTitle: '🔔 Serviço de Mesa',
    waiterCallBtn: '🙋 Chamar o Garçom',
    waiterBillCash: '🧾 Pedir a Conta (Dinheiro)',
    waiterBillCard: '💳 Pedir a Conta (Cartão)',
    wifiModalTitle: '📶 Wi-Fi para Clientes',
    wifiCopySuccess: 'Copiado para a área de transferência!',
    reservationTitle: '📅 Reservar Mesa',
    reservationSubmit: 'Confirmar Reserva pelo WhatsApp',
    loyaltyChip: '⭐ Clube Pontos',
    iceCreamWizardBtn: '🍧 Monte seu Sorvete',
    perfumeryCatalogBtn: '✨ Catálogo de Perfumaria',
    allDishesLoaded: 'Nenhum prato disponível ainda.',
    topDishesCarousel: 'Os Melhores Pratos da Casa',
    favoritesBadge: '⭐ Os Favoritos',
    chefAndFavoritesLabel: 'Sugestão do Chef & Os Favoritos',
    favoriteRibbon: '⭐ Favorito',
    recommendationLabel: 'Recomendação',
    chefSpecialBadge: '⭐ Especial do Dia',
    chefTitleDefault: 'Sugestão do Chef & Menu do Dia',
    storiesViewMenu: 'Ver como stories',
    storiesTrayTitle: '📖 Stories',
    storiesHint: '↓ Deslize para sair · Segure para pausar',
    storiesClose: 'Fechar stories e ver o cardápio completo',
    storiesAdd: '+ Adicionar',
    storiesSoldOut: 'Esgotado no momento',
    storiesOrder: 'Pedir →',
    storiesSeeInMenu: '📍 Ver no cardápio',
    storiesShareLocal: 'Compartilhar este local',
    storiesViewCart: 'Ver pedido',
    reviewNudgeTitle: 'Bom apetite! Tudo bem?',
    reviewNudgeText: 'Sua avaliação no Google nos ajuda muito.',
    reviewNudgeCta: '⭐ Avaliar minha experiência',
    reviewAltPrivate: 'ou conte em privado →',
    reviewAltGoogle: 'ou deixe no Google →',
    reviewStar1: '😞 Muito ruim',
    reviewStar2: '😕 Regular',
    reviewStar3: '🙂 Boa',
    reviewStar4: '😊 Muito boa',
    reviewStar5: '🤩 Excelente!',
    reviewTitle: 'Como foi sua experiência?',
    reviewGoogleTitle: 'Que bom que você adorou!',
    reviewGoogleText: 'Você nos daria 10 segundos para deixar sua avaliação no Google Maps? Sua nota nos ajuda enormemente.',
    reviewGoogleCta: '⭐ Publicar Avaliação no Google Maps ➔',
    reviewDismiss: 'Pronto, muito obrigado!',
    reviewPrivateTitle: 'Queremos ouvir você e melhorar',
    reviewPrivateText: 'Sentimos não ter atingido a perfeição. Sua mensagem vai direta e privada para a gerência:',
    reviewPrivateSubmit: '📩 Enviar Comentário Privado à Gerência',
    reviewCommentLabel: 'O que podemos melhorar ou o que aconteceu?',
    reviewCommentPh: 'Conte sua experiência (atendimento, tempo, sabor, apresentação…)',
    reviewNameLabel: 'Seu Nome (opcional)',
    reviewNamePh: 'Ex: João',
    reviewContactLabel: 'WhatsApp ou E-mail (opcional)',
    reviewContactPh: 'Para contatarmos…',
    reviewSuccessTitle: '✓ Mensagem recebida!',
    reviewSuccessText: 'Seu comentário foi enviado direto para a gerência. Obrigado por nos ajudar a melhorar.',
    reviewNeedComment: 'Por favor escreva um comentário antes de enviar.',
    reviewSendError: 'Não foi possível enviar. Tente novamente.',
    reviewConnError: 'Erro de conexão. Tente novamente.'
  }
};

export const CURRENCY_CONFIG = {
  '$UYU': { symbol: '$', label: '$ UYU', rateFromUYU: 1 },
  '$USD': { symbol: 'US$', label: 'US$ USD', rateFromUYU: 0.025 }, // 1 USD = 40 UYU
  '$ARS': { symbol: '$', label: '$ ARS', rateFromUYU: 30 } // 1 UYU = 30 ARS (1 USD = 1200 ARS)
};

/** Nombres legibles de los idiomas que soporta la UI del menú. */
export const LANGUAGE_LABELS = {
  es: 'Español',
  en: 'English',
  pt: 'Português'
};

/** Escape mínimo (sin dependencias) para no romper la importación en Node. */
function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Idiomas realmente disponibles para el menú: el base ('es') más cualquier idioma
 * que tenga al menos una traducción NO vacía en los platos o categorías (o que
 * venga en un array explícito `availableLanguages` / `enabledLanguages`).
 *
 * El selector de idioma sólo debe mostrarse si hay MÁS DE UNO: si el dueño no
 * configuró traducciones, el menú queda en su idioma base y no tiene sentido
 * ofrecer el conmutador.
 *
 * @param {object} restaurantData Payload público del restaurante
 * @returns {string[]} Códigos de idioma disponibles (siempre incluye 'es')
 */
export function detectAvailableLanguages(restaurantData = {}) {
  const rd = restaurantData || {};
  const langs = new Set(['es']);

  const explicit = rd.availableLanguages || rd.enabledLanguages;
  if (Array.isArray(explicit)) {
    explicit.forEach((code) => { if (code) langs.add(String(code).toLowerCase()); });
  }

  const addFromTranslations = (item) => {
    const tr = item && item.translations;
    if (!tr || typeof tr !== 'object') return;
    Object.keys(tr).forEach((code) => {
      const val = tr[code];
      if (!val || typeof val !== 'object') return;
      const hasText = Object.values(val).some((v) => typeof v === 'string' && v.trim());
      if (hasText) langs.add(String(code).toLowerCase());
    });
  };

  (Array.isArray(rd.dishes) ? rd.dishes : []).forEach(addFromTranslations);
  (Array.isArray(rd.categories) ? rd.categories : []).forEach(addFromTranslations);

  return Array.from(langs);
}

export class I18nCurrencyManager {
  constructor(options = {}) {
    this.currentLang = options.defaultLang || 'es';
    this.currentCurrency = options.defaultCurrency || '$UYU';
    this.onStateChange = options.onStateChange || (() => {});
    this._langMenuBound = false;
  }

  t(key) {
    const langDict = TRANSLATIONS[this.currentLang] || TRANSLATIONS.es;
    return langDict[key] || TRANSLATIONS.es[key] || key;
  }

  getCurrencySymbol() {
    const cfg = CURRENCY_CONFIG[this.currentCurrency] || CURRENCY_CONFIG['$UYU'];
    return cfg.symbol;
  }

  formatPrice(basePriceInUYU) {
    const cfg = CURRENCY_CONFIG[this.currentCurrency] || CURRENCY_CONFIG['$UYU'];
    const converted = Math.round(basePriceInUYU * cfg.rateFromUYU);
    return `${cfg.symbol} ${converted.toLocaleString()}`;
  }

  setLanguage(lang) {
    if (!TRANSLATIONS[lang]) return;
    this.currentLang = lang;
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = lang;
    this.applyDOMTranslations();
    this.updateLanguageTriggerLabel();
    this.closeLanguageMenu();
    this.onStateChange({ lang: this.currentLang, currency: this.currentCurrency });
  }

  setCurrency(curr) {
    if (!CURRENCY_CONFIG[curr]) return;
    this.currentCurrency = curr;
    this.onStateChange({ lang: this.currentLang, currency: this.currentCurrency });
  }

  renderControlsBar(targetElementId) {
    const container = document.getElementById(targetElementId);
    if (!container) return;

    const restaurant = (typeof window !== 'undefined' && window.restaurantData) || {};
    const langs = detectAvailableLanguages(restaurant);
    const showLang = langs.length > 1;
    // Si el dueño no configuró traducciones, el menú queda en su idioma base:
    // ocultamos por completo el selector (evita ofrecer un cambio que no traduce).
    if (!showLang) {
      this.currentLang = 'es';
      if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = 'es';
    }

    // Probador de temas en vivo: solo en demos (/m/demo-*). El disparador vive
    // DENTRO de la barra de controles (sticky) en vez de ser un FAB flotante:
    // antes se superponía con el botón del mozo y con el selector de moneda.
    // El panel se cuelga del <body> con position:fixed para que ningún stacking
    // context del tema lo tape (p.ej. glass-gastro pone el header por encima
    // del contenedor del menú).
    const demoHTML = restaurant.isDemo === true ? `
        <button type="button" id="demoThemeFab" class="i18n-demo-theme"
                data-js-click="toggleDemoThemeBar"
                title="Probar otro tema visual" aria-label="Probar otro tema visual"
                aria-expanded="false" aria-controls="demoThemePanel">Temas</button>` : '';

    const langHTML = showLang ? `
        <div class="i18n-lang" id="i18nLangSelector">
          <button type="button" class="i18n-lang-trigger" id="i18nLangTrigger"
                  data-js-click="i18nManager.toggleLanguageMenu"
                  aria-haspopup="true" aria-expanded="false" aria-label="Cambiar idioma">
            <span aria-hidden="true">🌐</span>
            <span class="i18n-lang-current" id="i18nLangCurrent">${escapeText(this.currentLang.toUpperCase())}</span>
            <span class="i18n-lang-caret" aria-hidden="true">▾</span>
          </button>
          <div class="i18n-lang-menu" id="i18nLangMenu" role="menu">
            ${langs.map((code) => `
              <button type="button" role="menuitem"
                      class="i18n-lang-option${code === this.currentLang ? ' is-active' : ''}"
                      data-js-click="i18nManager.setLanguage|${escapeText(code)}">
                <span>${escapeText(LANGUAGE_LABELS[code] || code.toUpperCase())}</span>
                <span class="i18n-lang-check">${code === this.currentLang ? '✓' : ''}</span>
              </button>`).join('')}
          </div>
        </div>` : '';

    container.innerHTML = `
      <div class="i18n-currency-bar">
        ${demoHTML}
        ${langHTML}
        <div class="i18n-currency">
          <span class="i18n-currency-icon" aria-hidden="true">💵</span>
          <select id="selectCurrencySwitcher" class="i18n-currency-select" aria-label="Moneda"
                  data-js-change="i18nManager.setCurrency|this.value">
            <option value="$UYU" ${this.currentCurrency === '$UYU' ? 'selected' : ''}>$ UYU</option>
            <option value="$USD" ${this.currentCurrency === '$USD' ? 'selected' : ''}>US$ USD</option>
            <option value="$ARS" ${this.currentCurrency === '$ARS' ? 'selected' : ''}>$ ARS</option>
          </select>
        </div>
      </div>
    `;

    // Panel del probador de temas: fuera de la barra (body + position:fixed)
    // para que ningún stacking context del tema lo deje detrás del header
    // (glass-gastro pone el header por encima del contenedor del menú).
    const previousPanel = document.getElementById('demoThemePanel');
    if (previousPanel) previousPanel.remove();
    if (restaurant.isDemo === true) {
      const panel = document.createElement('div');
      panel.id = 'demoThemePanel';
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', 'Temas visuales de la demo');
      panel.style.display = 'none';
      panel.innerHTML = `
        <div class="i18n-demo-theme-head">
          <strong>Probá otro tema</strong>
          <button type="button" data-js-click="toggleDemoThemeBar" aria-label="Cerrar probador de temas">✕</button>
        </div>
        <div id="demoThemePills"></div>
        <div class="i18n-demo-theme-foot">Demo de prueba: solo cambia la estética, nada se guarda.</div>`;
      document.body.appendChild(panel);
    }

    window.i18nManager = this;
    this.bindLanguageMenu();
  }

  /** Cierra el desplegable al hacer click afuera o con Escape. */
  bindLanguageMenu() {
    if (this._langMenuBound || typeof document === 'undefined') return;
    this._langMenuBound = true;
    document.addEventListener('click', (e) => {
      const selector = document.getElementById('i18nLangSelector');
      if (!selector) return;
      if (!selector.contains(e.target)) this.closeLanguageMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeLanguageMenu();
    });
  }

  toggleLanguageMenu() {
    const menu = document.getElementById('i18nLangMenu');
    const trigger = document.getElementById('i18nLangTrigger');
    if (!menu) return;
    const open = !menu.classList.contains('is-open');
    menu.classList.toggle('is-open', open);
    if (trigger) trigger.setAttribute('aria-expanded', String(open));
  }

  closeLanguageMenu() {
    const menu = document.getElementById('i18nLangMenu');
    if (menu) menu.classList.remove('is-open');
    const trigger = document.getElementById('i18nLangTrigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  updateLanguageTriggerLabel() {
    const current = document.getElementById('i18nLangCurrent');
    if (current) current.textContent = String(this.currentLang || 'es').toUpperCase();
    const menu = document.getElementById('i18nLangMenu');
    if (!menu) return;
    menu.querySelectorAll('.i18n-lang-option').forEach((btn) => {
      const spec = btn.getAttribute('data-js-click') || '';
      const code = spec.split('|')[1];
      const active = code === this.currentLang;
      btn.classList.toggle('is-active', active);
      const check = btn.querySelector('.i18n-lang-check');
      if (check) check.textContent = active ? '✓' : '';
    });
  }

  applyDOMTranslations() {
    // Input de búsqueda
    const searchInput = document.getElementById('searchFilter');
    if (searchInput) searchInput.placeholder = this.t('searchPlaceholder');

    // Botón primer categoría "Todos"
    const catAll = document.querySelector('#categoryPills .cat-pill:first-child');
    if (catAll && catAll.textContent.trim().match(/Todos|All/i)) {
      catAll.textContent = this.t('allCategories');
    }

    // Modal comanda / Carrito
    const orderTitle = document.querySelector('#cartModal .modal-title');
    if (orderTitle) orderTitle.textContent = this.t('cartTitle');

    const submitBtn = document.querySelector('#cartModal .btn-wa-submit span');
    if (submitBtn) submitBtn.textContent = this.t('submitOrderWA');

    // Avisos de accesibilidad
    const a11ySpan = document.querySelector('.a11y-bar span');
    if (a11ySpan) a11ySpan.textContent = this.t('a11yNotice');

    const a11yBtn = document.querySelector('.btn-a11y-tts');
    if (a11yBtn) a11yBtn.textContent = this.t('listenCategory');

    // Conmutador 📖 Stories (solo si existe en esta página)
    const storiesToggle = document.getElementById('btnStoriesToggle');
    if (storiesToggle) {
      storiesToggle.setAttribute('title', this.t('storiesViewMenu'));
      storiesToggle.setAttribute('aria-label', this.t('storiesViewMenu'));
    }

    // Modal de reseñas (títulos estáticos; el resto lo setea smartReviews.js)
    const reviewTitle = document.getElementById('smartReviewTitle');
    if (reviewTitle) reviewTitle.textContent = this.t('reviewTitle');
  }
}
