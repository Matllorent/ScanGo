// DishCard.js
// Standard dish item card component with photo thumbnail, stock badges, and actions

export function createDishCard({
  dish,
  currency = '$',
  categoryName = '',
  onEdit = null,
  onToggleStock = null,
  onDelete = null
}) {
  const card = document.createElement('div');
  card.className = 'dish-card component-dish-card';
  card.id = `dish-card-${dish.id}`;
  card.style.cssText = `display: flex; gap: 12px; align-items: center; background: var(--bg-surface); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 8px; opacity: ${dish.outOfStock ? '0.6' : '1'}; transition: all .2s;`;

  // Photo thumbnail or placeholder
  const photoContainer = document.createElement('div');
  photoContainer.style.cssText = 'width: 54px; height: 54px; border-radius: 6px; overflow: hidden; background: #1a2622; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.08);';

  if (dish.photoUrl) {
    const img = document.createElement('img');
    img.src = dish.photoUrl;
    img.alt = dish.name;
    img.loading = 'lazy';
    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
    img.onerror = () => {
      photoContainer.innerHTML = '<span style="font-size: 20px;">🍽️</span>';
    };
    photoContainer.appendChild(img);
  } else {
    photoContainer.innerHTML = '<span style="font-size: 20px; opacity: 0.5;">🍽️</span>';
  }
  card.appendChild(photoContainer);

  // Dish info
  const info = document.createElement('div');
  info.style.cssText = 'flex: 1; min-width: 0;';

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 2px;';

  const nameEl = document.createElement('strong');
  nameEl.style.cssText = 'font-size: 13px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;';
  nameEl.textContent = dish.name;
  titleRow.appendChild(nameEl);

  if (dish.outOfStock) {
    const stockBadge = document.createElement('span');
    stockBadge.style.cssText = 'font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.2); color: #FCA5A5; font-weight: 700; border: 1px solid rgba(239,68,68,0.3);';
    stockBadge.textContent = 'AGOTADO';
    titleRow.appendChild(stockBadge);
  }

  if (categoryName) {
    const catBadge = document.createElement('span');
    catBadge.style.cssText = 'font-size: 9px; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.06); color: var(--text-dim);';
    catBadge.textContent = categoryName;
    titleRow.appendChild(catBadge);
  }

  info.appendChild(titleRow);

  if (dish.description) {
    const descEl = document.createElement('p');
    descEl.style.cssText = 'font-size: 11px; color: var(--text-dim); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px;';
    descEl.textContent = dish.description;
    info.appendChild(descEl);
  }

  const priceEl = document.createElement('div');
  priceEl.style.cssText = 'font-size: 12px; font-weight: 700; color: var(--accent-gold);';
  priceEl.textContent = `${currency} ${dish.price}`;
  info.appendChild(priceEl);

  card.appendChild(info);

  // Actions
  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 6px; align-items: center; flex-shrink: 0;';

  const btnStock = document.createElement('button');
  btnStock.type = 'button';
  btnStock.className = 'btn-nav';
  btnStock.style.cssText = `padding: 4px 8px; font-size: 11px; ${dish.outOfStock ? 'border-color: #38A169; color: #68D391;' : 'border-color: rgba(239,68,68,0.4); color: #FCA5A5;'}`;
  btnStock.setAttribute('aria-label', dish.outOfStock ? 'Marcar como disponible' : 'Marcar como agotado');
  btnStock.textContent = dish.outOfStock ? '✓ Activar' : '✕ Agotar';
  btnStock.onclick = () => {
    if (onToggleStock) onToggleStock(dish.id, !dish.outOfStock);
  };
  actions.appendChild(btnStock);

  const btnEdit = document.createElement('button');
  btnEdit.type = 'button';
  btnEdit.className = 'btn-nav';
  btnEdit.style.cssText = 'padding: 4px 8px; font-size: 11px;';
  btnEdit.setAttribute('aria-label', `Editar ${dish.name}`);
  btnEdit.textContent = '✏️';
  btnEdit.onclick = () => {
    if (onEdit) onEdit(dish);
  };
  actions.appendChild(btnEdit);

  const btnDel = document.createElement('button');
  btnDel.type = 'button';
  btnDel.className = 'btn-nav btn-icon-danger';
  btnDel.style.cssText = 'padding: 4px 8px; font-size: 11px;';
  btnDel.setAttribute('aria-label', `Eliminar ${dish.name}`);
  btnDel.textContent = '🗑️';
  btnDel.onclick = () => {
    if (onDelete) onDelete(dish.id);
  };
  actions.appendChild(btnDel);

  card.appendChild(actions);

  return {
    element: card,
    dish
  };
}
