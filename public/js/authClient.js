/**
 * public/js/authClient.js
 * ───────────────────────
 * Transporte de autenticación único del frontend (script clásico, sin imports,
 * para que lo usen tanto módulos ES como scripts clásicos):
 *
 * - Navegador web: sesión 100% por cookie `auth_token` (httpOnly). NUNCA se
 *   guarda ni se envía ningún token desde JS: `fetch` same-origin ya manda
 *   la cookie (se fuerza `credentials: 'include'` por las dudas).
 * - App nativa (Capacitor, otro origen): la cookie SameSite=Lax no viaja, así
 *   que usa la credencial opaca de dispositivo (`scango_device_token`,
 *   emitida por POST /api/auth/device, revocable) como Bearer.
 *
 * Uso: `AuthClient.authFetch(url, options)` en vez de `fetch` directo.
 * Expone además `isNativeApp()` para que el login elija cookie vs device.
 */
(function () {
  'use strict';

  var DEVICE_TOKEN_KEY = 'scango_device_token';

  function isNativeApp() {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
        ? window.Capacitor.isNativePlatform()
        : window.Capacitor);
    } catch (e) {
      return false;
    }
  }

  function getDeviceToken() {
    try {
      return localStorage.getItem(DEVICE_TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setDeviceToken(raw) {
    try {
      if (raw) localStorage.setItem(DEVICE_TOKEN_KEY, raw);
      else localStorage.removeItem(DEVICE_TOKEN_KEY);
    } catch (e) { /* storage bloqueado */ }
  }

  function clearDeviceToken() {
    setDeviceToken('');
  }

  function getAuthHeaders(extraHeaders) {
    var headers = {};
    if (extraHeaders) {
      for (var k in extraHeaders) {
        if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) headers[k] = extraHeaders[k];
      }
    }
    // Solo nativo: Bearer opaco de dispositivo. En web NO se manda nada
    // (la cookie httpOnly viaja sola y ningún token vive en JS).
    if (isNativeApp()) {
      var deviceToken = getDeviceToken();
      if (deviceToken) headers['Authorization'] = 'Bearer ' + deviceToken;
    }
    return headers;
  }

  function authFetch(url, options) {
    var opts = options || {};
    return fetch(url, {
      method: opts.method || 'GET',
      headers: getAuthHeaders(opts.headers),
      body: opts.body,
      credentials: 'include',
      signal: opts.signal
    });
  }

  window.AuthClient = {
    isNativeApp: isNativeApp,
    getDeviceToken: getDeviceToken,
    setDeviceToken: setDeviceToken,
    clearDeviceToken: clearDeviceToken,
    getAuthHeaders: getAuthHeaders,
    authFetch: authFetch
  };
})();
