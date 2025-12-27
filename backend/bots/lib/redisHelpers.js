// Redis helper utilities for bot service
'use strict';

/**
 * Safely execute a Redis operation with proper error logging
 * @param {Function} operation - Redis operation to execute
 * @param {string} errorContext - Context for error logging
 * @param {Object} logger - Logger instance (defaults to console)
 * @returns {Promise<any>} Operation result or null on failure
 */
async function safeRedisOp(operation, errorContext, logger = console) {
  try {
    return await operation();
  } catch (error) {
    logger.error(`Redis operation failed [${errorContext}]:`, error);
    // In future, increment metrics here:
    // metrics.increment('redis.errors', { context: errorContext });
    return null;
  }
}

/**
 * Execute multiple Redis operations with proper error logging
 * @param {Array<{op: Function, context: string}>} operations - Array of operations with context
 * @param {Object} logger - Logger instance
 * @returns {Promise<Array>} Array of results (null for failed operations)
 */
async function safeRedisMultiOp(operations, logger = console) {
  const results = [];
  for (const { op, context } of operations) {
    const result = await safeRedisOp(op, context, logger);
    results.push(result);
  }
  return results;
}

/**
 * Comprehensive bot cleanup - removes bot from all tracking structures
 * @param {Redis} redis - Redis client
 * @param {string} botId - Bot ID to clean up
 * @param {Object} options - Cleanup options
 * @returns {Promise<Object>} Cleanup results
 */
async function cleanupBotState(redis, botId, options = {}) {
  const { logger = console, reason = 'unknown' } = options;
  
  logger.log(`[cleanupBotState] Cleaning up bot ${botId} (reason: ${reason})`);
  
  const operations = [
    { op: () => redis.del(`bots:cycling:${botId}`), context: `cleanup-cycling-ttl:${botId}` },
    { op: () => redis.srem('bots:cycling', botId), context: `cleanup-cycling-set:${botId}` },
    { op: () => redis.srem('bots:deployed', botId), context: `cleanup-deployed:${botId}` },
    { op: () => redis.srem('bots:active', botId), context: `cleanup-active:${botId}` },
    { op: () => redis.del(`bots:state:${botId}`), context: `cleanup-state:${botId}` },
    { op: () => redis.del(`bot:current_match:${botId}`), context: `cleanup-current-match:${botId}` },
    { op: () => redis.del(`queue:reservation:${botId}`), context: `cleanup-reservation:${botId}` },
    { op: () => redis.zrem('queue:elo', botId), context: `cleanup-queue:${botId}` }
  ];
  
  const results = await safeRedisMultiOp(operations, logger);
  
  const summary = {
    botId,
    reason,
    cyclingTTL: results[0],
    cyclingSet: results[1],
    deployed: results[2],
    active: results[3],
    state: results[4],
    currentMatch: results[5],
    reservation: results[6],
    queueMembership: results[7]
  };
  
  logger.log(`[cleanupBotState] Completed cleanup for bot ${botId}:`, summary);
  return summary;
}

module.exports = {
  safeRedisOp,
  safeRedisMultiOp,
  cleanupBotState
};

