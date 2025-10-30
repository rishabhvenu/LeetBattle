'use strict';

const Redis = require('ioredis');
const Colyseus = require('colyseus.js');
const { MongoClient, ObjectId } = require('mongodb');

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
});

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://codeclashers-mongodb:27017/codeclashers';
const COLYSEUS_URL = process.env.COLYSEUS_URL || 'ws://localhost:2567';

let mongoClient = null;

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

async function getDeployedBots() {
  try {
    // Get deployed bot IDs from Redis
    const deployedBotIds = await redis.smembers('bots:deployed');
    
    if (deployedBotIds.length === 0) {
      return [];
    }
    
    // Get bot data from MongoDB
    const client = await getMongoClient();
    const db = client.db('codeclashers');
    const bots = db.collection('bots');
    
    const deployedBots = await bots.find({ 
      _id: { $in: deployedBotIds.map(id => new ObjectId(id)) } 
    }).toArray();
    
    return deployedBots;
  } catch (error) {
    console.error('Error fetching deployed bots:', error);
    return [];
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
    const targetDeployed = minDeployed + queuedPlayersCount;
    
    console.log(`Target deployed count: ${targetDeployed} (min: ${minDeployed} + queued: ${queuedPlayersCount})`);
    
    // Deploy bots up to target count
    const botsToDeploy = Math.min(targetDeployed - deployedBots.length, undeployedBots.length);
    console.log(`Need to deploy ${botsToDeploy} bots to reach target`);
    
    if (botsToDeploy > 0) {
      for (let i = 0; i < botsToDeploy; i++) {
        const bot = undeployedBots[i];
        const botId = bot._id.toString();
        
        // Actually deploy and queue the bot
        await deployBot(botId);
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

function httpBase() {
  // derive http url from WS url
  try {
    const u = new URL(COLYSEUS_URL.replace('ws://', 'http://').replace('wss://', 'https://'));
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'http://localhost:2567';
  }
}

async function fetchJson(method, url, body) {
  const botSecret = process.env.BOT_SERVICE_SECRET;
  const headers = { 'Content-Type': 'application/json' };
  
  // Add bot authentication header for internal endpoints
  if (botSecret) {
    headers['X-Bot-Secret'] = botSecret;
  }
  
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
  return await res.json();
}


// Check how many bots are needed based on queue and minimum
async function getRequiredBotCount() {
  const config = await redis.hgetall('bots:rotation:config');
  const minDeployed = parseInt(config.maxDeployed || '5');
  const queuedPlayersCount = await redis.scard('queue:humans');
  const deployedBots = await redis.smembers('bots:deployed');
  const activeBots = await redis.smembers('bots:active');
  
  // Count bots that are deployed but not in matches (available for queue)
  const availableBots = deployedBots.filter(botId => !activeBots.includes(botId)).length;
  
  // Need: minimum bots + queued players - bots already available
  // But ensure we don't go below minimum
  const neededForQueue = Math.max(0, queuedPlayersCount - availableBots);
  const required = Math.max(minDeployed, minDeployed + neededForQueue);
  
  return { required, minDeployed, queuedPlayersCount, availableBots };
}

// Check and manage bot deployment based on current needs
async function checkAndManageBotDeployment() {
  try {
    const { required, minDeployed, queuedPlayersCount, availableBots } = await getRequiredBotCount();
    const currentDeployed = await redis.scard('bots:deployed');
    
    console.log(`Bot deployment check: required=${required}, current=${currentDeployed}, min=${minDeployed}, queuedPlayers=${queuedPlayersCount}, availableBots=${availableBots}`);
    
    if (currentDeployed < required) {
      // Need more bots
      const needed = required - currentDeployed;
      console.log(`Need ${needed} more bots, deploying from rotation queue`);
      
      for (let i = 0; i < needed; i++) {
        const nextBotId = await redis.lpop('bots:rotation:queue');
        if (nextBotId) {
          await deployBot(nextBotId);
        } else {
          console.log(`No more bots available in rotation queue`);
          break;
        }
      }
    } else if (currentDeployed > required) {
      // Have too many bots - undeploy excess
      const excess = currentDeployed - required;
      console.log(`Have ${excess} excess bots, undeploying`);
      
      const deployedBots = await redis.smembers('bots:deployed');
      const activeBots = await redis.smembers('bots:active');
      
      // Find bots that are not active (not in matches)
      const idleBots = deployedBots.filter(botId => !activeBots.includes(botId));
      
      for (let i = 0; i < Math.min(excess, idleBots.length); i++) {
        await undeployBot(idleBots[i]);
      }
    }
  } catch (error) {
    console.error('Error checking bot deployment:', error);
  }
}

async function rotateBot(completedBotId) {
  try {
    console.log(`Bot ${completedBotId} match completed, evaluating deployment`);
    // Always undeploy the completed bot after one match
    const isCurrentlyDeployed = await redis.sismember('bots:deployed', completedBotId);
    if (isCurrentlyDeployed) {
      await redis.srem('bots:deployed', completedBotId);
      await redis.rpush('bots:rotation:queue', completedBotId);
      console.log(`Bot ${completedBotId} undeployed and added back to rotation queue`);
    }

    // Decide whether to deploy another bot (based on queue and minimum)
    await checkAndManageBotDeployment();
  } catch (error) {
    console.error(`Error rotating bot ${completedBotId}:`, error);
  }
}

async function deployBot(botId) {
  try {
    // Check if bot is already deployed
    const isAlreadyDeployed = await redis.sismember('bots:deployed', botId);
    if (isAlreadyDeployed) {
      console.log(`Bot ${botId} is already deployed, skipping`);
      return;
    }
    
    // CRITICAL: Check Redis to see if bot is already in a match or queue
    const [reservation, isActive, isInQueue] = await Promise.all([
      redis.get(`queue:reservation:${botId}`),
      redis.sismember('bots:active', botId),
      redis.zscore('queue:elo', botId)
    ]);
    
    if (reservation || isActive || isInQueue) {
      console.log(`Bot ${botId} is already in a match/queue (reservation: ${!!reservation}, active: ${isActive}, inQueue: ${!!isInQueue}) - marking as deployed but not re-queueing`);
      // Mark as deployed but don't queue - it's already handled
      await redis.sadd('bots:deployed', botId);
      return;
    }
    
    // Add to deployed set
    await redis.sadd('bots:deployed', botId);
    
    // Get bot data and queue it
    const client = await getMongoClient();
    const db = client.db('codeclashers');
    const bots = db.collection('bots');
    const bot = await bots.findOne({ _id: new ObjectId(botId) });
    
    if (bot && !activeBotCycles.has(botId)) {
      console.log(`Deploying bot ${bot.fullName} (${botId})`);
      const queuePromise = queueBot(bot);
      activeBotCycles.set(botId, queuePromise);
      
      // Handle completion
      queuePromise.finally(() => {
        activeBotCycles.delete(botId);
      });
    }
  } catch (error) {
    console.error(`Error deploying bot ${botId}:`, error);
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
    
    // Remove from deployed set in Redis
    await redis.srem('bots:deployed', botId);
    
    // Add to rotation queue
    await redis.rpush('bots:rotation:queue', botId);
    
    // Stop the bot cycle if it's running
    if (activeBotCycles.has(botId)) {
      console.log(`Stopping bot cycle for ${botId}`);
      // The cycle will stop when it checks deployed status
    }
  } catch (error) {
    console.error(`Error undeploying bot ${botId}:`, error);
  }
}

async function handlePlayerQueue(playerId) {
  try {
    console.log(`Player ${playerId} queued, checking if additional bot needed`);
    
    // Check if we need more bots based on current queue
    await checkAndManageBotDeployment();
  } catch (error) {
    console.error(`Error handling player queue for ${playerId}:`, error);
  }
}

async function handlePlayerDequeue(playerId) {
  try {
    console.log(`Player ${playerId} left queue, checking if we should reduce deployed bots`);
    
    // Check if we have too many bots now
    await checkAndManageBotDeployment();
  } catch (error) {
    console.error(`Error handling player dequeue for ${playerId}:`, error);
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
          await deployBot(nextBotId);
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

// Simple function to queue a bot once - no continuous loop
async function queueBot(bot) {
  const botId = bot._id.toString();
  const rating = bot.stats.rating;
  const client = new Colyseus.Client(COLYSEUS_URL);
  
  console.log(`Queueing bot ${bot.fullName} (${botId}) with rating ${rating}`);
  
  try {
    // Check if bot is still deployed
    const isDeployed = await redis.sismember('bots:deployed', botId);
    if (!isDeployed) {
      console.log(`Bot ${botId} is no longer deployed, not queueing`);
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
      return;
    }
    
    // Connect to queue room and enqueue
    console.log(`Bot ${botId} connecting to queue room`);
    const queueRoom = await client.joinOrCreate('queue', { userId: botId, rating });
    await redis.setex(`bots:state:${botId}`, 3600, 'queued');
    console.log(`Bot ${botId} queued successfully`);
    
    // Set up match notification handler
    let matchFound = false;
    let matchData = null;
    
    queueRoom.onMessage('match_found', (message) => {
      console.log(`Bot ${botId} received match notification`);
      matchFound = true;
      matchData = message;
    });
    
    queueRoom.onLeave(async () => {
      console.log(`Bot ${botId} left queue room`);
      await redis.del(`bots:state:${botId}`).catch(() => {});
    });
    
    queueRoom.onError((error) => {
      console.error(`Bot ${botId} error in queue room:`, error);
    });
    
    // Wait for match notification (or timeout)
    const matchTimeout = 300000; // 5 minutes
    const startTime = Date.now();
    
    while (!matchFound && (Date.now() - startTime) < matchTimeout) {
      const isStillDeployed = await redis.sismember('bots:deployed', botId);
      if (!isStillDeployed) {
        console.log(`Bot ${botId} no longer deployed, leaving queue`);
        break;
      }
      
      const isInQueue = await redis.zscore('queue:elo', botId);
      if (!isInQueue) {
        console.log(`Bot ${botId} no longer in queue`);
        break;
      }
      
      await new Promise(r => setTimeout(r, 2000));
    }
    
    queueRoom.leave();
    
    if (matchFound && matchData) {
      // Bot was matched - join match room
      console.log(`Bot ${botId} joining match room ${matchData.roomId}`);
      await redis.setex(`bots:state:${botId}`, 3600, 'matched');
      
      const matchRoom = await client.joinById(matchData.roomId, { userId: botId });
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
      
      // Notify that match completed - rotation handler will decide what to do
      await redis.publish('bots:commands', JSON.stringify({
        type: 'botMatchComplete',
        botId: botId
      }));
    } else {
      // No match found - undeploy bot and check if we need to deploy another
      console.log(`Bot ${botId} no match found, undeploying`);
      await redis.del(`bots:state:${botId}`);
      await redis.srem('bots:active', botId);
      await redis.del(`queue:reservation:${botId}`);
      await undeployBot(botId);
      
      // Check if we still need bots (in case players are waiting)
      await checkAndManageBotDeployment();
    }
  } catch (e) {
    console.error(`Error queueing bot ${botId}:`, e);
    await redis.del(`bots:state:${botId}`).catch(() => {});
  }
}

// Bot management state
const activeBotCycles = new Map(); // userId -> cycle function
let isRunning = false;

async function startBotCycles() {
  try {
    // Initialize rotation queue
    await initializeRotationQueue();
    
    // Deploy minimum number of bots
    await checkAndManageBotDeployment();
    
    console.log(`Bot deployment initialized`);
  } catch (error) {
    console.error('Error starting bot deployment:', error);
  }
}

async function stopBotCycles() {
  console.log('Stopping all bot cycles...');
  isRunning = false;
  
  // Clear deployed set to signal bots to stop
  await redis.del('bots:deployed');
  
  // Wait for all cycles to complete
  const promises = Array.from(activeBotCycles.values());
  await Promise.allSettled(promises);
  activeBotCycles.clear();
  
  console.log('All bot cycles stopped');
}

// Listen for deployment commands from admin
async function setupCommandListener() {
  const subscriber = redis.duplicate();
  
  await subscriber.subscribe('bots:commands');
  
  subscriber.on('message', async (channel, message) => {
    try {
      const command = JSON.parse(message);
      console.log('Received bot command:', command);
      
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
      } else if (command.type === 'playerQueued') {
        // Handle dynamic bot deployment when player queues
        await handlePlayerQueue(command.playerId);
      } else if (command.type === 'playerDequeued') {
        // Handle bot reduction when player leaves queue
        await handlePlayerDequeue(command.playerId);
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
    
    // Start with initially deployed bots (minimum count)
    isRunning = true;
    await startBotCycles();
    
    console.log('Bot service started successfully (event-driven, no periodic timers)');
    
  } catch (error) {
    console.error('[bots] fatal error:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await stopBotCycles();
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
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


