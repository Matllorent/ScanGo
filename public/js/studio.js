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
import { state } from './studio/state.js';
import { PLANS } from './studio/data/plans.js';
import { PRESETS } from './studio/data/presetsData.js';
import { ICE_CREAM_PRESETS_DATA } from './studio/data/iceCreamPresets.js';
import { PERFUMERY_PRESETS_STUDIO } from './studio/data/perfumeryPresets.js';
import { setupPushNotifications, solicitarPushPermiso } from './studio/notifications.js';

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
  deleteCategory as deleteCategoryMod
} from './studio/categoryManager.js';

import {
  openBillingModal as openBillingModalMod,
  closeBillingModal as closeBillingModalMod,
  startCheckout as startCheckoutMod,
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
  populateCatFilter as populateCatFilterMod,
  renderDishesList as renderDishesListMod,
  deleteDish as deleteDishMod,
  clearDishPhoto,
  toggleDishScheduleControls,
  editDish as editDishMod,
  openNewDishModal as openNewDishModalMod,
  closeDishEditModal,
  saveDishFromModal as saveDishFromModalMod,
  handleDishPhotoUpload as handleDishPhotoUploadMod,
  toggleDishesByIngredient as toggleDishesByIngredientMod
} from './studio/dishEditor.js';

import { switchTab as switchTabMod } from './studio/ui/tabs.js';
import { showConfirmDialog, closeConfirmDialog } from './studio/ui/confirmDialog.js';
import { showSaveFeedback } from './studio/ui/saveFeedback.js';

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

export function updateBusinessTypeControls() {
  const bizType = normalizeBusinessType(restaurant?.businessType);
  const perfumerySection = document.getElementById('perfumeryControlsSection');
  if (perfumerySection) {
    perfumerySection.style.display = (bizType === 'perfumery') ? 'flex' : 'none';
    const perfCheckbox = el('inputAllowPerfumery');
    const sliderP = el('sliderPerfumery');
    if (bizType === 'perfumery' && perfCheckbox) {
      // Auto-activar el catálogo de perfumería al elegir el tipo (backend solo
      // defaultea true si el flag está undefined; un false explícito lo mata).
      perfCheckbox.checked = true;
      if (sliderP) sliderP.style.backgroundColor = '#38A169';
    }
  }
  const iceCreamSection = document.getElementById('iceCreamControlsSection');
  if (iceCreamSection) {
    iceCreamSection.style.display = (bizType === 'heladeria') ? 'flex' : 'none';
    const iceCreamCheckbox = el('inputAllowIceCreamWizard');
    const sliderI = el('sliderIceCreamWizard');
    if (bizType === 'heladeria' && iceCreamCheckbox) {
      // Idem: una heladería nueva debe nacer con el asistente activo.
      iceCreamCheckbox.checked = true;
      if (sliderI) sliderI.style.backgroundColor = '#38A169';
    }
  }
  const weddingSection = document.getElementById('weddingItinerarySection');
  if (weddingSection) {
    weddingSection.style.display = (bizType === 'events') ? 'flex' : 'none';
  }
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
export function renderStatsTab() {
  const stats = restaurant?.analytics || { visits: 0, orders: 0, reservations: 0, waiterCalls: 0 };
  const el = id => document.getElementById(id);
  if (el('statVisits')) el('statVisits').textContent = stats.visits || 0;
  if (el('statOrders')) el('statOrders').textContent = stats.orders || 0;
  if (el('statReservations')) el('statReservations').textContent = stats.reservations || 0;
  if (el('statWaiterCalls')) el('statWaiterCalls').textContent = stats.waiterCalls || 0;
}

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
  const restName = restaurant?.name || 'Menú Pizarrón';

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

// Account Deletion
export async function confirmAccountDeletion() {
  const btn = document.getElementById('btnConfirmDeleteAccount');
  const reason = document.getElementById('deleteAccountReason')?.value.trim() || 'Sin motivo especificado';
  if (!confirm('¿Estás seguro de solicitar la baja definitiva de tu cuenta y todos tus datos? Esta acción no se puede deshacer.')) {
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Procesando baja...';
  }
  const authHeaders = window.AuthClient
    ? window.AuthClient.getAuthHeaders({ 'Content-Type': 'application/json' })
    : { 'Content-Type': 'application/json' };
  try {
    await fetch('/api/account/delete-request', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason })
    }).catch(() => {});
  } catch (e) {}

  alert('Tu solicitud de eliminación de cuenta y purga de datos personales ha sido registrada correctamente.');
  localStorage.clear();
  window.location.href = '/index.html';
}

// Live State Synchronization
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

  const layoutSelect = el('inputMenuLayout');
  if (layoutSelect) restaurant.layout = layoutSelect.value || 'classic';
  if (el('inputThemeBg')) restaurant.theme = el('inputThemeBg').value;
  if (el('inputThemeFont')) restaurant.themeFont = el('inputThemeFont').value;
  // Acento neón (sólo layout neon; el backend valida el allowlist)
  const neonSelect = el('inputNeonAccent');
  if (neonSelect) restaurant.neonAccent = neonSelect.value || 'mint';
  const neonRow = document.getElementById('neonAccentRow');
  if (neonRow) neonRow.style.display = (layoutSelect && layoutSelect.value === 'neon') ? 'block' : 'none';

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

  const schedCheck = el('inputScheduleEnabled');
  if (schedCheck) {
    restaurant.scheduleEnabled = schedCheck.checked;
    const sliderSched = el('sliderSchedule');
    if (sliderSched) sliderSched.style.backgroundColor = schedCheck.checked ? '#38A169' : '#2a3a33';
  }
  const schedHours = el('inputScheduleActiveHours');
  if (schedHours) restaurant.scheduleActiveHours = schedHours.value.trim();

  if (el('inputTableCount')) restaurant.tableCount = parseInt(el('inputTableCount').value) || 10;

  if (el('studioNavRestaurantName')) el('studioNavRestaurantName').textContent = restaurant.name;
  if (el('previewFullUrl')) el('previewFullUrl').textContent = `/m/${restaurant.slug}`;
  if (el('btnLiveMenu')) el('btnLiveMenu').href = `/m/${restaurant.slug}`;

  generateQrCode();
  syncLivePreviewIframe();

  try {
    localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(restaurant));
  } catch (e) {}

  triggerAutoSave();
}

export function triggerAutoSave() {
  triggerAutoSaveMod({ autoSaveTimeout }, showSaveFeedback, saveStudioChanges);
}

export async function saveStudioChanges() {
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

  if (el('inputInstagram')) el('inputInstagram').value = restaurant.instagram || '';
  if (el('inputFacebook')) el('inputFacebook').value = restaurant.facebook || '';
  if (el('inputTiktok')) el('inputTiktok').value = restaurant.tiktok || '';
  if (el('inputX')) el('inputX').value = restaurant.x || '';
  if (el('inputGoogleReview')) el('inputGoogleReview').value = restaurant.googleReview || '';

  const layoutSelect = el('inputMenuLayout');
  if (layoutSelect) layoutSelect.value = restaurant.layout || 'classic';
  if (el('inputThemeBg')) el('inputThemeBg').value = restaurant.theme || 'emerald';
  if (el('inputThemeFont')) el('inputThemeFont').value = restaurant.themeFont || 'serif';
  if (el('inputNeonAccent')) el('inputNeonAccent').value = restaurant.neonAccent || 'mint';
  const neonRowLoad = document.getElementById('neonAccentRow');
  if (neonRowLoad) neonRowLoad.style.display = ((restaurant.layout || 'classic') === 'neon') ? 'block' : 'none';

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

  const schedCheck = el('inputScheduleEnabled');
  if (schedCheck) {
    schedCheck.checked = !!restaurant.scheduleEnabled;
    const sliderSched = el('sliderSchedule');
    if (sliderSched) sliderSched.style.backgroundColor = schedCheck.checked ? '#38A169' : '#2a3a33';
  }
  if (el('inputScheduleActiveHours')) el('inputScheduleActiveHours').value = restaurant.scheduleActiveHours || '';
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
  updateBusinessTypeControls();

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
      a.download = `QR-${restaurant?.slug || 'menu'}-menu-pizarron.png`;
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

export function promptNewCategoryInModal() { promptNewCategoryMod(restaurant, populateCatFilter, triggerAutoSave); }
export function openCategoryManagerModal() { openCategoryModal(() => renderCategoryListMod(restaurant, escapeHtml)); }
export function closeCategoryManagerModal() { closeCategoryModal(populateCatFilter); }
export function moveCategory(id, dir) { moveCategoryMod(restaurant, id, dir, () => { renderCategoryListMod(restaurant, escapeHtml); populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }
export function addCategoryFromManager() { addCategoryMod(restaurant, () => { renderCategoryListMod(restaurant, escapeHtml); populateCatFilter(); triggerAutoSave(); }); }
export function renameCategory(id) { renameCategoryMod(restaurant, id, () => { renderCategoryListMod(restaurant, escapeHtml); populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }
export function deleteCategory(id) { deleteCategoryMod(restaurant, id, () => { renderCategoryListMod(restaurant, escapeHtml); populateCatFilter(); renderDishesList(); triggerAutoSave(); }); }

export function populateCatFilter() { populateCatFilterMod(restaurant); }
export function renderDishesList() { renderDishesListMod(restaurant, escapeHtml); }
export function editDish(id) { editDishMod(restaurant, id); }
export function openNewDishModal() { openNewDishModalMod(restaurant); }
export function saveDishFromModal(e) { saveDishFromModalMod(restaurant, e, () => { renderDishesList(); triggerAutoSave(); }); }
export function handleDishPhotoUpload(input) { return handleDishPhotoUploadMod(input, compressImageFile); }
export function deleteDish(id) { deleteDishMod(restaurant, id, showConfirmDialog, () => { renderDishesList(); triggerAutoSave(); }); }
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
  if (tabId === 'analytics') loadAnalyticsMod(restaurant);
  if (tabId === 'branches') renderBranchesList();
  if (tabId === 'dishes') { populateCatFilter(); renderDishesList(); }
  if (tabId === 'qr') generateQrCode();
  if (tabId === 'stats') renderStatsTab();
  if (tabId === 'notifications') { loadNotificationEvents(); loadRecentOrders(); }
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

export async function initStudio() {
  await initStudioAuth(state, () => {
    currentUser = state.currentUser;
    restaurant = state.restaurant;
    renderStudioUI();
  }, normalizeRestaurantBusinessType);

  // El paywall (initStudioAuth retorna temprano sin pasar por el callback de
  // render) también necesita estos datos: `openBillingModal` los lee de acá.
  currentUser = state.currentUser || currentUser;
  restaurant = state.restaurant || restaurant;

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

function getLoyaltyConfigRef() {
  if (!restaurant) return null;
  if (!restaurant.loyaltyConfig) restaurant.loyaltyConfig = {};
  if (!Array.isArray(restaurant.loyaltyConfig.rewards)) restaurant.loyaltyConfig.rewards = [];
  return restaurant.loyaltyConfig;
}

function renderLoyaltyRewardRows() {
  const container = document.getElementById('loyaltyRewardRows');
  if (!container) return;
  const cfg = getLoyaltyConfigRef();
  const rewards = cfg ? cfg.rewards : [];
  if (!rewards.length) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-dim); padding:6px 0;">Sin beneficios configurados. Tocá "Agregar beneficio" para armar tu catálogo.</div>';
    return;
  }
  container.innerHTML = rewards.map((r, i) => `
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
      <input type="text" id="loyaltyRewardTitle_${i}" class="form-input" value="${escapeHtml(String(r.title || ''))}" placeholder="Nombre del beneficio"
             data-js-input="updateLoyaltyRewardField|${i}|title|this.value" style="flex:1; font-size:11px; padding:6px 8px;">
      <input type="number" id="loyaltyRewardCost_${i}" class="form-input" value="${Number(r.pointsCost) || 0}" min="0" step="10"
             data-js-input="updateLoyaltyRewardField|${i}|cost|this.value" style="width:96px; font-size:11px; padding:6px 8px;" title="Puntos requeridos">
      <button type="button" class="btn-nav" data-js-click="removeLoyaltyReward|${i}" style="padding:4px 8px; font-size:10px; border-color:#E53E3E; color:#F87171;">✕</button>
    </div>
  `).join('');
}

function updateLoyaltyRewardField(index, field, value) {
  const cfg = getLoyaltyConfigRef();
  if (!cfg) return;
  const reward = cfg.rewards[index];
  if (!reward) return;
  if (field === 'title') reward.title = String(value || '').trim().slice(0, 60);
  else if (field === 'cost') reward.pointsCost = Math.max(0, Number(value) || 0);
}

function addLoyaltyReward() {
  const cfg = getLoyaltyConfigRef();
  if (!cfg) return;
  cfg.rewards.push({ id: 'rew_' + Date.now().toString(36), title: '', pointsCost: 100 });
  renderLoyaltyRewardRows();
  triggerAutoSave();
}

function removeLoyaltyReward(index) {
  const cfg = getLoyaltyConfigRef();
  if (!cfg) return;
  cfg.rewards.splice(index, 1);
  renderLoyaltyRewardRows();
  triggerAutoSave();
}

// ── Itinerario visual de boda (restaurant.weddingItinerary) ──
const WEDDING_ITINERARY_ICONS = ['💒', '🤵', '👰', '💍', '🥂', '🍸', '🍽️', '🎂', '📸', '🎶', '💃', '🕺', '🌙', '✨', '🔔', '💐', '💛'];

function getWeddingItineraryRef() {
  if (!restaurant) return null;
  if (!restaurant.weddingItinerary || typeof restaurant.weddingItinerary !== 'object') {
    restaurant.weddingItinerary = { enabled: false, title: '', coupleNames: '', date: '', venue: '', items: [] };
  }
  if (!Array.isArray(restaurant.weddingItinerary.items)) restaurant.weddingItinerary.items = [];
  return restaurant.weddingItinerary;
}

function renderWeddingItineraryRows() {
  const container = document.getElementById('weddingItineraryRows');
  if (!container) return;
  const it = getWeddingItineraryRef();
  const items = it ? it.items : [];
  if (!items.length) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-dim); padding:6px 0;">Sin momentos. Tocá "Agregar momento" para armar el programa (recepción, ceremonia, cena, fiesta…).</div>';
    return;
  }
  const iconOptions = (current) => WEDDING_ITINERARY_ICONS.map(ic =>
    `<option value="${ic}"${ic === current ? ' selected' : ''}>${ic}</option>`).join('');
  container.innerHTML = items.map((stop, i) => `
    <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px;">
      <input type="text" class="form-input" value="${escapeHtml(String(stop.time || ''))}" maxlength="12" placeholder="18:00"
             data-js-input="updateWeddingItineraryField|${i}|time|this.value" style="width:76px; flex-shrink:0; font-size:11px; padding:6px 8px;" title="Hora del momento">
      <input type="text" class="form-input" value="${escapeHtml(String(stop.title || ''))}" maxlength="80" placeholder="Recepción de invitados"
             data-js-input="updateWeddingItineraryField|${i}|title|this.value" style="flex:1; font-size:11px; padding:6px 8px;" title="Momento">
      <select class="form-input" data-js-change="updateWeddingItineraryField|${i}|icon|this.value" style="width:64px; flex-shrink:0; font-size:14px; padding:6px 4px;" title="Icono">
        ${iconOptions(stop.icon || '💛')}
      </select>
      <button type="button" class="btn-nav" data-js-click="removeWeddingItineraryItem|${i}" style="padding:4px 8px; font-size:10px; border-color:#E53E3E; color:#F87171;">✕</button>
    </div>
  `).join('');
}

function updateWeddingItineraryField(index, field, value) {
  const it = getWeddingItineraryRef();
  if (!it) return;
  const stop = it.items[index];
  if (!stop) return;
  if (field === 'time') stop.time = String(value || '').trim().slice(0, 12);
  else if (field === 'title') stop.title = String(value || '').trim().slice(0, 80);
  else if (field === 'icon') stop.icon = String(value || '💛').slice(0, 8);
}

function addWeddingItineraryItem() {
  const it = getWeddingItineraryRef();
  if (!it) return;
  if (it.items.length >= 12) return;
  it.items.push({ time: '', title: '', icon: '💛' });
  renderWeddingItineraryRows();
  triggerAutoSave();
}

function removeWeddingItineraryItem(index) {
  const it = getWeddingItineraryRef();
  if (!it) return;
  it.items.splice(index, 1);
  renderWeddingItineraryRows();
  triggerAutoSave();
}

async function validateLoyaltyCode() {
  const codeEl = document.getElementById('inputRedeemCode');
  const resultEl = document.getElementById('loyaltyValidateResult');
  if (!codeEl || !resultEl) return;
  const code = codeEl.value.trim().toUpperCase();
  if (!code) {
    resultEl.innerHTML = '<span style="color:#F87171;">Ingresá el código de canje del comensal.</span>';
    return;
  }
  resultEl.innerHTML = '<span style="color:var(--text-dim);">⏳ Validando…</span>';
  try {
    const res = await studioApi('/api/loyalty/validate', { method: 'POST', body: JSON.stringify({ code }) });
    const body = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = `<span style="color:#F87171;">✕ ${escapeHtml(body.error || 'Código no válido')}</span>`;
      return;
    }
    const d = body.data || {};
    resultEl.innerHTML = `<span style="color:#68D391;">✓ Código válido — ${escapeHtml(d.rewardTitle || 'canje')} (${escapeHtml(d.code || code)}) marcado como canjeado.</span>`;
    codeEl.value = '';
  } catch (e) {
    resultEl.innerHTML = '<span style="color:#F87171;">Error de conexión. Intentá de nuevo.</span>';
  }
}

function handleRedeemCodeEnter(event) {
  if (event && event.key === 'Enter') validateLoyaltyCode();
}

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

async function loadRecentOrders() {
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
    if (!orders.length) {
      list.innerHTML = '<div style="font-size:11px; color:var(--text-dim);">Sin pedidos todavía. Cuando un comensal pida desde el menú, aparece acá.</div>';
      return;
    }
    list.innerHTML = orders.map(o => {
      const status = o.status || 'pending';
      const label = ORDER_STATUS_LABELS[status] || status;
      const items = (o.items_snapshot || []).map(i => `${i.quantity}× ${i.name}`).join(', ');
      const when = o.created_at ? new Date(o.created_at).toLocaleString() : '';
      const chips = ORDER_ACTION_STATES.map(s => {
        const active = s === status;
        return `<button type="button" class="btn-nav" data-js-click="setOrderStatus|${escapeHtml(o.id)}|${s}" style="font-size:10px; padding:4px 8px; ${active ? 'border-color:#68D391; color:#68D391;' : ''}">${escapeHtml(ORDER_STATUS_LABELS[s])}</button>`;
      }).join(' ');
      return `<div style="background:var(--bg-base); border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
          <div style="font-size:12px; font-weight:700; color:#fff;">${escapeHtml(o.customer_name || 'Cliente')}${o.table_number ? ` · Mesa ${escapeHtml(String(o.table_number))}` : ''}</div>
          <div style="font-size:11px; color:#68D391; font-weight:700; white-space:nowrap;">${escapeHtml(label)}</div>
        </div>
        <div style="font-size:11px; color:var(--text-dim); margin:3px 0;">${escapeHtml(items)}</div>
        <div style="font-size:10px; color:var(--text-dim); margin-bottom:6px;">${escapeHtml(o.currency || '$')} ${Number(o.amount || 0).toFixed(2)} · ${escapeHtml(when)}</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">${chips}</div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div style="font-size:11px; color:#F87171;">Error de conexión.</div>';
  }
}

async function setOrderStatus(orderId, status) {
  if (!orderId || !status) return;
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

// Bind all functions to window for HTML inline event handlers
const globalExports = {
  initStudio, logout, openDeleteAccountModal, closeDeleteAccountModal, confirmAccountDeletion,
  renderStudioUI, updateLiveState, saveStudioChanges, triggerAutoSave, reloadPreviewIframe, syncLivePreviewIframe, setPreviewView,
  switchTab, showConfirmDialog, closeConfirmDialog, showSaveFeedback,
  handleLogoUpload, removeLogo, handleBannerUpload, handleBannerUrlInput, removeBanner, renderBannerPreviewUI, handleBannerImageError,
  openBillingModal, closeBillingModal, startCheckout,
  renderDeliveryZones, addDeliveryZone, deleteDeliveryZone,
  renderBranchesList, addBranch, deleteBranch, editBranch, closeBranchEdit, saveBranchEdit, addBranchOverrideRow, removeBranchOverrideRow, addBranchCustomDishRow, removeBranchCustomDishRow, resetBranchForm,
  loadAnalytics, updateKPIs, renderDailyChart, renderHeatmap, renderBranchMetrics, renderEventMetrics, renderTopDishes, exportAnalytics,
  generateQrCode, downloadQrPng, printTableStand, downloadAllTablesPDF,
  promptNewCategoryInModal, openCategoryManagerModal, closeCategoryManagerModal, moveCategory, addCategoryFromManager, renameCategory, deleteCategory,
  populateCatFilter, renderDishesList, editDish, openNewDishModal, closeDishEditModal, saveDishFromModal, handleDishPhotoUpload, deleteDish, clearDishPhoto, toggleDishScheduleControls, toggleDishesByIngredient,
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
  loadNotificationEvents, markNotificationEventRead, sendPromoPush,
  loadRecentOrders, setOrderStatus,
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
  setupPushNotifications();
});