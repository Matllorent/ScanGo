/**
 * Sanitizador de payload de restaurante
 * Centraliza validación y saneamiento para /api/studio/save, /api/studio/events, /api/studio/branches
 */
const { sanitizeModifierGroups, sanitizeDishOptionConfig } = require('./menuOptions');
const {
  IMAGE_MODES,
  MENU_SIZING_MODES,
  LAYOUT_IDS,
  CLASSIC_THEME_IDS,
  HELADERIA_THEME_IDS
} = require('./themeManifest');

// Morfologías y paletas vienen del MANIFEST CANÓNICO (api/utils/themeManifest.js):
// una sola lista para el backend, el frontend (espejo ESM generado por
// scripts/regen-theme-manifest.js) y el Studio. La paridad la garantiza
// tests/test-theme-manifest.js (mismo patrón que CSP ↔ vercel.json).
const ALLOWED_LAYOUTS = LAYOUT_IDS;
const NEON_ACCENT_KEYS = ['mint', 'cyan', 'magenta', 'amber', 'lime', 'violet'];
const CLASSIC_THEMES = CLASSIC_THEME_IDS;
// Heladería: rubro de primera clase con estética propia (12 paletas).
// Un cliente heladería SOLO puede elegir estas (el Studio los filtra y el
// backend los impone: cualquier otro theme se corrige a helado-fiesta).
const HELADERIA_THEMES = HELADERIA_THEME_IDS;
const ALL_THEMES = [...CLASSIC_THEMES, ...HELADERIA_THEMES];
// Estilos del botón "Armá tu helado artesanal" (CTA protagonista del menú).
// 6 variantes premium, obviamente de heladería, elegibles por el dueño.
const ICE_CREAM_BUTTON_STYLES = ['clasico', 'fiesta', 'premium', 'tropical', 'nube', 'noche'];
const ALLOWED_WEATHER_TAGS = ['muy_frio', 'frio', 'templado', 'caluroso', 'muy_caluroso'];
const ALLOWED_TEAM_ROLES = ['admin', 'waiter', 'kitchen'];
const COUPON_TYPES = ['percent', 'free_delivery'];
const WEDDING_ITINERARY_MAX_ITEMS = 12;
// Visibilidad SEO local (marcado JSON-LD de /m/:slug): priceRange con allowlist
// estricta ($..$$$$), sameAs solo http(s) y geo lat/lng numérico con rangos reales.
const PRICE_RANGE_TOKENS = ['$', '$$', '$$$', '$$$$'];
const MAX_SAME_AS_URLS = 3;

function sanitizeString(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function sanitizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^0-9+]/g, '').slice(0, 20);
}

function sanitizeUrl(url, maxLen = 500) {
  if (!url) return '';
  const clean = String(url).trim().slice(0, maxLen);
  if (!clean) return '';
  // Solo http/https (case-insensitive). Rechaza javascript:, data:,
  // vbscript:, file: y protocol-relative (//host/...) sin esquema válido.
  if (!/^https?:\/\//i.test(clean)) return '';
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!parsed.hostname) return '';
    return clean;
  } catch {
    return '';
  }
}

// Links de redes sociales: solo http(s). sanitizeUrl deja pasar esquemas como
// `javascript:` (new URL no falla) — no queremos eso en un <a href=...>.
function sanitizeSocialUrl(url, maxLen = 500) {
  const s = sanitizeUrl(url, maxLen);
  return /^https?:\/\//i.test(s) ? s : '';
}

// Video del plato (Stories): link MP4/WebM directo por plato. Reglas:
// - Solo https (nunca http: evita mixed-content que frena el autoplay; nunca
//   javascript:/data:/blob: — data:Base64 inflaría las filas y ciega la cuota).
// - Extensión de contenedor reproducible en todos los browsers (.mp4/.webm;
//   .mov NO: Safari sí, Chrome no). Se valida el pathname (ignora ?query de
//   URLs firmadas). Vacío/inválido → '' (la historia cae a la foto).
const VIDEO_EXTS = ['.mp4', '.webm'];
function sanitizeVideoUrl(url, maxLen = 500) {
  const s = sanitizeUrl(url, maxLen);
  if (!/^https:\/\//i.test(s)) return '';
  try {
    const path = new URL(s).pathname.toLowerCase();
    if (!VIDEO_EXTS.some(ext => path.endsWith(ext))) return '';
    return s;
  } catch {
    return '';
  }
}

// Rango de precios para el JSON-LD: allowlist estricta ($..$$$$). Cualquier
// otro valor (vacío, texto libre, <script>) → '' (nunca inventa ni pasa crudo).
function sanitizePriceRange(raw) {
  const s = sanitizeString(raw, 5).trim();
  return PRICE_RANGE_TOKENS.includes(s) ? s : '';
}

// `sameAs` de schema.org: URLs únicas y solo http(s) (sanitizeUrl ya descarta
// javascript:/data:). Un string suelto se normaliza a [url]; máximo 3 entradas.
function sanitizeSameAs(raw) {
  if (raw === undefined || raw === null) return [];
  const entries = Array.isArray(raw) ? raw : [raw];
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const url = sanitizeUrl(entry, 500);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
      if (out.length >= MAX_SAME_AS_URLS) break;
    }
  }
  return out;
}

// Coordenadas para GeoCoordinates: numérico finito dentro del rango real del
// planeta, redondeado a 6 decimales (~1m). Fuera de rango/no numérico → null.
function sanitizeLatLng(raw, min, max) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 1e6) / 1e6;
}

function generateId(prefix = '') {
  return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function ensureUniqueSlug(baseSlug, seenSlugs) {
  let slug = String(baseSlug || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30);

  let uniqueSlug = slug;
  let counter = 1;
  while (seenSlugs.has(uniqueSlug)) {
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }
  seenSlugs.add(uniqueSlug);
  return uniqueSlug;
}

function sanitizeDish(d) {
  return {
    id: String(d.id || generateId('d_')).slice(0, 50),
    categoryId: String(d.categoryId || ''),
    name: sanitizeString(d.name || 'Sin nombre', 100),
    price: Math.max(0, parseFloat(d.price) || 0),
    originalPrice: (d.originalPrice !== undefined && d.originalPrice !== null && !isNaN(parseFloat(d.originalPrice)))
      ? Math.max(0, parseFloat(d.originalPrice))
      : null,
    description: sanitizeString(d.description || '', 400),
    photoUrl: sanitizeUrl(d.photoUrl || d.imageUrl || d.image || d.photo, 5000000),
    videoUrl: sanitizeVideoUrl(d.videoUrl || d.video || '', 500),
    outOfStock: Boolean(d.outOfStock),
    isChefSpecial: Boolean(d.isChefSpecial),
    // Recargo premium en el armador de helado (ej: pistacho +$80). Solo lo usa
    // la heladería; en el resto de la carta se ignora. Nunca negativo.
    iceCreamSurcharge: Math.max(0, Math.min(1000000, parseFloat(d.iceCreamSurcharge) || 0)),
    weatherTags: Array.isArray(d.weatherTags)
      ? [...new Set(d.weatherTags.map(tag => String(tag)))].filter(tag => ALLOWED_WEATHER_TAGS.includes(tag))
      : [],
    schedule: d.schedule && typeof d.schedule === 'object' ? {
      enabled: Boolean(d.schedule.enabled),
      days: Array.isArray(d.schedule.days) ? d.schedule.days.map(Number).filter(n => n >= 0 && n <= 6) : [0,1,2,3,4,5,6],
      timeStart: sanitizeString(d.schedule.timeStart || '00:00', 5),
      timeEnd: sanitizeString(d.schedule.timeEnd || '23:59', 5),
      behavior: d.schedule.behavior === 'badge' ? 'badge' : 'hide',
      overridePrice: (d.schedule.overridePrice !== undefined && d.schedule.overridePrice !== null && !isNaN(parseFloat(d.schedule.overridePrice)))
        ? Math.max(0, parseFloat(d.schedule.overridePrice))
        : null,
      originalPriceRef: (d.schedule.originalPriceRef !== undefined && d.schedule.originalPriceRef !== null && !isNaN(parseFloat(d.schedule.originalPriceRef)))
        ? Math.max(0, parseFloat(d.schedule.originalPriceRef))
        : null
    } : null,
    ...sanitizeDishOptionConfig(d),
    kid_friendly: Boolean(d.kid_friendly),
    allergens: Array.isArray(d.allergens)
      ? [...new Set(d.allergens.map(a => String(a).toLowerCase().trim()))].filter(Boolean)
      : [],
    tags: Array.isArray(d.tags) ? d.tags.slice(0, 8).map(t => sanitizeString(t, 25)) : []
  };
}

function sanitizeCategory(c) {
  return {
    id: String(c.id || generateId('cat_')).slice(0, 50),
    name: sanitizeString(c.name || 'Categoría', 60)
  };
}

function sanitizeBranch(b, idx, existingSlugs) {
  return {
    id: String(b.id || generateId('br_')).slice(0, 50),
    name: sanitizeString(b.name || `Sucursal ${idx + 1}`, 80),
    slug: ensureUniqueSlug(b.slug || b.name || `sucursal-${idx + 1}`, existingSlugs),
    phone: sanitizePhone(b.phone),
    address: sanitizeString(b.address || '', 200),
    overridePrices: b.overridePrices && typeof b.overridePrices === 'object' ? b.overridePrices : {},
    customDishes: Array.isArray(b.customDishes) ? b.customDishes.slice(0, 50) : [],
    createdAt: b.createdAt || new Date().toISOString()
  };
}

function sanitizeDeliveryZone(z) {
  return {
    name: sanitizeString(z.name || 'Zona', 60),
    fee: Math.max(0, parseFloat(z.fee) || 0)
  };
}

// Heladería: tamaños y toppings configurables por el dueño (el wizard cae a
// los defaults de IceCreamPresets.js cuando el local no define los suyos).
// Sin inventos: precios ≥ 0, maxFlavors entero 1..6, ids saneados.
function sanitizeIceCreamContainer(c, idx) {
  if (!c || typeof c !== 'object') return null;
  const maxFlavors = parseInt(c.maxFlavors, 10);
  return {
    id: sanitizeString(c.id || generateId('cont_'), 40) || `cont_${idx}`,
    name: sanitizeString(c.name || 'Tamaño', 40),
    capacityLabel: sanitizeString(c.capacityLabel || '', 30),
    maxFlavors: Number.isInteger(maxFlavors) ? Math.max(1, Math.min(6, maxFlavors)) : 1,
    price: Math.max(0, Math.min(1000000, parseFloat(c.price) || 0)),
    icon: sanitizeString(c.icon || '🍦', 8),
    badge: sanitizeString(c.badge || '', 20)
  };
}

function sanitizeIceCreamTopping(t, idx) {
  if (!t || typeof t !== 'object') return null;
  const kind = sanitizeString(t.kind || '', 10).toLowerCase();
  return {
    id: sanitizeString(t.id || generateId('top_'), 40) || `top_${idx}`,
    name: sanitizeString(t.name || 'Topping', 60),
    price: Math.max(0, Math.min(1000000, parseFloat(t.price) || 0)),
    icon: sanitizeString(t.icon || '✨', 8),
    kind: kind === 'salsa' ? 'salsa' : 'topping'
  };
}

function sanitizeIceCreamContainers(arr) {
  if (!Array.isArray(arr)) return undefined;
  // Solo filas con nombre real: las vacías del editor se descartan.
  const clean = arr
    .filter(c => c && typeof c === 'object' && String(c.name || '').trim())
    .slice(0, 12)
    .map(sanitizeIceCreamContainer)
    .filter(Boolean);
  return clean.length ? clean : undefined;
}

function sanitizeIceCreamToppings(arr) {
  if (!Array.isArray(arr)) return undefined;
  const clean = arr
    .filter(t => t && typeof t === 'object' && String(t.name || '').trim())
    .slice(0, 30)
    .map(sanitizeIceCreamTopping)
    .filter(Boolean);
  return clean.length ? clean : undefined;
}

function sanitizeEventConfigMenuSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections.slice(0, 20).map(section => ({
    id: sanitizeString(section.id || generateId('sec_'), 40),
    title: sanitizeString(section.title || '', 80),
    icon: sanitizeString(section.icon || '', 10),
    items: Array.isArray(section.items) ? section.items.slice(0, 50).map(item => ({
      name: sanitizeString(item.name || '', 100),
      desc: sanitizeString(item.desc || '', 300),
      icon: sanitizeString(item.icon || '', 10),
      kid_friendly: Boolean(item.kid_friendly),
      allergens: Array.isArray(item.allergens)
        ? [...new Set(item.allergens.map(a => String(a).toLowerCase().trim()))].filter(Boolean)
        : [],
      pairing: sanitizeString(item.pairing || '', 80)
    })) : []
  }));
}

function sanitizeEventConfigGuests(guests) {
  if (!Array.isArray(guests)) return [];
  return guests.slice(0, 500).map(g => ({
    id: sanitizeString(g.id || generateId('gst_'), 60),
    name: sanitizeString(g.name || 'Invitado', 80),
    // Teléfono del invitado (para la invitación por WhatsApp). Mismo
    // tratamiento que parentContact: solo dígitos, máx 20.
    phone: sanitizePhone(g.phone),
    whatsapp: sanitizePhone(g.whatsapp || g.phone),
    isChild: Boolean(g.isChild),
    parentGuestId: g.parentGuestId ? sanitizeString(g.parentGuestId, 60) : null,
    parentContact: g.parentContact ? {
      name: sanitizeString(g.parentContact.name || '', 80),
      phone: sanitizePhone(g.parentContact.phone),
      whatsapp: sanitizePhone(g.parentContact.whatsapp || g.parentContact.phone)
    } : null,
    dietary: sanitizeString(g.dietary || '', 200),
    allergens: Array.isArray(g.allergens)
      ? [...new Set(g.allergens.map(a => String(a).toLowerCase().trim()))].filter(Boolean)
      : [],
    tableId: g.tableId ? sanitizeString(g.tableId, 60) : null,
    seatNumber: g.seatNumber ? Math.max(1, Math.min(20, parseInt(g.seatNumber) || 1)) : null,
    qrToken: sanitizeString(g.qrToken || generateId('qr_'), 80),
    createdAt: g.createdAt || new Date().toISOString()
  }));
}

// Itinerario visual de boda/evento: programa cronológico configurable.
// Espejo server-side del módulo frontend weddingItinerary.js (misma semántica).
function sanitizeWeddingItinerary(raw) {
  // EventDay en el default: el espejo frontend (public/js/menu/weddingItinerary.js)
  // ya lo incluía; sin él, sanitizar dos veces cambiaba la forma ({} → {eventDay:''})
  // y rompía la idempotencia (regresión cazada por tests/test-money-properties.js).
  const empty = { enabled: false, title: 'Programa de Boda', coupleNames: '', date: '', eventDay: '', venue: '', items: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const rawDay = sanitizeString(raw.eventDay, 10);
  return {
    enabled: raw.enabled === true,
    title: sanitizeString(raw.title, 60) || 'Programa de Boda',
    coupleNames: sanitizeString(raw.coupleNames || raw.couple, 80),
    date: sanitizeString(raw.date, 60),
    eventDay: /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : '',
    venue: sanitizeString(raw.venue, 120),
    items: items.slice(0, WEDDING_ITINERARY_MAX_ITEMS).map(it => ({
      time: sanitizeString(it && it.time, 12),
      title: sanitizeString(it && it.title, 80),
      icon: sanitizeString(it && it.icon, 8) || '💛'
    })).filter(it => it.time || it.title)
  };
}

function sanitizeCustomCoupons(coupons) {
  if (!Array.isArray(coupons)) return [];
  return coupons.slice(0, 20).map(cp => ({
    code: sanitizeString(cp.code || '', 20).toUpperCase(),
    type: COUPON_TYPES.includes(cp.type) ? cp.type : 'percent',
    value: Math.max(0, Math.min(100, parseFloat(cp.value) || 0)),
    label: sanitizeString(cp.label || '', 40)
  })).filter(cp => cp.code.length >= 2);
}

function sanitizeTeamMembers(members) {
  if (!Array.isArray(members)) return [];
  return members.slice(0, 15).map(m => ({
    email: sanitizeString(m.email || '', 80).toLowerCase(),
    role: ALLOWED_TEAM_ROLES.includes(m.role) ? m.role : 'waiter',
    name: sanitizeString(m.name || '', 60),
    addedAt: m.addedAt || new Date().toISOString()
  })).filter(m => m.email.includes('@'));
}

/**
 * Sanea y valida el payload completo de un restaurante
 * @param {Object} data - Datos raw del request
 * @returns {Object} - Datos saneados y validados
 */
function sanitizeRestaurantPayload(data) {
  if (!data || typeof data !== 'object') return {};

  const clean = { ...data };

  // Campos básicos
  clean.name = sanitizeString(clean.name, 80);
  clean.bizName = sanitizeString(clean.bizName, 80);
  clean.slogan = sanitizeString(clean.slogan, 150);
  clean.phone = sanitizePhone(clean.phone);
  clean.city = sanitizeString(clean.city, 100);
  clean.smartWeatherEnabled = Boolean(clean.smartWeatherEnabled);
  clean.currency = sanitizeString(clean.currency, 5);
  clean.theme = sanitizeString(clean.theme, 30);
  clean.themeFont = sanitizeString(clean.themeFont, 30);
  clean.instagram = sanitizeString(clean.instagram, 40).replace(/[^a-zA-Z0-9._]/g, '');
  clean.facebook = sanitizeSocialUrl(clean.facebook, 500);
  clean.tiktok = sanitizeSocialUrl(clean.tiktok, 500);
  clean.x = sanitizeSocialUrl(clean.x, 500);
  clean.googleReview = sanitizeSocialUrl(clean.googleReview, 300);
  // Visibilidad SEO local (JSON-LD de /m/:slug): sin inventar datos ni dejar
  // pasar valores crudos. priceRange con allowlist, sameAs https únicos, geo numérico.
  clean.priceRange = sanitizePriceRange(clean.priceRange);
  clean.sameAs = sanitizeSameAs(clean.sameAs);
  clean.latitude = sanitizeLatLng(clean.latitude, -90, 90);
  clean.longitude = sanitizeLatLng(clean.longitude, -180, 180);
  clean.allowReservations = Boolean(clean.allowReservations);
  clean.allowCoupons = Boolean(clean.allowCoupons);
  clean.allowBillSplitter = Boolean(clean.allowBillSplitter);
  clean.announcement = sanitizeString(clean.announcement, 300);
  clean.paymentLink = sanitizeUrl(clean.paymentLink, 500);
  // Pago online del comensal: SOLO una posibilidad que el dueño habilita
  // explícitamente. Default false → la opción no aparece en el menú.
  clean.allowOnlinePayment = Boolean(clean.allowOnlinePayment);
  // Descubrir beta: opt-in explícito del dueño (default false: nadie aparece
  // sin querer). El feed solo lista locales con suscripción válida.
  clean.allowDiscovery = clean.allowDiscovery === true;
  clean.scheduleEnabled = Boolean(clean.scheduleEnabled);
  // Cierre manual del dueño (override del horario): estricto, default false.
  clean.forceClosed = clean.forceClosed === true;
  // Contador de cierre en el badge del menú ("Cierra en N min"): default
  // encendido (ausente = activado), el dueño puede apagarlo con un false.
  clean.showClosingCountdown = clean.showClosingCountdown !== false;
  // Servicio de mesa (QR de mesa): el dueño decide qué ofrece. Defaults
  // encendidos para no cambiar la experiencia actual de ningún local.
  clean.allowWaiterCall = clean.allowWaiterCall !== false;
  clean.allowBillRequest = clean.allowBillRequest !== false;
  // Carta vitrina: el dueño muestra los platos sin carrito ni pedidos
  // (default encendido: sin cambios para los locales actuales).
  clean.allowMenuOrders = clean.allowMenuOrders !== false;
  // Texto configurable del botón principal del armador de helado (vacío → default del frontend).
  clean.iceCreamBuilderLabel = sanitizeString(clean.iceCreamBuilderLabel, 60);
  // Estilo del botón del armador (6 variantes premium de heladería, default clasico).
  const normIceBtn = sanitizeString(clean.iceCreamButtonStyle, 20).toLowerCase().trim();
  clean.iceCreamButtonStyle = ICE_CREAM_BUTTON_STYLES.includes(normIceBtn) ? normIceBtn : 'clasico';

  // Layout
  const normLayout = sanitizeString(clean.layout, 20).toLowerCase().trim();
  clean.layout = ALLOWED_LAYOUTS.includes(normLayout) ? normLayout : 'classic';
  // Motor de plantillas: modo de imagen y sizing por popularidad. Se guardan
  // como INTENCIÓN del dueño (allowlist) y se resuelven contra las
  // capacidades del layout en el payload público (resolveImageMode /
  // resolveMenuSizing en el manifest): cambiar de morfología no borra la
  // elección, solo la apaga mientras no sea compatible con la nueva.
  const normImageMode = sanitizeString(clean.imageMode, 10).toLowerCase().trim();
  clean.imageMode = normImageMode === 'auto' || IMAGE_MODES.includes(normImageMode) ? normImageMode : 'auto';
  const normSizing = sanitizeString(clean.menuSizing, 12).toLowerCase().trim();
  clean.menuSizing = MENU_SIZING_MODES.includes(normSizing) ? normSizing : 'uniform';
  // Barra de filtros del menú (fija / auto-oculta / compacta, default fija).
  const normFilterBar = sanitizeString(clean.filterBarMode, 20).toLowerCase().trim();
  clean.filterBarMode = ['fixed', 'autohide', 'compact'].includes(normFilterBar) ? normFilterBar : 'fixed';
  // Acento neón del layout Neon Nightbar (allowlist, default mint)
  const normNeon = sanitizeString(clean.neonAccent, 20).toLowerCase().trim();
  clean.neonAccent = NEON_ACCENT_KEYS.includes(normNeon) ? normNeon : 'mint';
  // Color neón libre (picker HEX): override del preset. Solo #RRGGBB exacto;
  // cualquier otra cosa (vacío, nombres, `javascript:`, `expression(`) → ''.
  const rawNeonCustom = sanitizeString(clean.neonCustomColor, 20).trim();
  clean.neonCustomColor = /^#[0-9a-fA-F]{6}$/.test(rawNeonCustom)
    ? `#${rawNeonCustom.slice(1).toLowerCase()}`
    : '';

  // Eventos
  clean.businessType = sanitizeString(clean.businessType, 20);
  // Heladería SOLO viste temas de heladería: si el rubro es heladería y el
  // theme no es uno de los 11 propios, se corrige al default festivo.
  // (El Studio además filtra el selector; esto es el enforcement server-side
  // para que ningún payload viejo o manual cuele un theme de restaurante.)
  if (clean.businessType === 'heladeria' && !HELADERIA_THEMES.includes(clean.theme)) {
    clean.theme = 'helado-fiesta';
  }
  // Simétrico: un restaurante (o perfumería/evento) con theme de heladería
  // vuelve a emerald (el Studio ya no los ofrece fuera de heladería).
  if (clean.businessType !== 'heladeria' && HELADERIA_THEMES.includes(clean.theme)) {
    clean.theme = 'emerald';
  }
  clean.eventDate = sanitizeString(clean.eventDate, 30);
  clean.eventType = sanitizeString(clean.eventType, 50);
  clean.expiresAt = sanitizeString(clean.expiresAt, 30);
  clean.isEvent = Boolean(clean.isEvent);
  clean.eventCustomQR = sanitizeUrl(clean.eventCustomQR, 500);
  clean.scheduleActiveHours = sanitizeString(clean.scheduleActiveHours, 30);
  clean.tableCount = Math.max(1, Math.min(100, parseInt(clean.tableCount) || 1));

  // Media URLs (max 5MB base64)
  if (clean.logoUrl && typeof clean.logoUrl === 'string' && clean.logoUrl.length > 5000000) {
    clean.logoUrl = clean.logoUrl.slice(0, 5000000);
  }
  if (clean.bannerUrl && typeof clean.bannerUrl === 'string' && clean.bannerUrl.length > 5000000) {
    clean.bannerUrl = clean.bannerUrl.slice(0, 5000000);
  }

  // Arrays complejos
  if (Array.isArray(clean.dishes)) {
    clean.dishes = clean.dishes.slice(0, 400).map(sanitizeDish);
  }
  clean.modifierGroups = sanitizeModifierGroups(clean.modifierGroups);
  if (Array.isArray(clean.categories)) {
    clean.categories = clean.categories.slice(0, 60).map(sanitizeCategory);
  }
  if (Array.isArray(clean.deliveryZones)) {
    clean.deliveryZones = clean.deliveryZones.slice(0, 25).map(sanitizeDeliveryZone);
  }

  // Branches
  if (Array.isArray(clean.branches)) {
    const seenSlugs = new Set();
    clean.branches = clean.branches.slice(0, 20).map((b, idx) => sanitizeBranch(b, idx, seenSlugs));
  }

  // Event Config
  if (clean.eventConfig) {
    clean.eventConfig.menuSections = sanitizeEventConfigMenuSections(clean.eventConfig.menuSections);
    clean.eventConfig.guests = sanitizeEventConfigGuests(clean.eventConfig.guests);
  }

  // Itinerario visual de boda/evento (programa configurable por el dueño)
  clean.weddingItinerary = sanitizeWeddingItinerary(clean.weddingItinerary);

  // Coupons & Team
  clean.customCoupons = sanitizeCustomCoupons(clean.customCoupons);
  clean.teamMembers = sanitizeTeamMembers(clean.teamMembers);

  // Heladería: tamaños y toppings del dueño (undefined = defaults del wizard).
  clean.iceCreamContainers = sanitizeIceCreamContainers(clean.iceCreamContainers);
  clean.iceCreamToppings = sanitizeIceCreamToppings(clean.iceCreamToppings);

  return clean;
}

/**
 * Sanea solo un objeto de sucursal (para PATCH /api/studio/branches)
 * @param {Object} branch - Datos raw de la sucursal
 * @param {Array} existingBranches - Sucursales existentes para unicidad de slug
 * @returns {Object} - Sucursal saneada
 */
function sanitizeBranchPayload(branch, existingBranches = []) {
  if (!branch || typeof branch !== 'object') return null;

  const seenSlugs = new Set(existingBranches.map(b => b.slug).filter(Boolean));

  return {
    id: String(branch.id || '').slice(0, 50),
    name: sanitizeString(branch.name || '', 80),
    slug: ensureUniqueSlug(branch.slug || branch.name || 'sucursal', seenSlugs),
    phone: sanitizePhone(branch.phone),
    address: sanitizeString(branch.address || '', 200),
    overridePrices: branch.overridePrices && typeof branch.overridePrices === 'object' ? branch.overridePrices : {},
    customDishes: Array.isArray(branch.customDishes) ? branch.customDishes.slice(0, 50) : [],
    createdAt: branch.createdAt || new Date().toISOString()
  };
}

module.exports = {
  sanitizeRestaurantPayload,
  sanitizeBranchPayload,
  sanitizeString,
  sanitizePhone,
  sanitizeUrl,
  sanitizeVideoUrl,
  generateId,
  ensureUniqueSlug,
  ALLOWED_LAYOUTS,
  NEON_ACCENT_KEYS,
  CLASSIC_THEMES,
  HELADERIA_THEMES,
  ALL_THEMES,
  ICE_CREAM_BUTTON_STYLES,
  ALLOWED_WEATHER_TAGS,
  ALLOWED_TEAM_ROLES,
  COUPON_TYPES
};