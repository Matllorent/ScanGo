const MAX_GROUPS = 50;
const MAX_OPTIONS = 100;
const MAX_ID_LENGTH = 80;
const MAX_NAME_LENGTH = 100;
const MAX_PRICE_DELTA_CENTS = 100000000;
const GROUP_KINDS = ['modifier', 'flavor', 'protein', 'topping', 'side', 'variant'];
const SELECTION_MODES = ['single', 'multiple', 'quantity_split'];

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function sanitizeMenuOptions(options) {
  if (!Array.isArray(options)) return [];

  return options.slice(0, MAX_OPTIONS).flatMap((option, index) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return [];

    const name = String(option.name || '').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) return [];

    return [{
      id: String(option.id || `option_${index + 1}`).slice(0, MAX_ID_LENGTH),
      name,
      priceDeltaCents: boundedInteger(option.priceDeltaCents, 0, 0, MAX_PRICE_DELTA_CENTS),
      active: option.active !== false
    }];
  });
}

function sanitizeModifierGroups(groups) {
  if (!Array.isArray(groups)) return [];

  return groups.slice(0, MAX_GROUPS).flatMap((group, index) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return [];

    const name = String(group.name || '').trim().slice(0, MAX_NAME_LENGTH);
    const options = sanitizeMenuOptions(group.options);
    if (!name || !options.length) return [];

    const selectionMode = SELECTION_MODES.includes(group.selectionMode) ? group.selectionMode : 'single';
    const required = Boolean(group.required);
    const maxAllowed = selectionMode === 'single' ? 1 : options.length;
    const minSelections = boundedInteger(group.minSelections, required ? 1 : 0, 0, maxAllowed);
    const maxSelections = Math.max(
      minSelections,
      boundedInteger(group.maxSelections, maxAllowed, 0, maxAllowed)
    );

    return [{
      id: String(group.id || `group_${index + 1}`).slice(0, MAX_ID_LENGTH),
      name,
      kind: GROUP_KINDS.includes(group.kind) ? group.kind : 'modifier',
      selectionMode,
      required,
      minSelections,
      maxSelections,
      options
    }];
  });
}

function sanitizeDishOptionConfig(dish) {
  if (!dish || typeof dish !== 'object' || Array.isArray(dish)) return {};

  const config = {
    modifierGroupIds: Array.isArray(dish.modifierGroupIds)
      ? [...new Set(dish.modifierGroupIds.map(id => String(id).slice(0, MAX_ID_LENGTH)))].slice(0, MAX_GROUPS)
      : [],
    variants: sanitizeMenuOptions(dish.variants),
    proteinOptions: sanitizeMenuOptions(dish.proteinOptions)
  };

  config.variantSelectionMode = SELECTION_MODES.includes(dish.variantSelectionMode)
    ? dish.variantSelectionMode
    : 'single';
  config.variantsRequired = Boolean(dish.variantsRequired);
  if (dish.variantsPerItem !== undefined) {
    config.variantsPerItem = boundedInteger(dish.variantsPerItem, 1, 1, 100);
  }

  if (typeof dish.proteinSelectionRequired === 'boolean') {
    config.proteinSelectionRequired = dish.proteinSelectionRequired;
  }
  if (Array.isArray(dish.modifierGroups)) {
    config.modifierGroups = sanitizeModifierGroups(dish.modifierGroups);
  }

  return config;
}

module.exports = {
  sanitizeMenuOptions,
  sanitizeModifierGroups,
  sanitizeDishOptionConfig
};