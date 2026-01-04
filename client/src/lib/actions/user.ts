'use server';

import connectDB, { getMongoClient } from '../mongodb';
import { ObjectId } from 'mongodb';
import { getRedis, RedisKeys } from '../redis';
import { generatePresignedUrl } from '../minio';
import {
  uploadLimiter,
  generalLimiter,
  rateLimit,
  getClientIdentifier,
} from '../rateLimiter';
import { tryToObjectId } from '../utilsObjectId';
import { DB_NAME, USERS_COLLECTION, SESSIONS_COLLECTION } from './constants';

export async function generatePresignedUploadUrl(fileName: string, contentType: string) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(uploadLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    const presignedUrl = await generatePresignedUrl(fileName, contentType);
    return { success: true, presignedUrl };
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return { success: false, error: 'Failed to generate upload URL' };
  }
}

export async function saveUserAvatar(fileName: string) {
  try {
    // Get sessionId from cookie (Edge operation via dynamic import)
    const { getSessionCookie } = await import('../session-edge');
    const sessionId = await getSessionCookie();
    if (!sessionId) return { success: false, error: 'No session' };

    await connectDB();
    const client = await getMongoClient();

    const db = client.db(DB_NAME);
    const sessions = db.collection(SESSIONS_COLLECTION);
    const users = db.collection(USERS_COLLECTION);

    // Update session user avatar
    await sessions.updateOne(
      { _id: sessionId as unknown as ObjectId },
      { $set: { 'user.avatar': fileName } }
    );

    // Update user profile avatar
    const sessionDoc = await sessions.findOne({ _id: sessionId as unknown as ObjectId });
    if (sessionDoc?.userId) {
      const userObjectId = tryToObjectId(sessionDoc.userId) || new ObjectId(String(sessionDoc.userId));
      await users.updateOne(
        { _id: userObjectId },
        { $set: { 'profile.avatar': fileName } }
      );
    }

    return { success: true };
  } catch (error) {
    console.error('Error saving user avatar:', error);
    return { success: false, error: 'Failed to save avatar' };
  }
}

// Cached user stats in Redis with MongoDB fallback
export async function getUserStatsCached(userId: string) {
  // Try Redis cache first, but fail gracefully if Redis is unavailable
  try {
    const redis = getRedis();
    const key = RedisKeys.userStats(userId);
    // Try cache with timeout - catch all Redis errors including "Connection is closed"
    let cached: string | null = null;
    try {
      cached = await Promise.race([
        redis.get(key),
        new Promise<null>((_, reject) => 
          setTimeout(() => reject(new Error('Redis timeout')), 2000)
        )
      ]).catch(() => null);
    } catch (error: any) {
      // Catch "Connection is closed", "Stream isn't writeable", etc.
      if (error?.message?.includes('Connection is closed') || 
          error?.message?.includes('Stream isn\'t writeable') ||
          error?.message?.includes('ETIMEDOUT')) {
        console.warn('Redis connection error in getUserStatsCached:', error.message);
        cached = null;
      } else {
        throw error; // Re-throw unexpected errors
      }
    }
    
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {}
    }
  } catch (error) {
    // Redis unavailable - fall through to MongoDB
    console.warn('Redis unavailable for getUserStatsCached, using MongoDB fallback:', error);
  }

  // Fallback: compute from matches
  await connectDB();
  const client = await getMongoClient();
  const db = client.db(DB_NAME);
  const matches = db.collection('matches');
  const users = db.collection('users');
  const bots = db.collection('bots');

  // Aggregate wins and total matches; get timeCoded from user stats
  const userObjectId = new ObjectId(userId);
  const totalMatches = await matches.countDocuments({ playerIds: userObjectId });
  const wins = await matches.countDocuments({ winnerUserId: userObjectId });
  
  // Check if it's a bot first
  const botDoc = await bots.findOne({ _id: userObjectId }, { projection: { 'stats.rating': 1, 'stats.timeCoded': 1 } }) as { stats?: { rating?: number; timeCoded?: number } } | null;
  let rating = 1200;
  let timeCoded = 0;
  let globalRank = 1;
  
  if (botDoc) {
    // It's a bot - use bot stats
    rating = botDoc.stats?.rating ?? 1200;
    timeCoded = botDoc.stats?.timeCoded ?? 0;
    // #region agent log
    // FIX: Count both bots AND users with higher rating for global rank
    const higherBotCount = await bots.countDocuments({ 'stats.rating': { $gt: rating } });
    const higherUserCount = await users.countDocuments({ 'stats.rating': { $gt: rating } });
    globalRank = higherBotCount + higherUserCount + 1;
    console.log(`[Rank Debug] Bot ${userId}: rating=${rating}, higherBots=${higherBotCount}, higherUsers=${higherUserCount}, globalRank=${globalRank}`);
    // #endregion
  } else {
    // It's a regular user - use user stats
    const userDoc = await users.findOne({ _id: userObjectId }, { projection: { 'stats.rating': 1, 'stats.timeCoded': 1 } }) as { stats?: { rating?: number; timeCoded?: number } } | null;
    rating = userDoc?.stats?.rating ?? 1200;
    timeCoded = userDoc?.stats?.timeCoded ?? 0;
    // #region agent log
    // FIX: Count both users AND bots with higher rating for global rank (matches leaderboard)
    const higherUserCount = await users.countDocuments({ 'stats.rating': { $gt: rating } });
    const higherBotCount = await bots.countDocuments({ 'stats.rating': { $gt: rating } });
    globalRank = higherUserCount + higherBotCount + 1;
    console.log(`[Rank Debug] User ${userId}: rating=${rating}, higherUsers=${higherUserCount}, higherBots=${higherBotCount}, globalRank=${globalRank}`);
    // #endregion
  }

  const stats = {
    totalMatches,
    wins,
    losses: Math.max(totalMatches - wins, 0),
    draws: 0,
    timeCoded,
    globalRank,
    rating,
  };

  // Cache with TTL (e.g., 5 minutes) - fail silently if Redis unavailable
  try {
    const redis = getRedis();
    const key = RedisKeys.userStats(userId);
    await Promise.race([
      redis.set(key, JSON.stringify(stats), 'EX', 300),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis timeout')), 2000)
      )
    ]).catch(() => {
      // Redis unavailable - ignore, we already have the stats from MongoDB
    });
  } catch (error) {
    // Redis unavailable - ignore
  }
  return stats;
}

// Cached user activity data for the last 7 days
export async function getUserActivityCached(userId: string) {
  // Try Redis cache first, but fail gracefully if Redis is unavailable
  try {
    const redis = getRedis();
    const key = RedisKeys.userActivity(userId);
    
    // Try cache with timeout - catch all Redis errors including "Connection is closed"
    let cached: string | null = null;
    try {
      cached = await Promise.race([
        redis.get(key),
        new Promise<null>((_, reject) => 
          setTimeout(() => reject(new Error('Redis timeout')), 2000)
        )
      ]).catch(() => null);
    } catch (error: any) {
      // Catch "Connection is closed", "Stream isn't writeable", etc.
      if (error?.message?.includes('Connection is closed') || 
          error?.message?.includes('Stream isn\'t writeable') ||
          error?.message?.includes('ETIMEDOUT')) {
        console.warn('Redis connection error in getUserActivityCached:', error.message);
        cached = null;
      } else {
        throw error; // Re-throw unexpected errors
      }
    }
    
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {}
    }
  } catch (error) {
    // Redis unavailable - fall through to MongoDB
    console.warn('Redis unavailable for getUserActivityCached, using MongoDB fallback:', error);
  }

  // Fallback: compute from matches
  await connectDB();
  const client = await getMongoClient();
  const db = client.db(DB_NAME);
  const matches = db.collection('matches');

  const userObjectId = new ObjectId(userId);
  
  // Get matches from the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const recentMatches = await matches.find({
    playerIds: userObjectId,
    $or: [
      { startedAt: { $gte: sevenDaysAgo } },
      { createdAt: { $gte: sevenDaysAgo } }
    ]
  }).toArray();

  // Create array for last 7 days
  const activityData = [];
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    // Format date as day name (Mon, Tue, etc.)
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    
    // Count matches for this day
    const dayMatches = recentMatches.filter(match => {
      const matchDate = match.startedAt || match.createdAt;
      if (!matchDate) return false;
      
      const matchDay = new Date(matchDate);
      return matchDay.toDateString() === date.toDateString();
    });
    
    activityData.push({
      date: dayName,
      matches: dayMatches.length
    });
  }

  // Cache with TTL (5 minutes) - fail silently if Redis unavailable
  try {
    const redis = getRedis();
    const key = RedisKeys.userActivity(userId);
    await Promise.race([
      redis.set(key, JSON.stringify(activityData), 'EX', 300),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis timeout')), 2000)
      )
    ]).catch(() => {
      // Redis unavailable - ignore, we already have the activity data from MongoDB
    });
  } catch (error) {
    // Redis unavailable - ignore
  }
  return activityData;
}

/**
 * Get avatar filename for any user or bot ID
 * @param id - User ID or Bot ID to fetch avatar for
 * @returns Avatar filename or null if not found
 */
export async function getAvatarByIdAction(id: string) {
  // Rate limiting for avatar requests
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(generalLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);

    // Validate ID format
    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return { success: false, error: 'Invalid ID format' };
    }

    // First, try to find in users collection
    const users = db.collection(USERS_COLLECTION);
    const user = await users.findOne(
      { _id: objectId },
      { projection: { 'profile.avatar': 1, avatarUrl: 1 } }
    );

    if (user) {
      // Check both possible avatar locations (schema migration compatibility)
      const avatar = user.profile?.avatar || user.avatarUrl || null;
      return { success: true, avatar };
    }

    // If not found in users, try bots collection
    const bots = db.collection('bots');
    const bot = await bots.findOne(
      { _id: objectId },
      { projection: { avatar: 1 } }
    );

    if (bot) {
      return { success: true, avatar: bot.avatar || null };
    }

    // Not found in either collection
    return { success: true, avatar: null };
  } catch (error: unknown) {
    console.error('Error fetching avatar by ID:', error);
    return { 
      success: false, 
      error: (error as Error).message || 'Failed to fetch avatar' 
    };
  }
}

