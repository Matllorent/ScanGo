const { getSupabaseClient } = require('../utils/supabase');
const logger = require('../utils/logger');
const { retryQueue } = require('../utils/retryQueue');
const crypto = require('crypto');

// Local dev memory cache for telemetry events
const localTelemetryEvents = [];

// Event types extended for branches/events
const EVENT_TYPES = [
  'qr_scan', 'dish_click', 'order_placed', 'waiter_call', 'reservation',
  'visit', 'order', 'waiter',
  'event_qr_scan', 'event_dish_click', 'event_order_placed',
  'loyalty_near_reward',
  // F4: click en el footer viral "Esta carta corre con ScanGo" → /?ref=<slug>.
  // Es un tipo CRUDO (no está en LEGACY_COUNTER_TYPES): se guarda y se puede
  // analizar, pero NUNCA mueve ticket promedio, visitas ni órdenes.
  'scango_cta_click'
];

// Tipos de evento que alimentan cada contador legacy de restaurant.analytics.
// Fuente única de verdad: telemetry_events. Estos contadores son una PROYECCIÓN
// derivada que se recalcula al escribir (nunca se incrementan a mano), así todo
// camino de evento (menú público, /track, QR) cuenta igual.
const LEGACY_COUNTER_TYPES = {
  visits: new Set(['visit', 'qr_scan', 'event_qr_scan']),
  orders: new Set(['order', 'order_placed', 'event_order_placed']),
  reservations: new Set(['reservation']),
  waiterCalls: new Set(['waiter', 'waiter_call'])
};

// Popularidad por plato (sizing del menú): ventana 90 días y throttle de
// refresh de 10 minutos por local (la proyección corre en el camino público
// de eventos; el rate-limit por slug + este throttle acotan el costo extra).
const DISH_POPULARITY_WINDOW_DAYS = 90;
const DISH_POPULARITY_MIN_INTERVAL_MS = 10 * 60 * 1000;

const telemetryService = {
  /**
   * Non-blocking Fire-and-Forget telemetry recording
   * @param {object} options
   * @param {string} options.restaurantId - Restaurant ID or Slug
   * @param {string} options.eventType - Event name (extended with branch/event variants)
   * @param {string} [options.dishId] - Dish ID if dish_click
   * @param {string} [options.branchId] - Branch ID for branch-scoped analytics
   * @param {string} [options.eventId] - Event ID for event-scoped analytics
   * @param {object} [options.metadata] - Extra context (e.g. userAgent, referral)
   */
  // Construye el registro tal como se persiste en telemetry_events (misma
  // forma para el modo fire-and-forget y para el modo sincrónico).
  buildEventRecord({ restaurantId, eventType, dishId, branchId, eventId, metadata }) {
    return {
      // UUID v4: sin colisiones entre réplicas (Date.now()+random podía
      // repetirse en dos instancias de Vercel en el mismo milisegundo).
      id: 'tel_' + crypto.randomUUID(),
      restaurant_id: restaurantId,
      event_type: eventType,
      dish_id: dishId || null,
      branch_id: branchId || null,
      event_id: eventId || null,
      metadata_json: metadata || {},
      created_at: new Date().toISOString()
    };
  },

  // Persiste el evento: nube (si hay cliente) + cache local. Nunca lanza: si la
  // nube falla transitoriamente, el evento queda al menos en local.
  async persistEventRecord(eventRecord) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('telemetry_events').insert([eventRecord]);
      } catch (e) {
        logger.warn('[Telemetry Service Supabase Error]', { error: e.message, eventType: eventRecord.event_type });
      }
    }
    localTelemetryEvents.push(eventRecord);
    if (localTelemetryEvents.length > 5000) localTelemetryEvents.shift();
    return eventRecord;
  },

  recordEvent({ restaurantId, eventType, dishId, branchId, eventId, metadata }) {
    // Execute asynchronously in background without blocking HTTP response
    const eventRecord = this.buildEventRecord({ restaurantId, eventType, dishId, branchId, eventId, metadata });
    retryQueue.enqueue(async () => {
      await this.persistEventRecord(eventRecord);
      logger.info(`[Telemetry Event] ${eventType}`, { restaurantId, branchId, eventId, dishId });
    }, { taskName: `telemetry_${eventType}` });
  },

  /**
   * Versión sincrónica (await) de recordEvent: cuando la promesa resuelve el
   * evento ya está persistido (nube o local), sin carrera con la cola.
   * La usan los caminos que derivan el snapshot legacy de la telemetría.
   */
  async recordEventSync({ restaurantId, eventType, dishId, branchId, eventId, metadata }) {
    const eventRecord = await this.persistEventRecord(
      this.buildEventRecord({ restaurantId, eventType, dishId, branchId, eventId, metadata })
    );
    logger.info(`[Telemetry Event synced] ${eventType}`, { restaurantId, branchId, eventId, dishId });
    return eventRecord;
  },

  /**
   * Cuenta los contadores legacy (visits/orders/reservations/waiterCalls) a
   * partir de los eventos de telemetría del restaurante. Proyección pura: solo
   * lee la fuente de verdad, no incrementa nada. Pide solo `event_type` (es
   * lo único que cuenta): bajo un pico, el full-scan transfiere una fracción.
   */
  async countAnalytics(restaurantId) {
    const events = await this.getEvents(restaurantId, { columns: 'event_type' });
    const counters = { visits: 0, orders: 0, reservations: 0, waiterCalls: 0, lastUpdated: new Date().toISOString() };
    for (const e of events) {
      const type = e.event_type;
      if (LEGACY_COUNTER_TYPES.visits.has(type)) counters.visits++;
      else if (LEGACY_COUNTER_TYPES.orders.has(type)) counters.orders++;
      else if (LEGACY_COUNTER_TYPES.reservations.has(type)) counters.reservations++;
      else if (LEGACY_COUNTER_TYPES.waiterCalls.has(type)) counters.waiterCalls++;
    }
    return counters;
  },

  /**
   * Proyección de popularidad por plato para el sizing del menú
   * (`restaurant.analytics.dishPopularity`). Ventana 90 días, basada en
   * señales reales de la telemetría: clicks de plato (dish_click, 1 por
   * evento) y unidades pedidas (order_placed con metadata.items[].qty).
   * Normaliza contra el plato más clickeado (score 0..1, 2 decimales):
   * el payload público NUNCA ve estas scores, solo el tier 2/1/0 que deriva
   * de ellas (api/utils/popularityTiers.js).
   */
  async computeDishPopularity(restaurantId, { windowDays = DISH_POPULARITY_WINDOW_DAYS } = {}) {
    const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();
    const events = await this.getEvents(restaurantId, {
      since,
      columns: 'event_type,dish_id,metadata_json,created_at'
    });
    const counts = {};
    let samples = 0;
    for (const e of events) {
      if (e.event_type === 'dish_click' && e.dish_id) {
        counts[e.dish_id] = (counts[e.dish_id] || 0) + 1;
        samples += 1;
      } else if (e.event_type === 'order_placed' && Array.isArray(e.metadata_json && e.metadata_json.items)) {
        for (const it of e.metadata_json.items) {
          if (!it || !it.dishId) continue;
          const qty = Math.max(1, Math.min(999, Math.floor(Number(it.qty) || 1)));
          counts[it.dishId] = (counts[it.dishId] || 0) + qty;
          samples += qty;
        }
      }
    }
    const max = Math.max(0, ...Object.values(counts));
    const scores = {};
    if (max > 0) {
      for (const [dishId, count] of Object.entries(counts)) {
        scores[dishId] = Math.round((count / max) * 100) / 100;
      }
    }
    return {
      scores,
      samples,
      windowDays,
      computedAt: new Date().toISOString()
    };
  },

  /**
   * Proyección COMPLETA del snapshot legacy: contadores + (solo para locales
   * que eligieron `menuSizing: 'popularity'`) la proyección de popularidad
   * con throttle de 10 minutos. El resto de locales no paga ni una query
   * extra: `dishPopularity` simplemente no se agrega al snapshot.
   * @param {object} restaurant registro completo del local (lee su snapshot
   *        previo para heredar dishPopularity cuando no corresponde refrescar)
   */
  async projectAnalytics(restaurant) {
    const counters = await this.countAnalytics(restaurant.id);
    const prev = restaurant && restaurant.analytics ? restaurant.analytics.dishPopularity : null;
    const sizingWanted = Boolean(restaurant && restaurant.menuSizing === 'popularity');
    if (!sizingWanted) return counters;
    const stale = !prev || !prev.computedAt ||
      (Date.now() - Date.parse(prev.computedAt)) > DISH_POPULARITY_MIN_INTERVAL_MS;
    const dishPopularity = stale
      ? await this.computeDishPopularity(restaurant.id)
      : prev;
    return { ...counters, dishPopularity };
  },

  /**
   * Get events with optional branch/event filtering.
   * `columns` acota el SELECT (default '*'): la proyección legacy solo
   * necesita `event_type` y así el scan bajo carga transfiere mucho menos.
   */
  async getEvents(restaurantId, { since, branchId, eventId, eventType, columns } = {}) {
    let events = [];
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        let query = supabase
          .from('telemetry_events')
          .select(columns || '*')
          .eq('restaurant_id', restaurantId);
        
        if (since) query = query.gte('created_at', since);
        if (branchId) query = query.eq('branch_id', branchId);
        if (eventId) query = query.eq('event_id', eventId);
        if (eventType) query = query.eq('event_type', eventType);
        
        const { data, error } = await query;
        if (!error && data) events = data;
      } catch (e) {
        logger.warn('[Telemetry Service Get Events Warning]', { details: e.message, restaurantId });
      }
    }

    if (events.length === 0) {
      let filtered = localTelemetryEvents.filter(e => e.restaurant_id === restaurantId);
      if (since) filtered = filtered.filter(e => e.created_at >= since);
      if (branchId) filtered = filtered.filter(e => e.branch_id === branchId);
      if (eventId) filtered = filtered.filter(e => e.event_id === eventId);
      if (eventType) filtered = filtered.filter(e => e.event_type === eventType);
      events = filtered;
    }

    return events;
  },

  /**
   * Weekly metric aggregator for restaurant owners
   * @param {string} restaurantId
   * @returns {Promise<object>} Weekly aggregated telemetry metrics
   */
  async getWeeklyAggregatedMetrics(restaurantId) {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const events = await this.getEvents(restaurantId, { since: oneWeekAgo });

    const qrScans = events.filter(e => e.event_type === 'qr_scan' || e.event_type === 'visit').length;
    const dishClicks = events.filter(e => e.event_type === 'dish_click').length;
    const ordersPlaced = events.filter(e => e.event_type === 'order_placed' || e.event_type === 'order').length;
    const waiterCalls = events.filter(e => e.event_type === 'waiter_call' || e.event_type === 'waiter').length;

    // Aggregate top clicked dishes
    const dishCounts = {};
    events.filter(e => e.event_type === 'dish_click' && e.dish_id).forEach(e => {
      dishCounts[e.dish_id] = (dishCounts[e.dish_id] || 0) + 1;
    });

    // Ticket promedio e ingresos estimados (metadata_json.amount en pedidos)
    const orderEvents = events.filter(e => e.event_type === 'order_placed' || e.event_type === 'order');
    const revenue = orderEvents.reduce((sum, e) => sum + (Number(e.metadata_json?.amount) || 0), 0);
    const avgTicket = ordersPlaced > 0 ? +((revenue / ordersPlaced).toFixed(2)) : 0;

    const topDishes = Object.entries(dishCounts)
      .map(([dishId, clicks]) => ({ dishId, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 5);

    return {
      period: 'last_7_days',
      since: oneWeekAgo,
      metrics: {
        qrScans,
        dishClicks,
        ordersPlaced,
        waiterCalls,
        conversionRatePercent: qrScans > 0 ? +((ordersPlaced / qrScans) * 100).toFixed(1) : 0,
        revenue: +revenue.toFixed(2),
        avgTicket
      },
      topDishes
    };
  },

  /**
   * Daily aggregated metrics for charts (last 30 days)
   * @param {string} restaurantId
   * @returns {Promise<object>} Daily metrics for charts
   */
  async getDailyMetrics(restaurantId, { days = 30, branchId, eventId } = {}) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const events = await this.getEvents(restaurantId, { since, branchId, eventId });

    // Group by day
    const daily = {};
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 3600 * 1000);
      const key = date.toISOString().split('T')[0];
      daily[key] = { date: key, visits: 0, dishClicks: 0, orders: 0, waiterCalls: 0, revenue: 0 };
    }

    events.forEach(e => {
      const dateKey = e.created_at.split('T')[0];
      if (!daily[dateKey]) return;
      
      if (e.event_type === 'qr_scan' || e.event_type === 'visit') daily[dateKey].visits++;
      if (e.event_type === 'dish_click') daily[dateKey].dishClicks++;
      if (e.event_type === 'order_placed' || e.event_type === 'order') daily[dateKey].orders++;
      if (e.event_type === 'waiter_call' || e.event_type === 'waiter') daily[dateKey].waiterCalls++;
      if (e.metadata_json?.amount) daily[dateKey].revenue += Number(e.metadata_json.amount) || 0;
    });

    return Object.values(daily).reverse(); // Oldest first for charts
  },

  /**
   * Resumen de HOY para el dueño: pedidos, plata, ticket promedio, unidades
   * vendidas y platos vendidos (desde los ítems del carrito) — comparados con
   * ayer. El "hoy" se calcula en el día local del dueño usando el offset del
   * navegador (utcOffsetMinutes), para que las 21 hs locales no caigan en
   * "ayer" por la diferencia horaria.
   * @param {string} restaurantId
   * @param {object} [opts] - { utcOffsetMinutes }
   * @returns {Promise<object>} Resumen del día
   */
  async getTodaySummary(restaurantId, { utcOffsetMinutes = 0 } = {}) {
    const offsetMs = (Number(utcOffsetMinutes) || 0) * 60 * 1000;
    const localNow = new Date(Date.now() + offsetMs);
    const localTodayKey = localNow.toISOString().slice(0, 10);
    // Ventana [hoy 00:00, mañana 00:00) en hora del dueño, expresada en UTC
    const dayStartUtc = new Date(Date.parse(`${localTodayKey}T00:00:00.000Z`) - offsetMs);
    const nextDayUtc = new Date(dayStartUtc.getTime() + 24 * 3600 * 1000);

    const todayAll = await this.getEvents(restaurantId, { since: dayStartUtc.toISOString() });
    const todayEvents = todayAll.filter(e => {
      const t = new Date(e.created_at);
      return t >= dayStartUtc && t < nextDayUtc;
    });

    const yesterStart = new Date(dayStartUtc.getTime() - 24 * 3600 * 1000);
    const yesterAll = await this.getEvents(restaurantId, { since: yesterStart.toISOString() });
    const yesterEvents = yesterAll.filter(e => {
      const t = new Date(e.created_at);
      return t >= yesterStart && t < dayStartUtc;
    });

    const summarize = (evs) => {
      const orderEvs = evs.filter(e => e.event_type === 'order_placed' || e.event_type === 'order');
      const orders = orderEvs.length;
      const revenue = +orderEvs.reduce((s, e) => s + (Number(e.metadata_json?.amount) || 0), 0).toFixed(2);
      // Unidades vendidas por plato: los pedidos ahora llevan items [{dishId, qty}]
      const dishCounts = {};
      orderEvs.forEach(e => {
        const items = Array.isArray(e.metadata_json?.items) ? e.metadata_json.items : [];
        items.forEach(it => {
          if (!it || !it.dishId) return;
          const id = String(it.dishId).slice(0, 80);
          const qty = Math.max(1, Math.min(999, Math.floor(Number(it.qty) || 1)));
          dishCounts[id] = (dishCounts[id] || 0) + qty;
        });
      });
      return {
        orders,
        revenue,
        avgTicket: orders > 0 ? +((revenue / orders).toFixed(2)) : 0,
        unitsSold: Object.values(dishCounts).reduce((s, q) => s + q, 0),
        dishCounts
      };
    };

    const today = summarize(todayEvents);
    const yesterday = summarize(yesterEvents);

    const topDishesSold = Object.entries(today.dishCounts)
      .map(([dishId, qty]) => ({ dishId, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    // Platos más vistos HOY: lo que están mirando los comensales ahora
    const viewCounts = {};
    todayEvents.filter(e => e.event_type === 'dish_click' && e.dish_id).forEach(e => {
      viewCounts[e.dish_id] = (viewCounts[e.dish_id] || 0) + 1;
    });
    const topViewed = Object.entries(viewCounts)
      .map(([dishId, views]) => ({ dishId, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);

    // Hoy por sucursal
    const branchMap = {};
    todayEvents.forEach(e => {
      if (!(e.event_type === 'order_placed' || e.event_type === 'order')) return;
      const bid = e.branch_id || 'main';
      if (!branchMap[bid]) branchMap[bid] = { branchId: bid, orders: 0, revenue: 0 };
      branchMap[bid].orders++;
      branchMap[bid].revenue += Number(e.metadata_json?.amount) || 0;
    });
    const byBranch = Object.values(branchMap).map(b => ({
      ...b,
      revenue: +b.revenue.toFixed(2),
      avgTicket: b.orders > 0 ? +((b.revenue / b.orders).toFixed(2)) : 0
    }));

    return {
      date: localTodayKey,
      metrics: {
        orders: today.orders,
        revenue: today.revenue,
        avgTicket: today.avgTicket,
        unitsSold: today.unitsSold
      },
      yesterday: {
        orders: yesterday.orders,
        revenue: yesterday.revenue,
        avgTicket: yesterday.avgTicket
      },
      topDishesSold,
      topViewed,
      byBranch
    };
  },

  /**
   * Hourly heatmap for peak hours analysis
   * La hora/día se calcula en el huso del dueño (utcOffsetMinutes, como /today):
   * antes se usaba getHours()/getDay() del servidor (UTC en Vercel), así un
   * restaurante uruguayo veía sus picos corridos 3 horas. Sin offset → UTC.
   * @param {string} restaurantId
   * @param {object} [opts] - { days, branchId, eventId, utcOffsetMinutes }
   * @returns {Promise<object>} Hourly breakdown
   */
  async getHourlyHeatmap(restaurantId, { days = 7, branchId, eventId, utcOffsetMinutes = 0 } = {}) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const events = await this.getEvents(restaurantId, { since, branchId, eventId });

    // Initialize 24 hours x 7 days matrix
    const heatmap = Array(24).fill(null).map((_, h) => ({
      hour: h,
      label: `${h.toString().padStart(2, '0')}:00`,
      days: Array(7).fill(0).map((_, d) => 0),
      total: 0
    }));

    events.forEach(e => {
      const hour = localHourOf(e.created_at, utcOffsetMinutes);
      const day = localDayOf(e.created_at, utcOffsetMinutes); // 0 = Sunday
      if (hour !== null && heatmap[hour]) {
        heatmap[hour].days[day]++;
        heatmap[hour].total++;
      }
    });

    return heatmap;
  },

  /**
   * Branch comparison metrics
   * @param {string} restaurantId
   * @returns {Promise<object>} Per-branch metrics
   */
  async getBranchMetrics(restaurantId, { days = 30 } = {}) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const events = await this.getEvents(restaurantId, { since });

    // Group by branch
    const branchMap = {};
    events.forEach(e => {
      const branchId = e.branch_id || 'main';
      if (!branchMap[branchId]) {
        branchMap[branchId] = { branchId, visits: 0, dishClicks: 0, orders: 0, waiterCalls: 0, revenue: 0, topDishes: {} };
      }
      const b = branchMap[branchId];
      if (e.event_type === 'qr_scan' || e.event_type === 'visit') b.visits++;
      if (e.event_type === 'dish_click' && e.dish_id) {
        b.dishClicks++;
        b.topDishes[e.dish_id] = (b.topDishes[e.dish_id] || 0) + 1;
      }
      if (e.event_type === 'order_placed' || e.event_type === 'order') {
        b.orders++;
        b.revenue += Number(e.metadata_json?.amount) || 0;
      }
      if (e.event_type === 'waiter_call' || e.event_type === 'waiter') b.waiterCalls++;
    });

    // Convert to array with top dishes
    return Object.values(branchMap).map(b => ({
      ...b,
      revenue: +b.revenue.toFixed(2),
      avgTicket: b.orders > 0 ? +((b.revenue / b.orders).toFixed(2)) : 0,
      topDishes: Object.entries(b.topDishes)
        .map(([dishId, clicks]) => ({ dishId, clicks }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 3)
    }));
  },

  /**
   * Event-specific metrics (for events mode)
   * @param {string} restaurantId
   * @returns {Promise<object>} Event metrics
   */
  async getEventMetrics(restaurantId) {
    const events = await this.getEvents(restaurantId, { eventType: 'event_qr_scan' }); // Get all events with any event_id
    
    // Group by event_id
    const eventMap = {};
    events.forEach(e => {
      if (!e.event_id) return;
      if (!eventMap[e.event_id]) {
        eventMap[e.event_id] = { eventId: e.event_id, scans: 0, clicks: 0, orders: 0, uniqueVisitors: new Set() };
      }
      const em = eventMap[e.event_id];
      if (e.event_type === 'qr_scan' || e.event_type === 'visit') {
        em.scans++;
        em.uniqueVisitors.add(e.metadata_json?.sessionId || 'anonymous');
      }
      if (e.event_type === 'dish_click') em.clicks++;
      if (e.event_type === 'order_placed' || e.event_type === 'order') em.orders++;
    });

    return Object.values(eventMap).map(e => ({
      ...e,
      uniqueVisitors: e.uniqueVisitors.size
    }));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Retención (brecha B del informe): la telemetría inserta una fila por
// scan/clic/pedido y acumula SIN LÍMITE — es la palanca de coste principal del
// plan free (500MB) además de alimentar la pausa por inactividad. Se purgan los
// eventos más viejos que TELEMETRY_RETENTION_DAYS (default 183 = 6 meses; el
// análisis diario/heatmap no necesita más de 90 días).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hora local (0-23) de un evento apuntado al huso del dueño.
 * Equivalente a `new Date(iso).getHours()` en una máquina con ese offset: se
 * suma `utcOffsetMinutes` y se lee con getUTC*. Devuelve null si la fecha es
 * inválida (nunca rompe el bucket).
 */
function localHourOf(isoDate, utcOffsetMinutes = 0) {
  const t = new Date(isoDate);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + (Number(utcOffsetMinutes) || 0) * 60000).getUTCHours();
}

/** Día de semana local (0 = Sunday) del evento, mismo huso que localHourOf. */
function localDayOf(isoDate, utcOffsetMinutes = 0) {
  const t = new Date(isoDate);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + (Number(utcOffsetMinutes) || 0) * 60000).getUTCDay();
}

/** Cutoff ISO de retención: ahora − N días, acotado a [30, 730] días. */
function retentionCutoffIso(olderThanDays) {
  const requested = Number(olderThanDays ?? process.env.TELEMETRY_RETENTION_DAYS);
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(730, Math.max(30, requested)) : 183;
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

/**
 * Purga eventos viejos de telemetría (nube + espejo en memoria):
 *  - Supabase: DELETE sobre telemetry_events created_at < cutoff (una sola
 *    sentencia, sin paginar ids — nunca arma URLs largas).
 *  - Local/JSON/dev: se poda `localTelemetryEvents` con la misma política.
 * Nunca lanza: degrada a `{ error }` para que el cron no falle entero y el
 * resto de la app siga funcionando. `dryRun` solo reporta (nada se borra).
 * @param {object} [opts] - { olderThanDays, dryRun }
 * @returns {Promise<object>} Resumen { cutoff, mode, dryRun, scanned*, pruned* }
 */
async function purgeOldTelemetry({ olderThanDays, dryRun = false } = {}) {
  const cutoff = retentionCutoffIso(olderThanDays);
  const result = { cutoff, mode: 'local', dryRun, scannedLocal: 0, prunedLocal: 0, scannedCloud: 0, prunedCloud: 0 };

  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { count, error: countError } = await supabase
        .from('telemetry_events')
        .select('id', { count: 'exact', head: true })
        .lt('created_at', cutoff);
      if (countError) throw new Error(`COUNT telemetry_events: ${countError.message}`);
      result.scannedCloud = count || 0;
      if (!dryRun && (count || 0) > 0) {
        const { error } = await supabase.from('telemetry_events').delete().lt('created_at', cutoff);
        if (error) throw new Error(`DELETE telemetry_events: ${error.message}`);
        result.prunedCloud = count;
        result.mode = 'supabase';
      }
    }

    const before = localTelemetryEvents.length;
    const kept = localTelemetryEvents.filter((e) => !e.created_at || e.created_at >= cutoff);
    // Reporta cuánto se PODARÍA/ podó, pero dry-run jamás muta el espejo.
    result.scannedLocal = before;
    result.prunedLocal = before - kept.length;
    if (!dryRun) {
      localTelemetryEvents.length = 0;
      localTelemetryEvents.push(...kept);
    }

    return result;
  } catch (e) {
    logger.warn('[Telemetry Retention] falló parcialmente', { details: e.message, cutoff });
    result.error = e.message;
    return result;
  }
}

telemetryService.retentionCutoffIso = retentionCutoffIso;
telemetryService.purgeOldTelemetry = purgeOldTelemetry;
telemetryService.getLocalTelemetryCount = () => localTelemetryEvents.length;
telemetryService.localHourOf = localHourOf;
telemetryService.localDayOf = localDayOf;

module.exports = telemetryService;
