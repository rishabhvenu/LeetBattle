'use server';

import connectDB, { getMongoClient } from '../mongodb';
import { ObjectId } from 'mongodb';
import { getRedis, RedisKeys } from '../redis';
import { ensureAdminAccess, getSessionCookieHeader } from './shared';
import { adminLimiter, rateLimit, getClientIdentifier } from '../rateLimiter';
import { DB_NAME, USERS_COLLECTION, SESSIONS_COLLECTION, type User } from './constants';

/**
 * Helper function to scan Redis for keys matching a pattern
 */
async function scanRedisKeys(redis: ReturnType<typeof getRedis>, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  
  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');
  
  return keys;
}

/**
 * Reset all player data - Delete all matches and submissions, reset user stats, clear Redis data
 * Note: This does NOT delete user accounts or login information
 */
export async function resetAllPlayerData() {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  // Rate limiting for admin actions
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const matchesCollection = db.collection('matches');
    const submissionsCollection = db.collection('submissions');
    const usersCollection = db.collection('users');

    // Delete all matches
    const matchesResult = await matchesCollection.deleteMany({});
    
    // Delete all submissions
    const submissionsResult = await submissionsCollection.deleteMany({});
    
    // Reset all user stats (but keep login info)
    const usersResult = await usersCollection.updateMany(
      {},
      { 
        $set: { 
          stats: {
            totalMatches: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            rating: 1200,
          },
          'profile.avatar': null,
          'profile.bio': null,
          matchIds: [],
          updatedAt: new Date(),
        }
      }
    );
    
    // Also clear avatars from all sessions
    const sessionsCollection = db.collection(SESSIONS_COLLECTION);
    await sessionsCollection.updateMany(
      {},
      { $set: { 'user.avatar': null } }
    );

    // Clear all Redis data related to matches, queues, and user data
    const redis = getRedis();
    let redisKeysDeleted = 0;

    try {
      // Clear specific known keys
      await redis.del(RedisKeys.activeMatchesSet);
      await redis.del('queue:elo'); // ELO queue from backend
      await redis.del('user:conn'); // User connection map from backend
      redisKeysDeleted += 3;

      // Scan and delete all user stats keys (user:*:stats)
      const userStatsKeys = await scanRedisKeys(redis, 'user:*:stats');
      if (userStatsKeys.length > 0) {
        await redis.del(...userStatsKeys);
        redisKeysDeleted += userStatsKeys.length;
      }

      // Scan and delete all match keys (match:*)
      const matchKeys = await scanRedisKeys(redis, 'match:*');
      if (matchKeys.length > 0) {
        await redis.del(...matchKeys);
        redisKeysDeleted += matchKeys.length;
      }

      console.log(`Cleared ${redisKeysDeleted} Redis keys`);
    } catch (redisError: unknown) {
      console.error('Error clearing Redis data:', redisError);
      // Continue even if Redis clearing fails - at least DB is cleared
    }

    return { 
      success: true, 
      message: `Reset complete: ${matchesResult.deletedCount} matches, ${submissionsResult.deletedCount} submissions deleted. ${usersResult.modifiedCount} users reset. ${redisKeysDeleted} Redis keys cleared.`
    };
  } catch (error: unknown) {
    console.error('Error resetting player data:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get paginated users with search functionality
 */
export async function getUsers(
  page: number = 1, 
  limit: number = 10, 
  searchTerm?: string, 
  searchType?: 'username' | 'id'
) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  // Rate limiting for admin operations
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    // Build search query
    const query: Record<string, unknown> = {};
    if (searchTerm && searchType) {
      if (searchType === 'username') {
        query.username = { $regex: searchTerm, $options: 'i' };
      } else if (searchType === 'id') {
        try {
          query._id = new ObjectId(searchTerm);
        } catch {
          return { success: false, error: 'Invalid user ID format' };
        }
      }
    }

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Filter out incomplete user documents (orphaned bot stats entries)
    // Valid users must have a username field
    const validUserQuery = { ...query, username: { $exists: true, $ne: null } };

    // Get users with pagination
    const usersList = await users
      .find(validUserQuery)
      .sort({ createdAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)
      .toArray();

    // Deep serialize to convert all BSON types (ObjectId, Binary, etc.) to plain values
    const serializedUsers = usersList.map(user => {
      const plainUser = JSON.parse(JSON.stringify(user));
      return {
        ...plainUser,
        _id: user._id?.toString() ?? plainUser._id,
        createdAt: user.createdAt?.toISOString?.() ?? new Date().toISOString(),
        updatedAt: user.updatedAt?.toISOString?.() ?? new Date().toISOString(),
        lastLogin: user.lastLogin?.toISOString?.() ?? null,
      };
    });

    return { 
      success: true, 
      users: serializedUsers 
    };
  } catch (error: unknown) {
    console.error('Error fetching users:', error);
    return { 
      success: false, 
      error: (error as Error).message || 'Failed to fetch users' 
    };
  }
}

/**
 * Get total count of users for pagination
 */
export async function getTotalUsersCount(
  searchTerm?: string, 
  searchType?: 'username' | 'id'
) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  // Rate limiting for admin operations
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    // Build search query (same as getUsers)
    const query: Record<string, unknown> = {};
    if (searchTerm && searchType) {
      if (searchType === 'username') {
        query.username = { $regex: searchTerm, $options: 'i' };
      } else if (searchType === 'id') {
        try {
          query._id = new ObjectId(searchTerm);
        } catch {
          return { success: false, error: 'Invalid user ID format' };
        }
      }
    }

    // Filter out incomplete user documents (orphaned bot stats entries)
    const validUserQuery = { ...query, username: { $exists: true, $ne: null } };

    const count = await users.countDocuments(validUserQuery);
    return { 
      success: true, 
      count 
    };
  } catch (error: unknown) {
    console.error('Error counting users:', error);
    return { 
      success: false, 
      error: (error as Error).message || 'Failed to count users' 
    };
  }
}

/**
 * Update user fields (excluding password)
 */
export async function updateUser(userId: string, updates: Partial<User>) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  // Rate limiting for admin operations
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    // Validate user ID format
    let userObjectId;
    try {
      userObjectId = new ObjectId(userId);
    } catch {
      return { success: false, error: 'Invalid user ID format' };
    }

    // Check if user exists
    const existingUser = await users.findOne({ _id: userObjectId });
    if (!existingUser) {
      return { success: false, error: 'User not found' };
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Handle profile updates
    if (updates.profile) {
      updateData.profile = {
        ...existingUser.profile,
        ...updates.profile,
      };
    }

    // Handle stats updates
    if (updates.stats) {
      updateData.stats = {
        ...existingUser.stats,
        ...updates.stats,
      };
    }

    // Handle direct field updates (username, email)
    if (updates.username !== undefined) {
      // Check if username is unique (excluding current user)
      const usernameExists = await users.findOne({
        username: updates.username,
        _id: { $ne: userObjectId }
      });
      if (usernameExists) {
        return { success: false, error: 'Username already exists' };
      }
      updateData.username = updates.username;
    }

    if (updates.email !== undefined) {
      // Check if email is unique (excluding current user)
      const emailExists = await users.findOne({
        email: updates.email,
        _id: { $ne: userObjectId }
      });
      if (emailExists) {
        return { success: false, error: 'Email already exists' };
      }
      updateData.email = updates.email;
    }

    // Perform the update
    const result = await users.updateOne(
      { _id: userObjectId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return { success: false, error: 'User not found' };
    }

    // Invalidate user stats cache in Redis if stats were updated
    if (updates.stats) {
      const redis = getRedis();
      await redis.del(RedisKeys.userStats(userId));
    }

    return { 
      success: true, 
      message: 'User updated successfully' 
    };
  } catch (error: unknown) {
    console.error('Error updating user:', error);
    return { 
      success: false, 
      error: (error as Error).message || 'Failed to update user' 
    };
  }
}

/**
 * Get a single user by ID for editing
 */
export async function getUserById(userId: string) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  // Rate limiting for admin operations
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    // Validate user ID format
    let userObjectId;
    try {
      userObjectId = new ObjectId(userId);
    } catch {
      return { success: false, error: 'Invalid user ID format' };
    }

    const user = await users.findOne({ _id: userObjectId });
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Deep serialize to convert all BSON types (ObjectId, Binary, etc.) to plain values
    const plainUser = JSON.parse(JSON.stringify(user));
    const serializedUser = {
      ...plainUser,
      _id: user._id?.toString() ?? plainUser._id,
      createdAt: user.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: user.updatedAt?.toISOString?.() ?? new Date().toISOString(),
      lastLogin: user.lastLogin?.toISOString?.() ?? null,
    };

    return { 
      success: true, 
      user: serializedUser 
    };
  } catch (error: unknown) {
    console.error('Error fetching user:', error);
    return { 
      success: false, 
      error: (error as Error).message || 'Failed to fetch user' 
    };
  }
}

/**
 * Inspect a specific match in Redis
 * Returns detailed information about the match key existence and related data
 */
export async function inspectMatchInRedis(matchId: string) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  // Rate limiting for admin actions
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    const redis = getRedis();
    const matchKey = RedisKeys.matchKey(matchId);
    
    const result: {
      success: boolean;
      error?: string;
      matchKey: string;
      keyExists: boolean;
      inActiveSet: boolean;
      matchData?: any;
      reservationKeys?: Array<{ key: string; data: any }>;
      ratingData?: Record<string, string>;
      allMatchKeys?: string[];
      activeMatches?: string[];
    } = {
      success: true,
      matchKey,
      keyExists: false,
      inActiveSet: false,
    };

    // Check if key exists
    const exists = await redis.exists(matchKey);
    result.keyExists = exists === 1;

    // Get match data if it exists
    if (result.keyExists) {
      try {
        const matchRaw = await redis.get(matchKey);
        if (matchRaw) {
          result.matchData = JSON.parse(matchRaw);
        }
      } catch (e) {
        // Failed to parse
      }
    }

    // Check if in active matches set
    const isActive = await redis.sismember(RedisKeys.activeMatchesSet, matchId);
    result.inActiveSet = isActive === 1;

    // Get active matches list (limit to 50 for performance)
    try {
      const activeMatches = await redis.smembers(RedisKeys.activeMatchesSet);
      result.activeMatches = activeMatches.slice(0, 50);
    } catch (e) {
      // Ignore errors
    }

    // Check rating hash
    const ratingKey = `match:${matchId}:ratings`;
    const ratingExists = await redis.exists(ratingKey);
    if (ratingExists) {
      try {
        result.ratingData = await redis.hgetall(ratingKey);
      } catch (e) {
        // Ignore errors
      }
    }

    // Scan for reservation keys that reference this match
    try {
      const reservationKeys = await scanRedisKeys(redis, 'queue:reservation:*');
      const matchingReservations: Array<{ key: string; data: any }> = [];
      
      for (const key of reservationKeys.slice(0, 100)) {
        try {
          const value = await redis.get(key);
          if (value) {
            const parsed = JSON.parse(value);
            if (parsed.matchId === matchId) {
              matchingReservations.push({ key, data: parsed });
            }
          }
        } catch (e) {
          // Skip unparseable values
        }
      }
      
      if (matchingReservations.length > 0) {
        result.reservationKeys = matchingReservations;
      }
    } catch (e) {
      // Ignore errors
    }

    // Get sample of all match keys (limit to 20 for performance)
    try {
      const allMatchKeys = await scanRedisKeys(redis, 'match:*');
      // Filter to just blob keys (not sub-keys like :ratings, :code, etc)
      const blobKeys = allMatchKeys.filter(k => !k.includes(':user:') && !k.includes(':ratings') && !k.includes(':code:'));
      result.allMatchKeys = blobKeys.slice(0, 20);
    } catch (e) {
      // Ignore errors
    }

    return result;
  } catch (error: unknown) {
    console.error('Error inspecting match in Redis:', error);
    return {
      success: false,
      error: (error as Error).message || 'Failed to inspect match in Redis',
      matchKey: RedisKeys.matchKey(matchId),
      keyExists: false,
      inActiveSet: false,
    };
  }
}

/**
 * Cleanup orphaned user records - users without usernames that appear on leaderboard
 * This fixes the "Unknown" user issue on the leaderboard
 */
export async function cleanupOrphanedUsers(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  deletedCount?: number;
  deletedIds?: string[];
}> {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }

    const response = await fetch(`${apiBase}/admin/users/cleanup-orphans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || 'Failed to cleanup orphaned users' };
    }
    return result;
  } catch (error) {
    console.error('Error cleaning up orphaned users:', error);
    return { success: false, error: 'Failed to cleanup orphaned users' };
  }
}

