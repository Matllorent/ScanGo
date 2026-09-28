/**
 * Event Visual Themes Module
 * Detects event mode and returns the appropriate theme class name.
 * 
 * Usage in menu.js:
 *   const { getEventThemeClass } = require('./utils/eventThemes');
 *   const eventThemeClass = getEventThemeClass(restaurantData, urlParams);
 *   if (eventThemeClass) document.body.classList.add(eventThemeClass);
 */
module.exports = {
  // Detecta si estamos en modo evento y devuelve la clase de tema correspondiente
  // Retorna null si no es modo evento, o el nombre de la clase CSS
  getEventThemeClass: function(restaurantData, urlParams) {
    // Si no es businessType events, no aplicar tema de evento
    if (restaurantData.businessType !== 'events') return null;

    // Parámetro URL ?event=wedding|cumple_15|birthday|catering
    if (urlParams && urlParams.event) {
      const eventType = urlParams.event;
      if (eventType === 'cumple_15') return 'theme-cumple15';
      if (eventType === 'birthday') return 'theme-birthday';
      if (eventType === 'catering') return 'theme-catering';
      // Default: wedding
      return 'theme-wedding';
    }

    // Si es businessType='events' pero no hay parámetro URL, usar wedding por defecto
    return 'theme-wedding';
  },

  // Obtiene el tipo de evento detectado (para depuración o display)
  getEventType: function(restaurantData, urlParams) {
    if (restaurantData.businessType !== 'events') return null;

    if (urlParams && urlParams.event) {
      const eventType = urlParams.event;
      if (eventType === 'cumple_15' || eventType === 'birthday' || eventType === 'catering') {
        return eventType;
      }
    }
    return 'wedding'; // default
  }
};