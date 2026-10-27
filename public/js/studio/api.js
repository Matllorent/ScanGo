// public/js/studio/api.js
// Helper de fetch autenticado: cookie httpOnly en web (viaja sola) +
// Bearer opaco de dispositivo en app nativa (AuthClient lo inyecta).
// Uso: apiFetch('/api/endpoint', { method: 'POST', body: JSON.stringify(data) })
//
// Errores honestos: el backend responde `{ success:false, error, code }`; el
// mensaje que ve el dueño debe ser ese, no un genérico "HTTP 400". Además se
// adjuntan `status`/`code`/`payload` para que cada módulo pueda distinguir
// 401 (re-login), 403 (sin suscripción), 404 y conflictos (409) sin parsear
// strings.

export async function apiFetch(url, options = {}) {
  const headers = (window.AuthClient
    ? window.AuthClient.getAuthHeaders({ 'Content-Type': 'application/json' })
    : { 'Content-Type': 'application/json' });
  if (options.headers) {
    for (const k of Object.keys(options.headers)) headers[k] = options.headers[k];
  }
  const res = await fetch(url, { credentials: 'include', ...options, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      (payload && (payload.error || payload.message)) || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.code = (payload && payload.code) || '';
    err.payload = payload;
    throw err;
  }
  return payload;
}
