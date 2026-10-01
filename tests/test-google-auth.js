const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const app = require('../api/index');

async function runTests() {
  const requests = [];
  const elements = {
    authError: { style: {}, textContent: '' },
    googleLoginBtn: { disabled: false },
    regRestaurant: { value: 'La Cocina de Prueba' },
    regBusinessType: { value: 'restaurant' }
  };
  const localStorage = new Map();
  let googleCallback = null;
  let initializedClientId = '';
  let promptCount = 0;
  let promptListener = null;
  let promptResult;
  let legacyStatusApiCalls = 0;
  const consoleMessages = [];

  const context = {
    document: {
      getElementById: id => elements[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [elements.googleLoginBtn]
    },
    localStorage: {
      setItem: (key, value) => localStorage.set(key, value),
      getItem: key => localStorage.get(key) || null
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === '/api/auth/google/config') {
        return { ok: true, json: async () => ({ clientId: 'test-client.apps.googleusercontent.com' }) };
      }
      return {
        ok: true,
        json: async () => ({
          token: 'session-token',
          user: { email: 'owner@example.com' },
          restaurant: { id: 'rest-test', name: 'La Cocina de Prueba' }
        })
      };
    },
    window: {
      location: { href: '', origin: 'http://localhost:3000', hostname: 'localhost' },
      addEventListener: () => {},
      loadGoogleIdentityServices: async () => {}
    },
    google: {
      accounts: {
        id: {
          initialize: options => {
            initializedClientId = options.client_id;
            googleCallback = options.callback;
          },
          prompt: listener => {
            promptCount += 1;
            promptListener = listener;
            return promptResult;
          }
        }
      }
    },
    console: {
      warn: (...args) => consoleMessages.push(args.join(' ')),
      info: (...args) => consoleMessages.push(args.join(' ')),
      error: (...args) => consoleMessages.push(args.join(' '))
    }
  };

  const clientPath = path.join(__dirname, '../public/js/index.js');
  vm.runInNewContext(fs.readFileSync(clientPath, 'utf8'), context, { filename: clientPath });

  await context.startGoogleSignup();
  assert.notStrictEqual(elements.authError.textContent, 'Google no devolvió una credencial válida. Intentá de nuevo.', 'The CTA must not report a missing credential before opening Google');
  assert.strictEqual(promptCount, 1, 'Clicking the CTA must open Google Identity Services');
  assert.strictEqual(typeof googleCallback, 'function', 'GIS must receive the credential callback');
  assert.strictEqual(requests[0].url, '/api/auth/google/config', 'The client ID must be fetched before initializing GIS');
  assert.strictEqual(initializedClientId, 'test-client.apps.googleusercontent.com', 'GIS must use the configured client ID');
  assert.ok(consoleMessages.some(message => message.includes('http://localhost:3000') && message.includes('Authorized JavaScript origins')), 'Local development should explain the OAuth origin allowlist');

  promptListener({
    isNotDisplayed: () => { legacyStatusApiCalls += 1; return true; },
    getNotDisplayedReason: () => { legacyStatusApiCalls += 1; return 'unregistered_origin'; },
    isSkippedMoment: () => true
  });
  assert.strictEqual(legacyStatusApiCalls, 0, 'FedCM migration must not call unsupported display moment methods');
  assert.ok(elements.authError.textContent.includes('http://localhost:3000'), 'A skipped prompt should show the current origin to authorize');
  assert.ok(elements.authError.textContent.includes('Orígenes de JavaScript autorizados'), 'A skipped prompt should point to Google Cloud OAuth origins');

  await googleCallback({ credential: 'google-id-token' });
  const authRequest = requests.find(request => request.url === '/api/auth/google');
  assert.ok(authRequest, 'The Google ID token must be sent to the backend');
  assert.deepStrictEqual(JSON.parse(authRequest.options.body), {
    credential: 'google-id-token',
    restaurantName: 'La Cocina de Prueba',
    businessType: 'restaurant'
  });
  assert.strictEqual(localStorage.get('menu_pizarron_token'), 'session-token');
  assert.strictEqual(context.window.location.href, '/studio.html');
  assert.strictEqual(elements.authError.textContent, '');

  promptResult = Promise.reject(Object.assign(new Error('The FedCM request was aborted.'), { name: 'AbortError' }));
  await context.startGoogleSignup();
  assert.ok(elements.authError.textContent.includes('http://localhost:3000'), 'An aborted FedCM prompt should recover with actionable guidance');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const configResponse = await fetch(`http://localhost:${port}/api/auth/google/config`);
    const config = await configResponse.json();
    assert.strictEqual(configResponse.status, 200);
    assert.strictEqual(config.clientId, process.env.GOOGLE_CLIENT_ID || '');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }

  console.log('✓ Google CTA: GIS prompt, ID token, API session and redirect validated');
  console.log('✓ Backend OAuth config serves GOOGLE_CLIENT_ID without exposing other secrets');
}

runTests().catch(error => {
  console.error('❌ Error en prueba del cliente OAuth de Google:', error);
  process.exitCode = 1;
});