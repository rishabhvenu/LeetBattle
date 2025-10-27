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
    
    // Clear existing rotation queue and bot states
    await redis.del('bots:rotation:queue');
    await redis.del('bots:active'); // Clear active bots set
    await redis.del('bots:deployed'); // Clear deployed bots set
    
    // Clear all bot states and reservations
    for (const bot of allBots) {
      const botId = bot._id.toString();
      await redis.del(`bots:state:${botId}`);
      await redis.del(`queue:reservation:${botId}`); // Clear stale match reservations
    }
    
    console.log('Cleared all bot states and reservations');
    
    // Get deployed bot IDs from Redis
    const deployedBotIds = await redis.smembers('bots:deployed');
    const deployedBots = allBots.filter(bot => deployedBotIds.includes(bot._id.toString()));
    const undeployedBots = allBots.filter(bot => !deployedBotIds.includes(bot._id.toString()));
    
    console.log(`Found ${deployedBots.length} deployed bots, ${undeployedBots.length} undeployed bots`);
    
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
        
        // Add to deployed set
        await redis.sadd('bots:deployed', botId);
        deployedBots.push(bot);
        
        console.log(`Deployed bot ${botId} (${bot.fullName})`);
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


async function rotateBot(completedBotId) {
  try {
    console.log(`Rotating bot ${completedBotId} after match completion`);
    
    // Remove bot from deployed set
    await redis.srem('bots:deployed', completedBotId);
    
    // Add bot to end of rotation queue
    await redis.rpush('bots:rotation:queue', completedBotId);
    
    console.log(`Bot ${completedBotId} added to rotation queue`);
    
    // Check if we need to maintain minimum deployed count
    const config = await redis.hgetall('bots:rotation:config');
    const maxDeployed = parseInt(config.maxDeployed || '5');
    const queuedPlayersCount = await redis.scard('queue:humans'); // Use correct key for human players
    const currentDeployed = await redis.scard('bots:deployed');
    
    // Calculate target: maxDeployed (minimum) + queued players
    const targetDeployed = maxDeployed + queuedPlayersCount;
    
    console.log(`Rotation check: current=${currentDeployed}, target=${targetDeployed}, maxDeployed=${maxDeployed}, queuedHumans=${queuedPlayersCount}`);
    
    if (currentDeployed < targetDeployed) {
      const nextBotId = await redis.lpop('bots:rotation:queue');
      if (nextBotId) {
        console.log(`Deploying bot ${nextBotId} to maintain deployed count (${currentDeployed} -> ${currentDeployed + 1})`);
        await deployBot(nextBotId);
      } else {
        console.log(`No bots available in rotation queue to maintain deployed count`);
      }
    } else {
      console.log(`Deployed count sufficient (${currentDeployed}/${targetDeployed})`);
    }
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
    
    // Validate deployment limits
    const config = await redis.hgetall('bots:rotation:config');
    const maxDeployed = parseInt(config.maxDeployed || '5');
    const currentDeployed = await redis.scard('bots:deployed');
    const queuedPlayersCount = await redis.scard('queue:humans'); // Use correct key for human players
    const targetDeployed = maxDeployed + queuedPlayersCount;
    
    if (currentDeployed >= targetDeployed) {
      console.log(`Cannot deploy bot ${botId}: already at target deployed count (${currentDeployed}/${targetDeployed})`);
      return;
    }
    
    // Add to deployed set
    await redis.sadd('bots:deployed', botId);
    
    // Get bot data and start cycle
    const client = await getMongoClient();
    const db = client.db('codeclashers');
    const bots = db.collection('bots');
    const bot = await bots.findOne({ _id: new ObjectId(botId) });
    if (bot && !activeBotCycles.has(botId)) {
      console.log(`Starting bot cycle for ${bot.fullName} (${botId})`);
      const cyclePromise = cycleBot(bot);
      activeBotCycles.set(botId, cyclePromise);
      
      // Handle cycle completion
      cyclePromise.finally(() => {
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
    
    // NOTE: QueueRoom already manages queue:humans and queue:players sets
    // We should NOT modify them here to avoid double-counting
    
    // Get current counts
    const config = await redis.hgetall('bots:rotation:config');
    const maxDeployed = parseInt(config.maxDeployed || '5');
    const currentDeployed = await redis.scard('bots:deployed');
    const queuedPlayersCount = await redis.scard('queue:humans'); // Use human players count
    
    // Calculate target deployed count: maxDeployed + queued players
    const targetDeployed = maxDeployed + queuedPlayersCount;
    
    console.log(`Deployment check: current=${currentDeployed}, target=${targetDeployed}, maxDeployed=${maxDeployed}, queuedPlayers=${queuedPlayersCount}`);
    
    if (currentDeployed < targetDeployed) {
      // Need to deploy additional bot
    const nextBotId = await redis.lpop('bots:rotation:queue');
    if (nextBotId) {
      await deployBot(nextBotId);
        console.log(`Deployed bot ${nextBotId} from rotation queue for player ${playerId} (${currentDeployed} -> ${currentDeployed + 1})`);
      } else {
        console.log(`No bots available in rotation queue for player ${playerId}`);
      }
    } else {
      console.log(`No additional bot needed for player ${playerId} (already at target: ${currentDeployed}/${targetDeployed})`);
    }
  } catch (error) {
    console.error(`Error handling player queue for ${playerId}:`, error);
  }
}

async function handlePlayerDequeue(playerId) {
  try {
    console.log(`Player ${playerId} left queue, checking if we should reduce deployed bots`);
    
    // NOTE: QueueRoom already manages queue:humans and queue:players sets
    // We should NOT modify them here to avoid race conditions
    
    // Get current counts
    const config = await redis.hgetall('bots:rotation:config');
    const maxDeployed = parseInt(config.maxDeployed || '5');
    const currentDeployed = await redis.scard('bots:deployed');
    const queuedPlayersCount = await redis.scard('queue:humans'); // Use human players count
    
    // Calculate target deployed count: maxDeployed + queued players
    const targetDeployed = maxDeployed + queuedPlayersCount;
    
    console.log(`Dequeue check: current=${currentDeployed}, target=${targetDeployed}, maxDeployed=${maxDeployed}, queuedPlayers=${queuedPlayersCount}`);
    
    if (currentDeployed > targetDeployed) {
      // We have too many bots deployed, undeploy one
      const deployedBots = await redis.smembers('bots:deployed');
      const activeBots = await redis.smembers('bots:active');
      
      // Find a deployed bot that's not currently in a match
      const idleBot = deployedBots.find(botId => !activeBots.includes(botId));
      
      if (idleBot) {
        await undeployBot(idleBot);
        console.log(`Undeployed bot ${idleBot} due to player ${playerId} leaving queue`);
      }
    } else {
      console.log(`Bot count is appropriate (${currentDeployed}/${targetDeployed})`);
    }
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

async function cycleBot(bot) {
  const botId = bot._id.toString();
  const rating = bot.stats.rating;
  const client = new Colyseus.Client(COLYSEUS_URL);
  
  console.log(`Starting bot cycle for ${bot.fullName} (${botId}) with rating ${rating}`);
  
  // Continuous loop: enqueue, wait for match, join, complete, rotate
  while (true) {
    try {
      console.log(`Bot ${botId} cycle iteration starting`);
      
      // Check if bot is still deployed
      const isDeployed = await redis.sismember('bots:deployed', botId);
      if (!isDeployed) {
        console.log(`Bot ${botId} is no longer deployed, stopping cycle`);
        break;
      }
      
      // Check if bot already has an active match/reservation
      const existingReservation = await redis.get(`queue:reservation:${botId}`);
      if (existingReservation) {
        const reservationData = JSON.parse(existingReservation);
        console.log(`Bot ${botId} already has an active match: ${reservationData.matchId || 'unknown'}`);
        
        // Clean up the reservation and wait before retrying
        await redis.del(`queue:reservation:${botId}`);
        console.log(`Cleaned up stale reservation for bot ${botId}`);
        await new Promise(r => setTimeout(r, 10000)); // Wait 10 seconds before retry
        continue;
      }
      
      // Check bot state to prevent duplicate queueing
      const currentState = await redis.get(`bots:state:${botId}`);
      console.log(`Bot ${botId} current state: ${currentState}`);
      if (currentState && currentState !== 'idle') {
        console.log(`Bot ${botId} is in state ${currentState}, not idle, skipping enqueue`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      
      // Set bot state to idle
      await redis.setex(`bots:state:${botId}`, 3600, 'idle');
      
      // Connect to queue room and enqueue
      console.log(`Bot ${botId} connecting to queue room and enqueuing with rating ${rating}`);
      const queueRoom = await client.joinOrCreate('queue', { userId: botId, rating });
      
      // Set bot state to queued only after successful connection
      await redis.setex(`bots:state:${botId}`, 3600, 'queued');
      console.log(`Bot ${botId} state set to queued - now waiting in queue like a player`);
      
      // Set up match notification handler
      let matchFound = false;
      let matchData = null;
      
      queueRoom.onMessage('match_found', (message) => {
        console.log(`Bot ${botId} received match notification:`, message);
        matchFound = true;
        matchData = message;
      });
      
      queueRoom.onMessage('queued', (message) => {
        console.log(`Bot ${botId} queued successfully, position: ${message.position} - waiting for matchmaking`);
      });
      
      
      queueRoom.onLeave(async () => {
        console.log(`Bot ${botId} left queue room`);
        // Clean up bot state when leaving queue room
        redis.del(`bots:state:${botId}`).catch(err => 
          console.warn(`Failed to clear bot state for ${botId}:`, err)
        );
        
        // If bot was disconnected due to already having a match, clean up and retry
        try {
          const currentState = await redis.get(`bots:state:${botId}`);
          if (currentState === 'queued') {
            console.log(`Bot ${botId} was disconnected while queued, likely due to existing match - cleaning up and retrying`);
            redis.del(`queue:reservation:${botId}`).catch(err => 
              console.warn(`Failed to clear reservation for ${botId}:`, err)
            );
          }
        } catch (err) {
          console.warn(`Error checking bot state on leave for ${botId}:`, err);
        }
      });
      
      queueRoom.onError((error) => {
        console.error(`Bot ${botId} error in queue room:`, error);
      });
      
      // Wait for match notification (bots wait in queue just like players)
      console.log(`Bot ${botId} waiting in queue for matchmaking...`);
      const matchTimeout = 300000; // 5 minutes (bots can wait longer)
      const startTime = Date.now();
      
      while (!matchFound && (Date.now() - startTime) < matchTimeout) {
        // Check if bot is still deployed
        const isStillDeployed = await redis.sismember('bots:deployed', botId);
        if (!isStillDeployed) {
          console.log(`Bot ${botId} no longer deployed, stopping wait`);
          break;
        }
        
        // Check if bot is still in queue (might have been matched by another process)
        const isInQueue = await redis.zscore('queue:elo', botId);
        if (!isInQueue) {
          console.log(`Bot ${botId} no longer in queue, might have been matched`);
          break;
        }
        
        await new Promise(r => setTimeout(r, 2000)); // Check every 2 seconds
      }
      
      // Leave queue room
      queueRoom.leave();
      
      if (matchFound && matchData) {
        // Bot was matched, set state to matched
        await redis.setex(`bots:state:${botId}`, 3600, 'matched');
        
        // Join the match room
        console.log(`Bot ${botId} joining match room ${matchData.roomId}`);
        const matchRoom = await client.joinById(matchData.roomId, { userId: botId });
        
        // Set bot state to playing
        await redis.setex(`bots:state:${botId}`, 3600, 'playing');
        
        // Set up room event handlers
        matchRoom.onMessage('*', () => {});
        matchRoom.onLeave(() => {
          console.log(`Bot ${botId} left match room`);
        });
        matchRoom.onError((error) => {
          console.error(`Bot ${botId} error in match room:`, error);
        });
        
        // Wait for match to complete (room will disconnect when match ends)
        await new Promise((resolve) => {
          matchRoom.onLeave(() => resolve());
        });
        
        console.log(`Bot ${botId} match completed, exiting cycle for rotation`);
        
        // Clear bot state
        await redis.del(`bots:state:${botId}`);
        
        // Exit the cycle - rotation will be handled by the match completion event
        break;
      } else {
        // No match found, wait before retrying
        console.log(`Bot ${botId} no match found, waiting before retry`);
        await new Promise(r => setTimeout(r, 10000)); // Wait 10 seconds before retry
      }
    } catch (e) {
      console.error(`Error in bot cycle for ${botId}:`, e);
      console.error(`Error stack:`, e.stack);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  console.log(`Bot cycle ended for ${botId}`);
}

// Bot management state
const activeBotCycles = new Map(); // userId -> cycle function
let isRunning = false;

async function startBotCycles() {
  try {
    // Initialize rotation queue and get deployed bots
    const { deployedBots } = await initializeRotationQueue();
    console.log(`Found ${deployedBots.length} deployed bots`);
    
    // Start cycles for all deployed bots
    for (const bot of deployedBots) {
      const botId = bot._id.toString();
      if (!activeBotCycles.has(botId)) {
        console.log(`Starting bot cycle for ${bot.fullName} (${botId})`);
        const cyclePromise = cycleBot(bot);
        activeBotCycles.set(botId, cyclePromise);
        
        // Handle cycle completion
        cyclePromise.finally(() => {
          activeBotCycles.delete(botId);
        });
      }
    }
    
    console.log(`Started ${deployedBots.length} bot cycles`);
  } catch (error) {
    console.error('Error starting bot cycles:', error);
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

// Function to maintain minimum deployed count
async function maintainDeployedCount() {
  try {
    const config = await redis.hgetall('bots:rotation:config');
    const maxDeployed = parseInt(config.maxDeployed || '5');
    const queuedPlayersCount = await redis.scard('queue:humans');
    const currentDeployed = await redis.scard('bots:deployed');
    
    // Calculate target: maxDeployed (minimum) + queued players
    const targetDeployed = maxDeployed + queuedPlayersCount;
    
    if (currentDeployed < targetDeployed) {
      const needed = targetDeployed - currentDeployed;
      console.log(`Maintaining deployed count: need ${needed} more bots (${currentDeployed}/${targetDeployed})`);
      
      for (let i = 0; i < needed; i++) {
        const nextBotId = await redis.lpop('bots:rotation:queue');
        if (nextBotId) {
          await deployBot(nextBotId);
          console.log(`Deployed bot ${nextBotId} to maintain count`);
        } else {
          console.log(`No more bots available in rotation queue`);
          break;
        }
      }
    }
  } catch (error) {
    console.error('Error maintaining deployed count:', error);
  }
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
    
    // Start with initially deployed bots
    isRunning = true;
    await startBotCycles();
    
    // Periodically refresh bot cycles (in case of manual database changes)
    setInterval(async () => {
      if (isRunning) {
        await startBotCycles();
      }
    }, 30000); // Check every 30 seconds
    
    // Start periodic maintenance check every 30 seconds
    setInterval(async () => {
      if (isRunning) {
        await maintainDeployedCount();
      }
    }, 30000);
    
    console.log('Bot service started successfully');
    
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


