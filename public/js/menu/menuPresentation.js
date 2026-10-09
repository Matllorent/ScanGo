/**
 * public/js/menu/menuPresentation.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reglas puras de presentación del menú (sin DOM en import, testeables en Node):
 * - isFreePrice: ¿un precio es "sin costo" (0, ausente o no numérico)?
 * - getDishNoteCopy: etiqueta + placeholder del campo de notas según rubro.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Un plato es "sin costo" cuando su precio es 0 o no tiene valor monetario.
 * @param {*} value Precio crudo del plato
 * @returns {boolean} true → NO se muestra ninguna cifra, solo el botón pedir
 */
export function isFreePrice(value) {
  if (value === null || value === undefined || value === '') return true;
  const num = Number(value);
  if (!Number.isFinite(num)) return true;
  return num === 0;
}

/**
 * Acentos del layout Neon Nightbar (un color por local).
 * El CSS los aplica como `body.layout-neon.neon-<clave>` vía --neon/--neon-rgb.
 */
export const NEON_ACCENTS = {
  mint: { label: 'Menta Eléctrica', hex: '#00F5D4', rgb: '0, 245, 212' },
  cyan: { label: 'Cian Cyber', hex: '#38BDF8', rgb: '56, 189, 248' },
  magenta: { label: 'Magenta Party', hex: '#FF3EA5', rgb: '255, 62, 165' },
  amber: { label: 'Ámbar Whisky', hex: '#FBBF24', rgb: '251, 191, 36' },
  lime: { label: 'Lima Sour', hex: '#A3E635', rgb: '163, 230, 53' },
  violet: { label: 'Violeta Uva', hex: '#A78BFA', rgb: '167, 139, 250' }
};

/**
 * Normaliza el acento neón del restaurante a una clave válida (default mint).
 */
export function resolveNeonAccent(value) {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(NEON_ACCENTS, key) ? key : 'mint';
}

/**
 * Copys del modal de notas por plato según el rubro del negocio.
 * En heladería el ejemplo de cocina ("sin cebolla") no tiene sentido: se
 * reemplaza por uno propio del rubro. Ningún rubro queda sin placeholder útil.
 * @param {object} restaurant { businessType, allowIceCreamWizard }
 * @returns {{ label: string, placeholder: string }}
 */
export function getDishNoteCopy(restaurant = {}) {
  const businessType = String(restaurant.businessType || 'restaurant').toLowerCase();
  const isIceCream = restaurant.allowIceCreamWizard === true || businessType === 'heladeria';

  if (isIceCream) {
    return {
      label: 'Nota para tu helado (opcional)',
      placeholder: 'Ej: sin azúcar, vaso aparte, sin TACC…'
    };
  }
  if (businessType === 'perfumery' || businessType === 'perfumeria') {
    return {
      label: 'Nota del pedido (opcional)',
      placeholder: 'Ej: envolver para regalo…'
    };
  }
  if (businessType === 'events') {
    return {
      label: 'Indicaciones para los anfitriones (opcional)',
      placeholder: 'Ej: soy vegetariano, alergia a frutos secos…'
    };
  }
  return {
    label: 'Nota para cocina (opcional)',
    placeholder: 'Ej: sin cebolla, aderezo aparte...'
  };
}
