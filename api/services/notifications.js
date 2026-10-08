const fs = require('fs');
const os = require('os');
const path = require('path');
const { getSupabaseClient } = require('../utils/supabase');
const AppError = require('../utils/AppError');
const webpush = require('web-push');
const db = require('../../src/db/db');
const { signOrderToken } = require('../utils/orderTrackingToken');

/**
 * Normaliza un teléfono a dígitos (E.164 sin +) para poder cruzar la
 * suscripción guest con el pedido que hizo. Devuelve '' si no es plausible.
 */
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

/** Mensajes de estado del pedido (título + cuerpo) para el push al comensal. */
const ORDER_STATUS_PUSH = {
  pending: { title: '📥 Recibimos tu pedido', body: 'Tu pedido entró a la cocina.' },
  confirmed: { title: '✅ Pedido confirmado', body: 'Ya estamos trabajando en tu pedido.' },
  preparing: { title: '👨‍🍳 Preparando tu pedido', body: 'Tu pedido está en marcha.' },
  ready: { title: '🛍️ ¡Tu pedido está listo!', body: 'Pasá a retirarlo cuando quieras.' },
  on_the_way: { title: '🛵 Tu pedido va en camino', body: 'El repartidor salió con tu pedido.' },
  delayed: { title: '⏳ Demora en tu pedido', body: 'La cocina está a full; tu pedido saldrá en breve.' },
  delivered: { title: '🎉 Pedido entregado', body: '¡Buen provecho! Gracias por tu pedido.' },
  cancelled: { title: '❌ Pedido cancelado', body: 'Tu pedido fue cancelado. Cualquier duda, escribinos.' }
};

// In-memory fallback array for local dev mode push subscriptions
const localPushSubscriptions = [];

// Persistencia del centro de notificaciones del dueño (migración 003).
const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'menu-pizarron-saas')
  : path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
const NOTIFICATION_EVENTS_FILE = path.join(DATA_DIR, 'notification_events.json');
const MAX_EVENTS_PER_RESTAURANT = 500;

function readNotificationEvents() {
  if (!fs.existsSync(NOTIFICATION_EVENTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(NOTIFICATION_EVENTS_FILE, 'utf8')); } catch (e) { return []; }
}

async function writeNotificationEvents(rows) {
  return db.writeJson(NOTIFICATION_EVENTS_FILE, rows);
}

function toEventCloudRow(ev) {
  return {
    id: ev.id,
    restaurant_id: ev.restaurantId,
    branch_id: ev.branchId || null,
    type: ev.type,
    title: ev.title,
    body: ev.body,
    data: ev.data || {},
    is_read: Boolean(ev.isRead),
    created_at: ev.createdAt
  };
}

function replicateEvent(rows) {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    supabase.from('notification_events').upsert(rows.map(toEventCloudRow), { onConflict: 'id' })
      .then(() => {}, (e) => console.warn('[Supabase notification_events Upsert Warning]', e.message));
  } catch (e) {
    console.warn('[Supabase notification_events Upsert Warning]', e.message);
  }
}

/**
 * Configuración VAPID leída del entorno en cada uso (permite setear/rotar
 * llaves sin reiniciar y testear el degradado 503 en la misma instancia).
 */
function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || 'mailto:soporte@menu-pizarron.com'
  };
}

/**
 * Elimina una suscripción muerta (el push service respondió 404/410:
 * el navegador la dio de baja o venció).
 */
async function removeSubscription(endpoint) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    } catch (e) {
      console.warn('[Supabase Remove Push Subscription Warning]', e.message);
    }
  }
  const index = localPushSubscriptions.findIndex(s => s.endpoint === endpoint);
  if (index >= 0) localPushSubscriptions.splice(index, 1);
}

/**
 * Entrega real de Web Push (VAPID) a cada suscripción. Las que el push
 * service da de baja (404/410) se eliminan para no intentar de nuevo.
 * @returns {Promise<{checked: number, delivered: number, failed: number, removed: number}>}
 */
async function dispatchToSubscriptions(subscriptions, payload) {
  const config = getVapidConfig();
  if (!config) {
    throw new AppError(
      'Push no configurado: faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en el entorno',
      503,
      'PUSH_NOT_CONFIGURED'
    );
  }
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const body = JSON.stringify(payload);
  let delivered = 0;
  let failed = 0;
  let removed = 0;
  for (const sub of subscriptions) {
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      failed++;
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
      delivered++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await removeSubscription(sub.endpoint);
        removed++;
      } else {
        console.warn('[Push Delivery Failed]', err && err.message ? err.message : err);
        failed++;
      }
    }
  }
  return { checked: subscriptions.length, delivered, failed, removed };
}

const notificationsService = {
  getVapidConfig,

  /**
   * Save a Web Push / FCM subscription token.
   * `role`: 'owner' (dueño; recibe avisos de mesa) o 'guest' (comensal que
   * hizo opt-in explícito y solo recibe promos del local, nunca avisos de mesa).
   */
  async saveSubscription({ userId, restaurantId, endpoint, keys, role = 'owner', consentMarketing = false, customerPhone = '' }) {
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      throw new AppError('Endpoint y llaves (p256dh, auth) son requeridos para la suscripción push', 400, 'INVALID_SUBSCRIPTION_PAYLOAD');
    }
    const normalizedRole = role === 'guest' ? 'guest' : 'owner';

    const subscription = {
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      user_id: userId || null,
      restaurant_id: restaurantId || null,
      endpoint,
      keys,
      role: normalizedRole,
      consent_marketing: normalizedRole === 'guest' ? Boolean(consentMarketing) : true,
      // Teléfono (normalizado) que permite dirigir el aviso de estado del
      // pedido SOLO a quien lo hizo; null en owner/guest sin teléfono.
      customer_phone: normalizedRole === 'guest' ? (normalizePhone(customerPhone) || null) : null,
      created_at: new Date().toISOString()
    };

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase
          .from('push_subscriptions')
          .upsert([subscription], { onConflict: 'endpoint' });
        // Degradación: si la columna customer_phone todavía no existe
        // (migración 004 sin aplicar), guardamos sin ella en vez de perder todo.
        if (error && /customer_phone/i.test(error.message || '')) {
          const { customer_phone, ...legacy } = subscription;
          await supabase.from('push_subscriptions').upsert([legacy], { onConflict: 'endpoint' });
        }
      } catch (e) {
        console.warn('[Supabase Save Push Subscription Warning]', e.message);
      }
    }

    // Keep in local cache
    const existingIndex = localPushSubscriptions.findIndex(s => s.endpoint === endpoint);
    if (existingIndex >= 0) {
      localPushSubscriptions[existingIndex] = subscription;
    } else {
      localPushSubscriptions.push(subscription);
    }

    return subscription;
  },

  /**
   * Lista suscripciones del restaurante (o de un usuario puntual), con filtro
   * opcional por rol: 'owner' | 'guest'.
   */
  async listSubscriptions({ restaurantId, targetUserId, role }) {
    let subscriptions = [];
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        let query = supabase.from('push_subscriptions').select('*');
        if (restaurantId) query = query.eq('restaurant_id', restaurantId);
        if (targetUserId) query = query.eq('user_id', targetUserId);
        if (role) query = query.eq('role', role);
        const { data, error } = await query;
        if (!error && data) subscriptions = data;
      } catch (e) {
        console.warn('[Supabase Get Push Subscriptions Warning]', e.message);
      }
    }

    if (subscriptions.length > 0) {
      // Degradación pre-migración 004: si la tabla cloud todavía no tiene
      // `customer_phone`, lo completamos desde el cache en memoria del proceso
      // (misma suscripción) para no perder el enrutamiento del aviso de pedido.
      subscriptions = subscriptions.map(s => {
        if (s.customer_phone) return s;
        const local = localPushSubscriptions.find(l => l.endpoint === s.endpoint);
        return local && local.customer_phone ? { ...s, customer_phone: local.customer_phone } : s;
      });
    }

    if (subscriptions.length === 0) {
      subscriptions = localPushSubscriptions.filter(s => {
        if (restaurantId && s.restaurant_id !== restaurantId) return false;
        if (targetUserId && s.user_id !== targetUserId) return false;
        if (role) {
          const subRole = s.role || (s.user_id ? 'owner' : 'owner');
          if (subRole !== role) return false;
        }
        return true;
      });
    }
    return subscriptions;
  },

  /**
   * Send a real Web Push to the restaurant's subscribers.
   * `audience`: 'owners' (default; avisos de mesa), 'guests' (promos a
   * comensales con opt-in explícito `role: guest` + consentimiento) o 'all'.
   * @throws AppError 503 PUSH_NOT_CONFIGURED si faltan llaves VAPID
   */
  async sendPromotionalNotification({ title, body, icon, url, restaurantId, targetUserId, audience = 'owners' }) {
    if (!title || !body) {
      throw new AppError('Título y mensaje son requeridos para la notificación', 400, 'MISSING_NOTIFICATION_CONTENT');
    }

    let subscriptions;
    if (audience === 'guests') {
      subscriptions = await this.listSubscriptions({ restaurantId, role: 'guest' });
      // Ley/ética: una promo solo llega a quien dio opt-in explícito.
      subscriptions = subscriptions.filter(s => s.consent_marketing === true);
    } else if (audience === 'all') {
      subscriptions = await this.listSubscriptions({ restaurantId });
    } else {
      subscriptions = await this.listSubscriptions({
        restaurantId,
        targetUserId,
        role: 'owner'
      });
    }

    const payload = {
      title,
      body,
      icon: icon || '/icon-192.png',
      url: url || '/',
      type: audience === 'owners' ? 'waiter_call' : 'promo',
      renotify: true,
      requireInteraction: audience === 'owners',
      timestamp: new Date().toISOString()
    };

    const dispatch = await dispatchToSubscriptions(subscriptions, payload);

    console.log(`[Push Notification Dispatch] ${dispatch.delivered} entregadas, ${dispatch.failed} fallidas, ${dispatch.removed} eliminadas de ${dispatch.checked}`);

    return {
      success: true,
      ...dispatch,
      payload
    };
  },

  /**
   * Avisa al comensal que su pedido cambió de estado. Se dirige SOLO a las
   * suscripciones guest de ese restaurante que dieron consentimiento y cuyo
   * teléfono coincide con el del pedido (nunca a todos los guests). Si no hay
   * ninguna coincidencia devuelve checked:0 sin requerir llaves VAPID.
   */
  async sendOrderStatusNotification({ restaurantId, customerPhone, status, orderId, slug, restaurantName }) {
    const normalized = normalizePhone(customerPhone);
    if (!normalized) {
      return { success: true, checked: 0, delivered: 0, failed: 0, removed: 0, skipped: 'NO_MATCHING_SUBSCRIBERS' };
    }

    const guests = await this.listSubscriptions({ restaurantId, role: 'guest' });
    const targets = guests.filter(s =>
      s.consent_marketing === true && normalizePhone(s.customer_phone) === normalized
    );
    if (targets.length === 0) {
      return { success: true, checked: 0, delivered: 0, failed: 0, removed: 0, skipped: 'NO_MATCHING_SUBSCRIBERS' };
    }

    const meta = ORDER_STATUS_PUSH[status] || ORDER_STATUS_PUSH.pending;
    const token = signOrderToken(orderId);
    const payload = {
      title: meta.title,
      body: meta.body,
      icon: '/icon-192.png',
      url: slug ? `/m/${slug}${token ? `?track=${encodeURIComponent(token)}` : ''}` : '/',
      type: 'order_status',
      // tag por pedido: un estado nuevo reemplaza el anterior del MISMO pedido,
      // sin pisar avisos de otras mesas o promos.
      tag: `order-${orderId}`,
      renotify: true,
      requireInteraction: false,
      data: { orderId, status, restaurantName: restaurantName || '' },
      timestamp: new Date().toISOString()
    };

    const dispatch = await dispatchToSubscriptions(targets, payload);
    return {
      success: true,
      ...dispatch,
      skipped: null,
      payload
    };
  },

  /**
   * Persiste un evento en el centro de notificaciones del dueño (inbox).
   * Fire-and-forget seguro: nunca rompe el flujo que lo disparó.
   */
  async recordNotificationEvent({ restaurantId, branchId = null, type = 'system', title, body, data = {} }) {
    try {
      const rows = readNotificationEvents();
      const ev = {
        id: 'ntf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        restaurantId,
        branchId,
        type,
        title: title || '',
        body: body || '',
        data: data || {},
        isRead: false,
        createdAt: new Date().toISOString()
      };
      rows.unshift(ev);
      // Cap por restaurante: evita que el inbox crezca sin límite.
      const restaurantRows = rows.filter(r => r.restaurantId === restaurantId);
      if (restaurantRows.length > MAX_EVENTS_PER_RESTAURANT) {
        const overflow = new Set(restaurantRows.slice(MAX_EVENTS_PER_RESTAURANT).map(r => r.id));
        const pruned = rows.filter(r => !overflow.has(r.id));
        await writeNotificationEvents(pruned);
      } else {
        await writeNotificationEvents(rows);
      }
      replicateEvent([ev]);
      return ev;
    } catch (e) {
      console.warn('[Notification Event Persist Warning]', e.message);
      return null;
    }
  },

  /** Inbox del dueño: últimos eventos del restaurante, más recientes primero. */
  async listNotificationEvents({ restaurantId, limit = 50 }) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('notification_events')
          .select('id, restaurant_id, branch_id, type, title, body, data, is_read, created_at')
          .eq('restaurant_id', restaurantId)
          .order('created_at', { ascending: false })
          .limit(limit || 50);
        if (!error && data) {
          return data.map(r => ({
            id: r.id,
            restaurantId: r.restaurant_id,
            branchId: r.branch_id,
            type: r.type,
            title: r.title,
            body: r.body,
            data: r.data || {},
            isRead: Boolean(r.is_read),
            createdAt: r.created_at
          }));
        }
      } catch (e) {
        console.warn('[Supabase List Notification Events Warning]', e.message);
      }
    }
    return readNotificationEvents()
      .filter(r => r.restaurantId === restaurantId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit || 50);
  },

  /** Cantidad de eventos sin leer (para el badge del Studio). */
  async unreadNotificationCount(restaurantId) {
    const events = await this.listNotificationEvents({ restaurantId, limit: 500 });
    return events.filter(e => !e.isRead).length;
  },

  /** Marca un evento como leído (solo del propio restaurante). */
  async markNotificationEventRead(id, restaurantId) {
    const events = await this.listNotificationEvents({ restaurantId, limit: 500 });
    const target = events.find(e => e.id === id);
    if (!target) throw new AppError('Evento no encontrado', 404, 'NOTIFICATION_EVENT_NOT_FOUND');
    await this.markNotificationEventReadMany([id], restaurantId, true);
    return { id, isRead: true };
  },

  /** Marca varios eventos (o uno) como leídos en JSON local + nube. */
  async markNotificationEventReadMany(ids, restaurantId, isRead = true) {
    const rows = readNotificationEvents();
    let changed = false;
    for (const row of rows) {
      if (row.restaurantId === restaurantId && ids.includes(row.id) && !row.isRead) {
        row.isRead = isRead;
        changed = true;
      }
    }
    if (changed) await writeNotificationEvents(rows);

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('notification_events')
          .update({ is_read: isRead })
          .in('id', ids)
          .eq('restaurant_id', restaurantId);
      } catch (e) {
        console.warn('[Supabase Mark Notification Read Warning]', e.message);
      }
    }
    return true;
  }
};

module.exports = notificationsService;