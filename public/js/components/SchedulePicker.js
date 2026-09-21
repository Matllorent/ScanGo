// SchedulePicker.js
// Component for restaurant hours scheduling and active menu availability

export function createSchedulePicker({
  enabled = false,
  activeHours = '11:30-15:30',
  onChange = null
}) {
  const container = document.createElement('div');
  container.className = 'form-group component-schedule-picker';
  container.style.cssText = 'margin-top: 14px; background: var(--bg-base); padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border);';

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';

  const info = document.createElement('div');
  info.innerHTML = `
    <strong style="font-size: 12px; color: #fff; display: block;">⏰ Programar Horario de Disponibilidad</strong>
    <div style="font-size: 10px; color: var(--text-dim);">Activa la carta sólo en una franja horaria (Ej: Menú Ejecutivo, Happy Hour)</div>
  `;

  const toggleLabel = document.createElement('label');
  toggleLabel.style.cssText = 'position: relative; display: inline-block; width: 42px; height: 24px; cursor: pointer;';
  toggleLabel.setAttribute('aria-label', 'Activar o desactivar horario programado');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'inputScheduleEnabled';
  checkbox.checked = enabled;
  checkbox.style.cssText = 'opacity: 0; width: 0; height: 0; position: absolute;';

  const slider = document.createElement('span');
  slider.id = 'sliderSchedule';
  slider.style.cssText = `position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: ${enabled ? '#38A169' : '#2a3a33'}; border-radius: 24px; transition: .3s;`;
  
  const sliderThumb = document.createElement('span');
  sliderThumb.style.cssText = `position: absolute; height: 18px; width: 18px; left: ${enabled ? '21px' : '3px'}; bottom: 3px; background-color: white; border-radius: 50%; transition: .3s;`;
  slider.appendChild(sliderThumb);

  toggleLabel.appendChild(checkbox);
  toggleLabel.appendChild(slider);
  header.appendChild(info);
  header.appendChild(toggleLabel);
  container.appendChild(header);

  const hoursContainer = document.createElement('div');
  hoursContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-top: 8px;';

  const hoursInput = document.createElement('input');
  hoursInput.type = 'text';
  hoursInput.id = 'inputScheduleActiveHours';
  hoursInput.className = 'form-input';
  hoursInput.placeholder = 'Ej: 11:30-15:30';
  hoursInput.value = activeHours;
  hoursInput.style.cssText = 'font-family: var(--font-mono); font-size: 11px; max-width: 160px;';
  hoursInput.setAttribute('aria-label', 'Franja horaria activa (formato HH:MM-HH:MM)');

  const hint = document.createElement('span');
  hint.className = 'input-hint';
  hint.style.cssText = 'margin-top: 0; white-space: nowrap; font-size: 10px;';
  hint.textContent = 'Formato (HH:MM-HH:MM)';

  hoursContainer.appendChild(hoursInput);
  hoursContainer.appendChild(hint);
  container.appendChild(hoursContainer);

  function updateVisuals(isChecked) {
    slider.style.backgroundColor = isChecked ? '#38A169' : '#2a3a33';
    sliderThumb.style.left = isChecked ? '21px' : '3px';
    hoursInput.style.opacity = isChecked ? '1' : '0.5';
  }

  updateVisuals(enabled);

  checkbox.addEventListener('change', () => {
    updateVisuals(checkbox.checked);
    if (onChange) onChange({ enabled: checkbox.checked, hours: hoursInput.value.trim() });
  });

  hoursInput.addEventListener('input', () => {
    if (onChange) onChange({ enabled: checkbox.checked, hours: hoursInput.value.trim() });
  });

  return {
    element: container,
    checkbox,
    hoursInput,
    getValue: () => ({
      enabled: checkbox.checked,
      hours: hoursInput.value.trim()
    }),
    setValue: ({ enabled: isEn, hours = '' }) => {
      checkbox.checked = Boolean(isEn);
      hoursInput.value = hours;
      updateVisuals(checkbox.checked);
    }
  };
}
