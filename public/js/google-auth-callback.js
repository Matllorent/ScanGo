/**
 * public/js/google-auth-callback.js
 * Página intermedia del callback OAuth de Google (/api/auth/google/callback):
 * extrae el id_token del fragment y completa la sesión.
 * Extraída de api/routes/auth.js para cumplir CSP sin hashes inline.
 */
    (function() {
      // Extract ID token from URL fragment (Google returns it in #id_token=...)
      const fragment = window.location.hash.substring(1);
      const params = new URLSearchParams(fragment);
      const idToken = params.get('id_token');
      
      if (!idToken) {
        // Fallback: check query params (some configurations)
        const searchParams = new URLSearchParams(window.location.search);
        const queryToken = searchParams.get('id_token') || searchParams.get('credential');
        if (queryToken) {
          return completeAuth(queryToken);
        }
        document.body.innerHTML = '<div class="container"><div style="color:#FC8181;">Error: No se recibió token de Google.</div></div>';
        return;
      }
      
      completeAuth(idToken);
      
      async function completeAuth(token) {
        try {
          const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              credential: token,
              restaurantName: '',
              businessType: 'restaurant'
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Error en autenticación');
          
          // Store session (same-origin localStorage: el opener la verá al navegar)
          localStorage.setItem('menu_pizarron_token', data.token);
          localStorage.setItem('menu_pizarron_user', JSON.stringify(data.user));
          localStorage.setItem('menu_pizarron_restaurant', JSON.stringify(data.restaurant));
          // Nota: se eliminó el postMessage GOOGLE_AUTH_SUCCESS a '*' (no tenía
          // receptor en el frontend y filtraba la sesión a cualquier opener
          // ajeno). El flujo activo es GIS One Tap (index.js); esta página es
          // el fallback legacy por redirect.
          window.close();
          window.location.href = '/studio.html';
        } catch (e) {
          document.body.innerHTML = '<div class="container"><div style="color:#FC8181;">Error: ' + e.message + '</div></div>';
        }
      }
    })();
