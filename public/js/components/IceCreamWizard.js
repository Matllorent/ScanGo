/**
 * IceCreamWizard.js
 * Asistente interactivo paso a paso para pedidos de heladería artesanal en ScanGo.
 * 
 * Paso 1: Selección de contenedor/tamaño (Pinta, 1/4kg, 1/2kg, 1kg, Cucuruchos, Barquillos)
 * Paso 2: Elección de sabores con límite dinámico y contador en tiempo real
 * Paso 3: Agregados, toppings y salsas artesanales
 * 
 * Se integra al carrito del menú público con desglose completo.
 */

import { ICE_CREAM_CONTAINERS, ICE_CREAM_PRESETS, ICE_CREAM_TOPPINGS } from './IceCreamPresets.js';

export class IceCreamWizard {
  constructor(options = {}) {
    this.currency = options.currency || '$';
    this.onAddToCart = options.onAddToCart || (() => {});
    this.customFlavors = options.customFlavors || null; // Permite pasar sabores cargados por el restaurante
    
    // Estado del Wizard
    this.currentStep = 1;
    this.selectedContainer = ICE_CREAM_CONTAINERS[0]; // Por defecto 1kg
    this.selectedFlavors = {}; // { flavorId: qty }
    this.selectedToppings = []; // [toppingId]
    this.activeCategory = 'ALL';
    
    this.initDOM();
  }

  getFlavorsList() {
    if (this.customFlavors && this.customFlavors.length > 0) {
      return this.customFlavors;
    }
    return ICE_CREAM_PRESETS;
  }

  getTotalSelectedFlavorsCount() {
    return Object.values(this.selectedFlavors).reduce((sum, q) => sum + q, 0);
  }

  calculateTotal() {
    const basePrice = this.selectedContainer ? this.selectedContainer.price : 0;
    const toppingsTotal = this.selectedToppings.reduce((sum, topId) => {
      const top = ICE_CREAM_TOPPINGS.find(t => t.id === topId);
      return sum + (top ? top.price : 0);
    }, 0);
    return basePrice + toppingsTotal;
  }

  initDOM() {
    // Verificar si ya existe el modal en el DOM
    let existingModal = document.getElementById('iceCreamWizardModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'iceCreamWizardModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box ice-cream-wizard-box" style="max-width: 620px; max-height: 90vh; overflow-y: auto; padding: 22px;">
        <button class="modal-close" id="closeIceCreamWizardBtn">✕</button>
        
        <!-- Header del Wizard -->
        <div style="text-align: center; margin-bottom: 18px; border-bottom: 1px solid var(--border-chalk); padding-bottom: 12px;">
          <div style="font-size: 2.2rem; margin-bottom: 4px;">🍧</div>
          <h2 style="font-family: var(--font-heading); font-size: 1.45rem; color: #fff; margin-bottom: 4px;">
            Armá tu Helado Artesanal
          </h2>
          <p style="font-size: 0.85rem; color: var(--chalk-gold); font-family: var(--font-chalk);">
            Elegí tu tamaño, tus sabores favoritos y personalizá con salsas y toppings
          </p>
        </div>

        <!-- Indicador de Pasos (Breadcrumb visual) -->
        <div class="wizard-steps-indicator" style="display: flex; justify-content: space-between; margin-bottom: 20px; position: relative;">
          <div class="step-pill ${this.currentStep === 1 ? 'active' : (this.currentStep > 1 ? 'completed' : '')}" id="stepIndicator1">
            <span class="step-num">1</span>
            <span class="step-name">Tamaño</span>
          </div>
          <div class="step-divider"></div>
          <div class="step-pill ${this.currentStep === 2 ? 'active' : (this.currentStep > 2 ? 'completed' : '')}" id="stepIndicator2">
            <span class="step-num">2</span>
            <span class="step-name">Sabores</span>
          </div>
          <div class="step-divider"></div>
          <div class="step-pill ${this.currentStep === 3 ? 'active' : ''}" id="stepIndicator3">
            <span class="step-num">3</span>
            <span class="step-name">Toppings</span>
          </div>
        </div>

        <!-- PASO 1: Selector de Contenedor -->
        <div id="wizardStep1" class="wizard-step-pane" style="display: block;">
          <h3 style="font-size: 1rem; color: #fff; margin-bottom: 12px; font-weight: 600;">
            1. Seleccioná el tamaño o presentación:
          </h3>
          <div class="containers-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; margin-bottom: 20px;">
            ${ICE_CREAM_CONTAINERS.map(c => `
              <div class="container-option-card ${this.selectedContainer && this.selectedContainer.id === c.id ? 'selected' : ''}" 
                   data-container-id="${c.id}" 
                   style="background: var(--surface-card); border: 2px solid ${this.selectedContainer && this.selectedContainer.id === c.id ? 'var(--chalk-gold)' : 'var(--border-chalk)'}; border-radius: 12px; padding: 14px; text-align: center; cursor: pointer; transition: all 0.2s;">
                <div style="font-size: 2rem; margin-bottom: 6px;">${c.icon}</div>
                <div style="font-weight: 700; color: #fff; font-size: 0.95rem; margin-bottom: 2px;">${c.name}</div>
                <div style="display: inline-block; background: var(--chalk-gold-dim); color: var(--chalk-gold); font-size: 0.72rem; padding: 2px 8px; border-radius: 12px; margin-bottom: 6px; font-weight: 600;">
                  ${c.capacityLabel}
                </div>
                <div style="font-family: var(--font-mono); font-size: 1.05rem; font-weight: 700; color: var(--chalk-gold);">
                  ${this.currency} ${c.price}
                </div>
              </div>
            `).join('')}
          </div>
          <button class="btn-wa-submit" id="btnGoToStep2" style="background: var(--chalk-gold); color: #101614;">
            Continuar a Selección de Sabores →
          </button>
        </div>

        <!-- PASO 2: Galería de Sabores con Límite Dinámico -->
        <div id="wizardStep2" class="wizard-step-pane" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
            <h3 style="font-size: 1rem; color: #fff; font-weight: 600;">
              2. Elegí hasta <span id="maxFlavorsLabel" style="color:var(--chalk-gold);">${this.selectedContainer.maxFlavors}</span> sabores:
            </h3>
            <button class="btn-nav" id="btnBackToStep1" style="font-size: 11px; padding: 4px 10px;">← Cambiar tamaño</button>
          </div>

          <!-- Barra de Contador en Vivo -->
          <div class="flavor-counter-banner" style="background: rgba(236, 201, 75, 0.1); border: 1px solid var(--border-gold); border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <span style="font-size: 0.85rem; color: var(--chalk-muted);">Sabores seleccionados:</span>
              <strong id="flavorLiveCounter" style="font-family: var(--font-mono); font-size: 1.15rem; color: var(--chalk-gold); margin-left: 6px;">
                0 de ${this.selectedContainer.maxFlavors}
              </strong>
            </div>
            <div id="flavorLimitMessage" style="font-size: 0.78rem; font-weight: 700; color: var(--chalk-green);">
              ¡Podés elegir sabores!
            </div>
          </div>

          <!-- Filtro de Categorías de Sabores -->
          <div class="flavor-category-chips" style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 14px; scrollbar-width: none;">
            <button class="cat-pill active" data-flavor-cat="ALL">Todos los Sabores</button>
            <button class="cat-pill" data-flavor-cat="Chocolates">🍫 Chocolates</button>
            <button class="cat-pill" data-flavor-cat="Dulces de Leche">🍮 Dulce de Leche</button>
            <button class="cat-pill" data-flavor-cat="Cremas">🍦 Cremas</button>
            <button class="cat-pill" data-flavor-cat="Frutales">🍓 Frutales</button>
            <button class="cat-pill" data-flavor-cat="Especiales">✨ Especiales</button>
          </div>

          <!-- Lista de Sabores -->
          <div id="flavorsGridList" style="max-height: 280px; overflow-y: auto; padding-right: 4px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px;">
            <!-- Renderizado dinámico -->
          </div>

          <button class="btn-wa-submit" id="btnGoToStep3" style="background: var(--chalk-gold); color: #101614;" disabled>
            Elegí al menos 1 sabor para continuar
          </button>
        </div>

        <!-- PASO 3: Agregados & Salsas -->
        <div id="wizardStep3" class="wizard-step-pane" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="font-size: 1rem; color: #fff; font-weight: 600;">
              3. ¿Deseas agregar toppings o salsas? (Opcional)
            </h3>
            <button class="btn-nav" id="btnBackToStep2" style="font-size: 11px; padding: 4px 10px;">← Editar sabores</button>
          </div>

          <div class="toppings-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-bottom: 16px; max-height: 230px; overflow-y: auto;">
            ${ICE_CREAM_TOPPINGS.map(t => `
              <div class="topping-card" data-topping-id="${t.id}" 
                   style="background: var(--surface-card); border: 1px solid var(--border-chalk); border-radius: 8px; padding: 10px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size: 1.3rem;">${t.icon}</span>
                  <div>
                    <div style="font-size: 0.82rem; font-weight: 600; color: #fff;">${t.name}</div>
                    <div style="font-size: 0.75rem; color: var(--chalk-gold); font-family: var(--font-mono);">+${this.currency} ${t.price}</div>
                  </div>
                </div>
                <input type="checkbox" class="topping-checkbox" data-topping-id="${t.id}" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--chalk-gold);">
              </div>
            `).join('')}
          </div>

          <!-- Resumen Final del Helado -->
          <div class="wizard-final-summary" style="background: #0E1412; border: 1px solid var(--border-gold); border-radius: 12px; padding: 14px; margin-bottom: 16px;">
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--chalk-gold); margin-bottom: 6px;">
              📋 Resumen de tu elección:
            </div>
            <div id="wizardSummaryText" style="font-size: 0.82rem; color: var(--chalk-muted); line-height: 1.4; margin-bottom: 8px;">
              <!-- Resumen dinámico -->
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-chalk); padding-top: 8px;">
              <strong style="color: #fff; font-size: 0.95rem;">Total acumulado:</strong>
              <strong id="wizardTotalPriceDisplay" style="font-family: var(--font-mono); font-size: 1.25rem; color: var(--chalk-gold);">
                ${this.currency} 0
              </strong>
            </div>
          </div>

          <button class="btn-wa-submit" id="btnConfirmIceCreamOrder" style="background: var(--chalk-green); color: #0E1412;">
            🛒 Agregar Helado a la Comanda
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
    this.attachEvents();
  }

  attachEvents() {
    const modal = document.getElementById('iceCreamWizardModal');
    const closeBtn = document.getElementById('closeIceCreamWizardBtn');
    if (closeBtn) closeBtn.onclick = () => this.close();

    // Contenedores (Paso 1)
    const containerCards = modal.querySelectorAll('.container-option-card');
    containerCards.forEach(card => {
      card.onclick = () => {
        const id = card.getAttribute('data-container-id');
        this.selectContainer(id);
      };
    });

    // Navegación entre pasos
    const btnGoToStep2 = document.getElementById('btnGoToStep2');
    if (btnGoToStep2) btnGoToStep2.onclick = () => this.goToStep(2);

    const btnBackToStep1 = document.getElementById('btnBackToStep1');
    if (btnBackToStep1) btnBackToStep1.onclick = () => this.goToStep(1);

    const btnGoToStep3 = document.getElementById('btnGoToStep3');
    if (btnGoToStep3) btnGoToStep3.onclick = () => this.goToStep(3);

    const btnBackToStep2 = document.getElementById('btnBackToStep2');
    if (btnBackToStep2) btnBackToStep2.onclick = () => this.goToStep(2);

    // Filtros de categorías de sabores
    const catChips = modal.querySelectorAll('.flavor-category-chips .cat-pill');
    catChips.forEach(chip => {
      chip.onclick = () => {
        catChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeCategory = chip.getAttribute('data-flavor-cat');
        this.renderFlavorsList();
      };
    });

    // Toppings
    const toppingCards = modal.querySelectorAll('.topping-card');
    toppingCards.forEach(card => {
      card.onclick = (e) => {
        if (e.target.tagName !== 'INPUT') {
          const cb = card.querySelector('.topping-checkbox');
          cb.checked = !cb.checked;
        }
        this.updateToppingsState();
      };
    });

    // Botón Final
    const btnConfirm = document.getElementById('btnConfirmIceCreamOrder');
    if (btnConfirm) {
      btnConfirm.onclick = () => this.confirmAndAddToCart();
    }
  }

  selectContainer(containerId) {
    const found = ICE_CREAM_CONTAINERS.find(c => c.id === containerId);
    if (!found) return;
    this.selectedContainer = found;

    // Reseteamos sabores si exceden la nueva capacidad
    this.selectedFlavors = {};

    // Actualizar UI
    const modal = document.getElementById('iceCreamWizardModal');
    modal.querySelectorAll('.container-option-card').forEach(card => {
      const isSel = card.getAttribute('data-container-id') === containerId;
      card.classList.toggle('selected', isSel);
      card.style.borderColor = isSel ? 'var(--chalk-gold)' : 'var(--border-chalk)';
    });

    document.getElementById('maxFlavorsLabel').textContent = this.selectedContainer.maxFlavors;
    this.updateFlavorCounterUI();
  }

  goToStep(stepNumber) {
    this.currentStep = stepNumber;
    const modal = document.getElementById('iceCreamWizardModal');

    document.getElementById('wizardStep1').style.display = (stepNumber === 1) ? 'block' : 'none';
    document.getElementById('wizardStep2').style.display = (stepNumber === 2) ? 'block' : 'none';
    document.getElementById('wizardStep3').style.display = (stepNumber === 3) ? 'block' : 'none';

    // Actualizar indicadores
    for (let i = 1; i <= 3; i++) {
      const ind = document.getElementById(`stepIndicator${i}`);
      if (ind) {
        ind.className = 'step-pill';
        if (i === stepNumber) ind.classList.add('active');
        else if (i < stepNumber) ind.classList.add('completed');
      }
    }

    if (stepNumber === 2) {
      this.renderFlavorsList();
      this.updateFlavorCounterUI();
    } else if (stepNumber === 3) {
      this.renderFinalSummary();
    }
  }

  renderFlavorsList() {
    const container = document.getElementById('flavorsGridList');
    if (!container) return;

    const allFlavors = this.getFlavorsList();
    const filtered = allFlavors.filter(f => {
      if (this.activeCategory === 'ALL') return true;
      return f.categoryName === this.activeCategory;
    });

    const maxLimit = this.selectedContainer.maxFlavors;
    const currentCount = this.getTotalSelectedFlavorsCount();
    const isLimitReached = currentCount >= maxLimit;

    let html = '';
    filtered.forEach(flavor => {
      const isOut = Boolean(flavor.outOfStock);
      const chosenQty = this.selectedFlavors[flavor.id] || 0;
      const isCardDisabled = isOut || (isLimitReached && chosenQty === 0);

      let tagsBadges = '';
      if (isOut) tagsBadges += '<span class="dish-badge" style="background:#E53E3E; color:#fff;">✕ AGOTADO HOY</span> ';
      if (flavor.tags && flavor.tags.includes('star')) tagsBadges += '<span class="dish-badge badge-star">⭐ Favorito</span> ';
      if (flavor.tags && (flavor.tags.includes('celiac') || flavor.tags.includes('singluten'))) tagsBadges += '<span class="dish-badge badge-celiac">🌾 Sin TACC</span> ';
      if (flavor.tags && (flavor.tags.includes('vegano') || flavor.tags.includes('vegan'))) tagsBadges += '<span class="dish-badge badge-veggie">🌱 Vegano</span> ';

      html += `
        <div class="flavor-row-item" style="background: var(--surface-card); border: 1px solid ${chosenQty > 0 ? 'var(--chalk-gold)' : 'var(--border-chalk)'}; border-radius: 10px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; opacity: ${isCardDisabled ? '0.45' : '1'}; transition: all 0.2s;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <strong style="color: #fff; font-size: 0.92rem; ${isOut ? 'text-decoration: line-through;' : ''}">${flavor.name}</strong>
              ${tagsBadges}
            </div>
            ${flavor.description ? `<div style="font-size: 0.78rem; color: var(--chalk-dim); margin-top: 2px;">${flavor.description}</div>` : ''}
          </div>

          <div class="flavor-ctrls" style="display: flex; align-items: center; gap: 6px;">
            ${isOut ? `
              <span style="font-size: 0.75rem; color: #E53E3E; font-weight: 700;">No disponible</span>
            ` : `
              <button type="button" class="btn-qty" onclick="window.activeIceCreamWizard.decreaseFlavor('${flavor.id}')" ${chosenQty <= 0 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>-</button>
              <span style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; color: ${chosenQty > 0 ? 'var(--chalk-gold)' : 'var(--chalk-dim)'}; min-width: 18px; text-align: center;">${chosenQty}</span>
              <button type="button" class="btn-qty" onclick="window.activeIceCreamWizard.increaseFlavor('${flavor.id}')" ${isLimitReached ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>+</button>
            `}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  increaseFlavor(flavorId) {
    const maxLimit = this.selectedContainer.maxFlavors;
    const currentCount = this.getTotalSelectedFlavorsCount();
    if (currentCount >= maxLimit) return;

    this.selectedFlavors[flavorId] = (this.selectedFlavors[flavorId] || 0) + 1;
    this.updateFlavorCounterUI();
    this.renderFlavorsList();
  }

  decreaseFlavor(flavorId) {
    if (!this.selectedFlavors[flavorId]) return;
    this.selectedFlavors[flavorId] -= 1;
    if (this.selectedFlavors[flavorId] <= 0) {
      delete this.selectedFlavors[flavorId];
    }
    this.updateFlavorCounterUI();
    this.renderFlavorsList();
  }

  updateFlavorCounterUI() {
    const maxLimit = this.selectedContainer.maxFlavors;
    const currentCount = this.getTotalSelectedFlavorsCount();

    const counter = document.getElementById('flavorLiveCounter');
    const msg = document.getElementById('flavorLimitMessage');
    const btnNext = document.getElementById('btnGoToStep3');

    if (counter) counter.textContent = `${currentCount} de ${maxLimit}`;

    if (msg) {
      if (currentCount === maxLimit) {
        msg.textContent = '✓ ¡Límite de sabores alcanzado! Listo para continuar';
        msg.style.color = 'var(--chalk-gold)';
      } else if (currentCount === 0) {
        msg.textContent = `Elegí entre 1 y ${maxLimit} sabores`;
        msg.style.color = 'var(--chalk-dim)';
      } else {
        msg.textContent = `Podés sumar ${maxLimit - currentCount} sabor(es) más`;
        msg.style.color = 'var(--chalk-green)';
      }
    }

    if (btnNext) {
      btnNext.disabled = currentCount === 0;
      btnNext.textContent = currentCount === 0 
        ? 'Elegí al menos 1 sabor para continuar' 
        : `Continuar a Toppings (${currentCount} sabores elegidos) →`;
    }
  }

  updateToppingsState() {
    const modal = document.getElementById('iceCreamWizardModal');
    const checkboxes = modal.querySelectorAll('.topping-checkbox');
    this.selectedToppings = [];
    checkboxes.forEach(cb => {
      if (cb.checked) {
        this.selectedToppings.push(cb.getAttribute('data-topping-id'));
      }
    });
    this.renderFinalSummary();
  }

  renderFinalSummary() {
    const summaryBox = document.getElementById('wizardSummaryText');
    const totalDisplay = document.getElementById('wizardTotalPriceDisplay');
    if (!summaryBox || !totalDisplay) return;

    const allFlavors = this.getFlavorsList();
    const flavorsSummary = Object.entries(this.selectedFlavors).map(([fId, qty]) => {
      const flv = allFlavors.find(f => f.id === fId);
      const name = flv ? flv.name : fId;
      return `${qty > 1 ? `<b>${qty}x</b> ` : ''}${name}`;
    }).join(', ');

    const toppingsSummary = this.selectedToppings.map(tId => {
      const top = ICE_CREAM_TOPPINGS.find(t => t.id === tId);
      return top ? `${top.name} (+${this.currency}${top.price})` : tId;
    }).join(', ');

    summaryBox.innerHTML = `
      <div>🍧 <b>Presentación:</b> ${this.selectedContainer.name} (${this.currency} ${this.selectedContainer.price})</div>
      <div>🍦 <b>Sabores elegidos:</b> ${flavorsSummary || 'Ninguno'}</div>
      ${toppingsSummary ? `<div>✨ <b>Agregados:</b> ${toppingsSummary}</div>` : ''}
    `;

    totalDisplay.textContent = `${this.currency} ${this.calculateTotal()}`;
  }

  confirmAndAddToCart() {
    const totalCount = this.getTotalSelectedFlavorsCount();
    if (totalCount === 0) {
      alert('Por favor seleccioná al menos 1 sabor.');
      this.goToStep(2);
      return;
    }

    const allFlavors = this.getFlavorsList();
    const flavorsListDesc = Object.entries(this.selectedFlavors).map(([fId, qty]) => {
      const flv = allFlavors.find(f => f.id === fId);
      return `${qty > 1 ? `${qty}x ` : ''}${flv ? flv.name : fId}`;
    }).join(' + ');

    const toppingsDesc = this.selectedToppings.map(tId => {
      const top = ICE_CREAM_TOPPINGS.find(t => t.id === tId);
      return top ? top.name : '';
    }).filter(Boolean).join(' + ');

    const customIceCreamDish = {
      id: `icecream_${Date.now()}`,
      categoryId: 'heladeria_custom',
      name: `${this.selectedContainer.name} Personalizado`,
      price: this.calculateTotal(),
      description: `Sabores: [${flavorsListDesc}]${toppingsDesc ? ` • Toppings: [${toppingsDesc}]` : ''}`,
      tags: ['star'],
      photoUrl: null,
      isCustomIceCream: true,
      customOptions: {
        container: this.selectedContainer,
        flavors: this.selectedFlavors,
        toppings: this.selectedToppings
      }
    };

    this.onAddToCart(customIceCreamDish);
    this.close();
  }

  open() {
    // Resetear al paso 1 o mantener estado
    this.currentStep = 1;
    this.goToStep(1);
    const modal = document.getElementById('iceCreamWizardModal');
    if (modal) modal.classList.add('active');
    window.activeIceCreamWizard = this;
  }

  close() {
    const modal = document.getElementById('iceCreamWizardModal');
    if (modal) modal.classList.remove('active');
  }
}
