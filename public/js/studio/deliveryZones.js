/**
 * public/js/studio/deliveryZones.js
 * ──────────────────────────────────
 * Módulo ES para la gestión de zonas de delivery en el Studio.
 * Extraído de studio.js (funciones renderDeliveryZones, addDeliveryZone, deleteDeliveryZone).
 *
 * @param {object} restaurant  — referencia al objeto restaurant del estado global
 * @param {Function} escapeHtml  — sanitizador XSS
 * @param {Function} triggerAutoSave  — callback para disparar el guardado automático
 */

/**
 * Renderiza la lista de zonas de delivery en el panel del Studio.
 * @param {object} restaurant
 * @param {Function} escapeHtml
 */
export function renderDeliveryZones(restaurant, escapeHtml) {
  const container = document.getElementById('deliveryZonesList');
  if (!container) return;

  const zones = restaurant.deliveryZones || [];
  const currency = restaurant.currency || '$';

  if (!zones.length) {
    container.innerHTML = '<p style="color:var(--text-dim); font-size:11px;">Sin zonas configuradas.</p>';
    return;
  }

  let html = '';
  zones.forEach((z, idx) => {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-base); padding:6px 10px; border-radius:6px; margin-bottom:6px;">
        <span style="font-size:12px;">${escapeHtml(z.name)}</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-family:var(--font-mono); color:var(--accent-gold); font-size:11px;">${currency} ${z.fee}</span>
          <button class="btn-icon btn-icon-danger" onclick="deleteDeliveryZone(${idx})">🗑️</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

/**
 * Agrega una zona de delivery con prompt al usuario.
 * @param {object} restaurant
 * @param {Function} triggerAutoSave
 * @param {Function} escapeHtml
 */
export function addDeliveryZone(restaurant, triggerAutoSave, escapeHtml) {
  const name = prompt('Nombre de la zona o barrio (Ej: Centro / Pocitos / Periferia):');
  if (!name) return;
  const fee = prompt('Costo de envío:', '60');
  if (!restaurant.deliveryZones) restaurant.deliveryZones = [];
  restaurant.deliveryZones.push({ name, fee: parseFloat(fee) || 0 });
  renderDeliveryZones(restaurant, escapeHtml);
  triggerAutoSave();
}

/**
 * Elimina una zona de delivery por índice.
 * @param {object} restaurant
 * @param {number} idx
 * @param {Function} triggerAutoSave
 * @param {Function} escapeHtml
 */
export function deleteDeliveryZone(restaurant, idx, triggerAutoSave, escapeHtml) {
  if (!Array.isArray(restaurant.deliveryZones)) return;
  restaurant.deliveryZones.splice(idx, 1);
  renderDeliveryZones(restaurant, escapeHtml);
  triggerAutoSave();
}
