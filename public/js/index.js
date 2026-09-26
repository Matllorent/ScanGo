function openAuthModal(mode = 'register') {
      const modal = document.getElementById('authModal');
      modal.classList.add('active');
      switchAuthTab(mode);
    }

    function closeAuthModal() {
      const modal = document.getElementById('authModal');
      modal.classList.remove('active');
      hideError();
    }

    function switchAuthTab(mode) {
      hideError();
      const tabReg = document.getElementById('tabRegisterBtn');
      const tabLog = document.getElementById('tabLoginBtn');
      const formReg = document.getElementById('registerForm');
      const formLog = document.getElementById('loginForm');

      if (mode === 'register') {
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

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, restaurantName, businessType, email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al crear la cuenta');

        // Apply chosen business type and intelligent feature defaults
        if (data.restaurant) {
          data.restaurant.businessType = businessType;
          data.restaurant.allowIceCreamWizard = false;
          data.restaurant.allowPerfumery = (businessType === 'perfumery');
          data.restaurant.allowLoyaltyPoints = false;
        }

        localStorage.setItem('menu_pizarron_token', data.token);
        localStorage.setItem('menu_pizarron_user', JSON.stringify(data.user));
        localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(data.restaurant));
        localStorage.setItem('scango_demo_restaurant', JSON.stringify(data.restaurant));

        window.location.href = '/studio.html';
      } catch (err) {
        showError(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Comenzar Prueba Gratis (7 Días) →';
      }
    }

    async function handleLogin(e) {
      e.preventDefault();
      hideError();
      const btn = document.getElementById('btnSubmitLogin');
      btn.disabled = true;
      btn.textContent = 'Verificando...';

      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Credenciales inválidas');

        localStorage.setItem('menu_pizarron_token', data.token);
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

      if (countSpan) countSpan.textContent = `🛒 ${simCart.length} ítems en el carrito`;
      if (totalSpan) totalSpan.textContent = `Pedir por WhatsApp ($${total.toLocaleString('es-UY')}) →`;
    }

    function simOrderWhatsApp() {
      if (!simCart.length) {
        alert('¡Hacé clic en el botón "+" de cualquiera de los platos para agregarlo al carrito!');
        return;
      }
      const total = simCart.reduce((sum, it) => sum + it.price, 0);
      alert(`🎉 ¡Excelente! En tu restaurante real, esto abre WhatsApp con el pedido ya listo:\n\n"Hola ScanGo Bistro, quiero pedir:\n${simCart.map(i => '▪ ' + i.name + ' - $' + i.price).join('\n')}\nTotal: $${total}"\n\n¡Creá tu cuenta gratis por 7 días para configurar tu propio menú!`);
      openAuthModal('register');
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
    }

    function closeForgotPasswordModal() {
      const modal = document.getElementById('forgotPasswordModal');
      if (modal) modal.classList.remove('active');
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

        // Promotional Banner
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

        // Pricing Cards
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

      const magneticRadius = 120; // Proximity in px to activate attraction
      let mouseX = 0, mouseY = 0;
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

    // FAQ Accordion Toggle
    function toggleFaq(btn) {
      const item = btn.parentElement;
      const wasActive = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('active'));
      if (!wasActive) {
        item.classList.add('active');
      }
    }

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

      // Check localStorage for offline / locally approved reviews
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

    window.addEventListener('DOMContentLoaded', () => {
      loadPublicTestimonials();
      loadPricingSettings();
      initMagneticWhatsApp();
      const token = localStorage.getItem('menu_pizarron_token');
      if (token) {
        const navActions = document.querySelector('.nav-actions');
        if (navActions) {
          navActions.innerHTML = '<a href="/studio.html" class="btn btn-gold btn-sm">Ir a Mi Studio 🚀</a>';
        }
      }
    });