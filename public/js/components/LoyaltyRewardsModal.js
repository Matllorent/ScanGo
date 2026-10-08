import { escapeHtml } from '/js/utils/escapeHtmlBrowser.js';

/**
 * public/js/components/LoyaltyRewardsModal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tarjeta y modal de fidelización DUAL "Club ScanGo":
 *   1. LOCAL (por restaurante): puntos + sellos + catálogo configurable.
 *   2. GLOBAL (red cross-restaurant): nivel Bronce→Platino + beneficios de la
 *      red canjeables en cualquier local.
 *
 * Data-driven: TANTO el saldo como el catálogo vienen de la API
 * (`/api/loyalty/me` + `/api/loyalty/redeem`), nunca de valores demo.
 * Privacy-first: el teléfono viaja enmascarado en la tarjeta, el canje se pide
 * por WhatsApp y hay un botón de borrado total de datos (derecho al olvido).
 *
 * Contrato con dom-bindings.js (CSP script-src-attr 'none' → cero on*=):
 *   data-js-click="activeLoyaltyModal.close"
 *   data-js-click="activeLoyaltyModal.submitPhone"
 *   data-js-input="activeLoyaltyModal.storePhoneInput|this.value"
 *   data-js-click="activeLoyaltyModal.redeemReward|<rewardId>"
 *   data-js-click="activeLoyaltyModal.sendCodeToWhatsApp"
 *   data-js-click="activeLoyaltyModal.eraseMyData"
 */

// Catálogo default local (espejo del backend: se usa solo si el restaurante
// no configuró rewards todavía).
const DEFAULT_REWARDS = [
  { id: 'rew_coffee', title: '☕ Café o Bebida de Bienvenida', pointsCost: 150 },
  { id: 'rew_dessert', title: '🍰 Postre o Copa Helada Gratis', pointsCost: 300 },
  { id: 'rew_main', title: '🍽️ 2x1 en Platos Principales', pointsCost: 500 },
  { id: 'rew_bottle', title: '🍾 Botella de Vino de la Casa', pointsCost: 750 }
];

export class LoyaltyRewardsModal {
  constructor(options = {}) {
    this.restaurantId = options.restaurantId || '';
    this.restaurantName = options.restaurantName || 'ScanGo';
    this.restaurantPhone = options.restaurantPhone || (window.restaurantData && window.restaurantData.phone) || '';
    this.phone = String(options.phone || localStorage.getItem('scango_loyalty_phone') || '').trim();
    this.config = options.config || {};
    this.allowLoyaltyPoints = options.allowLoyaltyPoints !== false;

    this.card = null;       // respuesta de /api/loyalty/me
    this.loading = false;
    this.errorMsg = '';
    this.infoMsg = '';
    this.lastRedeem = null; // { code, rewardTitle, pointsCost, restaurantName }
    this.redeemingId = null;

    // Contrato con dom-bindings: el binder resuelve `activeLoyaltyModal.<método>`
    // contra window y llama con receiver = esta instancia.
    window.activeLoyaltyModal = this;
  }

  get localRewards() {
    const rewards = (this.config && Array.isArray(this.config.rewards) && this.config.rewards.length)
      ? this.config.rewards
      : DEFAULT_REWARDS;
    return rewards;
  }

  open() {
    this.initDOM();
    const modal = document.getElementById('loyaltyRewardsModal');
    if (modal) modal.classList.add('active');
    this.loadCard();
  }

  close() {
    const modal = document.getElementById('loyaltyRewardsModal');
    if (modal) modal.classList.remove('active');
  }

  destroy() {
    const modal = document.getElementById('loyaltyRewardsModal');
    if (modal) modal.remove();
    if (window.activeLoyaltyModal === this) window.activeLoyaltyModal = null;
  }

  async loadCard() {
    if (!this.phone) {
      this.card = null;
      this.loading = false;
      this.render();
      return;
    }
    this.loading = true;
    this.errorMsg = '';
    this.render();
    try {
      const res = await fetch('/api/loyalty/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: this.phone, restaurantId: this.restaurantId })
      });
      const body = await res.json();
      if (!res.ok) {
        this.errorMsg = body.error || 'No pudimos obtener tu tarjeta. Probá de nuevo.';
      } else if (body.data && body.data.customer) {
        this.card = body.data;
        localStorage.setItem('scango_loyalty_phone', this.phone);
      } else {
        this.card = null; // teléfono válido pero sin historia todavía
        this.infoMsg = 'Todavía no tenés historial en el Club. Hacé tu primer pedido con este teléfono y empezá a sumar ⭐';
      }
    } catch (e) {
      this.errorMsg = 'No se pudo conectar. Revisá tu conexión e intentá de nuevo.';
    }
    this.loading = false;
    this.render();
  }

  storePhoneInput(value) {
    this.phone = String(value || '').trim();
  }

  submitPhone() {
    if (!this.phone) {
      this.errorMsg = 'Ingresá tu teléfono para continuar.';
      this.render();
      return;
    }
    this.loadCard();
  }

  async redeemReward(rewardId) {
    if (!this.phone) {
      this.errorMsg = 'Ingresá tu teléfono para canjear.';
      this.render();
      return;
    }
    if (this.redeemingId) return; // anti doble-tap
    this.redeemingId = rewardId;
    this.errorMsg = '';
    this.render();
    try {
      const res = await fetch('/api/loyalty/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: this.phone, restaurantId: this.restaurantId, rewardId })
      });
      const body = await res.json();
      if (!res.ok) {
        this.errorMsg = body.error || 'No se pudo canjear el beneficio.';
      } else {
        this.lastRedeem = body.data;
        this.infoMsg = '';
        // Refrescar el saldo tras el canje
        await this.loadCard();
        this.render();
      }
    } catch (e) {
      this.errorMsg = 'No se pudo canjear. Revisá tu conexión.';
    }
    this.redeemingId = null;
    this.render();
  }

  sendCodeToWhatsApp() {
    const redeem = this.lastRedeem;
    if (!redeem || !redeem.code) return;
    const msg = [
      '⭐ *CLUB SCANGO — CÓDIGO DE CANJE*',
      `🏛️ *Local:* ${this.restaurantName}`,
      `🎁 *Premio:* ${redeem.rewardTitle}`,
      `🎟️ *Código:* ${redeem.code}`,
      `🪙 *Costo:* ${redeem.pointsCost} pts`,
      '',
      '_Este código es de un solo uso. Mostralo al personal para validarlo._'
    ].join('\n');
    const rawPhone = this.restaurantPhone.replace(/[^0-9]/g, '');
    if (rawPhone) {
      window.open(`https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`, '_blank');
    }
  }

  async eraseMyData() {
    if (!this.phone) return;
    if (!window.confirm('Esto borra TODOS tus datos del Club ScanGo (puntos, sellos, premios e historial). ¿Continuar?')) return;
    try {
      const res = await fetch('/api/loyalty/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: this.phone })
      });
      const body = await res.json();
      localStorage.removeItem('scango_loyalty_phone');
      this.phone = '';
      this.card = null;
      this.lastRedeem = null;
      this.errorMsg = '';
      this.infoMsg = body && body.message ? body.message : 'Tus datos fueron eliminados por completo.';
      this.render();
    } catch (e) {
      this.errorMsg = 'No se pudo completar el borrado. Probá de nuevo.';
      this.render();
    }
  }

  initDOM() {
    let existing = document.getElementById('loyaltyRewardsModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'loyaltyRewardsModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box loyalty-modal-box" style="max-width: 520px; padding: 22px; position: relative;">
        <button type="button" class="modal-close" data-js-click="activeLoyaltyModal.close" aria-label="Cerrar">✕</button>
        <h3 class="modal-title" style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">
          <span>⭐ Club Puntos &amp; Recompensas</span>
        </h3>
        <div id="loyaltyModalContent" style="min-height: 120px;">
          <div style="color: var(--chalk-dim); font-size: 0.85rem;">⏳ Cargando tu tarjeta…</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  render() {
    const content = document.getElementById('loyaltyModalContent');
    if (!content) return;
    content.innerHTML = this.buildContent();
  }

  buildContent() {
    const parts = [];

    // Teléfono (identidad)
    parts.push(this.buildPhoneRow());

    // Estados transitorios
    if (this.loading) {
      return parts.join('') + `<div style="color: var(--chalk-dim); font-size: 0.85rem; margin-top: 14px;">⏳ Cargando tu tarjeta…</div>`;
    }
    if (this.errorMsg) {
      parts.push(`<div style="background: rgba(248,113,113,0.12); border: 1px solid rgba(248,113,113,0.4); color: #FCA5A5; border-radius: 8px; padding: 10px 12px; font-size: 0.82rem; margin-top: 10px;">${escapeHtml(this.errorMsg)}</div>`);
    }
    if (this.infoMsg && !this.card) {
      parts.push(`<div style="background: rgba(236,201,75,0.1); border: 1px solid rgba(236,201,75,0.35); color: var(--chalk-gold); border-radius: 8px; padding: 10px 12px; font-size: 0.82rem; margin-top: 10px;">${escapeHtml(this.infoMsg)}</div>`);
    }
    if (this.lastRedeem) parts.push(this.buildRedeemSuccess());

    if (this.card && this.card.customer) {
      parts.push(this.buildLocalCard());
      parts.push(this.buildGlobalSection());
      parts.push(this.buildRewards());
      parts.push(this.buildDangerZone());
    } else if (!this.phone) {
      parts.push(`<div style="color: var(--chalk-dim); font-size: 0.88rem; margin-top: 12px;">Ingresá tu teléfono para ver tu tarjeta y canjear premios. Podés darlo al hacer tu pedido o ahora mismo.</div>`);
    }

    return parts.join('');
  }

  buildPhoneRow() {
    return `
      <div style="display: flex; gap: 8px; align-items: stretch; margin-bottom: 4px;">
        <input type="tel" id="loyaltyPhoneInput" class="form-input" inputmode="tel" autocomplete="tel"
               placeholder="Tu teléfono: +598 99 123 456"
               value="${escapeHtml(this.phone || '')}"
               data-js-input="activeLoyaltyModal.storePhoneInput|this.value">
        <button type="button" class="btn-nav btn-nav-gold" data-js-click="activeLoyaltyModal.submitPhone"
                style="white-space: nowrap; font-size: 12px; padding: 0 14px;">Ver tarjeta</button>
      </div>
    `;
  }

  buildRedeemSuccess() {
    const r = this.lastRedeem;
    return `
      <div style="background: linear-gradient(135deg, rgba(72,187,120,0.16), rgba(72,187,120,0.05)); border: 1px solid rgba(72,187,120,0.5); border-radius: 10px; padding: 12px 14px; margin: 12px 0;">
        <div style="font-weight:800; color:#68D391; font-size:0.92rem; margin-bottom:4px;">🎉 ¡Beneficio canjeado!</div>
        <div style="font-size:0.84rem; color:var(--chalk-white);">${escapeHtml(r.rewardTitle)}</div>
        <div style="font-family:var(--font-mono); font-size:1.15rem; font-weight:800; color:var(--chalk-gold); letter-spacing:1px; margin:8px 0 2px;">${escapeHtml(r.code || '')}</div>
        <div style="font-size:0.75rem; color:var(--chalk-dim); margin-bottom:10px;">Mostrá este código de un solo uso al personal del local para validarlo.</div>
        <button type="button" class="btn-nav" data-js-click="activeLoyaltyModal.sendCodeToWhatsApp"
                style="width:100%; padding:8px 0; border-color:#25D366; color:#68D391; font-size:12px; font-weight:700;">
          📱 Enviar código por WhatsApp
        </button>
      </div>
    `;
  }

  buildLocalCard() {
    const c = this.card;
    const account = c.account || { points: 0, stamps: 0, levelId: 'bronce' };
    const config = this.config || {};
    const stampsTarget = Number(config.stampsTarget) || 6;
    const pointsPerOrder = Number(config.pointsPerOrder) || 10;
    const levelLabel = account.levelId === 'frecuente' ? 'Cliente Frecuente' : 'Bronce';
    const stampsFilled = Math.min(account.stamps, stampsTarget);
    const progressPct = Math.max(0, Math.min(100, Math.round((account.points / this.nextLocalRewardCost()) * 100)));

    return `
      <div class="loyalty-card-visual" style="background: linear-gradient(135deg, #1C2723, #0F1714); border: 2px solid var(--border-gold); border-radius: 16px; padding: 18px; position: relative; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.5); margin: 12px 0;">

        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div>
            <div style="font-size: 0.72rem; text-transform: uppercase; color: var(--chalk-dim); letter-spacing: 0.05em;">Tarjeta de Cliente Frecuente</div>
            <div style="font-family: var(--font-heading); font-size: 1.15rem; color: #fff; font-weight: 700;">${escapeHtml(this.restaurantName)}</div>
          </div>
          <div style="background: var(--chalk-gold); color: #0E1412; font-size: 0.72rem; font-weight: 800; padding: 3px 10px; border-radius: 20px; text-transform: uppercase;">${escapeHtml(levelLabel)}</div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px;">
          <div>
            <div style="font-size: 0.75rem; color: var(--chalk-muted);">Tus Puntos Acumulados:</div>
            <div style="font-family: var(--font-mono); font-size: 2.1rem; font-weight: 800; color: var(--chalk-gold); line-height: 1;">
              ${account.points} <span style="font-size: 0.9rem; font-family: var(--font-body); font-weight: 600;">pts</span>
            </div>
          </div>
          <div style="text-align: right; font-size: 0.78rem; color: var(--chalk-dim);">
            Próximo premio: <br><strong style="color: var(--chalk-white);">${this.nextLocalRewardCost()} pts</strong>
          </div>
        </div>

        <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden; margin-bottom: 6px;">
          <div style="width: ${progressPct}%; height: 100%; background: linear-gradient(90deg, #ECC94B, #48BB78); border-radius: 6px; transition: width 0.5s;"></div>
        </div>
        <div style="font-size: 0.72rem; color: var(--chalk-dim); display: flex; justify-content: space-between;">
          <span>Progreso: ${progressPct}%</span>
          <span>+${pointsPerOrder} pts por pedido y ${Number(config.pointsPerCurrency) || 1} pt por ${'$'}1</span>
        </div>

        <div style="margin-top: 14px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 10px;">
          <div style="font-size: 0.75rem; color: var(--chalk-muted); margin-bottom: 6px; font-weight: 600;">
            Sellos de Visitas: <span style="color:var(--chalk-gold);">${account.stamps} de ${stampsTarget}</span>
          </div>
          <div style="display: flex; gap: 8px;">
            ${Array.from({ length: stampsTarget }).map((_, idx) => `
              <div style="flex: 1; height: 32px; border-radius: 8px; border: 1px dashed ${idx < stampsFilled ? 'var(--chalk-green)' : 'rgba(255,255,255,0.15)'}; background: ${idx < stampsFilled ? 'rgba(72,187,120,0.18)' : 'transparent'}; display: flex; align-items: center; justify-content: center; font-size: 0.95rem;">
                ${idx < stampsFilled ? '✅' : '⚪'}
              </div>
            `).join('')}
          </div>
          <div style="font-size: 0.7rem; color: var(--chalk-dim); margin-top: 6px;">
            ${stampsTarget} sellos = ${escapeHtml((config.visitReward && config.visitReward.title) || 'Café o bebida de bienvenida')}
          </div>
        </div>
      </div>
    `;
  }

  nextLocalRewardCost() {
    const points = (this.card && this.card.account) ? this.card.account.points : 0;
    const next = this.localRewards.find(r => r.pointsCost > points) || this.localRewards[this.localRewards.length - 1];
    return next ? next.pointsCost : 0;
  }

  buildGlobalSection() {
    const c = this.card;
    const g = c.global || { points: 0, visits: 0, restaurantsVisited: 0, level: 'Bronce' };
    const level = c.level || { label: g.level || 'Bronce', perks: [] };
    const badges = (c.customer && c.customer.badges) || [];
    return `
      <div style="background: var(--surface-card); border: 1px solid var(--border-chalk); border-radius: 12px; padding: 14px; margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-size:0.88rem; font-weight:700; color:#fff;">🌐 Club Global de la Red</div>
          <div style="background:#0E1412; color:var(--chalk-gold); font-size:0.72rem; font-weight:800; padding:3px 10px; border-radius:20px; text-transform:uppercase; border:1px solid var(--border-gold);">
            ${escapeHtml(level.label || g.level)}
          </div>
        </div>
        <div style="display:flex; gap:14px; flex-wrap:wrap; font-size:0.8rem; color:var(--chalk-dim); margin-bottom:8px;">
          <span><strong style="color:var(--chalk-white);">${g.points}</strong> pts de red</span>
          <span><strong style="color:var(--chalk-white);">${g.visits}</strong> visitas</span>
          <span><strong style="color:var(--chalk-white);">${g.restaurantsVisited}</strong> locales visitados</span>
        </div>
        ${(level.perks || []).length ? `
          <div style="font-size:0.75rem; color:var(--chalk-gold); display:flex; flex-direction:column; gap:3px; margin-bottom:8px;">
            ${level.perks.map(p => `<span>✨ ${escapeHtml(p)}</span>`).join('')}
          </div>
        ` : ''}
        ${badges.length ? `
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
            ${badges.map(b => `<span style="background:rgba(236,201,75,0.12); border:1px solid rgba(236,201,75,0.3); color:var(--chalk-gold); border-radius:20px; padding:2px 10px; font-size:0.72rem; font-weight:700;">${escapeHtml(b.label)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  buildRewards() {
    const c = this.card;
    const localPoints = (c.account && c.account.points) || 0;
    const globalPoints = (c.global && c.global.points) || 0;

    const localRewardsHtml = this.localRewards.map(r => this.rewardRow(r, r.pointsCost, localPoints, 'local')).join('');
    const globalRewards = (c.availableGlobalRewards || []);
    const globalRewardsHtml = globalRewards.map(r => this.rewardRow(r, r.pointsCost, globalPoints, 'global', r.canAfford)).join('');

    return `
      <div style="margin-bottom: 14px;">
        <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-bottom: 8px;">🎁 Beneficios de este local</div>
        ${localRewardsHtml || '<div style="font-size:0.78rem; color:var(--chalk-dim);">Sin catálogo configurado todavía.</div>'}
        ${globalRewards.length ? `
          <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin: 12px 0 8px;">🌐 Beneficios de la red (canjeables en cualquier local)</div>
          ${globalRewardsHtml}
          <div style="font-size:0.72rem; color:var(--chalk-dim); margin-top:4px;">
            Subí de nivel con más visitas: Plata (5), Oro (15), Platino (30).
          </div>
        ` : ''}
      </div>
    `;
  }

  rewardRow(reward, cost, points, scope, canAffordOverride) {
    const canAfford = canAffordOverride !== undefined ? canAffordOverride : points >= cost;
    const isRedeeming = this.redeemingId === reward.id;
    const remaining = Math.max(0, cost - points);
    return `
      <div style="background: var(--surface-card); border: 1px solid ${canAfford ? 'var(--border-gold)' : 'var(--border-chalk)'}; border-radius: 10px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px;">
        <div>
          <div style="font-size: 0.88rem; font-weight: 700; color: #fff;">${escapeHtml(reward.title)}</div>
          <div style="font-size: 0.75rem; color: var(--chalk-gold); font-family: var(--font-mono);">
            Costo: ${cost} pts${reward.minLevel ? ` · requiere nivel ${escapeHtml(reward.minLevel)}` : ''}
          </div>
        </div>
        <div>
          ${canAfford ? `
            <button type="button" class="btn-nav btn-nav-gold" data-js-click="activeLoyaltyModal.redeemReward|${escapeHtml(reward.id)}"
                    style="font-size: 11px; padding: 4px 10px;" ${isRedeeming ? 'disabled' : ''}>
              ${isRedeeming ? 'Canjeando…' : 'Canjear 🎁'}
            </button>
          ` : `
            <span style="font-size: 0.72rem; color: var(--chalk-dim);">Faltan ${remaining} pts</span>
          `}
        </div>
      </div>
    `;
  }

  buildDangerZone() {
    return `
      <div style="border-top: 1px solid var(--border-chalk); padding-top: 10px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <span style="font-size:0.7rem; color:var(--chalk-dim);">¿Querés dejar de participar?</span>
        <button type="button" class="btn-nav" data-js-click="activeLoyaltyModal.eraseMyData"
                style="font-size:10px; padding:4px 10px; border-color:#E53E3E; color:#F87171;">
          🗑️ Borrar mis datos del Club
        </button>
      </div>
    `;
  }
}