import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '../lib/mongo';
import { getRedis } from '../lib/redis';

export interface PlayerRatingResult {
  userId: string;
  rating: number;
  isBot: boolean;
}

export async function getPlayerRating(userId: string): Promise<PlayerRatingResult> {
  if (!userId || userId.startsWith('guest_') || !ObjectId.isValid(userId)) {
    return { userId, rating: 1200, isBot: false };
  }

  const client = await getMongoClient();
  const db = client.db(getDbName());

  const objectId = new ObjectId(userId);
  const bots = db.collection('bots');
  const bot = await bots.findOne({ _id: objectId }, { projection: { 'stats.rating': 1 } });
  if (bot) {
    return {
      userId,
      rating: bot.stats?.rating || 1200,
      isBot: true,
    };
  }

  const users = db.collection('users');
  const user = await users.findOne({ _id: objectId }, { projection: { 'stats.rating': 1 } });
  return {
    userId,
    rating: user?.stats?.rating || 1200,
    isBot: false,
  };
}

export async function getPlayerRatings(userIds: string[]): Promise<Record<string, PlayerRatingResult>> {
  const results: Record<string, PlayerRatingResult> = {};
  await Promise.all(
    userIds.map(async (userId) => {
      try {
        results[userId] = await getPlayerRating(userId);
      } catch (error) {
        console.error(`Failed to load rating for ${userId}`, error);
        results[userId] = { userId, rating: 1200, isBot: false };
      }
    }),
  );
  return results;
}

export async function setMatchRatingSnapshot(matchId: string, ratings: Record<string, number>, ttlSeconds = 3600) {
  const redis = getRedis();
  const entries = Object.entries(ratings).map(([userId, rating]) => [userId, rating.toString()]);
  if (entries.length === 0) return;

  const key = `match:${matchId}:ratings`;
  await redis.hset(key, Object.fromEntries(entries));
  if (ttlSeconds > 0) {
    await redis.expire(key, ttlSeconds);
  }
}

