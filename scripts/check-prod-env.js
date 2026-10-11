// scripts/check-prod-env.js
// Valida las variables de entorno requeridas para producción (fail-closed).
// Uso: node scripts/check-prod-env.js [--strict]
//   --strict => exige también las OPCIONALES recomendadas (Sentry, Turnstile, etc.)
// Devuelve exit code 1 si faltan REQUERIDAS (para usarlo en CI/pre-deploy).
const fs = require('fs');
const path = require('path');

// Carga .env si existe (igual que api/index.js)
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].trim();
  }
}

const REQUIRED = [
  // Fail-closed: sin estas, api/index.js NO arranca con NODE_ENV=production
  ['JWT_SECRET', 'Firma de tokens (fail-closed en prod)'],
  ['ADMIN_KEY', 'Clave maestra del panel /admin (fail-closed en prod)'],
  ['ADMIN_TOTP_SECRET', '2FA Google Authenticator (fail-closed en prod)'],
  ['APP_URL', 'Dominio público (CORS allowlist) — en prod debe ser https://<dominio>'],
  // Datos
  ['SUPABASE_URL', 'URL del proyecto Supabase'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Service role key (alias SUPABASE_SERVICE_KEY)'],
  // Email transaccional
  ['RESEND_API_KEY', 'API key Resend'],
  ['EMAIL_FROM', 'Remitente verificado (NO onboarding@resend.dev)'],
  // Push del mozo
  ['VAPID_PUBLIC_KEY', 'Par VAPID (web-push)'],
  ['VAPID_PRIVATE_KEY', 'Par VAPID (web-push)'],
  ['VAPID_SUBJECT', 'mailto: de contacto VAPID'],
  // Cron
  ['CRON_SECRET', 'Autentica Vercel Cron → /api/cron/billing-dunning'],
];

const RECOMMENDED = [
  ['GROUP_CART_SECRET', 'Firma HMAC de QR de mesa (fallback JWT_SECRET)'],
  ['MERCADOPAGO_ACCESS_TOKEN', 'Token MP (necesario para cobrar UY/AR)'],
  ['MERCADOPAGO_WEBHOOK_SECRET', 'Secreto del webhook MP (?secret= en notification_url)'],
  ['LEMONSQUEEZY_API_KEY', 'API key Lemon Squeezy (pasarela global)'],
  ['LEMONSQUEEZY_STORE_ID', 'Store ID Lemon Squeezy'],
  ['LEMONSQUEEZY_WEBHOOK_SECRET', 'Secreto webhook Lemon Squeezy'],
  ['LEMONSQUEEZY_PLAN_MONTHLY_VARIANT_ID', 'Variant del plan monthly'],
  ['LEMONSQUEEZY_PLAN_ANNUAL_VARIANT_ID', 'Variant del plan annual'],
  ['DEFAULT_BILLING_PROVIDER', 'lemonsqueezy (resto del mundo)'],
  ['GOOGLE_CLIENT_ID', 'OAuth Google (login social)'],
  ['GEMINI_API_KEY', 'Importación de cartas con IA'],
  ['SUPABASE_ANON_KEY', 'Realtime en el navegador (pública, protegida por RLS)'],
  ['SENTRY_DSN', 'Monitoreo de errores (recomendado en prod)'],
  ['TURNSTILE_SECRET', 'CAPTCHA invisible del checkout (opcional)'],
  ['TURNSTILE_SITEKEY', 'Sitekey Turnstile (opcional)'],
];

const isSet = v => String(v ?? '').trim().length > 0;
const strict = process.argv.includes('--strict');

console.log('🔍 Checklist de variables de producción\n');

let missingRequired = [];
let missingRecommended = [];

for (const [name, desc] of REQUIRED) {
  if (!isSet(process.env[name])) {
    missingRequired.push(name);
    console.log(`  ❌ REQUERIDA  ${name.padEnd(32)} ${desc}`);
  } else {
    console.log(`  ✅            ${name.padEnd(32)} ${desc}`);
  }
}

for (const [name, desc] of RECOMMENDED) {
  if (!isSet(process.env[name])) {
    missingRecommended.push(name);
    if (strict) console.log(`  ⚠️ RECOMENDADA ${name.padEnd(32)} ${desc}`);
  } else {
    console.log(`  ✅            ${name.padEnd(32)} ${desc}`);
  }
}

// Validaciones semánticas
if (isSet(process.env.EMAIL_FROM) && /@resend\.dev$/.test(process.env.EMAIL_FROM)) {
  console.log(`\n  ⚠️ EMAIL_FROM usa @resend.dev — el plan free solo envía a la cuenta dueña. Verificá el dominio en Resend.`);
}
if (isSet(process.env.APP_URL) && /localhost/i.test(process.env.APP_URL)) {
  console.log(`\n  ⚠️ APP_URL apunta a localhost — en producción debe ser https://<dominio>.`);
}
if (isSet(process.env.JWT_SECRET) && process.env.JWT_SECRET.includes('dev_secret')) {
  console.log(`\n  ⚠️ JWT_SECRET usa el secreto de desarrollo — generá uno nuevo (openssl rand -hex 32).`);
}
const hasGlobalGateway = isSet(process.env.LEMONSQUEEZY_STORE_ID) || isSet(process.env.STRIPE_SECRET_KEY);
if (!hasGlobalGateway) {
  console.log(`\n  ⚠️ No hay pasarela global (Lemon Squeezy/Stripe): clientes fuera de UY/AR recibirán 503 PAYMENT_PROVIDER_NOT_CONFIGURED.`);
}

console.log(`\nResultado:`);
if (missingRequired.length === 0) {
  console.log(`  ✅ Todas las REQUERIDAS presentes. Listo para desplegar.`);
} else {
  console.log(`  ❌ Faltan REQUERIDAS (${missingRequired.length}): ${missingRequired.join(', ')}`);
  process.exitCode = 1;
}
if (missingRecommended.length > 0 && !strict) {
  console.log(`  ℹ️ Faltan RECOMENDADAS (${missingRecommended.length}) — no bloquean el arranque. Ver detalle con --strict.`);
}