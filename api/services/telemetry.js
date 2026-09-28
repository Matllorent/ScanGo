const { getSupabaseClient } = require('../utils/supabase');
const logger = require('../utils/logger');
const { retryQueue } = require('../utils/retryQueue');

// Local dev memory cache for telemetry events
const localTelemetryEvents = [];

// Event types extended for branches/events
const EVENT_TYPES = [
  'qr_scan', 'dish_click', 'order_placed', 'waiter_call', 'reservation',
  'visit', 'order', 'waiter',
  'event_qr_scan', 'event_dish_click', 'event_order_placed'
];

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
  recordEvent({ restaurantId, eventType, dishId, branchId, eventId, metadata }) {
    // Execute asynchronously in background without blocking HTTP response
    retryQueue.enqueue(async () => {
      const utcNow = new Date().toISOString();
      const eventRecord = {
        id: 'tel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        restaurant_id: restaurantId,
        event_type: eventType,
        dish_id: dishId || null,
        branch_id: branchId || null,
        event_id: eventId || null,
        metadata_json: metadata || {},
        created_at: utcNow
      };

      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          await supabase.from('telemetry_events').insert([eventRecord]);
        } catch (e) {
          logger.warn('[Telemetry Service Supabase Error]', { error: e.message, eventType });
        }
      }

      localTelemetryEvents.push(eventRecord);
      if (localTelemetryEvents.length > 5000) localTelemetryEvents.shift();

      logger.info(`[Telemetry Event] ${eventType}`, { restaurantId, branchId, eventId, dishId });
    }, { taskName: `telemetry_${eventType}` });
  },

  /**
   * Get events with optional branch/event filtering
   */
  async getEvents(restaurantId, { since, branchId, eventId, eventType } = {}) {
    let events = [];
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        let query = supabase
          .from('telemetry_events')
          .select('*')
          .eq('restaurant_id', restaurantId);
        
        if (since) query = query.gte('created_at', since);
        if (branchId) query = query.eq('branch_id', branchId);
        if (eventId) query = query.eq('event_id', eventId);
        if (eventType) query = query.eq('event_type', eventType);
        
        const { data, error } = await query;
        if (!error && data) events = data;
      } catch (e) {}
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
        conversionRatePercent: qrScans > 0 ? +((ordersPlaced / qrScans) * 100).toFixed(1) : 0
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
   * Hourly heatmap for peak hours analysis
   * @param {string} restaurantId
   * @returns {Promise<object>} Hourly breakdown
   */
  async getHourlyHeatmap(restaurantId, { days = 7, branchId, eventId } = {}) {
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
      const date = new Date(e.created_at);
      const hour = date.getHours();
      const day = date.getDay(); // 0 = Sunday
      if (heatmap[hour]) {
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
        branchMap[branchId] = { branchId, visits: 0, dishClicks: 0, orders: 0, waiterCalls: 0, topDishes: {} };
      }
      const b = branchMap[branchId];
      if (e.event_type === 'qr_scan' || e.event_type === 'visit') b.visits++;
      if (e.event_type === 'dish_click' && e.dish_id) {
        b.dishClicks++;
        b.topDishes[e.dish_id] = (b.topDishes[e.dish_id] || 0) + 1;
      }
      if (e.event_type === 'order_placed' || e.event_type === 'order') b.orders++;
      if (e.event_type === 'waiter_call' || e.event_type === 'waiter') b.waiterCalls++;
    });

    // Convert to array with top dishes
    return Object.values(branchMap).map(b => ({
      ...b,
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

module.exports = telemetryService;
