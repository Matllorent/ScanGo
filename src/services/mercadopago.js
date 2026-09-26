/**
 * Servicio de Integración con Mercado Pago Checkout Pro
 * Soporta credenciales de producción para cobros directos en Latam.
 */

const https = require('https');

function getAccessToken() {
  return process.env.MERCADOPAGO_ACCESS_TOKEN || '';
}

function isConfigured() {
  const token = getAccessToken();
  return Boolean(token && (token.startsWith('APP_USR-') || token.startsWith('TEST-')));
}

/**
 * Crea una preferencia de pago en Mercado Pago Checkout Pro
 * @param {Object} options
 * @param {Array} options.items [{ id, title, quantity, unit_price, currency_id }]
 * @param {Object} [options.payer] { name, email, phone }
 * @param {string} [options.externalReference]
 * @param {Object} [options.backUrls] { success, failure, pending }
 * @param {string} [options.autoReturn] 'approved' | 'all'
 * @param {string} [options.notificationUrl]
 * @returns {Promise<{ id: string, init_point: string, sandbox_init_point: string }>}
 */
async function createPreference(options) {
  const accessToken = getAccessToken();
  if (!accessToken) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN no está configurado en las variables de entorno');
  }

  const payload = {
    items: options.items.map(it => ({
      id: String(it.id || 'item'),
      title: String(it.title || 'Producto').slice(0, 255),
      quantity: Math.max(1, parseInt(it.quantity) || 1),
      unit_price: Math.max(0.01, parseFloat(it.unit_price) || 1),
      currency_id: it.currency_id || 'UYU'
    })),
    payer: options.payer ? {
      name: options.payer.name ? String(options.payer.name).slice(0, 100) : undefined,
      email: options.payer.email ? String(options.payer.email).slice(0, 100) : 'cliente@menupizarron.com'
    } : {
      email: 'cliente@menupizarron.com'
    },
    external_reference: options.externalReference ? String(options.externalReference).slice(0, 255) : `ref_${Date.now()}`,
    statement_descriptor: 'MENU PIZARRON',
    auto_return: options.autoReturn || 'approved',
    back_urls: options.backUrls || {
      success: (process.env.APP_URL || 'http://localhost:3000') + '/?status=mp_success',
      failure: (process.env.APP_URL || 'http://localhost:3000') + '/?status=mp_failure',
      pending: (process.env.APP_URL || 'http://localhost:3000') + '/?status=mp_pending'
    }
  };

  if (options.notificationUrl) {
    payload.notification_url = options.notificationUrl;
  }

  // Use native fetch (Node 18+) or fallback to HTTPS request
  if (typeof fetch === 'function') {
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      const errorMsg = data.message || (data.cause && data.cause[0] && data.cause[0].description) || 'Error al crear preferencia en Mercado Pago';
      console.error('[MercadoPago Error]', data);
      throw new Error(errorMsg);
    }

    return {
      id: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point
    };
  }

  // Fallback via https
  return new Promise((resolve, reject) => {
    const dataString = JSON.stringify(payload);
    const req = https.request('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(dataString)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              id: parsed.id,
              init_point: parsed.init_point,
              sandbox_init_point: parsed.sandbox_init_point
            });
          } else {
            reject(new Error(parsed.message || 'Error en respuesta de Mercado Pago'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(dataString);
    req.end();
  });
}

module.exports = {
  getAccessToken,
  isConfigured,
  createPreference
};
