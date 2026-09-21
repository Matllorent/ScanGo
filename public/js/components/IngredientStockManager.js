// IngredientStockManager.js
// Quick batch out-of-stock management component based on ingredients or keywords

export function createIngredientStockManager({
  onBatchToggle = null
}) {
  const container = document.createElement('div');
  container.className = 'form-group component-ingredient-stock-manager';
  container.style.cssText = 'background: var(--bg-base); padding: 10px 12px; border-radius: 8px; border: 1px dashed rgba(229, 62, 62, 0.4); margin-bottom: 14px;';

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;';
  header.innerHTML = `
    <span style="color: #FEB2B2; font-size: 11px; font-weight: 700;">⚡ Agotado Inteligente por Ingrediente</span>
    <span style="font-size: 9px; color: var(--text-dim);">Desactiva en masa</span>
  `;
  container.appendChild(header);

  const row = document.createElement('div');
  row.style.cssText = 'display: flex; gap: 6px;';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'inputIngredientKeyword';
  input.className = 'form-input';
  input.placeholder = 'Ej: Salmón, Champiñones, Aguacate...';
  input.style.fontSize = '11px';
  input.setAttribute('aria-label', 'Ingrediente o insumo agotado para desactivación masiva');
  row.appendChild(input);

  const btnOut = document.createElement('button');
  btnOut.type = 'button';
  btnOut.className = 'btn-nav btn-icon-danger';
  btnOut.style.cssText = 'padding: 0 10px; font-size: 11px; white-space: nowrap;';
  btnOut.setAttribute('aria-label', 'Marcar todos los platos con este ingrediente como agotados');
  btnOut.textContent = '✕ Agotar';
  btnOut.onclick = () => {
    const keyword = input.value.trim();
    if (!keyword) {
      alert('Ingresa el nombre del ingrediente o insumo a desactivar');
      return;
    }
    if (onBatchToggle) onBatchToggle(keyword, true);
  };
  row.appendChild(btnOut);

  const btnIn = document.createElement('button');
  btnIn.type = 'button';
  btnIn.className = 'btn-nav';
  btnIn.style.cssText = 'padding: 0 10px; font-size: 11px; white-space: nowrap; border-color: #38A169; color: #68D391;';
  btnIn.setAttribute('aria-label', 'Reactivar todos los platos con este ingrediente');
  btnIn.textContent = '✓ Reactivar';
  btnIn.onclick = () => {
    const keyword = input.value.trim();
    if (!keyword) {
      alert('Ingresa el nombre del ingrediente o insumo a reactivar');
      return;
    }
    if (onBatchToggle) onBatchToggle(keyword, false);
  };
  row.appendChild(btnIn);

  container.appendChild(row);

  const hint = document.createElement('div');
  hint.className = 'input-hint';
  hint.style.cssText = 'color: var(--text-dim); font-size: 9px; margin-top: 4px;';
  hint.textContent = 'Apaga o reactiva al instante todos los platos que contengan esta palabra en su nombre o ingredientes.';
  container.appendChild(hint);

  return {
    element: container,
    input,
    clear: () => { input.value = ''; }
  };
}
