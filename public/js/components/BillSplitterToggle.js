// BillSplitterToggle.js
// Toggle component for enabling or disabling the guest table bill division tool

export function createBillSplitterToggle({
  enabled = true,
  onChange = null
}) {
  const container = document.createElement('div');
  container.className = 'form-group component-bill-splitter-toggle';
  container.style.cssText = 'background: var(--bg-base); padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); margin-top: 14px;';

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

  const info = document.createElement('div');
  info.innerHTML = `
    <strong style="font-size: 12px; color: #fff; display: block;">👥 Calculadora de División de Cuenta en Mesa</strong>
    <div style="font-size: 10px; color: var(--text-dim);">Permite a los comensales calcular cuánto paga cada uno dividiendo el total entre N personas.</div>
  `;

  const toggleLabel = document.createElement('label');
  toggleLabel.style.cssText = 'position: relative; display: inline-block; width: 42px; height: 24px; cursor: pointer;';
  toggleLabel.setAttribute('aria-label', 'Activar o desactivar calculadora de división de cuenta');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'inputAllowBillSplitter';
  checkbox.checked = enabled;
  checkbox.style.cssText = 'opacity: 0; width: 0; height: 0; position: absolute;';

  const slider = document.createElement('span');
  slider.style.cssText = `position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: ${enabled ? '#38A169' : '#2a3a33'}; border-radius: 24px; transition: .3s;`;

  const sliderThumb = document.createElement('span');
  sliderThumb.style.cssText = `position: absolute; height: 18px; width: 18px; left: ${enabled ? '21px' : '3px'}; bottom: 3px; background-color: white; border-radius: 50%; transition: .3s;`;
  slider.appendChild(sliderThumb);

  toggleLabel.appendChild(checkbox);
  toggleLabel.appendChild(slider);
  header.appendChild(info);
  header.appendChild(toggleLabel);
  container.appendChild(header);

  function updateVisuals(isChecked) {
    slider.style.backgroundColor = isChecked ? '#38A169' : '#2a3a33';
    sliderThumb.style.left = isChecked ? '21px' : '3px';
  }

  checkbox.addEventListener('change', () => {
    updateVisuals(checkbox.checked);
    if (onChange) onChange(checkbox.checked);
  });

  return {
    element: container,
    checkbox,
    getValue: () => checkbox.checked,
    setValue: (val) => {
      checkbox.checked = Boolean(val);
      updateVisuals(checkbox.checked);
    }
  };
}
