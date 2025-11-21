import Redis, { Cluster } from 'ioredis';
import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from './mongo';

type RedisClient = Redis | Cluster;

export const RedisKeys = {
  eloQueue: 'queue:elo', // zset userId -> rating
  activeMatchesSet: 'matches:active',
  matchKey: (matchId: string) => `match:${matchId}`,
  userConnMap: 'user:conn',
  matchEventsChannel: 'events:match',
  queueJoinedAtKey: (userId: string) => `queue:joinedAt:${userId}`,
  botsActiveSet: 'bots:active', // set of botIds currently in matches
  botsDeployedSet: 'bots:deployed', // set of botIds that should be actively queueing
  botsCommandsChannel: 'bots:commands', // pub/sub channel for admin commands
  botsRotationQueue: 'bots:rotation:queue', // list of botIds waiting to be deployed
  botsRotationConfig: 'bots:rotation:config', // hash with maxDeployed, totalBots
  queuedPlayersSet: 'queue:players', // set of playerIds currently in queue
  botStateKey: (botId: string) => `bots:state:${botId}`, // bot state: idle|queued|matched|playing
  humanPlayersSet: 'queue:humans', // set of human playerIds in queue (for prioritization)
  needsBotSet: 'queue:needsBot', // set of human playerIds needing bot deployment (waited >7s)
  guestMatchKey: (guestId: string) => `guest:match:${guestId}`,
  guestSessionKey: (guestId: string) => `guest:session:${guestId}`,
  submissionCacheKey: (matchId: string, userId: string, codeHash: string) => `match:${matchId}:user:${userId}:submission:${codeHash}`,
  privateRoomKey: (roomCode: string) => `private:room:${roomCode}`,
};

let redisSingleton: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (!redisSingleton) {
    if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
      throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
    }
    const host = process.env.REDIS_HOST;
    const port = parseInt(process.env.REDIS_PORT, 10);
    const password = process.env.REDIS_PASSWORD;
    
    // Check if Redis Cluster mode is enabled
    const isCluster = process.env.REDIS_CLUSTER_ENABLED === 'true' || 
                      process.env.REDIS_CLUSTER_NODES !== undefined;
    
    if (isCluster) {
      // Redis Cluster mode - use cluster nodes from env or single entry point
      const clusterNodes = process.env.REDIS_CLUSTER_NODES
        ? process.env.REDIS_CLUSTER_NODES.split(',').map(node => {
            const [h, p] = node.trim().split(':');
            return { host: h, port: parseInt(p || '6379', 10) };
          })
        : [{ host, port }];
      
      redisSingleton = new Cluster(clusterNodes, {
        redisOptions: {
          password,
          maxRetriesPerRequest: 3,
        },
        clusterRetryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        enableOfflineQueue: false,
        enableReadyCheck: true,
      });
    } else {
      // Single Redis instance mode (backward compatibility)
      redisSingleton = new Redis({
        host,
        port,
        password,
        maxRetriesPerRequest: 3,
      });
    }
    
    // Error handling
    redisSingleton.on('error', (err: Error) => {
      console.error('Redis connection error:', err.message);
    });
  }
  return redisSingleton;
}

// Bot rotation helper functions
export async function getRotationConfig(redis: RedisClient) {
  const config = await redis.hgetall(RedisKeys.botsRotationConfig);
  return {
    maxDeployed: parseInt(config.maxDeployed || '5'),
    totalBots: parseInt(config.totalBots || '0')
  };
}

export async function setRotationConfig(redis: RedisClient, maxDeployed: number, totalBots: number) {
  await redis.hset(RedisKeys.botsRotationConfig, {
    maxDeployed: maxDeployed.toString(),
    totalBots: totalBots.toString()
  });
}

export async function getRotationQueue(redis: RedisClient): Promise<string[]> {
  return await redis.lrange(RedisKeys.botsRotationQueue, 0, -1);
}

export async function addToRotationQueue(redis: RedisClient, botId: string) {
  await redis.rpush(RedisKeys.botsRotationQueue, botId);
}

export async function removeFromRotationQueue(redis: RedisClient, botId: string) {
  await redis.lrem(RedisKeys.botsRotationQueue, 0, botId);
}

export async function popFromRotationQueue(redis: RedisClient): Promise<string | null> {
  return await redis.lpop(RedisKeys.botsRotationQueue);
}

export async function clearRotationQueue(redis: RedisClient) {
  await redis.del(RedisKeys.botsRotationQueue);
}

// Player queue management functions
export async function addQueuedPlayer(redis: RedisClient, playerId: string) {
  await redis.sadd(RedisKeys.queuedPlayersSet, playerId);
}

export async function removeQueuedPlayer(redis: RedisClient, playerId: string) {
  await redis.srem(RedisKeys.queuedPlayersSet, playerId);
}

export async function getQueuedPlayersCount(redis: RedisClient): Promise<number> {
  return await redis.scard(RedisKeys.queuedPlayersSet);
}

export async function getQueuedPlayers(redis: RedisClient): Promise<string[]> {
  return await redis.smembers(RedisKeys.queuedPlayersSet);
}

// Bot state management functions
export async function setBotState(redis: RedisClient, botId: string, state: 'idle' | 'queued' | 'matched' | 'playing') {
  await redis.setex(RedisKeys.botStateKey(botId), 3600, state); // 1 hour TTL
}

export async function getBotState(redis: RedisClient, botId: string): Promise<string | null> {
  return await redis.get(RedisKeys.botStateKey(botId));
}

export async function clearBotState(redis: RedisClient, botId: string) {
  await redis.del(RedisKeys.botStateKey(botId));
}

// Human player tracking for prioritization
export async function addHumanPlayer(redis: RedisClient, playerId: string) {
  await redis.sadd(RedisKeys.humanPlayersSet, playerId);
}

export async function removeHumanPlayer(redis: RedisClient, playerId: string) {
  await redis.srem(RedisKeys.humanPlayersSet, playerId);
}

export async function getHumanPlayersCount(redis: RedisClient): Promise<number> {
  return await redis.scard(RedisKeys.humanPlayersSet);
}

export async function isHumanPlayer(redis: RedisClient, playerId: string): Promise<boolean> {
  return (await redis.sismember(RedisKeys.humanPlayersSet, playerId)) === 1;
}

// Check if a user ID belongs to a bot by querying MongoDB
const DB_NAME = getDbName();

export async function isBotUser(playerId: string): Promise<boolean> {
  try {
    if (!ObjectId.isValid(playerId)) {
      return false;
    }

    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const bots = db.collection('bots');

    const bot = await bots.findOne({ _id: new ObjectId(playerId) });
    return bot !== null;
  } catch (error) {
    console.error('Error checking if user is bot:', error);
    return false; // Default to not being a bot on error
  }
}


