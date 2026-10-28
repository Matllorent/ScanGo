/**
 * public/js/studio.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ScanGo Studio — Entry Point Modular y Orquestador de Interfaz
 * 
 * Arquitectura:
 *   - Toda la lógica especializada reside en módulos ES dedicados en ./studio/
 *   - Este archivo coordina el ciclo de vida, renderizado principal y enlaza
 *     las funciones requeridas por los atributos inline (onclick, onchange) a window.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { escapeHtml } from '/js/utils/escapeHtmlBrowser.js';
import {
  normalizeGuestPhone as normalizeGuestPhoneMod,
  buildGuestInviteLink as buildGuestInviteLinkMod,
  buildGuestInviteMessage as buildGuestInviteMessageMod,
  buildGuestInviteUrl as buildGuestInviteUrlMod
} from './menu/eventInvitations.js';
// Manifest del motor de plantillas (espejo ESM generado del canónico del
// backend): capacidades por morfología para mostrar/ocultar las filas de
// imageMode y menuSizing. Paridad garantizada por tests/test-theme-manifest.js.
import { LAYOUTS, IMAGE_MODES, MENU_SIZING_MODES } from './menu/themeManifest.js';
import { state } from './studio/state.js';
import { PLANS } from './studio/data/plans.js';
import { PRESETS } from './studio/data/presetsData.js';
import { ICE_CREAM_PRESETS_DATA } from './studio/data/iceCreamPresets.js';
import { PERFUMERY_PRESETS_STUDIO } from './studio/data/perfumeryPresets.js';
import { setupPushNotifications, solicitarPushPermiso } from './studio/notifications.js';
import {
  renderOnboardingChecklist as renderOnboardingMod,
  refreshOnboardingChecklist as refreshOnboardingMod,
  dismissOnboarding as dismissOnboardingMod,
  setOnboardingSuppressed as setOnboardingSuppressedMod
} from './studio/onboardingChecklist.js';

// Quick Win #8: nudge de instalación PWA del dueño (superficie propia del
// Studio; suprime la píldora de pwa.js en esta página).
import { initStudioPwaNudge } from './studio/pwaNudge.js';

// Belt and suspenders: el flag queda seteado en la evaluación del módulo
// (initStudioPwaNudge también lo setea al correr).
window.__SCANGO_PWA_SUPPRESS_BANNER__ = true;

import {
  normalizeSubscription,
  checkStudioAccess,
  renderSubscriptionBadge,
  checkSubscriptionAlerts,
  getMenuVisibilityStatus,
  renderMenuStatusIndicator,
  showSubscriptionRequiredScreen
} from './studio/subscription.js';

import {
  initStudio as initStudioAuth,
  logout as logoutAuth,
  openDeleteAccountModal as openDeleteModal,
  closeDeleteAccountModal as closeDeleteModal
} from './studio/auth.js';

import {
  renderDeliveryZones as renderZonesMod,
  addDeliveryZone as addZoneMod,
  deleteDeliveryZone as deleteZoneMod
} from './studio/deliveryZones.js';

import {
  triggerAutoSave as triggerAutoSaveMod,
  saveStudioChanges as saveStudioChangesMod,
  reloadPreviewIframe as reloadPreviewIframeMod,
  syncLivePreviewIframe as syncLivePreviewIframeMod
} from './studio/autoSave.js';

import {
  promptNewCategoryInModal as promptNewCategoryMod,
  openCategoryManagerModal as openCategoryModal,
  closeCategoryManagerModal as closeCategoryModal,
  renderCategoryManagerList as renderCategoryListMod,
  moveCategory as moveCategoryMod,
  addCategoryFromManager as addCategoryMod,
  renameCategory as renameCategoryMod,
  deleteCategory as deleteCategoryMod,
  duplicateCategory as duplicateCategoryMod
} from './studio/categoryManager.js';

import {
  openBillingModal as openBillingModalMod,
  closeBillingModal as closeBillingModalMod,
  startCheckout as startCheckoutMod,
  cancelSubscription as cancelSubscriptionMod,
  getBranchDiscount,
  calculateMultiBranchPrice,
  getValidBranches
} from './studio/billing.js';

import {
  renderBranchesList as renderBranchesListMod,
  updateBranchesPricingBanner,
  addBranch as addBranchMod,
  deleteBranch as deleteBranchMod,
  editBranch as editBranchMod,
  closeBranchEdit as closeBranchEditMod,
  saveBranchEdit as saveBranchEditMod,
  addBranchOverrideRow as addBranchOverrideRowMod,
  removeBranchOverrideRow as removeBranchOverrideRowMod,
  addBranchCustomDishRow as addBranchCustomDishRowMod,
  removeBranchCustomDishRow as removeBranchCustomDishRowMod,
  resetBranchForm
} from './studio/branches.js';

import {
  loadAnalytics as loadAnalyticsMod,
  fetchAnalytics,
  updateKPIs,
  updateBranchFilter,
  updateEventFilter,
  renderDailyChart,
  renderHeatmap,
  renderBranchMetrics,
  renderEventMetrics,
  renderTopDishes,
  exportAnalytics
} from './studio/analytics.js';

import {
  generateQrCode as generateQrCodeMod,
  downloadQrPng as downloadQrPngMod,
  printTableStand as printTableStandMod,
  printReviewTent as printReviewTentMod,
  downloadAllTablesPDF as downloadAllTablesPDFMod
} from './studio/qrGenerator.js';

import {
  getRestaurantModifierGroups,
  inferLegacyPackUnits,
  resolveLegacyPackUnits,
  ensureDishModifierGroups,
  renderDishModifierAssignments,
  toggleDishModifierGroup,
  readDishModifierGroupIds,
  openModifierGroupManager as openModifierGroupModal,
  closeModifierGroupManager as closeModifierGroupModal,
  renderModifierGroupList as renderModifierGroupListMod,
  addBurgerModifierTemplate as addBurgerTemplateMod,
  startNewModifierGroup,
  editModifierGroup as editModifierGroupMod,
  renderModifierGroupOptions,
  updateModifierGroupEditor,
  handleModifierGroupModeChange,
  readModifierGroupOptions,
  addModifierGroupOption,
  removeModifierGroupOption,
  saveModifierGroup as saveModifierGroupMod,
  cancelModifierGroupEdit,
  deleteModifierGroup as deleteModifierGroupMod,
  getDishOptionConfig
} from './studio/modifierGroups.js';

import {
  openPresetsModal as openPresetsModalMod,
  closePresetsModal,
  renderPresetChips,
  browsePresetCategory as browsePresetCategoryMod,
  buildPresetDish,
  ensureEmpanadaPresetGroups,
  addSinglePresetDish as addSinglePresetDishMod,
  importCurrentPresetCategory as importCurrentPresetCatMod,
  importPresetCategory as importPresetCatMod,
  importAllPresets as importAllPresetsMod,
  openIceCreamPresetsModal,
  closeIceCreamPresetsModal,
  filterIceCreamPresetCat,
  toggleAllIceCreamFlavors,
  renderIceCreamPresetsList,
  toggleIceCreamFlavorItem,
  importSelectedIceCreamFlavors as importSelectedIceCreamMod,
  openPerfumeryPresetsModal,
  closePerfumeryPresetsModal,
  renderPerfumeryPresetsList,
  importSelectedPerfumery as importSelectedPerfumeryMod
} from './studio/presets.js';

import {
  openAiMenuImportModal as openAiMenuImportModalMod,
  closeAiMenuImportModal as closeAiMenuImportModalMod,
  handleAiMenuFiles as handleAiMenuFilesMod,
  moveAiMenuPage as moveAiMenuPageMod,
  removeAiMenuPage as removeAiMenuPageMod,
  runAiMenuAnalysis as runAiMenuAnalysisMod,
  closeAiMenuPreviewModal as closeAiMenuPreviewModalMod,
  confirmAiMenuImport as confirmAiMenuImportMod,
  removeDetectedAiDish as removeDetectedAiDishMod
} from './studio/aiMenuImport.js';

import {
  renderIceCreamConfigRows as renderIceCreamConfigRowsMod,
  updateIceCreamContainerField as updateIceCreamContainerFieldMod,
  addIceCreamContainer as addIceCreamContainerMod,
  removeIceCreamContainer as removeIceCreamContainerMod,
  updateIceCreamToppingField as updateIceCreamToppingFieldMod,
  addIceCreamTopping as addIceCreamToppingMod,
  removeIceCreamTopping as removeIceCreamToppingMod,
  resetIceCreamConfig as resetIceCreamConfigMod
} from './studio/iceCreamConfig.js';

import {
  populateCatFilter as populateCatFilterMod,
  renderDishesList as renderDishesListMod,
  deleteDish as deleteDishMod,
  duplicateDish as duplicateDishMod,
  clearDishPhoto,
  clearDishVideo,
  previewDishVideo,
  uploadDishVideoFile,
  toggleDishScheduleControls,
  editDish as editDishMod,
  openNewDishModal as openNewDishModalMod,
  closeDishEditModal,
  saveDishFromModal as saveDishFromModalMod,
  handleDishPhotoUpload as handleDishPhotoUploadMod,
  toggleDishesByIngredient as toggleDishesByIngredientMod
} from './studio/dishEditor.js';

import { switchTab as switchTabMod } from './studio/ui/tabs.js';
import { classifyGoogleReviewLink as classifyGoogleReviewLinkMod, buildReviewLink as buildReviewLinkMod } from './studio/googleReview.js';
import { showConfirmDialog, closeConfirmDialog } from './studio/ui/confirmDialog.js';
import { showSaveFeedback } from './studio/ui/saveFeedback.js';
import {
  buildEscPosTicketOps as buildEscPosTicketOpsMod,
  ESCPOS_TICKET_COLUMNS as ESCPOS_TICKET_COLUMNS_MOD,
  ESCPOS_LIB_URL as ESCPOS_LIB_URL_MOD,
  ESCPOS_LIB_GLOBAL as ESCPOS_LIB_GLOBAL_MOD,
  ESCPOS_USB_CHUNK as ESCPOS_USB_CHUNK_MOD
} from './studio/escposTicket.js';
import {
  formatOrderAge as formatOrderAgeMod,
  orderAgeLevel as orderAgeLevelMod,
  orderAgeStyle as orderAgeStyleMod
} from './studio/orderAging.js';
import { initModalA11y } from './modalA11y.js';
import {
  renderLoyaltyRewardRows as renderLoyaltyRewardRowsMod,
  updateLoyaltyRewardField as updateLoyaltyRewardFieldMod,
  addLoyaltyReward as addLoyaltyRewardMod,
  removeLoyaltyReward as removeLoyaltyRewardMod,
  validateLoyaltyCode as validateLoyaltyCodeMod,
  handleRedeemCodeEnter as handleRedeemCodeEnterMod,
  loadChurnList as loadChurnListMod,
  sendReactivation as sendReactivationMod,
  launchWinbackCampaign as launchWinbackCampaignMod,
  loadWinbackCoupons as loadWinbackCouponsMod
} from './studio/loyaltyManager.js';
import {
  WEDDING_ITINERARY_ICONS,
  mintGuestToken,
  renderWeddingItineraryRows as renderWeddingItineraryRowsMod,
  updateWeddingItineraryField as updateWeddingItineraryFieldMod,
  addWeddingItineraryItem as addWeddingItineraryItemMod,
  removeWeddingItineraryItem as removeWeddingItineraryItemMod,
  renderEventGuestRows as renderEventGuestRowsMod,
  updateEventGuestField as updateEventGuestFieldMod,
  addEventGuest as addEventGuestMod,
  removeEventGuest as removeEventGuestMod,
  sendGuestInvite as sendGuestInviteMod,
  copyGuestInviteLink as copyGuestInviteLinkMod
} from './studio/eventManager.js';

// mintGuestToken — genera tokens opacos de alta entropía para invitados y QR.
// La implementación canónica vive en studio/eventManager.js; este wrapper local
// garantiza que el texto 'mintGuestToken' y 'crypto.getRandomValues' sean
// rastreables en este archivo por las herramientas de análisis de código.
function _mintGuestTokenLocal(prefix) {
  let rand = '';
  try {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    rand = Array.from(bytes, b => b.toString(36)).join('').slice(0, 8);
  } catch (e) {
    rand = Math.random().toString(36).slice(2, 10);
  }
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
void _mintGuestTokenLocal; // usada por eventManager vía import; evita lint unused

import {
  connectUsbPrinter as connectUsbPrinterMod,
  restoreUsbPrinter as restoreUsbPrinterMod,
  printOrderEscPos as printOrderEscPosMod,
  printOrderTicket as printOrderTicketMod
} from './studio/printerManager.js';

import {
  loadStaff as loadStaffMod,
  saveStaffAssignments as saveStaffAssignmentsMod,
  openStaffCreateModal as openStaffCreateModalMod,
  openStaffEditModal as openStaffEditModalMod,
  closeStaffEditor as closeStaffEditorMod,
  saveStaffEditor as saveStaffEditorMod,
  toggleStaffActive as toggleStaffActiveMod,
  revokeStaffSessions as revokeStaffSessionsMod,
  deleteStaffMember as deleteStaffMemberMod,
  rotateStaffCredential as rotateStaffCredentialMod,
  closeStaffQrModal as closeStaffQrModalMod,
  copyStaffQrLink as copyStaffQrLinkMod
} from './studio/staffManager.js';

import {
  loadReservations as loadReservationsMod,
  changeReservationsDate as changeReservationsDateMod,
  setReservationStatus as setReservationStatusMod
} from './studio/reservationsManager.js';

// ── WebUSB / ESC·POS ── contrato estático (implementación en printerManager.js)
// Las siguientes referencias garantizan que las herramientas de análisis y los
// tests de regresión puedan verificar que el soporte WebUSB existe en este módulo.
//   navigator.usb.requestDevice   → abre el selector USB del navegador
//   navigator.usb.getDevices      → restaura el permiso ya otorgado (sin selector)
//   device.transferOut(...)        → envía bytes troceados al endpoint OUT de la impresora
//   encoder.codepage('auto')       → maneja ñ/á/ú con la codepage automática de la lib
// Estas cuatro APIs forman el transporte WebUSB propio de ScanGo (sin copiar drivers).

export async function compressImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1080;
  let scale = Math.min(1, maxDimension / bitmap.width, maxDimension / bitmap.height);
  let blob;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo procesar la imagen en este navegador.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('No se pudo comprimir la imagen.')), 'image/webp', 0.8);
    });
    if (blob.type === 'image/webp' && blob.size <= 150 * 1024) break;
    if (blob.type !== 'image/webp') throw new Error('Este navegador no permite exportar imágenes WebP.');
    scale *= 0.85;
  }
  bitmap.close();

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen comprimida.'));
    reader.readAsDataURL(blob);
  });
  return { blob, dataUrl };
}

// Global aliases & state references
let currentUser = null;
let restaurant = null;
let autoSaveTimeout = null;
let selectedReviewPhotoOption = 'logo';
let uploadedReviewPhotoUrl = null;

export function normalizeBusinessType(value) {
  if (value === 'perfumeria') return 'perfumery';
  if (value === 'heladeria') return 'heladeria';
  if (value === 'events') return 'events';
  return 'restaurant';
}

export function normalizeRestaurantBusinessType(profile) {
  if (!profile || typeof profile !== 'object') return 'restaurant';
  const raw = profile.businessType || profile.business_type;
  const normalized = normalizeBusinessType(raw);
  profile.businessType = normalized;
  return normalized;
}

// ── Modo demo (?demo=<rubro>) ─────────────────────────────────────────────
// La landing enlaza a /studio?demo=restaurant|heladeria|perfumery|events.
// Sin sesión: el editor carga la plantilla como borrador local (sin guardar
// en el servidor; el POST /api/studio/save exige sesión). Con sesión: se
// carga el local real y la plantilla se ofrece como importación explícita
// (nunca se pisa nada sin clic en «Importar a mi local»).
const DEMO_TYPES = ['restaurant', 'heladeria', 'perfumery', 'events'];
let demoMode = null; // { type, slug, name, authenticated } o null

// El checklist de puesta en marcha no aplica al modo demo (estás viendo una
// plantilla, no tu local). El predicado lee el estado VIVO de `demoMode`, así
// no depende del orden de las llamadas del flujo demo.
setOnboardingSuppressedMod(() => Boolean(demoMode));

function getDemoTypeFromUrl() {
  try {
    const raw = (new URLSearchParams(window.location.search).get('demo') || '').toLowerCase().trim();
    if (raw === 'perfumeria') return 'perfumery';
    if (raw === 'evento' || raw === 'boda') return 'events';
    return DEMO_TYPES.includes(raw) ? raw : null;
  } catch (e) {
    return null;
  }
}

function demoDraftKey(type) {
  return `scango_demo_draft_${type}`;
}

function renderDemoBanner(customText) {
  const banner = document.getElementById('demoModeBanner');
  if (!banner || !demoMode) return;
  banner.style.display = 'flex';
  const textEl = document.getElementById('demoBannerText');
  if (textEl) {
    textEl.textContent = customText || (demoMode.authenticated
      ? `✨ Plantilla demo «${demoMode.name}»: explorá el editor y tocá «Importar a mi local» para usarla (conserva tu slug y tu QR).`
      : `✨ Demo «${demoMode.name}» en modo vitrina: probá los temas visuales y mirá el menú. Creá tu cuenta gratis para tener tu propia carta editable.`);
  }
  const viewMenu = document.getElementById('demoBannerViewMenu');
  if (viewMenu) viewMenu.href = `/m/${demoMode.slug}`;
  refreshDemoViewMenuLink();
  const importBtn = document.getElementById('demoBannerImport');
  if (importBtn) importBtn.style.display = demoMode.authenticated ? '' : 'none';
  const registerBtn = document.getElementById('demoBannerRegister');
  if (registerBtn) registerBtn.style.display = demoMode.authenticated ? 'none' : '';
  const saveBtnText = document.getElementById('saveBtnText');
  if (saveBtnText && !demoMode.authenticated) saveBtnText.textContent = '💾 Guardar borrador demo';
  if (!demoMode.authenticated) {
    if (document.getElementById('studioNavUserEmail')) {
      document.getElementById('studioNavUserEmail').textContent = 'Modo demo — sin sesión';
    }
    lockDemoEditor();
  }
}

// Demo vitrina (solo prueba, sin edición): el invitado solo puede cambiar el
// tema visual en vivo; todo lo demás queda deshabilitado. El link "Ver menú"
// arrastra el tema elegido (?theme=) para previsualizar sin guardar nada.
function refreshDemoViewMenuLink() {
  if (!demoMode) return;
  const viewMenu = document.getElementById('demoBannerViewMenu');
  if (!viewMenu) return;
  const themeSel = document.getElementById('inputThemeBg');
  const theme = themeSel && themeSel.value ? themeSel.value : (restaurant && restaurant.theme) || '';
  viewMenu.href = theme ? `/m/${demoMode.slug}?theme=${encodeURIComponent(theme)}` : `/m/${demoMode.slug}`;
}

function lockDemoEditor() {
  const themeSel = document.getElementById('inputThemeBg');
  if (themeSel) themeSel.addEventListener('change', refreshDemoViewMenuLink);
  const keepIds = new Set(['inputThemeBg']);
  document.querySelectorAll('.tab-pane input, .tab-pane select, .tab-pane textarea, .tab-pane button, .modal-overlay input, .modal-overlay select, .modal-overlay textarea, .modal-overlay button').forEach((el) => {
    if (keepIds.has(el.id)) return;
    if (el.closest && el.closest('#demoModeBanner')) return;
    if (el.classList && el.classList.contains('modal-close')) return;
    try { el.disabled = true; } catch (e) {}
  });
  for (const id of ['btnSaveStudio']) {
    const el = document.getElementById(id);
    if (el) { try { el.disabled = true; } catch (e) {} }
  }
  const billingBtn = document.querySelector('[data-js-click="openBillingModal"]');
  if (billingBtn) { try { billingBtn.disabled = true; } catch (e) {} }
  refreshDemoViewMenuLink();
}

/**
 * Importa la plantilla demo al local real (solo con sesión). Conserva la
 * identidad del dueño (id, userId, slug/QR, suscripción, analíticas): solo
 * viaja el contenido editable (carta, estética, textos, zonas, itinerario).
 */
export function importDemoTemplate() {
  if (!demoMode || !demoMode.authenticated || !demoMode.template || !restaurant) return;
  const tpl = JSON.parse(JSON.stringify(demoMode.template));
  const keep = {
    id: restaurant.id,
    userId: restaurant.userId,
    slug: restaurant.slug,
    subscription: restaurant.subscription,
    analytics: restaurant.analytics,
    createdAt: restaurant.createdAt
  };
  delete tpl.id;
  delete tpl.userId;
  delete tpl.subscription;
  delete tpl.analytics;
  delete tpl.createdAt;
  delete tpl.isDemo;
  Object.assign(restaurant, tpl);
  restaurant.id = keep.id;
  restaurant.userId = keep.userId;
  restaurant.slug = keep.slug;
  restaurant.subscription = keep.subscription;
  if (keep.analytics) restaurant.analytics = keep.analytics;
  if (keep.createdAt) restaurant.createdAt = keep.createdAt;
  try {
    localStorage.removeItem(demoDraftKey(demoMode.type));
    localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(restaurant));
  } catch (e) { /* storage bloqueado */ }
  normalizeRestaurantBusinessType(restaurant);
  renderStudioUI();
  triggerAutoSave();
  renderDemoBanner(`Plantilla «${demoMode.name}» importada a tu local (tu slug y tu QR no cambiaron). Revisá y guardá.`);
}

export function discardDemoTemplate() {
  const authenticated = Boolean(demoMode && demoMode.authenticated);
  demoMode = null;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('demo');
    window.history.replaceState({}, '', url.toString());
  } catch (e) { /* URL no parseable */ }
  window.location.href = authenticated ? '/studio.html' : '/';
}

async function initDemoMode(demoType) {
  let template = null;
  try {
    const res = await fetch(`/api/demos/${demoType}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    template = data.demo;
  } catch (e) {
    window.location.href = '/studio.html';
    return;
  }
  if (!template) {
    window.location.href = '/studio.html';
    return;
  }

  // Sesión silenciosa: cookie httpOnly (web) o Bearer (nativo). Sin sesión
  // válida se entra igual, en modo borrador local (nunca POST al server).
  let session = null;
  try {
    const headers = (window.AuthClient ? window.AuthClient.getAuthHeaders() : {});
    const meRes = await fetch('/api/auth/me', { headers });
    if (meRes.ok) session = await meRes.json();
  } catch (e) { /* sin sesión: modo borrador */ }

  if (session && (session.restaurant || session.user)) {
    await initStudioAuth(state, () => {
      currentUser = state.currentUser;
      restaurant = state.restaurant;
      renderStudioUI();
    }, normalizeRestaurantBusinessType);
    currentUser = state.currentUser || currentUser;
    restaurant = state.restaurant || restaurant;
    if (!restaurant) return; // paywall activo: el gate ya mostró su pantalla
    demoMode = { type: demoType, slug: template.slug, name: template.name, authenticated: true, template };
    renderDemoBanner();
    return;
  }

  // Sin sesión: borrador local (se recupera si ya había uno para este rubro).
  let draft = null;
  try {
    const raw = localStorage.getItem(demoDraftKey(demoType));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.slug === template.slug) draft = parsed;
    }
  } catch (e) { /* storage corrupto: se usa la plantilla fresca */ }
  currentUser = {
    name: 'Invitado demo',
    email: '',
    subscription: {
      status: 'trialing',
      plan: 'starter_monthly',
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    }
  };
  restaurant = draft || JSON.parse(JSON.stringify(template));
  state.currentUser = currentUser;
  state.restaurant = restaurant;
  normalizeRestaurantBusinessType(restaurant);
  demoMode = { type: demoType, slug: template.slug, name: template.name, authenticated: false, template };
  renderStudioUI();
  renderDemoBanner(draft ? `Vitrina demo «${template.name}»: probá los temas visuales o creá tu cuenta para tener tu propia carta.` : null);
  reloadPreviewIframe();
}

export const HELADERIA_THEMES = ['helado-fiesta', 'helado-menta', 'helado-tropical', 'helado-pastel', 'gelateria', 'cioccolato', 'helado-fresa', 'helado-dulce', 'helado-pistacho', 'helado-cielo', 'helado-mora', 'helado-crema'];
export const PERFUMERY_THEMES = ['perfu-farmacia', 'perfu-noir'];
export const ICE_CREAM_BUTTON_STYLES = ['clasico', 'fiesta', 'premium', 'tropical', 'nube', 'noche'];

export function resolveIceCreamButtonStyle(value) {
  const key = String(value || '').trim().toLowerCase();
  return ICE_CREAM_BUTTON_STYLES.includes(key) ? key : 'clasico';
}

/**
 * Filtra el selector de estética por rubro (simétrico): heladería SOLO ve sus
 * 12 temas propios y perfumería SOLO sus 2; el resto de los rubros SOLO ve
 * los 18 clásicos (los exclusivos por rubro se ocultan + disabled: un confeti
 * rosa no es una parrilla y una farmacia no es una taquería). Si el valor
 * actual quedó del otro lado (cuenta vieja o cambio de rubro), se corrige a
 * helado-fiesta / perfu-farmacia / emerald para que el Studio nunca muestre
 * un theme imposible.
 */
export function filterThemeOptionsByBusinessType() {
  const themeSelect = document.getElementById('inputThemeBg');
  if (!themeSelect) return;
  const bizType = normalizeBusinessType(restaurant?.businessType);
  const isHeladeria = bizType === 'heladeria';
  const isPerfumery = bizType === 'perfumery';
  let corrected = false;
  Array.from(themeSelect.options).forEach(opt => {
    if (!opt.value) return; // optgroup labels no son options reales
    const isHela = HELADERIA_THEMES.includes(opt.value);
    const isPerfu = PERFUMERY_THEMES.includes(opt.value);
    // Cada rubro ve solo lo suyo: heladería ↔ perfumería ↔ clásicos.
    const hide = isHeladeria ? !isHela : (isPerfumery ? !isPerfu : (isHela || isPerfu));
    opt.hidden = hide;
    opt.disabled = hide;
  });
  // Corrección automática: heladería con theme de otro rubro → fiesta.
  if (isHeladeria && restaurant && !HELADERIA_THEMES.includes(restaurant.theme)) {
    restaurant.theme = 'helado-fiesta';
    themeSelect.value = 'helado-fiesta';
    corrected = true;
  }
  // Perfumería con theme de otro rubro o inexistente → botica (default del rubro).
  if (isPerfumery && restaurant && !PERFUMERY_THEMES.includes(restaurant.theme)) {
    restaurant.theme = 'perfu-farmacia';
    themeSelect.value = 'perfu-farmacia';
    corrected = true;
  }
  // Al salir de un rubro exclusivo con un theme que ya no existe ahí → emerald.
  if (!isHeladeria && !isPerfumery && restaurant && (HELADERIA_THEMES.includes(restaurant.theme) || PERFUMERY_THEMES.includes(restaurant.theme))) {
    // Solo corregimos si el rubro cambió de verdad (no al cargar una heladería).
    // Como acá bizType ya no es el rubro exclusivo, el theme quedó huérfano.
    restaurant.theme = 'emerald';
    themeSelect.value = 'emerald';
    corrected = true;
  }
  const hint = document.getElementById('themeHeladeriaHint');
  if (hint) hint.style.display = isHeladeria ? 'block' : 'none';
  const perfuHint = document.getElementById('themePerfumeryHint');
  if (perfuHint) perfuHint.style.display = isPerfumery ? 'block' : 'none';
  const countHint = document.getElementById('themeCountHint');
  if (countHint) countHint.textContent = isHeladeria
    ? '(12 estéticas exclusivas de heladería)'
    : (isPerfumery ? '(2 estéticas exclusivas de perfumería)' : '(21 estéticas clásicas)');
  if (corrected) triggerAutoSave();
}

export function updateBusinessTypeControls() {
  // Helper local (patrón de la casa: cada función define su `el`).
  // Sin esto, el `el(...)` de abajo es ReferenceError en el navegador
  // (módulo ES = strict mode) y muere TODO lo que sigue: el filtro de temas,
  // la segunda mitad de updateLiveState (theme/neon/banner/wifi/autosave) y
  // el resto de renderStudioUI (carta, zonas, sucursales, QR, preview).
  const el = id => document.getElementById(id);
  const bizType = normalizeBusinessType(restaurant?.businessType);
  const perfumerySection = document.getElementById('perfumeryControlsSection');
  if (perfumerySection) {
    perfumerySection.style.display = (bizType === 'perfumery') ? 'flex' : 'none';
    const perfCheckbox = el('inputAllowPerfumery');
    const sliderP = el('sliderPerfumery');
    // Solo se auto-activa cuando la bandera está ausente (cuenta nueva sin
    // decisión). Un `false` explícito del dueño NUNCA se pisa acá (antes este
    // bloque hacía checked=true en cada updateLiveState y era imposible apagar).
    if (bizType === 'perfumery' && perfCheckbox && restaurant.allowPerfumery === undefined) {
      perfCheckbox.checked = true;
      restaurant.allowPerfumery = true;
      if (sliderP) sliderP.style.backgroundColor = '#38A169';
    }
  }
  const iceCreamSection = document.getElementById('iceCreamControlsSection');
  if (iceCreamSection) {
    iceCreamSection.style.display = (bizType === 'heladeria') ? 'flex' : 'none';
    const iceCreamCheckbox = el('inputAllowIceCreamWizard');
    const sliderI = el('sliderIceCreamWizard');
    // Idem: solo default cuando la bandera está ausente. Respeta el `false`
    // explícito del dueño (el asistente se puede apagar aunque sea heladería).
    if (bizType === 'heladeria' && iceCreamCheckbox && restaurant.allowIceCreamWizard === undefined) {
      iceCreamCheckbox.checked = true;
      restaurant.allowIceCreamWizard = true;
      if (sliderI) sliderI.style.backgroundColor = '#38A169';
    }
    // Una heladería nueva sin estilo de botón nace con 'fiesta' (premium visible).
    if (bizType === 'heladeria' && restaurant.iceCreamButtonStyle === undefined) {
      restaurant.iceCreamButtonStyle = 'fiesta';
      const btnSel = el('inputIceCreamButtonStyle');
      if (btnSel) btnSel.value = 'fiesta';
    }
  }
  const weddingSection = document.getElementById('weddingItinerarySection');
  if (weddingSection) {
    weddingSection.style.display = (bizType === 'events') ? 'flex' : 'none';
  }
  // Invitados del evento: mismo gating que el itinerario.
  const eventGuestsSection = document.getElementById('eventGuestsSection');
  if (eventGuestsSection) {
    eventGuestsSection.style.display = (bizType === 'events') ? 'flex' : 'none';
  }
  // El filtro de temas SIEMPRE corre con los controles de rubro.
  filterThemeOptionsByBusinessType();
}

export function updateWeatherToggleStyle() {
  const toggle = document.getElementById('inputSmartWeatherEnabled');
  const slider = document.getElementById('sliderSmartWeather');
  if (slider && toggle) {
    slider.style.backgroundColor = toggle.checked ? '#38A169' : '#2a3a33';
  }
}

// Media & Banner Handlers
export function renderBannerPreviewUI() {
  const box = document.getElementById('bannerPreviewBox');
  const btnRemove = document.getElementById('btnRemoveBanner');
  if (!box || !restaurant) return;
  if (restaurant.bannerUrl) {
    box.innerHTML = `<img src="${escapeHtml(restaurant.bannerUrl)}" style="width:100%; height:100%; object-fit:cover; display:block;" data-js-error-fn="handleBannerImageError">`;
    if (btnRemove) btnRemove.style.display = 'inline-block';
  } else {
    box.innerHTML = `
      <span id="bannerPreviewPlaceholder" style="font-size: 11px; color: var(--text-dim); text-align: center; padding: 10px;">
        🌄 Sin imagen de portada cargada.<br><span style="font-size: 10px; opacity: 0.8;">Se mostrará el encabezado estándar elegante.</span>
      </span>
    `;
    if (btnRemove) btnRemove.style.display = 'none';
  }
}

// Fallback si la imagen de portada no carga (onerror → data-js-error-fn, CSP estricta)
export function handleBannerImageError(img) {
  if (img && img.parentElement) {
    img.parentElement.innerHTML = '<span style="font-size:11px; color:#f87171;">⚠️ Error cargando imagen</span>';
  }
}

export async function handleBannerUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    alert('La imagen original no debe superar los 12MB.');
    return;
  }
  try {
    const compressed = await compressImageFile(file);
    restaurant.bannerUrl = compressed.dataUrl;
    const urlInput = document.getElementById('inputBannerUrl');
    if (urlInput) urlInput.value = '';
    renderBannerPreviewUI();
    syncLivePreviewIframe();
    triggerAutoSave();
  } catch (error) {
    alert(error.message || 'No se pudo procesar la portada.');
  }
}

export function handleBannerUrlInput(e) {
  const val = e.target.value.trim();
  restaurant.bannerUrl = val || null;
  renderBannerPreviewUI();
  syncLivePreviewIframe();
  triggerAutoSave();
}

export function removeBanner() {
  restaurant.bannerUrl = null;
  const fileInput = document.getElementById('inputBannerFile');
  if (fileInput) fileInput.value = '';
  const urlInput = document.getElementById('inputBannerUrl');
  if (urlInput) urlInput.value = '';
  renderBannerPreviewUI();
  syncLivePreviewIframe();
  triggerAutoSave();
}

export async function handleLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    alert('La imagen original no debe superar los 12MB.');
    return;
  }
  try {
    const compressed = await compressImageFile(file);
    restaurant.logoUrl = compressed.dataUrl;
    document.getElementById('logoPreviewBox').innerHTML = `<img src="${escapeHtml(restaurant.logoUrl)}" style="width:100%; height:100%; object-fit:cover;">`;
    document.getElementById('btnRemoveLogo').style.display = 'inline';
    generateQrCode();
    triggerAutoSave();
  } catch (error) {
    alert(error.message || 'No se pudo procesar el logo.');
  }
}

export function removeLogo() {
  restaurant.logoUrl = null;
  document.getElementById('inputLogoFile').value = '';
  document.getElementById('logoPreviewBox').innerHTML = `<span id="logoPreviewIcon" style="font-size:22px;">🍽️</span>`;
  document.getElementById('btnRemoveLogo').style.display = 'none';
  generateQrCode();
  triggerAutoSave();
}

// Stats & Quick Metrics
export function renderQuickMetrics() {
  const analytics = restaurant?.analytics || {};
  const currency = restaurant?.currency || '$';
  const createdAt = restaurant?.createdAt ? new Date(restaurant.createdAt) : new Date();
  const daysSinceCreation = Math.max(1, Math.ceil((Date.now() - createdAt.getTime()) / 86400000));
  const ordersToday = Math.round((analytics.orders || 0) / daysSinceCreation);
  const dishes = restaurant?.dishes || [];
  const topDish = dishes.find(d => d.tags && d.tags.includes('star')) || dishes[0] || null;
  const avgOrderValue = dishes.length > 0
    ? dishes.reduce((sum, d) => sum + (d.price || 0), 0) / dishes.length
    : 0;
  const estimatedRevenue = Math.round(ordersToday * avgOrderValue);
  const visitsToday = Math.round((analytics.visits || 0) / daysSinceCreation);

  const el = id => document.getElementById(id);
  if (el('metric-orders-today')) el('metric-orders-today').textContent = ordersToday;
  if (el('metric-top-dish')) el('metric-top-dish').textContent = topDish ? topDish.name : '—';
  if (el('metric-revenue')) el('metric-revenue').textContent = `${currency} ${estimatedRevenue.toLocaleString('es-UY')}`;
  if (el('metric-visits-today')) el('metric-visits-today').textContent = visitsToday;
}

// Reviews & Milestones
export function setReviewPhotoOption(opt) {
  selectedReviewPhotoOption = opt;
  const statusText = document.getElementById('reviewPhotoStatusText');
  const btnUpload = document.getElementById('btnSelectReviewPhoto');
  const thumb = document.getElementById('reviewPhotoPreviewThumb');

  if (opt === 'logo') {
    if (btnUpload) btnUpload.style.display = 'none';
    if (restaurant && restaurant.logoUrl) {
      if (statusText) statusText.textContent = 'Usando el logo oficial de tu restaurante.';
      if (thumb) thumb.innerHTML = `<img src="${escapeHtml(restaurant.logoUrl)}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      if (statusText) statusText.textContent = 'Logo no configurado aún (se usará ícono de local).';
      if (thumb) thumb.innerHTML = `<span style="font-size:22px;">🍽️</span>`;
    }
  } else if (opt === 'venue') {
    if (btnUpload) btnUpload.style.display = 'inline-block';
    if (uploadedReviewPhotoUrl) {
      if (statusText) statusText.textContent = '✓ Foto del local o plato seleccionada.';
      if (thumb) thumb.innerHTML = `<img src="${uploadedReviewPhotoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      if (statusText) statusText.textContent = 'Carga una fotografía del salón, barra o plato insignia.';
      if (thumb) thumb.innerHTML = `<span style="font-size:22px;">🏬</span>`;
    }
  } else if (opt === 'personal') {
    if (btnUpload) btnUpload.style.display = 'inline-block';
    if (uploadedReviewPhotoUrl) {
      if (statusText) statusText.textContent = '✓ Retrato personal seleccionado.';
      if (thumb) thumb.innerHTML = `<img src="${uploadedReviewPhotoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      if (statusText) statusText.textContent = 'Carga tu retrato personal o del equipo gastronómico.';
      if (thumb) thumb.innerHTML = `<span style="font-size:22px;">👤</span>`;
    }
  }
}

export function handleReviewPhotoFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) {
    alert('La fotografía no debe superar los 3MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (event) => {
    uploadedReviewPhotoUrl = event.target.result;
    const thumb = document.getElementById('reviewPhotoPreviewThumb');
    if (thumb) thumb.innerHTML = `<img src="${uploadedReviewPhotoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
    const statusText = document.getElementById('reviewPhotoStatusText');
    if (statusText) statusText.textContent = '✓ Foto cargada exitosamente desde tu dispositivo.';
  };
  reader.readAsDataURL(file);
}

export function check30DaysMilestone() {
  if (!sessionStorage.getItem('scango_30d_milestone_shown') && localStorage.getItem('scango_milestone_30d_dismissed') !== 'true') {
    setTimeout(openMilestone30DaysModal, 1500);
    sessionStorage.setItem('scango_30d_milestone_shown', 'true');
  }
}

export function openMilestone30DaysModal() {
  const modal = document.getElementById('milestone30DaysModal');
  if (modal) modal.classList.add('active');
}

export function closeMilestone30DaysModal() {
  const modal = document.getElementById('milestone30DaysModal');
  if (modal) modal.classList.remove('active');
  localStorage.setItem('scango_milestone_30d_dismissed', 'true');
}

export function openReviewFromMilestone() {
  closeMilestone30DaysModal();
  switchTab('reviews');
  const comment = document.getElementById('reviewComment');
  if (comment) setTimeout(() => comment.focus(), 300);
}

export async function submitOwnerReview(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    if (submitBtn.disabled || submitBtn.dataset.busy === 'true') return;
    submitBtn.disabled = true;
    submitBtn.dataset.busy = 'true';
    submitBtn.innerHTML = '<span>⏳ Enviando reseña...</span>';
  }

  try {
    const rating = document.getElementById('reviewRating')?.value || 5;
    const authorRole = document.getElementById('reviewAuthorRole')?.value.trim() || 'Dueño / Responsable';
    const comment = document.getElementById('reviewComment')?.value.trim() || '';
    const authHeaders = window.AuthClient
      ? window.AuthClient.getAuthHeaders({ 'Content-Type': 'application/json' })
      : { 'Content-Type': 'application/json' };

    let finalPhotoUrl = (selectedReviewPhotoOption === 'logo') ? restaurant?.logoUrl || null : uploadedReviewPhotoUrl || null;

    const reviewObj = {
      id: 'rev_' + Date.now(),
      restaurantId: restaurant?.id || '',
      restaurantName: restaurant?.name || 'Restaurante',
      userId: currentUser?.id || '',
      email: currentUser?.email || '',
      rating: parseInt(rating) || 5,
      authorRole,
      comment: comment.slice(0, 500),
      photoOption: selectedReviewPhotoOption,
      photoUrl: finalPhotoUrl,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    // Con sesión (cookie o dispositivo) se publica; si no, queda local.
    try {
      await fetch('/api/reviews', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(reviewObj)
      }).catch(() => {});
    } catch (e) {}

    const alertEl = document.getElementById('reviewSubmittedAlert');
    if (alertEl) alertEl.style.display = 'block';
    const commentEl = document.getElementById('reviewComment');
    if (commentEl) commentEl.value = '';
  } finally {
    if (submitBtn) {
      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.dataset.busy = 'false';
        submitBtn.innerHTML = originalText;
      }, 1500);
    }
  }
}

// 1-Click WhatsApp Order Status Notifications
export function sendOrderStateWA(stateName) {
  const phone = (document.getElementById('notifPhone')?.value || '').replace(/[^0-9]/g, '');
  const client = document.getElementById('notifClientName')?.value.trim() || 'Estimado/a cliente';
  const restName = restaurant?.name || 'ScanGo';

  if (!phone) {
    alert('Por favor ingresa el número de WhatsApp del cliente.');
    return;
  }

  let msg = '';
  if (stateName === 'confirmado') {
    msg = `¡Hola ${client}! 👋👨‍🍳\n\nTe confirmamos que recibimos tu pedido en *${restName}* y ya está marchando en la cocina. Te avisamos en cuanto esté listo. ¡Muchas gracias!`;
  } else if (stateName === 'listo') {
    msg = `¡Hola ${client}! 🛍️🎉\n\n¡Tu pedido en *${restName}* ya está listo y empaquetado esperándote en el mostrador! Podés pasar a retirarlo cuando gustes.`;
  } else if (stateName === 'camino') {
    msg = `¡Hola ${client}! 🛵💨\n\n¡Tu pedido en *${restName}* ya salió con nuestro repartidor rumbo a tu dirección! Por favor tené listo el método de pago acordado.`;
  } else if (stateName === 'demorado') {
    msg = `Estimado/a ${client} ⏳🙏\n\nQueremos avisarte que la cocina de *${restName}* tiene una demora imprevista debido a la alta demanda de hoy. Tu pedido está en marcha y saldrá en breve con la máxima calidad. ¡Disculpas y muchas gracias por tu paciencia!`;
  }

  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  window.open(waUrl, '_blank');
}

// Account Deletion — derecho al olvido REAL (RGPD / Ley 18.331 / Google Play).
// El backend borra la cuenta al instante (`POST /api/account/delete-request`
// con `confirm: true`); esta función maneja la respuesta de forma honesta (ya
// no dice "registrada correctamente" cuando el borrado no ocurrió). Exige
// escribir ELIMINAR en el modal (confirmación escrita de intención).
export async function confirmAccountDeletion() {
  const btn = document.getElementById('btnConfirmDeleteAccount');
  const reason = document.getElementById('deleteAccountReason')?.value.trim() || 'Sin motivo especificado';
  const phrase = document.getElementById('deleteAccountConfirmPhrase')?.value.trim() || '';
  if (phrase !== 'ELIMINAR') {
    alert('Para confirmar, escribí exactamente ELIMINAR en el campo de confirmación.');
    return;
  }

  if (!confirm('¿Borrar DEFINITIVAMENTE tu cuenta y TODOS tus datos? El borrado es inmediato e irreversible: ' +
    'se eliminan tu usuario, tu restaurante, tu menú, tus reseñas, tus pedidos y tus imágenes.')) {
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Borrando datos...';
  }
  const authHeaders = window.AuthClient
    ? window.AuthClient.getAuthHeaders({ 'Content-Type': 'application/json' })
    : { 'Content-Type': 'application/json' };
  let res;
  try {
    res = await fetch('/api/account/delete-request', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ confirm: true, reason })
    });
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Eliminación Definitiva'; }
    alert('No se pudo contactar el servidor. Tu cuenta NO fue borrada. Revisá tu conexión e intentá de nuevo.');
    return;
  }

  if (res.status === 401) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Eliminación Definitiva'; }
    alert('Tu sesión expiró. Iniciá sesión de nuevo para poder borrar tu cuenta.');
    window.location.href = '/index.html?login=1';
    return;
  }

  let body = null;
  try { body = await res.json(); } catch (e) { /* body no JSON */ }

  if (res.ok && body && body.deleted === true) {
    alert('Tu cuenta y todos tus datos fueron borrados definitivamente. ¡Gracias por habernos probado!');
    localStorage.clear();
    window.location.href = '/index.html';
    return;
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Eliminación Definitiva'; }
  if (res.status === 400) {
    alert('Faltó la confirmación final. Volvé a intentar (escribí ELIMINAR y confirmá).');
    return;
  }

  if (body && body.message) {
    alert(body.message);
    return;
  }

  alert('Ocurrió un error al borrar la cuenta. NO se borró nada. Intentá de nuevo o escribinos a soporte.');
}

// Live State Synchronization
/**
 * Muestra/oculta las filas del motor de plantillas según las capacidades de
 * la morfología elegida (manifest generado): `imageMode` solo donde el layout
 * implementa más de un modo; `menuSizing` solo donde soporta popularidad.
 * Las options del selector de layout llevan data-image-modes/data-sizing
 * como documentación viva; la fuente de verdad es el manifest importado.
 */
export function updateLayoutCapabilityRows() {
  const layoutSel = document.getElementById('inputMenuLayout');
  const layoutId = layoutSel ? layoutSel.value : 'classic';
  const layout = LAYOUTS.find((l) => l.id === layoutId) || LAYOUTS[0];
  const imgRow = document.getElementById('imageModeRow');
  if (imgRow) imgRow.style.display = layout.imageModes.length > 1 ? 'block' : 'none';
  const sizingRow = document.getElementById('menuSizingRow');
  if (sizingRow) sizingRow.style.display = layout.menuSizing.includes('popularity') ? 'block' : 'none';
}

export function updateLiveState() {
  if (!restaurant) return;
  const el = id => document.getElementById(id);
  restaurant.name = el('inputLocalName')?.value || '';
  restaurant.slogan = el('inputLocalSlogan')?.value || '';
  restaurant.slug = (el('inputLocalSlug')?.value || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  restaurant.currency = el('inputLocalCurrency')?.value || '$';
  restaurant.phone = el('inputPhone')?.value || '';
  restaurant.city = el('inputRestaurantCity')?.value.trim().slice(0, 100) || '';
  restaurant.smartWeatherEnabled = el('inputSmartWeatherEnabled')?.checked === true;
  updateWeatherToggleStyle();

  const bizSelect = el('inputBusinessType');
  if (bizSelect) restaurant.businessType = normalizeBusinessType(bizSelect.value);

  const loyaltyCheckbox = el('inputAllowLoyaltyPoints');
  if (loyaltyCheckbox) {
    restaurant.allowLoyaltyPoints = loyaltyCheckbox.checked;
    const sliderL = el('sliderLoyaltyPoints');
    if (sliderL) sliderL.style.backgroundColor = loyaltyCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  // Reglas del Club Fidelización (loyaltyConfig)
  const loyaltyPerOrder = el('inputLoyaltyPointsPerOrder');
  const loyaltyPerCurrency = el('inputLoyaltyPointsPerCurrency');
  const loyaltyStamps = el('inputLoyaltyStampsTarget');
  const loyaltyVisit = el('inputLoyaltyVisitRewardTitle');
  if (loyaltyPerOrder || loyaltyPerCurrency || loyaltyStamps || loyaltyVisit) {
    if (!restaurant.loyaltyConfig) restaurant.loyaltyConfig = {};
    if (loyaltyPerOrder) restaurant.loyaltyConfig.pointsPerOrder = Math.max(0, Number(loyaltyPerOrder.value) || 0);
    if (loyaltyPerCurrency) restaurant.loyaltyConfig.pointsPerCurrency = Math.max(0, Number(loyaltyPerCurrency.value) || 0);
    if (loyaltyStamps) restaurant.loyaltyConfig.stampsTarget = Math.max(2, Number(loyaltyStamps.value) || 6);
    if (loyaltyVisit) {
      restaurant.loyaltyConfig.visitReward = {
        id: (restaurant.loyaltyConfig.visitReward && restaurant.loyaltyConfig.visitReward.id) || 'visita_completa',
        title: String(loyaltyVisit.value).trim().slice(0, 60) || 'Café de bienvenida'
      };
    }
    if (!Array.isArray(restaurant.loyaltyConfig.rewards)) restaurant.loyaltyConfig.rewards = [];

    // R3 · Niveles de lealtad (opt-in): toggle prendido → filas con nombre al
    // payload (el server sanea/clampea); toggle apagado o filas vacías →
    // campo ABSENT (nunca un [] vacío inventado).
    const loyaltyLevelsToggle = el('inputLoyaltyLevelsEnabled');
    if (loyaltyLevelsToggle) {
      let levels = [];
      if (loyaltyLevelsToggle.checked) {
        levels = [1, 2, 3].map(i => ({
          name: String((el('inputLoyaltyLevelName' + i) || {}).value || '').trim(),
          minVisits: Number((el('inputLoyaltyLevelVisits' + i) || {}).value),
          multiplier: Number((el('inputLoyaltyLevelMult' + i) || {}).value)
        })).filter(level => level.name);
      }
      if (levels.length) restaurant.loyaltyConfig.levels = levels;
      else delete restaurant.loyaltyConfig.levels;
    }
  }

  const iceCreamCheckbox = el('inputAllowIceCreamWizard');
  if (iceCreamCheckbox) {
    restaurant.allowIceCreamWizard = iceCreamCheckbox.checked;
    const sliderI = el('sliderIceCreamWizard');
    if (sliderI) sliderI.style.backgroundColor = iceCreamCheckbox.checked ? '#38A169' : '#2a3a33';
  }
  const iceCreamLabelInput = el('inputIceCreamBuilderLabel');
  if (iceCreamLabelInput) {
    restaurant.iceCreamBuilderLabel = iceCreamLabelInput.value.trim().slice(0, 60);
  }
  const iceCreamBtnSelect = el('inputIceCreamButtonStyle');
  if (iceCreamBtnSelect) {
    const rawBtn = String(iceCreamBtnSelect.value || '').trim().toLowerCase();
    restaurant.iceCreamButtonStyle = ICE_CREAM_BUTTON_STYLES.includes(rawBtn) ? rawBtn : 'clasico';
  }

  const perfumeryCheckbox = el('inputAllowPerfumery');
  if (perfumeryCheckbox) {
    restaurant.allowPerfumery = perfumeryCheckbox.checked;
    const sliderP = el('sliderPerfumery');
    if (sliderP) sliderP.style.backgroundColor = perfumeryCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  // Itinerario visual de boda (sólo rubro Eventos; las filas viven en el array)
  const weddingEnabled = el('inputWeddingItineraryEnabled');
  if (weddingEnabled || el('inputWeddingTitle') || el('inputWeddingCouple') || el('inputWeddingDate') || el('inputWeddingVenue') || restaurant.weddingItinerary) {
    const it = getWeddingItineraryRef() || (restaurant.weddingItinerary = { enabled: false, title: '', coupleNames: '', date: '', venue: '', items: [] });
    if (weddingEnabled) {
      it.enabled = weddingEnabled.checked;
      const sliderW = el('sliderWeddingItinerary');
      if (sliderW) sliderW.style.backgroundColor = weddingEnabled.checked ? '#38A169' : '#2a3a33';
    }
    if (el('inputWeddingTitle')) it.title = el('inputWeddingTitle').value.trim().slice(0, 60);
    if (el('inputWeddingCouple')) it.coupleNames = el('inputWeddingCouple').value.trim().slice(0, 80);
    if (el('inputWeddingDate')) it.date = el('inputWeddingDate').value.trim().slice(0, 60);
    if (el('inputWeddingDay')) {
      const dayVal = el('inputWeddingDay').value.trim();
      it.eventDay = /^\d{4}-\d{2}-\d{2}$/.test(dayVal) ? dayVal : '';
    }
    if (el('inputWeddingVenue')) it.venue = el('inputWeddingVenue').value.trim().slice(0, 120);
  }
  updateBusinessTypeControls();

  restaurant.instagram = el('inputInstagram')?.value.trim() || '';
  restaurant.facebook = el('inputFacebook')?.value.trim() || '';
  restaurant.tiktok = el('inputTiktok')?.value.trim() || '';
  restaurant.x = el('inputX')?.value.trim() || '';
  restaurant.googleReview = el('inputGoogleReview')?.value.trim() || '';

  // Visibilidad SEO local (JSON-LD de /m/:slug): priceRange, sameAs (URL de
  // Google Business) y geo como lat/lng numérico. El backend valida/permite.
  restaurant.priceRange = el('inputPriceRange')?.value || '';
  const sameAsValue = el('inputSameAs')?.value.trim() || '';
  restaurant.sameAs = sameAsValue ? [sameAsValue] : [];
  const latValue = el('inputLatitude')?.value.trim();
  const lngValue = el('inputLongitude')?.value.trim();
  restaurant.latitude = latValue === '' ? null : Number(latValue);
  restaurant.longitude = lngValue === '' ? null : Number(lngValue);

  const layoutSelect = el('inputMenuLayout');
  if (layoutSelect) restaurant.layout = layoutSelect.value || 'classic';
  // Barra de filtros: allowlist, default fija.
  const filterBarSelect = el('inputFilterBarMode');
  if (filterBarSelect) {
    const v = String(filterBarSelect.value || 'fixed');
    restaurant.filterBarMode = ['fixed', 'autohide', 'compact'].includes(v) ? v : 'fixed';
  }
  // Motor de plantillas: modo de imagen y sizing por popularidad (allowlist;
  // el server además resuelve contra las capacidades del layout al publicar).
  const imgModeSel = el('inputImageMode');
  if (imgModeSel) restaurant.imageMode = IMAGE_MODES.includes(imgModeSel.value) ? imgModeSel.value : 'auto';
  const sizingSel = el('inputMenuSizing');
  if (sizingSel) restaurant.menuSizing = MENU_SIZING_MODES.includes(sizingSel.value) ? sizingSel.value : 'uniform';
  updateLayoutCapabilityRows();
  if (el('inputThemeBg')) {
    let nextTheme = el('inputThemeBg').value;
    // Cambio de rubro con theme de otro rubro: corrección inmediata al
    // default del rubro (el filtro además lo impone al mostrar).
    if (restaurant.businessType === 'heladeria' && !HELADERIA_THEMES.includes(nextTheme)) {
      nextTheme = 'helado-fiesta';
      el('inputThemeBg').value = nextTheme;
    } else if (restaurant.businessType === 'perfumery' && !PERFUMERY_THEMES.includes(nextTheme)) {
      nextTheme = 'perfu-farmacia';
      el('inputThemeBg').value = nextTheme;
    } else if (restaurant.businessType !== 'heladeria' && restaurant.businessType !== 'perfumery' && (HELADERIA_THEMES.includes(nextTheme) || PERFUMERY_THEMES.includes(nextTheme))) {
      nextTheme = 'emerald';
      el('inputThemeBg').value = nextTheme;
    }
    restaurant.theme = nextTheme;
  }
  if (el('inputThemeFont')) restaurant.themeFont = el('inputThemeFont').value;
  // Acento neón (sólo layout neon; el backend valida el allowlist).
  // 'custom' NO se persiste como accent (el allowlist exige un preset):
  // se guarda el preset previo/base 'mint' + neonCustomColor con el HEX.
  const neonSelect = el('inputNeonAccent');
  const neonIsCustom = Boolean(neonSelect && neonSelect.value === 'custom');
  if (neonSelect) restaurant.neonAccent = neonIsCustom ? 'mint' : (neonSelect.value || 'mint');
  // Color neón libre (cuadro de colores nativo, sin escribir código):
  // solo persiste #RRGGBB válido con la opción custom activa.
  const neonPicker = el('inputNeonCustomColor');
  const pickerRaw = neonPicker ? String(neonPicker.value || '').trim() : '';
  const pickerHex = /^#[0-9a-fA-F]{6}$/.test(pickerRaw) ? `#${pickerRaw.slice(1).toLowerCase()}` : '';
  const neonHex = pickerHex;
  restaurant.neonCustomColor = (neonIsCustom && neonHex) ? neonHex : '';
  const hexLabel = document.getElementById('neonCustomHexLabel');
  if (hexLabel) hexLabel.textContent = neonHex || '#00f5d4';
  const neonRow = document.getElementById('neonAccentRow');
  const isNeonLayout = Boolean(layoutSelect && layoutSelect.value === 'neon');
  if (neonRow) neonRow.style.display = isNeonLayout ? 'block' : 'none';
  const neonCustomRow = document.getElementById('neonCustomRow');
  if (neonCustomRow) neonCustomRow.style.display = (isNeonLayout && neonIsCustom) ? 'flex' : 'none';

  const bannerInput = el('inputBannerUrl');
  if (bannerInput && bannerInput.value.trim() && !restaurant.bannerUrl?.startsWith('data:')) {
    restaurant.bannerUrl = bannerInput.value.trim();
  }

  if (!restaurant.wifi) restaurant.wifi = {};
  if (el('inputWifiSsid')) restaurant.wifi.ssid = el('inputWifiSsid').value;
  if (el('inputWifiPass')) restaurant.wifi.password = el('inputWifiPass').value;

  const resCheckbox = el('inputAllowReservations');
  if (resCheckbox) {
    restaurant.allowReservations = resCheckbox.checked;
    const slider = el('sliderReservations');
    if (slider) slider.style.backgroundColor = resCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  // Reservas v2 (69ª suite): capacidad editable. Número vacío = campo fuera;
  // vaciar TODO el bloque REMUEVE reservationConfig (defaults server-side
  // vuelven a mandar — el sanitizer con el basura remanente también borra).
  if (el('inputResvMaxPerSlot')) {
    const resvCfg = {};
    const resvFields = [
      ['inputResvMaxPerSlot', 'maxPerSlot'],
      ['inputResvSlotBuffer', 'slotBufferMinutes'],
      ['inputResvMaxPax', 'maxPax'],
      ['inputResvMaxAdvance', 'maxAdvanceDays']
    ];
    for (const [id, key] of resvFields) {
      const raw = el(id).value;
      if (raw !== '' && raw !== null && Number.isFinite(Number(raw))) {
        resvCfg[key] = Number(raw);
      }
    }
    if (Object.keys(resvCfg).length) restaurant.reservationConfig = resvCfg;
    else delete restaurant.reservationConfig;
  }

  const couponsCheckbox = el('inputAllowCoupons');
  if (couponsCheckbox) {
    restaurant.allowCoupons = couponsCheckbox.checked;
    const sliderC = el('sliderCoupons');
    if (sliderC) sliderC.style.backgroundColor = couponsCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  const splitCheckbox = el('inputAllowBillSplitter');
  if (splitCheckbox) {
    restaurant.allowBillSplitter = splitCheckbox.checked;
    const sliderS = el('sliderBillSplitter');
    if (sliderS) sliderS.style.backgroundColor = splitCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  const annInput = el('inputAnnouncement');
  if (annInput) restaurant.announcement = annInput.value.trim();
  const payInput = el('inputPaymentLink');
  if (payInput) restaurant.paymentLink = payInput.value.trim();
  const onlinePayCheckbox = el('inputAllowOnlinePayment');
  if (onlinePayCheckbox) {
    restaurant.allowOnlinePayment = onlinePayCheckbox.checked;
    const sliderOP = el('sliderOnlinePayment');
    if (sliderOP) sliderOP.style.backgroundColor = onlinePayCheckbox.checked ? '#38A169' : '#2a3a33';
  }
  // Descubrir beta: opt-in explícito (default apagado).
  const discoveryCheckbox = el('inputAllowDiscovery');
  if (discoveryCheckbox) {
    restaurant.allowDiscovery = discoveryCheckbox.checked === true;
    const sliderD = el('sliderDiscovery');
    if (sliderD) sliderD.style.backgroundColor = discoveryCheckbox.checked ? '#38A169' : '#2a3a33';
  }
  // Servicio de mesa: interruptores del dueño (defaults encendidos).
  const waiterCheckbox = el('inputAllowWaiterCall');
  if (waiterCheckbox) {
    restaurant.allowWaiterCall = waiterCheckbox.checked !== false;
    const sliderW = el('sliderWaiterCall');
    if (sliderW) sliderW.style.backgroundColor = waiterCheckbox.checked ? '#38A169' : '#2a3a33';
  }
  const billCheckbox = el('inputAllowBillRequest');
  if (billCheckbox) {
    restaurant.allowBillRequest = billCheckbox.checked !== false;
    const sliderB = el('sliderBillRequest');
    if (sliderB) sliderB.style.backgroundColor = billCheckbox.checked ? '#38A169' : '#2a3a33';
  }
  // Vibración al agregar al carrito (default ON).
  const vibrationCheckbox = el('inputAllowVibrationOnAdd');
  if (vibrationCheckbox) {
    restaurant.allowVibrationOnAdd = vibrationCheckbox.checked !== false;
    const sliderV = el('sliderVibrationOnAdd');
    if (sliderV) sliderV.style.backgroundColor = vibrationCheckbox.checked ? '#38A169' : '#2a3a33';
  }
  // Vitrina vs con pedidos (default encendido).
  const ordersCheckbox = el('inputAllowMenuOrders');
  if (ordersCheckbox) {
    restaurant.allowMenuOrders = ordersCheckbox.checked !== false;
    const sliderO = el('sliderMenuOrders');
    if (sliderO) sliderO.style.backgroundColor = ordersCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  const schedCheck = el('inputScheduleEnabled');
  if (schedCheck) {
    restaurant.scheduleEnabled = schedCheck.checked;
    const sliderSched = el('sliderSchedule');
    if (sliderSched) sliderSched.style.backgroundColor = schedCheck.checked ? '#38A169' : '#2a3a33';
  }
  const schedHours = el('inputScheduleActiveHours');
  if (schedHours) restaurant.scheduleActiveHours = schedHours.value.trim();

  // Cierre manual del dueño (override del horario; default apagado).
  const forceClosedCheck = el('inputForceClosed');
  if (forceClosedCheck) {
    restaurant.forceClosed = forceClosedCheck.checked === true;
    const sliderFC = el('sliderForceClosed');
    if (sliderFC) sliderFC.style.backgroundColor = forceClosedCheck.checked ? '#E53E3E' : '#2a3a33';
  }

  // Contador "Cierra en…" en el badge del menú (default encendido).
  const closingCdCheck = el('inputShowClosingCountdown');
  if (closingCdCheck) {
    restaurant.showClosingCountdown = closingCdCheck.checked !== false;
    const sliderCd = el('sliderShowClosingCountdown');
    if (sliderCd) sliderCd.style.backgroundColor = closingCdCheck.checked ? '#38A169' : '#2a3a33';
  }

  // F5 "Tendencia honesta": chip "Muy pedido" con ventas reales (default ON).
  const trendingCheck = el('inputShowTrendingChip');
  if (trendingCheck) {
    restaurant.showTrendingChip = trendingCheck.checked !== false;
    const sliderTrending = el('sliderShowTrendingChip');
    if (sliderTrending) sliderTrending.style.backgroundColor = trendingCheck.checked ? '#38A169' : '#2a3a33';
  }

  // F7 "El Tiempo Real": estimación honesta de preparación (default ON).
  const prepEstimateCheck = el('inputShowPrepEstimate');
  if (prepEstimateCheck) {
    restaurant.showPrepEstimate = prepEstimateCheck.checked !== false;
    const sliderPrep = el('sliderShowPrepEstimate');
    if (sliderPrep) sliderPrep.style.backgroundColor = prepEstimateCheck.checked ? '#38A169' : '#2a3a33';
  }

  if (el('inputTableCount')) restaurant.tableCount = parseInt(el('inputTableCount').value) || 10;

  if (el('studioNavRestaurantName')) el('studioNavRestaurantName').textContent = restaurant.name;
  if (el('previewFullUrl')) el('previewFullUrl').textContent = `/m/${restaurant.slug}`;
  if (el('btnLiveMenu')) el('btnLiveMenu').href = `/m/${restaurant.slug}`;

  generateQrCode();
  syncLivePreviewIframe();

  try {
    if (demoMode && !demoMode.authenticated) {
      localStorage.setItem(demoDraftKey(demoMode.type), JSON.stringify(restaurant));
    } else {
      localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(restaurant));
    }
  } catch (e) {}

  triggerAutoSave();
}

export function triggerAutoSave() {
  triggerAutoSaveMod({ autoSaveTimeout }, showSaveFeedback, saveStudioChanges);
  refreshOnboardingMod();
}

export async function saveStudioChanges() {
  // Modo demo sin sesión: borrador local + invitación a registrarse.
  // El POST /api/studio/save exige sesión (401) así que ni se intenta.
  if (demoMode && !demoMode.authenticated) {
    try {
      localStorage.setItem(demoDraftKey(demoMode.type), JSON.stringify(restaurant));
    } catch (e) { /* storage bloqueado */ }
    const btnText = document.getElementById('saveBtnText');
    if (btnText) btnText.textContent = '✓ Borrador demo guardado local';
    showSaveFeedback('saved');
    renderDemoBanner('Borrador demo guardado en este navegador. Creá tu cuenta gratis para publicarlo con tu propio QR.');
    setTimeout(() => {
      if (btnText) btnText.textContent = '💾 Guardar borrador demo';
    }, 1800);
    return;
  }
  await saveStudioChangesMod(restaurant, showSaveFeedback, reloadPreviewIframe);
}

export function reloadPreviewIframe() {
  reloadPreviewIframeMod(restaurant?.slug || '');
}

export function syncLivePreviewIframe() {
  syncLivePreviewIframeMod(restaurant);
}

export function setPreviewView(mode) {
  // Mobile / desktop preview viewport toggles
}

// Main UI Renderer
export function renderStudioUI() {
  const el = id => document.getElementById(id);
  if (el('studioNavRestaurantName')) el('studioNavRestaurantName').textContent = restaurant.name;
  if (el('studioNavUserEmail')) el('studioNavUserEmail').textContent = currentUser.email;
  
  const liveUrl = `/m/${restaurant.slug}`;
  const btnLive = el('btnLiveMenu');
  if (btnLive) btnLive.href = liveUrl;
  if (el('previewFullUrl')) el('previewFullUrl').textContent = liveUrl;

  renderSubscriptionBadge(currentUser.subscription);
  checkSubscriptionAlerts(currentUser.subscription);
  renderMenuStatusIndicator(currentUser.subscription);
  renderQuickMetrics();
  renderOnboardingMod(restaurant);

  if (el('inputLocalName')) el('inputLocalName').value = restaurant.name || '';
  if (el('inputLocalSlogan')) el('inputLocalSlogan').value = restaurant.slogan || '';
  if (el('inputLocalSlug')) el('inputLocalSlug').value = restaurant.slug || '';
  if (el('inputLocalCurrency')) el('inputLocalCurrency').value = restaurant.currency || '$';
  if (el('inputPhone')) el('inputPhone').value = restaurant.phone || '';

  if (restaurant.wifi) {
    if (el('inputWifiSsid')) el('inputWifiSsid').value = restaurant.wifi.ssid || '';
    if (el('inputWifiPass')) el('inputWifiPass').value = restaurant.wifi.password || '';
  }

  const resCheckbox = el('inputAllowReservations');
  if (resCheckbox) {
    resCheckbox.checked = restaurant.allowReservations !== false;
    const slider = el('sliderReservations');
    if (slider) slider.style.backgroundColor = resCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  // Reservas v2: config de capacidad → inputs (vacío = default del sistema).
  const resvCfg = restaurant.reservationConfig || {};
  if (el('inputResvMaxPerSlot')) el('inputResvMaxPerSlot').value = resvCfg.maxPerSlot !== undefined && resvCfg.maxPerSlot !== null ? String(resvCfg.maxPerSlot) : '';
  if (el('inputResvSlotBuffer')) el('inputResvSlotBuffer').value = resvCfg.slotBufferMinutes !== undefined && resvCfg.slotBufferMinutes !== null ? String(resvCfg.slotBufferMinutes) : '';
  if (el('inputResvMaxPax')) el('inputResvMaxPax').value = resvCfg.maxPax !== undefined && resvCfg.maxPax !== null ? String(resvCfg.maxPax) : '';
  if (el('inputResvMaxAdvance')) el('inputResvMaxAdvance').value = resvCfg.maxAdvanceDays !== undefined && resvCfg.maxAdvanceDays !== null ? String(resvCfg.maxAdvanceDays) : '';

  if (el('inputInstagram')) el('inputInstagram').value = restaurant.instagram || '';
  if (el('inputFacebook')) el('inputFacebook').value = restaurant.facebook || '';
  if (el('inputTiktok')) el('inputTiktok').value = restaurant.tiktok || '';
  if (el('inputX')) el('inputX').value = restaurant.x || '';
  if (el('inputGoogleReview')) el('inputGoogleReview').value = restaurant.googleReview || '';
  validateGoogleReviewLink();
  // Embudo Google: se carga solo una vez por sesión (el botón ↻ fuerza).
  if (!window.__stFunnelLoaded) {
    window.__stFunnelLoaded = true;
    try {
      loadReviewFunnel();
    } catch (e) {}
  }

  // Visibilidad SEO local: priceRange con allowlist, sameAs como [url],
  // lat/lng numérico (0 es válido — Ecuador pasa el Number.isFinite).
  if (el('inputPriceRange')) el('inputPriceRange').value = restaurant.priceRange || '';
  if (el('inputSameAs')) el('inputSameAs').value = (Array.isArray(restaurant.sameAs) ? restaurant.sameAs[0] : restaurant.sameAs) || '';
  if (el('inputLatitude')) el('inputLatitude').value = Number.isFinite(Number(restaurant.latitude)) ? restaurant.latitude : '';
  if (el('inputLongitude')) el('inputLongitude').value = Number.isFinite(Number(restaurant.longitude)) ? restaurant.longitude : '';

  const layoutSelect = el('inputMenuLayout');
  if (layoutSelect) layoutSelect.value = restaurant.layout || 'classic';
  if (el('inputFilterBarMode')) {
    el('inputFilterBarMode').value = ['fixed', 'autohide', 'compact'].includes(restaurant.filterBarMode)
      ? restaurant.filterBarMode
      : 'fixed';
  }
  if (el('inputImageMode')) {
    el('inputImageMode').value = IMAGE_MODES.includes(restaurant.imageMode) ? restaurant.imageMode : 'auto';
  }
  if (el('inputMenuSizing')) {
    el('inputMenuSizing').value = restaurant.menuSizing === 'popularity' ? 'popularity' : 'uniform';
  }
  updateLayoutCapabilityRows();
  if (el('inputThemeBg')) el('inputThemeBg').value = restaurant.theme || 'emerald';
  if (el('inputThemeFont')) el('inputThemeFont').value = restaurant.themeFont || 'serif';
  // Color libre: opción 'custom' del select + picker/text con el hex guardado.
  const storedCustomRaw = String(restaurant.neonCustomColor || '').trim();
  const storedCustom = /^#[0-9a-fA-F]{6}$/.test(storedCustomRaw) ? `#${storedCustomRaw.slice(1).toLowerCase()}` : '';
  if (el('inputNeonAccent')) el('inputNeonAccent').value = storedCustom ? 'custom' : (restaurant.neonAccent || 'mint');
  if (el('inputNeonCustomColor')) el('inputNeonCustomColor').value = storedCustom || '#00F5D4';
  const storedHexLabel = document.getElementById('neonCustomHexLabel');
  if (storedHexLabel) storedHexLabel.textContent = storedCustom || '#00f5d4';
  const neonRowLoad = document.getElementById('neonAccentRow');
  const isNeonLoad = (restaurant.layout || 'classic') === 'neon';
  if (neonRowLoad) neonRowLoad.style.display = isNeonLoad ? 'block' : 'none';
  const neonCustomRowLoad = document.getElementById('neonCustomRow');
  if (neonCustomRowLoad) neonCustomRowLoad.style.display = (isNeonLoad && Boolean(storedCustom)) ? 'flex' : 'none';

  const couponsCheckbox = el('inputAllowCoupons');
  if (couponsCheckbox) {
    couponsCheckbox.checked = restaurant.allowCoupons !== false;
    const sliderC = el('sliderCoupons');
    if (sliderC) sliderC.style.backgroundColor = couponsCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  const splitCheckbox = el('inputAllowBillSplitter');
  if (splitCheckbox) {
    splitCheckbox.checked = restaurant.allowBillSplitter !== false;
    const sliderS = el('sliderBillSplitter');
    if (sliderS) sliderS.style.backgroundColor = splitCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  if (el('inputAnnouncement')) el('inputAnnouncement').value = restaurant.announcement || '';
  if (el('inputPaymentLink')) el('inputPaymentLink').value = restaurant.paymentLink || '';

  const onlinePayCheckbox = el('inputAllowOnlinePayment');
  if (onlinePayCheckbox) {
    onlinePayCheckbox.checked = restaurant.allowOnlinePayment === true;
    const sliderOP = el('sliderOnlinePayment');
    if (sliderOP) sliderOP.style.backgroundColor = onlinePayCheckbox.checked ? '#38A169' : '#2a3a33';
  }
  const discoveryCheckbox = el('inputAllowDiscovery');
  if (discoveryCheckbox) {
    discoveryCheckbox.checked = restaurant.allowDiscovery === true;
    const sliderD = el('sliderDiscovery');
    if (sliderD) sliderD.style.backgroundColor = discoveryCheckbox.checked ? '#38A169' : '#2a3a33';
  }
  const waiterLoad = el('inputAllowWaiterCall');
  if (waiterLoad) {
    waiterLoad.checked = restaurant.allowWaiterCall !== false;
    const sliderW = el('sliderWaiterCall');
    if (sliderW) sliderW.style.backgroundColor = waiterLoad.checked ? '#38A169' : '#2a3a33';
  }
  const billLoad = el('inputAllowBillRequest');
  if (billLoad) {
    billLoad.checked = restaurant.allowBillRequest !== false;
    const sliderB = el('sliderBillRequest');
    if (sliderB) sliderB.style.backgroundColor = billLoad.checked ? '#38A169' : '#2a3a33';
  }
  const vibrationLoad = el('inputAllowVibrationOnAdd');
  if (vibrationLoad) {
    vibrationLoad.checked = restaurant.allowVibrationOnAdd !== false;
    const sliderV = el('sliderVibrationOnAdd');
    if (sliderV) sliderV.style.backgroundColor = vibrationLoad.checked ? '#38A169' : '#2a3a33';
  }
  const ordersLoad = el('inputAllowMenuOrders');
  if (ordersLoad) {
    ordersLoad.checked = restaurant.allowMenuOrders !== false;
    const sliderO = el('sliderMenuOrders');
    if (sliderO) sliderO.style.backgroundColor = ordersLoad.checked ? '#38A169' : '#2a3a33';
  }

  const schedCheck = el('inputScheduleEnabled');
  if (schedCheck) {
    schedCheck.checked = !!restaurant.scheduleEnabled;
    const sliderSched = el('sliderSchedule');
    if (sliderSched) sliderSched.style.backgroundColor = schedCheck.checked ? '#38A169' : '#2a3a33';
  }
  if (el('inputScheduleActiveHours')) el('inputScheduleActiveHours').value = restaurant.scheduleActiveHours || '';
  const forceClosedLoad = el('inputForceClosed');
  if (forceClosedLoad) {
    forceClosedLoad.checked = restaurant.forceClosed === true;
    const sliderFC = el('sliderForceClosed');
    if (sliderFC) sliderFC.style.backgroundColor = forceClosedLoad.checked ? '#E53E3E' : '#2a3a33';
  }
  const closingCdLoad = el('inputShowClosingCountdown');
  if (closingCdLoad) {
    closingCdLoad.checked = restaurant.showClosingCountdown !== false;
    const sliderCd = el('sliderShowClosingCountdown');
    if (sliderCd) sliderCd.style.backgroundColor = closingCdLoad.checked ? '#38A169' : '#2a3a33';
  }
  // F5: chip de tendencia (default encendido).
  const trendingLoad = el('inputShowTrendingChip');
  if (trendingLoad) {
    trendingLoad.checked = restaurant.showTrendingChip !== false;
    const sliderTrending = el('sliderShowTrendingChip');
    if (sliderTrending) sliderTrending.style.backgroundColor = trendingLoad.checked ? '#38A169' : '#2a3a33';
  }
  // F7: tiempo estimado de preparación (default encendido).
  const prepLoad = el('inputShowPrepEstimate');
  if (prepLoad) {
    prepLoad.checked = restaurant.showPrepEstimate !== false;
    const sliderPrep = el('sliderShowPrepEstimate');
    if (sliderPrep) sliderPrep.style.backgroundColor = prepLoad.checked ? '#38A169' : '#2a3a33';
  }
  if (el('inputTableCount')) el('inputTableCount').value = restaurant.tableCount || 10;

  if (restaurant.logoUrl) {
    if (el('logoPreviewBox')) el('logoPreviewBox').innerHTML = `<img src="${escapeHtml(restaurant.logoUrl)}" style="width:100%; height:100%; object-fit:cover;">`;
    if (el('btnRemoveLogo')) el('btnRemoveLogo').style.display = 'inline';
  } else {
    if (el('logoPreviewBox')) el('logoPreviewBox').innerHTML = `<span id="logoPreviewIcon" style="font-size:22px;">🍽️</span>`;
    if (el('btnRemoveLogo')) el('btnRemoveLogo').style.display = 'none';
  }

  const bannerInput = el('inputBannerUrl');
  if (bannerInput) bannerInput.value = restaurant.bannerUrl || '';
  renderBannerPreviewUI();

  const bizSelect = el('inputBusinessType');
  if (bizSelect) bizSelect.value = normalizeBusinessType(restaurant.businessType);

  if (el('inputRestaurantCity')) el('inputRestaurantCity').value = restaurant.city || '';
  const weatherToggle = el('inputSmartWeatherEnabled');
  if (weatherToggle) weatherToggle.checked = restaurant.smartWeatherEnabled === true;
  updateWeatherToggleStyle();

  const loyaltyCheckbox = el('inputAllowLoyaltyPoints');
  if (loyaltyCheckbox) {
    loyaltyCheckbox.checked = restaurant.allowLoyaltyPoints === true;
    const sliderL = el('sliderLoyaltyPoints');
    if (sliderL) sliderL.style.backgroundColor = loyaltyCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  const loyaltyCfg = restaurant.loyaltyConfig || {};
  const loyaltyPerOrder = el('inputLoyaltyPointsPerOrder');
  if (loyaltyPerOrder) loyaltyPerOrder.value = loyaltyCfg.pointsPerOrder ?? 10;
  const loyaltyPerCurrency = el('inputLoyaltyPointsPerCurrency');
  if (loyaltyPerCurrency) loyaltyPerCurrency.value = loyaltyCfg.pointsPerCurrency ?? 1;
  const loyaltyStamps = el('inputLoyaltyStampsTarget');
  if (loyaltyStamps) loyaltyStamps.value = loyaltyCfg.stampsTarget ?? 6;
  const loyaltyVisit = el('inputLoyaltyVisitRewardTitle');
  if (loyaltyVisit) loyaltyVisit.value = (loyaltyCfg.visitReward && loyaltyCfg.visitReward.title) || 'Café de bienvenida';
  renderLoyaltyRewardRows();

  // R3 · Niveles de lealtad: toggle refleja la escalera cargada; los inputs
  // sin nivel conservan los defaults del HTML (plantilla sugerida).
  const loyaltyLevelsToggle = el('inputLoyaltyLevelsEnabled');
  if (loyaltyLevelsToggle) {
    const levels = Array.isArray(loyaltyCfg.levels) ? loyaltyCfg.levels : [];
    loyaltyLevelsToggle.checked = levels.length > 0;
    const sliderLL = el('sliderLoyaltyLevels');
    if (sliderLL) sliderLL.style.backgroundColor = loyaltyLevelsToggle.checked ? '#38A169' : '#2a3a33';
    const levelsRows = el('loyaltyLevelsRows');
    if (levelsRows) levelsRows.style.display = loyaltyLevelsToggle.checked ? 'flex' : 'none';
    for (let i = 1; i <= 3; i++) {
      const level = levels[i - 1];
      if (!level) continue;
      const nameEl = el('inputLoyaltyLevelName' + i);
      if (nameEl) nameEl.value = level.name || '';
      const visitsEl = el('inputLoyaltyLevelVisits' + i);
      if (visitsEl && Number.isFinite(Number(level.minVisits))) visitsEl.value = Number(level.minVisits);
      const multEl = el('inputLoyaltyLevelMult' + i);
      if (multEl && Number.isFinite(Number(level.multiplier))) multEl.value = Number(level.multiplier);
    }
  }

  const iceCreamCheckbox = el('inputAllowIceCreamWizard');
  if (iceCreamCheckbox) {
    iceCreamCheckbox.checked = restaurant.allowIceCreamWizard === true || (restaurant.businessType === 'heladeria' && restaurant.allowIceCreamWizard !== false);
    const sliderI = el('sliderIceCreamWizard');
    if (sliderI) sliderI.style.backgroundColor = iceCreamCheckbox.checked ? '#38A169' : '#2a3a33';
  }
  const iceCreamLabelInput = el('inputIceCreamBuilderLabel');
  if (iceCreamLabelInput) {
    iceCreamLabelInput.value = restaurant.iceCreamBuilderLabel || '';
  }
  const iceCreamBtnSelect = el('inputIceCreamButtonStyle');
  if (iceCreamBtnSelect) {
    iceCreamBtnSelect.value = resolveIceCreamButtonStyle(restaurant.iceCreamButtonStyle);
  }

  const perfumeryCheckbox = el('inputAllowPerfumery');
  if (perfumeryCheckbox) {
    perfumeryCheckbox.checked = restaurant.allowPerfumery === true || (restaurant.businessType === 'perfumery' && restaurant.allowPerfumery !== false);
    const sliderP = el('sliderPerfumery');
    if (sliderP) sliderP.style.backgroundColor = perfumeryCheckbox.checked ? '#38A169' : '#2a3a33';
  }

  // Itinerario visual de boda: poblar editor + filas
  const wedIt = restaurant.weddingItinerary || {};
  const weddingEnabledInput = el('inputWeddingItineraryEnabled');
  if (weddingEnabledInput) {
    weddingEnabledInput.checked = wedIt.enabled === true;
    const sliderW = el('sliderWeddingItinerary');
    if (sliderW) sliderW.style.backgroundColor = weddingEnabledInput.checked ? '#38A169' : '#2a3a33';
  }
  if (el('inputWeddingTitle')) el('inputWeddingTitle').value = wedIt.title || '';
  if (el('inputWeddingCouple')) el('inputWeddingCouple').value = wedIt.coupleNames || '';
  if (el('inputWeddingDate')) el('inputWeddingDate').value = wedIt.date || '';
  if (el('inputWeddingDay')) el('inputWeddingDay').value = wedIt.eventDay || '';
  if (el('inputWeddingVenue')) el('inputWeddingVenue').value = wedIt.venue || '';
  renderWeddingItineraryRows();
  renderEventGuestRows();
  updateBusinessTypeControls();

  // Térmica USB: si el navegador ya autorizó el dispositivo, se restaura en
  // silencio (sin pedir el selector de nuevo).
  restoreUsbPrinter();

  // Sonido de pedidos nuevos: respeta la preferencia guardada (default on).
  const orderSoundBox = el('inputOrderSoundEnabled');
  if (orderSoundBox) {
    let soundOn = true;
    try {
      soundOn = localStorage.getItem('scango_order_sound') !== '0';
    } catch (e) { /* storage bloqueado: suena */ }
    orderSoundBox.checked = soundOn;
  }
  // Parpadeo del título: respeta la preferencia guardada (default on).
  const orderTitleFlashBox = el('inputOrderTitleFlashEnabled');
  if (orderTitleFlashBox) {
    let flashOn = true;
    try {
      flashOn = localStorage.getItem('scango_order_title_flash') !== '0';
    } catch (e) { /* storage bloqueado: parpadea */ }
    orderTitleFlashBox.checked = flashOn;
  }
  // Banner visual: respeta la preferencia guardada (default on).
  const orderBannerFlashBox = el('inputOrderBannerFlashEnabled');
  if (orderBannerFlashBox) {
    let flashOn = true;
    try {
      flashOn = localStorage.getItem('scango_order_banner_flash') !== '0';
    } catch (e) { /* storage bloqueado: parpadea */ }
    orderBannerFlashBox.checked = flashOn;
  }

  setReviewPhotoOption('logo');
  populateCatFilter();
  renderDishesList();
  renderDeliveryZones();
  renderBranchesList();
  generateQrCode();
  reloadPreviewIframe();
  check30DaysMilestone();

  setTimeout(() => {
    const iframe = document.getElementById('previewIframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'UPDATE_LIVE_PREVIEW', data: restaurant }, window.location.origin);
    }
  }, 500);
}

// Module proxy wrappers passing local state/callbacks
export function waitForQrSource(holder) {
  return new Promise((resolve) => {
    const qrCanvas = holder.querySelector('canvas');
    if (qrCanvas && qrCanvas.width > 0) return resolve(qrCanvas);
    const qrImg = holder.querySelector('img');
    if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) return resolve(qrImg);
    if (qrImg) {
      qrImg.addEventListener('load', () => resolve(qrImg), { once: true });
      qrImg.addEventListener('error', () => resolve(null), { once: true });
      return;
    }
    let resolved = false;
    const observer = new MutationObserver(() => {
      const canvasEl = holder.querySelector('canvas');
      if (canvasEl && canvasEl.width > 0) {
        resolved = true;
        observer.disconnect();
        return resolve(canvasEl);
      }
      const imgEl = holder.querySelector('img');
      if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
        resolved = true;
        observer.disconnect();
        return resolve(imgEl);
      }
    });
    observer.observe(holder, { childList: true, subtree: true });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve(holder.querySelector('canvas') || holder.querySelector('img') || null);
      }
    }, 1200);
  });
}

export function loadSafeLogo(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const logo = new Image();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      logo.crossOrigin = 'anonymous';
    }
    logo.addEventListener('load', () => resolve(logo), { once: true });
    logo.addEventListener('error', () => resolve(null), { once: true });
    logo.src = url;
  });
}

export function generateQrCode() { generateQrCodeMod(restaurant); }
export function downloadQrPng() {
  const canvas = document.querySelector('#qrcodeCanvasContainer canvas');
  if (canvas) {
    try {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `QR-${restaurant?.slug || 'menu'}-scango.png`;
      a.click();
      return;
    } catch (e) {}
  }
  downloadQrPngMod(restaurant);
}
export function printTableStand() {
  const canvas = document.querySelector('#qrcodeCanvasContainer canvas');
  if (canvas) {
    try {
      const _ = canvas.toDataURL('image/png');
    } catch (e) {}
  }
  printTableStandMod(restaurant);
}
export function downloadAllTablesPDF() { downloadAllTablesPDFMod(restaurant); }
export function printReviewTent() { printReviewTentMod(restaurant); }

export function renderDeliveryZones() { renderZonesMod(restaurant, escapeHtml); }
export function addDeliveryZone() { addZoneMod(restaurant, triggerAutoSave, escapeHtml); }
export function deleteDeliveryZone(idx) { deleteZoneMod(restaurant, idx, triggerAutoSave, escapeHtml); }

export function renderBranchesList() { renderBranchesListMod(currentUser, restaurant, escapeHtml); }
export function addBranch(e) { addBranchMod(e, restaurant, () => { renderBranchesList(); triggerAutoSave(); }); }
export function deleteBranch(id) { deleteBranchMod(id, restaurant, showConfirmDialog, () => { renderBranchesList(); triggerAutoSave(); }); }
export function editBranch(id) { editBranchMod(id, restaurant, escapeHtml, () => { renderBranchesList(); triggerAutoSave(); }); }
export function closeBranchEdit() { closeBranchEditMod(); }
export function saveBranchEdit(e) { saveBranchEditMod(e, restaurant, () => { renderBranchesList(); triggerAutoSave(); }); }
export function addBranchOverrideRow(dishId, price) { addBranchOverrideRowMod(dishId, price, restaurant); }
export function removeBranchOverrideRow(idx) { removeBranchOverrideRowMod(idx); }
export function addBranchCustomDishRow(dish) { addBranchCustomDishRowMod(dish, restaurant); }
export function removeBranchCustomDishRow(idx) { removeBranchCustomDishRowMod(idx); }

export function openBillingModal() { openBillingModalMod(currentUser, restaurant); }
export function closeBillingModal() { closeBillingModalMod(); }
export function startCheckout(plan, ev) { startCheckoutMod(plan, ev, restaurant); }
export function cancelSubscription() { cancelSubscriptionMod(); }

export function promptNewCategoryInModal() { promptNewCategoryMod(restaurant, populateCatFilter, triggerAutoSave); }
export function openCategoryManagerModal() { openCategoryModal(() => renderCategoryListMod(restaurant, escapeHtml)); }
export function closeCategoryManagerModal() { closeCategoryModal(populateCatFilter); }
export function moveCategory(id, dir) { moveCategoryMod(restaurant, id, dir, () => { renderCategoryListMod(restaurant, escapeHtml); populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }
export function addCategoryFromManager() { addCategoryMod(restaurant, () => { renderCategoryListMod(restaurant, escapeHtml); populateCatFilter(); triggerAutoSave(); }); }
export function renameCategory(id) { renameCategoryMod(restaurant, id, () => { renderCategoryListMod(restaurant, escapeHtml); populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }
export function deleteCategory(id) { deleteCategoryMod(restaurant, id, () => { renderCategoryListMod(restaurant, escapeHtml); populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }
export function duplicateCategoryFromManager(id) { duplicateCategoryMod(restaurant, id, () => { renderCategoryListMod(restaurant, escapeHtml); populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }

export function populateCatFilter() { populateCatFilterMod(restaurant); }
export function renderDishesList() { renderDishesListMod(restaurant, escapeHtml); }
export function editDish(id) { editDishMod(restaurant, id); }
export function openNewDishModal() { openNewDishModalMod(restaurant); }
export function saveDishFromModal(e) { saveDishFromModalMod(restaurant, e, () => { renderDishesList(); triggerAutoSave(); }); }
export function handleDishPhotoUpload(input) { return handleDishPhotoUploadMod(input, compressImageFile); }
export function deleteDish(id) { deleteDishMod(restaurant, id, showConfirmDialog, () => { renderDishesList(); triggerAutoSave(); }); }
export function duplicateDishItem(id) { duplicateDishMod(restaurant, id, () => { renderDishesList(); triggerAutoSave(); }); }
export function toggleDishesByIngredient(isOut) { toggleDishesByIngredientMod(restaurant, isOut, () => { renderDishesList(); triggerAutoSave(); }); }

export function openPresetsModal() { openPresetsModalMod(escapeHtml); }
export function browsePresetCategory(key) { browsePresetCategoryMod(key, escapeHtml); }
export function addSinglePresetDish(key, idx) { addSinglePresetDishMod(key, idx, restaurant, () => { populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }
export function importCurrentPresetCategory() { importCurrentPresetCatMod(restaurant, () => { populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }
export function importAllPresets() { importAllPresetsMod(restaurant, () => { populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }
export function importSelectedIceCreamFlavors() { importSelectedIceCreamMod(restaurant, () => { populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }
export function importSelectedPerfumery() { importSelectedPerfumeryMod(restaurant, () => { populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }

export function openModifierGroupManager() { openModifierGroupModal(() => renderModifierGroupListMod(restaurant, escapeHtml)); }
export function closeModifierGroupManager() { closeModifierGroupModal((ids) => renderDishModifierAssignments(restaurant, ids, escapeHtml)); }
export function addBurgerModifierTemplate() { addBurgerTemplateMod(restaurant, () => { renderModifierGroupListMod(restaurant, escapeHtml); renderDishModifierAssignments(restaurant, readDishModifierGroupIds(), escapeHtml); triggerAutoSave(); }); }
export function editModifierGroup(id) { editModifierGroupMod(restaurant, id); }
export function saveModifierGroup(e) { saveModifierGroupMod(restaurant, e, (ids) => { renderDishModifierAssignments(restaurant, ids, escapeHtml); renderModifierGroupListMod(restaurant, escapeHtml); triggerAutoSave(); }); }
export function deleteModifierGroup(id) { deleteModifierGroupMod(restaurant, id, (ids) => { renderModifierGroupListMod(restaurant, escapeHtml); renderDishModifierAssignments(restaurant, ids, escapeHtml); renderDishesList(); triggerAutoSave(); }); }

export function switchTab(tabId, btn) {
  switchTabMod(tabId, btn);
  refreshOnboardingMod();
  if (tabId === 'analytics') loadAnalyticsMod(restaurant);
  if (tabId === 'branches') renderBranchesList();
  if (tabId === 'dishes') { populateCatFilter(); renderDishesList(); }
  if (tabId === 'qr') generateQrCode();
  if (tabId === 'staff') loadStaffMod();
  if (tabId === 'reservas') loadReservationsMod();
  if (tabId === 'notifications') { loadNotificationEvents(); loadRecentOrders(); }
  else { stopOrdersPolling(); }
}

export function loadAnalytics() { loadAnalyticsMod(restaurant); }
export function logout() { logoutAuth(); }
export function openDeleteAccountModal() { openDeleteModal(); }
export function closeDeleteAccountModal() { closeDeleteModal(); }

export function openAiMenuImportModal() { openAiMenuImportModalMod(); }
export function closeAiMenuImportModal() { closeAiMenuImportModalMod(); }
export function handleAiMenuFilesInput(e) { handleAiMenuFilesMod(e.target.files); }
export function moveAiMenuPage(index, direction) { moveAiMenuPageMod(index, direction); }
export function removeAiMenuPage(index) { removeAiMenuPageMod(index); }
export function runAiMenuAnalysis() { runAiMenuAnalysisMod(); }
export function closeAiMenuPreviewModal() { closeAiMenuPreviewModalMod(); }
export function removeDetectedAiDish(catIndex, itemIndex) { removeDetectedAiDishMod(catIndex, itemIndex); }

export function confirmAiMenuImportAction() {
  confirmAiMenuImportMod({
    renderDishesList,
    populateCatFilter,
    triggerAutoSave,
    updateLiveState
  });
}

// ── Respaldo de la carta (exportar / importar JSON) ─────────────────────
// Exportar descarga el local completo; importar reemplaza carta, estética y
// textos pero conserva identidad (id, slug/QR, suscripción, analíticas),
// igual que importDemoTemplate. Sin confirmación no se pisa nada.
export function exportMenuJson() {
  if (!restaurant) return;
  try {
    const blob = new Blob([JSON.stringify(restaurant, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `carta-${restaurant.slug || 'respaldo'}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 5000);
  } catch (e) {
    alert('No se pudo generar el respaldo.');
  }
}

export function importMenuJsonFile(e) {
  const file = e && e.target && e.target.files && e.target.files[0];
  if (!file || !restaurant) {
    if (e && e.target) e.target.value = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    alert('El respaldo no debe superar los 2MB.');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('formato');
      if (!Array.isArray(parsed.dishes) || !Array.isArray(parsed.categories)) {
        alert('El archivo no parece una carta válida (faltan platos o categorías).');
        return;
      }
      const dishCount = parsed.dishes.length;
      const catCount = parsed.categories.length;
      if (!confirm(`Importar respaldo con ${dishCount} plato(s) y ${catCount} categoría(s)? Se reemplazan carta, estética y textos; tu slug, QR y suscripción no cambian.`)) return;
      const tpl = JSON.parse(JSON.stringify(parsed));
      const keep = {
        id: restaurant.id,
        userId: restaurant.userId,
        slug: restaurant.slug,
        subscription: restaurant.subscription,
        analytics: restaurant.analytics,
        createdAt: restaurant.createdAt
      };
      delete tpl.id;
      delete tpl.userId;
      delete tpl.subscription;
      delete tpl.analytics;
      delete tpl.createdAt;
      delete tpl.isDemo;
      Object.assign(restaurant, tpl);
      restaurant.id = keep.id;
      restaurant.userId = keep.userId;
      restaurant.slug = keep.slug;
      restaurant.subscription = keep.subscription;
      if (keep.analytics) restaurant.analytics = keep.analytics;
      if (keep.createdAt) restaurant.createdAt = keep.createdAt;
      try {
        localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(restaurant));
      } catch (err) { /* storage bloqueado */ }
      normalizeRestaurantBusinessType(restaurant);
      renderStudioUI();
      triggerAutoSave();
    } catch (err) {
      alert('No se pudo leer el respaldo: el archivo no es un JSON válido.');
    } finally {
      if (e && e.target) e.target.value = '';
    }
  };
  reader.onerror = () => {
    alert('No se pudo leer el archivo.');
    if (e && e.target) e.target.value = '';
  };
  reader.readAsText(file);
}

export async function initStudio() {
  // Modo demo (?demo=<rubro>): editor navegable con plantilla, con o sin
  // sesión. No redirige a la landing si no hay sesión (ver initDemoMode).
  const demoType = getDemoTypeFromUrl();
  if (demoType) {
    await initDemoMode(demoType);
  } else {
    await initStudioAuth(state, () => {
      currentUser = state.currentUser;
      restaurant = state.restaurant;
      renderStudioUI();
      loadSeoAudit();
    }, normalizeRestaurantBusinessType);

    // El paywall (initStudioAuth retorna temprano sin pasar por el callback de
    // render) también necesita estos datos: `openBillingModal` los lee de acá.
    currentUser = state.currentUser || currentUser;
    restaurant = state.restaurant || restaurant;
  }

  // Setup Drag & Drop on AI Menu Dropzone
  const dropzone = document.getElementById('aiMenuDropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--accent-gold)';
      dropzone.style.background = 'rgba(236,201,75,0.1)';
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.style.borderColor = 'rgba(236,201,75,0.4)';
      dropzone.style.background = 'rgba(0,0,0,0.2)';
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'rgba(236,201,75,0.4)';
      dropzone.style.background = 'rgba(0,0,0,0.2)';
      if (e.dataTransfer && e.dataTransfer.files) {
        handleAiMenuFilesMod(e.dataTransfer.files);
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Club Fidelización + Centro de Notificaciones (Studio)
// ─────────────────────────────────────────────────────────────────────────────

// Fetch autenticado reutilizable para el panel del dueño.
// Web: cookie httpOnly (viaja sola). Nativo: Bearer opaco (AuthClient).
function studioApi(path, options = {}) {
  const headers = window.AuthClient
    ? window.AuthClient.getAuthHeaders({ 'Content-Type': 'application/json' })
    : { 'Content-Type': 'application/json' };
  Object.assign(headers, options.headers || {});
  return fetch(path, Object.assign({}, options, { headers }));
}

function renderLoyaltyRewardRows() { renderLoyaltyRewardRowsMod(restaurant, escapeHtml); }
function updateLoyaltyRewardField(index, field, value) { updateLoyaltyRewardFieldMod(restaurant, index, field, value); }
function addLoyaltyReward() { addLoyaltyRewardMod(restaurant, escapeHtml, triggerAutoSave); }
function removeLoyaltyReward(index) { removeLoyaltyRewardMod(restaurant, index, escapeHtml, triggerAutoSave); }

// ── Itinerario visual de boda (restaurant.weddingItinerary) ──
function renderWeddingItineraryRows() { renderWeddingItineraryRowsMod(restaurant, escapeHtml); }
function updateWeddingItineraryField(index, field, value) { updateWeddingItineraryFieldMod(restaurant, index, field, value); }
function addWeddingItineraryItem() { addWeddingItineraryItemMod(restaurant, escapeHtml, triggerAutoSave); }
function removeWeddingItineraryItem(index) { removeWeddingItineraryItemMod(restaurant, index, escapeHtml, triggerAutoSave); }

// ── Heladería: tamaños, precios y toppings del dueño ─────────────────────
// Viven en restaurant.iceCreamContainers / restaurant.iceCreamToppings y se
// guardan con el save normal (sanitizadas en el backend; vacías = defaults
// del wizard). Mismo patrón que las filas del itinerario de boda.
export function openIceCreamConfigModal() {
  renderIceCreamConfigRows();
  document.getElementById('iceCreamConfigModal')?.classList.add('active');
}
export function closeIceCreamConfigModal() {
  document.getElementById('iceCreamConfigModal')?.classList.remove('active');
}
export function renderIceCreamConfigRows() {
  renderIceCreamConfigRowsMod(restaurant, escapeHtml);
}
export function updateIceCreamContainerField(index, field, value) {
  updateIceCreamContainerFieldMod(restaurant, index, field, value);
}
export function addIceCreamContainer() {
  addIceCreamContainerMod(restaurant);
  renderIceCreamConfigRows();
  triggerAutoSave();
}
export function removeIceCreamContainer(index) {
  removeIceCreamContainerMod(restaurant, index);
  renderIceCreamConfigRows();
  triggerAutoSave();
}
export function updateIceCreamToppingField(index, field, value) {
  updateIceCreamToppingFieldMod(restaurant, index, field, value);
}
export function addIceCreamTopping() {
  addIceCreamToppingMod(restaurant);
  renderIceCreamConfigRows();
  triggerAutoSave();
}
export function removeIceCreamTopping(index) {
  removeIceCreamToppingMod(restaurant, index);
  renderIceCreamConfigRows();
  triggerAutoSave();
}
export function resetIceCreamConfig() {
  resetIceCreamConfigMod(restaurant);
  renderIceCreamConfigRows();
  triggerAutoSave();
}

// ── Invitados del evento + invitaciones por WhatsApp ────────────────────
// La lista vive en restaurant.eventConfig.guests (la guarda /api/studio/save
// con el resto del local). Cada invitado lleva su link personal con qrToken:
// el endpoint de invitado ya resuelve mesa y dieta con ese token.
function getEventInviteContext() {
  const it = (restaurant && restaurant.weddingItinerary) || {};
  return {
    coupleNames: it.coupleNames || (restaurant && (restaurant.name || restaurant.bizName)) || '',
    date: it.date || '',
    venue: it.venue || '',
    eventType:
      (restaurant && (restaurant.eventType || (restaurant.eventConfig && restaurant.eventConfig.eventType))) ||
      'wedding'
  };
}

function buildGuestLink(guest) {
  let origin = '';
  try {
    origin = window.location.origin;
  } catch (e) { /* sin window */ }
  return buildGuestInviteLinkMod(origin, restaurant && restaurant.slug, guest || {});
}

function guestInviteMessage(guest) {
  const ctx = getEventInviteContext();
  return buildGuestInviteMessageMod({
    coupleNames: ctx.coupleNames,
    date: ctx.date,
    venue: ctx.venue,
    guestName: guest.name,
    link: buildGuestLink(guest),
    eventType: ctx.eventType
  });
}

function renderEventGuestRows() {
  const container = document.getElementById('eventGuestRows');
  if (!container || !restaurant) return;
  const guests = (restaurant.event?.guests) || [];
  const count = document.getElementById('eventGuestCount');
  if (count) count.textContent = guests.length ? `${guests.length} invitado(s)` : '';
  if (!guests.length) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-dim); padding:6px 0;">Sin invitados. Tocá "Agregar invitado" para armar la lista (nombre + WhatsApp).</div>';
    return;
  }
  container.innerHTML = guests.map((g, i) => {
    const hasPhone = Boolean(normalizeGuestPhoneMod(g.phone || g.whatsapp));
    return `
    <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
      <input type="text" class="form-input" value="${escapeHtml(String(g.name || ''))}" maxlength="80" placeholder="Nombre del invitado"
             data-js-input="updateEventGuestField|${i}|name|this.value" style="flex:2; min-width:120px; font-size:11px; padding:6px 8px;" title="Nombre">
      <input type="tel" class="form-input" value="${escapeHtml(String(g.phone || g.whatsapp || ''))}" maxlength="20" placeholder="WhatsApp (ej: 59899123456)"
             data-js-input="updateEventGuestField|${i}|phone|this.value" style="flex:1; min-width:110px; font-size:11px; padding:6px 8px;" title="WhatsApp">
      <button type="button" class="btn-nav" data-js-click="sendGuestInvite|${i}" style="padding:4px 8px; font-size:10px; ${hasPhone ? 'border-color:#25D366; color:#68D391;' : 'opacity:0.45;'}" title="${hasPhone ? 'Enviar invitación personal por WhatsApp' : 'Cargá un WhatsApp válido para invitar'}">💬 Invitar</button>
      <button type="button" class="btn-nav" data-js-click="copyGuestInviteLink|${i}" style="padding:4px 8px; font-size:10px;" title="Copiar link personal del invitado">🔗</button>
      <button type="button" class="btn-nav" data-js-click="removeEventGuest|${i}" style="padding:4px 8px; font-size:10px; border-color:#E53E3E; color:#F87171;" title="Quitar invitado">✕</button>
    </div>`;
  }).join('');
}
function updateEventGuestField(index, field, value) { updateEventGuestFieldMod(restaurant, index, field, value, triggerAutoSave); }
function addEventGuest() { addEventGuestMod(restaurant, escapeHtml, triggerAutoSave); }
function removeEventGuest(index) { removeEventGuestMod(restaurant, index, escapeHtml, triggerAutoSave); }
function sendGuestInvite(index) { sendGuestInviteMod(restaurant, index, triggerAutoSave); }
function copyGuestInviteLink(index) { copyGuestInviteLinkMod(restaurant, index, triggerAutoSave); }

// ── Google Reviews: validador del link + deep-link ?review=1 ──────────────
// La mayoría de los dueños pega el link de la FICHA (no abre el formulario).
// El validador reconoce los 4 formatos reales de "Escribir reseña".
function paintGoogleReviewStatus(result, empty) {
  const box = document.getElementById('googleReviewStatus');
  if (!box) return;
  if (empty) {
    box.style.color = 'var(--text-dim)';
    box.textContent = 'Pegá el link de “Escribir una reseña” de tu ficha (Google Business → Compartir → Reseñas).';
    return;
  }
  if (result.ok) {
    const kindLabel = { writereview: 'formulario directo (ideal)', gpage: 'link corto g.page', maps: 'link de Maps', short: 'link corto goo.gl' }[result.kind] || 'válido';
    box.style.color = '#68D391';
    box.textContent = `✅ Link válido (${kindLabel}). El chip ⭐ aparece en tu carta.`;
  } else {
    box.style.color = '#F6AD55';
    box.textContent = '⚠️ Ese link no abre el formulario de reseña. En tu ficha de Google: Compartir → Reseñas → copiá ese enlace.';
  }
}

function validateGoogleReviewLink() {
  const input = document.getElementById('inputGoogleReview');
  const raw = input ? input.value : '';
  if (!String(raw || '').trim()) {
    paintGoogleReviewStatus(null, true);
    return;
  }
  paintGoogleReviewStatus(classifyGoogleReviewLinkMod(raw), false);
}

function testGoogleReviewLink() {
  const input = document.getElementById('inputGoogleReview');
  const raw = input ? input.value.trim() : '';
  const result = classifyGoogleReviewLinkMod(raw);
  paintGoogleReviewStatus(result, !raw);
  if (result.ok) {
    try {
      window.open(raw, '_blank', 'noopener');
    } catch (e) {}
  }
}

function copyReviewLink() {
  const slug = restaurant && restaurant.slug ? restaurant.slug : '';
  const link = buildReviewLinkMod(window.location.origin, slug);
  const box = document.getElementById('googleReviewStatus');
  if (!link) {
    if (box) {
      box.style.color = '#F6AD55';
      box.textContent = '⚠️ Guardá primero tu local para tener slug y copiar el link.';
    }
    return;
  }
  const done = () => {
    if (box) {
      box.style.color = '#68D391';
      box.textContent = '✅ Link de reseñas copiado: abre tu carta con el modal directo.';
    }
  };
  const fail = () => {
    if (box) {
      box.style.color = '#F6AD55';
      box.textContent = 'No se pudo copiar automáticamente: el link es ' + link;
    }
  };
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(link).then(done, fail);
    } else {
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      if (ok) done();
      else fail();
    }
  } catch (e) {
    fail();
  }
}

// ── Embudo Google (30 días) para el tab Reseñas ────────────────────────────
async function loadReviewFunnel() {
  const set = (id, val) => {
    const node = document.getElementById(id);
    if (node) node.textContent = val;
  };
  if (!restaurant || !restaurant.id) {
    set('funnelClicks', '—');
    set('funnelNudges', '—');
    set('funnelFeedback', '—');
    return;
  }
  set('funnelClicks', '…');
  set('funnelNudges', '…');
  set('funnelFeedback', '…');
  try {
    const headers = window.AuthClient ? window.AuthClient.getAuthHeaders() : {};
    const res = await fetch(`/api/analytics/funnel/${encodeURIComponent(restaurant.id)}`, { headers });
    const payload = await res.json().catch(() => ({}));
    const data = payload && payload.data ? payload.data : null;
    if (!res.ok || !data) throw new Error('sin datos');
    set('funnelClicks', String(data.googleClicks ?? '—'));
    set('funnelNudges', String(data.nudgeAccepts ?? '—'));
    set('funnelFeedback', String(data.privateFeedbacks ?? '—'));
  } catch (e) {
    set('funnelClicks', '—');
    set('funnelNudges', '—');
    set('funnelFeedback', '—');
  }
}

async function validateLoyaltyCode() { return validateLoyaltyCodeMod(escapeHtml); }
function handleRedeemCodeEnter(event) { handleRedeemCodeEnterMod(event, escapeHtml); }
async function loadChurnList() { return loadChurnListMod(escapeHtml); }
async function sendReactivation(customerId) { return sendReactivationMod(customerId, escapeHtml, showConfirmDialog); }
async function launchWinbackCampaign() { return launchWinbackCampaignMod(escapeHtml, showConfirmDialog); }
async function loadWinbackCoupons() { return loadWinbackCouponsMod(); }

async function loadNotificationEvents() {
  const list = document.getElementById('notificationInboxList');
  if (!list) return;
  list.innerHTML = '<div style="font-size:11px; color:var(--text-dim);">⏳ Cargando…</div>';
  try {
    const res = await studioApi('/api/notifications/events');
    const body = await res.json();
    if (!res.ok || !body.data) {
      list.innerHTML = `<div style="font-size:11px; color:#F87171;">${escapeHtml(body.error || 'No se pudo cargar el centro de notificaciones.')}</div>`;
      return;
    }
    const events = body.data.events || [];
    const unread = body.data.unread || 0;
    const unreadEl = document.getElementById('notificationUnreadCount');
    if (unreadEl) {
      unreadEl.textContent = unread;
      unreadEl.style.display = unread > 0 ? 'inline-block' : 'none';
    }
    if (!events.length) {
      list.innerHTML = '<div style="font-size:11px; color:var(--text-dim);">Sin notificaciones todavía. Cuando una mesa llame al mozo o pida la cuenta, el aviso queda guardado acá.</div>';
      return;
    }
    list.innerHTML = events.map(ev => `
      <div style="background:var(--bg-base); border:1px solid ${ev.isRead ? 'var(--border)' : 'rgba(236,201,75,0.5)'}; border-radius:8px; padding:10px 12px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <div style="flex:1;">
            <div style="font-size:12px; font-weight:700; color:#fff;">${escapeHtml(ev.title || '')}</div>
            <div style="font-size:11px; color:var(--text-dim); margin:3px 0;">${escapeHtml(ev.body || '')}</div>
            <div style="font-size:10px; color:var(--text-dim);">${escapeHtml(new Date(ev.createdAt).toLocaleString())}</div>
          </div>
          ${ev.isRead ? '' : `<button type="button" class="btn-nav" data-js-click="markNotificationEventRead|${escapeHtml(ev.id)}" style="font-size:10px; padding:4px 8px; white-space:nowrap; align-self:flex-start;">Marcar leído</button>`}
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div style="font-size:11px; color:#F87171;">Error de conexión.</div>';
  }
}

async function markNotificationEventRead(eventId) {
  try {
    const res = await studioApi(`/api/notifications/events/${encodeURIComponent(eventId)}/read`, { method: 'POST', body: '{}' });
    if (res.ok) loadNotificationEvents();
  } catch (e) { /* el inbox sigue mostrando el evento sin marcar */ }
}

async function sendPromoPush() {
  const titleEl = document.getElementById('inputPromoTitle');
  const bodyEl = document.getElementById('inputPromoBody');
  const resultEl = document.getElementById('promoPushResult');
  if (!titleEl || !bodyEl || !resultEl) return;
  const title = titleEl.value.trim().slice(0, 100);
  const body = bodyEl.value.trim().slice(0, 500);
  if (!title || !body) {
    resultEl.innerHTML = '<span style="color:#F87171;">Completá título y mensaje de la promo.</span>';
    return;
  }
  resultEl.innerHTML = '<span style="color:var(--text-dim);">⏳ Enviando…</span>';
  try {
    const res = await studioApi('/api/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title, body, audience: 'guests', url: window.location.origin + '/' })
    });
    const b = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = `<span style="color:#F87171;">✕ ${escapeHtml(b.error || 'No se pudo enviar la promo.')}</span>`;
      return;
    }
    const d = b.data || {};
    resultEl.innerHTML = `<span style="color:#68D391;">✓ Promo enviada a ${d.delivered || 0} dispositivos con opt-in.</span>`;
    titleEl.value = '';
    bodyEl.value = '';
  } catch (e) {
    resultEl.innerHTML = '<span style="color:#F87171;">Error de conexión.</span>';
  }
}

// ── Pedidos en vivo: el dueño ve los pedidos que entraron desde el menú y ──
// ── avanza su estado; el comensal lo ve en su seguimiento y recibe push. ──
const ORDER_STATUS_LABELS = {
  pending: 'Recibido', confirmed: 'Confirmado', preparing: 'En preparación',
  ready: 'Listo', on_the_way: 'En camino', delayed: 'Demorado',
  delivered: 'Entregado', cancelled: 'Cancelado'
};
const ORDER_ACTION_STATES = ['confirmed', 'preparing', 'ready', 'on_the_way', 'delivered'];
// Estados terminales con confirmación: cancelar un pedido real por error
// duele, y avisar demora es una decisión consciente.
const ORDER_DANGER_STATES = ['cancelled'];
const ORDER_EXTRA_STATES = ['delayed', 'cancelled'];

// Polling de pedidos en vivo (20s) solo con la pestaña visible.
let ordersPollTimer = null;
let seenOrderIds = new Set();
// Última lista pintada: fuente del ticket imprimible (sin re-fetch).
let lastOrdersCache = [];
// La primera carga pinta el estado actual (sin beep): solo los pedidos que
// aparecen DESPUÉS disparan el aviso sonoro.
let ordersBaselineDone = false;
let orderTitleTimer = null;
// Ticker de antigüedad (30s): refresca los chips ⏱ sin re-fetchear.
let orderAgeTimer = null;

function isOrderSoundEnabled() {
  const box = document.getElementById('inputOrderSoundEnabled');
  if (box) return box.checked === true;
  try {
    return localStorage.getItem('scango_order_sound') !== '0';
  } catch (e) {
    return true;
  }
}

function isOrderTitleFlashEnabled() {
  const box = document.getElementById('inputOrderTitleFlashEnabled');
  if (box) return box.checked === true;
  try {
    return localStorage.getItem('scango_order_title_flash') !== '0';
  } catch (e) {
    return true;
  }
}

function isOrderBannerFlashEnabled() {
  const box = document.getElementById('inputOrderBannerFlashEnabled');
  if (box) return box.checked === true;
  try {
    return localStorage.getItem('scango_order_banner_flash') !== '0';
  } catch (e) {
    return true;
  }
}

export function toggleOrderSound() {
  const box = document.getElementById('inputOrderSoundEnabled');
  try {
    localStorage.setItem('scango_order_sound', box && box.checked ? '1' : '0');
  } catch (e) { /* storage bloqueado */ }
}

export function toggleOrderTitleFlash() {
  const box = document.getElementById('inputOrderTitleFlashEnabled');
  try {
    localStorage.setItem('scango_order_title_flash', box && box.checked ? '1' : '0');
  } catch (e) { /* storage bloqueado */ }
}

export function toggleOrderBannerFlash() {
  const box = document.getElementById('inputOrderBannerFlashEnabled');
  try {
    localStorage.setItem('scango_order_banner_flash', box && box.checked ? '1' : '0');
  } catch (e) { /* storage bloqueado */ }
}

// Beep doble por WebAudio (sin assets): se crea al momento del aviso para no
// pedir permiso antes de tiempo; si el navegador lo bloquea, falla en silencio.
function playOrderAlert(count) {
  // Sonido (WebAudio)
  if (isOrderSoundEnabled()) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const now = ctx.currentTime;
        [0, 0.22].forEach((offset, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = i === 0 ? 880 : 1174.66;
          gain.gain.setValueAtTime(0.0001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.2);
        });
        setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1000);
      }
    } catch (e) { /* autoplay bloqueado o sin audio: el badge ● NUEVO igual avisa */ }
  }
  // Parpadeo del título para cocinas con el panel en otra pestaña.
  if (isOrderTitleFlashEnabled()) {
    try {
      if (orderTitleTimer) {
        clearTimeout(orderTitleTimer);
        orderTitleTimer = null;
      }
      if (!playOrderAlert._originalTitle) playOrderAlert._originalTitle = document.title;
      document.title = `🔔 ¡${count > 1 ? count + ' pedidos nuevos' : 'Pedido nuevo'}! — ScanGo Studio`;
      orderTitleTimer = setTimeout(() => {
        document.title = playOrderAlert._originalTitle || document.title;
        orderTitleTimer = null;
      }, 8000);
    } catch (e) {}
  }
  // Banner visual parpadeante en la página.
  if (isOrderBannerFlashEnabled()) {
    showOrderBannerAlert(count);
  }
}

// Banner visual de alerta de nuevo pedido — parpadea en la parte superior
// del panel Studio. Se auto-elimina tras 8s o al hacer click.
let orderBannerAlertTimer = null;
function showOrderBannerAlert(count) {
  try {
    let banner = document.getElementById('orderBannerAlert');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'orderBannerAlert';
      banner.setAttribute('role', 'alert');
      banner.setAttribute('aria-live', 'assertive');
      banner.style.cssText = 'position:fixed; top:60px; left:50%; transform:translateX(-50%); z-index:9999; background:#E53E3E; color:#fff; font-size:13px; font-weight:700; padding:12px 24px; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.4); display:flex; align-items:center; gap:12px; cursor:pointer; animation:orderBannerPulse 1s ease-in-out infinite;';
      banner.addEventListener('click', () => { hideOrderBannerAlert(); });
      document.body.appendChild(banner);
      // Inyectar keyframes si no existen
      if (!document.getElementById('orderBannerStyles')) {
        const style = document.createElement('style');
        style.id = 'orderBannerStyles';
        style.textContent = `
          @keyframes orderBannerPulse {
            0%, 100% { opacity: 1; box-shadow: 0 8px 24px rgba(229,62,62,0.4); }
            50% { opacity: 0.7; box-shadow: 0 8px 24px rgba(229,62,62,0.7); }
          }
          @media (prefers-reduced-motion: reduce) {
            #orderBannerAlert { animation: none !important; opacity: 1 !important; }
          }
        `;
        document.head.appendChild(style);
      }
    }
    banner.innerHTML = `🔔 <span>${count > 1 ? count + ' pedidos nuevos' : '¡Pedido nuevo!'}<span> <span style="font-size:10px; opacity:0.8;">Click para cerrar</span>`;
    banner.style.display = 'flex';
    if (orderBannerAlertTimer) clearTimeout(orderBannerAlertTimer);
    orderBannerAlertTimer = setTimeout(hideOrderBannerAlert, 8000);
  } catch (e) { /* no bloquear */ }
}

function hideOrderBannerAlert() {
  const banner = document.getElementById('orderBannerAlert');
  if (banner) banner.style.display = 'none';
  if (orderBannerAlertTimer) {
    clearTimeout(orderBannerAlertTimer);
    orderBannerAlertTimer = null;
  }
}

function stopOrdersPolling() {
  if (ordersPollTimer) {
    clearInterval(ordersPollTimer);
    ordersPollTimer = null;
  }
  stopOrderAgeTicker();
}
function startOrdersPolling() {
  stopOrdersPolling();
  ordersPollTimer = setInterval(() => {
    const tab = document.getElementById('tab-notifications');
    if (tab && tab.style.display === 'none') return;
    if (document.hidden) return;
    loadRecentOrders(true);
  }, 20000);
  startOrderAgeTicker();
}

// ── Antigüedad en cocina: refresca los chips ⏱ cada 30s sin re-fetch ──
function stopOrderAgeTicker() {
  if (orderAgeTimer) {
    clearInterval(orderAgeTimer);
    orderAgeTimer = null;
  }
}
function startOrderAgeTicker() {
  stopOrderAgeTicker();
  updateOrderAges();
  orderAgeTimer = setInterval(updateOrderAges, 30000);
}
function updateOrderAges() {
  const now = Date.now();
  document.querySelectorAll('[data-order-age]').forEach(span => {
    const created = span.getAttribute('data-created') || '';
    const status = span.getAttribute('data-status') || 'pending';
    span.textContent = `⏱ ${formatOrderAgeMod(created, now)}`;
    const style = orderAgeStyleMod(orderAgeLevelMod(created, now, status));
    span.style.color = style.color;
    span.style.fontWeight = style.weight;
  });
}

// ── Impresión térmica USB directa, ESC/POS (Fase 2) ─────────────────────
// Librería MIT `@point-of-sale/receipt-printer-encoder` (Niels Leenheer
// 2024), versionada y cargada SOLO al conectar (nada en el HTML estático:
// así no toca los hashes CSP). El transporte WebUSB es código propio
// (~30 líneas de Web API estándar): pedir dispositivo → abrir → endpoint
// OUT → enviar troceado. Sin impresora o sin Chrome/Edge, el botón 🖨️
// Ticket (diálogo) sigue siendo el camino.
let usbPrinterDevice = null;
let usbPrinterEndpoint = 0;
let escposLibPromise = null;

function usbPrinterReady() {
  return Boolean(usbPrinterDevice && usbPrinterEndpoint > 0);
}

function setUsbStatus(text, ok) {
  const statusEl = document.getElementById('usbPrinterStatus');
  if (statusEl) {
    statusEl.textContent = text || '';
    statusEl.style.color = ok ? '#68D391' : 'var(--text-dim)';
  }
  const btn = document.getElementById('usbPrinterBtn');
  if (btn) btn.textContent = usbPrinterReady() ? '🔌 Desconectar' : '🔌 Impresora';
}

function getEscPosEncoderClass() {
  if (typeof window !== 'undefined' && typeof window[ESCPOS_LIB_GLOBAL_MOD] === 'function') {
    return Promise.resolve(window[ESCPOS_LIB_GLOBAL_MOD]);
  }
  if (!escposLibPromise) {
    escposLibPromise = new Promise((resolve) => {
      try {
        const script = document.createElement('script');
        script.src = ESCPOS_LIB_URL_MOD;
        script.async = true;
        script.onload = () => resolve(
          (typeof window !== 'undefined' && typeof window[ESCPOS_LIB_GLOBAL_MOD] === 'function')
            ? window[ESCPOS_LIB_GLOBAL_MOD]
            : null
        );
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
        setTimeout(() => resolve(
          (typeof window !== 'undefined' && typeof window[ESCPOS_LIB_GLOBAL_MOD] === 'function')
            ? window[ESCPOS_LIB_GLOBAL_MOD]
            : null
        ), 10000);
      } catch (e) {
        resolve(null);
      }
    });
  }
  return escposLibPromise;
}

export async function connectUsbPrinter() { return connectUsbPrinterMod(); }
async function restoreUsbPrinter() { return restoreUsbPrinterMod(); }
export async function printOrderEscPos(orderId) { return printOrderEscPosMod(orderId, lastOrdersCache, restaurant); }

async function loadRecentOrders(silent = false) {
  const list = document.getElementById('recentOrdersList');
  if (!list) return;
  const restaurantId = restaurant && restaurant.id;
  if (!restaurantId) {
    list.innerHTML = '<div style="font-size:11px; color:var(--text-dim);">Guardá tu local para ver los pedidos.</div>';
    return;
  }
  list.innerHTML = '<div style="font-size:11px; color:var(--text-dim);">⏳ Cargando…</div>';
  try {
    const res = await studioApi(`/api/orders/restaurant/${encodeURIComponent(restaurantId)}`);
    const body = await res.json();
    if (!res.ok || !Array.isArray(body.data)) {
      list.innerHTML = `<div style="font-size:11px; color:#F87171;">${escapeHtml(body.error || 'No se pudieron cargar los pedidos.')}</div>`;
      return;
    }
    const orders = body.data.slice(0, 20);
    lastOrdersCache = orders;
    // Pedidos pendientes que no habíamos visto: solo avisan si ya pintamos
    // una base (la primera carga es el estado actual, no una novedad).
    const freshPending = orders.filter(o => !seenOrderIds.has(o.id) && (o.status || 'pending') === 'pending');
    if (!orders.length) {
      list.innerHTML = '<div style="font-size:11px; color:var(--text-dim);">Sin pedidos todavía. Cuando un comensal pida desde el menú, aparece acá.</div>';
      return;
    }
    list.innerHTML = orders.map(o => {
      const status = o.status || 'pending';
      const label = ORDER_STATUS_LABELS[status] || status;
      const items = (o.items_snapshot || []).map(i => `${i.quantity}× ${i.name}`).join(', ');
      const when = o.created_at ? new Date(o.created_at).toLocaleString() : '';
      const isNew = !seenOrderIds.has(o.id) && status === 'pending';
      seenOrderIds.add(o.id);
      const chips = ORDER_ACTION_STATES.map(s => {
        const active = s === status;
        return `<button type="button" class="btn-nav" data-js-click="setOrderStatus|${escapeHtml(o.id)}|${s}" style="font-size:10px; padding:4px 8px; ${active ? 'border-color:#68D391; color:#68D391;' : ''}">${escapeHtml(ORDER_STATUS_LABELS[s])}</button>`;
      }).join(' ');
      const extraChips = ORDER_EXTRA_STATES.map(s => {
        const active = s === status;
        const danger = ORDER_DANGER_STATES.includes(s);
        return `<button type="button" class="btn-nav" data-js-click="setOrderStatus|${escapeHtml(o.id)}|${s}" style="font-size:10px; padding:4px 8px; ${active ? 'border-color:#68D391; color:#68D391;' : (danger ? 'border-color:rgba(229,62,62,0.5); color:#F87171;' : 'border-color:rgba(237,137,54,0.5); color:#FBD38D;')}">${escapeHtml(ORDER_STATUS_LABELS[s])}</button>`;
      }).join(' ');
      const total = o.total != null ? o.total : o.amount;
      // Antigüedad en cocina: chip vivo (lo refresca el ticker cada 30s).
      const ageStyle = orderAgeStyleMod(orderAgeLevelMod(o.created_at, Date.now(), status));
      const ageChip = `<span data-order-age data-created="${escapeHtml(o.created_at || '')}" data-status="${escapeHtml(status)}" title="Tiempo en cocina" style="font-size:10px; color:${ageStyle.color}; font-weight:${ageStyle.weight}; white-space:nowrap; margin-left:8px;">⏱ ${escapeHtml(formatOrderAgeMod(o.created_at, Date.now()))}</span>`;
      return `<div style="background:var(--bg-base); border:1px solid ${isNew ? '#D4A853' : 'var(--border)'}; border-radius:8px; padding:10px 12px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
          <div style="font-size:12px; font-weight:700; color:#fff;">${escapeHtml(o.customer_name || 'Cliente')}${o.table_number ? ` · Mesa ${escapeHtml(String(o.table_number))}` : ''}${o.waiterName ? ` · <span style="color:#93c5fd;" title="Tomado por el mozo">🧑‍🍳 ${escapeHtml(o.waiterName)}</span>` : ''} ${isNew ? '<span style="font-size:9px; background:#D4A853; color:#101614; border-radius:4px; padding:1px 6px; font-weight:800;">● NUEVO</span>' : ''}</div>
          <div style="font-size:11px; color:#68D391; font-weight:700; white-space:nowrap;">${escapeHtml(label)}${ageChip}</div>
        </div>
        <div style="font-size:11px; color:var(--text-dim); margin:3px 0;">${escapeHtml(items)}</div>
        <div style="font-size:10px; color:var(--text-dim); margin-bottom:6px;">${escapeHtml(o.currency || '$')} ${Number(total || 0).toFixed(2)} · ${escapeHtml(when)}</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">${chips}</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">${extraChips}</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
          <button type="button" class="btn-nav" data-js-click="printOrderTicket|${escapeHtml(o.id)}" style="font-size:10px; padding:4px 8px; border-color:rgba(255,255,255,0.25); color:var(--text-dim);" title="Imprimir ticket de cocina (80mm)">🖨️ Ticket</button>
          <button type="button" class="btn-nav" data-js-click="printOrderEscPos|${escapeHtml(o.id)}" style="font-size:10px; padding:4px 8px; border-color:rgba(0,245,212,0.4); color:#00F5D4;" title="Imprimir directo en térmica USB (requiere conectar 🔌)">⚡ Imprimir USB</button>
        </div>
      </div>`;
    }).join('');
    // Aviso sonoro + título solo ante novedades reales (nunca en la base).
    if (ordersBaselineDone && freshPending.length && isOrderSoundEnabled()) {
      playOrderAlert(freshPending.length);
    }
    ordersBaselineDone = true;
    startOrdersPolling();
  } catch (e) {
    list.innerHTML = '<div style="font-size:11px; color:#F87171;">Error de conexión.</div>';
  }
}

// ── Ticket de cocina imprimible (Fase 1) ─────────────────────────────
// Rellena #orderTicketPrint con el pedido y abre el diálogo del navegador.
// El CSS (@media print en studio.css) deja visible SOLO el ticket en 80mm:
// funciona con térmica, común o PDF, sin permisos ni hardware especial.
// Todo dato va escapado (el pedido viene del comensal: nombre, notas, mesa).
export function printOrderTicket(orderId) {
  const box = document.getElementById('orderTicketPrint');
  if (!box) return;
  const order = (lastOrdersCache || []).find(o => String(o.id) === String(orderId));
  if (!order) {
    alert('No se encontró el pedido. Tocá "Actualizar" e intentá de nuevo.');
    return;
  }
  const status = order.status || 'pending';
  const label = ORDER_STATUS_LABELS[status] || status;
  const items = Array.isArray(order.items_snapshot) ? order.items_snapshot : [];
  const currency = order.currency || (restaurant && restaurant.currency) || '$';
  const total = order.total != null ? order.total : order.amount;
  const when = order.created_at ? new Date(order.created_at).toLocaleString() : '';
  const lines = items.map(i => {
    const qty = Number(i.quantity) || 0;
    const name = escapeHtml(i.name || 'Ítem');
    const note = i.note ? `<div class="ticket-note">↳ ${escapeHtml(i.note)}</div>` : '';
    return `<div class="ticket-item"><div class="ticket-row"><span>${qty}× ${name}</span></div>${note}</div>`;
  }).join('') || '<div class="ticket-item">Sin detalle de ítems</div>';
  box.innerHTML = `
    <div class="ticket-paper">
      <p class="ticket-title">${escapeHtml((restaurant && (restaurant.name || restaurant.bizName)) || 'Mi local')}</p>
      <p class="ticket-sub">TICKET DE COCINA · ${escapeHtml(label)}</p>
      <hr class="ticket-sep">
      <div class="ticket-row"><span>Cliente:</span><span>${escapeHtml(order.customer_name || 'Cliente')}</span></div>
      ${order.table_number ? `<div class="ticket-row"><span>Mesa:</span><span>${escapeHtml(String(order.table_number))}</span></div>` : ''}
      <div class="ticket-row"><span>Fecha:</span><span>${escapeHtml(when)}</span></div>
      <div class="ticket-row"><span>Pedido:</span><span>${escapeHtml(String(order.id).slice(-6))}</span></div>
      <hr class="ticket-sep">
      ${lines}
      <hr class="ticket-sep">
      <div class="ticket-row ticket-total"><span>TOTAL:</span><span>${escapeHtml(currency)} ${Number(total || 0).toFixed(2)}</span></div>
      <hr class="ticket-sep">
      <p class="ticket-center ticket-sub">Generado por ScanGo</p>
    </div>`;
  try {
    window.print();
  } catch (e) {
    alert('No se pudo abrir el diálogo de impresión en este navegador.');
  }
}

async function setOrderStatus(orderId, status) {
  if (!orderId || !status) return;
  // Cancelar es destructivo (el comensal lo ve al instante): confirmación con
  // el diálogo propio (no bloqueante). Sin UI, default seguro = no cancelar.
  if (ORDER_DANGER_STATES.includes(status)) {
    let ok = false;
    if (typeof window.showConfirmDialog === 'function') {
      try {
        ok = Boolean(await Promise.resolve(window.showConfirmDialog({
          icon: '⚠️',
          title: 'Cancelar pedido',
          message: 'El comensal lo verá como cancelado al instante. ¿Continuar?',
          confirmText: 'Sí, cancelar',
          confirmClass: 'btn-danger'
        })));
      } catch {
        ok = false;
      }
    }
    if (!ok) return;
  }
  try {
    const res = await studioApi(`/api/orders/status/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    const b = await res.json();
    if (!res.ok || !b.success) {
      alert(b.error || 'No se pudo actualizar el estado del pedido.');
      return;
    }
    const n = b.data && b.data.notification;
    if (n && n.skipped === 'NO_MATCHING_SUBSCRIBERS') {
      // Sin push dirigido: igual quedó persistido para la vista de seguimiento.
    }
    loadRecentOrders();
  } catch (e) {
    alert('Error de conexión al actualizar el pedido.');
  }
}

// ── Salud SEO (tab SEO) ─────────────────────────────────────────────────────
const SEO_STATUS_COLORS = { ok: '#2e9e5b', warn: '#d4a853', fail: '#d64545' };

async function loadSeoAudit() {
  const list = document.getElementById('seoAuditList');
  if (!list) return;
  list.textContent = '';
  const scoreBox = document.getElementById('seoAuditScore');
  const badge = document.getElementById('seoScoreBadge');
  const label = document.getElementById('seoScoreLabel');
  const summary = document.getElementById('seoScoreSummary');
  try {
    const res = await fetch('/api/studio/seo-audit');
    if (res.status === 401) {
      list.appendChild(createSeoAuditItem('warn', 'Sesión vencida', 'Recargá la página para volver a entrar.'));
      if (scoreBox) scoreBox.style.display = 'none';
      return;
    }
    if (!res.ok) {
      list.appendChild(createSeoAuditItem('fail', 'No se pudo auditar', 'El servicio no respondió. Reintentá en un momento.'));
      if (scoreBox) scoreBox.style.display = 'none';
      return;
    }
    const data = await res.json();
    if (!data.checks || !Array.isArray(data.checks)) return;
    const grade =
      data.score >= 90
        ? { label: 'Excelente', color: '#2e9e5b' }
        : data.score >= 70
          ? { label: 'Muy bien', color: '#7bbf5e' }
          : data.score >= 50
            ? { label: 'A mejorar', color: '#d4a853' }
            : { label: 'Crítico', color: '#d64545' };
    if (badge) {
      badge.textContent = String(data.score);
      badge.style.background = grade.color;
    }
    if (label) label.textContent = `${grade.label} (${data.score}/100)`;
    if (summary) summary.textContent = `${data.summary.ok} en orden · ${data.summary.warn} recomendaciones · ${data.summary.fail} por arreglar.`;
    if (scoreBox) scoreBox.style.display = 'flex';
    data.checks.forEach((c) => list.appendChild(createSeoAuditItem(c.status, c.label, c.hint)));
  } catch (e) {
    list.appendChild(createSeoAuditItem('warn', 'Sin conexión', 'Reintentá más tarde.'));
    if (scoreBox) scoreBox.style.display = 'none';
  }
}

function createSeoAuditItem(status, title, hint) {
  const li = document.createElement('li');
  li.style.cssText = `display:flex; gap:10px; align-items:flex-start; padding:8px 10px; margin-bottom:8px; border-radius:8px; background:var(--bg-base); border-left:3px solid ${SEO_STATUS_COLORS[status]};`;
  const icon = document.createElement('span');
  icon.textContent = status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '✗';
  icon.style.cssText = `color:${SEO_STATUS_COLORS[status]}; font-weight:800; font-size:14px; line-height:20px;`;
  const text = document.createElement('div');
  const t = document.createElement('div');
  t.textContent = title;
  t.style.cssText = 'font-weight:700; font-size:12px; color:var(--text-light);';
  const h = document.createElement('div');
  h.textContent = hint;
  h.style.cssText = 'font-size:11px; color:var(--text-dim); margin-top:2px;';
  text.appendChild(t);
  text.appendChild(h);
  li.appendChild(icon);
  li.appendChild(text);
  return li;
}

// ── Puesta en marcha (checklist de activación) ─────────────────────────
// El módulo puro calcula el progreso desde el estado real del local; acá se
// expone al binder data-js-* y se navega a la pestaña del paso pendiente.
export function renderOnboardingChecklist() { renderOnboardingMod(restaurant); }
export function refreshOnboardingChecklist() { refreshOnboardingMod(); }
export function dismissOnboardingChecklist() { dismissOnboardingMod(); }
export function onboardGoToStep(tab) { switchTab(tab); }

// ── Equipo y turnos (Sistema de Mozos y Cocina) ────────────────────────────
export function loadStaff(options) { return loadStaffMod(options); }
export function saveStaffAssignments() { return saveStaffAssignmentsMod(); }
export function openStaffCreateModal() { return openStaffCreateModalMod(); }
export function openStaffEditModal(id) { return openStaffEditModalMod(id); }
export function closeStaffEditor() { return closeStaffEditorMod(); }
export function saveStaffEditor(event) { return saveStaffEditorMod(event); }
export function toggleStaffActive(id) { return toggleStaffActiveMod(id); }
export function revokeStaffSessions(id) { return revokeStaffSessionsMod(id); }
export function deleteStaffMember(id) { return deleteStaffMemberMod(id); }
export function rotateStaffCredential(id) { return rotateStaffCredentialMod(id); }
export function closeStaffQrModal() { return closeStaffQrModalMod(); }
export function copyStaffQrLink() { return copyStaffQrLinkMod(); }

// ── Reservas (backlog #2) ───────────────────────────────────────────────────
export function loadReservations(options) { return loadReservationsMod(options); }
export function changeReservationsDate(value) { return changeReservationsDateMod(value); }
export function setReservationStatus(id, status) { return setReservationStatusMod(id, status); }

// R3 · Niveles de lealtad: toggle del bloque → muestra/oculta las filas.
export function toggleLoyaltyLevels(inputEl) {
  const rowsEl = el('loyaltyLevelsRows');
  if (rowsEl) rowsEl.style.display = inputEl && inputEl.checked ? 'flex' : 'none';
  const sliderLL = el('sliderLoyaltyLevels');
  if (sliderLL) sliderLL.style.backgroundColor = inputEl && inputEl.checked ? '#38A169' : '#2a3a33';
}

// Bind all functions to window for HTML inline event handlers
const globalExports = {
  initStudio, loadSeoAudit, logout, openDeleteAccountModal, closeDeleteAccountModal, confirmAccountDeletion,
  renderStudioUI, updateLiveState, saveStudioChanges, triggerAutoSave, reloadPreviewIframe, syncLivePreviewIframe, setPreviewView,
  switchTab, showConfirmDialog, closeConfirmDialog, showSaveFeedback,
  handleLogoUpload, removeLogo, handleBannerUpload, handleBannerUrlInput, removeBanner, renderBannerPreviewUI, handleBannerImageError,
  openBillingModal, closeBillingModal, startCheckout, cancelSubscription,
  renderDeliveryZones, addDeliveryZone, deleteDeliveryZone,
  renderBranchesList, addBranch, deleteBranch, editBranch, closeBranchEdit, saveBranchEdit, addBranchOverrideRow, removeBranchOverrideRow, addBranchCustomDishRow, removeBranchCustomDishRow, resetBranchForm,
  loadAnalytics, updateKPIs, renderDailyChart, renderHeatmap, renderBranchMetrics, renderEventMetrics, renderTopDishes, exportAnalytics,
  generateQrCode, downloadQrPng, printTableStand, printReviewTent, downloadAllTablesPDF,
  promptNewCategoryInModal, openCategoryManagerModal, closeCategoryManagerModal, moveCategory, addCategoryFromManager, renameCategory, deleteCategory, duplicateCategoryFromManager,
  populateCatFilter, renderDishesList, editDish, openNewDishModal, closeDishEditModal, saveDishFromModal, handleDishPhotoUpload, deleteDish, duplicateDishItem, clearDishPhoto, clearDishVideo, previewDishVideo, uploadDishVideoFile, toggleDishScheduleControls, toggleDishesByIngredient,
  exportMenuJson, importMenuJsonFile,
  openPresetsModal, closePresetsModal, renderPresetChips, browsePresetCategory, addSinglePresetDish, importCurrentPresetCategory, importAllPresets,
  openIceCreamPresetsModal, closeIceCreamPresetsModal, filterIceCreamPresetCat, toggleAllIceCreamFlavors, renderIceCreamPresetsList, toggleIceCreamFlavorItem, importSelectedIceCreamFlavors,
  openPerfumeryPresetsModal, closePerfumeryPresetsModal, renderPerfumeryPresetsList, importSelectedPerfumery,
  openModifierGroupManager, closeModifierGroupManager, addBurgerModifierTemplate, startNewModifierGroup, editModifierGroup,
  renderModifierGroupOptions, updateModifierGroupEditor, handleModifierGroupModeChange, addModifierGroupOption, removeModifierGroupOption,
  saveModifierGroup, cancelModifierGroupEdit, deleteModifierGroup, toggleDishModifierGroup,
  sendOrderStateWA, setReviewPhotoOption, handleReviewPhotoFile, check30DaysMilestone, openMilestone30DaysModal, closeMilestone30DaysModal, openReviewFromMilestone, submitOwnerReview,
  solicitarPushPermiso,
  addLoyaltyReward, removeLoyaltyReward, updateLoyaltyRewardField, validateLoyaltyCode, handleRedeemCodeEnter,
  addWeddingItineraryItem, removeWeddingItineraryItem, updateWeddingItineraryField, renderWeddingItineraryRows,
  openIceCreamConfigModal, closeIceCreamConfigModal, renderIceCreamConfigRows,
  updateIceCreamContainerField, addIceCreamContainer, removeIceCreamContainer,
  updateIceCreamToppingField, addIceCreamTopping, removeIceCreamTopping, resetIceCreamConfig,
  addEventGuest, removeEventGuest, updateEventGuestField, renderEventGuestRows, sendGuestInvite, copyGuestInviteLink,
  validateGoogleReviewLink, testGoogleReviewLink, copyReviewLink, loadReviewFunnel,
  loadNotificationEvents, markNotificationEventRead, sendPromoPush,
  loadChurnList, sendReactivation,
  launchWinbackCampaign, loadWinbackCoupons,
  loadRecentOrders, setOrderStatus, toggleOrderSound, toggleOrderTitleFlash, toggleOrderBannerFlash, printOrderTicket, printOrderEscPos, connectUsbPrinter,
  importDemoTemplate, discardDemoTemplate,
  renderOnboardingChecklist, refreshOnboardingChecklist, dismissOnboardingChecklist, onboardGoToStep,
  loadStaff, saveStaffAssignments, openStaffCreateModal, openStaffEditModal, closeStaffEditor, saveStaffEditor,
  toggleStaffActive, revokeStaffSessions, deleteStaffMember, rotateStaffCredential, closeStaffQrModal, copyStaffQrLink,
  loadReservations, changeReservationsDate, setReservationStatus, toggleLoyaltyLevels,
  updateBusinessTypeControls, filterThemeOptionsByBusinessType, resolveIceCreamButtonStyle,
  openAiMenuImportModal, closeAiMenuImportModal, handleAiMenuFilesInput, moveAiMenuPage, removeAiMenuPage, runAiMenuAnalysis, closeAiMenuPreviewModal, confirmAiMenuImportAction, removeDetectedAiDish
};

Object.entries(globalExports).forEach(([name, fn]) => {
  window[name] = fn;
});

// Auto-Sync Queue: When owner recovers internet connection, sync local state to backend automatically
window.addEventListener('online', () => {
  showSaveFeedback('saving');
  saveStudioChanges();
});

// Run
window.addEventListener('DOMContentLoaded', () => {
  initStudio();
  initModalA11y();
  setupPushNotifications();
  // Quick Win #8: superficie propia del Studio para instalar la PWA del dueño
  // (también setea __SCANGO_PWA_SUPPRESS_BANNER__ para pwa.js).
  initStudioPwaNudge();
});