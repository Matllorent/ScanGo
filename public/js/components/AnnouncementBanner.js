// AnnouncementBanner.js
// Component for configuring and previewing the daily menu announcement banner

export function createAnnouncementBanner({
  initialText = '',
  onChange = null
}) {
  const container = document.createElement('div');
  container.className = 'form-group component-announcement-banner';
  container.style.marginTop = '14px';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.innerHTML = '📢 Cartel de Anuncio del Día <span style="font-size:10px; color:var(--text-dim); font-weight:normal;">(Banner Superior en el Menú)</span>';
  label.htmlFor = 'inputAnnouncement';
  container.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'inputAnnouncement';
  input.className = 'form-input';
  input.placeholder = 'Ej: ¡Hoy 2x1 en Cervezas Artesanales de 19 a 21 hs! 🍻';
  input.value = initialText;
  input.setAttribute('aria-label', 'Texto del cartel de anuncio superior');
  input.maxLength = 300;
  container.appendChild(input);

  const previewBox = document.createElement('div');
  previewBox.style.cssText = 'margin-top: 8px; padding: 8px 12px; background: linear-gradient(90deg, rgba(236,201,75,0.15), rgba(246,173,85,0.15)); border: 1px dashed var(--accent-gold); border-radius: 6px; font-size: 11px; display: flex; align-items: center; gap: 8px; transition: all .2s ease;';
  
  const previewIcon = document.createElement('span');
  previewIcon.textContent = '📢';
  const previewText = document.createElement('span');
  previewText.style.cssText = 'color: var(--accent-gold); font-weight: 600; flex: 1;';
  previewText.textContent = initialText || 'Vista previa del anuncio (ingresa texto arriba)';

  previewBox.appendChild(previewIcon);
  previewBox.appendChild(previewText);
  container.appendChild(previewBox);

  const hint = document.createElement('div');
  hint.className = 'input-hint';
  hint.textContent = 'Aparecerá destacado en la parte superior de la carta para todos tus clientes. Déjalo vacío para ocultarlo.';
  container.appendChild(hint);

  function updatePreview(val) {
    if (val && val.trim()) {
      previewText.textContent = val.trim();
      previewBox.style.opacity = '1';
    } else {
      previewText.textContent = 'Sin anuncio activo (banner oculto en la carta)';
      previewBox.style.opacity = '0.5';
    }
  }

  updatePreview(initialText);

  input.addEventListener('input', (e) => {
    updatePreview(e.target.value);
    if (onChange) onChange(e.target.value);
  });

  return {
    element: container,
    input,
    getValue: () => input.value.trim(),
    setValue: (val) => {
      input.value = val || '';
      updatePreview(val || '');
    }
  };
}
