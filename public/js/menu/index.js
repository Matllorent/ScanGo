/**
 * public/js/menu/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Barrel export for all decoupled menu subsystems:
 * - smartReviews: Bifurcated 5-star Google review & private feedback
 * - virtualWaiterHeuristics: "El Mozo Virtual" heuristic upsell engine
 * - orderCheckout: WhatsApp message formatting, bill split & Mercado Pago
 * - cartOperations: Modifier groups resolution, deltas & cart calculations
 * - menuModals: Wi-Fi modal, accessibility TTS, push notifications & sharing
 * - eventGuestMode: Event visual themes & table reservations
 * - iceCreamHeuristics: detección de sabores reales de heladería (sin demo)
 * - perfumeryHeuristics: catálogo de perfumería data-driven (sin demo)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export * from './smartReviews.js';
export * from './virtualWaiterHeuristics.js';
export * from './orderCheckout.js';
export * from './cartOperations.js';
export * from './menuModals.js';
export * from './eventGuestMode.js';
export * from './iceCreamHeuristics.js';
export * from './perfumeryHeuristics.js';
