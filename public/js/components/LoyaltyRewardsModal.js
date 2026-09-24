/**
 * LoyaltyRewardsModal.js
 * Tarjeta y modal interactivo de fidelización de clientes ("Club Puntos & Recompensas ScanGo").
 * 
 * Permite a los clientes:
 * - Consultar sus puntos y sellos de visitas
 * - Ver su nivel (Bronce, Plata, Oro)
 * - Ver la barra de progreso hacia el siguiente beneficio
 * - Canjear recompensas directamente vía WhatsApp al restaurante
 */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class LoyaltyRewardsModal {
  constructor(options = {}) {
    this.restaurantName = options.restaurantName || 'ScanGo';
    this.phone = options.phone || '';
    this.points = options.points !== undefined ? options.points : 450;
    this.stamps = options.stamps !== undefined ? options.stamps : 4;
    this.maxStamps = 6;
    this.memberLevel = options.memberLevel || 'Plata VIP';
    
    this.rewards = [
      { id: 'rew_coffee', title: '☕ Café o Bebida de Bienvenida', pointsCost: 150, code: 'CLUB-CAFE150' },
      { id: 'rew_dessert', title: '🍰 Postre o Copa Helada Gratis', pointsCost: 300, code: 'CLUB-DESSERT300' },
      { id: 'rew_main', title: '🍽️ 2x1 en Platos Principales', pointsCost: 500, code: 'CLUB-2X1MAIN' },
      { id: 'rew_bottle', title: '🍾 Botella de Vino de la Casa', pointsCost: 750, code: 'CLUB-VINO750' }
    ];

    this.initDOM();
  }

  initDOM() {
    let existing = document.getElementById('loyaltyRewardsModal');
    if (existing) existing.remove();

    const nextReward = this.rewards.find(r => r.pointsCost > this.points) || this.rewards[this.rewards.length - 1];
    const progressPercent = Math.min(100, Math.round((this.points / nextReward.pointsCost) * 100));

    const modal = document.createElement('div');
    modal.id = 'loyaltyRewardsModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box loyalty-modal-box" style="max-width: 500px; padding: 22px; position: relative;">
        <button class="modal-close" id="closeLoyaltyModalBtn">✕</button>

        <h3 class="modal-title" style="display:flex; align-items:center; gap:8px; margin-bottom: 14px;">
          <span>⭐ Club Puntos & Recompensas</span>
        </h3>

        <!-- Tarjeta de Membresía Digital -->
        <div class="loyalty-card-visual" style="background: linear-gradient(135deg, #1C2723, #0F1714); border: 2px solid var(--border-gold); border-radius: 16px; padding: 18px; position: relative; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.5); margin-bottom: 18px;">
          <div style="position: absolute; right: -15px; top: -15px; font-size: 5rem; opacity: 0.08; color: var(--chalk-gold); pointer-events: none;">⭐</div>

          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
            <div>
              <div style="font-size: 0.72rem; text-transform: uppercase; color: var(--chalk-dim); letter-spacing: 0.05em;">Tarjeta de Cliente Frecuente</div>
              <div style="font-family: var(--font-heading); font-size: 1.15rem; color: #fff; font-weight: 700;">${escapeHtml(this.restaurantName)}</div>
            </div>
            <div style="background: var(--chalk-gold); color: #0E1412; font-size: 0.72rem; font-weight: 800; padding: 3px 10px; border-radius: 20px; text-transform: uppercase;">
              ${escapeHtml(this.memberLevel)}
            </div>
          </div>

          <!-- Saldo de Puntos -->
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px;">
            <div>
              <div style="font-size: 0.75rem; color: var(--chalk-muted);">Tus Puntos Acumulados:</div>
              <div style="font-family: var(--font-mono); font-size: 2.1rem; font-weight: 800; color: var(--chalk-gold); line-height: 1;">
                ${this.points} <span style="font-size: 0.9rem; font-family: var(--font-body); font-weight: 600;">pts</span>
              </div>
            </div>
            <div style="text-align: right; font-size: 0.78rem; color: var(--chalk-dim);">
              Próximo premio: <br><strong style="color: var(--chalk-white);">${nextReward.pointsCost} pts</strong>
            </div>
          </div>

          <!-- Barra de Progreso hacia Próximo Premio -->
          <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden; margin-bottom: 6px;">
            <div style="width: ${progressPercent}%; height: 100%; background: linear-gradient(90deg, #ECC94B, #48BB78); border-radius: 6px; transition: width 0.5s;"></div>
          </div>
          <div style="font-size: 0.72rem; color: var(--chalk-dim); display: flex; justify-content: space-between;">
            <span>Progreso: ${progressPercent}%</span>
            <span>Te faltan ${Math.max(0, nextReward.pointsCost - this.points)} pts</span>
          </div>

          <!-- Sellos de Visitas Virtuales -->
          <div style="margin-top: 14px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 10px;">
            <div style="font-size: 0.75rem; color: var(--chalk-muted); margin-bottom: 6px; font-weight: 600;">
              Sellos de Visitas: <span style="color:var(--chalk-gold);">${this.stamps} de ${this.maxStamps}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              ${Array.from({ length: this.maxStamps }).map((_, idx) => `
                <div style="flex: 1; height: 32px; border-radius: 8px; border: 1px dashed ${idx < this.stamps ? 'var(--chalk-green)' : 'rgba(255,255,255,0.15)'}; background: ${idx < this.stamps ? 'rgba(72,187,120,0.18)' : 'transparent'}; display: flex; align-items: center; justify-content: center; font-size: 0.95rem;">
                  ${idx < this.stamps ? '✅' : '⚪'}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Lista de Beneficios y Premios Canjeables -->
        <div style="margin-bottom: 16px;">
          <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-bottom: 8px;">
            🎁 Catálogo de Recompensas Disponibles:
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${this.rewards.map(r => {
              const canRedeem = this.points >= r.pointsCost;
              return `
                <div style="background: var(--surface-card); border: 1px solid ${canRedeem ? 'var(--border-gold)' : 'var(--border-chalk)'}; border-radius: 10px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                  <div>
                    <div style="font-size: 0.88rem; font-weight: 700; color: #fff;">${escapeHtml(r.title)}</div>
                    <div style="font-size: 0.75rem; color: var(--chalk-gold); font-family: var(--font-mono);">
                      Costo: ${r.pointsCost} pts
                    </div>
                  </div>
                  <div>
                    ${canRedeem ? `
                      <button type="button" 
                              class="btn-nav btn-nav-gold" 
                              style="font-size: 11px; padding: 4px 10px;"
                              data-reward-id="${escapeHtml(r.id)}"
                              onclick="window.activeLoyaltyModal.redeemReward(this.dataset.rewardId)">
                        Canjear 🎁
                      </button>
                    ` : `
                      <span style="font-size: 0.72rem; color: var(--chalk-dim);">Faltan ${r.pointsCost - this.points} pts</span>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div style="font-size: 0.75rem; color: var(--chalk-dim); text-align: center; border-top: 1px solid var(--border-chalk); padding-top: 10px;">
          * Acumulás 10 puntos por cada comanda o visita completada a través de ScanGo.
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = document.getElementById('closeLoyaltyModalBtn');
    if (closeBtn) closeBtn.onclick = () => this.close();

    window.activeLoyaltyModal = this;
  }

  redeemReward(rewardId) {
    const rew = this.rewards.find(r => r.id === rewardId);
    if (!rew) return;

    if (this.points < rew.pointsCost) {
      alert('Aún no tienes los puntos necesarios para este premio.');
      return;
    }

    const msg = `⭐ *CANJE DE PUNTOS CLUB SCANGO*\n🏛️ *Restaurante:* ${this.restaurantName}\n🎁 *Premio:* ${rew.title}\n🎟️ *Código Cupón:* [${rew.code}]\n🪙 *Puntos utilizados:* ${rew.pointsCost} pts (Saldo restante: ${this.points - rew.pointsCost} pts)\n\n_Hola, quiero validar este canje con mi comanda!_`;
    
    if (this.phone) {
      const rawPhone = this.phone.replace(/[^0-9]/g, '');
      window.open(`https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`, '_blank');
    } else {
      alert(`¡Premio canjeado con éxito!\nCódigo de validación: ${rew.code}`);
    }

    this.points -= rew.pointsCost;
    this.close();
  }

  open() {
    this.initDOM();
    const modal = document.getElementById('loyaltyRewardsModal');
    if (modal) modal.classList.add('active');
  }

  close() {
    const modal = document.getElementById('loyaltyRewardsModal');
    if (modal) modal.classList.remove('active');
  }
}
