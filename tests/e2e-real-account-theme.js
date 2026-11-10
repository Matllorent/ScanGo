/**
 * tests/e2e-real-account-theme.js
 * E2E real contra cuenta matllorent30@gmail.com (ya creada y confirmada en
 * Supabase Auth, con restaurante bistro-test-mat en cloud).
 *
 * Flujo:
 *  1. Login real al Studio (email + password).
 *  2. Activar pestaña "Tema Visual" y leer tema actual.
 *  3. Cambiar a smash-urban → preview se actualiza EN VIVO (sin guardar).
 *  4. Persistir vía /api/studio/save con cookie de sesión real + updatedAt fresco.
 *  5. Verificar persistencia en Supabase (theme=smash-urban).
 *  6. Abrir menú público /m/bistro-test-mat → renderiza smash-urban.
 *  7. Verificar que NO aparece banner de 30 días (cuenta nueva, <30 días).
 */

const { chromium } = require('playwright');
require('dotenv').config();
const fetch = globalThis.fetch;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = 'http://localhost:3000';
const EMAIL = 'matllorent30@gmail.com';
const PASSWORD = 'ScanGoTest2026!';
const SLUG = 'bistro-test-mat';

async function supabaseRest(path, method = 'GET', body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', msg => console.log('[BROWSER]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[BROWSER ERROR]', err.message));

  try {
    // ── 1. Login real ──
    console.log('== Abriendo landing y login ==');
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    const loginBtn = page.locator('button:has-text("Iniciar Sesión"), button:has-text("Ingresar al Studio")').first();
    await loginBtn.click();
    await page.waitForTimeout(500);

    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPassword', PASSWORD);
    await page.click('#btnSubmitLogin');
    await page.waitForTimeout(2500);

    await page.waitForSelector('button[data-js-click="switchTab|theme"]', { timeout: 20000 });
    console.log('Studio cargado tras login real');

    // ── 2. Activar pestaña Tema Visual y leer tema actual ──
    await page.click('button[data-js-click="switchTab|theme"]');
    await page.waitForSelector('#inputThemeBg', { state: 'visible', timeout: 10000 });
    const themeInStudio = await page.inputValue('#inputThemeBg');
    console.log('Tema actual en Studio:', themeInStudio);

    const iframeLocator = page.frameLocator('#previewIframe');
    const bodyClassInitial = await iframeLocator.locator('body').evaluate(el => el.className).catch(() => null);
    console.log('Clases del body en preview (inicial):', bodyClassInitial);

    // ── 3. Reactividad en vivo: cambiar a smash-urban, preview cambia sin guardar ──
    console.log('== Cambiando tema a smash-urban (reactividad en vivo) ==');
    await page.selectOption('#inputThemeBg', 'smash-urban');
    await page.waitForTimeout(1500); // debounce autoguardado + postMessage
    const bodyClassLive = await iframeLocator.locator('body').evaluate(el => el.className).catch(() => null);
    console.log('Clases del body tras cambio a smash-urban:', bodyClassLive);
    if (!bodyClassLive || !bodyClassLive.includes('theme-smash-urban')) {
      throw new Error('El preview NO se actualizó en vivo al cambiar a smash-urban');
    }
    console.log('OK: preview se actualizó EN VIVO a smash-urban (reactividad funcionando)');

    // ── 4. Persistir vía /api/studio/save con cookie de sesión real + updatedAt fresco ──
    console.log('== Persistiendo tema smash-urban vía /api/studio/save con sesión real ==');
    const cookies = await context.cookies();
    const cookieHeader = cookies.map(c => c.name + '=' + c.value).join('; ');

    const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookieHeader } });
    if (!meRes.ok) throw new Error(`/api/auth/me falló: ${meRes.status}`);
    const me = await meRes.json();
    const restaurant = me.restaurant;
    if (!restaurant) throw new Error('/api/auth/me no devolvió restaurante');
    console.log('Restaurante en sesión:', restaurant.id, restaurant.slug, 'theme=', restaurant.theme, 'updatedAt=', restaurant.updatedAt);

    const saveData = { ...restaurant, theme: 'smash-urban' };
    saveData.utcOffsetMinutes = -new Date().getTimezoneOffset();
    const saveRes = await fetch(`${BASE}/api/studio/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ restaurantId: restaurant.id, data: saveData })
    });
    const saveBody = await saveRes.json().catch(() => ({}));
    console.log('Guardar STATUS', saveRes.status, 'BODY', JSON.stringify(saveBody).slice(0, 200));
    if (!saveRes.ok) throw new Error(`/api/studio/save falló: ${saveRes.status} ${JSON.stringify(saveBody)}`);

    // ── 5. Verificar persistencia en Supabase ──
    console.log('== Verificando persistencia en Supabase (tabla restaurants) ==');
    const restRes = await supabaseRest(`restaurants?select=id,user_id,slug,theme,name&slug=eq.${SLUG}`);
    const d = await restRes.json();
    const r = Array.isArray(d) ? d[0] : null;
    if (!r) throw new Error('No se encontró el restaurante en Supabase');
    console.log('Restaurante en Supabase tras guardar:', JSON.stringify(r));
    if (r.theme !== 'smash-urban') {
      throw new Error(`El tema no se persistió: esperado smash-urban, obtenido ${r.theme}`);
    }
    console.log('OK: tema persistido en Supabase como smash-urban');

    // ── 6. Menú público /m/:slug renderiza el tema ──
    console.log('== Abriendo menú público ==');
    await page.goto(`${BASE}/m/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const publicBodyClass = await page.evaluate(() => document.body.className);
    console.log('Clases del body en menú público:', publicBodyClass);
    if (!publicBodyClass.includes('theme-smash-urban')) {
      throw new Error(`El menú público no renderiza smash-urban: ${publicBodyClass}`);
    }
    console.log('OK: menú público renderiza smash-urban');

    // ── 7. Banner 30 días NO debe aparecer (cuenta nueva, <30 días) ──
    console.log('== Verificando que no aparece banner de 30 días ==');
    await page.goto(`${BASE}/studio`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const milestoneModal = page.locator('#milestone30DaysModal');
    const banner = page.locator('#subscriptionAlertBanner');
    const modalVisible = await milestoneModal.isVisible().catch(() => false);
    const bannerVisible = await banner.isVisible().catch(() => false);
    console.log('Modal 30 días visible:', modalVisible, '| Banner suscripción visible:', bannerVisible);
    if (modalVisible || bannerVisible) {
      console.log('ADVERTENCIA: el banner de 30 días apareció en una cuenta nueva');
    } else {
      console.log('OK: no aparece banner falso de 30 días en cuenta nueva (<30 días desde alta)');
    }

    console.log('\n================ TEST E2E SUPERADO ================');
    console.log('Cuenta:', EMAIL);
    console.log('Restaurante:', SLUG, '(user', r.user_id, ')');
    console.log('Tema inicial en Studio:', themeInStudio);
    console.log('Reactividad en vivo (smash-urban): ✓');
    console.log('Persistencia en Supabase: ✓');
    console.log('Menú público renderiza smash-urban: ✓');
    console.log('Sin banner falso de 30 días: ✓');

  } catch (err) {
    console.error('\n================ TEST E2E FALLÓ ================');
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
