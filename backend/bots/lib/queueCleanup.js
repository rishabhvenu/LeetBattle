'use strict';

function normalizeHttpBase(colyseusUrl) {
  return colyseusUrl.replace('ws://', 'http://').replace('wss://', 'https://');
}

async function tryClearQueueReservationViaHttp(botId, options = {}) {
  const {
    colyseusUrl,
    botServiceSecret,
    fetchImpl = global.fetch,
    logger = console,
  } = options;

  if (!colyseusUrl) {
    return { attempted: false, ok: false, reason: 'missing_colyseus_url' };
  }

  if (typeof fetchImpl !== 'function') {
    logger.warn('[cleanup] No fetch implementation available; skipping HTTP queue clear.');
    return { attempted: false, ok: false, reason: 'missing_fetch' };
  }

  const httpBase = normalizeHttpBase(colyseusUrl);
  if (!httpBase.startsWith('http')) {
    return { attempted: false, ok: false, reason: 'unsupported_protocol' };
  }

  const url = `${httpBase}/queue/clear`;
  const headers = { 'Content-Type': 'application/json' };
  if (botServiceSecret) {
    headers['X-Bot-Secret'] = botServiceSecret;
  }

  const payload = JSON.stringify({ userId: botId });
  const start = Date.now();

  try {
    const response = await fetchImpl(url, { method: 'POST', headers, body: payload });
    const duration = Date.now() - start;
    if (response.ok) {
      logger.log(`[cleanup] HTTP queue clear succeeded for bot ${botId} (status ${response.status}, ${duration}ms)`);
      return { attempted: true, ok: true, status: response.status, duration };
    }
    const body = await response.text().catch(() => '');
    logger.warn(`[cleanup] HTTP queue clear for bot ${botId} returned status ${response.status} (${duration}ms). Body: ${body || '<empty>'}`);
    return { attempted: true, ok: false, status: response.status, duration, body };
  } catch (error) {
    logger.warn(`[cleanup] HTTP queue clear for bot ${botId} failed:`, error);
    return { attempted: true, ok: false, error };
  }
}

async function performRedisCleanup(botId, redisClient, options = {}) {
  const { logger = console } = options;
  const operations = {
    reservation: () => redisClient.del(`queue:reservation:${botId}`),
    joinedAt: () => redisClient.del(`queue:joinedAt:${botId}`),
    queueEntry: () => redisClient.zrem('queue:elo', botId),
    botState: () => redisClient.del(`bots:state:${botId}`),
    botCurrentMatch: () => redisClient.del(`bot:current_match:${botId}`),
    botActive: () => redisClient.srem('bots:active', botId),
  };

  const summaryPieces = [];
  const results = {};

  for (const [label, fn] of Object.entries(operations)) {
    try {
      const value = await fn();
      results[label] = { success: true, value };
      summaryPieces.push(`${label}:${value}`);
    } catch (error) {
      results[label] = { success: false, error: error instanceof Error ? error.message : String(error) };
      summaryPieces.push(`${label}:error`);
      logger.warn(`[cleanup] Redis cleanup step "${label}" failed for bot ${botId}:`, error);
    }
  }

  logger.log(`[cleanup] Redis cleanup summary for bot ${botId}: ${summaryPieces.join(', ')}`);
  return results;
}

async function clearBotQueueState(botId, redisClient, options = {}) {
  const {
    colyseusUrl,
    botServiceSecret,
    fetchImpl = global.fetch,
    logger = console,
  } = options;

  const httpResult = await tryClearQueueReservationViaHttp(botId, {
    colyseusUrl,
    botServiceSecret,
    fetchImpl,
    logger,
  });
  const redisResult = await performRedisCleanup(botId, redisClient, { logger });
  return { httpResult, redisResult };
}

module.exports = {
  clearBotQueueState,
  performRedisCleanup,
  tryClearQueueReservationViaHttp,
};

