// public/js/studio/state.js
// Única fuente de verdad para estado global del Studio.
// Los módulos importan `state` y leen/escriben directamente state.currentUser / state.restaurant.
// NO hay getters/setters por variable.

export const state = {
  currentUser: null,
  restaurant: null
};