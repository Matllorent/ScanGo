/**
 * api/routes/menu.js
 * ──────────────────
 * Menú público (/api/demos*, /api/menu/:slug): catálogo in-memory de demos
 * (siempre online) + carta real con branches, clima, i18n y timeout 800ms
 * con fallback stale. Extraído de api/index.js sin cambios de comportamiento.
 * Se monta como app.use('/api', menuRouter).
 */
const express = require('express');
const db = require('../../src/db/db');
const billingOrchestrator = require('../../src/billing/orchestrator');
const mpService = require('../../src/services/mercadopago');
const loyaltyService = require('../services/loyalty');
const { getWeatherContext } = require('../services/weather');
const { menuCacheMiddleware, getCachedMenu } = require('../middleware/cache');
const { getDemoRestaurant, listDemoRestaurants, normalizeDemoType } = require('../utils/demoRestaurants');
const { resolveBranchOverridePrice, normalizeBranchCustomDishes } = require('../utils/menuResponse');
const { resolveImageMode, resolveMenuSizing, layoutSupportsMenuSizing } = require('../utils/themeManifest');
const { computePopTiers } = require('../utils/popularityTiers');
const dailyStockTracker = require('../utils/dailyStockTracker');
const dishTrending = require('../utils/dishTrending');
const { getPrepEstimateBundleForRestaurant } = require('../services/prepEstimate');
const escapeHtml = require('../utils/escapeHtml');

const router = express.Router();

// F5 "Tendencia honesta": cache en proceso de las etiquetas por local. La
// evidencia son las ventas REALES de los últimos 7 días (no clicks ni proxy
// del chef), así que un refresco cada 10 min es de sobra — máximo 6 consultas
// por hora y local, y NUNCA corre para un local que apagó el chip.
const trendingLabelsCache = new Map(); // restaurantId -> { at, labels }

async function resolveTrendingLabels(restaurant, dishes) {
  const restaurantId = restaurant && restaurant.id;
  if (!restaurantId) return new Map();
  const cached = trendingLabelsCache.get(restaurantId);
  if (cached && (Date.now() - cached.at) < dishTrending.TRENDING_CACHE_MS) {
    return cached.labels;
  }
  const window = dishTrending.getTrendingWindow(Date.now());
  const rows = await db.getSoldQtyForDay(restaurantId, window.startIso, window.endIso);
  // Misma agregación que F3: los cancelados no son ventas y las líneas sin
  // dishId legible (helado a medida, snapshots viejos) se saltan.
  const soldByDish = dailyStockTracker.sumSoldByDish(rows);
  const labels = dishTrending.computeTrendingLabels(soldByDish, dishes);
  // Cota del cache: un Map por local no puede crecer sin límite en un proceso
  // serverless long-lived (el deploy free corre caliente por horas).
  if (trendingLabelsCache.size > 500) trendingLabelsCache.clear();
  trendingLabelsCache.set(restaurantId, { at: Date.now(), labels });
  return labels;
}

function buildDemoMenuResponse(typeOrSlug, opts = {}) {
  const demo = getDemoRestaurant(typeOrSlug);
  if (!demo) return null;
  const isEvent = demo.businessType === 'events';
  const demoLayout = demo.layout || 'classic';
  const dishes = (demo.dishes || []).map(d => ({
    ...d,
    previous_price: d.previous_price || d.previousPrice || null,
    is_chef_recommended: Boolean(d.is_chef_recommended || d.isChefRecommended)
  }));
  // Motor de plantillas (paridad con la ruta real): `?sizing=popularity` es
  // preview aunque la demo no lo tenga guardado, si la morfología lo soporta.
  const sizingPreview = opts.sizing === 'popularity';
  const effectiveMenuSizing = (sizingPreview && layoutSupportsMenuSizing(demoLayout, 'popularity'))
    ? 'popularity'
    : resolveMenuSizing(demoLayout, demo.menuSizing);
  const demoDishes = effectiveMenuSizing === 'popularity'
    ? (() => {
        const tiers = computePopTiers(dishes, demo.analytics && demo.analytics.dishPopularity);
        return dishes.map(d => ({ ...d, popTier: tiers.has(d.id) ? tiers.get(d.id) : 1 }));
      })()
    : dishes;
  const publicData = {
    id: demo.id,
    organizationId: null,
    slug: demo.slug,
    name: demo.name,
    bizName: demo.bizName || demo.name,
    phone: demo.phone || '',
    scheduleActiveHours: demo.scheduleActiveHours || '',
    tableCount: demo.tableCount || 10,
    activeBranch: null,
    branches: [],
    slogan: demo.slogan || '',
    currency: demo.currency || '$',
    city: demo.city || '',
    smartWeatherEnabled: false,
    weatherContext: null,
    weatherTemperatureC: null,
    theme: demo.theme || 'emerald',
    themeFont: demo.themeFont || 'serif',
    neonAccent: demo.neonAccent || 'mint',
    neonCustomColor: demo.neonCustomColor || '',
    forceClosed: demo.forceClosed === true,
    instagram: demo.instagram || '',
    facebook: demo.facebook || '',
    tiktok: demo.tiktok || '',
    x: demo.x || '',
    googleReview: demo.googleReview || '',
    allowReservations: demo.allowReservations !== false,
    allowCoupons: demo.allowCoupons !== false,
    allowBillSplitter: demo.allowBillSplitter === true,
    allowWaiterCall: demo.allowWaiterCall !== false,
    allowBillRequest: demo.allowBillRequest !== false,
    allowMenuOrders: demo.allowMenuOrders !== false,
    announcement: demo.announcement || '',
    paymentLink: '',
    allowOnlinePayment: false,
    onlinePaymentReady: false,
    scheduleEnabled: Boolean(demo.scheduleEnabled),
    // Contador de cierre en el badge (default encendido cuando el campo falta).
    showClosingCountdown: demo.showClosingCountdown !== false,
    // F7: una demo no tiene pedidos reales, así que nunca inventa un ETA.
    showPrepEstimate: demo.showPrepEstimate !== false,
    prepEstimate: null,
    prepEstimateByMode: null,
    customCoupons: [],
    allowLoyaltyPoints: false,
    loyaltyConfig: loyaltyService.getPublicLoyaltyConfig(demo),
    logoUrl: demo.logoUrl || null,
    bannerUrl: demo.bannerUrl || null,
    layout: demoLayout,
    imageMode: resolveImageMode(demoLayout, demo.imageMode),
    menuSizing: effectiveMenuSizing,
    businessType: demo.businessType || 'restaurant',
    allowIceCreamWizard: demo.allowIceCreamWizard === true,
    iceCreamBuilderLabel: demo.iceCreamBuilderLabel || '',
    iceCreamButtonStyle: demo.iceCreamButtonStyle || 'fiesta',
    iceCreamContainers: Array.isArray(demo.iceCreamContainers) ? demo.iceCreamContainers : null,
    iceCreamToppings: Array.isArray(demo.iceCreamToppings) ? demo.iceCreamToppings : null,
    allowPerfumery: demo.allowPerfumery === true,
    wifi: demo.wifi || { ssid: '', password: '' },
    categories: demo.categories || [],
    modifierGroups: demo.modifierGroups || [],
    dishes: demoDishes,
    deliveryZones: demo.deliveryZones || [],
    updatedAt: demo.updatedAt,
    weddingItinerary: demo.weddingItinerary || null,
    isEvent,
    eventDate: demo.eventDate,
    eventType: demo.eventType,
    expiresAt: demo.expiresAt,
    eventCustomQR: demo.eventCustomQR,
    isDemo: true
  };
  const response = {
    restaurant: publicData,
    weatherContext: null,
    weatherTemperatureC: null,
    isDemo: true
  };
  if (isEvent) {
    response.isEvent = true;
    response.eventDate = demo.eventDate;
    response.expiresAt = demo.expiresAt;
  } else {
    response.access = { inGracePeriod: false };
  }
  return response;
}

// Lista de demos (metadatos para la galería de la landing).
router.get('/demos', (req, res) => {
  return res.status(200).json({ demos: listDemoRestaurants() });
});

// Demo completa por tipo (lo que el Studio en modo demo carga en el editor).
router.get('/demos/:type', (req, res) => {
  const demo = getDemoRestaurant(req.params.type);
  if (!demo) return res.status(404).json({ error: 'Demo no encontrada' });
  return res.status(200).json({ demo, isDemo: true });
});

router.get('/menu/:slug', menuCacheMiddleware, async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  // Demos públicas por rubro: catálogo in-memory, siempre online.
  // Se sirve ANTES del cache single-flight para que la key demo:* nunca
  // colisione con un restaurante real del mismo slug.
  const demoType = normalizeDemoType(slug);
  if (demoType) {
    try {
      return res.status(200).json(buildDemoMenuResponse(demoType, { sizing: req.query.sizing }));
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo cargar la demo' });
    }
  }
  try {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('DB_TIMEOUT_800MS')), 800);
    });

    // Multi-Branch Hierarchy Support (?branch= or ?sucursal=)
    // Resuelto ANTES del single-flight cache: la key incluye la sucursal para que
    // ?branch=centro y el menú base no compartan entrada (5s TTL) y se contaminen.
    // ?sizing=popularity también cambia la respuesta (menuSizing + popTier), así
    // que entra en la key por la misma razón que la sucursal.
    const reqBranch = (req.query.branch || req.query.sucursal || '').toLowerCase().trim();
    const reqSizing = req.query.sizing === 'popularity' ? ':sizing:popularity' : '';
    const activeBranchCacheKey = `${slug}:branch:${reqBranch}${reqSizing}`;

    const fetchPromise = getCachedMenu(activeBranchCacheKey, async () => {
      let restaurant = db.findRestaurantBySlug(slug);
      if (!restaurant) restaurant = await db.lazyLoadRestaurant(slug);
      if (!restaurant) return null;

      // Events mode: el corte duro es la fecha del evento (expiry), pero la
      // suscripción también importa: el dueño paga un one-off (`event_once`)
      // para que el menú esté online hasta eventDate. Sin pago tras el trial,
      // verifyAccess pausa el evento como a cualquier restaurante.
      const isEvent = restaurant.businessType === 'events' || restaurant.isEvent === true;
      let access = null;
      if (isEvent) {
        const expiresAt = restaurant.expiresAt ? new Date(restaurant.expiresAt) : null;
        const eventDate = restaurant.eventDate ? new Date(restaurant.eventDate) : null;
        const expiryCheck = expiresAt || eventDate;
        
        if (expiryCheck && expiryCheck < new Date()) {
          return {
            inactive: true,
            warning: 'Este evento ha finalizado. El menú ya no está disponible.',
            isEvent: true,
            expired: true
          };
        }
        // El evento sigue dentro de la fecha: la suscripción decide si está online
        access = billingOrchestrator.verifyAccess(restaurant.id);
        if (!access.allowed) {
          return {
            inactive: true,
            warning: access.warning,
            isEvent: true
          };
        }
      } else {
        // Regular restaurant - verify subscription
        access = billingOrchestrator.verifyAccess(restaurant.id);
        if (!access.allowed) {
          return {
            inactive: true,
            warning: access.warning
          };
        }
      }

      let weather = null;
      if (restaurant.smartWeatherEnabled && restaurant.city) {
        weather = await getWeatherContext(restaurant.city);
      }

      // Multi-Branch Hierarchy Support (?branch= or ?sucursal=)
      let activeBranch = null;

      if (reqBranch && Array.isArray(restaurant.branches)) {
        activeBranch = restaurant.branches.find(b =>
          (b.id || '').toLowerCase() === reqBranch || (b.slug || '').toLowerCase() === reqBranch
        );
      }

      // Base dishes inheritance & price overrides for branch
      let inheritedDishes = [...(restaurant.dishes || [])];
      let publicCategories = Array.isArray(restaurant.categories) ? restaurant.categories.map(c => ({ ...c })) : [];
      if (activeBranch) {
        if (activeBranch.overridePrices && typeof activeBranch.overridePrices === 'object') {
          inheritedDishes = inheritedDishes.map(d => ({
            ...d,
            price: resolveBranchOverridePrice(activeBranch.overridePrices, d.id, d.price),
            previous_price: d.price
          }));
        }
        // Normalizar customDishes: sintetizar categoryId y asegurar que su
        // categoría exista en la respuesta (si no, el menú público los ignora).
        const normalized = normalizeBranchCustomDishes(publicCategories, inheritedDishes, activeBranch.customDishes);
        publicCategories = normalized.categories;
        inheritedDishes = normalized.dishes;
      }

      // Smart Menu Sorting & Filtering
      const reqHour = req.query.hour || req.query.mealTime || '';
      const reqDay = typeof req.query.day !== 'undefined' ? parseInt(req.query.day) : new Date().getDay();
      const reqLang = (req.query.lang || 'es').toLowerCase();

      let dishes = inheritedDishes.map(d => {
        // F6 "Estaciones de cocina": la estación es dato OPERATIVO del local
        // (a qué sector va el plato), no del comensal — no viaja en el payload
        // público. La pizarra KDS la resuelve desde su propia sesión.
        const { station, ...dishPublic } = d;
        const trans = d.translations?.[reqLang];
        return {
          ...dishPublic,
          name: trans?.name || d.name,
          description: trans?.description || d.description,
          previous_price: d.previous_price || d.previousPrice || null,
          is_chef_recommended: Boolean(d.is_chef_recommended || d.isChefRecommended)
        };
      });

      // Priority sorting: Chef recommended on top, followed by matching hour & day slots
      dishes.sort((a, b) => {
        const aChef = a.is_chef_recommended ? 1 : 0;
        const bChef = b.is_chef_recommended ? 1 : 0;
        if (aChef !== bChef) return bChef - aChef;

        if (reqHour) {
          const aHours = Array.isArray(a.available_hours || a.availableHours) ? (a.available_hours || a.availableHours) : [];
          const bHours = Array.isArray(b.available_hours || b.availableHours) ? (b.available_hours || b.availableHours) : [];
          const aMatch = aHours.includes(reqHour) ? 1 : 0;
          const bMatch = bHours.includes(reqHour) ? 1 : 0;
          if (aMatch !== bMatch) return bMatch - aMatch;
        }

        const aDays = Array.isArray(a.available_days || a.availableDays) ? (a.available_days || a.availableDays) : [0, 1, 2, 3, 4, 5, 6];
        const bDays = Array.isArray(b.available_days || b.availableDays) ? (b.available_days || b.availableDays) : [0, 1, 2, 3, 4, 5, 6];
        const aDayMatch = aDays.includes(reqDay) ? 1 : 0;
        const bDayMatch = bDays.includes(reqDay) ? 1 : 0;
        if (aDayMatch !== bDayMatch) return bDayMatch - aDayMatch;

        return 0;
      });

      // Motor de plantillas: resolución del modo de imagen y del sizing contra
      // las capacidades del layout (manifest canónico). `?sizing=popularity`
      // es preview (espejo de ?morph=/?theme=): sirve el sizing aunque el
      // dueño no lo haya guardado, siempre que la morfología lo soporte.
      const sizingPreview = req.query.sizing === 'popularity';
      const layoutId = restaurant.layout || 'classic';
      const effectiveImageMode = resolveImageMode(layoutId, restaurant.imageMode);
      const effectiveMenuSizing = (sizingPreview && layoutSupportsMenuSizing(layoutId, 'popularity'))
        ? 'popularity'
        : resolveMenuSizing(layoutId, restaurant.menuSizing);
      if (effectiveMenuSizing === 'popularity') {
        const tiers = computePopTiers(dishes, restaurant.analytics && restaurant.analytics.dishPopularity);
        // Tier por plato (2 grande / 1 normal / 0 chico): el payload público
        // NUNCA ve scores crudas ni conteos, solo este derivado acotado.
        dishes = dishes.map(d => ({ ...d, popTier: tiers.has(d.id) ? tiers.get(d.id) : 1 }));
      }

      // F3 "Agotados con memoria": el plato con `dailyStock` se marca
      // `soldOutToday` cuando las ventas del día local (mismo huso de El
      // Cierre) alcanzaron su tope. Ventana derivada, CERO cron de reset;
      // revive solo a la medianoche del dueño. El agregado vive DENTRO del
      // cache (60s middleware + single-flight): a lo sumo 1 consulta/min/local
      // y SOLO cuando la carta tiene platos con `dailyStock` (cero costo para
      // el resto, patrón del spec). El manual `outOfStock` gana siempre: acá
      // solo se emite el derivado, nunca se pisa la decisión del dueño.
      if (dailyStockTracker.anyDishWithDailyStock(dishes)) {
        try {
          const ownerOffset = Number.isFinite(Number(restaurant.utcOffsetMinutes))
            ? restaurant.utcOffsetMinutes
            : -180;
          const stockWindow = dailyStockTracker.getDailyStockWindow(Date.now(), ownerOffset);
          const soldToday = dailyStockTracker.sumSoldByDish(
            await db.getSoldQtyForDay(restaurant.id, stockWindow.startUtc, stockWindow.endUtc)
          );
          dishes = dailyStockTracker.attachSoldOutToday(dishes, soldToday);
        } catch (dailyStockErr) {
          // Fail-open honesto: sin datos de ventas el plato NUNCA se auto-agota;
          // el dueño siempre puede usar el flag manual.
          console.warn('[menu] dailyStock: ventas del día no disponibles:', (dailyStockErr && dailyStockErr.message) || dailyStockErr);
        }
      }

      // F5 "Tendencia honesta": chip "🔥 Muy pedido esta semana" SOLO para los
      // platos con ventas reales de los últimos 7 días (>= 3 unidades, top 3),
      // derivado del MISMO agregado honesto que F3 (los cancelados no cuentan).
      // El payload público recibe la etiqueta textual: nunca unidades, scores
      // ni conteos. Default encendido; `showTrendingChip === false` lo apaga y
      // ahí no se consulta NADA (cero costo para quien no lo quiere).
      if (restaurant.showTrendingChip !== false) {
        try {
          const trendingLabels = await resolveTrendingLabels(restaurant, dishes);
          if (trendingLabels.size) dishes = dishTrending.attachTrendingLabel(dishes, trendingLabels);
        } catch (trendingErr) {
          // Fail-open: sin datos de ventas la carta queda exactamente igual.
          console.warn('[menu] trending: ventas de la semana no disponibles:', (trendingErr && trendingErr.message) || trendingErr);
        }
      }

      // F7 "El Tiempo Real": cuánto tardan REALMENTE los pedidos de este local.
      // Se mide `created_at → status_updated_at` de los pedidos entregados de
      // los últimos 7 días (cancelados afuera, zombis > 4 h afuera) y se exige
      // una muestra mínima; sin muestra suficiente el chip NO aparece (omitir,
      // nunca inventar). Informativo: el estado real sigue llegando por el
      // seguimiento. Default encendido; `showPrepEstimate === false` no consulta
      // nada. El servicio cachea 10 min por local y es fail-open.
      // F7-v2: el bundle trae TAMBIÉN la estimación por modalidad (LOCAL/
      // DELIVERY/TAKEAWAY) de la MISMA consulta; la general queda intacta.
      let prepEstimateValue = null;
      let prepEstimateByModeValue = null;
      try {
        const prepBundle = await getPrepEstimateBundleForRestaurant(restaurant);
        if (prepBundle) {
          prepEstimateValue = prepBundle.all;
          prepEstimateByModeValue = prepBundle.byMode || null;
        }
      } catch (prepErr) {
        console.warn('[menu] prepEstimate no disponible:', (prepErr && prepErr.message) || prepErr);
      }

      // Sanitize public payload: exclude internal userId, billing identifiers, etc.
      const publicData = {
        id: restaurant.id,
        organizationId: restaurant.organizationId || null,
        slug: restaurant.slug,
        name: activeBranch ? `${restaurant.name || restaurant.bizName} — ${activeBranch.name}` : (restaurant.name || restaurant.bizName),
        bizName: restaurant.bizName || restaurant.name,
        phone: activeBranch?.phone || restaurant.phone || '',
        scheduleActiveHours: activeBranch?.scheduleActiveHours || restaurant.scheduleActiveHours || '',
        tableCount: activeBranch?.tableCount || restaurant.tableCount || 10,
        activeBranch: activeBranch ? {
          id: activeBranch.id,
          name: activeBranch.name,
          slug: activeBranch.slug,
          address: activeBranch.address || ''
        } : null,
        branches: (restaurant.branches || []).map(b => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          address: b.address || ''
        })),
        slogan: restaurant.slogan || '',
        currency: restaurant.currency || '$',
        phone: restaurant.phone || '',
        city: restaurant.city || '',
        smartWeatherEnabled: Boolean(restaurant.smartWeatherEnabled),
        weatherContext: weather?.weatherContext || null,
        weatherTemperatureC: weather?.temperatureC ?? null,
        theme: restaurant.theme || 'emerald',
        themeFont: restaurant.themeFont || 'serif',
        neonAccent: restaurant.neonAccent || 'mint',
        neonCustomColor: restaurant.neonCustomColor || '',
        forceClosed: restaurant.forceClosed === true,
        instagram: restaurant.instagram || '',
        facebook: restaurant.facebook || '',
        tiktok: restaurant.tiktok || '',
        x: restaurant.x || '',
        googleReview: restaurant.googleReview || '',
        allowReservations: restaurant.allowReservations !== false,
        allowCoupons: restaurant.allowCoupons !== false,
        allowBillSplitter: restaurant.allowBillSplitter !== false,
        // Servicio de mesa: interruptores del dueño (defaults encendidos).
        // "Pedir la cuenta" además solo tiene sentido en el local (el menú
        // la oculta en DELIVERY/TAKEAWAY aunque esté habilitada).
        allowWaiterCall: restaurant.allowWaiterCall !== false,
        allowBillRequest: restaurant.allowBillRequest !== false,
        // Vitrina vs con pedidos: el dueño decide si la carta lleva carrito.
        allowMenuOrders: restaurant.allowMenuOrders !== false,
        announcement: restaurant.announcement || '',
        paymentLink: restaurant.paymentLink || '',
        // Pago online: el dueño decide si la opción aparece. `allowOnlinePayment`
        // es el interruptor; `onlinePaymentReady` indica si hay con qué cobrar
        // (link propio y/o Checkout Pro configurado en el servidor).
        allowOnlinePayment: restaurant.allowOnlinePayment === true,
        onlinePaymentReady: Boolean(
          (restaurant.paymentLink && String(restaurant.paymentLink).trim()) ||
          mpService.isConfigured()
        ),
        scheduleEnabled: Boolean(restaurant.scheduleEnabled),
        scheduleActiveHours: restaurant.scheduleActiveHours || '',
        // Contador de cierre en el badge del menú (default encendido).
        showClosingCountdown: restaurant.showClosingCountdown !== false,
        // F5: chip de tendencia en los platos con ventas reales de la semana
        // (default encendido; apagado = la carta no muestra ninguna etiqueta).
        showTrendingChip: restaurant.showTrendingChip !== false,
        // F7: estimación honesta de preparación del local (null si el dueño la
        // apagó o si no hay muestra suficiente). Nunca expone pedidos ni PII.
        showPrepEstimate: restaurant.showPrepEstimate !== false,
        prepEstimate: prepEstimateValue,
        // F7-v2: por modalidad, con las 3 claves canónicas siempre presentes
        // (objeto estable, patrón soldOutToday); null completo si el dueño
        // apagó el ETA o si la consulta falló.
        prepEstimateByMode: prepEstimateByModeValue,
        tableCount: restaurant.tableCount || 10,
        customCoupons: restaurant.customCoupons || [],
        allowLoyaltyPoints: restaurant.allowLoyaltyPoints === true,
        loyaltyConfig: loyaltyService.getPublicLoyaltyConfig(restaurant),
        logoUrl: restaurant.logoUrl || null,
        bannerUrl: restaurant.bannerUrl || null,
        layout: restaurant.layout || 'classic',
        imageMode: effectiveImageMode,
        menuSizing: effectiveMenuSizing,
        filterBarMode: ['fixed', 'autohide', 'compact'].includes(restaurant.filterBarMode) ? restaurant.filterBarMode : 'fixed',
        // Verticales de negocio (no sensibles): el frontend las usa para el gating
        // de heladería/perfumería y la resolución de temas de eventos.
        businessType: restaurant.businessType || 'restaurant',
        allowIceCreamWizard: restaurant.allowIceCreamWizard === true,
        iceCreamBuilderLabel: restaurant.iceCreamBuilderLabel || '',
        iceCreamButtonStyle: restaurant.iceCreamButtonStyle || 'clasico',
        // Heladería: tamaños y toppings del dueño (null = defaults del wizard).
        iceCreamContainers: Array.isArray(restaurant.iceCreamContainers) ? restaurant.iceCreamContainers : null,
        iceCreamToppings: Array.isArray(restaurant.iceCreamToppings) ? restaurant.iceCreamToppings : null,
        allowPerfumery: restaurant.allowPerfumery === true,
        wifi: restaurant.wifi || { ssid: '', password: '' },
        categories: publicCategories,
        modifierGroups: restaurant.modifierGroups || [],
        dishes: dishes,
        deliveryZones: restaurant.deliveryZones || [],
        updatedAt: restaurant.updatedAt,
        // Programa del evento e itinerario visual (público por diseño: es el
        // programa de la fiesta; el menú lo renderiza como timeline en vivo).
        weddingItinerary: restaurant.weddingItinerary || null,
        // Events mode data
        isEvent: isEvent,
        eventDate: restaurant.eventDate,
        eventType: restaurant.eventType,
        expiresAt: restaurant.expiresAt,
        eventCustomQR: restaurant.eventCustomQR
      };

      const response = {
        restaurant: publicData,
        weatherContext: publicData.weatherContext,
        weatherTemperatureC: publicData.weatherTemperatureC
      };

      // Add event-specific fields to response
      if (isEvent) {
        response.isEvent = true;
        response.eventDate = restaurant.eventDate;
        response.eventType = restaurant.eventType;
        response.expiresAt = restaurant.expiresAt;
        response.eventCustomQR = restaurant.eventCustomQR || `${process.env.APP_URL || 'https://scango.app'}/m/${slug}?event=true`;
      } else {
        response.access = {
          inGracePeriod: access.inGracePeriod,
          daysRemaining: access.gracePeriodDaysRemaining
        };
      }

      return response;
    });

    let data;
    try {
      data = await Promise.race([fetchPromise, timeoutPromise]);
    } catch (raceErr) {
      if (raceErr.message === 'DB_TIMEOUT_800MS') {
        const { memoryCache } = require('../middleware/cache');
        const stale = memoryCache.get(slug);
        if (stale) {
          res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
          res.setHeader('Warning', '110 Response is Stale');
          res.setHeader('X-Cache-Status', 'Stale-Fallback');
          return res.status(200).json(stale);
        }
      }
      data = await fetchPromise;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!data) {
      return res.status(404).json({ error: 'Restaurante no encontrado' });
    }
    if (data.inactive) {
      return res.status(402).json({
        error: 'MenuTemporalmenteInactivo',
        message: 'Este menú se encuentra temporalmente en pausa por renovación de suscripción.',
        warning: data.warning
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/menu/:slug/dishes - Listar platos con paginación cursor-based (público)
 * Query params: limit (default 50, max 100), after_id (cursor), categoryId (filtro),
 * branch (sucursal), sizing (popularity preview)
 */
const PUBLIC_DISHES_DEFAULT_LIMIT = 50;
const PUBLIC_DISHES_MAX_LIMIT = 100;

router.get('/menu/:slug/dishes', menuCacheMiddleware, async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  const demoType = normalizeDemoType(slug);
  if (demoType) {
    try {
      const demo = getDemoRestaurant(demoType);
      if (!demo) return res.status(404).json({ error: 'Demo no encontrada' });
      let dishes = (demo.dishes || []).map(d => ({
        ...d,
        previous_price: d.previous_price || d.previousPrice || null,
        is_chef_recommended: Boolean(d.is_chef_recommended || d.isChefRecommended)
      }));
      return res.status(200).json(paginateDishes(dishes, req.query));
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo cargar la demo' });
    }
  }

  try {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('DB_TIMEOUT_800MS')), 800);
    });

    const reqBranch = (req.query.branch || req.query.sucursal || '').toLowerCase().trim();
    const reqSizing = req.query.sizing === 'popularity' ? ':sizing:popularity' : '';
    const activeBranchCacheKey = `${slug}:branch:${reqBranch}${reqSizing}:dishes`;

    const fetchPromise = getCachedMenu(activeBranchCacheKey, async () => {
      let restaurant = db.findRestaurantBySlug(slug);
      if (!restaurant) restaurant = await db.lazyLoadRestaurant(slug);
      if (!restaurant) return null;

      const isEvent = restaurant.businessType === 'events' || restaurant.isEvent === true;
      if (isEvent) {
        const expiresAt = restaurant.expiresAt ? new Date(restaurant.expiresAt) : null;
        const eventDate = restaurant.eventDate ? new Date(restaurant.eventDate) : null;
        const expiryCheck = expiresAt || eventDate;
        if (expiryCheck && expiryCheck < new Date()) return { inactive: true, expired: true };
      } else {
        const access = billingOrchestrator.verifyAccess(restaurant.id);
        if (!access.allowed) return { inactive: true };
      }

      let activeBranch = null;
      if (reqBranch && Array.isArray(restaurant.branches)) {
        activeBranch = restaurant.branches.find(b =>
          (b.id || '').toLowerCase() === reqBranch || (b.slug || '').toLowerCase() === reqBranch
        );
      }

      let inheritedDishes = [...(restaurant.dishes || [])];
      if (activeBranch?.overridePrices && typeof activeBranch.overridePrices === 'object') {
        inheritedDishes = inheritedDishes.map(d => ({
          ...d,
          price: resolveBranchOverridePrice(activeBranch.overridePrices, d.id, d.price),
          previous_price: d.price
        }));
      }
      if (activeBranch?.customDishes && Array.isArray(activeBranch.customDishes)) {
        inheritedDishes = [...inheritedDishes, ...activeBranch.customDishes];
      }

      // Filter by category
      const categoryId = req.query.categoryId;
      if (categoryId) {
        inheritedDishes = inheritedDishes.filter(d => d.categoryId === categoryId);
      }

      // Apply translations
      const reqLang = (req.query.lang || 'es').toLowerCase();
      let dishes = inheritedDishes.map(d => {
        // F6 "Estaciones de cocina": la estación es dato OPERATIVO del local
        // (a qué sector va el plato), no del comensal — no viaja en el payload
        // público. La pizarra KDS la resuelve desde su propia sesión.
        const { station, ...dishPublic } = d;
        const trans = d.translations?.[reqLang];
        return {
          ...dishPublic,
          name: trans?.name || d.name,
          description: trans?.description || d.description,
          previous_price: d.previous_price || d.previousPrice || null,
          is_chef_recommended: Boolean(d.is_chef_recommended || d.isChefRecommended)
        };
      });

      // Sort: chef recommended first, then by availability
      const reqHour = req.query.hour || req.query.mealTime || '';
      const reqDay = typeof req.query.day !== 'undefined' ? parseInt(req.query.day) : new Date().getDay();
      dishes.sort((a, b) => {
        const aChef = a.is_chef_recommended ? 1 : 0;
        const bChef = b.is_chef_recommended ? 1 : 0;
        if (aChef !== bChef) return bChef - aChef;
        if (reqHour) {
          const aHours = Array.isArray(a.available_hours || a.availableHours) ? (a.available_hours || a.availableHours) : [];
          const bHours = Array.isArray(b.available_hours || b.availableHours) ? (b.available_hours || b.availableHours) : [];
          const aMatch = aHours.includes(reqHour) ? 1 : 0;
          const bMatch = bHours.includes(reqHour) ? 1 : 0;
          if (aMatch !== bMatch) return bMatch - aMatch;
        }
        const aDays = Array.isArray(a.available_days || a.availableDays) ? (a.available_days || a.availableDays) : [0,1,2,3,4,5,6];
        const bDays = Array.isArray(b.available_days || b.availableDays) ? (b.available_days || b.availableDays) : [0,1,2,3,4,5,6];
        const aDayMatch = aDays.includes(reqDay) ? 1 : 0;
        const bDayMatch = bDays.includes(reqDay) ? 1 : 0;
        if (aDayMatch !== bDayMatch) return bDayMatch - aDayMatch;
        return 0;
      });

      // Popularity sizing
      const sizingPreview = req.query.sizing === 'popularity';
      const layoutId = restaurant.layout || 'classic';
      const { layoutSupportsMenuSizing, resolveMenuSizing } = require('../utils/themeManifest');
      const { computePopTiers } = require('../utils/popularityTiers');
      const effectiveMenuSizing = (sizingPreview && layoutSupportsMenuSizing(layoutId, 'popularity'))
        ? 'popularity'
        : resolveMenuSizing(layoutId, restaurant.menuSizing);
      if (effectiveMenuSizing === 'popularity') {
        const tiers = computePopTiers(dishes, restaurant.analytics && restaurant.analytics.dishPopularity);
        dishes = dishes.map(d => ({ ...d, popTier: tiers.has(d.id) ? tiers.get(d.id) : 1 }));
      }

      return { dishes, total: dishes.length };
    });

    let data;
    try {
      data = await Promise.race([fetchPromise, timeoutPromise]);
    } catch (raceErr) {
      if (raceErr.message === 'DB_TIMEOUT_800MS') {
        const { memoryCache } = require('../middleware/cache');
        const stale = memoryCache.get(activeBranchCacheKey);
        if (stale) {
          res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
          res.setHeader('Warning', '110 Response is Stale');
          res.setHeader('X-Cache-Status', 'Stale-Fallback');
          return res.status(200).json(paginateDishes(stale.dishes || [], req.query, stale.total));
        }
      }
      data = await fetchPromise;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!data) return res.status(404).json({ error: 'Restaurante no encontrado' });
    if (data.inactive) return res.status(402).json({ error: 'MenuTemporalmenteInactivo' });

    const response = paginateDishes(data.dishes, req.query, data.total);
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    res.json(response);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function paginateDishes(dishes, query, totalCount) {
  const limit = Math.min(parseInt(query.limit) || PUBLIC_DISHES_DEFAULT_LIMIT, PUBLIC_DISHES_MAX_LIMIT);
  const afterId = query.after_id;
  let startIndex = 0;
  if (afterId) {
    const foundIndex = dishes.findIndex(d => String(d.id) === String(afterId));
    if (foundIndex !== -1) startIndex = foundIndex + 1;
  }
  const page = dishes.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + limit < (totalCount ?? dishes.length) ? page[page.length - 1]?.id : null;
  return {
    success: true,
    data: page,
    pagination: {
      limit,
      nextCursor,
      hasMore: nextCursor !== null,
      total: totalCount ?? dishes.length
    }
  };
}

/**
 * GET /m/:slug/rewards
 * Catálogo público de recompensas del Club (estilo Novity/Bonuxo).
 * SSR con JSON-LD ItemList para SEO/GEO.
 * Accesible desde el FAB "Mi Club" o link directo.
 */
router.get('/m/:slug/rewards', async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.status(404).json({ error: 'Slug requerido' });

    // Reutilizar la lógica de carga del menú
    const restaurant = db.findRestaurantBySlug(slug);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });

    // Verificar si el local tiene fidelización activa
    const loyaltyEnabled = restaurant.allowLoyaltyPoints === true;
    if (!loyaltyEnabled) {
      return res.status(404).json({ error: 'Club no disponible en este local' });
    }

    const loyaltyConfig = loyaltyService.getPublicLoyaltyConfig(restaurant);
    const rewards = Array.isArray(loyaltyConfig.rewards) ? loyaltyConfig.rewards : [];
    const visitReward = loyaltyConfig.visitReward || { title: 'Visita completa', pointsCost: 0 };
    const stampsTarget = loyaltyConfig.stampsTarget || 6;

    // Construir JSON-LD ItemList
    const itemList = rewards.map((r, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      item: {
        '@type': 'Product',
        name: r.title,
        description: `Canjeable por ${r.pointsCost} puntos del Club`,
        offers: {
          '@type': 'Offer',
          price: r.pointsCost,
          priceCurrency: 'PTS',
          availability: 'https://schema.org/InStock'
        }
      }
    }));

    // Agregar visit reward como primer item si existe
    if (visitReward && visitReward.title) {
      itemList.unshift({
        '@type': 'ListItem',
        position: 0,
        item: {
          '@type': 'Product',
          name: visitReward.title,
          description: `Premio por completar ${stampsTarget} visitas (sellos)`,
          offers: {
            '@type': 'Offer',
            price: 0,
            priceCurrency: 'PTS',
            availability: 'https://schema.org/InStock'
          }
        }
      });
      // Re-posicionar
      itemList.forEach((item, idx) => { item.position = idx; });
    }

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `Catálogo de Recompensas — ${restaurant.name}`,
      description: `Premios canjeables con puntos del Club de ${restaurant.name}. ${rewards.length} recompensas disponibles + premio por visitas.`,
      numberOfItems: itemList.length,
      itemListElement: itemList
    };

    // HTML SSR
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const menuUrl = `${appUrl}/m/${slug}`;
    const rewardsHtml = rewards.length
      ? rewards.map(r => `
          <article class="reward-card" style="background:var(--surface-card); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:12px; display:grid; grid-template-columns: auto 1fr auto; gap:12px; align-items:center;">
            <div class="reward-icon" style="font-size:2rem;">🎁</div>
            <div>
              <h3 style="margin:0 0 4px; color:var(--chalk-white);">${escapeHtml(r.title)}</h3>
              <p style="margin:0; color:var(--chalk-dim); font-size:0.85rem;">Canjeable por <strong>${r.pointsCost} pts</strong></p>
            </div>
            <button type="button" class="btn-primary" style="padding:8px 16px; border-radius:8px; font-weight:700;" disabled>Requiere identificación</button>
          </article>
        `).join('')
      : '<p style="color:var(--chalk-dim); text-align:center; padding:2rem;">No hay recompensas configuradas todavía.</p>';

    const visitRewardHtml = visitReward && visitReward.title
      ? `<article class="reward-card visit-reward" style="background:linear-gradient(135deg, var(--chalk-gold-dim), transparent); border:1px solid var(--chalk-gold); border-radius:12px; padding:16px; margin-bottom:16px; display:grid; grid-template-columns: auto 1fr auto; gap:12px; align-items:center;">
            <div class="reward-icon" style="font-size:2rem;">☕</div>
            <div>
              <h3 style="margin:0 0 4px; color:var(--chalk-white);">${escapeHtml(visitReward.title)}</h3>
              <p style="margin:0; color:var(--chalk-dim); font-size:0.85rem;">Completa <strong>${stampsTarget} visitas</strong> para obtenerlo</p>
            </div>
            <span class="reward-badge" style="background:var(--chalk-gold); color:#0E1412; padding:4px 12px; border-radius:20px; font-size:0.75rem; font-weight:800;">Premio por fidelidad</span>
          </article>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Catálogo de Recompensas — ${escapeHtml(restaurant.name)}</title>
  <meta name="description" content="Premios canjeables con puntos del Club de ${escapeHtml(restaurant.name)}. ${rewards.length} recompensas disponibles.">
  <link rel="canonical" href="${menuUrl}#rewards">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="stylesheet" href="/fonts/fonts.css">
  <link rel="stylesheet" href="/fonts/extended.css">
  <link rel="stylesheet" href="/css/menu.css">
  <style>
    .rewards-page { max-width: 720px; margin: 0 auto; padding: 20px 16px 40px; }
    .rewards-header { text-align: center; margin-bottom: 24px; }
    .rewards-title { font-size: 1.75rem; font-weight: 800; color: var(--chalk-white); margin: 0 0 8px; }
    .rewards-subtitle { color: var(--chalk-dim); margin: 0; }
    .rewards-list { display: flex; flex-direction: column; gap: 12px; }
    .btn-back { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 20px; padding: 10px 16px; background: transparent; border: 1px solid var(--border); color: var(--chalk-white); border-radius: 8px; font-weight: 600; cursor: pointer; }
    .btn-back:hover { background: var(--surface-card-hover); }
  </style>
</head>
<body class="theme-${restaurant.theme || 'classic'} layout-${restaurant.layout || 'classic'}">
  <a href="#main-content" class="skip-link">Saltar al contenido principal</a>
  <main id="main-content" tabindex="-1" class="rewards-page">
    <button class="btn-back" onclick="window.location.href='${menuUrl}'">← Volver al Menú</button>
    <header class="rewards-header">
      <h1 class="rewards-title">🎁 Catálogo de Recompensas</h1>
      <p class="rewards-subtitle">Club de Puntos — ${escapeHtml(restaurant.name)}</p>
    </header>
    ${visitRewardHtml}
    <div class="rewards-list" role="list">${rewardsHtml}</div>
    <p style="margin-top:24px; text-align:center; color:var(--chalk-dim); font-size:0.85rem;">
      Identifícate con tu teléfono en el menú principal para ver tu saldo y canjear recompensas.
    </p>
  </main>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.send(html);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
