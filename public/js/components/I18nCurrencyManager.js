/**
 * I18nCurrencyManager.js
 * Gestor dinámico de Internacionalización (i18n) y Selector de Moneda en vivo para ScanGo.
 * 
 * Idiomas: Español (es), English (en), Português (pt)
 * Monedas: $UYU, $USD, $ARS con conversión y actualización de formato en vivo.
 */

export const TRANSLATIONS = {
  es: {
    searchPlaceholder: '🔍 Buscar plato, ingrediente...',
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
    inCart: 'en comanda',
    floatingCartItems: 'ítems',
    viewCart: 'Ver Comanda',
    cartTitle: '🛒 Tu Comanda / Pedido',
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
    notesPlaceholder: 'Ej: Sin sal, salsa aparte, servilletas extra...',
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
    allDishesLoaded: 'No hay platos cargados aún.'
  },
  en: {
    searchPlaceholder: '🔍 Search dish, ingredient...',
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
    notesPlaceholder: 'e.g. No salt, dressing on the side, extra napkins...',
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
    allDishesLoaded: 'No dishes available yet.'
  },
  pt: {
    searchPlaceholder: '🔍 Buscar prato, ingrediente...',
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
    inCart: 'no pedido',
    floatingCartItems: 'itens',
    viewCart: 'Ver Pedido',
    cartTitle: '🛒 Seu Pedido / Comanda',
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
    notesPlaceholder: 'Ex: Sem sal, molho à parte, guardanapos extras...',
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
    allDishesLoaded: 'Nenhum prato disponível ainda.'
  }
};

export const CURRENCY_CONFIG = {
  '$UYU': { symbol: '$', label: '$ UYU', rateFromUYU: 1 },
  '$USD': { symbol: 'US$', label: 'US$ USD', rateFromUYU: 0.025 }, // 1 USD = 40 UYU
  '$ARS': { symbol: '$', label: '$ ARS', rateFromUYU: 30 } // 1 UYU = 30 ARS (1 USD = 1200 ARS)
};

export class I18nCurrencyManager {
  constructor(options = {}) {
    this.currentLang = options.defaultLang || 'es';
    this.currentCurrency = options.defaultCurrency || '$UYU';
    this.onStateChange = options.onStateChange || (() => {});
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
    this.applyDOMTranslations();
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

    container.innerHTML = `
      <div class="i18n-currency-bar" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; font-size: 0.8rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-chalk); border-radius: 20px; padding: 4px 12px;">
        
        <!-- Selector de Idioma -->
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="color: var(--chalk-dim);">🌐</span>
          <div style="display: flex; gap: 4px;">
            <button type="button" class="btn-i18n-pill ${this.currentLang === 'es' ? 'active' : ''}" 
                    style="background: ${this.currentLang === 'es' ? 'var(--chalk-gold)' : 'transparent'}; color: ${this.currentLang === 'es' ? '#101614' : 'var(--chalk-muted)'}; border: none; border-radius: 12px; padding: 2px 7px; font-size: 0.72rem; font-weight: 700; cursor: pointer;"
                    onclick="window.i18nManager.setLanguage('es')">ES</button>
            <button type="button" class="btn-i18n-pill ${this.currentLang === 'en' ? 'active' : ''}" 
                    style="background: ${this.currentLang === 'en' ? 'var(--chalk-gold)' : 'transparent'}; color: ${this.currentLang === 'en' ? '#101614' : 'var(--chalk-muted)'}; border: none; border-radius: 12px; padding: 2px 7px; font-size: 0.72rem; font-weight: 700; cursor: pointer;"
                    onclick="window.i18nManager.setLanguage('en')">EN</button>
            <button type="button" class="btn-i18n-pill ${this.currentLang === 'pt' ? 'active' : ''}" 
                    style="background: ${this.currentLang === 'pt' ? 'var(--chalk-gold)' : 'transparent'}; color: ${this.currentLang === 'pt' ? '#101614' : 'var(--chalk-muted)'}; border: none; border-radius: 12px; padding: 2px 7px; font-size: 0.72rem; font-weight: 700; cursor: pointer;"
                    onclick="window.i18nManager.setLanguage('pt')">PT</button>
          </div>
        </div>

        <!-- Selector de Moneda -->
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="color: var(--chalk-dim);">💵</span>
          <select id="selectCurrencySwitcher" 
                  style="background: transparent; color: var(--chalk-gold); border: 1px solid var(--border-gold); border-radius: 10px; font-size: 0.72rem; font-weight: 700; padding: 2px 6px; outline: none; cursor: pointer;"
                  onchange="window.i18nManager.setCurrency(this.value)">
            <option value="$UYU" ${this.currentCurrency === '$UYU' ? 'selected' : ''} style="background:#151D1A; color:#fff;">$ UYU</option>
            <option value="$USD" ${this.currentCurrency === '$USD' ? 'selected' : ''} style="background:#151D1A; color:#fff;">US$ USD</option>
            <option value="$ARS" ${this.currentCurrency === '$ARS' ? 'selected' : ''} style="background:#151D1A; color:#fff;">$ ARS</option>
          </select>
        </div>

      </div>
    `;

    window.i18nManager = this;
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
  }
}
