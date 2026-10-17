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

const router = express.Router();

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
      const restaurant = db.findRestaurantBySlug(slug);
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
        const trans = d.translations?.[reqLang];
        return {
          ...d,
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

module.exports = router;
