/**
 * public/js/studio/onboardingChecklist.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Checklist de "puesta en marcha" del Studio (palanca de activación).
 *
 * Un local que termina su carta tiene muchas más chances de convertir a pago.
 * Este módulo convierte el estado REAL del restaurante en un checklist con
 * progreso y pasos accionables, visible arriba de las pestañas hasta que se
 * completa (o hasta que el dueño lo descarta).
 *
 * Diseño:
 *   - `computeOnboardingSteps`/`computeOnboardingProgress` son PURAS (sin DOM,
 *     sin I/O) → se testean con fixtures (tests/test-onboarding-checklist.js).
 *   - El render usa SOLO DOM API + textContent (cero innerHTML con data).
 *   - Los botones "Ir →" usan `data-js-click="onboardGoToStep|<tab>"` (binder
 *     delegado); cero atributos on*= (la CSP tiene script-src-attr 'none').
 */

const DISMISS_KEY = 'scango_onboarding_dismissed';

export const ONBOARDING_DISMISS_KEY = DISMISS_KEY;

/** Un plato "tiene foto" si trae cualquiera de los campos de imagen soportados. */
function dishHasPhoto(dish) {
  return Boolean(dish && (dish.photoUrl || dish.imageUrl || dish.image || dish.photo));
}

/** Rango de horario válido: "HH:MM-HH:MM" (misma forma que consume computeOpenStatus). */
function isValidRange(value) {
  return typeof value === 'string' && /^\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*$/.test(value);
}

/**
 * Deriva los pasos de puesta en marcha desde el estado real del restaurante.
 * Nunca lanza; un restaurante nulo/parcial simplemente devuelve pasos sin hacer.
 */
export function computeOnboardingSteps(restaurant) {
  const r = restaurant || {};
  const categories = Array.isArray(r.categories) ? r.categories : [];
  const dishes = Array.isArray(r.dishes) ? r.dishes : [];
  const phoneDigits = String(r.phone || '').replace(/\D/g, '');
  return [
    {
      id: 'brand',
      label: 'Subí tu logo o una portada',
      hint: 'Le da identidad a tu carta y a la vista previa al compartir.',
      tab: 'local',
      done: Boolean(r.logoUrl || r.bannerUrl)
    },
    {
      id: 'phone',
      label: 'Cargá tu WhatsApp de pedidos',
      hint: 'Ahí te llegan los pedidos y las reservas.',
      tab: 'delivery',
      done: phoneDigits.length >= 8
    },
    {
      id: 'categories',
      label: 'Creá tu primera categoría',
      hint: 'Agrupá la carta: entradas, principales, postres…',
      tab: 'dishes',
      done: categories.length >= 1
    },
    {
      id: 'dishes',
      label: 'Cargá al menos 3 platos',
      hint: 'Podés usar las plantillas o tu propia carta.',
      tab: 'dishes',
      done: dishes.length >= 3
    },
    {
      id: 'photos',
      label: 'Sumá una foto a un plato',
      hint: 'Los platos con foto se piden mucho más.',
      tab: 'dishes',
      done: dishes.some(dishHasPhoto)
    },
    {
      id: 'schedule',
      label: 'Definí tu horario de atención',
      hint: 'El menú muestra "Abierto/Cerrado" solo.',
      tab: 'local',
      done: r.scheduleEnabled === true && isValidRange(r.scheduleActiveHours)
    }
  ];
}

export function computeOnboardingProgress(restaurant) {
  const steps = computeOnboardingSteps(restaurant);
  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 100,
    complete: total > 0 && done === total
  };
}

export function isOnboardingDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch (e) {
    return false;
  }
}

export function dismissOnboarding() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch (e) {
    /* almacenamiento no disponible: seguimos ocultando la vista */
  }
  const box = document.getElementById('onboardingChecklist');
  if (box) box.style.display = 'none';
}

// Última referencia del restaurante renderizado, para poder refrescar el
// checklist desde cualquier mutación (agregar plato, subir logo, etc.) sin
// tener que pasar el objeto otra vez.
let lastRestaurant = null;

export function renderOnboardingChecklist(restaurant) {
  if (restaurant) lastRestaurant = restaurant;
  const box = document.getElementById('onboardingChecklist');
  if (!box) return;
  const progress = computeOnboardingProgress(lastRestaurant);
  if (progress.complete || isOnboardingDismissed()) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';

  const count = document.getElementById('onboardingCount');
  if (count) count.textContent = `${progress.done} de ${progress.total}`;
  const percent = document.getElementById('onboardingPercent');
  if (percent) percent.textContent = `${progress.percent}%`;
  const bar = document.getElementById('onboardingBar');
  if (bar) bar.style.width = `${progress.percent}%`;

  const list = document.getElementById('onboardingSteps');
  if (!list) return;
  list.textContent = '';
  progress.steps.forEach((step) => {
    const li = document.createElement('li');
    li.className = `onboarding-step${step.done ? ' done' : ''}`;

    const icon = document.createElement('span');
    icon.className = 'onboarding-step-icon';
    icon.textContent = step.done ? '✓' : '○';
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'onboarding-step-body';
    const title = document.createElement('div');
    title.className = 'onboarding-step-title';
    title.textContent = step.label;
    const hint = document.createElement('div');
    hint.className = 'onboarding-step-hint';
    hint.textContent = step.hint;
    body.appendChild(title);
    body.appendChild(hint);

    li.appendChild(icon);
    li.appendChild(body);

    if (!step.done) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'onboarding-step-go';
      go.textContent = 'Ir →';
      go.setAttribute('data-js-click', `onboardGoToStep|${step.tab}`);
      li.appendChild(go);
    }
    list.appendChild(li);
  });
}

/** Refresca con la última referencia conocida (usado tras mutaciones). */
export function refreshOnboardingChecklist() {
  if (lastRestaurant) renderOnboardingChecklist(lastRestaurant);
}
