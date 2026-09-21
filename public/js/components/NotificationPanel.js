// NotificationPanel.js
// Component for dispatching real-time order status updates via WhatsApp with 1-click

export function createNotificationPanel({
  restaurantName = 'Mi Local'
}) {
  const container = document.createElement('div');
  container.className = 'component-notification-panel';

  const titleBox = document.createElement('div');
  titleBox.style.cssText = 'margin-bottom: 14px; background: var(--bg-surface); padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border);';
  titleBox.innerHTML = `
    <h3 style="font-size: 14px; color: var(--accent-gold); margin-bottom: 4px;">📲 Notificaciones de Pedido por WhatsApp</h3>
    <p style="font-size: 11px; color: var(--text-dim);">Envía al instante el estado del pedido al cliente con mensajes predefinidos y profesionales.</p>
  `;
  container.appendChild(titleBox);

  const inputsGrid = document.createElement('div');
  inputsGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;';

  const phoneGroup = document.createElement('div');
  phoneGroup.className = 'form-group';
  phoneGroup.innerHTML = `
    <label class="form-label">Teléfono del Cliente (con código de país)</label>
    <input type="text" id="notifClientPhone" class="form-input" placeholder="Ej: 59899123456" style="font-family: var(--font-mono); font-size: 11px;">
  `;

  const nameGroup = document.createElement('div');
  nameGroup.className = 'form-group';
  nameGroup.innerHTML = `
    <label class="form-label">Nombre del Cliente</label>
    <input type="text" id="notifClientName" class="form-input" placeholder="Ej: Juan Pérez">
  `;

  inputsGrid.appendChild(phoneGroup);
  inputsGrid.appendChild(nameGroup);
  container.appendChild(inputsGrid);

  const statesGrid = document.createElement('div');
  statesGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px;';

  const states = [
    { id: 'confirmado', label: '✓ Confirmado', color: '#38A169', icon: 'fa-check' },
    { id: 'listo', label: '🍳 Listo en Cocina', color: '#3182CE', icon: 'fa-bell' },
    { id: 'camino', label: '🛵 En Camino', color: '#D69E2E', icon: 'fa-motorcycle' },
    { id: 'demorado', label: '⏳ Con Demora', color: '#E53E3E', icon: 'fa-clock' }
  ];

  states.forEach(st => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-nav';
    btn.style.cssText = `display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px 8px; gap: 6px; border-color: ${st.color}; color: #fff; background: rgba(255,255,255,0.02);`;
    btn.setAttribute('aria-label', `Enviar estado ${st.label} por WhatsApp`);
    btn.innerHTML = `<span style="font-size: 16px;">${st.label.split(' ')[0]}</span><span style="font-size: 11px; font-weight: 600;">${st.label.split(' ').slice(1).join(' ')}</span>`;
    
    btn.onclick = () => {
      const phoneInput = container.querySelector('#notifClientPhone');
      const nameInput = container.querySelector('#notifClientName');
      const phone = phoneInput ? phoneInput.value.replace(/[^0-9]/g, '') : '';
      const name = nameInput ? nameInput.value.trim() : 'Estimado/a';

      if (!phone) {
        alert('Por favor ingresa el número de teléfono del cliente con código de país.');
        return;
      }

      let msg = '';
      if (st.id === 'confirmado') {
        msg = `¡Hola ${name}! 👩‍🍳 Tu pedido en *${restaurantName}* ha sido CONFIRMADO y ya entró a producción en nuestra cocina. ¡Muchas gracias!`;
      } else if (st.id === 'listo') {
        msg = `¡Hola ${name}! 🛎️ Tu pedido en *${restaurantName}* ya está LISTO y empacado para entrega/retiro.`;
      } else if (st.id === 'camino') {
        msg = `¡Hola ${name}! 🛵 Tu pedido de *${restaurantName}* ya va EN CAMINO a tu dirección. ¡Buen provecho!`;
      } else if (st.id === 'demorado') {
        msg = `Hola ${name}, te avisamos que tu pedido en *${restaurantName}* tiene una pequeña demora imprevista. Estamos trabajando para tenerlo lo antes posible. ¡Disculpas y gracias por la paciencia! 🙏`;
      }

      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    };

    statesGrid.appendChild(btn);
  });

  container.appendChild(statesGrid);

  return {
    element: container,
    setRestaurantName: (name) => { restaurantName = name; }
  };
}
