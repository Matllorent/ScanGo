// ValidatedInput.js
// Standard input field with inline validation, ARIA accessibility, and visual feedback

export function createValidatedInput({
  id,
  label,
  placeholder = '',
  hint = '',
  type = 'text',
  value = '',
  validate = null,
  onInput = null,
  onChange = null,
  ariaLabel = ''
}) {
  const container = document.createElement('div');
  container.className = 'form-group component-validated-input';

  const labelEl = document.createElement('label');
  labelEl.className = 'form-label';
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const inputEl = document.createElement('input');
  inputEl.type = type;
  inputEl.id = id;
  inputEl.className = 'form-input';
  inputEl.placeholder = placeholder;
  inputEl.value = value;
  inputEl.setAttribute('aria-label', ariaLabel || label);
  inputEl.setAttribute('aria-invalid', 'false');

  const errorEl = document.createElement('div');
  errorEl.className = 'input-error-msg';
  errorEl.style.cssText = 'color: #FEB2B2; font-size: 11px; margin-top: 4px; display: none;';
  errorEl.setAttribute('role', 'alert');

  let hintEl = null;
  if (hint) {
    hintEl = document.createElement('div');
    hintEl.className = 'input-hint';
    hintEl.textContent = hint;
  }

  function runValidation(val) {
    if (!validate) return true;
    const error = validate(val);
    if (error) {
      errorEl.textContent = error;
      errorEl.style.display = 'block';
      inputEl.style.borderColor = 'var(--accent-red, #EF4444)';
      inputEl.setAttribute('aria-invalid', 'true');
      return false;
    } else {
      errorEl.style.display = 'none';
      inputEl.style.borderColor = '';
      inputEl.setAttribute('aria-invalid', 'false');
      return true;
    }
  }

  inputEl.addEventListener('input', (e) => {
    runValidation(e.target.value);
    if (onInput) onInput(e.target.value, e);
  });

  inputEl.addEventListener('change', (e) => {
    runValidation(e.target.value);
    if (onChange) onChange(e.target.value, e);
  });

  container.appendChild(inputEl);
  container.appendChild(errorEl);
  if (hintEl) container.appendChild(hintEl);

  return {
    element: container,
    input: inputEl,
    getValue: () => inputEl.value,
    setValue: (val) => {
      inputEl.value = val;
      runValidation(val);
    },
    validate: () => runValidation(inputEl.value)
  };
}
