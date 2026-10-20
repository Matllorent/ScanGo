let googleIdentityPromise = null;
let googleIdentityClientId = '';
let googleLocalOriginHintLogged = false;

// Rubros válidos del producto (fuente única en el frontend; el backend valida
// el mismo conjunto en api/middleware/validation.js).
const BUSINESS_TYPES = ['restaurant', 'heladeria', 'perfumery', 'events'];

// ── Accesibilidad de modales de la landing (WCAG 2.4.3 / 2.4.7) ─────────────
// Lleva el foco dentro del modal al abrirlo, lo devuelve al disparador al
// cerrarlo y permite cerrar con Escape. Sin dependencias.
let lastFocusedBeforeModal = null;
function focusModal(modalEl) {
  if (!modalEl) return;
  lastFocusedBeforeModal = document.activeElement;
  const target = modalEl.querySelector(
    'input:not([type="hidden"]), select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
  );
  if (target) setTimeout(() => target.focus(), 40);
}
function restoreModalFocus() {
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
    lastFocusedBeforeModal.focus();
  }
  lastFocusedBeforeModal = null;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const auth = document.getElementById('authModal');
  const forgot = document.getElementById('forgotPasswordModal');
  if (auth && auth.classList.contains('active')) {
    closeAuthModal();
  } else if (forgot && forgot.classList.contains('active')) {
    closeForgotPasswordModal();
  }
});

function openAuthModal(mode = 'register') {
  const modal = document.getElementById('authModal');
  modal.classList.add('active');
  switchAuthTab(mode);
  focusModal(modal);
  // El registro hereda el rubro de la pestaña de precios que miraba el
  // visitante (menos fricción y mejor conversión por rubro); las landings
  // /soluciones pueden forzarlo con ?rubro=<tipo>.
  if (mode === 'register') {
    const bizSelect = document.getElementById('regBusinessType');
    const urlRubro = new URLSearchParams(window.location.search).get('rubro');
    const chosen = BUSINESS_TYPES.includes(urlRubro) ? urlRubro : currentPricingRubro;
    if (bizSelect && BUSINESS_TYPES.includes(chosen)) {
      bizSelect.value = chosen;
    }
  }
}

// ── Precios por rubro: mismos planes, mensaje adaptado ────────────────────
// La suscripción es única (planes.json); cada rubro solo cambia nombres,
// descripciones y bullets. Eventos muestra la tarjeta de pago único.
let currentPricingRubro = 'restaurant';

const PRICING_COPY = {
  restaurant: {
    hint: 'Suscripción mensual o anual para tu restaurante, sin comisiones por venta.',
    monthly: {
      name: 'Plan Mensual',
      desc: 'Flexibilidad mes a mes para negocios que están comenzando.',
      features: [
        '<strong>Menú QR ilimitado</strong>',
        '<strong>Pedidos por WhatsApp (0% comisión)</strong>',
        'Soporte para delivery por zonas',
        'Cartelería de mesa imprimible (PDF)',
        'Acceso para 1 local gastronómico',
        'El Mozo Virtual + pedidos en vivo + pago online',
        'Fidelización con puntos y analíticas del local',
        'Actualizaciones en tiempo real'
      ]
    },
    annual: {
      name: 'Plan Anual',
      desc: 'Tranquilidad para todo el año al costo más competitivo del mercado.',
      features: [
        '<strong>Todo lo del Plan Mensual</strong>',
        '<strong>Logo en el centro del código QR</strong>',
        '<strong>Catálogo internacional de 85+ platos sugeridos</strong>',
        '<strong>Módulo de Reservas de Mesa por WhatsApp</strong>',
        'Período de gracia garantizado de 7 días',
        'Soporte prioritario por WhatsApp'
      ]
    }
  },
  heladeria: {
    hint: 'Suscripción mensual o anual para tu heladería, sin comisiones por venta.',
    monthly: {
      name: 'Plan Mensual Heladería',
      desc: 'Flexibilidad mes a mes para heladerías que venden todo el año.',
      features: [
        '<strong>Menú QR ilimitado</strong>',
        '<strong>Pedidos por WhatsApp (0% comisión)</strong>',
        '<strong>Armador de helado a medida</strong>',
        'Catálogo de sabores en 1 clic',
        'Cartelería de mesa imprimible (PDF)',
        'El Mozo Virtual + pedidos en vivo + pago online',
        'Fidelización con puntos y analíticas del local',
        'Actualizaciones en tiempo real'
      ]
    },
    annual: {
      name: 'Plan Anual Heladería',
      desc: 'Tranquilidad para todo el año al costo más competitivo del mercado.',
      features: [
        '<strong>Todo lo del Plan Mensual</strong>',
        '<strong>Logo en el centro del código QR</strong>',
        '<strong>6 estéticas de heladería (fiesta, menta, tropical…)</strong>',
        '<strong>Promos de temporada por WhatsApp</strong>',
        'Período de gracia garantizado de 7 días',
        'Soporte prioritario por WhatsApp'
      ]
    }
  },
  perfumery: {
    hint: 'Suscripción mensual o anual para tu perfumería, sin comisiones por venta.',
    monthly: {
      name: 'Plan Mensual Perfumería',
      desc: 'Flexibilidad mes a mes para tu local de fragancias y cosmética.',
      features: [
        '<strong>Catálogo QR ilimitado</strong>',
        '<strong>Pedidos por WhatsApp (0% comisión)</strong>',
        '<strong>Vista de pirámide olfativa</strong>',
        'Colecciones y lanzamientos',
        'Cartelería con QR imprimible (PDF)',
        'Pedidos en vivo + analíticas del local',
        'Actualizaciones en tiempo real'
      ]
    },
    annual: {
      name: 'Plan Anual Perfumería',
      desc: 'Tranquilidad para todo el año al costo más competitivo del mercado.',
      features: [
        '<strong>Todo lo del Plan Mensual</strong>',
        '<strong>Logo en el centro del código QR</strong>',
        '<strong>Selector de frasco y presentaciones</strong>',
        '<strong>Módulo de reservas y consultas por WhatsApp</strong>',
        'Período de gracia garantizado de 7 días',
        'Soporte prioritario por WhatsApp'
      ]
    }
  },
  events: {
    hint: 'Un solo pago por fiesta: sin suscripción ni renovaciones.'
  }
};

function renderPricingFeatures(listId, features) {
  const ul = document.getElementById(listId);
  if (!ul) return;
  ul.innerHTML = features.map(f => `<li><span class="check">✓</span> ${f}</li>`).join('');
}

function switchPricingRubro(rubro) {
  if (!BUSINESS_TYPES.includes(rubro)) return;
  currentPricingRubro = rubro;
  document.querySelectorAll('[data-pricing-rubro]').forEach(btn => {
    const active = btn.getAttribute('data-pricing-rubro') === rubro;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const hint = document.getElementById('pricingRubroHint');
  const copy = PRICING_COPY[rubro];
  if (hint && copy) hint.textContent = copy.hint;
  const subGrid = document.getElementById('pricingSubscriptionGrid');
  const eventGrid = document.getElementById('pricingEventGrid');
  const isEvents = rubro === 'events';
  if (subGrid) subGrid.style.display = isEvents ? 'none' : '';
  if (eventGrid) eventGrid.style.display = isEvents ? 'flex' : 'none';
  if (!isEvents && copy) {
    const monthlyName = document.getElementById('planMonthlyName');
    const monthlyDesc = document.getElementById('planMonthlyDesc');
    const annualName = document.getElementById('planAnnualName');
    const annualDesc = document.getElementById('planAnnualDesc');
    if (monthlyName) monthlyName.textContent = copy.monthly.name;
    if (monthlyDesc) monthlyDesc.textContent = copy.monthly.desc;
    if (annualName) annualName.textContent = copy.annual.name;
    if (annualDesc) annualDesc.textContent = copy.annual.desc;
    renderPricingFeatures('planMonthlyFeatures', copy.monthly.features);
    renderPricingFeatures('planAnnualFeatures', copy.annual.features);
  }
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  modal.classList.remove('active');
  hideError();
  restoreModalFocus();
}

function switchAuthTab(mode) {
  hideError();
  const tabReg = document.getElementById('tabRegisterBtn');
  const tabLog = document.getElementById('tabLoginBtn');
  const formReg = document.getElementById('registerForm');
  const formLog = document.getElementById('loginForm');

  const isRegister = mode === 'register';
  if (isRegister) {
    tabReg.classList.add('active');
    tabLog.classList.remove('active');
    formReg.style.display = 'block';
    formLog.style.display = 'none';
  } else {
    tabLog.classList.add('active');
    tabReg.classList.remove('active');
    formLog.style.display = 'block';
    formReg.style.display = 'none';
  }
  // ARIA del patrón de pestañas (WCAG 4.1.2): anunciar cuál está seleccionada.
  if (tabReg && tabLog) {
    tabReg.setAttribute('aria-selected', String(isRegister));
    tabLog.setAttribute('aria-selected', String(!isRegister));
  }
}

function showError(msg) {
  const err = document.getElementById('authError');
  err.textContent = msg;
  err.style.display = 'block';
}

function hideError() {
  const err = document.getElementById('authError');
  err.style.display = 'none';
  err.textContent = '';
}

function setGoogleButtonsDisabled(disabled) {
  document.querySelectorAll('.btn-google').forEach(button => {
    button.disabled = disabled;
  });
}

function getGooglePromptHelpMessage() {
  const origin = window.location?.origin;
  const originHelp = origin
    ? ` Si estás en desarrollo, verifica que ${origin} esté en "Orígenes de JavaScript autorizados" del cliente OAuth en Google Cloud.`
    : '';
  return `Google no pudo completar la selección de cuenta. Revisa los permisos de inicio con terceros del navegador e intenta registrarte con correo si el problema continúa.${originHelp}`;
}

function warnAboutLocalGoogleOrigin() {
  const { hostname, origin } = window.location || {};
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname) || googleLocalOriginHintLogged) return;
  googleLocalOriginHintLogged = true;
  console.info(`[Google Identity Services] Si aparece "unregistered_origin", agrega ${origin} y http://localhost en Authorized JavaScript origins para este OAuth client.`);
}

function handleGooglePromptFailure(error) {
  if (error?.name === 'AbortError') {
    console.info('[Google Identity Services] El navegador canceló el prompt de FedCM; el formulario sigue disponible.');
  }
  showError(getGooglePromptHelpMessage());
}

async function ensureGoogleIdentityReady() {
  if (googleIdentityPromise) return googleIdentityPromise;
  // Sin aceptación de cookies de terceros no se carga Google (ver /cookies).
  if (window.CookieConsent && !window.CookieConsent.hasThirdPartyConsent()) {
    window.CookieConsent.show();
    throw new Error('Para entrar con Google aceptá primero las cookies de terceros en el aviso inferior.');
  }
  googleIdentityPromise = (async () => {
    const configResponse = await fetch('/api/auth/google/config');
    const config = await configResponse.json();
    if (!configResponse.ok || !config.clientId) {
      throw new Error('El acceso con Google todavía no está configurado. Podés registrarte con tu correo.');
    }
    googleIdentityClientId = config.clientId;
    await window.loadGoogleIdentityServices();
    google.accounts.id.initialize({
      client_id: googleIdentityClientId,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    });
  })().catch(error => {
    googleIdentityPromise = null;
    throw error;
  });
  return googleIdentityPromise;
}

// Google credential callback handler
async function handleGoogleCredential(credentialResponse) {
  const credential = typeof credentialResponse === 'string'
    ? credentialResponse
    : credentialResponse?.credential;
  if (!credential) {
    showError('Google no devolvió una credencial válida. Intentá de nuevo.');
    return;
  }
  hideError();
  setGoogleButtonsDisabled(true);
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential,
        restaurantName: document.getElementById('regRestaurant')?.value.trim() || '',
        businessType: document.getElementById('regBusinessType')?.value || 'restaurant'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo validar tu cuenta de Google.');
    
    // Sesión por cookie httpOnly (la fija el backend). Sin token en JS.
    // En app nativa se usa credencial de dispositivo (ver loginAppDevice).
    localStorage.setItem('menu_pizarron_user', JSON.stringify(data.user));
    localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(data.restaurant));
    localStorage.setItem('scango_demo_restaurant', JSON.stringify(data.restaurant));
    window.location.href = '/studio.html';
  } catch (error) {
    showError(error.message || 'No se pudo iniciar sesión con Google.');
  } finally {
    setGoogleButtonsDisabled(false);
  }
}

async function startGoogleSignup() {
  hideError();
  warnAboutLocalGoogleOrigin();
  try {
    await ensureGoogleIdentityReady();
    const promptResult = google.accounts.id.prompt(notification => {
      try {
        if (notification?.isSkippedMoment?.()) handleGooglePromptFailure();
      } catch (error) {
        handleGooglePromptFailure(error);
      }
    });
    if (promptResult && typeof promptResult.then === 'function') {
      await promptResult.catch(handleGooglePromptFailure);
    }
  } catch (error) {
    handleGooglePromptFailure(error);
  }
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
    btn.setAttribute('aria-label', 'Ocultar contraseña');
    btn.title = 'Ocultar contraseña';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
    btn.setAttribute('aria-label', 'Mostrar contraseña');
    btn.title = 'Mostrar contraseña';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  hideError();
  const btn = document.getElementById('btnSubmitRegister');
  btn.disabled = true;
  btn.textContent = 'Creando cuenta...';

  const name = document.getElementById('regName').value.trim();
  const restaurantName = document.getElementById('regRestaurant').value.trim();
  const businessType = document.getElementById('regBusinessType')?.value || 'restaurant';
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const ageConfirmed = document.getElementById('regAgeConfirm')?.checked === true;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, restaurantName, businessType, email, password, ageConfirmed })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear la cuenta');

    if (data.restaurant) {
      data.restaurant.businessType = businessType;
      data.restaurant.allowIceCreamWizard = (businessType === 'heladeria');
      data.restaurant.allowPerfumery = (businessType === 'perfumery');
      data.restaurant.allowLoyaltyPoints = false;
      // Heladería nace vestida de heladería (no con el verde bistro).
      if (businessType === 'heladeria') {
        if (!data.restaurant.theme || data.restaurant.theme === 'emerald') data.restaurant.theme = 'helado-fiesta';
        if (!data.restaurant.iceCreamButtonStyle) data.restaurant.iceCreamButtonStyle = 'fiesta';
        if (!data.restaurant.iceCreamBuilderLabel) data.restaurant.iceCreamBuilderLabel = 'Armá tu helado a medida';
      }
    }

    localStorage.setItem('menu_pizarron_user', JSON.stringify(data.user));
    localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(data.restaurant));
    localStorage.setItem('scango_demo_restaurant', JSON.stringify(data.restaurant));

    // Con Supabase activo la casilla se confirma desde el correo: tirar al usuario
    // al Studio sin confirmar sólo le hace chocar con un 403 al querer guardar.
    if (data.requiresEmailVerification) {
      showEmailVerificationScreen(email);
      return;
    }

    window.location.href = '/studio.html';
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Comenzar Prueba Gratis (7 Días) →';
  }
}

/**
 * Pantalla "revisá tu correo" mostrada tras registrarse con casilla sin confirmar.
 * La cuenta y la prueba de 7 días ya existen: sólo falta el click del enlace.
 */
function showEmailVerificationScreen(email) {
  const safeEmail = escapeHtml(email || '');
  const overlay = document.createElement('div');
  overlay.id = 'emailVerificationScreen';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:9999; background:rgba(8,12,11,0.97); display:flex; align-items:center; justify-content:center; padding:24px; text-align:center; backdrop-filter:blur(8px);';
  overlay.innerHTML = `
    <div style="max-width:440px;">
      <div style="font-size:3rem; margin-bottom:12px;">✉️</div>
      <h2 style="margin-bottom:10px;">Revisá tu correo</h2>
      <p style="opacity:.85; font-size:.95rem; line-height:1.6;">
        Te enviamos un enlace de confirmación a <strong>${safeEmail}</strong>.
        Abrilo para confirmar tu casilla y empezar a editar tu menú.
      </p>
      <p style="opacity:.6; font-size:.8rem; margin-top:12px; line-height:1.5;">
        Tu cuenta y tu prueba de 7 días ya están creadas. Si el correo no llega,
        revisá la carpeta de spam o promociones.
      </p>
      <button id="btnGoToStudioAfterVerify" style="margin-top:22px; padding:12px 26px; border:none; border-radius:8px; font-weight:700; cursor:pointer; background:#D4A853; color:#101614; font-size:.95rem;">
        Ya confirmé mi correo →
      </button>
      <button id="btnBackToLanding" style="display:block; margin:14px auto 0; background:none; border:none; color:rgba(255,255,255,.6); cursor:pointer; font-size:.82rem; text-decoration:underline;">
        Volver a la página
      </button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#btnGoToStudioAfterVerify').addEventListener('click', () => {
    window.location.href = '/studio.html';
  });
  overlay.querySelector('#btnBackToLanding').addEventListener('click', () => {
    overlay.remove();
  });
}

async function handleLogin(e) {
  e.preventDefault();
  hideError();
  const btn = document.getElementById('btnSubmitLogin');
  btn.disabled = true;
  btn.textContent = 'Verificando...';

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  // App nativa: las cookies no viajan (otro origen) → credencial de
  // dispositivo opaca y revocable. Si te registraste con Google, primero
  // creá una clave con "¿Olvidaste tu contraseña?".
  if (window.AuthClient && window.AuthClient.isNativeApp()) {
    try {
      const devRes = await fetch('/api/auth/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, deviceName: 'app-android' })
      });
      const devData = await devRes.json();
      if (!devRes.ok) throw new Error(devData.error || 'Credenciales inválidas');
      window.AuthClient.setDeviceToken(devData.data.deviceToken);
      window.location.href = '/studio.html';
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ingresar al Studio →';
    }
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Credenciales inválidas');

    // Sesión por cookie httpOnly (la fija el backend). Sin token en JS.
    localStorage.setItem('menu_pizarron_user', JSON.stringify(data.user));
    localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(data.restaurant));

    window.location.href = '/studio.html';
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar al Studio →';
  }
}

// Interactive Demo Simulator Logic
let simCart = [];
function simAddDish(name, price) {
  simCart.push({ name, price });
  updateSimUI();
}

function simResetCart() {
  simCart = [];
  updateSimUI();
}

function updateSimUI() {
  const countSpan = document.getElementById('simCartCount');
  const totalSpan = document.getElementById('simCartTotal');
  const total = simCart.reduce((sum, it) => sum + it.price, 0);

  if (countSpan) countSpan.textContent = simCart.length === 0
    ? '🛒 Carrito vacío'
    : `🛒 ${simCart.length} ítems en el carrito`;
  if (totalSpan) totalSpan.textContent = simCart.length === 0
    ? 'Tocá + para agregar →'
    : `Pedir por WhatsApp ($${total.toLocaleString('es-UY')}) →`;
}

let simToastTimer = null;

function triggerCartAttention() {
  const cartBar = document.getElementById('simCartBar');
  if (!cartBar) return;

  cartBar.classList.remove('attention');
  void cartBar.offsetWidth;
  cartBar.classList.add('attention');

  clearTimeout(cartBar._attentionTimer);
  cartBar._attentionTimer = setTimeout(() => cartBar.classList.remove('attention'), 1400);
}

function showDemoToast(message, title = '¡Excelente!') {
  const toast = document.getElementById('demoToast');
  if (!toast) return;

  const titleEl = toast.querySelector('.demo-toast-title');
  const bodyEl = toast.querySelector('.demo-toast-body');
  const closeBtn = toast.querySelector('.demo-toast-close');
  const actionBtn = toast.querySelector('.demo-toast-action');

  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.textContent = message;

  if (closeBtn) closeBtn.onclick = () => toast.classList.remove('active');
  if (actionBtn) actionBtn.onclick = () => toast.classList.remove('active');

  toast.classList.add('active');
  triggerCartAttention();
  clearTimeout(simToastTimer);
  simToastTimer = setTimeout(() => toast.classList.remove('active'), 5200);
}

function simOrderWhatsApp() {
  if (!simCart.length) {
    showDemoToast('¡Hacé clic en el botón "+" de cualquiera de los platos para agregarlo al carrito!', 'Tu carrito está vacío');
    return;
  }

  const total = simCart.reduce((sum, it) => sum + it.price, 0);
  const message = `"Hola ScanGo Bistro, quiero pedir:\n${simCart.map(i => '▪ ' + i.name + ' - $' + i.price).join('\n')}\nTotal: $${total}"\n\n¡Gracias! Podés probar la demo sin interrupciones y luego crear tu menú desde el panel de administración.`;
  showDemoToast(message, '¡Excelente!');
}

// Forgot Password Modal Logic
function openForgotPasswordModal() {
  closeAuthModal();
  const modal = document.getElementById('forgotPasswordModal');
  const alertBox = document.getElementById('forgotAlert');
  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.textContent = '';
  }
  if (modal) modal.classList.add('active');
  focusModal(modal);
}

function closeForgotPasswordModal() {
  const modal = document.getElementById('forgotPasswordModal');
  if (modal) modal.classList.remove('active');
  restoreModalFocus();
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const emailInput = document.getElementById('forgotEmail');
  const btn = document.getElementById('btnSubmitForgot');
  const alertBox = document.getElementById('forgotAlert');
  const email = emailInput?.value.trim();

  if (!email) return;

  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (alertBox) {
      alertBox.style.display = 'block';
      alertBox.style.background = 'rgba(74, 222, 128, 0.15)';
      alertBox.style.borderColor = '#22c55e';
      alertBox.style.color = '#4ade80';
      alertBox.textContent = data.message || 'Si tu correo está registrado, recibirás un enlace de recuperación en breve.';
    }
    if (emailInput) emailInput.value = '';
  } catch (err) {
    if (alertBox) {
      alertBox.style.display = 'block';
      alertBox.style.background = 'rgba(239, 68, 68, 0.15)';
      alertBox.style.borderColor = '#ef4444';
      alertBox.style.color = '#f87171';
      alertBox.textContent = 'Ocurrió un error al procesar tu solicitud. Por favor intenta de nuevo o comunícate vía WhatsApp.';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Enlace de Recuperación';
  }
}

// Dynamic Pricing & Promotional Banner Loader
async function loadPricingSettings() {
  try {
    const res = await fetch('/api/settings/pricing');
    if (!res.ok) return;
    const data = await res.json();
    const s = data.settings;
    if (!s) return;

    const banner = document.getElementById('promoBanner');
    const badge = document.getElementById('promoBadge');
    const text = document.getElementById('promoText');

    if (banner) {
      if (s.promoBannerEnabled) {
        banner.style.display = 'flex';
        if (badge) badge.textContent = `${s.promoDiscountPercent || 50}% OFF`;
        if (text && s.promoBannerText) text.textContent = s.promoBannerText;
      } else {
        banner.style.display = 'none';
      }
    }

    const monthlyEl = document.getElementById('planMonthlyPrice');
    if (monthlyEl && s.monthlyPrice !== undefined) {
      monthlyEl.innerHTML = `$${s.monthlyPrice} <span>USD / mes</span>`;
    }

    const annualEl = document.getElementById('planAnnualPrice');
    const ribbonEl = document.getElementById('planAnnualRibbon');
    const noteEl = document.getElementById('planAnnualNote');

    if (annualEl && s.annualPrice !== undefined) {
      annualEl.innerHTML = `$${s.annualPrice} <span>USD / año</span>`;
      const equivMonth = (s.annualPrice / 12).toFixed(2);
      if (noteEl) noteEl.textContent = `Equivale a solo $${equivMonth} USD por mes`;
    }

    if (ribbonEl && s.annualDiscountPercent !== undefined) {
      ribbonEl.textContent = `MÁS ELEGIDO • AHORRA ${s.annualDiscountPercent}%`;
    }
  } catch (err) {
    console.warn('No se pudo cargar la configuración dinámica de precios:', err.message);
  }
}

// Magnetic Proximity Attraction Effect for Floating WhatsApp Button
function initMagneticWhatsApp() {
  const btn = document.getElementById('waFloatBtn');
  if (!btn) return;

  const magneticRadius = 120;
  let isNear = false;

  window.addEventListener('mousemove', (e) => {
    const rect = btn.getBoundingClientRect();
    const btnCenterX = rect.left + rect.width / 2;
    const btnCenterY = rect.top + rect.height / 2;

    const dist = Math.hypot(e.clientX - btnCenterX, e.clientY - btnCenterY);

    if (dist < magneticRadius) {
      isNear = true;
      const pullStrength = 0.28;
      const dx = (e.clientX - btnCenterX) * pullStrength;
      const dy = (e.clientY - btnCenterY) * pullStrength;
      btn.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
    } else if (isNear) {
      isNear = false;
      btn.style.transform = 'translate(0px, 0px) scale(1)';
    }
  });

  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'translate(0px, 0px) scale(1)';
    isNear = false;
  });
}

// FAQ Accordion Toggle (patrón divulgación accesible: button + aria-expanded)
function toggleFaq(btn) {
  const item = btn.parentElement;
  const wasActive = item.classList.contains('active');
  document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.faq-question[aria-expanded]').forEach(q => q.setAttribute('aria-expanded', 'false'));
  if (!wasActive) {
    item.classList.add('active');
    if (btn.setAttribute) btn.setAttribute('aria-expanded', 'true');
  }
}

/* ============================================================
   VIDA DE LANDING · Motion elegante (Dark Artisanal Chic)
   ------------------------------------------------------------
   Seguridad: todo el motion va gateado detrás de `.motion-ready`, que
   SOLO se agrega si el sistema NO pide prefers-reduced-motion. Si el
   usuario pide menos movimiento (o el JS falla), las secciones quedan
   100% visibles — nunca hay contenido oculto. Cero `on*=`.
   ============================================================ */

// Devuelve true si el usuario NO pidió menos movimiento.
function motionAllowed() {
  return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Marca los elementos que se animan al entrar en viewport (reveal).
function tagRevealTargets() {
  const sel = [
    '.section-header', '.feature-card', '.step-card', '.value-card',
    '.compare-row', '.demo-card', '.plan-card', '.testimonial-card', '.faq-item'
  ].join(',');
  return Array.from(document.querySelectorAll(sel));
}

// Revela con stagger: cada elemento entra con un pequeño delay en cascada.
function initScrollReveal() {
  if (!motionAllowed() || !('IntersectionObserver' in window)) return;
  const targets = tagRevealTargets();
  if (!targets.length) return;

  // Agrupa por contenedor para dar un stagger natural por fila/sección.
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const parent = el.parentElement;
      const siblings = parent ? Array.from(parent.children).filter(c => targets.includes(c)) : [el];
      const idx = Math.max(0, siblings.indexOf(el));
      el.style.transitionDelay = (Math.min(idx, 6) * 70) + 'ms';
      el.classList.add('reveal-in');
      obs.unobserve(el);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });

  targets.forEach(t => io.observe(t));
}

// Congela el header con vidrio esmerilado al hacer scroll.
function initStickyHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  let ticking = false;
  const update = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 24);
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
}

// Contador animado para una cifra con destino (ej: 20 → 30 en la comparativa,
// 99.9 en uptime). Lee data-count-to y conserva el sufijo data-count-suffix.
function animateCount(el) {
  const target = parseFloat(el.dataset.countTo);
  if (Number.isNaN(target)) return;
  const suffix = el.dataset.countSuffix || '';
  const prefix = el.dataset.countPrefix || '';
  const decimals = (el.dataset.countTo.split('.')[1] || '').length;
  const duration = 1100;
  const start = performance.now();

  function frame(now) {
    const p = Math.min(1, (now - start) / duration);
    // ease-out cúbico: arranca rápido y frena suave
    const eased = 1 - Math.pow(1 - p, 3);
    const val = (target * eased).toFixed(decimals);
    el.textContent = prefix + val + suffix;
    if (p < 1) {
      window.requestAnimationFrame(frame);
    } else {
      el.textContent = prefix + target.toFixed(decimals) + suffix;
      el.classList.add('count-done');
      setTimeout(() => el.classList.remove('count-done'), 520);
    }
  }
  window.requestAnimationFrame(frame);
}

// Observa las cifras y las anima cuando entran en pantalla.
function initCounters() {
  if (!motionAllowed()) return;
  const counters = Array.from(document.querySelectorAll('[data-count-to]'));
  if (!counters.length) return;

  // Prepara el texto en 0 para que no salte el layout (se pinta al entrar).
  counters.forEach((el) => {
    el.classList.add('stat-counted');
    const decimals = (el.dataset.countTo.split('.')[1] || '').length;
    el.textContent = (el.dataset.countPrefix || '') + (0).toFixed(decimals) + (el.dataset.countSuffix || '');
  });

  if (!('IntersectionObserver' in window)) {
    counters.forEach(animateCount);
    return;
  }
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animateCount(entry.target);
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.6 });
  counters.forEach(c => io.observe(c));
}

// Punto de entrada del motion de la landing.
function initLandingMotion() {
  if (!motionAllowed()) return;   // sin motion: todo queda visible, sin tocar nada
  document.documentElement.classList.add('motion-ready');
  initStickyHeader();
  initScrollReveal();
  initCounters();
}

// Menú móvil: el panel con los links solo existe en ≤900px (ver index.css).
// Sin on*= (CSP script-src-attr 'none'): se invoca por data-js-click.
function toggleMobileNav(btn) {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const open = header.classList.toggle('nav-open');
  const burger = (btn && btn.setAttribute) ? btn : document.querySelector('.nav-burger');
  if (burger && burger.setAttribute) {
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Cerrar menú de navegación' : 'Abrir menú de navegación');
  }
}

function closeMobileNav(restoreFocus) {
  const header = document.querySelector('.site-header.nav-open');
  if (!header) return;
  header.classList.remove('nav-open');
  const burger = document.querySelector('.nav-burger');
  if (burger) {
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Abrir menú de navegación');
    if (restoreFocus && burger.focus) burger.focus();
  }
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeMobileNav(true);
});
document.addEventListener('click', function (e) {
  const link = e.target && e.target.closest ? e.target.closest('.site-header.nav-open .nav-link') : null;
  if (link) closeMobileNav(false);
});

// El cartelito de WhatsApp se retira solo a los 8s (vuelve al hover/foco).
// Con reduced-motion se queda visible: menos movimiento, no más.
try {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    setTimeout(function () {
      const wa = document.getElementById('waFloatContainer');
      if (wa) wa.classList.add('wa-rested');
    }, 8000);
  }
} catch (e) {}

// Helper to sanitize HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Dynamic Testimonials Loader (Real Approved Reviews)
async function loadPublicTestimonials() {
  const container = document.getElementById('testimonialsGrid');
  if (!container) return;

  let approvedReviews = [];
  try {
    const res = await fetch('/api/reviews/approved');
    if (res.ok) {
      const data = await res.json();
      approvedReviews = data.reviews || [];
    }
  } catch (err) {
    console.warn('Usando almacenamiento local para testimonios:', err.message);
  }

  try {
    const localApproved = JSON.parse(localStorage.getItem('scango_approved_reviews') || '[]');
    const map = new Map();
    approvedReviews.forEach(r => map.set(r.id, r));
    localApproved.forEach(r => map.set(r.id, r));
    approvedReviews = Array.from(map.values()).filter(r => r.status === 'approved' || !r.status);
  } catch (e) {}

  if (!approvedReviews.length) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 24px; background: var(--bg-surface); border: 1px dashed var(--border-subtle); border-radius: 16px;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">🌟</div>
        <h3 style="font-size: 1.25rem; font-weight: 700; color: #fff; margin-bottom: 8px;">Opiniones Verificadas de Clientes</h3>
        <p style="color: var(--text-muted); max-width: 520px; margin: 0 auto 20px; font-size: 0.92rem; line-height: 1.6;">
          Las opiniones de dueños y encargados de restaurantes se publican aquí tras completar su primer mes de servicio y ser moderadas.
        </p>
        <a href="#demo-interactiva" class="btn btn-outline" style="border-color: var(--accent-gold); color: var(--accent-gold); font-size: 0.85rem;">
          Probar Demo Interactiva
        </a>
      </div>
    `;
    return;
  }

  let html = '';
  approvedReviews.forEach(rev => {
    const stars = '⭐'.repeat(Math.max(1, Math.min(5, rev.rating || 5)));
    let avatarHtml = '';
    if (rev.photoUrl) {
      avatarHtml = `<img src="${rev.photoUrl}" alt="${escapeHtml(rev.authorRole || rev.restaurantName)}" class="test-avatar-img">`;
    } else {
      avatarHtml = `<span>🍽️</span>`;
    }

    html += `
      <div class="testimonial-card">
        <div>
          <div class="test-stars">${stars}</div>
          <p class="test-quote">"${escapeHtml(rev.comment)}"</p>
        </div>
        <div class="test-author">
          <div class="test-avatar">
            ${avatarHtml}
          </div>
          <div>
            <div class="test-author-name">${escapeHtml(rev.restaurantName || 'Restaurante Verificado')}</div>
            <div class="test-author-biz">${escapeHtml(rev.authorRole || 'Responsable')} • <span style="color:var(--accent-gold);">✓ Verificado</span></div>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

window.addEventListener('DOMContentLoaded', async () => {
  loadPublicTestimonials();
  loadPricingSettings();
  initMagneticWhatsApp();
  initLandingMotion(); // vida de la landing (reveal + contadores + header), respeta reduced-motion
  updateSimUI(); // pinta el estado vacío honesto (sin $0) desde la primera carga

  // Landings /soluciones: el CTA enlaza con ?registro=1 para llevar directo al
  // alta (sin que el visitante tenga que buscar el botón).
  const wantsRegister = new URLSearchParams(window.location.search).get('registro') === '1';

  // Si hay sesión (cookie httpOnly), mostrar acceso directo al Studio.
  // Sin token en JS: se pregunta al backend en vez de leer localStorage.
  try {
    const meRes = await fetch('/api/auth/me');
    if (meRes.ok) {
      if (wantsRegister) {
        window.location.href = '/studio.html';
        return;
      }
      const navActions = document.querySelector('.nav-actions');
      if (navActions) {
        navActions.innerHTML = '<a href="/studio.html" class="btn btn-gold btn-sm">Ir a Mi Studio 🚀</a>';
      }
    } else if (wantsRegister) {
      openAuthModal('register');
    }
  } catch (e) {
    // Sin sesión: si pedían registro abrimos el modal; si no, queda el CTA.
    if (wantsRegister) openAuthModal('register');
  }
});