/**
 * api/middleware/htmlAuth.js
 * ──────────────────────────
 * Guards de las vistas HTML en dev (studio/admin): redirigen sin sesión y
 * sirven el gate 403 del admin. En Vercel, vercel.json sirve los estáticos
 * sin pasar por acá; la seguridad real está en las APIs. Extraído de
 * api/index.js sin cambios.
 */
const jwt = require('jsonwebtoken');
const { normalizeDemoType } = require('../utils/demoRestaurants');
const {
  JWT_SECRET,
  COOKIE_OPTIONS,
  ADMIN_SESSION_IDLE_TIMEOUT_SECONDS
} = require('../utils/adminSession');

// Server-side Auth Guard for Studio HTML View
function studioHtmlAuthMiddleware(req, res, next) {
  // Modo demo (?demo=heladeria): la landing enlaza al Studio sin sesión para
  // probar el editor con datos de ejemplo. En prod vercel.json sirve
  // studio.html estático sin pasar por acá; este bypass es solo para dev.
  // La seguridad real está en POST /api/studio/save (exige sesión).
  if (normalizeDemoType(req.query.demo)) return next();
  // Solo cookie httpOnly o Bearer en memoria. El token por ?query= quedaba en
  // logs de Vercel/proxy, historial y Referer: se elimina esa vía.
  const token = req.cookies?.auth_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);

  if (!token) {
    return res.redirect('/?auth=required');
  }
  try {
    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch (e) {
    res.clearCookie('auth_token');
    return res.redirect('/?auth=expired');
  }
}

// Server-side Auth Guard for Admin HTML View
function adminHtmlAuthMiddleware(req, res, next) {
  const token = req.cookies?.admin_token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      if (decoded?.role !== 'admin_master') throw new Error('Invalid admin session');
      const renewedToken = jwt.sign(
        { role: 'admin_master', timestamp: decoded.timestamp || Date.now() },
        JWT_SECRET,
        { expiresIn: ADMIN_SESSION_IDLE_TIMEOUT_SECONDS }
      );
      res.cookie('admin_token', renewedToken, COOKIE_OPTIONS);
      return next();
    } catch (e) {}
  }

  return res.status(403).send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>403 — Acceso Restringido • ScanGo</title>
  <link rel="icon" type="image/png" href="/logo-scango.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d1312;
      --card-bg: #151f1c;
      --card-border: #23352f;
      --text: #f0f3f2;
      --text-muted: #8ca39b;
      --gold: #e5a93b;
      --gold-hover: #c9902b;
      --danger: #ef4444;
      --danger-bg: rgba(239, 68, 68, 0.12);
      --accent: #22c55e;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Montserrat', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: radial-gradient(circle at top, #172421 0%, var(--bg) 70%);
      color: var(--text);
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      padding: 2.5rem;
      border-radius: 16px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6);
      text-align: center;
      border: 1px solid var(--card-border);
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, transparent, var(--gold), transparent);
    }
    .brand-logo {
      height: 48px;
      width: auto;
      margin-bottom: 1.25rem;
      border-radius: 8px;
      object-fit: contain;
    }
    .status-badge {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--gold);
      background: rgba(229, 169, 59, 0.12);
      border: 1px solid rgba(229, 169, 59, 0.3);
      padding: 4px 10px;
      border-radius: 20px;
      margin-bottom: 0.85rem;
      text-transform: uppercase;
    }
    h2 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 0.5rem;
    }
    p {
      font-size: 0.85rem;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 1.75rem;
    }
    .form-group {
      text-align: left;
      margin-bottom: 1.25rem;
    }
    .form-group label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 0.4rem;
    }
    .input-wrapper {
      position: relative;
    }
    input {
      width: 100%;
      padding: 0.8rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--card-border);
      background: #0d1312;
      color: #fff;
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: all 0.2s ease;
    }
    input:focus {
      border-color: var(--gold);
      box-shadow: 0 0 0 3px rgba(229, 169, 59, 0.15);
    }
    input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .alert-box {
      display: none;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.82rem;
      line-height: 1.4;
      margin-bottom: 1.25rem;
      text-align: left;
    }
    .alert-danger {
      background: var(--danger-bg);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #fca5a5;
    }
    .alert-success {
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.35);
      color: #86efac;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .input-wrapper input {
      width: 100%;
      padding-right: 42px;
    }
    .toggle-eye-btn {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: none !important;
      border: none !important;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      font-size: 1.1rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: auto !important;
      line-height: 1;
    }
    .toggle-eye-btn:hover {
      color: #fff;
    }
    button {
      width: 100%;
      padding: 0.85rem;
      border-radius: 8px;
      border: none;
      background: var(--gold);
      color: #0d1312;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }
    button:hover:not(:disabled) {
      background: var(--gold-hover);
      transform: translateY(-1px);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .footer-link {
      margin-top: 1.5rem;
      font-size: 0.8rem;
    }
    .footer-link a {
      color: var(--text-muted);
      text-decoration: none;
      transition: color 0.2s;
    }
    .footer-link a:hover {
      color: var(--gold);
    }
  </style>
</head>
<body>
  <div class="card">
    <img src="/logo-scango.png" alt="ScanGo" class="brand-logo" data-js-error-style-display="none">
    <div><span class="status-badge">403 • ACCESO RESTRINGIDO</span></div>
    <h2>Acceso Maestro ScanGo</h2>
    <p>Ingresá la clave maestra configurada en el servidor (ADMIN_KEY) para acceder al panel de administración.</p>

    <div id="alert-box" class="alert-box"></div>

    <form id="login-form">
      <div class="form-group">
        <label for="admin-key">Clave de Administración</label>
        <div class="input-wrapper">
          <input type="password" id="admin-key" placeholder="••••••••••••••••" autocomplete="current-password" autofocus required />
          <button type="button" class="toggle-eye-btn" data-js-click="togglePass|admin-key|this" aria-label="Alternar visibilidad de contraseña" title="Mostrar/ocultar contraseña">👁️</button>
        </div>
      </div>
      <div class="form-group">
        <label for="admin-totp" style="display:flex; justify-content:space-between;">
          <span>Código 2FA (Google Auth)</span>
          <span style="font-weight:600; font-size:0.75rem; color:#ef4444;">(Obligatorio)</span>
        </label>
        <div class="input-wrapper">
          <input type="text" id="admin-totp" placeholder="Ej: 123456" maxlength="6" inputmode="numeric" required style="letter-spacing: 2px; font-family: monospace;" />
        </div>
      </div>
      <button type="submit" id="submit-btn">
        <span>Ingresar al Panel</span>
      </button>
    </form>

    <div class="footer-link">
      <a href="/">&larr; Volver al sitio principal</a>
    </div>
  </div>

  <script src="/js/dom-bindings.js"></script>
  <script src="/js/admin-gate.js"></script>
</body>
</html>`);
}

module.exports = { studioHtmlAuthMiddleware, adminHtmlAuthMiddleware };
