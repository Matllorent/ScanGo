const { getSupabaseClient } = require('../utils/supabase');
const logger = require('../utils/logger');
const { retryQueue } = require('../utils/retryQueue');

// Local dev memory cache for telemetry events
const localTelemetryEvents = [];

const telemetryService = {
  /**
   * Non-blocking Fire-and-Forget telemetry recording
   * @param {object} options
   * @param {string} options.restaurantId - Restaurant ID or Slug
   * @param {'qr_scan'|'dish_click'|'order_placed'|'waiter_call'|'reservation'} options.eventType - Event name
   * @param {string} [options.dishId] - Dish ID if dish_click
   * @param {object} [options.metadata] - Extra context (e.g. userAgent, referral)
   */
  recordEvent({ restaurantId, eventType, dishId, metadata }) {
    // Execute asynchronously in background without blocking HTTP response
    retryQueue.enqueue(async () => {
      const utcNow = new Date().toISOString();
      const eventRecord = {
        id: 'tel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        restaurant_id: restaurantId,
        event_type: eventType,
        dish_id: dishId || null,
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

      logger.info(`[Telemetry Event] ${eventType}`, { restaurantId, dishId });
    }, { taskName: `telemetry_${eventType}` });
  },

  /**
   * Weekly metric aggregator for restaurant owners
   * @param {string} restaurantId
   * @returns {Promise<object>} Weekly aggregated telemetry metrics
   */
  async getWeeklyAggregatedMetrics(restaurantId) {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    let events = [];

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('telemetry_events')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .gte('created_at', oneWeekAgo);

        if (!error && data) events = data;
      } catch (e) {}
    }

    if (events.length === 0) {
      events = localTelemetryEvents.filter(e => e.restaurant_id === restaurantId && e.created_at >= oneWeekAgo);
    }

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
  }
};

module.exports = telemetryService;
