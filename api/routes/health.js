const express = require('express');
const { getSupabaseClient } = require('../utils/supabase');
const db = require('../../src/db/db');

const router = express.Router();

/**
 * GET /api/healthz
 * Diagnostic health check endpoint reporting server status, Supabase DB latency, memory, and uptime.
 */
router.get('/healthz', async (req, res, next) => {
  try {
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

  // Estado del esquema cloud (sonda de arranque; tablas faltantes lista gris)
  const schemaStatus = (db.getSchemaStatus && db.getSchemaStatus()) || {};

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
    schema: {
      probedAt: schemaStatus.probedAt || null,
      missing: schemaStatus.missing || [],
      present: schemaStatus.present || [],
      migrationHint: schemaStatus.missing && schemaStatus.missing.length > 0
        ? 'Aplicá src/db/migrations/001_realtime_operations_tables.sql (SQL Editor de Supabase) para crear las tablas faltantes.'
        : null
    },
    memory: {
      heapUsedMb: +(mem.heapUsed / (1024 * 1024)).toFixed(2),
      heapTotalMb: +(mem.heapTotal / (1024 * 1024)).toFixed(2),
      rssMb: +(mem.rss / (1024 * 1024)).toFixed(2)
    }
  };

    const httpStatus = dbConnected ? 200 : 503;
    return res.status(httpStatus).json(healthData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
