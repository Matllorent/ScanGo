/**
 * public/js/studio/locationField.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Helpers puros para las coordenadas del local (Studio → Mi Local → SEO local).
 * Sin DOM ni red: el navegador aporta la posición y este módulo solo valida,
 * formatea y explica los errores en lenguaje claro.
 */

/**
 * Parsear una coordenada escrita a mano o devuelta por geolocation.
 * Acepta coma decimal ("-34,9053"), valida el rango real del planeta y
 * redondea a 6 decimales (~1 m, la misma precisión del sanitizer del server).
 *
 * @param {*} raw
 * @param {'lat'|'lng'} [kind]
 * @returns {number|null} null = vacío o inválido (0 es un valor VÁLIDO)
 */
export function parseCoordinate(raw, kind = 'lat') {
  if (raw === null || raw === undefined) return null;
  let value = String(raw).trim().replace(/\s+/g, '');
  if (!value) return null;
  if (value.includes(',') && !value.includes('.')) value = value.replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  const limit = kind === 'lng' ? 180 : 90;
  if (!Number.isFinite(number) || number < -limit || number > limit) return null;
  return Math.round(number * 1e6) / 1e6;
}

/**
 * Formatea una coordenada para el input ('' cuando no hay valor válido).
 * @param {*} value
 * @param {'lat'|'lng'} [kind]
 * @returns {string}
 */
export function formatCoordinate(value, kind = 'lat') {
  const parsed = parseCoordinate(value, kind);
  return parsed === null ? '' : String(parsed);
}

/**
 * Mensaje honesto para el dueño según el código de error de geolocation.
 * @param {{code?: number}|*} error
 * @returns {string}
 */
export function describeGeoError(error) {
  const code = error && typeof error === 'object' ? Number(error.code) : 0;
  if (code === 1) {
    return 'Bloqueaste el permiso de ubicación. Habilitalo desde el candado 🔒 de la barra de direcciones y volvé a intentar, o escribí las coordenadas a mano.';
  }
  if (code === 2) {
    return 'No pudimos obtener tu ubicación ahora mismo. Revisá que la ubicación del dispositivo esté encendida o cargá las coordenadas a mano.';
  }
  if (code === 3) {
    return 'La búsqueda de ubicación tardó demasiado. Probá de nuevo o cargá las coordenadas a mano.';
  }
  return 'No pudimos obtener tu ubicación. Probá de nuevo o escribí las coordenadas a mano.';
}

/**
 * Link a Google Maps para verificar el pin. Solo con coordenadas válidas;
 * sin ellas devuelve '' (nunca un link que busque cualquier cosa).
 * @param {*} lat
 * @param {*} lng
 * @returns {string}
 */
export function buildGoogleMapsUrl(lat, lng) {
  const parsedLat = parseCoordinate(lat, 'lat');
  const parsedLng = parseCoordinate(lng, 'lng');
  if (parsedLat === null || parsedLng === null) return '';
  return `https://www.google.com/maps/search/?api=1&query=${parsedLat},${parsedLng}`;
}
