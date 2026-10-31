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

// El cold start de Vercel puede tardar en hidratar el restaurante desde
// Supabase. Reintentamos SOLO el 503 de carga (nunca un 401/403): si el server
// no confirma "no tenés local", el Studio no debe inventar uno vacío.
const ME_RETRY_DELAYS_MS = [0, 400, 900];

async function fetchSessionWithRetry(headers) {
  let last = null;
  for (const delay of ME_RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    last = await fetch('/api/auth/me', { headers, cache: 'no-store' });
    if (last.status !== 503) return last;
  }
  return last;
}

/**
 * Pantalla de error honesta: nunca se renderiza el Studio vacío sobre un local
 * que existe. Sin UI disponible el default seguro es NO permitir guardar.
 */
function showRestaurantLoadError() {
  if (document.getElementById('studioLoadError')) return;
  const overlay = document.createElement('div');
  overlay.id = 'studioLoadError';
  overlay.setAttribute('role', 'alert');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0E1412;color:#F5F5F5;display:flex;align-items:center;justify-content:center;padding:24px;';

  const box = document.createElement('div');
  box.style.cssText = 'max-width:520px;background:#17211D;border:1px solid rgba(212,168,83,.35);border-radius:16px;padding:28px;text-align:center;';

  const title = document.createElement('h1');
  title.textContent = 'No pudimos cargar tu local';
  title.style.cssText = 'font-size:1.25rem;margin:0 0 10px;';

  const text = document.createElement('p');
  text.textContent = 'La sesión está bien, pero el local no llegó desde la nube. No guardes nada todavía: recargá en unos segundos.';
  text.style.cssText = 'font-size:.92rem;line-height:1.5;color:#C9D1CC;margin:0 0 18px;';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reintentar';
  retry.style.cssText = 'padding:9px 18px;border-radius:8px;border:none;background:#38A169;color:#fff;font-weight:700;cursor:pointer;margin-right:8px;';
  retry.addEventListener('click', () => window.location.reload());

  const exit = document.createElement('button');
  exit.type = 'button';
  exit.textContent = 'Cerrar sesión';
  exit.style.cssText = 'padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font-weight:700;cursor:pointer;';
  exit.addEventListener('click', () => logout());

  box.append(title, text, retry, exit);
  overlay.append(box);
  document.body.append(overlay);
}

function buildDefaultRestaurant(currentUser) {
  const defaultSlug = (currentUser.name || 'mi-restaurante')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30);

  return {
    id: '',
    userId: currentUser.id,
    name: currentUser.name || 'Mi Restaurante',
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
    const res = await fetchSessionWithRetry(headers);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body && body.code === 'RESTAURANT_LOAD_FAILED') {
        showRestaurantLoadError();
        return;
      }
      window.location.href = '/?auth=expired';
      return;
    }

    const data = await res.json();
    state.currentUser = data.user || {};

    // El servidor es la autoridad: `restaurant:null` + `canCreateRestaurant:true`
    // es el ÚNICO caso en que se arma un local vacío. Si el campo no vino (server
    // viejo) o la hidratación falló, se muestra el error y NO se scaffoldea.
    const serverRestaurant = data.restaurant || null;
    if (!serverRestaurant && data.canCreateRestaurant !== true) {
      showRestaurantLoadError();
      return;
    }
    state.restaurant = serverRestaurant || buildDefaultRestaurant(state.currentUser);

    // La suscripción vive en el RESTAURANTE ({user, restaurant} es lo que
    // devuelve /api/auth/me). Normalizar la del user fabricaba un trial nuevo
    // en cada carga y el paywall/cuenta regresiva nunca aparecían.
    state.currentUser.subscription = normalizeSubscription(
      (state.restaurant && state.restaurant.subscription) || state.currentUser.subscription
    );
    if (state.restaurant) state.restaurant.subscription = state.currentUser.subscription;

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
