'use server';

import connectDB, { getMongoClient } from '../mongodb';
import { ObjectId } from 'mongodb';
import { getRedis, RedisKeys } from '../redis';
import { tryToObjectId } from '../utilsObjectId';
import { getUserStatsCached, getAvatarByIdAction } from './user';
import { generateStarterCode } from './match/helpers';
import { ensureAdminAccess, getSessionCookieHeader } from './shared';
import { REST_ENDPOINTS } from '../../constants/RestEndpoints';
import { DB_NAME } from './constants';

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
async function updatePlayerStatsAndRatings(playerIds: string[], winnerUserId: string | null, isDraw: boolean, db: ReturnType<typeof import('mongodb').MongoClient.prototype.db>, ratingChanges?: Record<string, { oldRating: number; newRating: number; change: number }> | unknown) {
  const users = db.collection('users');
  const redis = getRedis();
  
  // Use pre-calculated rating changes if available (from MatchRoom with difficulty adjustments)
  if (ratingChanges && playerIds.length === 2) {
    console.log('Using pre-calculated rating changes from MatchRoom:', ratingChanges);
    
    // Apply the pre-calculated rating changes directly
    for (const playerId of playerIds) {
      const playerObjectId = new ObjectId(playerId);
      const ratingChange = (ratingChanges as Record<string, { oldRating: number; newRating: number; change: number }>)[playerId];
      
      if (!ratingChange) {
        console.warn(`No rating change found for player ${playerId}`);
        continue;
      }
      
      // Determine if this player won, lost, or drew
      const statUpdate: Record<string, number> = { 'stats.totalMatches': 1 };
      
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

async function ensureIndexes(db: ReturnType<typeof import('mongodb').MongoClient.prototype.db>) {
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

// Active matches helpers
export async function getOngoingMatchesCount(): Promise<number> {
  try {
    const redis = getRedis();
    // Use Redis set of active match IDs; fallback to Mongo if missing
    let count: number | null = null;
    try {
      count = await Promise.race([
        redis.scard(RedisKeys.activeMatchesSet),
        new Promise<number>((_, reject) => 
          setTimeout(() => reject(new Error('Redis timeout')), 2000)
        )
      ]).catch(() => null);
    } catch (error: any) {
      // Catch "Connection is closed", "Stream isn't writeable", etc.
      if (error?.message?.includes('Connection is closed') || 
          error?.message?.includes('Stream isn\'t writeable') ||
          error?.message?.includes('ETIMEDOUT')) {
        console.warn('Redis connection error in getOngoingMatchesCount:', error.message);
        count = null;
      } else {
        throw error; // Re-throw unexpected errors
      }
    }
    
    if (count !== null && count > 0) return count;
  } catch (error) {
    // Redis unavailable - fall through to MongoDB
    console.warn('Redis unavailable for getOngoingMatchesCount, using MongoDB fallback:', error);
  }

  // Fallback to MongoDB
  await connectDB();
  const client = await getMongoClient();
  const db = client.db(DB_NAME);
  const matches = db.collection('matches');
  // Consider a match ongoing if it has no endedAt
  const mongoCount = await matches.countDocuments({ endedAt: { $exists: false } });
  return mongoCount;
}

export async function forceBotWin(matchId: string, botUserId: string) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = REST_ENDPOINTS.API_BASE || process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || '';
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
    };
    
    // Use internal secret for server-to-server calls (Lambda -> Colyseus)
    if (internalSecret) {
      headers['X-Internal-Secret'] = internalSecret;
      headers['X-Service-Name'] = 'frontend-lambda';
    }
    
    const response = await fetch(`${apiBase}/admin/matches/${matchId}/force-bot-win`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ botUserId }),
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error forcing bot win:', error);
    return { success: false, error: 'Failed to force bot win' };
  }
}

export async function getActiveMatches() {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError, matches: [] };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = REST_ENDPOINTS.API_BASE || process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || '';
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
    };
    
    // Use internal secret for server-to-server calls (Lambda -> Colyseus)
    if (internalSecret) {
      headers['X-Internal-Secret'] = internalSecret;
      headers['X-Service-Name'] = 'frontend-lambda';
    }
    
    const response = await fetch(`${apiBase}/admin/matches/active`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    const result = await response.json();
    if (!response.ok) {
      return { 
        success: false, 
        error: result.error || result.message || 'Authentication required', 
        matches: [] 
      };
    }
    return result;
  } catch (error) {
    console.error('Error fetching active matches:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch active matches', 
      matches: [] 
    };
  }
}

/**
 * Get match data including problem, opponent stats, and starter code
 */
export async function getMatchData(matchId: string, userId: string) {
  try {
    const redis = getRedis();
    const matchKey = RedisKeys.matchKey(matchId);
    
    console.log('Looking for match with key:', matchKey, 'for userId:', userId);
    
    // Get match data from Redis
    const matchRaw = await redis.get(matchKey);
    if (!matchRaw) {
      console.log('Match not found in Redis with key:', matchKey);
      return { success: false, error: 'match_not_found' };
    }
    
    console.log('Match found in Redis, parsing data...');
    
    const matchData = JSON.parse(matchRaw);
    const problem = matchData.problem;
    
    // Get opponent userId from match players (array format)
    const playerUserIds = Array.isArray(matchData.players) 
      ? matchData.players 
      : Object.keys(matchData.players || {});
    const opponentUserId = playerUserIds.find((id: string) => id !== userId) || playerUserIds[0];
    
    // Get opponent stats (handle bots and guests)
    let opponentStats;
    if (opponentUserId.startsWith('guest_')) {
      // Guest opponent gets default stats
      opponentStats = {
        rating: 1200,
        wins: 0,
        losses: 0,
        totalMatches: 0
      };
    } else if (opponentUserId.length === 24) {
      // Check if it's a bot or regular user (24-char ObjectId)
      await connectDB();
      const client = await getMongoClient();
      const db = client.db(DB_NAME);
      
      // First check if it's a bot
      const bots = db.collection('bots');
      const bot = await bots.findOne(
        { _id: new ObjectId(opponentUserId) },
        { projection: { 'stats.rating': 1, 'stats.wins': 1, 'stats.losses': 1, 'stats.totalMatches': 1 } }
      );
      
      if (bot) {
        // It's a bot - use bot stats
        opponentStats = {
          rating: bot.stats?.rating || 1200,
          wins: bot.stats?.wins || 0,
          losses: bot.stats?.losses || 0,
          totalMatches: bot.stats?.totalMatches || 0
        };
      } else {
        // It's a regular user - use getUserStatsCached
        opponentStats = await getUserStatsCached(opponentUserId);
      }
    } else {
      // Regular user - use getUserStatsCached
      opponentStats = await getUserStatsCached(opponentUserId);
    }
    
    // Get current user stats (handle guest users)
    let userStats;
    if (userId.startsWith('guest_')) {
      // Guest users get default stats
      userStats = {
        rating: 1200,
        wins: 0,
        losses: 0,
        totalMatches: 0
      };
    } else {
      userStats = await getUserStatsCached(userId);
    }
    
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
    // Skip MongoDB lookup for guest users
    const isGuestOpponent = opponentUserId.startsWith('guest_');
    const isValidObjectId = !isGuestOpponent && ObjectId.isValid(opponentUserId);
    
    if (!opponentPlayerData && isValidObjectId) {
      await connectDB();
      const client = await getMongoClient();
      const db = client.db(DB_NAME);
      const users = db.collection('users');
      const opponentUser = await users.findOne(
        { _id: new ObjectId(opponentUserId) },
        { projection: { username: 1, 'profile.firstName': 1, 'profile.lastName': 1 } }
      );
      
      if (opponentUser) {
        opponentUsername = opponentUser?.username || 'Opponent';
        opponentName = `${opponentUser?.profile?.firstName || ''} ${opponentUser?.profile?.lastName || ''}`.trim() || opponentUsername;
      } else {
        // Check if it's a bot
        const bots = db.collection('bots');
        const bot = await bots.findOne(
          { _id: new ObjectId(opponentUserId) },
          { projection: { username: 1, fullName: 1 } }
        );
        
        if (bot) {
          opponentUsername = bot.username || 'Bot';
          opponentName = bot.fullName || opponentUsername;
        }
      }
    } else if (isGuestOpponent) {
      // Guest opponent - use default values
      opponentUsername = 'Guest';
      opponentName = 'Guest';
    } else if (opponentPlayerData && isValidObjectId) {
      // Get full name from MongoDB for user
      await connectDB();
      const client = await getMongoClient();
      const db = client.db(DB_NAME);
      const users = db.collection('users');
      const opponentUser = await users.findOne(
        { _id: new ObjectId(opponentUserId) },
        { projection: { 'profile.firstName': 1, 'profile.lastName': 1 } }
      );
      
      if (opponentUser) {
        opponentName = `${opponentUser?.profile?.firstName || ''} ${opponentUser?.profile?.lastName || ''}`.trim() || opponentUsername;
      } else {
        // Check if it's a bot
        const bots = db.collection('bots');
        const bot = await bots.findOne(
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
    
    // Recursively serialize ObjectId fields to strings - fix for React rendering error
    const serializeObjectIds = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return obj;
      }
      
      // Check if it's an ObjectId (has 'head' and 'pos' properties or toString method)
      if (obj && typeof obj === 'object' && ('head' in obj && 'pos' in obj || (typeof obj.toString === 'function' && obj.constructor?.name === 'ObjectId'))) {
        return obj.toString();
      }
      
      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map(serializeObjectIds);
      }
      
      // Handle objects
      if (typeof obj === 'object') {
        const serialized: any = {};
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            serialized[key] = serializeObjectIds(obj[key]);
          }
        }
        return serialized;
      }
      
      return obj;
    };
    
    // Ensure all ObjectId fields are converted to strings
    const serializedProblem = serializeObjectIds({
      ...clientProblem,
      starterCode,
    });
    
    return {
      success: true,
      problem: serializedProblem,
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

export async function persistMatchFromState(state: Record<string, unknown>) {
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
  const submissionsData = Array.isArray(state.submissions) ? state.submissions : [];
  
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
      problemId: tryToObjectId(state.problemId) || new ObjectId(String(state.problemId)),
      userId: tryToObjectId(submission.userId) || new ObjectId(String(submission.userId)),
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
    .map((id: unknown) => tryToObjectId(id) || new ObjectId(String(id)));

  const matchDoc = {
    _id: state.matchId,
    playerIds: playerObjectIds,
    problemId: tryToObjectId(state.problemId) || new ObjectId(String(state.problemId)),
    status: 'finished' as const,
    winnerUserId: state.winnerUserId ? (tryToObjectId(state.winnerUserId) || new ObjectId(String(state.winnerUserId))) : null,
    isDraw: state.isDraw || false,
    startedAt: state.startedAt ? new Date(String(state.startedAt)) : new Date(),
    endedAt: state.endedAt ? new Date(String(state.endedAt)) : new Date(),
    endReason: state.endReason || null,
    submissionIds: insertedIds,
  };
  
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
    await updatePlayerStatsAndRatings(playerIds as string[], state.winnerUserId as string | null, isDraw as boolean, db, state.ratingChanges as Record<string, { oldRating: number; newRating: number; change: number }> | undefined);
  } else {
    console.warn(`Expected 2 players but found ${playerIds.length}. Players:`, playerIds, 'State:', JSON.stringify(state, null, 2));
  }
  
  // Clean up Redis match data and player reservations
  const redis = getRedis();
  await redis.del(RedisKeys.matchKey(String(state.matchId)));
  console.log(`Deleted match data for ${state.matchId}`);
  
  // Critical: Delete player reservations so they can queue again
  for (const playerId of playerIds) {
    const deleted = await redis.del(`queue:reservation:${playerId}`);
    console.log(`Deleted reservation for player ${playerId} - result: ${deleted}`);
  }
  
  console.log(`Successfully cleaned up Redis data for match ${state.matchId}`);
  
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
    status: 'ongoing' as const,
    players: params.players,
    startedAt: params.startedAt || new Date().toISOString(),
    submissions: [] as unknown[],
    playersCode: {} as Record<string, unknown>,
    linesWritten: {} as Record<string, unknown>
  };
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
  await redis.srem(RedisKeys.activeMatchesSet, String(matchId));
  return { success: true };
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

