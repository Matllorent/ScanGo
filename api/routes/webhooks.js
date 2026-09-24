const express = require('express');
const billingOrchestrator = require('../../src/billing/orchestrator');
const webhookIdempotency = require('../middleware/idempotency');
const { successResponse, errorResponse } = require('../utils/response');

const router = express.Router();

/**
 * POST /api/webhooks/:provider
 * Webhook handler with idempotency middleware to update subscriptions safely
 */
router.post('/:provider', webhookIdempotency, async (req, res, next) => {
  try {
    const provider = req.params.provider;
    const rawBody = JSON.stringify(req.body);

    const result = await billingOrchestrator.processWebhook(
      provider,
      req.headers,
      rawBody,
      req.body
    );

    return res.status(200).json({
      success: true,
      message: `Webhook ${provider} procesado exitosamente`,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[Webhook Route Error ${req.params.provider}]`, err.message);
    return errorResponse(res, err.message || 'Error al procesar el webhook', 400, null, 'WEBHOOK_PROCESSING_FAILED');
  }
});

module.exports = router;
