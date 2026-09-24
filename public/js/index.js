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
          body: JSON.stringify({ name, restaurantName, email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al crear la cuenta');

        // Apply chosen business type and intelligent feature defaults
        if (data.restaurant) {
          data.restaurant.businessType = businessType;
          data.restaurant.allowIceCreamWizard = (businessType === 'heladeria');
          data.restaurant.allowPerfumery = (businessType === 'perfumeria');
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

      countSpan.textContent = `🛒 ${simCart.length} ítems en comanda`;
      totalSpan.textContent = `Pedir por WhatsApp ($${total.toLocaleString('es-UY')}) →`;
    }

    function simOrderWhatsApp() {
      if (!simCart.length) {
        alert('¡Hacé clic en el botón "+" de cualquiera de los platos para agregarlo a la comanda!');
        return;
      }
      const total = simCart.reduce((sum, it) => sum + it.price, 0);
      alert(`🎉 ¡Excelente! En tu restaurante real, esto abre WhatsApp con el mensaje ya escrito:\n\n"Hola ScanGo Bistro, quiero pedir:\n${simCart.map(i => '▪ ' + i.name + ' - $' + i.price).join('\n')}\nTotal: $${total}"\n\n¡Creá tu cuenta gratis por 7 días para configurar tu propio menú!`);
      openAuthModal('register');
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
      const token = localStorage.getItem('menu_pizarron_token');
      if (token) {
        const navActions = document.querySelector('.nav-actions');
        if (navActions) {
          navActions.innerHTML = '<a href="/studio.html" class="btn btn-gold btn-sm">Ir a Mi Studio 🚀</a>';
        }
      }
    });