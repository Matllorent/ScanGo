/**
 * public/js/admin-gate.js
 * Login del gate 403 de /admin (HTML generado por adminHtmlAuthMiddleware).
 * Extraído de api/index.js para cumplir CSP sin hashes inline: todo script
 * debe ser externo ('self'). El toggle de password lo maneja el binder
 * data-js-* (public/js/dom-bindings.js).
 */
    function togglePass(inputId, btn) {
      const input = document.getElementById(inputId);
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
        btn.title = 'Ocultar contraseña';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
        btn.title = 'Mostrar contraseña';
      }
    }

    const MAX_FAILED_ATTEMPTS = 5;
    const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutos

    const alertBox = document.getElementById('alert-box');
    const submitBtn = document.getElementById('submit-btn');
    const keyInput = document.getElementById('admin-key');
    const totpInput = document.getElementById('admin-totp');

    function checkLockout() {
      const lockUntil = parseInt(localStorage.getItem('scango_admin_lockout_until') || '0', 10);
      const now = Date.now();
      if (lockUntil > now) {
        const remainingMin = Math.ceil((lockUntil - now) / 60000);
        showAlert(`🔒 Acceso bloqueado temporalmente por seguridad. Superaste el límite de 5 intentos fallidos consecutivos. Por favor esperá ${remainingMin} minuto(s) antes de volver a intentar.`, 'danger');
        submitBtn.disabled = true;
        keyInput.disabled = true;
        totpInput.disabled = true;
        return true;
      }
      return false;
    }

    function showAlert(msg, type) {
      alertBox.textContent = msg;
      alertBox.className = 'alert-box alert-' + type;
      alertBox.style.display = 'block';
    }

    function recordFailedAttempt() {
      let attempts = parseInt(localStorage.getItem('scango_admin_failed_attempts') || '0', 10) + 1;
      localStorage.setItem('scango_admin_failed_attempts', attempts);
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        localStorage.setItem('scango_admin_lockout_until', Date.now() + LOCKOUT_DURATION_MS);
        checkLockout();
      } else {
        const remaining = MAX_FAILED_ATTEMPTS - attempts;
        showAlert(`Clave incorrecta. Te quedan ${remaining} intento(s) antes del bloqueo temporal.`, 'danger');
      }
    }

    function clearLockout() {
      localStorage.removeItem('scango_admin_failed_attempts');
      localStorage.removeItem('scango_admin_lockout_until');
    }

    // Initial lockout check on mount
    checkLockout();

    document.getElementById('login-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      if (checkLockout()) return;

      const key = keyInput.value.trim();
      const totp = totpInput.value.trim();
      if (!key) {
        showAlert('Por favor ingresá la clave de administración.', 'danger');
        return;
      }
      if (!totp) {
        showAlert('El código 2FA de Google Authenticator es obligatorio para acceder.', 'danger');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Verificando...</span>';

      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, totp })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          recordFailedAttempt();
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Ingresar al Panel</span>';
          return;
        }

        // Success
        clearLockout();
        showAlert('✓ Acceso autorizado exitosamente. Redirigiendo...', 'success');
        submitBtn.innerHTML = '<span>Ingresando...</span>';

        setTimeout(() => {
          window.location.href = '/admin';
        }, 400);
      } catch (err) {
        showAlert('Error de conexión con el servidor. Intentá de nuevo.', 'danger');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Ingresar al Panel</span>';
      }
    });
