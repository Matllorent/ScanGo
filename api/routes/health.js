const express = require('express');
const { getSupabaseClient } = require('../utils/supabase');

const router = express.Router();

/**
 * GET /api/healthz
 * Diagnostic health check endpoint reporting server status, Supabase DB latency, memory, and uptime.
 */
router.get('/healthz', async (req, res) => {
  const startTime = Date.now();
  let dbConnected = true;
  let dbLatencyMs = 0;
  let dbProvider = 'local_json';

  const supabase = getSupabaseClient();
  if (supabase) {
    dbProvider = 'supabase_postgresql';
    try {
      const dbStart = Date.now();
      const { error } = await supabase.from('users').select('id').limit(1);
      dbLatencyMs = Date.now() - dbStart;
      if (error) {
        dbConnected = false;
      }
    } catch (e) {
      dbConnected = false;
      dbLatencyMs = Date.now() - startTime;
    }
  }

  const mem = process.memoryUsage();

  const healthData = {
    status: dbConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    database: {
      connected: dbConnected,
      provider: dbProvider,
      latencyMs: dbLatencyMs
    },
    memory: {
      heapUsedMb: +(mem.heapUsed / (1024 * 1024)).toFixed(2),
      heapTotalMb: +(mem.heapTotal / (1024 * 1024)).toFixed(2),
      rssMb: +(mem.rss / (1024 * 1024)).toFixed(2)
    }
  };

  const httpStatus = dbConnected ? 200 : 503;
  return res.status(httpStatus).json(healthData);
});

module.exports = router;
