import { getRedis, RedisKeys } from './redis';

const redis = getRedis();

export async function enqueueUser(userId: string, rating: number) {
  // Use rating as score in ZSET
  await redis.zadd(RedisKeys.eloQueue, rating, userId);
  // Track when the user entered the queue (ms epoch)
  try {
    await redis.set(RedisKeys.queueJoinedAtKey(userId), Date.now().toString());
    await redis.expire(RedisKeys.queueJoinedAtKey(userId), 3600);
  } catch {}
  return { success: true };
}

export async function dequeueUser(userId: string) {
  await redis.zrem(RedisKeys.eloQueue, userId);
  try { await redis.del(RedisKeys.queueJoinedAtKey(userId)); } catch {}
  return { success: true };
}

export async function queueSize() {
  return redis.zcard(RedisKeys.eloQueue);
}


