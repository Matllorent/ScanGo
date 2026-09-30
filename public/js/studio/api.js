// public/js/studio/api.js
// Helper de fetch con token Bearer desde localStorage 'menu_pizarron_token'.
// Uso: apiFetch('/api/endpoint', { method: 'POST', body: JSON.stringify(data) })

export async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('menu_pizarron_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}