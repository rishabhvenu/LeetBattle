import { getRedis, RedisKeys } from './redis';

const redis = getRedis();

export async function enqueueUser(userId: string, rating: number) {
  // Use rating as score in ZSET
  await redis.zadd(RedisKeys.eloQueue, rating, userId);
  return { success: true };
}

export async function dequeueUser(userId: string) {
  await redis.zrem(RedisKeys.eloQueue, userId);
  return { success: true };
}

export async function queueSize() {
  return redis.zcard(RedisKeys.eloQueue);
}


