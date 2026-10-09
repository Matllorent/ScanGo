// public/js/studio/api.js
// Helper de fetch autenticado: cookie httpOnly en web (viaja sola) +
// Bearer opaco de dispositivo en app nativa (AuthClient lo inyecta).
// Uso: apiFetch('/api/endpoint', { method: 'POST', body: JSON.stringify(data) })

export async function apiFetch(url, options = {}) {
  const headers = (window.AuthClient
    ? window.AuthClient.getAuthHeaders({ 'Content-Type': 'application/json' })
    : { 'Content-Type': 'application/json' });
  if (options.headers) {
    for (const k of Object.keys(options.headers)) headers[k] = options.headers[k];
  }
  const res = await fetch(url, { credentials: 'include', ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}
