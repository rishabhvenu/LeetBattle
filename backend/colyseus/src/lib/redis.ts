import Redis from 'ioredis';

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
  guestMatchKey: (guestId: string) => `guest:match:${guestId}`,
  guestSessionKey: (guestId: string) => `guest:session:${guestId}`,
  submissionCacheKey: (matchId: string, userId: string, codeHash: string) => `match:${matchId}:user:${userId}:submission:${codeHash}`,
  privateRoomKey: (roomCode: string) => `private:room:${roomCode}`,
};

let redisSingleton: Redis | null = null;

export function getRedis(): Redis {
  if (!redisSingleton) {
    redisSingleton = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
    });
  }
  return redisSingleton;
}

// Bot rotation helper functions
export async function getRotationConfig(redis: Redis) {
  const config = await redis.hgetall(RedisKeys.botsRotationConfig);
  return {
    maxDeployed: parseInt(config.maxDeployed || '5'),
    totalBots: parseInt(config.totalBots || '0')
  };
}

export async function setRotationConfig(redis: Redis, maxDeployed: number, totalBots: number) {
  await redis.hset(RedisKeys.botsRotationConfig, {
    maxDeployed: maxDeployed.toString(),
    totalBots: totalBots.toString()
  });
}

export async function getRotationQueue(redis: Redis): Promise<string[]> {
  return await redis.lrange(RedisKeys.botsRotationQueue, 0, -1);
}

export async function addToRotationQueue(redis: Redis, botId: string) {
  await redis.rpush(RedisKeys.botsRotationQueue, botId);
}

export async function removeFromRotationQueue(redis: Redis, botId: string) {
  await redis.lrem(RedisKeys.botsRotationQueue, 0, botId);
}

export async function popFromRotationQueue(redis: Redis): Promise<string | null> {
  return await redis.lpop(RedisKeys.botsRotationQueue);
}

export async function clearRotationQueue(redis: Redis) {
  await redis.del(RedisKeys.botsRotationQueue);
}

// Player queue management functions
export async function addQueuedPlayer(redis: Redis, playerId: string) {
  await redis.sadd(RedisKeys.queuedPlayersSet, playerId);
}

export async function removeQueuedPlayer(redis: Redis, playerId: string) {
  await redis.srem(RedisKeys.queuedPlayersSet, playerId);
}

export async function getQueuedPlayersCount(redis: Redis): Promise<number> {
  return await redis.scard(RedisKeys.queuedPlayersSet);
}

export async function getQueuedPlayers(redis: Redis): Promise<string[]> {
  return await redis.smembers(RedisKeys.queuedPlayersSet);
}

// Bot state management functions
export async function setBotState(redis: Redis, botId: string, state: 'idle' | 'queued' | 'matched' | 'playing') {
  await redis.setex(RedisKeys.botStateKey(botId), 3600, state); // 1 hour TTL
}

export async function getBotState(redis: Redis, botId: string): Promise<string | null> {
  return await redis.get(RedisKeys.botStateKey(botId));
}

export async function clearBotState(redis: Redis, botId: string) {
  await redis.del(RedisKeys.botStateKey(botId));
}

// Human player tracking for prioritization
export async function addHumanPlayer(redis: Redis, playerId: string) {
  await redis.sadd(RedisKeys.humanPlayersSet, playerId);
}

export async function removeHumanPlayer(redis: Redis, playerId: string) {
  await redis.srem(RedisKeys.humanPlayersSet, playerId);
}

export async function getHumanPlayersCount(redis: Redis): Promise<number> {
  return await redis.scard(RedisKeys.humanPlayersSet);
}

export async function isHumanPlayer(redis: Redis, playerId: string): Promise<boolean> {
  return (await redis.sismember(RedisKeys.humanPlayersSet, playerId)) === 1;
}

// Check if a user ID belongs to a bot by querying MongoDB
export async function isBotUser(playerId: string): Promise<boolean> {
  try {
    const { MongoClient, ObjectId } = require('mongodb');
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://codeclashers-mongodb:27017/codeclashers';
    
    // Check if this is a valid ObjectId format first
    if (!ObjectId.isValid(playerId)) {
      return false;
    }
    
    const client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 2000,
      socketTimeoutMS: 5000,
    });
    
    await client.connect();
    const db = client.db('codeclashers');
    const bots = db.collection('bots');
    
    const bot = await bots.findOne({ _id: new ObjectId(playerId) });
    await client.close();
    
    return bot !== null;
  } catch (error) {
    console.error('Error checking if user is bot:', error);
    return false; // Default to not being a bot on error
  }
}


