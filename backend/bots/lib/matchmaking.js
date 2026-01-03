// Matchmaking logic for bots - handles deployment, rotation, and queue management
'use strict';

const { MongoClient, ObjectId } = require('mongodb');
const Colyseus = require('colyseus.js');
const {
  MONGODB_URI,
  COLYSEUS_URL,
  BOT_SERVICE_SECRET,
  DEFAULT_DEPLOY_DELAY_MS,
  DEFAULT_INITIAL_JOIN_DELAY_MS,
  BOT_DEPLOY_CHECK_INTERVAL_MS,
} = require('./config');

// Maximum time a bot can be in cycling state before being considered stale (5 minutes)
const MAX_CYCLING_TIME_MS = 5 * 60 * 1000;
// TTL for cycling entries in Redis (slightly longer than max cycling time)
const CYCLING_TTL_SECONDS = 360; // 6 minutes
const { clearBotQueueState, performRedisCleanup } = require('./queueCleanup');
const { getGlobalStats, getQueueStats } = require('./apiClient');
const { safeRedisOp, cleanupBotState } = require('./redisHelpers');

let mongoClient = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMongoClient() {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    await mongoClient.connect();
  }
  return mongoClient;
}

/**
 * Get all bots from MongoDB
 * @returns {Promise<Array>} List of all bots
 */
async function getAllBots() {
  try {
    const client = await getMongoClient();
    const db = client.db('codeclashers');
    const bots = db.collection('bots');
    
    const allBots = await bots.find({}).toArray();
    return allBots;
  } catch (error) {
    console.error('Error fetching all bots:', error);
    return [];
  }
}

/**
 * Initialize rotation queue - preserves existing deployed/active bots
 * @param {Redis} redis - Redis client
 * @returns {Promise<Object>} Deployment result
 */
async function initializeRotationQueue(redis) {
  try {
    console.log('Initializing rotation queue...');
    
    const allBots = await getAllBots();
    console.log(`Found ${allBots.length} total bots`);
    
    // Check existing Redis state
    const existingDeployed = await redis.smembers('bots:deployed');
    const existingActive = await redis.smembers('bots:active');
    
    console.log(`Found ${existingDeployed.length} bots already marked as deployed`);
    console.log(`Found ${existingActive.length} bots already marked as active`);
    
    const botsInMatches = new Set();
    // Get all active matches to validate bot:current_match keys
    const activeMatches = await redis.smembers('matches:active');
    const activeMatchSet = new Set(activeMatches);
    
    for (const bot of allBots) {
      const botId = bot._id.toString();
      const [reservation, isActive, currentMatch] = await Promise.all([
        redis.get(`queue:reservation:${botId}`),
        redis.sismember('bots:active', botId),
        redis.get(`bot:current_match:${botId}`),
      ]);
      
      // Validate that currentMatch actually exists in matches:active
      // If Colyseus restarted, matches are gone but Redis keys remain stale
      if (currentMatch && !activeMatchSet.has(currentMatch)) {
        console.log(`[init] Bot ${botId} has stale match key ${currentMatch} (match no longer active) - cleaning up`);
        await redis.del(`bot:current_match:${botId}`);
        // Don't consider this bot as in a match
      } else if (reservation || isActive || currentMatch) {
        botsInMatches.add(botId);
        if (currentMatch) {
          console.log(`Bot ${botId} is already in match ${currentMatch}`);
        }
      }
    }
    
    console.log(`Found ${botsInMatches.size} bots with active matches/reservations (validated against ${activeMatches.length} active matches)`);
    
    // Validate deployed bots - only count those that are actually in queue OR in active match
    // Clear orphaned deployed bots (marked deployed but not actually queued or active)
    const validDeployedBots = [];
    const orphanedBots = [];
    
    for (const bot of allBots) {
      const botId = bot._id.toString();
      
      if (botsInMatches.has(botId)) {
        // Bot is in an active match - truly deployed
        validDeployedBots.push(bot);
      } else if (existingDeployed.includes(botId)) {
        // Bot is marked as deployed - verify it's actually in queue
        const inQueue = await redis.zscore('queue:elo', botId);
        const botState = await redis.get(`bots:state:${botId}`);
        
        if (inQueue !== null || botState) {
          // Bot is genuinely in queue or has valid state
          validDeployedBots.push(bot);
        } else {
          // Orphaned bot - marked deployed but not actually in queue or match
          console.warn(`[init] Bot ${botId} is orphaned (marked deployed but not in queue/match) - clearing`);
          orphanedBots.push(bot);
          // Clean up the stale deployed status
          await redis.srem('bots:deployed', botId);
          await redis.del(`bots:cycling:${botId}`);
          await redis.srem('bots:cycling', botId);
        }
      }
    }
    
    // Separate bots into deployed and undeployed
    const deployedBots = validDeployedBots;
    const undeployedBots = allBots.filter(bot => 
      !validDeployedBots.some(d => d._id.toString() === bot._id.toString())
    );
    
    if (orphanedBots.length > 0) {
      console.log(`[init] Cleared ${orphanedBots.length} orphaned bots`);
    }
    
    console.log(`${deployedBots.length} bots remain deployed, ${undeployedBots.length} available for rotation`);
    
    // Get rotation config
    const config = await redis.hgetall('bots:rotation:config');
    const targetDeployed = parseInt(config.minDeployed || '5', 10);
    
    if (deployedBots.length < targetDeployed && undeployedBots.length > 0) {
      const botsToDeploy = Math.min(
        targetDeployed - deployedBots.length,
        undeployedBots.length
      );
      
      console.log(`Deploying ${botsToDeploy} bots to reach target of ${targetDeployed}`);
      
      for (let i = 0; i < botsToDeploy; i++) {
        const bot = undeployedBots[i];
        await deployBot(redis, bot._id.toString(), {
          context: 'initialization',
          initialJoinDelayMs: DEFAULT_INITIAL_JOIN_DELAY_MS,
        });
        deployedBots.push(bot);
      }
      
      // Add remaining to rotation queue (remove first to prevent duplicates)
      const remainingBots = undeployedBots.slice(botsToDeploy);
      for (const bot of remainingBots) {
        const botId = bot._id.toString();
        await redis.lrem('bots:rotation:queue', 0, botId); // Remove all existing instances
        await redis.rpush('bots:rotation:queue', botId);
      }
      console.log(`Added ${remainingBots.length} bots to rotation queue`);
    } else {
      // Add all undeployed to rotation queue (remove first to prevent duplicates)
      for (const bot of undeployedBots) {
        const botId = bot._id.toString();
        await redis.lrem('bots:rotation:queue', 0, botId); // Remove all existing instances
        await redis.rpush('bots:rotation:queue', botId);
      }
      console.log(`Added ${undeployedBots.length} bots to rotation queue`);
    }
    
    return { deployedBots, undeployedBots };
  } catch (error) {
    console.error('Error initializing rotation queue:', error);
    return { deployedBots: [], undeployedBots: [] };
  }
}

/**
 * Get bot deployment stats
 * @param {Redis} redis - Redis client
 * @returns {Promise<Object>} Deployment statistics
 */
async function getBotDeploymentStats(redis) {
  const config = await redis.hgetall('bots:rotation:config');
  const currentDeployed = await redis.scard('bots:deployed');
  const currentActive = await redis.scard('bots:active');
  const queueLength = await redis.llen('bots:rotation:queue');
  
  return {
    minDeployed: parseInt(config.minDeployed || '5', 10),
    totalBots: parseInt(config.totalBots || '0', 10),
    deployDelayMs: parseInt(config.deployDelayMs || DEFAULT_DEPLOY_DELAY_MS.toString(), 10),
    initialJoinDelayMs: parseInt(config.initialJoinDelayMs || DEFAULT_INITIAL_JOIN_DELAY_MS.toString(), 10),
    currentDeployed,
    currentActive,
    queueLength,
  };
}

/**
 * Check and manage bot deployment based on queue state
 * @param {Redis} redis - Redis client
 * @param {Object} options - Deployment options
 */
// Threshold for deploying extra bots beyond minimum (15 seconds)
const EXTRA_BOT_DEPLOY_WAIT_THRESHOLD_MS = 15000;

async function checkAndManageBotDeployment(redis, options = {}) {
  try {
    const stats = await getBotDeploymentStats(redis);
    const { minDeployed, totalBots, deployDelayMs, initialJoinDelayMs, currentDeployed, currentActive } = stats;
    
    const context = options.context || 'scheduled';
    
    // Get queue stats
    const queueStats = await getQueueStats();
    const globalStats = await getGlobalStats();
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/ca6a8763-761a-486d-b90c-f61e3733ef71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'matchmaking.js:checkAndManageBotDeployment',message:'Raw globalStats from API',data:{globalStats,queueStats},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,B,C'})}).catch(()=>{});
    // #endregion
    
    const botsInQueue = queueStats.botsInQueue || 0;
    const humansWaiting = globalStats.queuedHumansCount || 0;
    const longestHumanWaitMs = globalStats.longestHumanWaitMs || 0;
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/ca6a8763-761a-486d-b90c-f61e3733ef71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'matchmaking.js:checkAndManageBotDeployment',message:'Extracted values',data:{humansWaiting,longestHumanWaitMs,botsInQueue,threshold:EXTRA_BOT_DEPLOY_WAIT_THRESHOLD_MS},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C,D'})}).catch(()=>{});
    // #endregion
    
    // CRITICAL: Count both deployed AND active bots when checking minimum
    // Deployed = bots in queue waiting to match
    // Active = bots currently in matches
    // Both count toward satisfying the minimum deployment requirement
    const effectivelyDeployed = currentDeployed + currentActive;
    
    console.log(
      `[${context}] Deployed: ${currentDeployed}, Active: ${currentActive}, Effective: ${effectivelyDeployed}, ` +
      `Queue: ${botsInQueue} bots, ${humansWaiting} humans waiting (longest: ${Math.round(longestHumanWaitMs / 1000)}s)`
    );
    
    let botsToDeploy = 0;
    
    // Ensure minimum bots deployed (always) - count active bots toward this minimum
    if (effectivelyDeployed < minDeployed) {
      botsToDeploy = minDeployed - effectivelyDeployed;
      console.log(`Below minimum: need ${botsToDeploy} bots to reach ${minDeployed} (effective: ${effectivelyDeployed})`);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/ca6a8763-761a-486d-b90c-f61e3733ef71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'matchmaking.js:checkAndManageBotDeployment',message:'Decision: Below minimum',data:{effectivelyDeployed,minDeployed,botsToDeploy},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    } else if (humansWaiting > 0 && longestHumanWaitMs > EXTRA_BOT_DEPLOY_WAIT_THRESHOLD_MS) {
      // Only deploy extra bots if a human has been waiting > 15 seconds
      botsToDeploy = Math.max(0, humansWaiting - botsInQueue);
      if (botsToDeploy > 0) {
        console.log(`${humansWaiting} humans waiting for ${Math.round(longestHumanWaitMs / 1000)}s (>${EXTRA_BOT_DEPLOY_WAIT_THRESHOLD_MS / 1000}s), ${botsInQueue} bots in queue, need ${botsToDeploy} more`);
      }
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/ca6a8763-761a-486d-b90c-f61e3733ef71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'matchmaking.js:checkAndManageBotDeployment',message:'Decision: Extra bots for waiting humans',data:{humansWaiting,longestHumanWaitMs,botsInQueue,botsToDeploy},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    } else if (humansWaiting > 0) {
      console.log(`${humansWaiting} humans waiting but only for ${Math.round(longestHumanWaitMs / 1000)}s (<${EXTRA_BOT_DEPLOY_WAIT_THRESHOLD_MS / 1000}s threshold), minimum already met`);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/ca6a8763-761a-486d-b90c-f61e3733ef71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'matchmaking.js:checkAndManageBotDeployment',message:'Decision: Wait time below threshold',data:{humansWaiting,longestHumanWaitMs,threshold:EXTRA_BOT_DEPLOY_WAIT_THRESHOLD_MS},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    }
    
    // Cap at totalBots if set (count both deployed and active)
    const maxCanDeploy = totalBots > 0 ? totalBots - effectivelyDeployed : botsToDeploy;
    botsToDeploy = Math.min(botsToDeploy, maxCanDeploy);
    
    if (botsToDeploy > 0) {
      const queueLength = await redis.llen('bots:rotation:queue');
      const rotationQueueContents = await redis.lrange('bots:rotation:queue', 0, -1);
      console.log(`Deploying ${botsToDeploy} bots, rotation queue length: ${queueLength}`);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/ca6a8763-761a-486d-b90c-f61e3733ef71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'matchmaking.js:checkAndManageBotDeployment',message:'About to deploy bots',data:{botsToDeploy,queueLength,rotationQueueContents,maxCanDeploy},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      for (let i = 0; i < botsToDeploy; i++) {
        if (deployDelayMs > 0 && i > 0) {
          await sleep(deployDelayMs);
        }
        let nextBotId = await redis.lpop('bots:rotation:queue');
        
        // If rotation queue is empty, try to recover limbo bots
        if (!nextBotId && i === 0) {
          console.log('Rotation queue empty, attempting to recover limbo bots...');
          const recoveredCount = await recoverLimboBots(redis);
          if (recoveredCount > 0) {
            nextBotId = await redis.lpop('bots:rotation:queue');
          }
        }
        
        if (nextBotId) {
          console.log(`Deploying bot ${nextBotId} from rotation queue`);
          await deployBot(redis, nextBotId, {
            context,
            initialJoinDelayMs,
          });
        } else {
          console.log('No more bots available in rotation queue');
          break;
        }
      }
    } else {
      // Check for excess bots to undeploy
      // Only undeploy if effective count (deployed + active) exceeds minimum
      const excess = effectivelyDeployed - minDeployed;
      if (excess > 0 && humansWaiting === 0) {
        console.log(`Have ${excess} excess bots (effective: ${effectivelyDeployed}), checking for idle bots to undeploy`);
        
        const deployedBots = await redis.smembers('bots:deployed');
        const activeBots = await redis.smembers('bots:active');
        
        const idleBots = deployedBots.filter(botId => !activeBots.includes(botId));
        const botsToUndeploy = [];
        
        for (const botId of idleBots.slice(0, Math.min(excess, idleBots.length))) {
          const [hasReservation, isInQueue] = await Promise.all([
            redis.get(`queue:reservation:${botId}`),
            redis.zscore('queue:elo', botId),
          ]);
          
          if (!hasReservation && !isInQueue) {
            botsToUndeploy.push(botId);
          }
        }
        
        console.log(`Undeploying ${botsToUndeploy.length} idle bots`);
        for (const botId of botsToUndeploy) {
          await undeployBot(redis, botId);
        }
      }
    }
  } catch (error) {
    console.error('Error checking bot deployment:', error);
  }
}

/**
 * Deploy a bot (mark as deployed and start queue cycle)
 * @param {Redis} redis - Redis client
 * @param {string} botId - Bot ID to deploy
 * @param {Object} options - Deployment options
 */
async function deployBot(redis, botId, options = {}) {
  try {
    const { initialJoinDelayMs = 0, context = 'standard' } = options;
    console.log(`[deployBot] Starting deployment for bot ${botId} (context=${context})`);
    
    // Atomically acquire cycle guard with TTL-based stale check
    // This prevents TOCTOU race conditions between checking and acquiring
    const acquired = await redis.acquireCycleGuard(
      `bots:cycling:${botId}`,
      Date.now().toString(),
      MAX_CYCLING_TIME_MS.toString(),
      CYCLING_TTL_SECONDS.toString()
    );
    
    if (acquired === 0) {
      console.log(`Bot ${botId} already has an active cycle or failed to acquire guard, skipping`);
      return;
    }
    
    // Also add to set for compatibility with existing code
    await redis.sadd('bots:cycling', botId);
    
    // Check for stale state and existing matches
    const [reservation, isActive, isInQueue, currentMatch] = await Promise.all([
      redis.get(`queue:reservation:${botId}`),
      redis.sismember('bots:active', botId),
      redis.zscore('queue:elo', botId),
      redis.get(`bot:current_match:${botId}`),
    ]);
    
    // If bot is already in an active match, don't deploy
    if (currentMatch) {
      console.log(`Bot ${botId} is already in match ${currentMatch}, skipping deployment`);
      await redis.srem('bots:cycling', botId);
      return;
    }
    
    if (reservation || isActive || isInQueue) {
      console.log(`Bot ${botId} has stale state - cleaning up`);
      await performRedisCleanup(botId, redis, { logger: console });
    }
    
    // Add to deployed set
    await redis.sadd('bots:deployed', botId);
    console.log(`Bot ${botId} marked as deployed`);
    
    // Get bot data
    const client = await getMongoClient();
    const db = client.db('codeclashers');
    const bots = db.collection('bots');
    const bot = await bots.findOne({ _id: new ObjectId(botId) });
    
    if (!bot) {
      console.error(`Bot ${botId} not found in MongoDB`);
      await safeRedisOp(
        () => redis.srem('bots:deployed', botId),
        `remove-deployed-not-found:${botId}`
      );
      await safeRedisOp(
        () => redis.del(`bots:cycling:${botId}`),
        `cleanup-cycling-not-found:${botId}`
      );
      await safeRedisOp(
        () => redis.srem('bots:cycling', botId),
        `cleanup-cycling-set-not-found:${botId}`
      );
      return;
    }
    
    console.log(`Deploying bot ${bot.fullName} (${botId})`);
    
    // Start bot queueing process asynchronously but handle failures properly
    queueBot(redis, bot, { initialJoinDelayMs, context }).catch(async (error) => {
      console.error(`Bot ${botId} cycle error:`, error);
      
      // Comprehensive cleanup on failure
      try {
        await Promise.all([
          redis.del(`bots:cycling:${botId}`),
          redis.srem('bots:cycling', botId),
          redis.srem('bots:deployed', botId),
          redis.srem('bots:active', botId),
          redis.del(`bots:state:${botId}`)
        ]);
        
        // Return bot to rotation queue for retry
        await redis.lrem('bots:rotation:queue', 0, botId);
        await redis.rpush('bots:rotation:queue', botId);
        
        console.log(`Bot ${botId} cleaned up and returned to rotation queue after failure`);
      } catch (cleanupError) {
        console.error(`Failed to cleanup bot ${botId} after queueBot error:`, cleanupError);
      }
    });
  } catch (error) {
    console.error(`Error deploying bot ${botId}:`, error);
    // Use comprehensive cleanup helper
    await cleanupBotState(redis, botId, { reason: 'deployment-error' });
  }
}

/**
 * Undeploy a bot (remove from deployed set, add to rotation queue)
 * @param {Redis} redis - Redis client
 * @param {string} botId - Bot ID to undeploy
 */
async function undeployBot(redis, botId) {
  try {
    console.log(`Undeploying bot ${botId}`);
    
    // Safety checks
    const isActive = await redis.sismember('bots:active', botId);
    if (isActive) {
      console.log(`Bot ${botId} is in an active match, cannot undeploy`);
      return;
    }
    
    const [reservation, isInQueue] = await Promise.all([
      redis.get(`queue:reservation:${botId}`),
      redis.zscore('queue:elo', botId),
    ]);
    
    if (reservation || isInQueue) {
      console.log(`Bot ${botId} is queued or has reservation, cannot undeploy`);
      return;
    }
    
    // Remove from deployed set
    const removed = await redis.srem('bots:deployed', botId);
    if (removed === 0) {
      console.log(`Bot ${botId} was not marked as deployed`);
      return;
    }
    
    // Add to rotation queue (remove first to prevent duplicates) and clean up cycling guard
    await redis.lrem('bots:rotation:queue', 0, botId);
    await redis.rpush('bots:rotation:queue', botId);
    await safeRedisOp(
      () => redis.del(`bots:cycling:${botId}`),
      `undeploy-cleanup-cycling:${botId}`
    );
    await safeRedisOp(
      () => redis.srem('bots:cycling', botId),
      `undeploy-cleanup-cycling-set:${botId}`
    );
    
    console.log(`Bot ${botId} undeployed and added to rotation queue`);
  } catch (error) {
    console.error(`Error undeploying bot ${botId}:`, error);
  }
}

/**
 * Recycle bot for redeployment after error
 * @param {Redis} redis - Redis client
 * @param {string} botId - Bot ID to recycle
 * @param {string} reason - Reason for recycling
 * @param {Object} options - Additional options
 */
async function recycleBotForRedeploy(redis, botId, reason, options = {}) {
  console.warn(`[recycle] Recycling bot ${botId} (${reason})`);
  
  const { queueRoom } = options;
  if (queueRoom) {
    try {
      queueRoom.leave();
    } catch {
      // Ignore close errors
    }
  }
  
  // Use comprehensive cleanup with proper error logging
  await cleanupBotState(redis, botId, { reason: `recycle:${reason}` });
  
  // Return bot to rotation queue
  await safeRedisOp(
    () => redis.lrem('bots:rotation:queue', 0, botId),
    `recycle-remove-from-queue:${botId}`
  );
  await safeRedisOp(
    () => redis.rpush('bots:rotation:queue', botId),
    `recycle-add-to-queue:${botId}`
  );
  
  try {
    await checkAndManageBotDeployment(redis);
  } catch (error) {
    console.error(`[recycle] Failed to trigger deployment check:`, error);
  }
}

/**
 * Wait for match_found message from queue room
 * @param {Room} queueRoom - Colyseus queue room
 * @param {number} timeoutMs - Timeout in milliseconds (default 5 minutes)
 * @returns {Promise} Resolves with match data when found, rejects on timeout
 */
function waitForMatch(queueRoom, timeoutMs = 300000) {
  return Promise.race([
    new Promise((resolve) => {
      queueRoom.onMessage('match_found', (message) => {
        resolve(message || null);
      });
    }),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Match wait timeout - no match found within timeout period')), timeoutMs)
    )
  ]);
}

/**
 * Queue a bot for matchmaking (event-driven, no polling)
 * @param {Redis} redis - Redis client
 * @param {Object} bot - Bot data from MongoDB
 * @param {Object} options - Queue options
 */
async function queueBot(redis, bot, options = {}) {
  const botId = bot._id.toString();
  const rating = bot.stats.rating;
  const client = new Colyseus.Client(COLYSEUS_URL);
  const { initialJoinDelayMs = 0 } = options;
  
  console.log(`Queueing bot ${bot.fullName} (${botId}) with rating ${rating}`);
  
  let cycleGuardReleased = false;
  const releaseCycleGuard = async () => {
    if (!cycleGuardReleased) {
      cycleGuardReleased = true;
      // Clean up both TTL-based entry and set membership with proper error logging
      await safeRedisOp(
        () => redis.del(`bots:cycling:${botId}`),
        `release-cycle-guard-ttl:${botId}`
      );
      await safeRedisOp(
        () => redis.srem('bots:cycling', botId),
        `release-cycle-guard-set:${botId}`
      );
    }
  };
  
  try {
    // Check if bot is still deployed
    const isDeployed = await redis.sismember('bots:deployed', botId);
    if (!isDeployed) {
      console.log(`Bot ${botId} is no longer deployed`);
      await releaseCycleGuard();
      return;
    }
    
    // Check for existing match/queue state including bot:current_match
    const [reservation, isActive, isInQueue, currentMatch] = await Promise.all([
      redis.get(`queue:reservation:${botId}`),
      redis.sismember('bots:active', botId),
      redis.zscore('queue:elo', botId),
      redis.get(`bot:current_match:${botId}`),
    ]);
    
    if (reservation || isActive || isInQueue || currentMatch) {
      console.log(`Bot ${botId} already has match/queue state (reservation=${!!reservation}, active=${isActive}, inQueue=${!!isInQueue}, currentMatch=${currentMatch}), skipping`);
      await releaseCycleGuard();
      return;
    }
    
    // Clean up any stale Colyseus reservations
    await clearBotQueueState(botId, redis, {
      colyseusUrl: COLYSEUS_URL,
      botServiceSecret: BOT_SERVICE_SECRET,
      logger: console,
    });
    
    // Connect to queue room
    console.log(`Bot ${botId} connecting to queue room`);
    let queueRoom;
    let joinErrorOccurred = false;
    
    // Join with retries
    const maxAttempts = 5;
    let attempt = 0;
    while (true) {
      if (attempt === 0 && initialJoinDelayMs > 0) {
        await sleep(initialJoinDelayMs);
      }
      try {
        queueRoom = await client.joinOrCreate('queue', { userId: botId, rating });
        queueRoom.onMessage('queued', (payload) => {
          const position = payload?.position ?? 'unknown';
          console.log(`[queue] Bot ${botId} queued at position ${position}`);
        });
        break;
      } catch (err) {
        const errMsg = String(err?.message || err);
        const isReservationError = errMsg.includes('seat reservation expired') || errMsg.includes('4002');
        attempt++;
        if (!isReservationError || attempt >= maxAttempts) {
          throw err;
        }
        const backoffMs = Math.min(1500, 150 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 150);
        console.warn(`Bot ${botId} retry ${attempt}/${maxAttempts} after reservation error; waiting ${backoffMs}ms`);
        await sleep(backoffMs);
      }
    }
    
    // Set up error handler
    queueRoom.onError((error) => {
      console.error(`Bot ${botId} error in queue room:`, error);
      joinErrorOccurred = true;
      recycleBotForRedeploy(redis, botId, 'queue room error', { queueRoom }).catch(() => {});
    });
    
    // Wait to catch immediate errors
    await sleep(500);
    
    if (joinErrorOccurred) {
      console.error(`Bot ${botId} join error occurred`);
      await releaseCycleGuard();
      return;
    }
    
    await redis.setex(`bots:state:${botId}`, 3600, 'queued');
    
    // Verify queue membership
    const queueMembership = await redis.zscore('queue:elo', botId);
    if (queueMembership === null) {
      console.warn(`Bot ${botId} missing from queue:elo after queued ack`);
      await recycleBotForRedeploy(redis, botId, 'missing queue membership', { queueRoom });
      return;
    }
    console.log(`Bot ${botId} queued successfully`);
    
    // Set up leave cleanup
    queueRoom.onLeave(async () => {
      console.log(`Bot ${botId} left queue room`);
      await safeRedisOp(
        () => redis.del(`bots:state:${botId}`),
        `cleanup-on-leave:${botId}`
      );
    });
    
    // Wait for match (event-driven) with timeout
    let matchData = null;
    try {
      matchData = joinErrorOccurred ? null : await waitForMatch(queueRoom);
    } catch (timeoutError) {
      console.error(`Bot ${botId} match wait timeout:`, timeoutError.message);
      await recycleBotForRedeploy(redis, botId, 'match wait timeout', { queueRoom });
      return;
    }
    
    if (joinErrorOccurred || !matchData) {
      console.log(`Bot ${botId} exiting queueBot (error or no match)`);
      await releaseCycleGuard();
      return;
    }
    
    // Bot was matched
    await redis.sadd('bots:active', botId);
    console.log(`Bot ${botId} matched - marked as active`);
    
    // Verify reservation is still valid
    const reservationCheck = await redis.get(`queue:reservation:${botId}`);
    if (!reservationCheck) {
      console.error(`Bot ${botId} reservation expired before joining match`);
      await recycleBotForRedeploy(redis, botId, 'reservation expired', { queueRoom });
      return;
    }
    
    // Join match room
    console.log(`Bot ${botId} joining match room ${matchData.roomId}`);
    await redis.setex(`bots:state:${botId}`, 3600, 'matched');
    
    let matchRoom;
    try {
      matchRoom = await client.joinById(matchData.roomId, { userId: botId });
      matchRoom.onMessage('match_init', (payload) => {
        const matchId = payload?.matchId || matchData.matchId || 'unknown';
        console.log(`[match] Bot ${botId} received match_init for match ${matchId}`);
      });
      matchRoom.onMessage('code_update', () => {
        // Acknowledge code updates
      });
      console.log(`Bot ${botId} successfully joined match room`);
    } catch (joinError) {
      console.error(`Bot ${botId} failed to join match room:`, joinError);
      await redis.del(`queue:reservation:${botId}`).catch(() => {});
      await recycleBotForRedeploy(redis, botId, 'failed to join match', { queueRoom });
      return;
    }
    
    // Remove from deployed after successful match join
    const stillInQueue = await redis.zscore('queue:elo', botId);
    if (stillInQueue) {
      console.warn(`Bot ${botId} still in queue after match join - removing`);
      await redis.zrem('queue:elo', botId);
    }
    await redis.srem('bots:deployed', botId);
    console.log(`Bot ${botId} removed from deployed set`);
    
    // Leave queue room
    queueRoom.leave();
    
    await redis.setex(`bots:state:${botId}`, 3600, 'playing');
    
    matchRoom.onLeave(() => {
      console.log(`Bot ${botId} left match room`);
    });
    
    matchRoom.onError((error) => {
      console.error(`Bot ${botId} error in match room:`, error);
    });
    
    // Wait for match to complete
    await new Promise((resolve) => {
      matchRoom.onLeave(() => resolve());
    });
    
    console.log(`Bot ${botId} match completed`);
    
    // Clean up
    await redis.del(`bots:state:${botId}`);
    await redis.srem('bots:active', botId);
    await redis.del(`queue:reservation:${botId}`);
    await releaseCycleGuard();
  } catch (error) {
    console.error(`Error queueing bot ${botId}:`, error);
    await redis.del(`bots:state:${botId}`).catch(() => {});
    await redis.srem('bots:active', botId).catch(() => {});
    await releaseCycleGuard();
    
    const wasDeployed = await redis.sismember('bots:deployed', botId);
    if (wasDeployed) {
      await recycleBotForRedeploy(redis, botId, 'queue error');
    }
  }
}

/**
 * Rotate bot after match completion
 * @param {Redis} redis - Redis client
 * @param {string} completedBotId - Bot ID that completed a match
 */
async function rotateBot(redis, completedBotId) {
  try {
    console.log(`Bot ${completedBotId} match completed, evaluating rotation`);
    
    // Check if bot is still active
    const isStillActive = await redis.sismember('bots:active', completedBotId);
    if (isStillActive) {
      await sleep(100);
      const isStillActiveAfterDelay = await redis.sismember('bots:active', completedBotId);
      if (isStillActiveAfterDelay) {
        console.log(`Bot ${completedBotId} still active after delay, skipping rotation`);
        return;
      }
    }
    
    // Check for reservation or queue membership
    const [hasReservation, isInQueue] = await Promise.all([
      redis.get(`queue:reservation:${completedBotId}`),
      redis.zscore('queue:elo', completedBotId),
    ]);
    
    if (hasReservation || isInQueue) {
      console.log(`Bot ${completedBotId} still has reservation or in queue, skipping rotation`);
      return;
    }
    
    // Clear cycling guard (both TTL-based and set)
    await safeRedisOp(
      () => redis.del(`bots:cycling:${completedBotId}`),
      `rotate-cleanup-cycling:${completedBotId}`
    );
    await safeRedisOp(
      () => redis.srem('bots:cycling', completedBotId),
      `rotate-cleanup-cycling-set:${completedBotId}`
    );
    
    // Add to rotation queue
    await safeRedisOp(
      () => redis.lrem('bots:rotation:queue', 0, completedBotId),
      `rotate-remove-from-queue:${completedBotId}`
    );
    await safeRedisOp(
      () => redis.rpush('bots:rotation:queue', completedBotId),
      `rotate-add-to-queue:${completedBotId}`
    );
    
    console.log(`Bot ${completedBotId} added to rotation queue`);
    
    // Trigger deployment check
    await checkAndManageBotDeployment(redis);
  } catch (error) {
    console.error(`Error rotating bot ${completedBotId}:`, error);
  }
}

/**
 * Recover bots that are in "limbo" - not tracked in any Redis set
 * This handles the case where bots finish matches but don't get returned to rotation queue
 * @param {Redis} redis - Redis client
 * @returns {Promise<number>} Number of bots recovered
 */
async function recoverLimboBots(redis) {
  try {
    const allBots = await getAllBots();
    if (!allBots || allBots.length === 0) {
      return 0;
    }
    
    // Get all tracking sets
    const [deployed, active, cycling, rotationQueue] = await Promise.all([
      redis.smembers('bots:deployed'),
      redis.smembers('bots:active'),
      redis.smembers('bots:cycling'),
      redis.lrange('bots:rotation:queue', 0, -1),
    ]);
    
    const deployedSet = new Set(deployed);
    const activeSet = new Set(active);
    const cyclingSet = new Set(cycling);
    const rotationSet = new Set(rotationQueue);
    
    let recoveredCount = 0;
    
    for (const bot of allBots) {
      const botId = bot._id.toString();
      
      // Check if bot is tracked anywhere
      const isTracked = deployedSet.has(botId) || 
                        activeSet.has(botId) || 
                        cyclingSet.has(botId) || 
                        rotationSet.has(botId);
      
      if (!isTracked) {
        // Also check queue:elo and reservation
        const [inQueue, hasReservation, currentMatch] = await Promise.all([
          redis.zscore('queue:elo', botId),
          redis.get(`queue:reservation:${botId}`),
          redis.get(`bot:current_match:${botId}`),
        ]);
        
        if (!inQueue && !hasReservation && !currentMatch) {
          // Bot is completely untracked - add to rotation queue
          console.log(`[recover] Bot ${botId} found in limbo, adding to rotation queue`);
          await redis.lrem('bots:rotation:queue', 0, botId); // Remove if exists
          await redis.rpush('bots:rotation:queue', botId);
          recoveredCount++;
        } else if (currentMatch) {
          // Has stale currentMatch pointer - clean it up
          console.log(`[recover] Bot ${botId} has stale current_match ${currentMatch}, cleaning up`);
          await redis.del(`bot:current_match:${botId}`);
          await redis.lrem('bots:rotation:queue', 0, botId);
          await redis.rpush('bots:rotation:queue', botId);
          recoveredCount++;
        }
      }
    }
    
    if (recoveredCount > 0) {
      console.log(`[recover] Recovered ${recoveredCount} limbo bots to rotation queue`);
    }
    
    return recoveredCount;
  } catch (error) {
    console.error('[recover] Error recovering limbo bots:', error);
    return 0;
  }
}

/**
 * Prune stale cycling bots that have been stuck for too long
 * This handles cases where MongoDB/connection issues prevented proper cleanup
 * @param {Redis} redis - Redis client
 */
async function pruneStaleCyclingBots(redis) {
  try {
    const cyclingBots = await redis.smembers('bots:cycling');
    if (!cyclingBots || cyclingBots.length === 0) {
      return 0;
    }
    
    let cleanedCount = 0;
    const now = Date.now();
    
    for (const botId of cyclingBots) {
      // Check TTL-based cycling entry
      const cycleStartStr = await redis.get(`bots:cycling:${botId}`);
      
      let isStale = false;
      if (!cycleStartStr) {
        // No TTL entry but in cycling set - stale (orphaned set membership)
        isStale = true;
        console.log(`[prune-cycling] Bot ${botId} has no TTL entry but is in cycling set - stale`);
      } else {
        const cycleStart = parseInt(cycleStartStr, 10);
        const cycleAge = now - cycleStart;
        if (cycleAge > MAX_CYCLING_TIME_MS) {
          isStale = true;
          console.log(`[prune-cycling] Bot ${botId} has been cycling for ${Math.round(cycleAge / 1000)}s - stale`);
        }
      }
      
      if (isStale) {
        // Check if bot is actually active (in a real match)
        const [isActive, currentMatch, reservation] = await Promise.all([
          redis.sismember('bots:active', botId),
          redis.get(`bot:current_match:${botId}`),
          redis.get(`queue:reservation:${botId}`),
        ]);
        
        if (isActive || currentMatch || reservation) {
          // Bot is actually in a match, just clean up the cycling guard
          console.log(`[prune-cycling] Bot ${botId} is actually active, cleaning cycling guard only`);
          await safeRedisOp(
            () => redis.del(`bots:cycling:${botId}`),
            `prune-cycling-active:${botId}`
          );
          await safeRedisOp(
            () => redis.srem('bots:cycling', botId),
            `prune-cycling-set-active:${botId}`
          );
        } else {
          // Bot is truly stale - full cleanup and return to rotation
          cleanedCount++;
          console.warn(`[prune-cycling] Recycling stale cycling bot ${botId}`);
          await cleanupBotState(redis, botId, { reason: 'prune-stale-cycling' });
          await safeRedisOp(
            () => redis.lrem('bots:rotation:queue', 0, botId),
            `prune-remove-from-queue:${botId}`
          );
          await safeRedisOp(
            () => redis.rpush('bots:rotation:queue', botId),
            `prune-add-to-queue:${botId}`
          );
        }
      }
    }
    
    return cleanedCount;
  } catch (error) {
    console.error('[prune-cycling] Error pruning stale cycling bots:', error);
    return 0;
  }
}

/**
 * Prune deployed bots that have no queue state
 * @param {Redis} redis - Redis client
 */
async function pruneDeployedBots(redis) {
  try {
    // First, clean up stale cycling bots (handles MongoDB/connection failures)
    const staleCyclingCleaned = await pruneStaleCyclingBots(redis);
    if (staleCyclingCleaned > 0) {
      console.log(`[prune] Cleaned up ${staleCyclingCleaned} stale cycling bots`);
    }
    
    const deployedBots = await redis.smembers('bots:deployed');
    if (!deployedBots || deployedBots.length === 0) {
      return;
    }
    
    let recycledCount = 0;
    const now = Date.now();
    
    for (const botId of deployedBots) {
      const [inQueue, botState, reservation, isActive, cycleStartStr] = await Promise.all([
        redis.zscore('queue:elo', botId),
        redis.get(`bots:state:${botId}`),
        redis.get(`queue:reservation:${botId}`),
        redis.sismember('bots:active', botId),
        redis.get(`bots:cycling:${botId}`),
      ]);
      
      if (inQueue || botState || reservation || isActive) {
        continue;
      }
      
      // Check if cycling and not stale
      if (cycleStartStr) {
        const cycleAge = now - parseInt(cycleStartStr, 10);
        if (cycleAge < MAX_CYCLING_TIME_MS) {
          console.log(`[prune] Skipping bot ${botId} (cycling for ${Math.round(cycleAge / 1000)}s)`);
          continue;
        }
        // Stale cycling entry - will be cleaned up
        console.log(`[prune] Bot ${botId} has stale cycling entry (${Math.round(cycleAge / 1000)}s)`);
      }
      
      recycledCount++;
      console.warn(`[prune] Bot ${botId} removed from deployed set (no queue state)`);
      await safeRedisOp(
        () => redis.srem('bots:deployed', botId),
        `prune-remove-deployed:${botId}`
      );
      await safeRedisOp(
        () => redis.del(`bots:cycling:${botId}`),
        `prune-cleanup-cycling:${botId}`
      );
      await safeRedisOp(
        () => redis.srem('bots:cycling', botId),
        `prune-cleanup-cycling-set:${botId}`
      );
      await safeRedisOp(
        () => redis.lrem('bots:rotation:queue', 0, botId),
        `prune-remove-queue:${botId}`
      );
      await safeRedisOp(
        () => redis.rpush('bots:rotation:queue', botId),
        `prune-add-queue:${botId}`
      );
    }
    
    if (recycledCount > 0) {
      await checkAndManageBotDeployment(redis);
    }
  } catch (error) {
    console.error('[prune] Error pruning deployed bots:', error);
  }
}

/**
 * Cleanup MongoDB connection
 */
async function closeMongoClient() {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
  }
}

module.exports = {
  getAllBots,
  initializeRotationQueue,
  getBotDeploymentStats,
  checkAndManageBotDeployment,
  deployBot,
  undeployBot,
  recycleBotForRedeploy,
  queueBot,
  rotateBot,
  pruneDeployedBots,
  pruneStaleCyclingBots,
  recoverLimboBots,
  closeMongoClient,
  waitForMatch,
  // Export constants for testing
  MAX_CYCLING_TIME_MS,
  CYCLING_TTL_SECONDS,
};

