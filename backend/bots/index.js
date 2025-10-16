'use strict';

const Redis = require('ioredis');
const Colyseus = require('colyseus.js');
const { MongoClient } = require('mongodb');

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
    const client = await getMongoClient();
    const db = client.db('codeclashers');
    const bots = db.collection('bots');
    
    const deployedBots = await bots.find({ deployed: true }).toArray();
    return deployedBots;
  } catch (error) {
    console.error('Error fetching deployed bots:', error);
    return [];
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
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
  return await res.json();
}

async function joinIfReserved(client, userId) {
  try {
    const tokenRes = await fetchJson('GET', `${httpBase()}/queue/reservation?userId=${encodeURIComponent(userId)}`);
    const token = tokenRes.token;
    const consume = await fetchJson('POST', `${httpBase()}/reserve/consume`, { token });
    const { roomId, roomName, matchId, problemId } = consume.reservation;
    const room = await client.joinById(roomId, { userId });
    room.onMessage('*', () => {});
    room.onLeave(() => {});
    room.onError(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

async function cycleBot(bot) {
  const botId = bot._id.toString();
  const rating = bot.stats.rating;
  const client = new Colyseus.Client(COLYSEUS_URL);
  
  console.log(`Starting bot cycle for ${bot.fullName} (${botId}) with rating ${rating}`);
  
  // Continuous loop: enqueue, try join reservation, then sleep
  while (true) {
    try {
      // Check if bot is still deployed
      const isDeployed = await redis.sismember('bots:deployed', botId);
      if (!isDeployed) {
        console.log(`Bot ${botId} is no longer deployed, stopping cycle`);
        break;
      }
      
      // Check if bot is already in an active match
      const isActive = await redis.sismember('bots:active', botId);
      if (isActive) {
        console.log(`Bot ${botId} is already in an active match, skipping enqueue`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      
      await fetchJson('POST', `${httpBase()}/queue/enqueue`, { userId: botId, rating });
      // Small grace to allow reservation creation
      await new Promise(r => setTimeout(r, 1000));
      await joinIfReserved(client, botId);
      // Wait before next cycle
      await new Promise(r => setTimeout(r, 5000));
    } catch (e) {
      console.error(`Error in bot cycle for ${botId}:`, e);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log(`Bot cycle ended for ${botId}`);
}

// Bot management state
const activeBotCycles = new Map(); // userId -> cycle function
let isRunning = false;

async function startBotCycles() {
  try {
    const deployedBots = await getDeployedBots();
    console.log(`Found ${deployedBots.length} deployed bots`);
    
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
    
    // Start with initially deployed bots
    isRunning = true;
    await startBotCycles();
    
    // Periodically refresh bot cycles (in case of manual database changes)
    setInterval(async () => {
      if (isRunning) {
        await startBotCycles();
      }
    }, 30000); // Check every 30 seconds
    
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


