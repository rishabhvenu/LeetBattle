'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import connectDB, { getMongoClient } from './mongodb';
import bcrypt from 'bcryptjs';
import { generatePresignedUrl } from './minio';
import { getRedis, RedisKeys } from './redis';
import { ensureMatchEventsSubscriber } from './matchEventsSubscriber';
import { ObjectId } from 'mongodb';
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
  preferences: {
    language: string;
    theme: string;
    notifications: boolean;
  };
  isActive: boolean;
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

export async function registerUser(formData: FormData) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(authLimiter, identifier);
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }

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
      preferences: {
        language: 'javascript',
        theme: 'dark',
        notifications: true,
      },
      isActive: true,
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

export async function loginUser(formData: FormData) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(authLimiter, identifier);
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

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
      _id: sessionCookie.value,
      expires: { $gt: new Date() }
    });
    
    
    if (session && session.userId) {
      return {
        authenticated: true,
        userId: session.userId,
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
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      
      const db = client.db(DB_NAME);
      const sessions = db.collection(SESSIONS_COLLECTION);
      
      // Remove session from MongoDB
      await sessions.deleteOne({ _id: sessionId });
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
    
    // Create session data
    const sessionData = {
      _id: sessionId,
      userId,
      user: {
        id: userId,
        email,
        username,
        avatar: user?.profile?.avatar || null,
        firstName: user?.profile?.firstName || '',
        lastName: user?.profile?.lastName || ''
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      createdAt: new Date()
    };
    
    // Store session in MongoDB
    await sessions.insertOne(sessionData);
    
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
      { _id: sessionId },
      { $set: { 'user.avatar': fileName } }
    );

    // Update user profile avatar
    const sessionDoc = await sessions.findOne({ _id: sessionId });
    if (sessionDoc?.userId) {
      await users.updateOne(
        { _id: new (await import('mongodb')).ObjectId(sessionDoc.userId) },
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

  ensureMatchEventsSubscriber();
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

  ensureMatchEventsSubscriber();
  const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
  const res = await fetch(`${base}/queue/dequeue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
  if (!res.ok) return { success: false };
  return { success: true };
}

export async function consumeReservation(userId: string) {
  ensureMatchEventsSubscriber();
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
    
    // Get opponent user info for name
    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const users = db.collection('users');
    const opponentUser: any = await users.findOne({ _id: new ObjectId(opponentUserId) });
    
    // Generate starter code if not present
    const starterCode = problem.starterCode || generateStarterCode(problem.signature);
    
    return {
      success: true,
      problem: {
        ...problem,
        starterCode,
      },
      opponent: {
        userId: opponentUserId,
        username: opponentUser?.username || 'Opponent',
        name: `${opponentUser?.profile?.firstName || ''} ${opponentUser?.profile?.lastName || ''}`.trim() || opponentUser?.username || 'Opponent',
        avatar: opponentUser?.profile?.avatar || null,
        globalRank: opponentStats.globalRank || 1234,
        gamesWon: opponentStats.wins || 0,
        winRate: opponentStats.totalMatches > 0 ? Math.round((opponentStats.wins / opponentStats.totalMatches) * 100) : 0,
        rating: opponentStats.rating || 1200,
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
  ensureMatchEventsSubscriber();
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
async function updatePlayerStatsAndRatings(playerIds: string[], winnerUserId: string | null, isDraw: boolean, db: any) {
  const users = db.collection('users');
  const { ObjectId } = await import('mongodb');
  const redis = getRedis();
  
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

  // Process submissions - handle different formats
  // Colyseus may store full submission objects or just tokens
  const insertedIds: ObjectId[] = [];
  const submissionsData = state.submissions || [];
  
  for (const item of submissionsData) {
    let token: string;
    let submissionData: any;
    
    // If item is a string, it's a token and we need to look up results
    if (typeof item === 'string') {
      token = item;
      submissionData = state.submissionResults?.[token];
      if (!submissionData) {
        console.warn(`No submission results found for token: ${token}`);
        continue;
      }
    } 
    // If item is an object, it might be the full submission data
    else if (typeof item === 'object' && item !== null) {
      token = item.token || item.id;
      submissionData = item;
    } else {
      console.warn(`Invalid submission item:`, item);
      continue;
    }

    const doc = {
      token,
      matchId: state.matchId,
      problemId: state.problemId,
      userId: submissionData?.meta?.userId || submissionData?.userId || null,
      language: submissionData?.language?.name || submissionData?.language || submissionData?.language_id || null,
      status: submissionData?.status || null,
      stdout: submissionData?.stdout || null,
      stderr: submissionData?.stderr || null,
      compileOutput: submissionData?.compile_output || submissionData?.compileOutput || null,
      time: submissionData?.time || null,
      memory: submissionData?.memory || null,
      createdAt: new Date(),
    };
    
    try {
    const result = await submissions.findOneAndUpdate(
      { token },
      { $setOnInsert: doc, $set: { status: doc.status, stdout: doc.stdout, stderr: doc.stderr, compileOutput: doc.compileOutput, time: doc.time, memory: doc.memory } },
      { upsert: true, returnDocument: 'after' }
    );
    if (result.value?._id) insertedIds.push(result.value._id as ObjectId);
    } catch (error) {
      console.error(`Error upserting submission ${token}:`, error);
    }
  }

  // Safely convert player IDs to ObjectId format
  const playerObjectIds = playerIds
    .filter(id => id && typeof id === 'string')
    .map((id) => {
      try {
        // Only convert if it's a valid ObjectId string
        if (/^[0-9a-fA-F]{24}$/.test(id)) {
          return new ObjectId(id);
        }
        return id;
      } catch {
        return id;
      }
    });

  const matchDoc = {
    _id: state.matchId,
    playerIds: playerObjectIds,
    problemId: state.problemId,
    status: 'finished',
    winnerUserId: state.winnerUserId || null,
    endedAt: state.endedAt ? new Date(state.endedAt) : new Date(),
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
    await updatePlayerStatsAndRatings(playerIds, state.winnerUserId, isDraw, db);
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
    { key: { token: 1 }, unique: true },
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
3. Output a JSON object with the following fields exactly:
    - title
    - topics (array of strings — optional, can be empty if unsure)
    - description
    - examples
    - constraints
    - signature (object with functionName, parameters, returnType)
4. Do NOT include difficulty or any commentary. Only output the JSON object.

Output example (given the input above):

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
2. The solution MUST meet the specified time complexity requirement. For example:
   - If targetTimeComplexity is "O(n)", use techniques like hash maps, single-pass algorithms
   - If targetTimeComplexity is "O(n log n)", use sorting or binary search
   - If targetTimeComplexity is "O(n^2)", nested loops are acceptable
3. Generate the specified number of test cases with small input sizes (maximum n=maxN), covering typical and edge cases.
4. **CRITICALLY IMPORTANT**: The test cases MUST strictly follow ALL constraints from the problem. For example:
   - If constraints say "Only one valid answer exists" or "There is exactly one valid pair", ensure each test case has EXACTLY ONE correct answer, not multiple
   - If constraints specify value ranges, stay within those ranges
   - If constraints specify array size limits, respect those limits
5. Output JSON exactly in the following format:
{
  "solutions": {
    "<language>": "...class+method code..."
  },
  "testCases": [
    {"input": {...}, "output": ...},
    ...
  ]
}
6. Do not include commentary, explanations, or extra fields.
7. Ensure the code is ready to be wrapped with a language-specific runner template for compilation.
8. The solutions MUST be correct and achieve the specified time complexity.
9. Each test case must have exactly ONE correct answer when the constraints specify uniqueness.`;

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

    // Update problem with verification status (whether success or failure)
    await connectDB();
    const updateClient = await getMongoClient();
    
    const updateDb = updateClient.db(DB_NAME);
    const updateProblemsCollection = updateDb.collection('problems');

    if (!validationResult.success) {
      // Extract failed test case details for each language
      const failedTestCases: Record<string, Array<{
        testNumber: number;
        input: any;
        expected: any;
        actual: any;
        error?: string;
      }>> = {};

      for (const [lang, result] of Object.entries(validationResult.results)) {
        const langResult = result as any;
        if (langResult.results) {
          const failed = langResult.results
            .map((r: any, index: number) => ({
              testNumber: index + 1,
              input: r.testCase?.input,
              expected: r.testCase?.output,
              actual: r.actualOutput,
              error: r.error,
              passed: r.passed,
            }))
            .filter((r: any) => !r.passed);
          
          if (failed.length > 0) {
            failedTestCases[lang] = failed;
          }
        }
      }

      // Store failure details so user can see what went wrong
      await updateProblemsCollection.updateOne(
        { _id: new ObjectId(problemId) },
        { 
          $set: { 
            verified: false,
            verifiedAt: new Date(),
            verificationResults: validationResult.results,
            verificationError: validationResult.details || [],
            failedTestCases, // NEW: Store specific failed test details
          }
        }
      );

      return {
        success: false,
        error: 'Solution verification failed: ' + (validationResult.details || []).join('; '),
        details: validationResult.details,
        results: validationResult.results,
        failedTestCases,
      };
    }

    // Success case
    await updateProblemsCollection.updateOne(
      { _id: new ObjectId(problemId) },
      { 
        $set: { 
          verified: true,
          verifiedAt: new Date(),
          verificationResults: validationResult.results,
          verificationError: null,
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
