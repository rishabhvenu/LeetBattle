// API client for Colyseus server interactions
'use strict';

const { COLYSEUS_URL, BOT_SERVICE_SECRET } = require('./config');
const { CircuitBreaker } = require('./circuitBreaker');

// Circuit breakers for different API endpoints
const queueStatsBreaker = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeout: 30000,
  fallback: () => ({ queueSize: 0, botsInQueue: 0, isStale: true })
});

const globalStatsBreaker = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeout: 30000,
  fallback: () => ({ playersWaiting: 0, isStale: true })
});

const activeMatchesBreaker = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeout: 30000,
  fallback: () => []
});

/**
 * Convert WebSocket URL to HTTP URL for API requests
 * @param {string} wsUrl - WebSocket URL
 * @returns {string} HTTP URL
 */
function getHttpUrl(wsUrl) {
  if (wsUrl.startsWith('ws://')) {
    return wsUrl.replace('ws://', 'http://');
  }
  if (wsUrl.startsWith('wss://')) {
    return wsUrl.replace('wss://', 'https://');
  }
  return wsUrl;
}

/**
 * Make HTTP request to Colyseus server
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>}
 */
async function makeColyseusRequest(endpoint, options = {}) {
  const httpBaseUrl = getHttpUrl(COLYSEUS_URL);
  const url = `${httpBaseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (BOT_SERVICE_SECRET) {
    headers['x-bot-service-secret'] = BOT_SERVICE_SECRET;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });
    return response;
  } catch (error) {
    console.error(`Failed to make request to ${url}:`, error);
    throw error;
  }
}

/**
 * Get queue stats from Colyseus
 * @returns {Promise<Object>} Queue statistics
 */
async function getQueueStats() {
  return queueStatsBreaker.execute(async () => {
    const response = await makeColyseusRequest('/queue/size');
    if (!response.ok) {
      throw new Error(`Queue stats request failed: ${response.status}`);
    }
    return await response.json();
  }, 'queue-stats');
}

/**
 * Get global stats from Colyseus
 * @returns {Promise<Object>} Global statistics
 */
async function getGlobalStats() {
  return globalStatsBreaker.execute(async () => {
    const response = await makeColyseusRequest('/global/general-stats');
    if (!response.ok) {
      throw new Error(`Global stats request failed: ${response.status}`);
    }
    return await response.json();
  }, 'global-stats');
}

/**
 * Get active matches from Colyseus
 * @returns {Promise<Array>} List of active matches
 */
async function getActiveMatches() {
  return activeMatchesBreaker.execute(async () => {
    const response = await makeColyseusRequest('/admin/matches/active', {
      method: 'GET',
    });
    
    if (!response.ok) {
      throw new Error(`Active matches request failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.matches || [];
  }, 'active-matches');
}

/**
 * Clear bot from queue via HTTP
 * @param {string} botId - Bot ID to clear
 * @returns {Promise<Object>} Result of the operation
 */
async function clearBotFromQueue(botId) {
  try {
    const response = await makeColyseusRequest('/queue/dequeue', {
      method: 'POST',
      body: JSON.stringify({ userId: botId }),
    });

    return {
      ok: response.ok,
      status: response.status,
      attempted: true,
    };
  } catch (error) {
    console.error(`Failed to clear bot ${botId} from queue:`, error);
    return {
      ok: false,
      status: null,
      attempted: true,
      error: error.message,
    };
  }
}

/**
 * Get bot deployment stats from Redis via HTTP
 * @returns {Promise<Object>} Deployment statistics
 */
async function getBotDeploymentStatsViaHttp() {
  try {
    const response = await makeColyseusRequest('/admin/bots/deployment/stats');
    if (!response.ok) {
      throw new Error(`Deployment stats request failed: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to get deployment stats via HTTP:', error);
    return null;
  }
}

/**
 * Count human-bot matches currently active
 * @param {Array} matches - List of active matches
 * @returns {number} Count of human-bot matches
 */
function countHumanBotMatches(matches) {
  if (!Array.isArray(matches)) {
    return 0;
  }

  let count = 0;
  for (const match of matches) {
    const participants = match.participants || [];
    const hasHuman = participants.some(p => !p.isBot);
    const hasBot = participants.some(p => p.isBot);
    
    if (hasHuman && hasBot) {
      count++;
    }
  }
  
  return count;
}

module.exports = {
  makeColyseusRequest,
  getQueueStats,
  getGlobalStats,
  getActiveMatches,
  clearBotFromQueue,
  getBotDeploymentStatsViaHttp,
  countHumanBotMatches,
  // Export circuit breakers for monitoring
  circuitBreakers: {
    queueStats: queueStatsBreaker,
    globalStats: globalStatsBreaker,
    activeMatches: activeMatchesBreaker
  }
};

