// Configuration for bot service
'use strict';

const Redis = require('ioredis');
const { randomUUID } = require('crypto');

// Environment validation
function validateEnv() {
  if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
    throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is required');
  }
  if (!process.env.COLYSEUS_URL) {
    throw new Error('COLYSEUS_URL environment variable is required');
  }
}

// Configuration constants
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

const LEADER_TTL_MS = Math.max(
  5000,
  parseInt(process.env.BOT_LEADER_TTL_MS || '15000', 10)
);

const LEADER_RENEW_INTERVAL_MS = Math.max(
  2000,
  Math.floor(LEADER_TTL_MS / 2)
);

const BOT_QUEUE_PRUNE_INTERVAL_MS = Math.max(
  5000,
  parseInt(process.env.BOT_QUEUE_PRUNE_INTERVAL_MS || '30000', 10)
);

const MONGODB_URI = process.env.MONGODB_URI;
const COLYSEUS_URL = process.env.COLYSEUS_URL;
const BOT_SERVICE_SECRET = process.env.BOT_SERVICE_SECRET || null;
const INSTANCE_ID = process.env.BOT_INSTANCE_ID || randomUUID();
const LEADER_KEY = 'bots:leader';

// Redis client factory
function createRedisClient() {
  if (process.env.REDIS_CLUSTER_NODES) {
    // Redis Cluster mode
    const clusterNodes = process.env.REDIS_CLUSTER_NODES.split(',').map(node => {
      const [host, port] = node.trim().split(':');
      return { 
        host: host || process.env.REDIS_HOST, 
        port: parseInt(port || process.env.REDIS_PORT, 10) 
      };
    });
    
    return new Redis.Cluster(clusterNodes, {
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      },
      clusterRetryStrategy: (times) => Math.min(times * 50, 2000),
      enableOfflineQueue: true,
      enableReadyCheck: true,
    });
  } else {
    // Single Redis instance mode
    return new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
    });
  }
}

// Load Lua scripts
function loadRedisScripts(redisClient) {
  // Leadership extension script
  redisClient.defineCommand('extendLeader', {
    numberOfKeys: 1,
    lua: `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      end
      return 0
    `,
  });
  
  // Atomic cycle guard acquisition script
  // ARGV[1] = current timestamp
  // ARGV[2] = MAX_CYCLING_TIME_MS (max age before considering stale)
  // ARGV[3] = TTL in seconds
  redisClient.defineCommand('acquireCycleGuard', {
    numberOfKeys: 1,
    lua: `
      local existing = redis.call("GET", KEYS[1])
      if existing then
        local age = tonumber(ARGV[1]) - tonumber(existing)
        if age < tonumber(ARGV[2]) then
          return 0
        end
      end
      local result = redis.call("SET", KEYS[1], ARGV[1], "NX", "EX", ARGV[3])
      if result then
        return 1
      end
      return 0
    `,
  });
  
  // Atomic matchBot script
  const fs = require('fs');
  const path = require('path');
  try {
    const matchBotLua = fs.readFileSync(
      path.join(__dirname, '../colyseus/src/lib/redis-scripts/matchBot.lua'),
      'utf8'
    );
    redisClient.defineCommand('matchBot', {
      numberOfKeys: 1,
      lua: matchBotLua,
    });
  } catch (err) {
    console.warn('Could not load matchBot.lua script:', err.message);
  }
}

module.exports = {
  validateEnv,
  createRedisClient,
  loadRedisScripts,
  DEFAULT_DEPLOY_DELAY_MS,
  DEFAULT_INITIAL_JOIN_DELAY_MS,
  BOT_DEPLOY_CHECK_INTERVAL_MS,
  LEADER_TTL_MS,
  LEADER_RENEW_INTERVAL_MS,
  BOT_QUEUE_PRUNE_INTERVAL_MS,
  MONGODB_URI,
  COLYSEUS_URL,
  BOT_SERVICE_SECRET,
  INSTANCE_ID,
  LEADER_KEY,
};

