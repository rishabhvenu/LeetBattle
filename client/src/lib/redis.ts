import Redis from 'ioredis';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    redis = new Redis({ host, port, password, lazyConnect: false, maxRetriesPerRequest: 3 });
  }
  return redis;
}

export const RedisKeys = {
  userStats: (userId: string) => `user:${userId}:stats`,
  activeMatchesSet: 'matches:active',
  matchKey: (matchId: string) => `match:${matchId}`,
  // Per-match, per-user source code storage (hash of language -> code)
  matchUserCodeHash: (matchId: string, userId: string) => `match:${matchId}:code:${userId}`,
} as const;


