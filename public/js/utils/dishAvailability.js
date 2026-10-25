/**
 * dishAvailability.js — F3 "Agotados con memoria" (oct-2026).
 *
 * Decisión ÚNICA de agotamiento compartida por render (badge/tachado/`+`
 * bloqueado), upsell del Mozo Virtual, recomendaciones y filtros: el flag
 * MANUAL del dueño (`dish.outOfStock`) GANA SIEMPRE y el derivado del server
 * (`dish.soldOutToday`, calculado contra el stock diario en el huso del
 * dueño — F3, El Cierre de la misma serie) solo informa. Un helper en un solo
 * lugar evita que los chequeos de disponibilidad diverjan al crecer la carta.
 */
export function isDishSoldOut(dish) {
  return Boolean(dish && (dish.outOfStock || dish.soldOutToday));
}
