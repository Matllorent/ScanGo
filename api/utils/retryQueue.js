const logger = require('./logger');

/**
 * Exponential Backoff with Full Jitter algorithm
 * @param {number} attempt - Current retry count (0-indexed)
 * @param {number} [baseDelay=200] - Base delay in ms
 * @param {number} [maxDelay=5000] - Max delay cap in ms
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffWithJitter(attempt, baseDelay = 200, maxDelay = 5000) {
  const exponential = Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
  // Full Jitter: random between 0 and exponential delay
  const jitter = Math.random() * exponential;
  return Math.floor(jitter);
}

/**
 * Async Retry Task Queue with Exponential Backoff + Jitter
 * Runs tasks asynchronously in background so external API delays never block client HTTP responses.
 */
class RetryQueue {
  /**
   * Enqueue a background task for resilient execution with retries
   * @param {() => Promise<any>} taskFn - Async function to execute
   * @param {object} [options]
   * @param {number} [options.maxRetries=3] - Maximum retry attempts
   * @param {string} [options.taskName='background_task'] - Label for logging
   */
  enqueue(taskFn, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const taskName = options.taskName || 'background_task';

    // Execute in background asynchronously (fire-and-forget for HTTP response)
    setImmediate(async () => {
      let attempt = 0;
      while (attempt < maxRetries) {
        try {
          await taskFn();
          logger.info(`Background task succeeded`, { taskName, attempt: attempt + 1 });
          return;
        } catch (err) {
          attempt++;
          logger.warn(`Background task failed (Attempt ${attempt}/${maxRetries})`, {
            taskName,
            error: err.message
          });

          if (attempt < maxRetries) {
            const delay = calculateBackoffWithJitter(attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            logger.error(`Background task permanently failed after ${maxRetries} retries`, {
              taskName,
              stack: err.stack
            });
          }
        }
      }
    });
  }
}

const retryQueue = new RetryQueue();

module.exports = {
  retryQueue,
  calculateBackoffWithJitter
};
