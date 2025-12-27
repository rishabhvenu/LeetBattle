// Bot service entry point - orchestrates leadership, matchmaking, and bot lifecycle
'use strict';

const {
  validateEnv,
  createRedisClient,
  loadRedisScripts,
  BOT_DEPLOY_CHECK_INTERVAL_MS,
  BOT_QUEUE_PRUNE_INTERVAL_MS,
  COLYSEUS_URL,
} = require('./lib/config');

const {
  leadership,
  runElectionLoop,
  cleanupLeadership,
} = require('./lib/leaderElection');

const {
  getAllBots,
  initializeRotationQueue,
  checkAndManageBotDeployment,
  deployBot,
  rotateBot,
  pruneDeployedBots,
  closeMongoClient,
} = require('./lib/matchmaking');

// Validate environment variables
validateEnv();

// Create Redis client
const redis = createRedisClient();

// Load Lua scripts
loadRedisScripts(redis);

if (!process.env.BOT_SERVICE_SECRET) {
  console.warn('[bots] BOT_SERVICE_SECRET not configured; HTTP requests will omit authentication');
}

// Command subscriber for pub/sub
let commandSubscriber = null;

/**
 * Start bot cycles - initialize rotation queue
 */
async function startBotCycles() {
  if (!leadership.isLeader) {
    console.log('[bots] Not leader, skipping startBotCycles');
    return;
  }
  
  console.log('[bots] Starting bot cycles...');
  try {
    const result = await initializeRotationQueue(redis);
    console.log(`[bots] Bot cycles started: ${result.deployedBots.length} deployed, ${result.undeployedBots.length} in rotation`);
    
    // Start deployment check interval
    if (!leadership.deployTimer) {
      leadership.deployTimer = setInterval(async () => {
        if (leadership.isLeader) {
          await checkAndManageBotDeployment(redis);
        }
      }, BOT_DEPLOY_CHECK_INTERVAL_MS);
    }
    
    // Start prune interval
    if (!leadership.pruneTimer) {
      leadership.pruneTimer = setInterval(async () => {
        if (leadership.isLeader) {
          await pruneDeployedBots(redis);
        }
      }, BOT_QUEUE_PRUNE_INTERVAL_MS);
    }
  } catch (error) {
    console.error('[bots] Error starting bot cycles:', error);
  }
}

/**
 * Stop bot cycles - clear intervals
 */
async function stopBotCycles() {
  console.log('[bots] Stopping bot cycles...');
  
  if (leadership.deployTimer) {
    clearInterval(leadership.deployTimer);
    leadership.deployTimer = null;
  }
  
  if (leadership.pruneTimer) {
    clearInterval(leadership.pruneTimer);
    leadership.pruneTimer = null;
  }
  
  console.log('[bots] Bot cycles stopped');
}

/**
 * Handle rotation config change
 * @param {number} newMaxDeployed - New maximum deployed bots
 */
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
          await deployBot(redis, nextBotId, {
            context: 'rotationConfig',
            initialJoinDelayMs: 250,
          });
          console.log(`Deployed bot ${nextBotId} to meet new maxDeployed target`);
        } else {
          console.log('No more bots available in rotation queue');
          break;
        }
      }
    } else if (currentDeployed > newMaxDeployed) {
      console.log(`Current deployed (${currentDeployed}) exceeds new max (${newMaxDeployed}), will reduce through natural rotation`);
    }
  } catch (error) {
    console.error('Error handling rotation config change:', error);
  }
}

/**
 * Setup command listener for bot operations
 */
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
      
      switch (command.type) {
        case 'deploy':
          await startBotCycles();
          break;
          
        case 'stop':
          if (command.botIds && command.botIds.length > 0) {
            // Stop specific bots
            for (const botId of command.botIds) {
              await redis.srem('bots:deployed', botId);
            }
          } else {
            // Stop all bots
            await stopBotCycles();
          }
          break;
          
        case 'botMatchComplete':
          await rotateBot(redis, command.botId);
          break;
          
        case 'playerQueued':
        case 'playerDequeued':
          // Handled by 5-second deployment check timer
          break;
          
        case 'rotateConfig':
          await handleRotationConfigChange(command.maxDeployed);
          break;
          
        default:
          console.warn('Unknown bot command type:', command.type);
      }
    } catch (error) {
      console.error('Error processing bot command:', error);
    }
  });
  
  console.log('Bot command listener setup complete');
}

/**
 * Callback when this instance becomes leader
 */
async function onBecomeLeader() {
  console.log('Became leader - starting bot cycles');
  await startBotCycles();
}

/**
 * Callback when this instance loses leadership
 */
async function onLoseLeadership() {
  console.log('Lost leadership - stopping bot cycles');
  await stopBotCycles();
}

/**
 * Main entry point
 */
async function main() {
  console.log(`[bots] Starting bot service -> ${COLYSEUS_URL}`);
  
  try {
    // Setup command listener
    await setupCommandListener();
    console.log('Bot command listener started');
    
    // Start leadership election loop
    console.log('Starting leadership election...');
    runElectionLoop(redis, onBecomeLeader, onLoseLeadership);
    
    console.log('Bot service started successfully (event-driven, leader aware)');
  } catch (error) {
    console.error('[bots] Fatal error:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Stop bot cycles
    await stopBotCycles();
    
    // Cleanup leadership
    await cleanupLeadership(redis);
    
    // Close command subscriber
    if (commandSubscriber) {
      await commandSubscriber.quit();
    }
    
    // Close Redis connection
    await redis.quit();
    
    // Close MongoDB connection
    await closeMongoClient();
    
    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Register signal handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection');
});

// Start the service
main().catch((error) => {
  console.error('[bots] Fatal error:', error);
  process.exit(1);
});

