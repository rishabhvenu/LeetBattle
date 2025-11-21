import { matchMaker } from 'colyseus';
import { getRedis, RedisKeys, isBotUser } from './redis';
import { ObjectId } from 'mongodb';
import { selectProblemDifficulty, getTargetEloForDifficulty } from './eloSystem';
import { getProblemWithTestCases } from './problemData';
import { getMongoClient, getDbName } from './mongo';

const DB_NAME = getDbName();

export interface PlayerInfo {
  userId: string;
  rating: number;
  username?: string;
}

export interface CreateMatchResult {
  matchId: string;
  roomId: string;
  problemId: string;
  difficulty: string;
}

export interface ProblemOverride {
  problemId: string;
  problemData?: any;
  difficulty?: string;
}

/**
 * Preflight: ensure neither player is currently reserved or (for bots) marked active.
 * Throws an error if unavailable.
 */
export async function preflightValidatePlayers(player1Id: string, player2Id: string): Promise<void> {
  const redis = getRedis();
  const [p1Res, p2Res, p1Active, p2Active] = await Promise.all([
    redis.get(`queue:reservation:${player1Id}`),
    redis.get(`queue:reservation:${player2Id}`),
    redis.sismember(RedisKeys.botsActiveSet, player1Id),
    redis.sismember(RedisKeys.botsActiveSet, player2Id),
  ]);
  if (p1Res) throw new Error(`preflight_reserved:${player1Id}`);
  if (p2Res) throw new Error(`preflight_reserved:${player2Id}`);
  if (p1Active) throw new Error(`preflight_active:${player1Id}`);
  if (p2Active) throw new Error(`preflight_active:${player2Id}`);
}

// Generate a MongoDB ObjectId for matchId
function generateMatchId(): string {
  return new ObjectId().toString();
}

/**
 * Sanitize problem data to include only client-safe fields
 * Excludes test cases, solutions, and other sensitive data
 */
function sanitizeProblemForClient(problem: any): any {
  return {
    _id: problem._id,
    title: problem.title,
    description: problem.description,
    difficulty: problem.difficulty,
    topics: problem.topics || [],
    signature: problem.signature,
    starterCode: problem.starterCode,
    examples: problem.examples || [],
    constraints: problem.constraints || [],
    testCasesCount: problem.testCases ? problem.testCases.length : 0
  };
}

// Select random problem from MongoDB by difficulty
async function chooseProblemId(difficulty: string = 'Medium'): Promise<string> {
  try {
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');
    
    // Select random problem matching difficulty
    const problems = await problemsCollection
      .aggregate([
        { $match: { difficulty, verified: true } },
        { $sample: { size: 1 } }
      ])
      .toArray();
    
    if (problems.length === 0) {
      console.warn(`No verified ${difficulty} problems found, trying any difficulty`);
      // Fallback: try any verified problem
      const anyProblems = await problemsCollection
        .aggregate([
          { $match: { verified: true } },
          { $sample: { size: 1 } }
        ])
        .toArray();
      
      if (anyProblems.length > 0) {
        return anyProblems[0]._id.toString();
      }
      
      throw new Error('No verified problems found in database');
    }
    
    return problems[0]._id.toString();
  } catch (error) {
    console.error('Error selecting problem from MongoDB:', error);
    throw error;
  }
}

/**
 * Creates a match between two players using the same logic as public matchmaking
 * @param player1 First player info
 * @param player2 Second player info  
 * @param difficulty Optional difficulty override (defaults to rating-based selection)
 * @param isPrivate Whether this is a private match (affects rating calculations)
 * @returns Match creation result with room details
 */
export async function createMatch(
  player1: PlayerInfo,
  player2: PlayerInfo,
  difficulty?: string,
  isPrivate: boolean = false,
  problemOverride?: ProblemOverride,
): Promise<CreateMatchResult> {
  const redis = getRedis();
  
  // Generate unique match ID using MongoDB ObjectId
  const matchId = generateMatchId();
  
  // Determine difficulty based on ratings if not provided
  let effectiveDifficulty = problemOverride?.difficulty ?? difficulty;
  let targetElo: number;
  if (!effectiveDifficulty) {
    const avgRating = (player1.rating + player2.rating) / 2;
    const selection = selectProblemDifficulty(avgRating);
    effectiveDifficulty = selection.difficulty;
    targetElo = selection.targetElo;
  } else {
    targetElo = getTargetEloForDifficulty(effectiveDifficulty);
  }
  
  console.log(
    `Creating ${isPrivate ? 'private' : 'public'} match ${matchId} between ${player1.userId} (${player1.rating}) vs ${player2.userId} (${player2.rating}), difficulty: ${effectiveDifficulty}${problemOverride ? ' (problem override)' : ''}`,
  );
  
  // Note: Reservation checks are handled by the caller (QueueRoom) before calling createMatch
  // This function assumes players are already validated and reserved
  
  // Select a problem from MongoDB
  let problemId = problemOverride?.problemId;
  if (!problemId) {
    problemId = await chooseProblemId(effectiveDifficulty);
    console.log(`Selected problem ${problemId} (${effectiveDifficulty}) for match ${matchId}`);
  } else {
    console.log(`Using overridden problem ${problemId} for match ${matchId}`);
  }
  
  // Fetch the full problem data
  let fullProblemData = problemOverride?.problemData;
  if (!fullProblemData) {
    fullProblemData = await getProblemWithTestCases(problemId);
  }
  console.log(`Fetched problem data: ${fullProblemData?.title || 'Unknown'}`);
  
  // Sanitize problem data for client (remove test cases and solutions)
  const sanitizedProblem = sanitizeProblemForClient(fullProblemData);
  
  // Fetch usernames for players (including bots) to populate match blob
  const mongoClient = await getMongoClient();
  const db = mongoClient.db(DB_NAME);
  const users = db.collection('users');
  const bots = db.collection('bots');
  
  let player1Username = player1.username || player1.userId;
  let player2Username = player2.username || player2.userId;
  
  // Try to get usernames from database if not provided
  if (!player1.username && ObjectId.isValid(player1.userId)) {
    try {
      const user = await users.findOne(
        { _id: new ObjectId(player1.userId) },
        { projection: { username: 1 } }
      );
      if (user?.username) {
        player1Username = user.username;
      } else {
        // Check if it's a bot
        const bot = await bots.findOne(
          { _id: new ObjectId(player1.userId) },
          { projection: { username: 1 } }
        );
        if (bot?.username) {
          player1Username = bot.username;
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch username for player1 ${player1.userId}:`, error);
    }
  }
  
  if (!player2.username && ObjectId.isValid(player2.userId)) {
    try {
      const user = await users.findOne(
        { _id: new ObjectId(player2.userId) },
        { projection: { username: 1 } }
      );
      if (user?.username) {
        player2Username = user.username;
      } else {
        // Check if it's a bot
        const bot = await bots.findOne(
          { _id: new ObjectId(player2.userId) },
          { projection: { username: 1 } }
        );
        if (bot?.username) {
          player2Username = bot.username;
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch username for player2 ${player2.userId}:`, error);
    }
  }
  
  // Create initial match blob in Redis BEFORE creating room to avoid race conditions
  // This ensures the match data exists when clients try to load it
  const matchKey = RedisKeys.matchKey(matchId);
  const initialMatchBlob = {
    matchId,
    problemId,
    status: 'ongoing',
    startedAt: new Date().toISOString(),
    players: {
      [player1.userId]: {
        username: player1Username,
        rating: player1.rating
      },
      [player2.userId]: {
        username: player2Username,
        rating: player2.rating
      }
    },
    playersCode: {},
    linesWritten: {},
    submissions: [],
    isPrivate: false,
    ratings: {
      player1: player1.rating,
      player2: player2.rating
    },
    problem: sanitizedProblem
  };
  await redis.setex(matchKey, 3600, JSON.stringify(initialMatchBlob));
  console.log(`Created initial match blob in Redis for match ${matchId} with players: ${player1Username} vs ${player2Username}`);
  
  // Verify the match blob was actually written to Redis
  const verifyBlob = await redis.get(matchKey);
  if (!verifyBlob) {
    console.error(`CRITICAL: Match blob was not persisted for match ${matchId}! Retrying...`);
    // Retry once
    await redis.setex(matchKey, 3600, JSON.stringify(initialMatchBlob));
    const verifyBlob2 = await redis.get(matchKey);
    if (!verifyBlob2) {
      console.error(`CRITICAL: Match blob still not persisted after retry for match ${matchId}!`);
      throw new Error(`Failed to persist match blob for match ${matchId}`);
    }
    console.log(`Match blob verified after retry for match ${matchId}`);
  } else {
    console.log(`Match blob verified in Redis for match ${matchId}`);
  }
  
  // Create Colyseus match room
  const room = await matchMaker.createRoom('match', { 
    matchId, 
    problemId, 
    problemData: fullProblemData, // Pass full problem data to MatchRoom for code execution
    player1Id: player1.userId,
    player2Id: player2.userId
  });
  console.log(`Created match room ${room.roomId} for match ${matchId}`);
  
  // Update match blob with roomId for easier room lookup
  const existingBlob = await redis.get(matchKey);
  if (existingBlob) {
    const blobData = JSON.parse(existingBlob);
    blobData.roomId = room.roomId;
    await redis.setex(matchKey, 3600, JSON.stringify(blobData));
    console.log(`Updated match blob with roomId ${room.roomId} for match ${matchId}`);
  }
  
  // Add to active matches set (after blob is created and verified)
  await redis.sadd(RedisKeys.activeMatchesSet, matchId);
  console.log(`Added match ${matchId} to activeMatchesSet`);
  
  // Track bots in active matches (completion times will be calculated in MatchRoom)
  const players = [player1.userId, player2.userId];
  for (const playerId of players) {
    // Check if this is a bot by looking up in MongoDB
    try {
      // Guest users are not bots
      if (playerId.startsWith('guest_')) {
        continue;
      }
      
      // Check if this is a valid ObjectId format first
      if (!ObjectId.isValid(playerId)) {
        continue;
      }
      
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      const bots = db.collection('bots');
      
      const bot = await bots.findOne({ _id: new ObjectId(playerId) });
      if (bot) {
        await redis.sadd(RedisKeys.botsActiveSet, playerId);
        // Set definitive current-match pointer for this bot
        await redis.setex(`bot:current_match:${playerId}`, 3600, matchId);
        console.log(`Bot ${bot.username} added to active set and linked to match ${matchId}`);
      }
    } catch (error) {
      console.warn('Failed to check if user is bot:', error);
    }
  }
  
  // Store player ratings in Redis (for match completion logic)
  await redis.hset(`match:${matchId}:ratings`, 'player1', player1.rating.toString());
  await redis.hset(`match:${matchId}:ratings`, 'player2', player2.rating.toString());
  await redis.hset(`match:${matchId}:ratings`, 'userId1', player1.userId);
  await redis.hset(`match:${matchId}:ratings`, 'userId2', player2.userId);
  await redis.hset(`match:${matchId}:ratings`, 'problemElo', targetElo.toString());
  await redis.expire(`match:${matchId}:ratings`, 3600); // 1 hour TTL
  
  // Match blob is initialized here to avoid race conditions when clients try to load match data
  // MatchRoom.onCreate() will preserve and update this blob without overwriting it
  
  // Create reservations for both players to join the match room
  const roomData = {
    roomId: room.roomId,
    roomName: 'match',
    matchId,
    problemId,
  };
  
  await redis.setex(`queue:reservation:${player1.userId}`, 3600, JSON.stringify(roomData));
  await redis.setex(`queue:reservation:${player2.userId}`, 3600, JSON.stringify(roomData));
  
  // CRITICAL: Set bot:current_match pointer for bots to prevent duplicate matches
  // This is checked in matchmaking to ensure bots aren't matched twice
  const isPlayer1Bot = await isBotUser(player1.userId);
  const isPlayer2Bot = await isBotUser(player2.userId);
  
  if (isPlayer1Bot) {
    await redis.setex(`bot:current_match:${player1.userId}`, 3600, matchId);
  }
  if (isPlayer2Bot) {
    await redis.setex(`bot:current_match:${player2.userId}`, 3600, matchId);
  }
  
  console.log(`Created match ${matchId} with reservations for ${player1.userId} and ${player2.userId}`);
  
  // Publish match creation event
  await redis.publish(
    RedisKeys.matchEventsChannel, 
    JSON.stringify({ 
      type: 'match_created', 
      matchId, 
      players: [player1.userId, player2.userId], 
      isPrivate,
      at: Date.now() 
    })
  );
  
  return {
    matchId,
    roomId: room.roomId,
    problemId,
    difficulty: effectiveDifficulty,
  };
}

/**
 * Find an available bot for guest users
 * Priority: 1) Undeployed bots, 2) Bots in queue
 * @returns Bot info or null if no bots available
 */
export async function findAvailableBotForGuest(): Promise<PlayerInfo | null> {
  try {
    const redis = getRedis();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const botsCollection = db.collection('bots');

    // Read queue with scores to get ratings
    const entries = await redis.zrange(RedisKeys.eloQueue, 0, -1, 'WITHSCORES');
    for (let i = 0; i < entries.length; i += 2) {
      const userId = entries[i];
      const score = parseFloat(entries[i + 1]);

      // Quick filter: must look like ObjectId
      if (!ObjectId.isValid(userId)) {
        continue;
      }

      // Skip if reserved or already active
      const [reservation, isActive] = await Promise.all([
        redis.get(`queue:reservation:${userId}`),
        redis.sismember(RedisKeys.botsActiveSet, userId),
      ]);
      if (reservation) {
        console.log(`[guest-bot] Skipping ${userId}: has reservation`);
        continue;
      }
      if (isActive) {
        console.log(`[guest-bot] Skipping ${userId}: is active`);
        continue;
      }

      // Ensure it's a bot
      const botDoc = await botsCollection.findOne({ _id: new ObjectId(userId) }, { projection: { username: 1, 'stats.rating': 1 } });
      if (!botDoc) {
        continue;
      }

      // Optional: prefer explicit queued state
      const state = await redis.get(`bots:state:${userId}`);
      if (state && state !== 'queued') {
        console.log(`[guest-bot] Skipping ${userId}: state=${state}`);
        continue;
      }

      return {
        userId,
        rating: Number.isFinite(score) ? score : (botDoc.stats?.rating ?? 1200),
        username: botDoc.username || 'Bot',
      };
    }

    console.log('[guest-bot] No eligible queued bot found');
    return null;
  } catch (error) {
    console.error('Error finding available queued bot for guest:', error);
    return null;
  }
}
