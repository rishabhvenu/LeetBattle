import { matchMaker } from 'colyseus';
import { getRedis, RedisKeys } from './redis';
import { MongoClient } from 'mongodb';
import { selectProblemDifficulty, getTargetEloForDifficulty } from './eloSystem';
import { getProblemWithTestCases } from './problemData';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://codeclashers-mongodb:27017/codeclashers';
const DB_NAME = 'codeclashers';

// MongoDB client singleton
let mongoClient: MongoClient | null = null;

async function getMongoClient(): Promise<MongoClient> {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    await mongoClient.connect();
  }
  return mongoClient;
}

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

// Generate a cryptographically secure random ID
function cryptoRandomId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
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
  isPrivate: boolean = false
): Promise<CreateMatchResult> {
  const redis = getRedis();
  
  // Generate unique match ID
  const matchId = cryptoRandomId();
  
  // Determine difficulty based on ratings if not provided
  let targetElo: number;
  if (!difficulty) {
    const avgRating = (player1.rating + player2.rating) / 2;
    const selection = selectProblemDifficulty(avgRating);
    difficulty = selection.difficulty;
    targetElo = selection.targetElo;
  } else {
    targetElo = getTargetEloForDifficulty(difficulty);
  }
  
  console.log(`Creating ${isPrivate ? 'private' : 'public'} match ${matchId} between ${player1.userId} (${player1.rating}) vs ${player2.userId} (${player2.rating}), difficulty: ${difficulty}`);
  
  // Select a problem from MongoDB
  const problemId = await chooseProblemId(difficulty);
  console.log(`Selected problem ${problemId} (${difficulty}) for match ${matchId}`);
  
  // Fetch the full problem data
  const fullProblemData = await getProblemWithTestCases(problemId);
  console.log(`Fetched problem data: ${fullProblemData?.title || 'Unknown'}`);
  
  // Sanitize problem data for client (remove test cases and solutions)
  const sanitizedProblem = sanitizeProblemForClient(fullProblemData);
  
  // Create Colyseus match room
  const room = await matchMaker.createRoom('match', { 
    matchId, 
    problemId, 
    problemData: fullProblemData // Pass full problem data to MatchRoom for code execution
  });
  console.log(`Created match room ${room.roomId} for match ${matchId}`);
  
  // Add to active matches set
  await redis.sadd(RedisKeys.activeMatchesSet, matchId);
  
  // Track bots in active matches
  const players = [player1.userId, player2.userId];
  for (const playerId of players) {
    // Check if this is a bot by looking up in MongoDB
    try {
      const { MongoClient, ObjectId } = await import('mongodb');
      const mongoClient = new MongoClient(process.env.MONGODB_URI!);
      const db = mongoClient.db('codeclashers');
      const bots = db.collection('bots');
      
      const bot = await bots.findOne({ _id: new ObjectId(playerId) });
      if (bot) {
        await redis.sadd(RedisKeys.botsActiveSet, playerId);
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
  
  // Initialize match data in Redis
  const matchKey = RedisKeys.matchKey(matchId);
  const matchObj = {
    matchId,
    problemId,
    problem: sanitizedProblem, // Store sanitized problem data for client
    players: {
      [player1.userId]: { 
        username: player1.username || player1.userId,
        rating: player1.rating 
      },
      [player2.userId]: { 
        username: player2.username || player2.userId,
        rating: player2.rating 
      }
    },
    playersCode: {},
    linesWritten: {},
    submissions: [],
    status: 'ongoing',
    startedAt: Date.now(),
    isPrivate,
    ratings: {
      player1: player1.rating,
      player2: player2.rating
    }
  };
  
  await redis.setex(matchKey, 3600, JSON.stringify(matchObj));
  
  // Create reservations for both players to join the match room
  const roomData = { 
    roomId: room.roomId, 
    roomName: 'match', 
    matchId, 
    problemId 
  };
  
  await redis.setex(`queue:reservation:${player1.userId}`, 3600, JSON.stringify(roomData));
  await redis.setex(`queue:reservation:${player2.userId}`, 3600, JSON.stringify(roomData));
  
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
    difficulty
  };
}
