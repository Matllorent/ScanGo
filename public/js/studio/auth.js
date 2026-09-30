/**
 * public/js/studio/auth.js
 * ────────────────────────
 * Módulo ES para la sesión y autenticación del Studio.
 * Extraído de studio.js — gestiona initStudio, logout y eliminación de cuenta.
 *
 * NOTA: Este módulo depende de funciones del monolito studio.js durante la
 * migración gradual (normalizeRestaurantBusinessType, renderStudioUI, etc.).
 * En la migración final, esas dependencias se moverán a sus propios módulos.
 */

import { normalizeSubscription, checkStudioAccess, showSubscriptionRequiredScreen } from './subscription.js';

const TOKEN_KEY = 'menu_pizarron_token';

/**
 * Inicializa el Studio: verifica token, carga user+restaurant desde /api/auth/me.
 * @param {object} state  — objeto mutable compartido { currentUser, restaurant }
 * @param {Function} renderStudioUI  — callback para renderizar la UI una vez validado
 * @param {Function} normalizeBusinessType  — helper de normalización de businessType
 */
export async function initStudio(state, renderStudioUI, normalizeBusinessType) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.href = '/?auth=required';
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/?auth=expired';
      return;
    }

    const data = await res.json();
    state.currentUser = data.user || {};
    state.restaurant = data.restaurant || {};

    // Ensure subscription is always valid before checkStudioAccess runs
    state.currentUser.subscription = normalizeSubscription(state.currentUser.subscription);

    // If user has no restaurant yet, scaffold a clean default
    if (!state.restaurant.id) {
      const defaultSlug = (state.currentUser.name || 'mi-restaurante')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 30);

      state.restaurant = {
        id: '',
        userId: state.currentUser.id,
        name: state.currentUser.name || 'Mi Restaurante',
        slogan: '',
        slug: defaultSlug,
        currency: '$',
        phone: '',
        theme: 'emerald',
        themeFont: 'sans',
        layout: 'classic',
        bannerUrl: null,
        city: '',
        smartWeatherEnabled: false,
        businessType: 'restaurant',
        allowLoyaltyPoints: false,
        allowIceCreamWizard: false,
        allowPerfumery: false,
        instagram: '',
        googleReview: '',
        allowReservations: false,
        allowCoupons: false,
        allowBillSplitter: false,
        announcement: '',
        paymentLink: '',
        scheduleEnabled: false,
        scheduleActiveHours: '12:00-23:30',
        tableCount: 1,
        wifi: { ssid: '', password: '' },
        categories: [],
        dishes: [],
        deliveryZones: [],
        analytics: { visits: 0, orders: 0, reservations: 0, waiterCalls: 0 }
      };
    }

    if (typeof normalizeBusinessType === 'function') {
      normalizeBusinessType(state.restaurant);
    }

    // Merge locally cached preferences (businessType override)
    const savedRest = localStorage.getItem('menu_pizarron_restaurant');
    if (savedRest) {
      try {
        const parsed = JSON.parse(savedRest);
        if (parsed.businessType && !state.restaurant.updatedAt) {
          state.restaurant.businessType = parsed.businessType;
        }
        if (parsed.allowIceCreamWizard !== undefined && state.restaurant.allowIceCreamWizard === undefined) {
          state.restaurant.allowIceCreamWizard = parsed.allowIceCreamWizard;
        }
        if (parsed.allowPerfumery !== undefined && state.restaurant.allowPerfumery === undefined) {
          state.restaurant.allowPerfumery = parsed.allowPerfumery;
        }
        if (parsed.allowLoyaltyPoints !== undefined && state.restaurant.allowLoyaltyPoints === undefined) {
          state.restaurant.allowLoyaltyPoints = parsed.allowLoyaltyPoints;
        }
      } catch (e) { /* ignore corrupt localStorage */ }
    }

    // Gate: check subscription before rendering UI
    const access = checkStudioAccess(state.currentUser);
    if (!access.allowed) {
      showSubscriptionRequiredScreen(access);
      return;
    }

    renderStudioUI();
  } catch (err) {
    console.warn('Error al verificar sesión en Studio:', err.message);
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/?auth=expired';
  }
}

/**
 * Cierra la sesión del usuario, limpia localStorage y redirige al inicio.
 */
export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('menu_pizarron_user');
  localStorage.removeItem('menu_pizarron_restaurant');
  window.location.href = '/index.html';
}

/**
 * Abre el modal de confirmación para eliminar cuenta.
 */
export function openDeleteAccountModal() {
  const modal = document.getElementById('deleteAccountModal');
  if (modal) modal.classList.add('active');
}

/**
 * Cierra el modal de eliminación de cuenta.
 */
export function closeDeleteAccountModal() {
  const modal = document.getElementById('deleteAccountModal');
  if (modal) modal.classList.remove('active');
}
