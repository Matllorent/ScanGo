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

import {
  normalizeSubscription,
  checkStudioAccess,
  showSubscriptionRequiredScreen,
  renderSubscriptionBadge,
  checkSubscriptionAlerts,
  renderMenuStatusIndicator
} from './subscription.js';
import { handleBillingReturn } from './billing.js';

const TOKEN_KEY = 'menu_pizarron_token'; // legacy: ya no se emite ni se usa (solo limpieza)

/**
 * Inicializa el Studio: verifica la sesión contra /api/auth/me.
 * Web: cookie httpOnly (viaja sola). App nativa: Bearer de dispositivo
 * (AuthClient lo inyecta). Sin sesión válida → landing.
 */
export async function initStudio(state, renderStudioUI, normalizeBusinessType) {
  // Limpieza única de tokens legacy (pre migración solo-cookie).
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* storage bloqueado */ }

  try {
    // Retorno de una pasarela (?billing=success|canceled): avisa y limpia la URL
    handleBillingReturn();

    const headers = (window.AuthClient ? window.AuthClient.getAuthHeaders() : {});
    const res = await fetch('/api/auth/me', { headers });

    if (!res.ok) {
      window.location.href = '/?auth=expired';
      return;
    }

    const data = await res.json();
    state.currentUser = data.user || {};
    state.restaurant = data.restaurant || {};

    // La suscripción vive en el RESTAURANTE ({user, restaurant} es lo que
    // devuelve /api/auth/me). Normalizar la del user fabricaba un trial nuevo
    // en cada carga y el paywall/cuenta regresiva nunca aparecían.
    state.currentUser.subscription = normalizeSubscription(
      (state.restaurant && state.restaurant.subscription) || state.currentUser.subscription
    );
    if (state.restaurant) state.restaurant.subscription = state.currentUser.subscription;

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
        facebook: '',
        tiktok: '',
        x: '',
        googleReview: '',
        allowReservations: false,
        allowCoupons: false,
        allowBillSplitter: false,
        announcement: '',
        paymentLink: '',
        allowOnlinePayment: false,
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
      // El header queda visible sobre el paywall: sin este paso badge, alertas
      // e indicador conservan los defaults estáticos del HTML (p. ej. "⏳ 7 días
      // de prueba") y contradicen el estado real (vencido / pausado).
      renderSubscriptionBadge(state.currentUser.subscription);
      checkSubscriptionAlerts(state.currentUser.subscription);
      renderMenuStatusIndicator(state.currentUser.subscription);
      showSubscriptionRequiredScreen(access, {
        // Durante la gracia post-trial (3 días) el dueño puede seguir editando
        onContinue: () => renderStudioUI()
      });
      return;
    }

    renderStudioUI();
  } catch (err) {
    console.warn('Error al verificar sesión en Studio:', err.message);
    window.location.href = '/?auth=expired';
  }
}

/**
 * Cierra la sesión: revoca server-side (cookie httpOnly solo la borra el
 * backend; el token de dispositivo se elimina local) y redirige al inicio.
 */
export async function logout() {
  try {
    const headers = (window.AuthClient ? window.AuthClient.getAuthHeaders({ 'Content-Type': 'application/json' }) : { 'Content-Type': 'application/json' });
    await fetch('/api/auth/logout', { method: 'POST', headers });
  } catch (e) { /* best-effort: igual se sale */ }
  if (window.AuthClient) window.AuthClient.clearDeviceToken();
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('menu_pizarron_user');
    localStorage.removeItem('menu_pizarron_restaurant');
  } catch (e) { /* storage bloqueado */ }
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
