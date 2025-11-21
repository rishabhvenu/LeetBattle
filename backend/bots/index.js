'use strict';

const Redis = require('ioredis');
const Colyseus = require('colyseus.js');
const { MongoClient, ObjectId } = require('mongodb');
const { randomUUID } = require('crypto');
const {
  clearBotQueueState,
  performRedisCleanup,
} = require('./lib/queueCleanup');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_DEPLOY_DELAY_MS = Math.max(
  0,
  parseInt(process.env.BOT_DEPLOY_DELAY_MS || '200', 10)
);
const DEFAULT_INITIAL_JOIN_DELAY_MS = Math.max(
  0,
  parseInt(process.env.BOT_INITIAL_JOIN_DELAY_MS || '250', 10)
);
const BOT_DEPLOY_CHECK_INTERVAL_MS = Math.max(
  2000,
  parseInt(process.env.BOT_DEPLOY_CHECK_INTERVAL_MS || '5000', 10)
);

if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
  throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
}

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT, 10),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
});

redis.defineCommand('extendLeader', {
  numberOfKeys: 1,
  lua: `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    end
    return 0
  `,
});

if (!process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is required');
}
const MONGODB_URI = process.env.MONGODB_URI;

if (!process.env.COLYSEUS_URL) {
  throw new Error('COLYSEUS_URL environment variable is required');
}
const COLYSEUS_URL = process.env.COLYSEUS_URL;
const BOT_SERVICE_SECRET = process.env.BOT_SERVICE_SECRET || null;
if (!BOT_SERVICE_SECRET) {
  console.warn('[bots] BOT_SERVICE_SECRET is not configured; HTTP cleanup requests will omit authentication headers.');
}

const INSTANCE_ID = process.env.BOT_INSTANCE_ID || randomUUID();
const LEADER_KEY = 'bots:leader';
const LEADER_TTL_MS = Math.max(5000, parseInt(process.env.BOT_LEADER_TTL_MS || '15000', 10));
const LEADER_RENEW_INTERVAL_MS = Math.max(2000, Math.floor(LEADER_TTL_MS / 2));
const BOT_QUEUE_PRUNE_INTERVAL_MS = Math.max(
  5000,
  parseInt(process.env.BOT_QUEUE_PRUNE_INTERVAL_MS || '30000', 10)
);

let mongoClient = null;

const leadership = {
  isLeader: false,
  maintenanceTimer: null,
  pruneTimer: null,
  deployTimer: null,
};

let commandSubscriber = null;

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

// Count how many active bot matches currently include a human opponent.
// A human opponent is either:
// - a guest userId starting with 'guest_'
// - a registered user (valid ObjectId) that is NOT a bot in the bots collection
async function countHumanBotMatches() {
  try {
    const activeBotIds = await redis.smembers('bots:active');
    if (!activeBotIds || activeBotIds.length === 0) {
      return 0;
    }

    const client = await getMongoClient();
    const db = client.db('codeclashers');
    const botsCol = db.collection('bots');

    const seenMatches = new Set();
    let humanBotCount = 0;

    for (const botId of activeBotIds) {
      const matchId = await redis.get(`bot:current_match:${botId}`);
      if (!matchId || seenMatches.has(matchId)) {
        continue;
      }
      seenMatches.add(matchId);

      const raw = await redis.get(`match:${matchId}`);
      if (!raw) {
        continue;
      }

      let opponentId = null;
      try {
        const matchData = JSON.parse(raw);
        // Prefer object form players map if present
        const playersObj = matchData?.players || {};
        const keys = Object.keys(playersObj);
        let playerIds = keys.length > 0 ? keys : null;
        // Fallback to array if schema differs
        if (!playerIds && Array.isArray(matchData?.playerIds)) {
          playerIds = matchData.playerIds;
        }
        if (!playerIds || playerIds.length < 2) {
          continue;
        }
        opponentId = playerIds.find((id) => id !== botId) || null;
      } catch {
        continue;
      }
      if (!opponentId) {
        continue;
      }

      // Determine if opponent is a bot
      const isGuest = typeof opponentId === 'string' && opponentId.startsWith('guest_');
      let opponentIsBot = false;
      if (!isGuest && ObjectId.isValid(opponentId)) {
        const botDoc = await botsCol.findOne(
          { _id: new ObjectId(opponentId) },
          { projection: { _id: 1 } }
        );
        opponentIsBot = Boolean(botDoc);
      }

      if (!opponentIsBot) {
        // Opponent is a human (guest or registered), count this as a human-bot match
        humanBotCount += 1;
      }
    }

    return humanBotCount;
  } catch (error) {
    console.warn('[bots] countHumanBotMatches failed:', error);
    return 0;
  }
}

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

 

async function initializeRotationQueue() {
  try {
    console.log('Initializing rotation queue...');
    
    // Get all bots from MongoDB
    const allBots = await getAllBots();
    console.log(`Found ${allBots.length} total bots`);
    
    // CHECK Redis state - don't clear, preserve existing state
    const existingDeployed = await redis.smembers('bots:deployed');
    const existingActive = await redis.smembers('bots:active');
    
    console.log(`Found ${existingDeployed.length} bots already marked as deployed in Redis`);
    console.log(`Found ${existingActive.length} bots already marked as active in Redis`);
    
    // Check each bot to see if they're actually in a match/reservation
    const botsInMatches = new Set();
    for (const bot of allBots) {
      const botId = bot._id.toString();
      
      // Check if bot has an active reservation (in a match)
      const reservation = await redis.get(`queue:reservation:${botId}`);
      const isActive = await redis.sismember('bots:active', botId);
      
      if (reservation || isActive) {
        // Bot is already in a match - preserve its state, don't try to deploy it
        botsInMatches.add(botId);
        console.log(`Bot ${botId} is already in a match (reservation: ${!!reservation}, active: ${isActive}) - skipping`);
        
        // Ensure it's marked as deployed so we don't try to redeploy
        if (!existingDeployed.includes(botId)) {
          await redis.sadd('bots:deployed', botId);
          console.log(`Marked bot ${botId} as deployed (already in match)`);
        }
      }
    }
    
    console.log(`Found ${botsInMatches.size} bots already in matches - will not redeploy them`);
    
    // Clear rotation queue (we'll rebuild it)
    await redis.del('bots:rotation:queue');
    
    // Separate bots into deployed (already in matches or already deployed) and undeployed
    const deployedBots = allBots.filter(bot => {
      const botId = bot._id.toString();
      return existingDeployed.includes(botId) || botsInMatches.has(botId);
    });
    const undeployedBots = allBots.filter(bot => {
      const botId = bot._id.toString();
      return !existingDeployed.includes(botId) && !botsInMatches.has(botId);
    });
    
    console.log(`After checking Redis: ${deployedBots.length} deployed bots, ${undeployedBots.length} undeployed bots`);
    
    // Initialize rotation config if not exists
    const configExists = await redis.exists('bots:rotation:config');
    if (!configExists) {
      await redis.hset('bots:rotation:config', {
        maxDeployed: '5', // Default to 5 deployed bots
        totalBots: allBots.length.toString()
      });
      console.log('Initialized rotation config with default values');
    } else {
      // Update total bots count
      await redis.hset('bots:rotation:config', 'totalBots', allBots.length.toString());
    }
    
    // Get minimum deployed count from config
    const config = await redis.hgetall('bots:rotation:config');
    const minDeployed = parseInt(config.maxDeployed || '5');
    const queuedPlayersCount = await redis.scard('queue:humans');
    const targetDeployed = minDeployed;
    
    console.log(`Target deployed count: ${targetDeployed} (min: ${minDeployed}, queuedPlayers: ${queuedPlayersCount})`);
    
    // Deploy bots up to target count
    const botsToDeploy = Math.min(targetDeployed - deployedBots.length, undeployedBots.length);
    console.log(`Need to deploy ${botsToDeploy} bots to reach target`);
    
    if (botsToDeploy > 0) {
      for (let i = 0; i < botsToDeploy; i++) {
        const bot = undeployedBots[i];
        const botId = bot._id.toString();
        
        // Actually deploy and queue the bot
        if (i > 0 && DEFAULT_DEPLOY_DELAY_MS > 0) {
          await sleep(DEFAULT_DEPLOY_DELAY_MS);
        }
        await deployBot(botId, {
          context: 'startup',
          initialJoinDelayMs: DEFAULT_INITIAL_JOIN_DELAY_MS,
        });
        deployedBots.push(bot);
      }
      
      // Add remaining undeployed bots to rotation queue
      const remainingBots = undeployedBots.slice(botsToDeploy);
      if (remainingBots.length > 0) {
        const remainingBotIds = remainingBots.map(bot => bot._id.toString());
        for (const botId of remainingBotIds) {
          await redis.rpush('bots:rotation:queue', botId);
        }
        console.log(`Added ${remainingBotIds.length} bots to rotation queue`);
      }
    } else {
      // All bots are already deployed or no bots available
      console.log(`No bots need to be deployed (current: ${deployedBots.length}, target: ${targetDeployed})`);
      
      // Add any remaining undeployed bots to rotation queue
      if (undeployedBots.length > 0) {
        const undeployedBotIds = undeployedBots.map(bot => bot._id.toString());
        for (const botId of undeployedBotIds) {
          await redis.rpush('bots:rotation:queue', botId);
        }
        console.log(`Added ${undeployedBotIds.length} bots to rotation queue`);
      }
    }
    
    return { deployedBots, undeployedBots };
  } catch (error) {
    console.error('Error initializing rotation queue:', error);
    return { deployedBots: [], undeployedBots: [] };
  }
}

 

 


// Get current bot deployment stats
async function getBotDeploymentStats() {
  const config = await redis.hgetall('bots:rotation:config');
  const minDeployed = parseInt(config.maxDeployed || '5');
  const deployedBots = await redis.smembers('bots:deployed');
  const activeBots = await redis.smembers('bots:active');
  
  // Count players marked as needing bot deployment (waited >7s)
  const playersWaiting = await redis.scard('queue:needsBot');
  
  // Count bots that are deployed but not in matches (available for queue)
  const botsInQueue = deployedBots.filter(botId => !activeBots.includes(botId)).length;
  
  // Count total deployed (union of deployed + active sets)
  const totalDeployedSet = new Set([...deployedBots, ...activeBots]);
  const currentDeployed = totalDeployedSet.size;
  
  const totalBots = parseInt(config.totalBots || '0', 10);
  
  return {
    minDeployed,
    currentDeployed,
    playersWaiting,
    botsInQueue,
    totalBots,
    deployedBots: deployedBots.length,
    activeBots: activeBots.length,
  };
}

// Check and manage bot deployment based on current needs
async function checkAndManageBotDeployment(options = {}) {
  try {
    const {
      forceDeploy = false,
      context = 'standard',
      deployDelayMs: overrideDeployDelayMs,
      initialJoinDelayMs: overrideJoinDelayMs,
    } = options;
    if (!leadership.isLeader) {
      console.log('[checkAndManageBotDeployment] Not leader, skipping');
      return;
    }
    
    const stats = await getBotDeploymentStats();
    const { minDeployed, currentDeployed, playersWaiting, botsInQueue, totalBots } = stats;
    
    const deployDelayMs = forceDeploy
      ? 0
      : typeof overrideDeployDelayMs === 'number'
      ? Math.max(0, overrideDeployDelayMs)
      : DEFAULT_DEPLOY_DELAY_MS;
    const initialJoinDelayMs = forceDeploy
      ? 0
      : typeof overrideJoinDelayMs === 'number'
      ? Math.max(0, overrideJoinDelayMs)
      : DEFAULT_INITIAL_JOIN_DELAY_MS;
    
    console.log(
      `Bot deployment check: current=${currentDeployed} (${stats.deployedBots} queuing + ${stats.activeBots} in matches), min=${minDeployed}, playersWaiting=${playersWaiting}, botsInQueue=${botsInQueue}, totalBots=${totalBots}, forceDeploy=${forceDeploy} context=${context}`
    );
    
    let botsToDeploy = 0;
    
    // Step 1: Ensure minimum 5 bots deployed
    if (currentDeployed < minDeployed) {
      botsToDeploy = minDeployed - currentDeployed;
      console.log(`Below minimum: need ${botsToDeploy} bots to reach minimum of ${minDeployed}`);
    } else if (playersWaiting > 0) {
      // Step 2: If we have minimum, check for players waiting >7s
      // Deploy bots = playersWaiting - botsInQueue
      botsToDeploy = Math.max(0, playersWaiting - botsInQueue);
      if (botsToDeploy > 0) {
        console.log(`${playersWaiting} players waiting, ${botsInQueue} bots in queue, need ${botsToDeploy} more bots`);
      }
    }
    
    // Cap at totalBots if set
    const maxCanDeploy = totalBots > 0 ? totalBots - currentDeployed : botsToDeploy;
    botsToDeploy = Math.min(botsToDeploy, maxCanDeploy);
    
    if (botsToDeploy > 0) {
      const queueLength = await redis.llen('bots:rotation:queue');
      console.log(`Deploying ${botsToDeploy} bots, rotation queue length: ${queueLength}`);
      
      for (let i = 0; i < botsToDeploy; i++) {
        if (deployDelayMs > 0 && i > 0) {
          await sleep(deployDelayMs);
        }
        const nextBotId = await redis.lpop('bots:rotation:queue');
        if (nextBotId) {
          console.log(`Deploying bot ${nextBotId} from rotation queue`);
          await deployBot(nextBotId, {
            context,
            initialJoinDelayMs,
          });
        } else {
          console.log(`No more bots available in rotation queue`);
          break;
        }
      }
    } else {
      // Check if we have excess bots to undeploy
      const excess = currentDeployed - minDeployed;
      if (excess > 0 && playersWaiting === 0) {
        console.log(`Have ${excess} excess bots, undeploying`);
        
        const deployedBots = await redis.smembers('bots:deployed');
        const activeBots = await redis.smembers('bots:active');
        
        // Find bots that are not active (not in matches)
        const idleBots = deployedBots.filter(botId => !activeBots.includes(botId));
        
        // Double-check each bot before undeploying
        const botsToUndeploy = [];
        for (const botId of idleBots.slice(0, Math.min(excess, idleBots.length))) {
          const [hasReservation, isInQueue] = await Promise.all([
            redis.get(`queue:reservation:${botId}`),
            redis.zscore('queue:elo', botId)
          ]);
        
        if (!hasReservation && !isInQueue) {
          botsToUndeploy.push(botId);
        } else {
          console.log(`[DEBUG] Skipping undeploy of bot ${botId} - has reservation: ${!!hasReservation}, inQueue: ${!!isInQueue}`);
        }
      }
      
      console.log(`[DEBUG] Actually undeploying ${botsToUndeploy.length} bots: ${botsToUndeploy.join(', ')}`);
      
      for (const botId of botsToUndeploy) {
        await undeployBot(botId);
      }
      }
    }
  } catch (error) {
    console.error('Error checking bot deployment:', error);
  }
}

async function recycleBotForRedeploy(botId, reason, { queueRoom } = {}) {
  console.warn(`[requeue] Recycling bot ${botId} (${reason})`);

  if (queueRoom) {
    try {
      queueRoom.leave();
    } catch {
      // ignore close errors
    }
  }

  await redis.del(`bots:state:${botId}`).catch(() => {});
  await redis.srem('bots:active', botId).catch(() => {});
  await redis.srem('bots:cycling', botId).catch(() => {});
  await redis.lrem('bots:rotation:queue', 0, botId).catch(() => {});
  await redis.rpush('bots:rotation:queue', botId).catch(() => {});

  try {
    await checkAndManageBotDeployment();
  } catch (deploymentError) {
    console.error(`[requeue] Failed to trigger deployment check for bot ${botId}:`, deploymentError);
  }
}

async function pruneDeployedBots() {
  try {
    const deployedBots = await redis.smembers('bots:deployed');
    if (!deployedBots || deployedBots.length === 0) {
      return;
    }

    let recycledCount = 0;
    for (const botId of deployedBots) {
      const [inQueue, botState, reservation, isActive, isCycling] = await Promise.all([
        redis.zscore('queue:elo', botId),
        redis.get(`bots:state:${botId}`),
        redis.get(`queue:reservation:${botId}`),
        redis.sismember('bots:active', botId),
        redis.sismember('bots:cycling', botId),
      ]);

      if (inQueue || botState || reservation || isActive) {
        continue;
      }

      if (isCycling) {
        console.log(`[prune] Skipping bot ${botId} (currently cycling)`);
        continue;
      }

      recycledCount += 1;
      console.warn(`[prune] Bot ${botId} removed from deployed set (no queue state)`);
      await redis.srem('bots:deployed', botId);
      await redis.srem('bots:cycling', botId).catch(() => {});
      await redis.lrem('bots:rotation:queue', 0, botId).catch(() => {});
      await redis.rpush('bots:rotation:queue', botId).catch(() => {});
    }

    if (recycledCount > 0) {
      await checkAndManageBotDeployment();
    }
  } catch (error) {
    console.error('[prune] Error pruning deployed bots:', error);
  }
}

async function rotateBot(completedBotId) {
  try {
    console.log(`Bot ${completedBotId} match completed, evaluating deployment`);
    
    // CRITICAL: Check if bot is still active in other matches before rotating
    // However, we should add a small delay check since MatchRoom might have just removed it
    // but there could be a race condition with queueBot cleanup
    const isStillActive = await redis.sismember('bots:active', completedBotId);
    if (isStillActive) {
      // Check again after a short delay in case cleanup is in progress
      await sleep(100);
      const isStillActiveAfterDelay = await redis.sismember('bots:active', completedBotId);
      if (isStillActiveAfterDelay) {
        console.log(`Bot ${completedBotId} is still active in another match after delay check, skipping rotation`);
        return;
      }
      console.log(`Bot ${completedBotId} was active but is now inactive after delay, proceeding with rotation`);
    }
    
    // Check if bot has a reservation or is in queue (shouldn't rotate if still queuing)
    const [hasReservation, isInQueue] = await Promise.all([
      redis.get(`queue:reservation:${completedBotId}`),
      redis.zscore('queue:elo', completedBotId)
    ]);
    
    if (hasReservation || isInQueue) {
      console.log(`Bot ${completedBotId} still has reservation or is in queue (reservation: ${!!hasReservation}, inQueue: ${!!isInQueue}), skipping rotation`);
      return;
    }
    
    // CRITICAL: Clear the cycling guard so the bot can be redeployed immediately
    // This prevents "already has an active cycle" errors when trying to redeploy
    // The queueBot function may still be running cleanup, but we can safely clear this guard
    // since we know the match is complete
    await redis.srem('bots:cycling', completedBotId).catch(() => {});
    
    const wasDeployed = await redis.sismember('bots:deployed', completedBotId);
    if (wasDeployed) {
      await redis.srem('bots:deployed', completedBotId);
    }

    // Ensure the bot is not already in the rotation queue before re-adding
    await redis.lrem('bots:rotation:queue', 0, completedBotId);
    await redis.rpush('bots:rotation:queue', completedBotId);
    
    console.log(`Bot ${completedBotId} recycled into rotation queue (wasDeployed: ${wasDeployed})`);

    // Decide whether to deploy another bot (based on queue and minimum)
    await checkAndManageBotDeployment();
  } catch (error) {
    console.error(`Error rotating bot ${completedBotId}:`, error);
  }
}

async function deployBot(botId, options = {}) {
  try {
    const {
      initialJoinDelayMs = 0,
      context = 'standard',
    } = options;
    console.log(`[deployBot] Starting deployment for bot ${botId} (context=${context}, initialJoinDelayMs=${initialJoinDelayMs})`);
    
    // Acquire cycle guard in Redis to avoid duplicate cycles across processes
    const acquired = await redis.sadd('bots:cycling', botId);
    if (acquired === 0) {
      console.log(`Bot ${botId} already has an active cycle (redis), skipping`);
      return;
    }
    
    // CRITICAL: Clean up any stale state before checking
    // This ensures bots can be deployed even if there's leftover state from previous runs
    const [reservation, isActive, isInQueue] = await Promise.all([
      redis.get(`queue:reservation:${botId}`),
      redis.sismember('bots:active', botId),
      redis.zscore('queue:elo', botId)
    ]);
    
    console.log(`[deployBot] Bot ${botId} state check - reservation: ${!!reservation}, active: ${isActive}, inQueue: ${!!isInQueue}`);
    
    // If bot has stale state but is not actually active (no active cycle), clean it up
    if (reservation || isActive || isInQueue) {
      console.log(`Bot ${botId} has stale state (reservation: ${!!reservation}, active: ${isActive}, inQueue: ${!!isInQueue}) - cleaning up`);
      const cleanupResult = await performRedisCleanup(botId, redis, { logger: console });
      const failures = Object.values(cleanupResult).filter((item) => !item.success).length;
      if (failures === 0) {
        console.log(`Cleaned up stale state for bot ${botId}`);
      } else {
        console.warn(`Stale state cleanup for bot ${botId} completed with ${failures} failure(s)`);
      }
    }
    
    // After cleanup, proceed with deployment (we already verified no active cycle exists)
    
    // Add to deployed set
    const added = await redis.sadd('bots:deployed', botId);
    if (added === 0) {
      console.log(`Bot ${botId} already marked as deployed, continuing with queue cycle`);
    } else {
      console.log(`Bot ${botId} marked as deployed`);
    }
    
    // Get bot data and queue it
    const client = await getMongoClient();
    const db = client.db('codeclashers');
    const bots = db.collection('bots');
    const bot = await bots.findOne({ _id: new ObjectId(botId) });
    
    if (!bot) {
      console.error(`Bot ${botId} not found in MongoDB, cannot deploy`);
      // Remove from deployed set since we can't deploy it
      await redis.srem('bots:deployed', botId);
      await redis.srem('bots:cycling', botId);
      return;
    }
    
    console.log(`Deploying bot ${bot.fullName} (${botId})`);
    // Start the bot queue/match flow; queueBot will always clean up bots:cycling
    queueBot(bot, { initialJoinDelayMs, context }).catch((error) => {
      console.error(`Bot ${botId} cycle error:`, error);
      // Ensure guard cleanup on unexpected errors
      redis.srem('bots:cycling', botId).catch(() => {});
    });
  } catch (error) {
    console.error(`Error deploying bot ${botId}:`, error);
    // Best-effort guard cleanup if we acquired it earlier
    await redis.srem('bots:cycling', botId).catch(() => {});
  }
}

async function undeployBot(botId) {
  try {
    console.log(`Undeploying bot ${botId}`);
    
    // SAFETY CHECK: Don't undeploy bots that are currently in active matches
    const isActive = await redis.sismember('bots:active', botId);
    if (isActive) {
      console.log(`Bot ${botId} is currently in an active match, cannot undeploy`);
      return;
    }
    
    // SAFETY CHECK: Don't undeploy bots that are currently in queue or have a reservation
    const [reservation, isInQueue] = await Promise.all([
      redis.get(`queue:reservation:${botId}`),
      redis.zscore('queue:elo', botId)
    ]);
    
    if (reservation || isInQueue) {
      console.log(`Bot ${botId} is currently queued or has a reservation (reservation: ${!!reservation}, inQueue: ${!!isInQueue}), cannot undeploy`);
      return;
    }
    
    // Remove from deployed set in Redis
    const removed = await redis.srem('bots:deployed', botId);
    if (removed === 0) {
      console.log(`Bot ${botId} was not marked as deployed, skipping rotation enqueue`);
      return;
    }
    
    // Add to rotation queue
    await redis.rpush('bots:rotation:queue', botId);
    
    // Signal cycle completion guard (if any)
    await redis.srem('bots:cycling', botId).catch(() => {});
  } catch (error) {
    console.error(`Error undeploying bot ${botId}:`, error);
  }
}

async function handleRotationConfigChange(newMaxDeployed) {
  try {
    console.log(`Updating rotation config: maxDeployed = ${newMaxDeployed}`);
    
    // Update config in Redis
    await redis.hset('bots:rotation:config', 'maxDeployed', newMaxDeployed.toString());
    
    // Get current deployed count
    const currentDeployed = await redis.scard('bots:deployed');
    
    if (currentDeployed < newMaxDeployed) {
      // Need to deploy more bots
      const botsToDeploy = newMaxDeployed - currentDeployed;
      console.log(`Need to deploy ${botsToDeploy} more bots`);
      
      for (let i = 0; i < botsToDeploy; i++) {
        const nextBotId = await redis.lpop('bots:rotation:queue');
        if (nextBotId) {
          if (DEFAULT_DEPLOY_DELAY_MS > 0 && i > 0) {
            await sleep(DEFAULT_DEPLOY_DELAY_MS);
          }
          await deployBot(nextBotId, {
            context: 'rotationConfig',
            initialJoinDelayMs: DEFAULT_INITIAL_JOIN_DELAY_MS,
          });
          console.log(`Deployed bot ${nextBotId} to meet new maxDeployed target`);
        } else {
          console.log(`No more bots available in rotation queue`);
          break;
        }
      }
    } else if (currentDeployed > newMaxDeployed) {
      // Need to undeploy some bots (but only if no players are waiting)
      // For now, we'll just log this - actual undeployment will happen naturally through rotation
      console.log(`Current deployed (${currentDeployed}) exceeds new max (${newMaxDeployed}), will reduce through natural rotation`);
    }
  } catch (error) {
    console.error(`Error handling rotation config change:`, error);
  }
}

// Helper: wait for match_found message (no timeout)
function waitForMatch(queueRoom) {
  return new Promise((resolve) => {
    const onMatch = (message) => {
      resolve(message || null);
    };
    queueRoom.onMessage('match_found', onMatch);
  });
}

// Simple function to queue a bot once - event-driven (no polling loop)
async function queueBot(bot, options = {}) {
  const botId = bot._id.toString();
  const rating = bot.stats.rating;
  const client = new Colyseus.Client(COLYSEUS_URL);
  const { initialJoinDelayMs = 0 } = options;
  
  console.log(`Queueing bot ${bot.fullName} (${botId}) with rating ${rating}`);

  let cycleGuardReleased = false;
  const releaseCycleGuard = async () => {
    if (!cycleGuardReleased) {
      cycleGuardReleased = true;
      await redis.srem('bots:cycling', botId).catch(() => {});
    }
  };

  try {
    // Check if bot is still deployed
    const isDeployed = await redis.sismember('bots:deployed', botId);
    if (!isDeployed) {
      console.log(`Bot ${botId} is no longer deployed, not queueing`);
      await releaseCycleGuard();
      return;
    }
    
    // Check if bot already has a match, is active, or is already in queue
    const [reservation, isActive, isInQueue] = await Promise.all([
      redis.get(`queue:reservation:${botId}`),
      redis.sismember('bots:active', botId),
      redis.zscore('queue:elo', botId)
    ]);

    if (reservation || isActive || isInQueue) {
      console.log(`Bot ${botId} already has match/queue (reservation: ${!!reservation}, active: ${isActive}, inQueue: ${!!isInQueue}), skipping queue`);
      await releaseCycleGuard();
      return;
    }
    
    // CRITICAL: Clear any stale Colyseus reservations before joining
    // This prevents "seat reservation expired" errors
    const cleanupResult = await clearBotQueueState(botId, redis, {
      colyseusUrl: COLYSEUS_URL,
      botServiceSecret: BOT_SERVICE_SECRET,
      logger: console,
    });
    if (cleanupResult.httpResult.attempted) {
      console.log(
        `[cleanup] Pre-join HTTP status for bot ${botId}: ${cleanupResult.httpResult.status ?? 'n/a'} (${cleanupResult.httpResult.ok ? 'ok' : 'not ok'})`
      );
    } else {
      console.log(`[cleanup] HTTP queue clear not attempted for bot ${botId} (${cleanupResult.httpResult.reason || 'no reason provided'})`);
    }
    if (cleanupResult.redisResult) {
      const redisFailures = Object.values(cleanupResult.redisResult).filter((item) => !item.success).length;
      console.log(`[cleanup] Redis cleanup result for bot ${botId}: ${redisFailures === 0 ? 'all steps succeeded' : `${redisFailures} step(s) failed`}`);
    }
    
    // Connect to queue room and enqueue
    console.log(`Bot ${botId} connecting to queue room`);
    let queueRoom;
    let joinErrorOccurred = false;
    
    // Join with targeted retries to handle transient reservation expiry (4002)
    const maxAttempts = 5;
    let attempt = 0;
    while (true) {
      if (attempt === 0 && initialJoinDelayMs > 0) {
        await sleep(initialJoinDelayMs);
      }
      try {
        queueRoom = await client.joinOrCreate('queue', { userId: botId, rating });
        queueRoom.onMessage('queued', (payload) => {
          const position = payload && typeof payload.position !== 'undefined' ? payload.position : 'unknown';
          console.log(`[queue] Bot ${botId} received queued confirmation (position: ${position})`);
        });
        break;
      } catch (err) {
        const errMsg = String(err?.message || err);
        const isReservationError = errMsg.includes('seat reservation expired') || errMsg.includes('4002');
        attempt++;
        if (!isReservationError || attempt >= maxAttempts) {
          throw err;
        }
        const backoffMs =
          Math.min(1500, 150 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 150);
        console.warn(`Bot ${botId} joinOrCreate retry ${attempt}/${maxAttempts} after reservation error; waiting ${backoffMs}ms`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
      
    try {
      // Set up error handler BEFORE doing anything else
      queueRoom.onError((error) => {
        console.error(`Bot ${botId} error in queue room:`, error);
        joinErrorOccurred = true;
        recycleBotForRedeploy(botId, 'queue room error', { queueRoom }).catch(() => {});
      });
      
      // Wait a moment to catch any immediate errors from the connection
      await new Promise(r => setTimeout(r, 500));
      
      // Check if error occurred during join
      if (joinErrorOccurred) {
        console.error(`Bot ${botId} join error occurred during connection setup`);
        await releaseCycleGuard();
        return;
      }
    } catch (joinError) {
      console.error(`Bot ${botId} failed to join queue room:`, joinError);
      await recycleBotForRedeploy(botId, 'failed to join queue room', { queueRoom });
      return;
    }
    
    await redis.setex(`bots:state:${botId}`, 3600, 'queued');

    const queueMembership = await redis.zscore('queue:elo', botId);
    if (queueMembership === null) {
      console.warn(`[queue] Bot ${botId} reported queued but is missing from queue:elo; recycling`);
      await recycleBotForRedeploy(botId, 'missing queue membership after queued ack', { queueRoom });
      return;
    }
    console.log(`Bot ${botId} queued successfully`);
    
    // Set up queueRoom leave cleanup
    queueRoom.onLeave(async () => {
      console.log(`Bot ${botId} left queue room`);
      await redis.del(`bots:state:${botId}`).catch(() => {});
    });
    
    // Remove the duplicate onError handler - we already set it up above
    // queueRoom.onError is already set above
    
    // Wait for match notification (no timeout)
    const matchDataInitial = joinErrorOccurred ? null : await waitForMatch(queueRoom);
    
    // If error occurred, exit early (cleanup already done in error handler)
    if (joinErrorOccurred) {
      console.log(`Bot ${botId} join error occurred, exiting queueBot`);
      await releaseCycleGuard();
      return;
    }
    
    // Don't leave queue room yet - wait until we've joined the match room
    
    // Use the received match data directly (event-driven)
    const matchData = matchDataInitial;
    
    if (matchData) {
      // Bot was matched - mark as active but keep in deployed until successfully joined
      await redis.sadd('bots:active', botId);
      console.log(`Bot ${botId} matched - marked as active`);
      
      // CRITICAL: Verify reservation is still valid before joining
      const reservationCheck = await redis.get(`queue:reservation:${botId}`);
      if (!reservationCheck) {
        console.error(`Bot ${botId} reservation expired before joining match room`);
        await recycleBotForRedeploy(botId, 'reservation expired before match join', { queueRoom });
        return;
      }
      
      // CRITICAL: Join match room FIRST before leaving queue room to prevent reservation expiry
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
          // Handler intentionally left blank to acknowledge updates and suppress client warnings.
        });
        console.log(`Bot ${botId} successfully joined match room ${matchData.roomId}`);
      } catch (joinError) {
        console.error(`Bot ${botId} failed to join match room:`, joinError);
        await redis.del(`queue:reservation:${botId}`).catch(() => {});
        await recycleBotForRedeploy(botId, 'failed to join match room', { queueRoom });
        return;
      }
      
      // Only remove from deployed AFTER successfully joining match room
      // CRITICAL: Double-check bot is not still in queue before removing
      const stillInQueue = await redis.zscore('queue:elo', botId);
      if (stillInQueue) {
        console.warn(`[WARNING] Bot ${botId} is still in queue but successfully joined match - removing from queue first`);
        await redis.zrem('queue:elo', botId);
      }
      await redis.srem('bots:deployed', botId);
      console.log(`Bot ${botId} successfully joined match - removed from deployed set`);
      
      // Now it's safe to leave the queue room
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
      
      // Clean up bot state and active set
      await redis.del(`bots:state:${botId}`);
      await redis.srem('bots:active', botId);
      await redis.del(`queue:reservation:${botId}`);
      await releaseCycleGuard();
      
      // NOTE: botMatchComplete is already published by MatchRoom.ts when the match ends
      // No need to publish it again here to avoid duplicate messages
      // The MatchRoom publishes after atomically removing from bots:active, which ensures
      // rotateBot will see the bot as inactive and add it to rotation queue
      
      // Notify that match completed - rotation handler will decide what to do
    }
  } catch (e) {
    console.error(`Error queueing bot ${botId}:`, e);
    await redis.del(`bots:state:${botId}`).catch(() => {});
    // Ensure bot is cleaned up properly
    await redis.srem('bots:active', botId).catch(() => {});
    await releaseCycleGuard();
    // Re-add bot to rotation queue if it was deployed but errored
    const wasDeployed = await redis.sismember('bots:deployed', botId);
    if (wasDeployed) {
      console.log(`Bot ${botId} errored while deployed, re-adding to rotation queue`);
      await redis.lrem('bots:rotation:queue', 0, botId);
      await redis.rpush('bots:rotation:queue', botId);
      await redis.srem('bots:deployed', botId);
      // Trigger deployment check to replace the failed bot
      await checkAndManageBotDeployment();
    }
  }
}

// Bot cycle coordination is stored in Redis set 'bots:cycling'

async function startBotCycles() {
  if (!leadership.isLeader) {
    console.log('Skipping startBotCycles (not leader)');
    return;
  }
  try {
    // Initialize rotation queue
    await initializeRotationQueue();
    
    // Deploy minimum number of bots
    await checkAndManageBotDeployment();
    
    if (!leadership.deployTimer) {
      leadership.deployTimer = setInterval(() => {
        if (!leadership.isLeader) {
          return;
        }
        checkAndManageBotDeployment().catch(() => {});
      }, BOT_DEPLOY_CHECK_INTERVAL_MS);
    }
    
    await pruneDeployedBots();
    
    if (!leadership.pruneTimer) {
      leadership.pruneTimer = setInterval(() => {
        if (!leadership.isLeader) {
          return;
        }
        pruneDeployedBots().catch(() => {});
      }, BOT_QUEUE_PRUNE_INTERVAL_MS);
    }
    
    console.log(`Bot deployment initialized`);
  } catch (error) {
    console.error('Error starting bot deployment:', error);
  }
}

async function stopBotCycles({ clearRedis = true } = {}) {
  console.log('Stopping all bot cycles...');
  
  // Clear deployed set to signal bots to stop (optional during leadership handover)
  if (clearRedis) {
  await redis.del('bots:deployed');
  }

  if (leadership.pruneTimer) {
    clearInterval(leadership.pruneTimer);
    leadership.pruneTimer = null;
  }
  if (leadership.deployTimer) {
    clearInterval(leadership.deployTimer);
    leadership.deployTimer = null;
  }
  
  console.log('All bot cycles stopped signal sent');
}

async function promoteToLeader(reason = 'acquired leadership') {
  if (leadership.isLeader) {
    return;
  }
  leadership.isLeader = true;
  console.log(`[leader] ${INSTANCE_ID} became leader (${reason})`);
  await startBotCycles();
}

async function demoteLeader(reason = 'leadership lost') {
  if (!leadership.isLeader) {
    return;
  }
  leadership.isLeader = false;
  console.log(`[leader] ${INSTANCE_ID} relinquishing leadership (${reason})`);
  await stopBotCycles({ clearRedis: false });
}

async function tryAcquireLeadership() {
  try {
    const result = await redis.set(LEADER_KEY, INSTANCE_ID, 'NX', 'PX', LEADER_TTL_MS);
    if (result === 'OK') {
      await promoteToLeader('lock acquired');
      return true;
    }

    const currentLeader = await redis.get(LEADER_KEY);
    if (currentLeader === INSTANCE_ID) {
      await promoteToLeader('lock already held');
      return true;
    }

    if (!currentLeader) {
      // Lock expired between SET and GET, retry quickly
      return tryAcquireLeadership();
    }

    if (leadership.isLeader && currentLeader !== INSTANCE_ID) {
      await demoteLeader('another instance acquired lock');
    }
    return false;
  } catch (error) {
    console.error('Leader election error:', error);
    return false;
  }
}

async function renewLeadership() {
  if (!leadership.isLeader) {
    return;
  }
  try {
    const extended = await redis.extendLeader(LEADER_KEY, INSTANCE_ID, LEADER_TTL_MS);
    if (extended !== 1) {
      await demoteLeader('failed to extend leader lease');
    }
  } catch (error) {
    console.error('Leader lease renewal error:', error);
  }
}

function scheduleLeadershipMaintenance() {
  if (leadership.maintenanceTimer) {
    return;
  }
  leadership.maintenanceTimer = setInterval(async () => {
    if (leadership.isLeader) {
      await renewLeadership();
    } else {
      await tryAcquireLeadership();
    }
  }, LEADER_RENEW_INTERVAL_MS);
}

async function releaseLeadership() {
  try {
    const current = await redis.get(LEADER_KEY);
    if (current === INSTANCE_ID) {
      await redis.del(LEADER_KEY);
    }
  } catch (error) {
    console.error('Error releasing leadership lock:', error);
  }
}

async function initializeLeaderElection() {
  await tryAcquireLeadership();
  scheduleLeadershipMaintenance();
}

// Listen for deployment commands from admin
async function setupCommandListener() {
  if (commandSubscriber) {
    return;
  }
  commandSubscriber = redis.duplicate();
  
  await commandSubscriber.subscribe('bots:commands');
  
  commandSubscriber.on('message', async (channel, message) => {
    try {
      const command = JSON.parse(message);
      console.log('Received bot command:', command);

      if (!leadership.isLeader) {
        console.log('Ignoring bot command (not leader):', command.type);
        return;
      }
      
      if (command.type === 'deploy') {
        // Refresh bot cycles
        await startBotCycles();
      } else if (command.type === 'stop') {
        // Stop specific bots or all bots
        if (command.botIds && command.botIds.length > 0) {
          // Stop specific bots
          for (const botId of command.botIds) {
            await redis.srem('bots:deployed', botId);
          }
        } else {
          // Stop all bots
          await stopBotCycles();
        }
      } else if (command.type === 'botMatchComplete') {
        // Handle bot rotation after match completion
        await rotateBot(command.botId);
      } else if (command.type === 'playerQueued' || command.type === 'playerDequeued') {
        // These events are handled by the 5-second checkAndManageBotDeployment timer
        // No immediate action needed - timer will adjust bot deployment within 5 seconds
      } else if (command.type === 'rotateConfig') {
        // Handle rotation config changes
        await handleRotationConfigChange(command.maxDeployed);
      }
    } catch (error) {
      console.error('Error processing bot command:', error);
    }
  });
}

async function main() {
  console.log(`[bots] starting bot service -> ${COLYSEUS_URL}`);
  
  try {
    // Connect to MongoDB
    await getMongoClient();
    console.log('Connected to MongoDB');
    
    // Setup command listener
    await setupCommandListener();
    console.log('Bot command listener started');
    
    // Orchestrate leadership election loop
    await initializeLeaderElection();
    
    console.log('Bot service started successfully (event-driven, leader aware)');
    
  } catch (error) {
    console.error('[bots] fatal error:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  if (leadership.maintenanceTimer) {
    clearInterval(leadership.maintenanceTimer);
  }
  await releaseLeadership();
  await stopBotCycles();
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  if (leadership.maintenanceTimer) {
    clearInterval(leadership.maintenanceTimer);
  }
  await releaseLeadership();
  await stopBotCycles();
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

main().catch((e) => {
  console.error('[bots] fatal error:', e);
  process.exit(1);
});


