/**
 * IceCreamWizard.js
 * Armador de helado artesanal en una sola pantalla (ScanGo).
 *
 * ─ Divulgación progresiva (una vista, sin pasos a ciegas) ────────────────────
 *  1. Tamaño     → tarjetas seleccionables (de individual a familiar)
 *  2. Sabores    → recién aparece al elegir tamaño: tarjetas tocables con
 *                  contador en vivo y chips de categoría data-driven (sólo las
 *                  categorías que EXISTEN en la carta)
 *  3. Toppings   → recién aparece al elegir tamaño, agrupados en toppings y salsas
 *
 * Una barra inferior fija muestra el resumen y el total en todo momento, con el
 * botón "Agregar". Antes el resumen y el precio recién aparecían en el 3er paso.
 *
 * Se integra al carrito del menú público con desglose completo.
 */

import { ICE_CREAM_CONTAINERS, ICE_CREAM_PRESETS, ICE_CREAM_TOPPINGS } from './IceCreamPresets.js';
import { escapeHtml } from '/js/utils/escapeHtmlBrowser.js';

/** Emoji por balde de categoría de sabor (los baldes desconocidos caen al default). */
const FLAVOR_EMOJI = {
  'Chocolates': '🍫',
  'Dulces de Leche': '🍮',
  'Cremas': '🍦',
  'Frutales': '🍓',
  'Especiales': '✨',
  'Carta de la Casa': '📋'
};

/** Orden estable de los baldes conocidos (los extra se agregan al final). */
const KNOWN_BUCKETS = ['Chocolates', 'Dulces de Leche', 'Cremas', 'Frutales', 'Especiales', 'Carta de la Casa'];

export class IceCreamWizard {
  constructor(options = {}) {
    this.currency = options.currency || '$';
    this.onAddToCart = options.onAddToCart || (() => {});
    this.customFlavors = options.customFlavors || null; // Sabores reales cargados por el restaurante

    // Estado del armador. Arranca SIN tamaño ni sabores: el flujo es
    // "elegí el tamaño → recién ahí aparecen sabores y toppings" (menos ruido).
    this.selectedContainer = null;
    this.sizeChosen = false;
    this.selectedFlavors = {};   // { flavorId: 1 }
    this.selectedToppings = {};  // { toppingId: 1 }
    this.activeFlavorCat = 'ALL';

    this.initDOM();
  }

  getFlavorsList() {
    if (this.customFlavors && this.customFlavors.length > 0) {
      return this.customFlavors;
    }
    return ICE_CREAM_PRESETS;
  }

  getContainers() {
    return ICE_CREAM_CONTAINERS;
  }

  /** Baldes de categoría realmente presentes en la carta (nunca chips vacíos). */
  getFlavorBuckets() {
    const present = new Set(this.getFlavorsList().map(f => f.categoryName || 'Carta de la Casa'));
    const known = KNOWN_BUCKETS.filter(b => present.has(b));
    const extra = Array.from(present).filter(b => !KNOWN_BUCKETS.includes(b));
    return [...known, ...extra];
  }

  getTotalSelectedFlavorsCount() {
    return Object.keys(this.selectedFlavors).length;
  }

  calculateTotal() {
    const basePrice = this.selectedContainer ? this.selectedContainer.price : 0;
    const toppingsTotal = Object.keys(this.selectedToppings).reduce((sum, topId) => {
      const top = ICE_CREAM_TOPPINGS.find(t => t.id === topId);
      return sum + (top ? top.price : 0);
    }, 0);
    return basePrice + toppingsTotal;
  }

  initDOM() {
    let existingModal = document.getElementById('iceCreamWizardModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'iceCreamWizardModal';
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'iceCreamWizardTitle');
    modal.innerHTML = `
      <div class="modal-box ice-cream-wizard-box">
        <header class="icw-header">
          <div>
            <h2 class="icw-title" id="iceCreamWizardTitle">🍧 Armá tu helado</h2>
            <p class="icw-subtitle">Elegí el tamaño, tus sabores y los toppings</p>
          </div>
          <button type="button" class="modal-close icw-close" id="closeIceCreamWizardBtn" aria-label="Cerrar">✕</button>
        </header>

        <div class="icw-body" id="iceCreamWizardBody">
          <section class="icw-section">
            <h3 class="icw-step"><span class="icw-step-num">1</span> Elegí el tamaño</h3>
            <div class="icw-sizes" id="iceCreamSizes"></div>
            <p class="icw-size-pending" id="iceCreamSizeHint">Elegí un tamaño para ver los sabores 👇</p>
          </section>

          <section class="icw-section" id="iceCreamFlavorsSection" hidden>
            <h3 class="icw-step">
              <span class="icw-step-num">2</span> Elegí tus sabores
              <span class="icw-counter" id="iceCreamFlavorCounter">0 / 2</span>
            </h3>
            <div class="icw-chips" id="iceCreamFlavorChips"></div>
            <div class="icw-flavors" id="iceCreamFlavors"></div>
            <p class="icw-hint" id="iceCreamFlavorHint"></p>
          </section>

          <section class="icw-section" id="iceCreamToppingsSection" hidden>
            <h3 class="icw-step">
              <span class="icw-step-num">3</span> Sumá toppings y salsas
              <span class="icw-optional">opcional</span>
            </h3>
            <div id="iceCreamToppings"></div>
          </section>
        </div>

        <footer class="icw-footer" id="iceCreamWizardFooter">
          <div class="icw-summary" id="iceCreamSummaryLine" aria-live="polite" aria-atomic="true"></div>
          <div class="icw-footer-row">
            <div class="icw-total" aria-live="polite" aria-atomic="true">
              <span>Total</span>
              <strong id="wizardTotalPriceDisplay">${this.currency} 0</strong>
            </div>
            <button type="button" class="btn-wa-submit icw-add" id="btnConfirmIceCreamOrder">🛒 Agregar</button>
          </div>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);
    this.attachEvents();
    this.render();
  }

  attachEvents() {
    const modal = document.getElementById('iceCreamWizardModal');
    if (!modal) return;

    const closeBtn = document.getElementById('closeIceCreamWizardBtn');
    if (closeBtn) closeBtn.onclick = () => this.close();

    const btnConfirm = document.getElementById('btnConfirmIceCreamOrder');
    if (btnConfirm) btnConfirm.onclick = () => this.confirmAndAddToCart();

    // Cerrar tocando el fondo (no el panel).
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.close();
    });

    // Delegación de los controles internos (sin re-binding al re-renderizar).
    modal.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || !target.closest) return;

      const sizeBtn = target.closest('[data-icw-size]');
      if (sizeBtn) { this.selectContainer(sizeBtn.getAttribute('data-icw-size')); return; }

      const chip = target.closest('[data-icw-cat]');
      if (chip) { this.setFlavorCategory(chip.getAttribute('data-icw-cat')); return; }

      const flavorBtn = target.closest('[data-icw-flavor]');
      if (flavorBtn) { this.toggleFlavor(flavorBtn.getAttribute('data-icw-flavor')); return; }

      const toppingBtn = target.closest('[data-icw-topping]');
      if (toppingBtn) { this.toggleTopping(toppingBtn.getAttribute('data-icw-topping')); return; }
    });
  }

  selectContainer(containerId) {
    const found = this.getContainers().find(c => c.id === containerId);
    if (!found) return;
    this.selectedContainer = found;
    this.sizeChosen = true;

    // Si el nuevo tamaño admite menos sabores, recortamos los que sobran.
    const ids = Object.keys(this.selectedFlavors);
    while (ids.length > found.maxFlavors) {
      delete this.selectedFlavors[ids.pop()];
    }

    this.renderSizes();
    this.renderFlavors();
    this.renderSummary();
    this.updateFlowVisibility();

    // Al elegir el tamaño se despliegan los sabores: los acercamos a la vista.
    const flavorsSection = document.getElementById('iceCreamFlavorsSection');
    if (flavorsSection && flavorsSection.hidden === false && typeof flavorsSection.scrollIntoView === 'function') {
      const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      flavorsSection.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  }

  setFlavorCategory(category) {
    this.activeFlavorCat = category;
    this.renderFlavorChips();
    this.renderFlavors();
  }

  toggleFlavor(flavorId) {
    const flavor = this.getFlavorsList().find(f => f.id === flavorId);
    if (!flavor || flavor.outOfStock) return;

    if (this.selectedFlavors[flavorId]) {
      delete this.selectedFlavors[flavorId];
    } else if (this.getTotalSelectedFlavorsCount() < this.selectedContainer.maxFlavors) {
      this.selectedFlavors[flavorId] = 1;
    }

    this.renderFlavors();
    this.renderSummary();
  }

  toggleTopping(toppingId) {
    if (this.selectedToppings[toppingId]) {
      delete this.selectedToppings[toppingId];
    } else {
      this.selectedToppings[toppingId] = 1;
    }

    // Actualización puntual (no re-renderizamos toda la lista para no perder scroll).
    const btn = document.querySelector(`[data-icw-topping="${toppingId}"]`);
    if (btn) {
      const selected = !!this.selectedToppings[toppingId];
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
      const check = btn.querySelector('.icw-topping-check');
      if (check) check.textContent = selected ? '✓' : '';
    }
    this.renderSummary();
  }

  render() {
    this.renderSizes();
    this.renderFlavorChips();
    this.renderFlavors();
    this.renderToppings();
    this.renderSummary();
    this.updateFlowVisibility();
  }

  /**
   * Divulgación progresiva: sabores y toppings sólo se muestran una vez que el
   * comensal eligió el tamaño. Antes aparecían todos los pasos a la vez y la
   * vista quedaba saturada.
   */
  updateFlowVisibility() {
    const show = this.sizeChosen && !!this.selectedContainer;

    const flavorsSection = document.getElementById('iceCreamFlavorsSection');
    if (flavorsSection) flavorsSection.hidden = !show;

    const toppingsSection = document.getElementById('iceCreamToppingsSection');
    if (toppingsSection) toppingsSection.hidden = !show;

    const hint = document.getElementById('iceCreamSizeHint');
    if (hint) hint.hidden = show;
  }

  renderSizes() {
    const el = document.getElementById('iceCreamSizes');
    if (!el) return;

    el.innerHTML = this.getContainers().map(c => {
      const selected = this.selectedContainer && this.selectedContainer.id === c.id;
      const badge = c.badge ? `<span class="icw-size-badge">${escapeHtml(c.badge)}</span>` : '';
      return `
        <button type="button" class="icw-size${selected ? ' is-selected' : ''}"
                data-icw-size="${escapeHtml(c.id)}" aria-pressed="${selected}">
          ${badge}
          <span class="icw-size-icon">${c.icon}</span>
          <span class="icw-size-name">${escapeHtml(c.name)}</span>
          <span class="icw-size-cap">${escapeHtml(c.capacityLabel)}</span>
          <span class="icw-size-price">${this.currency} ${c.price}</span>
        </button>`;
    }).join('');
  }

  renderFlavorChips() {
    const el = document.getElementById('iceCreamFlavorChips');
    if (!el) return;

    const buckets = this.getFlavorBuckets();
    // Con 0 o 1 grupo no hay nada que filtrar: ocultamos los chips.
    if (buckets.length <= 1) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = 'flex';

    const all = this.getFlavorsList();
    const countFor = (bucket) => all.filter(f => (f.categoryName || 'Carta de la Casa') === bucket).length;
    const chip = (key, label) => `
      <button type="button" class="cat-pill${this.activeFlavorCat === key ? ' active' : ''}"
              data-icw-cat="${escapeHtml(key)}">${label}</button>`;

    el.innerHTML = chip('ALL', `Todos (${all.length})`)
      + buckets.map(b => chip(b, `${FLAVOR_EMOJI[b] || '🍨'} ${escapeHtml(b)} (${countFor(b)})`)).join('');
  }

  renderFlavors() {
    const el = document.getElementById('iceCreamFlavors');
    if (!el) return;

    // Sin tamaño elegido no hay límite de sabores ni nada que listar todavía.
    if (!this.selectedContainer) {
      el.innerHTML = '';
      return;
    }

    const all = this.getFlavorsList();
    const list = this.activeFlavorCat === 'ALL'
      ? all
      : all.filter(f => (f.categoryName || 'Carta de la Casa') === this.activeFlavorCat);

    if (!list.length) {
      el.innerHTML = '<p class="icw-hint">No hay sabores en esta categoría.</p>';
      return;
    }

    const max = this.selectedContainer.maxFlavors;
    const count = this.getTotalSelectedFlavorsCount();

    el.innerHTML = list.map(f => {
      const selected = !!this.selectedFlavors[f.id];
      const out = Boolean(f.outOfStock);
      const disabled = out || (!selected && count >= max);
      const tags = this.renderFlavorTags(f);

      return `
        <button type="button" class="icw-flavor${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}"
                data-icw-flavor="${escapeHtml(f.id)}" aria-pressed="${selected}" ${disabled ? 'disabled' : ''}>
          <span class="icw-flavor-check">${selected ? '✓' : ''}</span>
          <span class="icw-flavor-info">
            <span class="icw-flavor-name">${escapeHtml(f.name)}</span>
            ${f.description ? `<span class="icw-flavor-desc">${escapeHtml(f.description)}</span>` : ''}
            ${tags ? `<span class="icw-flavor-tags">${tags}</span>` : ''}
          </span>
        </button>`;
    }).join('');
  }

  renderFlavorTags(flavor) {
    const tags = Array.isArray(flavor.tags) ? flavor.tags : [];
    let html = '';
    if (flavor.outOfStock) html += '<span class="dish-badge" style="background:#E53E3E; color:#fff;">✕ Agotado hoy</span>';
    if (tags.includes('star')) html += '<span class="dish-badge badge-star">⭐ Favorito</span>';
    if (tags.includes('celiac') || tags.includes('singluten')) html += '<span class="dish-badge badge-celiac">🌾 Sin TACC</span>';
    if (tags.includes('vegano') || tags.includes('vegan') || tags.includes('veggie')) html += '<span class="dish-badge badge-veggie">🌱 Vegano</span>';
    return html;
  }

  renderToppings() {
    const el = document.getElementById('iceCreamToppings');
    if (!el) return;

    const groups = [
      { title: 'Toppings', items: ICE_CREAM_TOPPINGS.filter(t => !t.id.startsWith('salsa')) },
      { title: 'Salsas', items: ICE_CREAM_TOPPINGS.filter(t => t.id.startsWith('salsa')) }
    ];

    el.innerHTML = groups.filter(g => g.items.length).map(g => `
      <div class="icw-toppings-group">
        <h4>${g.title}</h4>
        <div class="icw-toppings">
          ${g.items.map(t => this.renderToppingCard(t)).join('')}
        </div>
      </div>`).join('');
  }

  renderToppingCard(topping) {
    const selected = !!this.selectedToppings[topping.id];
    return `
      <button type="button" class="icw-topping${selected ? ' is-selected' : ''}"
              data-icw-topping="${escapeHtml(topping.id)}" aria-pressed="${selected}">
        <span class="icw-topping-main">
          <span class="icw-topping-ico">${topping.icon}</span>
          <span class="icw-topping-text">
            <span class="icw-topping-name">${escapeHtml(topping.name)}</span>
            <span class="icw-topping-price">+${this.currency} ${topping.price}</span>
          </span>
        </span>
        <span class="icw-topping-check">${selected ? '✓' : ''}</span>
      </button>`;
  }

  renderSummary() {
    const count = this.getTotalSelectedFlavorsCount();
    const max = this.selectedContainer ? this.selectedContainer.maxFlavors : 0;
    const total = this.calculateTotal();

    const counter = document.getElementById('iceCreamFlavorCounter');
    if (counter) counter.textContent = `${count} / ${max}`;

    const totalEl = document.getElementById('wizardTotalPriceDisplay');
    if (totalEl) totalEl.textContent = `${this.currency} ${total}`;

    const line = document.getElementById('iceCreamSummaryLine');
    if (line) {
      if (!this.selectedContainer) {
        line.textContent = 'Elegí un tamaño para empezar';
      } else {
        const parts = [this.selectedContainer.name];
        parts.push(count === 1 ? '1 sabor' : `${count} sabores`);
        const toppings = Object.keys(this.selectedToppings).length;
        if (toppings) parts.push(toppings === 1 ? '1 agregado' : `${toppings} agregados`);
        line.textContent = parts.join(' · ');
      }
    }

    const hint = document.getElementById('iceCreamFlavorHint');
    if (hint) {
      if (!this.selectedContainer) hint.textContent = '';
      else if (count === 0) hint.textContent = `Elegí entre 1 y ${max} sabores`;
      else if (count >= max) hint.textContent = '✓ Límite de sabores alcanzado';
      else hint.textContent = `Podés sumar ${max - count} sabor${max - count === 1 ? '' : 'es'} más`;
    }

    const btn = document.getElementById('btnConfirmIceCreamOrder');
    if (btn) {
      if (!this.selectedContainer) {
        btn.disabled = true;
        btn.textContent = 'Elegí un tamaño';
      } else {
        const ready = count > 0;
        btn.disabled = !ready;
        btn.textContent = ready ? `🛒 Agregar · ${this.currency} ${total}` : 'Elegí al menos 1 sabor';
      }
    }
  }

  confirmAndAddToCart() {
    if (!this.selectedContainer || this.getTotalSelectedFlavorsCount() === 0) return;

    const allFlavors = this.getFlavorsList();
    const flavorsListDesc = Object.keys(this.selectedFlavors).map(fId => {
      const flavor = allFlavors.find(f => f.id === fId);
      return flavor ? flavor.name : fId;
    }).join(' + ');

    const toppingsDesc = Object.keys(this.selectedToppings).map(tId => {
      const topping = ICE_CREAM_TOPPINGS.find(t => t.id === tId);
      return topping ? topping.name : '';
    }).filter(Boolean).join(' + ');

    const customIceCreamDish = {
      id: `icecream_${Date.now()}`,
      categoryId: 'heladeria_custom',
      name: `${this.selectedContainer.name} a medida`,
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
    // Cada apertura arranca un armado limpio: primero tamaño, después sabores.
    this.selectedContainer = null;
    this.sizeChosen = false;
    this.selectedFlavors = {};
    this.selectedToppings = {};
    this.activeFlavorCat = 'ALL';

    this.render();
    const modal = document.getElementById('iceCreamWizardModal');
    if (modal) modal.classList.add('active');
    // Exponer la instancia por compatibilidad (algunos estilos/atajos la referencian).
    window.activeIceCreamWizard = this;
  }

  close() {
    const modal = document.getElementById('iceCreamWizardModal');
    if (modal) modal.classList.remove('active');
  }
}
