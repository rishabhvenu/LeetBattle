import { matchMaker } from 'colyseus';
import { getRedis, RedisKeys } from './redis';
import { MongoClient, ObjectId } from 'mongodb';
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
  isPrivate: boolean = false
): Promise<CreateMatchResult> {
  const redis = getRedis();
  
  // Generate unique match ID using MongoDB ObjectId
  const matchId = generateMatchId();
  
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
    problemData: fullProblemData, // Pass full problem data to MatchRoom for code execution
    player1Id: player1.userId,
    player2Id: player2.userId
  });
  console.log(`Created match room ${room.roomId} for match ${matchId}`);
  
  // Add to active matches set
  await redis.sadd(RedisKeys.activeMatchesSet, matchId);
  
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
        console.log(`Bot ${bot.username} added to active set`);
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
  
  // Match data is now initialized in MatchRoom.onCreate() to avoid overwriting bot completion times
  
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

/**
 * Find an available bot for guest users
 * Priority: 1) Undeployed bots, 2) Bots in queue
 * @returns Bot info or null if no bots available
 */
export async function findAvailableBotForGuest(): Promise<PlayerInfo | null> {
  try {
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const botsCollection = db.collection('bots');
    const redis = getRedis();
    
    // First, try to find undeployed bots
    const undeployedBots = await botsCollection
      .find({ deployed: false })
      .limit(10)
      .toArray();
    
    if (undeployedBots.length > 0) {
      // Pick a random undeployed bot
      const randomBot = undeployedBots[Math.floor(Math.random() * undeployedBots.length)];
      console.log(`Found undeployed bot: ${randomBot.username} (${randomBot._id})`);
      
      return {
        userId: randomBot._id.toString(),
        rating: randomBot.stats.rating,
        username: randomBot.username
      };
    }
    
    // If no undeployed bots, check Redis queue for bots
    const queuedPlayerIds = await redis.zrange(RedisKeys.eloQueue, 0, -1);
    
    for (const playerId of queuedPlayerIds) {
      // Check if this player is a bot
      try {
        const bot = await botsCollection.findOne({ _id: new ObjectId(playerId) });
        if (bot) {
          console.log(`Found bot in queue: ${bot.username} (${bot._id})`);
          return {
            userId: bot._id.toString(),
            rating: bot.stats.rating,
            username: bot.username
          };
        }
      } catch (error) {
        // Skip invalid ObjectIds
        continue;
      }
    }
    
    console.log('No available bots found for guest match');
    return null;
  } catch (error) {
    console.error('Error finding available bot for guest:', error);
    return null;
  }
}
