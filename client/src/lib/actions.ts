'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import connectDB, { getMongoClient } from './mongodb';
import bcrypt from 'bcryptjs';
import { generatePresignedUrl } from './minio';
import { getRedis, RedisKeys } from './redis';
import { ensureMatchEventsSubscriber } from './matchEventsSubscriber';
import { ObjectId } from 'mongodb';
import { tryToObjectId } from './utilsObjectId';
import { REST_ENDPOINTS } from '../constants/RestEndpoints';
import { 
  authLimiter, 
  generalLimiter, 
  queueLimiter, 
  adminLimiter, 
  uploadLimiter, 
  rateLimit, 
  getClientIdentifier 
} from './rateLimiter';

const MONGODB_URI = process.env.MONGODB_URI!;
const DB_NAME = 'codeclashers';

// Disable MongoDB native driver logging
const mongoOptions = {
  monitorCommands: false,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};
const USERS_COLLECTION = 'users';
const SESSIONS_COLLECTION = 'sessions';

export interface User {
  _id?: string;
  username: string;
  email: string;
  password: string;
  profile: {
    firstName: string;
    lastName: string;
    avatar?: string;
    bio?: string;
  };
  stats: {
    totalMatches: number;
    wins: number;
    losses: number;
    draws: number;
    rating: number;
  };
  lastLogin: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionData {
  userId?: string;
  user?: {
    id: string;
    email: string;
    username: string;
    avatar?: string;
  };
  authenticated: boolean;
}

export async function registerUser(prevState: any, formData: FormData) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(authLimiter, identifier);
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }

  // Extract form data
  const username = formData.get('username') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;
  const firstName = formData.get('firstName') as string;
  const lastName = formData.get('lastName') as string;

  // Validation
  if (!username || !email || !password || !firstName || !lastName) {
    return { error: 'All fields are required' };
  }

  if (password !== confirmPassword) {
    return { error: 'Passwords do not match' };
  }

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters long' };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    // Check if user already exists
    const existingUser = await users.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return { error: 'User with this email or username already exists' };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const newUser: Omit<User, '_id'> = {
      username,
      email,
      password: hashedPassword,
      profile: {
        firstName,
        lastName,
      },
      stats: {
        totalMatches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        rating: 1200,
      },
      lastLogin: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await users.insertOne(newUser);

    if (result.insertedId) {
      // Create session
      await createSession(result.insertedId.toString(), email, username);
      // Redirect after successful registration
      redirect('/');
    }

    return { error: 'Failed to create user' };
  } catch (error) {
    // Check if it's a redirect error (which is expected)
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error; // Re-throw redirect errors
    }
    console.error('Registration error:', error);
    return { error: 'An error occurred during registration' };
  }
}

export async function loginUser(prevState: any, formData: FormData) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(authLimiter, identifier);
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }

  // Debug: Log what we're receiving
  console.log('FormData received:', formData);
  console.log('FormData type:', typeof formData);
  console.log('Has get method:', typeof formData.get === 'function');
  console.log('FormData entries:', Array.from(formData.entries()));
  
  // Extract form data - should always be FormData in Next.js 15
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
    
  console.log('Extracted email:', email);
  console.log('Extracted password:', password ? '[REDACTED]' : 'undefined');

  if (!email || !password) {
    return { error: 'Email and password are required' };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    // Find user by email
    const user = await users.findOne({ email });

    if (!user) {
      return { error: 'Invalid credentials' };
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return { error: 'Invalid credentials' };
    }

    // Update last login
    await client.connect();
    await users.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

    // Create session
    await createSession(user._id.toString(), user.email, user.username);
    // Redirect after successful login
    redirect('/');
  } catch (error) {
    // Check if it's a redirect error (which is expected)
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error; // Re-throw redirect errors
    }
    console.error('Login error:', error);
    return { error: 'An error occurred during login' };
  }
}

export async function getSession(): Promise<SessionData> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('codeclashers.sid');
    
    if (!sessionCookie) {
      return { authenticated: false };
    }

    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const sessions = db.collection(SESSIONS_COLLECTION);
    
    // Find session in MongoDB
    const session = await sessions.findOne({ 
      _id: sessionCookie.value as any,
      expires: { $gt: new Date() }
    } as any);
    
    
    if (session && session.userId) {
      return {
        authenticated: true,
        userId: (session.userId && typeof session.userId === 'object' && 'toString' in session.userId)
          ? (session.userId as any).toString()
          : String(session.userId),
        user: session.user
      };
    }
    
    return { authenticated: false };
  } catch (error) {
    console.error('Session error:', error);
    return { authenticated: false };
  }
}

export async function logoutUser() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('codeclashers.sid')?.value;

    if (sessionId) {
      await connectDB();
      const client = await getMongoClient();
      const db = client.db(DB_NAME);
      const sessions = db.collection(SESSIONS_COLLECTION);
      
      // Remove session from MongoDB
      await sessions.deleteOne({ _id: sessionId as any } as any);
    }

    // Clear cookie
    cookieStore.delete('codeclashers.sid');
    redirect('/login');
  } catch (error) {
    // Check if it's a redirect error (which is expected)
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error; // Re-throw redirect errors
    }
    console.error('Logout error:', error);
    redirect('/');
  }
}

// Leaderboard server action
export async function getLeaderboardData(page: number = 1, limit: number = 10) {
  const K_FACTOR = 32;
  const INITIAL_RATING = 1200;
  const ROLLING_DAYS = 180;
  
  const cacheKey = `leaderboard:page:${page}:limit:${limit}`;

  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const client = await getMongoClient();
    const db = client.db();

    const cutoff = new Date(Date.now() - ROLLING_DAYS * 24 * 60 * 60 * 1000);

    const matches = await db
      .collection('matches')
      .find({ status: 'finished', endedAt: { $gte: cutoff } })
      .project({ playerIds: 1, winnerUserId: 1, endedAt: 1 })
      .sort({ endedAt: 1 })
      .toArray();

    const userStats = new Map();

    function ensureUser(userId: any) {
      if (!userStats.has(userId)) {
        userStats.set(userId, { rating: INITIAL_RATING, gamesWon: 0, gamesPlayed: 0 });
      }
    }

    function expectedScore(rating: number, opponentRating: number): number {
      return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
    }

    function updateRating(current: number, opponent: number, score: 0 | 0.5 | 1): number {
      const exp = expectedScore(current, opponent);
      return current + K_FACTOR * (score - exp);
    }

    for (const m of matches) {
      if (!Array.isArray(m.playerIds) || m.playerIds.length !== 2) continue;
      const [a, b] = m.playerIds;
      ensureUser(a);
      ensureUser(b);
      const aStats = userStats.get(a);
      const bStats = userStats.get(b);

      let aScore: 0 | 0.5 | 1 = 0.5;
      let bScore: 0 | 0.5 | 1 = 0.5;
      if (m.winnerUserId) {
        if (String(m.winnerUserId) === String(a)) {
          aScore = 1;
          bScore = 0;
        } else if (String(m.winnerUserId) === String(b)) {
          aScore = 0;
          bScore = 1;
        }
      }

      const aNew = updateRating(aStats.rating, bStats.rating, aScore);
      const bNew = updateRating(bStats.rating, aStats.rating, bScore);
      aStats.rating = aNew;
      bStats.rating = bNew;
      aStats.gamesPlayed += 1;
      bStats.gamesPlayed += 1;
      if (aScore === 1) aStats.gamesWon += 1;
      if (bScore === 1) bStats.gamesWon += 1;
    }

    const userIds = Array.from(userStats.keys());
    const users = await db
      .collection('users')
      .find({ _id: { $in: userIds } })
      .project({ username: 1, avatarUrl: 1 })
      .toArray();

    const idToUser = {};
    for (const u of users) {
      idToUser[String(u._id)] = u;
    }

    const bucketUrl = process.env.NEXT_PUBLIC_PFP_BUCKET_URL || '';
    function toAvatarPath(avatarUrl) {
      if (!avatarUrl) return null;
      if (bucketUrl && avatarUrl.startsWith(bucketUrl)) {
        return avatarUrl.slice(bucketUrl.length);
      }
      return null;
    }

    const rows = await Promise.all(Array.from(userStats.entries()).map(async ([id, stats]) => {
      const u = idToUser[String(id)];
      
      // Fetch avatar using centralized function
      let avatar = null;
      const avatarResult = await getAvatarByIdAction(id);
      if (avatarResult.success) {
        avatar = avatarResult.avatar;
      }
      
      return {
        _id: String(id),
        username: u?.username || 'Unknown',
        avatar: avatar,
        rating: Math.round(stats.rating),
        stats: {
          gamesWon: stats.gamesWon,
          gamesPlayed: stats.gamesPlayed,
        },
      };
    }));

    rows.sort((a, b) => b.rating - a.rating);

    const totalPages = Math.max(1, Math.ceil(rows.length / limit));
    const start = (page - 1) * limit;
    const usersPage = rows.slice(start, start + limit);

    const payload = { users: usersPage, totalPages };

    await redis.set(cacheKey, JSON.stringify(payload), 'EX', 60);

    return payload;
  } catch (err) {
    console.error('Leaderboard server action error', err);
    return { users: [], totalPages: 1 };
  }
}

async function createSession(userId: string, email: string, username: string) {
  try {
    const sessionId = crypto.randomUUID();
    
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);
    const sessions = db.collection(SESSIONS_COLLECTION);
    
    // Get full user data including profile
    const user = await users.findOne({ _id: new ObjectId(userId) });
    
    // Check both possible locations for avatar (schema migration compatibility)
    const userAvatar = user?.profile?.avatar || user?.avatarUrl || null;
    
    // Create session data
    const sessionData = {
      _id: sessionId,
      userId: new ObjectId(userId),
      user: {
        id: userId,
        email,
        username,
        avatar: userAvatar,
        firstName: user?.profile?.firstName || '',
        lastName: user?.profile?.lastName || ''
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      createdAt: new Date()
    };
    
    // Store session in MongoDB
    await sessions.insertOne(sessionData as any);
    
    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set('codeclashers.sid', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60, // 24 hours
      path: '/'
    });
  } catch (error) {
    console.error('Session creation error:', error);
    throw error;
  }
}

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
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('codeclashers.sid')?.value;
    if (!sessionId) return { success: false, error: 'No session' };

    await connectDB();
    const client = await getMongoClient();

    const db = client.db(DB_NAME);
    const sessions = db.collection(SESSIONS_COLLECTION);
    const users = db.collection(USERS_COLLECTION);

    // Update session user avatar
    await sessions.updateOne(
      { _id: sessionId } as any,
      { $set: { 'user.avatar': fileName } }
    );

    // Update user profile avatar
    const sessionDoc = await sessions.findOne({ _id: sessionId } as any);
    if (sessionDoc?.userId) {
      const userObjectId = tryToObjectId(sessionDoc.userId) || new (await import('mongodb')).ObjectId(String(sessionDoc.userId));
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
  const redis = getRedis();
  const key = RedisKeys.userStats(userId);
  // Try cache
  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  // Fallback: compute from matches
  await connectDB();
  const client = await getMongoClient();
  const db = client.db(DB_NAME);
  const matches = db.collection('matches');
  const users = db.collection('users');

  // Aggregate wins and total matches; timeCoded placeholder 0 for now
  const userObjectId = new (await import('mongodb')).ObjectId(userId);
  const totalMatches = await matches.countDocuments({ playerIds: userObjectId });
  const wins = await matches.countDocuments({ winnerUserId: userObjectId });
  // Get user's rating (default 1200 if missing)
  const userDoc: any = await users.findOne({ _id: userObjectId }, { projection: { 'stats.rating': 1 } });
  const rating = userDoc?.stats?.rating ?? 1200;
  // Compute global rank among all users by rating: count users with higher rating + 1
  const higherCount = await users.countDocuments({ 'stats.rating': { $gt: rating } });
  const globalRank = higherCount + 1;

  const stats = {
    totalMatches,
    wins,
    losses: Math.max(totalMatches - wins, 0),
    draws: 0,
    timeCoded: 0,
    globalRank,
    rating,
  };

  // Cache with TTL (e.g., 5 minutes)
  await redis.set(key, JSON.stringify(stats), 'EX', 300);
  return stats;
}

// Cached user activity data for the last 7 days
export async function getUserActivityCached(userId: string) {
  const redis = getRedis();
  const key = RedisKeys.userActivity(userId);
  
  // Try cache first
  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  // Fallback: compute from matches
  await connectDB();
  const client = await getMongoClient();
  const db = client.db(DB_NAME);
  const matches = db.collection('matches');

  const userObjectId = new (await import('mongodb')).ObjectId(userId);
  
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

  // Cache with TTL (5 minutes)
  await redis.set(key, JSON.stringify(activityData), 'EX', 300);
  return activityData;
}

// Active matches helpers
export async function getOngoingMatchesCount(): Promise<number> {
  const redis = getRedis();
  // Use Redis set of active match IDs; fallback to Mongo if missing
  const count = await redis.scard(RedisKeys.activeMatchesSet);
  if (count && count > 0) return count;

  await connectDB();
  const client = await getMongoClient();
  const db = client.db(DB_NAME);
  const matches = db.collection('matches');
  // Consider a match ongoing if it has no endedAt
  const mongoCount = await matches.countDocuments({ endedAt: { $exists: false } });
  return mongoCount;
}

export async function getActiveMatches() {
  try {
    const redis = getRedis();
    await connectDB();
    const client = await getMongoClient();
    const mongoDb = client.db(DB_NAME);
    const users = mongoDb.collection('users');
    const problems = mongoDb.collection('problems');

    // Get active match IDs from Redis
    const activeMatchIds = await redis.smembers(RedisKeys.activeMatchesSet);
    
    if (activeMatchIds.length === 0) {
      return { success: true, matches: [] };
    }

    const matches = [];
    
    for (const matchId of activeMatchIds) {
      try {
        // Get match data from Redis
        const matchKey = RedisKeys.matchKey(matchId);
        const matchRaw = await redis.get(matchKey);
        
        if (!matchRaw) continue;
        
        const matchData = JSON.parse(matchRaw);
        
        // Skip if match is finished
        if (matchData.status === 'finished' || matchData.endedAt) continue;
        
        // Get problem details
        let problemTitle = 'Unknown Problem';
        let difficulty = 'Medium';
        
        if (matchData.problem) {
          problemTitle = matchData.problem.title || 'Unknown Problem';
          difficulty = matchData.problem.difficulty || 'Medium';
        } else if (matchData.problemId) {
          // Fallback to MongoDB
          try {
            const problem = await problems.findOne({ _id: new ObjectId(matchData.problemId) });
            if (problem) {
              problemTitle = problem.title || 'Unknown Problem';
              difficulty = problem.difficulty || 'Medium';
            }
          } catch (error) {
            console.warn(`Could not fetch problem ${matchData.problemId}:`, error);
          }
        }
        
        // Process players
        const players = [];
        const playerIds = Object.keys(matchData.players || {});
        
        for (const playerId of playerIds) {
          const isBot = playerId.startsWith('bot:');
          const playerInfo = {
            userId: playerId,
            username: matchData.players[playerId]?.username || playerId,
            isBot,
            rating: 1200,
            linesWritten: matchData.linesWritten?.[playerId] || 0,
            avatar: undefined as string | undefined
          };
          
          // Get real user data if not a bot
          if (!isBot) {
            try {
              const user = await users.findOne(
                { _id: new ObjectId(playerId) },
                { projection: { username: 1, 'profile.avatar': 1, 'stats.rating': 1 } }
              );
              if (user) {
                playerInfo.username = user.username || playerInfo.username;
                playerInfo.rating = user.stats?.rating || playerInfo.rating;
                playerInfo.avatar = user.profile?.avatar;
              }
            } catch (error) {
              console.warn(`Could not fetch user ${playerId}:`, error);
            }
          }
          
          players.push(playerInfo);
        }
        
        // Calculate time elapsed and remaining
        const startTime = matchData.startedAt ? new Date(matchData.startedAt).getTime() : Date.now();
        const timeElapsed = Date.now() - startTime;
        const maxDuration = 45 * 60 * 1000; // 45 minutes in milliseconds
        const timeRemaining = Math.max(0, maxDuration - timeElapsed);
        
        // Process submissions
        const submissions = (matchData.submissions || []).map((sub: { userId: string; timestamp: string; passed: boolean; language: string }) => ({
          userId: sub.userId,
          timestamp: sub.timestamp,
          passed: sub.passed,
          language: sub.language
        }));
        
        matches.push({
          matchId,
          problemId: matchData.problemId,
          problemTitle,
          difficulty,
          players,
          status: matchData.status || 'ongoing',
          startedAt: matchData.startedAt || new Date(startTime).toISOString(),
          timeElapsed,
          timeRemaining,
          submissions
        });
      } catch (error) {
        console.warn(`Error processing match ${matchId}:`, error);
      }
    }
    
    return { success: true, matches };
  } catch (error) {
    console.error('Error fetching active matches:', error);
    return { success: false, error: 'Failed to fetch active matches', matches: [] };
  }
}

// Queueing and match orchestration (server actions)
// Note: Matchmaking is now handled entirely by backend Colyseus matchmaker
export async function enqueueUser(userId: string, rating: number) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(queueLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  // Backend is authoritative; subscriber disabled to avoid double writes
  const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
  const res = await fetch(`${base}/queue/enqueue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, rating }) });
  if (!res.ok) return { success: false };
  return { success: true };
}

export async function dequeueUser(userId: string) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(queueLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  // Backend is authoritative; subscriber disabled to avoid double writes
  const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
  const res = await fetch(`${base}/queue/dequeue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
  if (!res.ok) return { success: false };
  return { success: true };
}

export async function consumeReservation(userId: string) {
  // Backend is authoritative; subscriber disabled to avoid double writes
  const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
  const tokRes = await fetch(`${base}/queue/reservation?userId=${encodeURIComponent(userId)}`);
  if (!tokRes.ok) return { success: false, error: 'no_token' };
  const { token } = await tokRes.json();
  const conRes = await fetch(`${base}/reserve/consume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  if (!conRes.ok) return { success: false, error: 'consume_failed' };
  const data = await conRes.json();
  const reservation = data.reservation;
  
  console.log('consumeReservation - reservation:', reservation);
  
  // Problem is already selected by QueueRoom, no need to select it here
  return { success: true, reservation };
}

export async function clearReservation(userId: string) {
  const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
  await fetch(`${base}/queue/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
}

/**
 * Get match data including problem, opponent stats, and starter code
 */
export async function getMatchData(matchId: string, userId: string) {
  try {
    const redis = getRedis();
    const matchKey = RedisKeys.matchKey(matchId);
    
    // Get match data from Redis
    const matchRaw = await redis.get(matchKey);
    if (!matchRaw) {
      return { success: false, error: 'match_not_found' };
    }
    
    const matchData = JSON.parse(matchRaw);
    const problem = matchData.problem;
    
    // Get opponent userId from match players (array format)
    const playerUserIds = Array.isArray(matchData.players) 
      ? matchData.players 
      : Object.keys(matchData.players || {});
    const opponentUserId = playerUserIds.find(id => id !== userId) || playerUserIds[0];
    
    // Get opponent stats
    const opponentStats = await getUserStatsCached(opponentUserId);
    
    // Get current user stats
    const userStats = await getUserStatsCached(userId);
    
    // Get opponent info from Redis playerData
    const opponentPlayerData = matchData.playerData?.[opponentUserId];
    
    let opponentAvatar = null;
    let opponentUsername = 'Opponent';
    let opponentName = 'Opponent';
    
    // Check Redis first for username
    if (opponentPlayerData) {
      opponentUsername = opponentPlayerData.username || 'Opponent';
    }
    
    // Always fetch avatar using centralized function (handles both users and bots)
    const avatarResult = await getAvatarByIdAction(opponentUserId);
    if (avatarResult.success) {
      opponentAvatar = avatarResult.avatar;
    }
    
    // If not in Redis, fetch full user info from MongoDB for name
    if (!opponentPlayerData) {
      await connectDB();
      const client = await getMongoClient();
      const db = client.db(DB_NAME);
      const users = db.collection('users');
      const opponentUser: any = await users.findOne(
        { _id: new ObjectId(opponentUserId) },
        { projection: { username: 1, 'profile.firstName': 1, 'profile.lastName': 1 } }
      );
      
      if (opponentUser) {
        opponentUsername = opponentUser?.username || 'Opponent';
        opponentName = `${opponentUser?.profile?.firstName || ''} ${opponentUser?.profile?.lastName || ''}`.trim() || opponentUsername;
      } else {
        // Check if it's a bot
        const bots = db.collection('bots');
        const bot: any = await bots.findOne(
          { _id: new ObjectId(opponentUserId) },
          { projection: { username: 1, fullName: 1 } }
        );
        
        if (bot) {
          opponentUsername = bot.username || 'Bot';
          opponentName = bot.fullName || opponentUsername;
        }
      }
    } else {
      // Get full name from MongoDB for user
      await connectDB();
      const client = await getMongoClient();
      const db = client.db(DB_NAME);
      const users = db.collection('users');
      const opponentUser: any = await users.findOne(
        { _id: new ObjectId(opponentUserId) },
        { projection: { 'profile.firstName': 1, 'profile.lastName': 1 } }
      );
      
      if (opponentUser) {
        opponentName = `${opponentUser?.profile?.firstName || ''} ${opponentUser?.profile?.lastName || ''}`.trim() || opponentUsername;
      } else {
        // Check if it's a bot
        const bots = db.collection('bots');
        const bot: any = await bots.findOne(
          { _id: new ObjectId(opponentUserId) },
          { projection: { fullName: 1 } }
        );
        
        if (bot) {
          opponentName = bot.fullName || opponentUsername;
        }
      }
    }
    
    // Generate starter code if not present
    const starterCode = problem.starterCode || generateStarterCode(problem.signature);
    
    const opponentData = {
        userId: opponentUserId,
      username: opponentUsername,
      name: opponentName,
      avatar: opponentAvatar,
        globalRank: opponentStats.globalRank || 1234,
        gamesWon: opponentStats.wins || 0,
        winRate: opponentStats.totalMatches > 0 ? Math.round((opponentStats.wins / opponentStats.totalMatches) * 100) : 0,
        rating: opponentStats.rating || 1200,
    };
    
    // Remove testCases from client-facing problem data (security)
    const { testCases, solutions, ...clientProblem } = problem;
    
    return {
      success: true,
      problem: {
        ...clientProblem,
        starterCode,
      },
      opponent: opponentData,
      userStats: {
        rating: userStats.rating || 1200,
        totalMatches: userStats.totalMatches || 0,
        wins: userStats.wins || 0,
        winRate: userStats.totalMatches > 0 ? Math.round((userStats.wins / userStats.totalMatches) * 100) : 0,
      },
    };
  } catch (error) {
    console.error('Error getting match data:', error);
    return { success: false, error: 'fetch_failed' };
  }
}

/**
 * Generate starter code from function signature
 */
function generateStarterCode(signature: any) {
  if (!signature) return null;
  
  const { functionName, parameters, returnType } = signature;
  
  const starterCode: any = {};
  
  // JavaScript
  const jsParams = parameters.map((p: any) => p.name).join(', ');
  starterCode.javascript = `class Solution {
    /**
 * @param {${parameters.map((p: any) => `${p.type} ${p.name}`).join(', ')}}
 * @return {${returnType}}
 */
    ${functionName}(${jsParams}) {
    // Your code here
    }
}`;
  
  // Python
  const pyParams = parameters.map((p: any) => p.name).join(', ');
  starterCode.python = `class Solution:
    def ${functionName}(self, ${pyParams}):
    """
    Args:
            ${parameters.map((p: any) => `${p.name}: ${p.type}`).join('\n            ')}
    Returns:
        ${returnType}
    """
    # Your code here
    pass`;
  
  // Java
  const javaParams = parameters.map((p: any) => `${convertToJavaType(p.type)} ${p.name}`).join(', ');
  starterCode.java = `class Solution {
    public ${convertToJavaType(returnType)} ${functionName}(${javaParams}) {
        // Your code here
        ${getJavaDefaultReturn(returnType)}
    }
}`;
  
  // C++
  const cppParams = parameters.map((p: any) => `${convertToCppType(p.type)} ${p.name}`).join(', ');
  starterCode.cpp = `class Solution {
public:
    ${convertToCppType(returnType)} ${functionName}(${cppParams}) {
        // Your code here
        ${getCppDefaultReturn(returnType)}
    }
};`;
  
  return starterCode;
}

// Helper functions for type conversion
function convertToJavaType(type: string): string {
  const typeMap: Record<string, string> = {
    'int': 'int',
    'int[]': 'int[]',
    'string': 'String',
    'string[]': 'String[]',
    'bool': 'boolean',
    'bool[]': 'boolean[]',
  };
  return typeMap[type.toLowerCase()] || type;
}

function convertToCppType(type: string): string {
  const typeMap: Record<string, string> = {
    'int': 'int',
    'int[]': 'vector<int>',
    'string': 'string',
    'string[]': 'vector<string>',
    'bool': 'bool',
    'bool[]': 'vector<bool>',
  };
  return typeMap[type.toLowerCase()] || type;
}

function getJavaDefaultReturn(returnType: string): string {
  if (returnType.includes('[]')) return 'return new ' + returnType.replace('[]', '[0]') + ';';
  if (returnType === 'int') return 'return 0;';
  if (returnType === 'boolean') return 'return false;';
  if (returnType === 'String') return 'return "";';
  return 'return null;';
}

function getCppDefaultReturn(returnType: string): string {
  if (returnType.includes('vector')) return 'return {};';
  if (returnType === 'int') return 'return 0;';
  if (returnType === 'bool') return 'return false;';
  if (returnType === 'string') return 'return "";';
  return 'return {};';
}

export async function finalizeMatch(matchId: string) {
  // Backend is authoritative; subscriber disabled to avoid double writes
  // Read Redis blob and persist into MongoDB
  const redis = getRedis();
  const raw = await redis.get(RedisKeys.matchKey(matchId));
  if (!raw) return { success: false, error: 'not_found' };
  const state = JSON.parse(raw);
  await persistMatchFromState(state);
  return { success: true };
}

/**
 * Calculate ELO rating changes
 */
function calculateEloChange(winnerRating: number, loserRating: number, isDraw: boolean = false): { winnerDelta: number; loserDelta: number } {
  const K = 32; // K-factor for ELO calculation
  const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));
  
  if (isDraw) {
    const winnerDelta = Math.round(K * (0.5 - expectedWinner));
    const loserDelta = Math.round(K * (0.5 - expectedLoser));
    return { winnerDelta, loserDelta };
  }
  
  const winnerDelta = Math.round(K * (1 - expectedWinner));
  const loserDelta = Math.round(K * (0 - expectedLoser));
  return { winnerDelta, loserDelta };
}

/**
 * Update player stats and ratings after match completion
 */
async function updatePlayerStatsAndRatings(playerIds: string[], winnerUserId: string | null, isDraw: boolean, db: any, ratingChanges?: Record<string, { oldRating: number; newRating: number; change: number }>) {
  const users = db.collection('users');
  const { ObjectId } = await import('mongodb');
  const redis = getRedis();
  
  // Use pre-calculated rating changes if available (from MatchRoom with difficulty adjustments)
  if (ratingChanges && playerIds.length === 2) {
    console.log('Using pre-calculated rating changes from MatchRoom:', ratingChanges);
    
    // Apply the pre-calculated rating changes directly
    for (const playerId of playerIds) {
      const playerObjectId = new ObjectId(playerId);
      const ratingChange = ratingChanges[playerId];
      
      if (!ratingChange) {
        console.warn(`No rating change found for player ${playerId}`);
        continue;
      }
      
      // Determine if this player won, lost, or drew
      let statUpdate: any = { 'stats.totalMatches': 1 };
      
      if (isDraw) {
        statUpdate['stats.draws'] = 1;
      } else if (winnerUserId === playerId) {
        statUpdate['stats.wins'] = 1;
      } else {
        statUpdate['stats.losses'] = 1;
      }
      
      // Ensure stats exists with defaults first
      await users.updateOne(
        { _id: playerObjectId },
        { 
          $setOnInsert: { 
            'stats.wins': 0, 
            'stats.losses': 0, 
            'stats.draws': 0,
            'stats.totalMatches': 0,
            'stats.rating': 1200
          }
        },
        { upsert: true }
      );
      
      // Apply rating change and stats update
      await users.updateOne(
        { _id: playerObjectId },
        { 
          $inc: { 
            ...statUpdate,
            'stats.rating': ratingChange.change
          }
        }
      );
      
      console.log(`Player ${playerId} rating updated: ${ratingChange.oldRating} → ${ratingChange.newRating} (${ratingChange.change > 0 ? '+' : ''}${ratingChange.change})`);
    }
    
    // Invalidate user stats cache in Redis for both players
    await redis.del(RedisKeys.userStats(playerIds[0]));
    await redis.del(RedisKeys.userStats(playerIds[1]));
    
    console.log('Player stats and ratings updated successfully using pre-calculated values');
    return;
  }
  
  // Fallback to old calculation method if no pre-calculated values available
  console.log('No pre-calculated rating changes found, using legacy calculation method');
  
  // Get current ratings for both players
  const player1Id = new ObjectId(playerIds[0]);
  const player2Id = new ObjectId(playerIds[1]);
  
  const player1 = await users.findOne({ _id: player1Id }, { projection: { 'stats.rating': 1 } });
  const player2 = await users.findOne({ _id: player2Id }, { projection: { 'stats.rating': 1 } });
  
  const player1Rating = player1?.stats?.rating || 1200;
  const player2Rating = player2?.stats?.rating || 1200;
  
  if (isDraw) {
    // Draw scenario - both players get draw count, rating changes based on ELO
    const { winnerDelta: player1Delta, loserDelta: player2Delta } = calculateEloChange(player1Rating, player2Rating, true);
    
    // Ensure stats exists with defaults first
    await users.updateOne(
      { _id: player1Id },
      { 
        $setOnInsert: { 
          'stats.wins': 0, 
          'stats.losses': 0, 
          'stats.draws': 0,
          'stats.totalMatches': 0,
          'stats.rating': 1200
        }
      },
      { upsert: true }
    );
    
    // Now increment
    await users.updateOne(
      { _id: player1Id },
      { 
        $inc: { 
          'stats.draws': 1,
          'stats.totalMatches': 1,
          'stats.rating': player1Delta
        }
      }
    );
    
    // Same for player 2
    await users.updateOne(
      { _id: player2Id },
      { 
        $setOnInsert: { 
          'stats.wins': 0, 
          'stats.losses': 0, 
          'stats.draws': 0,
          'stats.totalMatches': 0,
          'stats.rating': 1200
        }
      },
      { upsert: true }
    );
    
    await users.updateOne(
      { _id: player2Id },
      { 
        $inc: { 
          'stats.draws': 1,
          'stats.totalMatches': 1,
          'stats.rating': player2Delta
        }
      }
    );
    
    console.log(`Draw - Player ratings updated: ${playerIds[0]} (${player1Rating} → ${player1Rating + player1Delta}, ${player1Delta > 0 ? '+' : ''}${player1Delta}), ${playerIds[1]} (${player2Rating} → ${player2Rating + player2Delta}, ${player2Delta > 0 ? '+' : ''}${player2Delta})`);
  } else if (winnerUserId) {
    // Winner/Loser scenario
    const loserId = playerIds.find(id => id !== winnerUserId);
    if (!loserId) return;
    
    const winnerObjectId = new ObjectId(winnerUserId);
    const loserObjectId = new ObjectId(loserId);
    
    // Determine which player is winner/loser and get their ratings
    const isPlayer1Winner = winnerUserId === playerIds[0];
    const winnerRating = isPlayer1Winner ? player1Rating : player2Rating;
    const loserRating = isPlayer1Winner ? player2Rating : player1Rating;
    
    const { winnerDelta, loserDelta } = calculateEloChange(winnerRating, loserRating, false);
    
    // Ensure winner stats exists with defaults first
    await users.updateOne(
      { _id: winnerObjectId },
      { 
        $setOnInsert: { 
          'stats.wins': 0, 
          'stats.losses': 0, 
          'stats.draws': 0,
          'stats.totalMatches': 0,
          'stats.rating': 1200
        }
      },
      { upsert: true }
    );
    
    // Update winner stats
    await users.updateOne(
      { _id: winnerObjectId },
      { 
        $inc: { 
          'stats.wins': 1,
          'stats.totalMatches': 1,
          'stats.rating': winnerDelta
        }
      }
    );
    
    // Ensure loser stats exists with defaults first
    await users.updateOne(
      { _id: loserObjectId },
      { 
        $setOnInsert: { 
          'stats.wins': 0, 
          'stats.losses': 0, 
          'stats.draws': 0,
          'stats.totalMatches': 0,
          'stats.rating': 1200
        }
      },
      { upsert: true }
    );
    
    // Update loser stats
    await users.updateOne(
      { _id: loserObjectId },
      { 
        $inc: { 
          'stats.losses': 1,
          'stats.totalMatches': 1,
          'stats.rating': loserDelta
        }
      }
    );
    
    const newWinnerRating = winnerRating + winnerDelta;
    const newLoserRating = loserRating + loserDelta;
    
    console.log(`Match Result - Winner ${winnerUserId}: ${winnerRating} → ${newWinnerRating} (+${winnerDelta}), Loser ${loserId}: ${loserRating} → ${newLoserRating} (${loserDelta})`);
  }
  
  // Invalidate user stats cache in Redis for both players
  await redis.del(RedisKeys.userStats(playerIds[0]));
  await redis.del(RedisKeys.userStats(playerIds[1]));
  
  console.log('Player stats and ratings updated successfully');
}

export async function persistMatchFromState(state: any) {
  await connectDB();
  const client = await getMongoClient();
  const db = client.db(DB_NAME);
  const matches = db.collection('matches');
  const submissions = db.collection('submissions');
  await ensureIndexes(db);

  // Extract player IDs from state
  // Handle both array format and object format (keyed by userId)
  let playerIds: string[] = [];
  if (Array.isArray(state.players)) {
    playerIds = state.players;
  } else if (state.players && typeof state.players === 'object') {
    playerIds = Object.keys(state.players);
  }

  // Process submissions - handle new format from MatchRoom
  const insertedIds: ObjectId[] = [];
  const submissionsData = state.submissions || [];
  
  for (const submission of submissionsData) {
    if (!submission || typeof submission !== 'object') {
      console.warn(`Invalid submission item:`, submission);
      continue;
    }

    // Use Mongo ObjectId for submission _id and store refs as ObjectId
    const submissionMongoId = new ObjectId();
    const doc = {
      _id: submissionMongoId,
      matchId: state.matchId,
      problemId: tryToObjectId(state.problemId) || new ObjectId(state.problemId),
      userId: tryToObjectId(submission.userId) || new ObjectId(submission.userId),
      language: submission.language,
      sourceCode: submission.code || null,
      passed: submission.passed || false,
      testResults: submission.testResults || [],
      averageTime: submission.averageTime || null,
      averageMemory: submission.averageMemory || null,
      complexityFailed: submission.complexityFailed || false,
      derivedComplexity: submission.derivedComplexity || null,
      expectedComplexity: submission.expectedComplexity || null,
      timestamp: submission.timestamp ? new Date(submission.timestamp) : new Date(),
      createdAt: new Date(),
    };
    
    try {
    await submissions.findOneAndUpdate(
        { _id: submissionMongoId },
        { $set: doc },
      { upsert: true, returnDocument: 'after' }
    );
      insertedIds.push(submissionMongoId);
    } catch (error) {
      console.error(`Error upserting submission ${String(submissionMongoId)}:`, error);
    }
  }

  // Safely convert player IDs to ObjectId format
  const playerObjectIds = playerIds
    .filter((id) => Boolean(id))
    .map((id: unknown) => tryToObjectId(id) || (id as any));

  const matchDoc = {
    _id: state.matchId,
    playerIds: playerObjectIds,
    problemId: tryToObjectId(state.problemId) || new ObjectId(state.problemId),
    status: 'finished',
    winnerUserId: state.winnerUserId ? (tryToObjectId(state.winnerUserId) || new ObjectId(state.winnerUserId)) : null,
    isDraw: state.isDraw || false,
    startedAt: state.startedAt ? new Date(state.startedAt) : new Date(),
    endedAt: state.endedAt ? new Date(state.endedAt) : new Date(),
    endReason: state.endReason || null,
    submissionIds: insertedIds,
  } as any;
  
  try {
  await matches.updateOne({ _id: matchDoc._id }, { $set: matchDoc }, { upsert: true });
  } catch (error) {
    console.error(`Error upserting match ${state.matchId}:`, error);
    throw error;
  }
  
  // Update player stats and ratings
  const isDraw = state.isDraw || (!state.winnerUserId && state.endReason === 'timeout');
  
  console.log(`Match ${state.matchId} persistence - Found ${playerIds.length} players:`, playerIds);
  
  if (playerIds.length === 2) {
    // Pass pre-calculated rating changes from MatchRoom (with difficulty adjustments)
    await updatePlayerStatsAndRatings(playerIds, state.winnerUserId, isDraw, db, state.ratingChanges);
  } else {
    console.warn(`Expected 2 players but found ${playerIds.length}. Players:`, playerIds, 'State:', JSON.stringify(state, null, 2));
  }
  
  // Clean up Redis match data and player reservations
  const redis = getRedis();
  await redis.del(RedisKeys.matchKey(state.matchId));
  console.log(`Deleted match data for ${state.matchId}`);
  
  // Critical: Delete player reservations so they can queue again
  for (const playerId of playerIds) {
    const deleted = await redis.del(`queue:reservation:${playerId}`);
    console.log(`Deleted reservation for player ${playerId} - result: ${deleted}`);
  }
  
  console.log(`Successfully cleaned up Redis data for match ${state.matchId}`);
  
}

async function ensureIndexes(db: any) {
  await db.collection('matches').createIndexes([
    { key: { playerIds: 1 } },
    { key: { problemId: 1 } },
    { key: { endedAt: -1 } },
    { key: { status: 1 } },
  ]);
  await db.collection('submissions').createIndexes([
    { key: { matchId: 1 } },
    { key: { userId: 1 } },
    { key: { problemId: 1 } },
    { key: { createdAt: -1 } },
    { key: { timestamp: -1 } },
  ]);
}

// Store/get per-language source code for a user's match (Redis Hash)
export async function setMatchUserCode(matchId: string, userId: string, language: string, code: string) {
  const redis = getRedis();
  const key = RedisKeys.matchUserCodeHash(matchId, userId);
  await redis.hset(key, language, code);
  // Optional: set TTL to auto-clean after a day
  await redis.expire(key, 24 * 60 * 60);
  return { success: true };
}

export async function getMatchUserCode(matchId: string, userId: string, language: string) {
  const redis = getRedis();
  const key = RedisKeys.matchUserCodeHash(matchId, userId);
  const code = await redis.hget(key, language);
  return { success: true, code: code || '' };
}

export async function getAllMatchUserCode(matchId: string, userId: string) {
  const redis = getRedis();
  const key = RedisKeys.matchUserCodeHash(matchId, userId);
  const all = await redis.hgetall(key);
  return { success: true, languages: all };
}

// Single-key match state in Redis (JSON-encoded) keyed by match:{matchId}
// Structure example:
// {
//   matchId, problemId, status: 'ongoing'|'finished',
//   players: [userId1, userId2],
//   startedAt: ISOString, endedAt?: ISOString,
//   winnerUserId?: string,
//   submissions: string[],                    // submission IDs or objects
//   playersCode: { [userId]: { [lang]: code } },
//   linesWritten: { [userId]: number }
// }

export async function initMatchStateInCache(params: {
  matchId: string;
  problemId: string;
  players: string[];
  startedAt?: string;
}) {
  const redis = getRedis();
  const key = RedisKeys.matchKey(params.matchId);
  const doc = {
    matchId: params.matchId,
    problemId: params.problemId,
    status: 'ongoing',
    players: params.players,
    startedAt: params.startedAt || new Date().toISOString(),
    submissions: [],
    playersCode: {},
    linesWritten: {}
  } as any;
  await redis.set(key, JSON.stringify(doc));
  await redis.sadd(RedisKeys.activeMatchesSet, params.matchId);
  return { success: true };
}

export async function getMatchStateFromCache(matchId: string) {
  const redis = getRedis();
  const key = RedisKeys.matchKey(matchId);
  const raw = await redis.get(key);
  if (!raw) return { success: false, error: 'not_found' };
  try {
    return { success: true, match: JSON.parse(raw) };
  } catch {
    return { success: false, error: 'parse_error' };
  }
}

export async function setMatchUserCodeInCache(matchId: string, userId: string, language: string, code: string) {
  const redis = getRedis();
  const key = RedisKeys.matchKey(matchId);
  const raw = await redis.get(key);
  if (!raw) return { success: false, error: 'not_found' };
  const obj = JSON.parse(raw);
  obj.playersCode = obj.playersCode || {};
  obj.playersCode[userId] = obj.playersCode[userId] || {};
  obj.playersCode[userId][language] = code;
  // Update lines written (approx by splitting by newlines)
  const lines = (code?.match(/\n/g)?.length || 0) + (code ? 1 : 0);
  obj.linesWritten = obj.linesWritten || {};
  obj.linesWritten[userId] = lines;
  await redis.set(key, JSON.stringify(obj));
  return { success: true };
}

export async function addMatchSubmissionToCache(matchId: string, submissionId: string) {
  const redis = getRedis();
  const key = RedisKeys.matchKey(matchId);
  const raw = await redis.get(key);
  if (!raw) return { success: false, error: 'not_found' };
  const obj = JSON.parse(raw);
  obj.submissions = obj.submissions || [];
  obj.submissions.push(submissionId);
  await redis.set(key, JSON.stringify(obj));
  return { success: true };
}

export async function finishMatchInCache(matchId: string, winnerUserId?: string) {
  const redis = getRedis();
  const key = RedisKeys.matchKey(matchId);
  const raw = await redis.get(key);
  if (!raw) return { success: false, error: 'not_found' };
  const obj = JSON.parse(raw);
  obj.status = 'finished';
  obj.endedAt = new Date().toISOString();
  if (winnerUserId) obj.winnerUserId = winnerUserId;
  await redis.set(key, JSON.stringify(obj));
  await redis.srem(RedisKeys.activeMatchesSet, matchId);
  return { success: true };
}

// Problem Selection Functions
type Difficulty = 'Easy' | 'Medium' | 'Hard';

/**
 * Determine difficulty based on average player rating
 */
function determineDifficultyFromRating(rating1: number, rating2: number): Difficulty {
  const avgRating = (rating1 + rating2) / 2;
  const rand = Math.random();
  
  if (avgRating < 1000) {
    // Mostly Easy, sometimes Medium
    return rand < 0.8 ? 'Easy' : 'Medium';
  } else if (avgRating < 1500) {
    // Mostly Medium, with Easy and Hard variance
    if (rand < 0.15) return 'Easy';
    if (rand > 0.85) return 'Hard';
    return 'Medium';
  } else {
    // Mostly Hard, sometimes Medium
    return rand < 0.8 ? 'Hard' : 'Medium';
  }
}

/**
 * Select a random problem from MongoDB based on difficulty
 */
export async function selectRandomProblem(difficulty: Difficulty) {
  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    // Use MongoDB aggregation to get a random VERIFIED problem
    const problems = await problemsCollection
      .aggregate([
        { $match: { 
          difficulty, 
          verified: true // Only select verified problems
        } },
        { $sample: { size: 1 } }
      ])
      .toArray();


    if (problems.length === 0) {
      console.warn(`No verified problems found with difficulty: ${difficulty}`);
      return null;
    }

    const problem = problems[0];
    
    // Format for match (include signature for starter code)
    return {
      _id: problem._id.toString(),
      title: problem.title,
      difficulty: problem.difficulty,
      topics: problem.topics || [],
      description: problem.description,
      examples: problem.examples || [],
      constraints: problem.constraints || [],
      signature: problem.signature || null,
      // Include starter code templates if they exist
      starterCode: problem.starterCode || null,
    };
  } catch (error) {
    console.error('Error selecting random problem:', error);
    return null;
  }
}

/**
 * Select problem for match based on player ratings
 */
export async function selectProblemForMatch(rating1: number, rating2: number) {
  const difficulty = determineDifficultyFromRating(rating1, rating2);
  console.log(`Selecting ${difficulty} problem for players with ratings: ${rating1}, ${rating2}`);
  
  const problem = await selectRandomProblem(difficulty);
  
  if (!problem) {
    console.error(`Failed to select problem with difficulty: ${difficulty}`);
    return { success: false, error: 'no_problem_found' };
  }
  
  return { success: true, problem, difficulty };
}

// Admin: Generate problem using OpenAI
export async function generateProblem(data: {
  title: string;
  description: string;
  examples: { input: string; output: string; explanation: string | null }[];
  constraints: string[];
  difficulty: 'Easy' | 'Medium' | 'Hard';
  timeComplexity: string;
}) {
  // Rate limiting for admin operations
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    const { title, description, examples, constraints, difficulty, timeComplexity } = data;

    // Validate input
    if (!title || !description || !examples || !constraints || !difficulty || !timeComplexity) {
      return { 
        success: false, 
        error: 'Missing required fields: title, description, examples, constraints, difficulty, timeComplexity' 
      };
    }

    // Validate difficulty
    if (!['Easy', 'Medium', 'Hard'].includes(difficulty)) {
      return { 
        success: false, 
        error: 'Difficulty must be one of: Easy, Medium, Hard' 
      };
    }

    // Lazy import OpenAI to avoid loading it on every request
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const SYSTEM_PROMPT = `You are an automated problem rewriter and metadata extractor for coding challenges.

Input format (this is what you will receive):
- title: string — original problem title
- description: string — original problem description
- examples: array of objects, each with:
    - input: string
    - output: string
    - explanation: string or null
- constraints: array of strings

Your task:
1. Reword the title, description, examples, and constraints so they are legally and stylistically distinct, while preserving the original logic.
2. Infer a function signature for the solution:
    - functionName: a descriptive name for the main function
    - parameters: list of parameter names and their types
    - returnType: the type of the function's output
3. Support the following data types for parameters and returnType:
    - Primitive types: "int", "string", "boolean", "double", "float", "long"
    - Array types: "int[]", "string[]", "double[]", etc.
    - Complex data structures:
        * "ListNode" - for linked list problems (input/output as arrays like [1,2,3,4])
        * "TreeNode" - for binary tree problems (input/output as level-order arrays like [1,2,3,null,null,4,5])
        * "ListNode[]" - for arrays of linked lists
        * "TreeNode[]" - for arrays of binary trees
4. Output a JSON object with the following fields exactly:
    - title
    - topics (array of strings — optional, can be empty if unsure)
    - description
    - examples
    - constraints
    - signature (object with functionName, parameters, returnType)
5. Do NOT include difficulty or any commentary. Only output the JSON object.

Type Selection Guidelines:
- Use "ListNode" when examples show: head = [1,2,3], l1 = [1,2,4], or similar linked list notation
- Use "TreeNode" when examples show: root = [1,2,3], tree = [1,null,2], or similar tree notation  
- Use "int[]" when examples show: nums = [1,2,3], arr = [4,5,6] for regular arrays
- The context and problem description will help distinguish (e.g., "linked list" vs "array" terminology)

Output examples:

Example 1 - Builtin Types (arrays, primitives):
{
  "title": "Find Indices with Target Sum",
  "topics": ["Arrays", "Hash Map"],
  "description": "Given a list of integers and a target value, find two distinct indices such that their elements add up to the target value. Assume exactly one solution exists.",
  "examples": [
    {
      "input": "nums = [1, 4, 5, 8], target = 9",
      "output": "[1, 2]",
      "explanation": "Because nums[1] + nums[2] == 9."
    }
  ],
  "constraints": [
    "2 <= nums.length <= 10^4",
    "-10^9 <= nums[i], target <= 10^9",
    "There is exactly one valid pair."
  ],
  "signature": {
    "functionName": "findPair",
    "parameters": [
      { "name": "nums", "type": "int[]" },
      { "name": "target", "type": "int" }
    ],
    "returnType": "int[]"
  }
}

Example 2 - ListNode (linked list):
{
  "title": "Reverse Linked List",
  "topics": ["Linked List"],
  "description": "Given the head of a singly linked list, reverse the list and return the reversed list.",
  "examples": [
    {
      "input": "head = [1,2,3,4,5]",
      "output": "[5,4,3,2,1]",
      "explanation": "The linked list is reversed."
    }
  ],
  "constraints": [
    "The number of nodes in the list is in the range [0, 5000]",
    "-5000 <= Node.val <= 5000"
  ],
  "signature": {
    "functionName": "reverseList",
    "parameters": [
      { "name": "head", "type": "ListNode" }
    ],
    "returnType": "ListNode"
  }
}

Example 3 - TreeNode (binary tree):
{
  "title": "Invert Binary Tree",
  "topics": ["Binary Tree", "Depth-First Search"],
  "description": "Given the root of a binary tree, invert the tree and return its root.",
  "examples": [
    {
      "input": "root = [4,2,7,1,3,6,9]",
      "output": "[4,7,2,9,6,3,1]",
      "explanation": "The tree is inverted by swapping left and right children."
    }
  ],
  "constraints": [
    "The number of nodes in the tree is in the range [0, 100]",
    "-100 <= Node.val <= 100"
  ],
  "signature": {
    "functionName": "invertTree",
    "parameters": [
      { "name": "root", "type": "TreeNode" }
    ],
    "returnType": "TreeNode"
  }
}`;

    // Prepare input for OpenAI (without difficulty)
    const llmInput = {
      title,
      description,
      examples,
      constraints,
    };

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(llmInput, null, 2) },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const generatedContent = completion.choices[0].message.content;
    if (!generatedContent) {
      return { success: false, error: 'OpenAI returned empty response' };
    }

    const generatedProblem = JSON.parse(generatedContent);

    // Step 2: Generate solutions and test cases using o3
    const SOLUTIONS_SYSTEM_PROMPT = `You are an automated code generator for competitive programming problems.

Input:
- A reworded coding problem JSON containing:
    - title
    - description
    - examples
    - constraints
    - signature (functionName, parameters, returnType)
- languages: array of strings specifying which languages to generate code for (e.g., ["python","cpp","java","js"])
- numTestCases: integer, number of test cases to generate
- maxN: integer, maximum size of input arrays/lists
- targetTimeComplexity: string, the required time complexity for the solution (e.g., "O(n)", "O(n log n)", "O(n^2)")

Task:
1. Generate a solution class + method for each of the specified languages that achieves the targetTimeComplexity.
2. **CRITICAL**: Each solution MUST be wrapped in a class called "Solution" with the method inside it. For example:
   - Python: class Solution: with method inside
   - C++: class Solution { with method inside };
   - Java: class Solution { with method inside }
   - JavaScript: class Solution { with method inside }
3. The solution MUST meet the specified time complexity requirement. For example:
   - If targetTimeComplexity is "O(n)", use techniques like hash maps, single-pass algorithms
   - If targetTimeComplexity is "O(n log n)", use sorting or binary search
   - If targetTimeComplexity is "O(n^2)", nested loops are acceptable
4. Generate the specified number of test cases with small input sizes (maximum n=maxN), covering typical and edge cases.
5. **CRITICALLY IMPORTANT**: The test cases MUST strictly follow ALL constraints from the problem. For example:
   - If constraints say "Only one valid answer exists" or "There is exactly one valid pair", ensure each test case has EXACTLY ONE correct answer, not multiple
   - If constraints specify value ranges, stay within those ranges
   - If constraints specify array size limits, respect those limits
6. **COMPLEX DATA STRUCTURES**: For ListNode and TreeNode problems, use JSON format for test cases:
   - For ListNode: test case input uses arrays like [1,2,3], NOT string format like 'head = [1,2,3]'
   - For TreeNode: test case input uses level-order arrays with null, like [1,2,3,null,null,4,5]
   - The examples field (for human display) uses strings, but testCases field (for execution) uses JSON objects

Example outputs by data type:

Example 1 - Builtin Types:
{
  "solutions": {
    "python": "class Solution:\\n    def findPair(self, nums, target):\\n        # Implementation here\\n        pass",
    "cpp": "class Solution {\\npublic:\\n    vector<int> findPair(vector<int>& nums, int target) {\\n        // Implementation here\\n    }\\n};",
    "java": "class Solution {\\n    public int[] findPair(int[] nums, int target) {\\n        // Implementation here\\n    }\\n}",
    "js": "class Solution {\\n    findPair(nums, target) {\\n        // Implementation here\\n    }\\n}"
  },
  "testCases": [
    {"input": {"nums": [2,7,11,15], "target": 9}, "output": [0,1]},
    {"input": {"nums": [3,2,4], "target": 6}, "output": [1,2]},
    {"input": {"nums": [3,3], "target": 6}, "output": [0,1]}
  ]
}

Example 2 - ListNode:
{
  "solutions": {
    "python": "class Solution:\\n    def reverseList(self, head):\\n        # Implementation here\\n        pass",
    "cpp": "class Solution {\\npublic:\\n    ListNode* reverseList(ListNode* head) {\\n        // Implementation here\\n    }\\n};",
    "java": "class Solution {\\n    public ListNode reverseList(ListNode head) {\\n        // Implementation here\\n    }\\n}",
    "js": "class Solution {\\n    reverseList(head) {\\n        // Implementation here\\n    }\\n}"
  },
  "testCases": [
    {"input": {"head": [1,2,3,4,5]}, "output": [5,4,3,2,1]},
    {"input": {"head": [1,2]}, "output": [2,1]},
    {"input": {"head": []}, "output": []}
  ]
}

Example 3 - TreeNode:
{
  "solutions": {
    "python": "class Solution:\\n    def invertTree(self, root):\\n        # Implementation here\\n        pass",
    "cpp": "class Solution {\\npublic:\\n    TreeNode* invertTree(TreeNode* root) {\\n        // Implementation here\\n    }\\n};",
    "java": "class Solution {\\n    public TreeNode invertTree(TreeNode root) {\\n        // Implementation here\\n    }\\n}",
    "js": "class Solution {\\n    invertTree(root) {\\n        // Implementation here\\n    }\\n}"
  },
  "testCases": [
    {"input": {"root": [4,2,7,1,3,6,9]}, "output": [4,7,2,9,6,3,1]},
    {"input": {"root": [2,1,3]}, "output": [2,3,1]},
    {"input": {"root": []}, "output": []}
  ]
}
8. Do not include commentary, explanations, or extra fields.
9. Ensure the code is ready to be wrapped with a language-specific runner template for compilation.
10. The solutions MUST be correct and achieve the specified time complexity.
11. Each test case must have exactly ONE correct answer when the constraints specify uniqueness.
12. **IMPORTANT**: Only output the Solution class with the method inside - no imports, no main function, no extra code.`;

    // Determine maxN from constraints (default to 50)
    const maxN = 50;
    const numTestCases = 15;
    const languages = ['python', 'cpp', 'java', 'js'];

    const solutionsInput = {
      problem: {
        title: generatedProblem.title,
        description: generatedProblem.description,
        examples: generatedProblem.examples,
        constraints: generatedProblem.constraints,
        signature: generatedProblem.signature,
      },
      languages,
      numTestCases,
      maxN,
      targetTimeComplexity: timeComplexity,
    };

    const solutionsCompletion = await openai.chat.completions.create({
      model: 'o3',
      messages: [
        { role: 'system', content: SOLUTIONS_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(solutionsInput, null, 2) },
      ],
      response_format: { type: 'json_object' },
    });

    const solutionsContent = solutionsCompletion.choices[0].message.content;
    if (!solutionsContent) {
      return { success: false, error: 'OpenAI o3 returned empty response' };
    }

    const solutionsData = JSON.parse(solutionsContent);

    // Skip verification for now - store problem immediately
    console.log('Storing problem without verification (can verify later)...');

    // Combine both LLM responses with difficulty and timeComplexity
    const problemDoc = {
      ...generatedProblem,
      difficulty,
      timeComplexity,
      solutions: solutionsData.solutions,
      testCases: solutionsData.testCases,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Connect to MongoDB and insert
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    const result = await problemsCollection.insertOne(problemDoc);

    console.log(`Problem stored successfully with ID: ${result.insertedId}`);

    return {
      success: true,
      problemId: result.insertedId.toString(),
      problem: {
        ...problemDoc,
        _id: result.insertedId.toString(),
        createdAt: problemDoc.createdAt.toISOString(),
        updatedAt: problemDoc.updatedAt.toISOString()
      },
      verified: false,
      verificationSummary: 'Problem stored - verification pending'
    };
  } catch (error: any) {
    console.error('Error generating problem:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to generate problem' 
    };
  }
}

/**
 * Verify an existing problem's solutions against test cases
 */
export async function verifyProblemSolutions(problemId: string) {
  // Rate limiting for admin operations
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(adminLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  try {
    console.log(`Verifying problem ${problemId}...`);
    
    // Get the problem from MongoDB
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    const problem = await problemsCollection.findOne({ 
      _id: new ObjectId(problemId) 
    });

    if (!problem) {
      return { success: false, error: 'Problem not found' };
    }

    if (!problem.signature || !problem.solutions || !problem.testCases) {
      return { success: false, error: 'Problem missing signature, solutions, or test cases' };
    }

    // Call Colyseus validation endpoint
    const COLYSEUS_URL = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || 'http://localhost:2567';
    
    const validationResponse = await fetch(`${COLYSEUS_URL}/admin/validate-solutions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature: problem.signature,
        solutions: problem.solutions,
        testCases: problem.testCases
      })
    });

    if (!validationResponse.ok) {
      return {
        success: false,
        error: `Validation endpoint error: ${validationResponse.status} ${validationResponse.statusText}`
      };
    }

    const validationResult = await validationResponse.json();
    console.log('Validation result received:', JSON.stringify(validationResult, null, 2));

    // Update problem with verification status (whether success or failure)
    await connectDB();
    const updateClient = await getMongoClient();
    
    const updateDb = updateClient.db(DB_NAME);
    const updateProblemsCollection = updateDb.collection('problems');

    // Extract test case details for each language (both passed and failed)
    const allTestCases: Record<string, Array<{
      testNumber: number;
      input: any;
      expected: any;
      actual: any;
      error?: string;
      passed: boolean;
    }>> = {};

    const failedTestCases: Record<string, Array<{
      testNumber: number;
      input: any;
      expected: any;
      actual: any;
      error?: string;
    }>> = {};

    for (const [lang, result] of Object.entries(validationResult.results)) {
      const langResult = result as any;
      console.log(`Processing ${lang} results:`, JSON.stringify(langResult, null, 2));
      if (langResult.results) {
        const allTests = langResult.results
          .map((r: any) => ({
            testNumber: r.testNumber || 0,
            input: r.testCase?.input,
            expected: r.testCase?.output,
            actual: r.actualOutput,
            error: r.error,
            passed: r.passed,
          }));
        
        const failed = allTests.filter((r: any) => !r.passed);
        
        allTestCases[lang] = allTests;
        console.log(`All tests for ${lang}:`, allTests);
        console.log(`Failed tests for ${lang}:`, failed);
        
        if (failed.length > 0) {
          failedTestCases[lang] = failed;
        }
      }
    }
    
    console.log('Final allTestCases:', JSON.stringify(allTestCases, null, 2));
    console.log('Final failedTestCases:', JSON.stringify(failedTestCases, null, 2));

    if (!validationResult.success) {
      // Store failure details so user can see what went wrong
      await updateProblemsCollection.updateOne(
        { _id: new ObjectId(problemId) },
        { 
          $set: { 
            verified: false,
            verifiedAt: new Date(),
            verificationResults: validationResult.results,
            verificationError: validationResult.details || [],
            allTestCases, // Store ALL test case details
            failedTestCases, // Store specific failed test details
          }
        }
      );

      return {
        success: false,
        error: 'Solution verification failed: ' + (validationResult.details || []).join('; '),
        details: validationResult.details,
        results: validationResult.results,
        allTestCases,
        failedTestCases,
      };
    }

    // Success case - still store all test case details
    await updateProblemsCollection.updateOne(
      { _id: new ObjectId(problemId) },
      { 
        $set: { 
          verified: true,
          verifiedAt: new Date(),
          verificationResults: validationResult.results,
          verificationError: null,
          allTestCases, // Store ALL test case details even on success
          failedTestCases: null, // Clear failed test cases on success
        }
      }
    );

    return {
      success: true,
      message: 'All solutions verified successfully',
      results: validationResult.results
    };

  } catch (error: any) {
    console.error('Error verifying problem:', error);
    return {
      success: false,
      error: error.message || 'Failed to verify problem'
    };
  }
}

/**
 * Fetch all unverified problems from the database
 */
export async function getUnverifiedProblems() {
  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');
    
    // Find all problems that are either not verified or explicitly marked as unverified
    const unverifiedProblems = await problemsCollection
      .find({ 
        $or: [
          { verified: { $exists: false } },
          { verified: false }
        ]
      })
      .sort({ createdAt: -1 }) // Most recent first
      .toArray();


    // Serialize ObjectIds and Dates for client components
    return unverifiedProblems.map(problem => ({
      ...problem,
      _id: problem._id.toString(),
      createdAt: problem.createdAt.toISOString(),
      updatedAt: problem.updatedAt.toISOString(),
      verifiedAt: problem.verifiedAt?.toISOString() || null,
      verificationError: problem.verificationError || [],
      verificationResults: problem.verificationResults || null,
      allTestCases: problem.allTestCases || null,
      failedTestCases: problem.failedTestCases || null,
    }));
  } catch (error: any) {
    console.error('Error fetching unverified problems:', error);
    return [];
  }
}

/**
 * Get a single problem by ID for editing
 */
export async function getProblemById(problemId: string) {
  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');
    
    const problem = await problemsCollection.findOne({ 
      _id: new ObjectId(problemId) 
    });


    if (!problem) {
      return null;
    }

    // Serialize ObjectIds and Dates for client components
    return {
      ...problem,
      _id: problem._id.toString(),
      createdAt: problem.createdAt.toISOString(),
      updatedAt: problem.updatedAt.toISOString(),
      verifiedAt: problem.verifiedAt?.toISOString() || null,
      verificationError: problem.verificationError || [],
      verificationResults: problem.verificationResults || null,
      failedTestCases: problem.failedTestCases || null,
    };
  } catch (error: any) {
    console.error('Error fetching problem:', error);
    return null;
  }
}

/**
 * Update a problem's test cases and/or solutions
 */
export async function updateProblem(problemId: string, updates: {
  testCases?: Array<{ input: Record<string, unknown>; output: unknown }>;
  solutions?: { python?: string; cpp?: string; java?: string; js?: string };
}) {
  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (updates.testCases) {
      updateData.testCases = updates.testCases;
    }

    if (updates.solutions) {
      updateData.solutions = updates.solutions;
    }

    await problemsCollection.updateOne(
      { _id: new ObjectId(problemId) },
      { $set: updateData }
    );


    return { success: true };
  } catch (error: any) {
    console.error('Error updating problem:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Reset all player data - Delete all matches and submissions, reset user stats, clear Redis data
 * Note: This does NOT delete user accounts or login information
 */
export async function resetAllPlayerData() {
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
    const sessionsCollection = db.collection('sessions');
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
    } catch (redisError: any) {
      console.error('Error clearing Redis data:', redisError);
      // Continue even if Redis clearing fails - at least DB is cleared
    }

    return { 
      success: true, 
      message: `Reset complete: ${matchesResult.deletedCount} matches, ${submissionsResult.deletedCount} submissions deleted. ${usersResult.modifiedCount} users reset. ${redisKeysDeleted} Redis keys cleared.`
    };
  } catch (error: any) {
    console.error('Error resetting player data:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper function to scan Redis for keys matching a pattern
 */
async function scanRedisKeys(redis: any, pattern: string): Promise<string[]> {
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
 * Get paginated users with search functionality
 */
export async function getUsers(
  page: number = 1, 
  limit: number = 10, 
  searchTerm?: string, 
  searchType?: 'username' | 'id'
) {
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
    const query: Record<string, any> = {};
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

    // Get users with pagination
    const usersList = await users
      .find(query)
      .sort({ createdAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)
      .toArray();

    // Serialize ObjectIds and Dates for client components
    const serializedUsers = usersList.map(user => ({
      ...user,
      _id: user._id.toString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLogin: user.lastLogin.toISOString(),
    }));

    return { 
      success: true, 
      users: serializedUsers 
    };
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to fetch users' 
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
    const query: Record<string, any> = {};
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

    const count = await users.countDocuments(query);
    return { 
      success: true, 
      count 
    };
  } catch (error: any) {
    console.error('Error counting users:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to count users' 
    };
  }
}

/**
 * Update user fields (excluding password)
 */
export async function updateUser(userId: string, updates: Partial<User>) {
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
    const updateData: Record<string, any> = {
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
  } catch (error: any) {
    console.error('Error updating user:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to update user' 
    };
  }
}

/**
 * Get a single user by ID for editing
 */
export async function getUserById(userId: string) {
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

    // Serialize ObjectIds and Dates for client components
    const serializedUser = {
      ...user,
      _id: user._id.toString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLogin: user.lastLogin.toISOString(),
    };

    return { 
      success: true, 
      user: serializedUser 
    };
  } catch (error: any) {
    console.error('Error fetching user:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to fetch user' 
    };
  }
}

// Match History Server Actions
export async function getMatchHistory(userId: string, page: number = 1, limit: number = 10) {
  try {
    const redis = getRedis();
    const cacheKey = `user:${userId}:matchHistory:${page}`;
    
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {}
    }

    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    
    const userObjectId = new ObjectId(userId);
    const skip = (page - 1) * limit;
    
    // Get finished matches for the user
    const matches = await db.collection('matches').aggregate([
      {
        $match: {
          playerIds: userObjectId,
          status: 'finished',
          endedAt: { $exists: true }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'playerIds',
          foreignField: '_id',
          as: 'players'
        }
      },
      {
        $lookup: {
          from: 'problems',
          localField: 'problemId',
          foreignField: '_id',
          as: 'problems'
        }
      },
      {
        $addFields: {
          problem: { $arrayElemAt: ['$problems', 0] },
          opponent: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$players',
                  cond: { $ne: ['$$this._id', userObjectId] }
                }
              },
              0
            ]
          },
          currentUser: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$players',
                  cond: { $eq: ['$$this._id', userObjectId] }
                }
              },
              0
            ]
          }
        }
      },
      {
        $addFields: {
          result: {
            $cond: [
              { $eq: ['$winnerUserId', null] },
              'draw',
              {
                $cond: [
                  { $eq: ['$winnerUserId', userObjectId] },
                  'win',
                  'loss'
                ]
              }
            ]
          },
          duration: {
            $subtract: [
              { $toDate: '$endedAt' },
              { $toDate: '$startedAt' }
            ]
          }
        }
      },
      {
        $sort: { endedAt: -1 }
      },
      {
        $skip: skip
      },
      {
        $limit: limit
      }
    ]).toArray();

    // Try to get rating changes from Redis for each match
    const formattedMatches = await Promise.all(matches.map(async (match) => {
      
      // Try to get rating changes from Redis match data
      let ratingChange = 0;
      try {
        const matchKey = RedisKeys.matchKey(match._id.toString());
        const matchData = await redis.get(matchKey);
        if (matchData) {
          const parsed = JSON.parse(matchData);
          if (parsed.ratingChanges && parsed.ratingChanges[userId]) {
            ratingChange = parsed.ratingChanges[userId].change || 0;
          }
        }
      } catch (error) {
        console.warn('Could not fetch rating changes from Redis for match:', match._id.toString());
      }
      
      // Fetch opponent avatar using centralized function
      let opponentAvatar = null;
      const avatarResult = await getAvatarByIdAction(match.opponent._id.toString());
      if (avatarResult.success) {
        opponentAvatar = avatarResult.avatar;
      }
      
      return {
        matchId: match._id.toString(),
        opponent: {
          userId: match.opponent._id.toString(),
          username: match.opponent.username,
          avatar: opponentAvatar,
          rating: match.opponent.stats?.rating || 1200
        },
        problem: {
          title: match.problem?.title || 'Unknown Problem',
          difficulty: match.problem?.difficulty || 'Medium',
          topics: match.problem?.topics || []
        },
        result: match.result,
        ratingChange: ratingChange,
        duration: match.duration,
        endedAt: match.endedAt,
        startedAt: match.startedAt
      };
    }));

    const result = {
      matches: formattedMatches,
      page,
      limit,
      hasMore: formattedMatches.length === limit
    };

    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(result));
    
    return result;
  } catch (error) {
    console.error('Error fetching match history:', error);
    return {
      matches: [],
      page,
      limit,
      hasMore: false,
      error: 'Failed to fetch match history'
    };
  }
}

export async function getMatchDetails(matchId: string, userId: string) {
  try {
    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    
    const userObjectId = new ObjectId(userId);
    const matchObjectId = new ObjectId(matchId);
    
    // Get match details with populated data
    const match = await db.collection('matches').aggregate([
      {
        $match: { _id: matchObjectId }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'playerIds',
          foreignField: '_id',
          as: 'players'
        }
      },
      {
        $lookup: {
          from: 'problems',
          localField: 'problemId',
          foreignField: '_id',
          as: 'problems'
        }
      },
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionIds',
          foreignField: '_id',
          as: 'submissions'
        }
      },
      {
        $addFields: {
          problem: { $arrayElemAt: ['$problems', 0] },
          currentUser: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$players',
                  cond: { $eq: ['$$this._id', userObjectId] }
                }
              },
              0
            ]
          },
          opponent: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$players',
                  cond: { $ne: ['$$this._id', userObjectId] }
                }
              },
              0
            ]
          }
        }
      }
    ]).toArray();

    if (!match[0]) {
      return { success: false, error: 'Match not found' };
    }

    const matchData = match[0];
    
    // Get submission stats for both players
    const userSubmissions = matchData.submissions.filter((s: any) => 
      s.userId.toString() === userId
    );
    const opponentSubmissions = matchData.submissions.filter((s: any) => 
      s.userId.toString() !== userId
    );

    const getUserStats = (submissions: any[]) => {
      const bestSubmission = submissions.reduce((best, sub) => {
        const passed = sub.testResults?.filter((t: any) => t.status === 3).length || 0;
        const bestPassed = best?.testResults?.filter((t: any) => t.status === 3).length || 0;
        return passed > bestPassed ? sub : best;
      }, null);

      const testsPassed = bestSubmission?.testResults?.filter((t: any) => t.status === 3).length || 0;
      const totalTests = bestSubmission?.testResults?.length || 0;

      return {
        submissionsCount: submissions.length,
        testsPassed,
        totalTests,
        bestSubmission: bestSubmission ? {
          code: bestSubmission.sourceCode || '',
          language: bestSubmission.language || 'unknown',
          runtime: bestSubmission.time || undefined,
          memory: bestSubmission.memory || undefined,
          timeComplexity: 'O(n)', // Placeholder
          spaceComplexity: 'O(1)' // Placeholder
        } : undefined
      };
    };

    const userStats = getUserStats(userSubmissions);
    const opponentStats = getUserStats(opponentSubmissions);

    // Fetch avatars using centralized function
    let currentUserAvatar = null;
    let opponentAvatar = null;
    
    const currentUserAvatarResult = await getAvatarByIdAction(userId);
    if (currentUserAvatarResult.success) {
      currentUserAvatar = currentUserAvatarResult.avatar;
    }
    
    const opponentAvatarResult = await getAvatarByIdAction(matchData.opponent._id.toString());
    if (opponentAvatarResult.success) {
      opponentAvatar = opponentAvatarResult.avatar;
    }

    // Try to get rating changes from Redis match data
    let ratingChanges = {};
    try {
      const redis = getRedis();
      const matchKey = RedisKeys.matchKey(matchId);
      const redisMatchData = await redis.get(matchKey);
      if (redisMatchData) {
        const parsed = JSON.parse(redisMatchData);
        ratingChanges = parsed.ratingChanges || {};
      }
    } catch (error) {
      console.warn('Could not fetch rating changes from Redis for match:', matchId);
    }

    const result = {
      success: true,
      matchId,
      problem: {
        title: matchData.problem?.title || 'Unknown Problem',
        difficulty: matchData.problem?.difficulty || 'Medium',
        topics: matchData.problem?.topics || [],
        description: matchData.problem?.description || ''
      },
      result: matchData.winnerUserId === null ? 'draw' : 
             matchData.winnerUserId.toString() === userId ? 'win' : 'loss',
      duration: new Date(matchData.endedAt).getTime() - new Date(matchData.startedAt).getTime(),
      startedAt: matchData.startedAt,
      endedAt: matchData.endedAt,
      players: {
        currentUser: {
          userId: matchData.currentUser._id.toString(),
          username: matchData.currentUser.username,
          avatar: currentUserAvatar,
          ratingBefore: (ratingChanges[userId]?.oldRating || matchData.currentUser.stats?.rating || 1200),
          ratingAfter: (ratingChanges[userId]?.newRating || matchData.currentUser.stats?.rating || 1200),
          ratingChange: ratingChanges[userId]?.change || 0,
          ...userStats
        },
        opponent: {
          userId: matchData.opponent._id.toString(),
          username: matchData.opponent.username,
          avatar: opponentAvatar,
          ratingBefore: (ratingChanges[matchData.opponent._id.toString()]?.oldRating || matchData.opponent.stats?.rating || 1200),
          ratingAfter: (ratingChanges[matchData.opponent._id.toString()]?.newRating || matchData.opponent.stats?.rating || 1200),
          ratingChange: ratingChanges[matchData.opponent._id.toString()]?.change || 0,
          ...opponentStats
        }
      }
    };

    return result;
  } catch (error) {
    console.error('Error fetching match details:', error);
    return { success: false, error: 'Failed to fetch match details' };
  }
}

// AI Bot Generation Functions

export async function generateBotProfile(count: number, gender?: 'male' | 'female' | 'random') {
  try {
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ count, gender }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error generating bot profile:', error);
    return { success: false, error: 'Failed to generate bot profile' };
  }
}

export async function generateBotAvatar(fullName: string, gender: 'male' | 'female' | 'nonbinary') {
  try {
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/avatar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fullName, gender }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error generating bot avatar:', error);
    return { success: false, error: 'Failed to generate bot avatar' };
  }
}

export async function getBots() {
  try {
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error fetching bots:', error);
    return { success: false, error: 'Failed to fetch bots' };
  }
}

export async function deployBots(botIds: string[], deploy: boolean) {
  try {
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ botIds, deploy }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error deploying bots:', error);
    return { success: false, error: 'Failed to deploy bots' };
  }
}

export async function updateBot(botId: string, updates: any) {
  try {
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/${botId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error updating bot:', error);
    return { success: false, error: 'Failed to update bot' };
  }
}

export async function deleteBot(botId: string) {
  try {
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/${botId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error deleting bot:', error);
    return { success: false, error: 'Failed to delete bot' };
  }
}

export async function resetBotData(resetType: 'stats' | 'all' = 'stats') {
  try {
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resetType }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error resetting bot data:', error);
    return { success: false, error: 'Failed to reset bot data' };
  }
}

export async function deleteAllBots() {
  try {
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resetType: 'all' }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error deleting all bots:', error);
    return { success: false, error: 'Failed to delete all bots' };
  }
}

export async function resetBotStats() {
  try {
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resetType: 'stats' }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error resetting bot stats:', error);
    return { success: false, error: 'Failed to reset bot stats' };
  }
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
  } catch (error: any) {
    console.error('Error fetching avatar by ID:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to fetch avatar' 
    };
  }
}
