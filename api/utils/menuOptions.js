const MAX_GROUPS = 50;
const MAX_OPTIONS = 100;
const MAX_ID_LENGTH = 80;
const MAX_NAME_LENGTH = 100;
const MAX_PRICE_DELTA_CENTS = 100000000;
const GROUP_KINDS = ['modifier', 'flavor', 'protein', 'topping', 'side', 'variant', 'bread', 'extra', 'presentation'];
const SELECTION_MODES = ['single', 'multiple', 'quantity', 'quantity_split'];

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
      ...(option.priceCents !== undefined ? { priceCents: boundedInteger(option.priceCents, 0, 0, MAX_PRICE_DELTA_CENTS) } : {}),
      ...(option.unitsIncluded !== undefined ? { unitsIncluded: boundedInteger(option.unitsIncluded, 1, 1, 100) } : {}),
      ...(option.maxQuantity !== undefined ? { maxQuantity: boundedInteger(option.maxQuantity, 1, 1, 100) } : {}),
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

    const kind = GROUP_KINDS.includes(group.kind) ? group.kind : 'modifier';
    const selectionMode = kind === 'presentation'
      ? 'single'
      : (SELECTION_MODES.includes(group.selectionMode) ? group.selectionMode : 'single');
    const required = Boolean(group.required);
    const maxAllowed = selectionMode === 'single'
      ? 1
      : (selectionMode === 'quantity' ? options.length * 100 : (selectionMode === 'quantity_split' ? 100 : options.length));
    const minSelections = boundedInteger(group.minSelections, required ? 1 : 0, 0, maxAllowed);
    const maxSelections = Math.max(
      minSelections,
      boundedInteger(group.maxSelections, maxAllowed, 0, maxAllowed)
    );

    return [{
      id: String(group.id || `group_${index + 1}`).slice(0, MAX_ID_LENGTH),
      name,
      kind,
      selectionMode,
      required,
      minSelections,
      maxSelections,
      active: group.active !== false,
      ...(group.unitsPerSelection !== undefined ? { unitsPerSelection: boundedInteger(group.unitsPerSelection, 1, 1, 100) } : {}),
      options
    }];
  });
}

function inferUnitsPerPack(name = '') {
  const value = String(name).toLowerCase();
  if (/media\s+docena|1\/2\s*docena|\b6\s*(?:unidades|un\.?|empanadas)\b/.test(value)) return 6;
  if (/\bdocena\b|\b12\s*(?:unidades|un\.?|empanadas)\b/.test(value)) return 12;
  if (/\b3\s*(?:unidades|un\.?|empanadas)\b|\btr[ií]o\b/.test(value)) return 3;
  return 1;
}

function resolveLegacyUnitsPerPack(dish) {
  const inferred = inferUnitsPerPack(dish?.name);
  const configured = boundedInteger(dish?.variantsPerItem, 0, 0, 100);
  return !configured || (configured === 1 && inferred > 1) ? inferred : configured;
}

function getDishModifierGroups(dish, restaurantGroups = []) {
  const sharedGroups = Array.isArray(restaurantGroups) ? restaurantGroups : [];
  const assignedGroups = Array.isArray(dish?.modifierGroupIds)
    ? dish.modifierGroupIds.map(id => sharedGroups.find(group => group.id === id)).filter(Boolean)
    : [];
  const embeddedGroups = Array.isArray(dish?.modifierGroups) ? dish.modifierGroups : [];
  const configuredGroups = [...assignedGroups, ...embeddedGroups].filter(group => group.active !== false);
  if (configuredGroups.length) return sanitizeModifierGroups(configuredGroups);

  const legacyGroups = [];
  if (Array.isArray(dish?.proteinOptions) && dish.proteinOptions.length) {
    legacyGroups.push({
      id: `legacy_protein_${dish.id || 'dish'}`,
      name: 'Proteína',
      kind: 'protein',
      selectionMode: 'single',
      required: Boolean(dish.proteinSelectionRequired),
      options: dish.proteinOptions
    });
  }
  if (Array.isArray(dish?.variants) && dish.variants.length) {
    const split = dish.variantSelectionMode === 'quantity_split';
    legacyGroups.push({
      id: `legacy_variants_${dish.id || 'dish'}`,
      name: split ? 'Sabores' : 'Variante',
      kind: split ? 'flavor' : 'variant',
      selectionMode: split ? 'quantity_split' : 'single',
      required: Boolean(dish.variantsRequired),
      unitsPerSelection: split ? resolveLegacyUnitsPerPack(dish) : undefined,
      options: dish.variants
    });
  }
  return sanitizeModifierGroups(legacyGroups);
}

function validateAndPriceOrderLine(dish, submittedChoices = [], restaurantGroups = []) {
  const groups = getDishModifierGroups(dish, restaurantGroups);
  if (groups.filter(group => group.kind === 'presentation').length > 1) {
    return { valid: false, error: 'El plato tiene más de un grupo de presentación configurado.' };
  }
  const selectedGroups = Array.isArray(submittedChoices) ? submittedChoices : [];
  const selectedById = new Map();
  for (const selection of selectedGroups) {
    if (!selection || typeof selection.groupId !== 'string' || selectedById.has(selection.groupId)) {
      return { valid: false, error: 'La selección de opciones no es válida.' };
    }
    selectedById.set(selection.groupId, selection);
  }

  let unitPriceInCents = Math.round((Number(dish.price) || 0) * 100);
  let unitsInPackage = null;
  const resolvedChoices = [];

  for (const group of groups) {
    const submitted = selectedById.get(group.id);
    const selections = Array.isArray(submitted?.selections) ? submitted.selections : [];
    const seenOptions = new Set();
    const resolved = [];
    let selectionCount = 0;

    for (const selection of selections) {
      if (!selection || typeof selection.optionId !== 'string' || seenOptions.has(selection.optionId)) {
        return { valid: false, error: `Las opciones de "${group.name}" no son válidas.` };
      }
      seenOptions.add(selection.optionId);
      const option = group.options.find(candidate => candidate.id === selection.optionId && candidate.active);
      if (!option) return { valid: false, error: `Una opción de "${group.name}" ya no está disponible.` };

      const maxQuantity = option.maxQuantity || 100;
      const requestedQuantity = Number(selection.quantity ?? 1);
      if ((group.selectionMode === 'quantity' || group.selectionMode === 'quantity_split') &&
          (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0 || requestedQuantity > maxQuantity)) {
        return { valid: false, error: `La cantidad de "${option.name}" no es válida.` };
      }
      const quantity = group.selectionMode === 'quantity' || group.selectionMode === 'quantity_split'
        ? requestedQuantity
        : 1;
      if (quantity <= 0) return { valid: false, error: `La cantidad de "${option.name}" debe ser mayor a cero.` };
      selectionCount += group.selectionMode === 'quantity' || group.selectionMode === 'quantity_split' ? quantity : 1;
      resolved.push({ option, quantity });
    }

    if (group.required && resolved.length === 0) {
      return { valid: false, error: `Elegí una opción para "${group.name}".` };
    }
    if (selectionCount < group.minSelections || selectionCount > group.maxSelections) {
      return { valid: false, error: `La selección de "${group.name}" no cumple sus límites.` };
    }

    if (group.kind === 'presentation' && resolved.length) {
      if (resolved.length !== 1) return { valid: false, error: 'Elegí una sola presentación.' };
      const presentation = resolved[0].option;
      if (presentation.priceCents === undefined || presentation.unitsIncluded === undefined) {
        return { valid: false, error: 'La presentación no tiene precio o cantidad configurados.' };
      }
      unitPriceInCents = presentation.priceCents;
      unitsInPackage = presentation.unitsIncluded;
    }

    resolvedChoices.push({
      groupId: group.id,
      groupName: group.name,
      kind: group.kind,
      selectionMode: group.selectionMode,
      selections: resolved.map(({ option, quantity }) => ({
        optionId: option.id,
        name: option.name,
        quantity,
        priceDeltaCents: option.priceDeltaCents,
        ...(option.priceCents !== undefined ? { priceCents: option.priceCents } : {}),
        ...(option.unitsIncluded !== undefined ? { unitsIncluded: option.unitsIncluded } : {})
      }))
    });
  }

  for (const group of groups) {
    if (group.selectionMode !== 'quantity_split') continue;
    const choice = resolvedChoices.find(item => item.groupId === group.id);
    const splitTotal = (choice?.selections || []).reduce((total, selection) => total + selection.quantity, 0);
    const target = unitsInPackage || group.unitsPerSelection || 1;
    if ((group.required || splitTotal > 0) && splitTotal !== target) {
      return { valid: false, error: `Las cantidades de "${group.name}" deben sumar ${target}.` };
    }
  }

  for (const choice of resolvedChoices) {
    if (choice.kind === 'presentation') continue;
    for (const selection of choice.selections) {
      const multiplier = choice.selectionMode === 'quantity' || choice.selectionMode === 'quantity_split'
        ? selection.quantity
        : 1;
      unitPriceInCents += selection.priceDeltaCents * multiplier;
    }
  }

  const unknownGroup = [...selectedById.keys()].some(groupId => !groups.some(group => group.id === groupId));
  if (unknownGroup) return { valid: false, error: 'El plato ya no ofrece una de las opciones seleccionadas.' };

  return { valid: true, unitPriceInCents, unitsInPackage: unitsInPackage || 1, choicesSnapshot: resolvedChoices };
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
  sanitizeDishOptionConfig,
  inferUnitsPerPack,
  resolveLegacyUnitsPerPack,
  getDishModifierGroups,
  validateAndPriceOrderLine
};