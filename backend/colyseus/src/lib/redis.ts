import Redis from 'ioredis';

export const RedisKeys = {
  eloQueue: 'queue:elo', // zset userId -> rating
  activeMatchesSet: 'matches:active',
  matchKey: (matchId: string) => `match:${matchId}`,
  userConnMap: 'user:conn',
  matchEventsChannel: 'events:match',
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


