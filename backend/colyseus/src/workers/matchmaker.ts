import { Server, matchMaker } from 'colyseus';
import { getRedis, RedisKeys } from '../lib/redis';
import { MongoClient, ObjectId } from 'mongodb';

type QueueEntry = { userId: string; rating: number; joinedAt: number };

function now() { return Date.now(); }

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
    // Return null to fail gracefully - match creation will be skipped
    throw error;
  }
}

export function startMatchmaker(server: Server) {
  const redis = getRedis();
  
  console.log('Matchmaker starting with standalone matchMaker module');

  const tick = async () => {
    try {
      // Pull up to 10 earliest users (lowest score == rating first is not ideal for time ordering).
      // We store score as rating, but we also embed joinedAt in the value to handle fallback.
      const entries = await redis.zrange(RedisKeys.eloQueue, 0, 19, 'WITHSCORES');
      if (!entries || entries.length === 0) {
        return;
      }
      
      // Only log if we have 2+ players (potential match)
      if (entries.length >= 4) {
        console.log(`Matchmaker: ${entries.length / 2} players in queue, attempting to match...`);
      }

      // entries format: [userId1, score1, userId2, score2, ...]
      const queued: QueueEntry[] = [];
      for (let i = 0; i < entries.length; i += 2) {
        const userId = entries[i];
        const rating = parseFloat(entries[i + 1]);
        // joinedAt is not exposed here; assume fallback after 20s always for simplicity
        queued.push({ userId, rating, joinedAt: 0 });
      }

      if (queued.length < 2) return;

      // Naive pairing: pick two closest by rating
      queued.sort((a, b) => a.rating - b.rating);
      let bestPair: [QueueEntry, QueueEntry] | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (let i = 0; i < queued.length - 1; i++) {
        const diff = Math.abs(queued[i].rating - queued[i + 1].rating);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestPair = [queued[i], queued[i + 1]];
        }
      }
      if (!bestPair) return;

      console.log(`Matchmaker: Found pair - ${bestPair[0].userId} (${bestPair[0].rating}) vs ${bestPair[1].userId} (${bestPair[1].rating}), diff: ${bestDiff}`);
      
      // Remove the two matched users from the queue atomically
      const pipe = redis.multi();
      pipe.zrem(RedisKeys.eloQueue, bestPair[0].userId, bestPair[1].userId);
      await pipe.exec();

      // Store player ratings in Redis for Next.js to use when selecting problem
      const matchId = cryptoRandomId();
      await redis.hset(`match:${matchId}:ratings`, 'player1', bestPair[0].rating.toString());
      await redis.hset(`match:${matchId}:ratings`, 'player2', bestPair[1].rating.toString());
      await redis.hset(`match:${matchId}:ratings`, 'userId1', bestPair[0].userId);
      await redis.hset(`match:${matchId}:ratings`, 'userId2', bestPair[1].userId);
      await redis.expire(`match:${matchId}:ratings`, 300); // 5 minute TTL

      // Select a problem from MongoDB based on average rating
      const avgRating = (bestPair[0].rating + bestPair[1].rating) / 2;
      const difficulty = avgRating < 1400 ? 'Easy' : avgRating < 1800 ? 'Medium' : 'Hard';
      
      const problemId = await chooseProblemId(difficulty);
      console.log(`Matchmaker: Selected problem ${problemId} (${difficulty}) for match ${matchId}`);
      
      // Use standalone matchMaker module (Colyseus 0.15 API)
      const room = await matchMaker.createRoom('match', { matchId, problemId, problemData: null });
      console.log(`Matchmaker: Room created ${room.roomId} with problem ${problemId}`);
      
      await redis.sadd(RedisKeys.activeMatchesSet, matchId);
      
      // Store room info for both players - they'll join the room directly (no seat reservations)
      const roomData = { roomId: room.roomId, roomName: 'match', matchId, problemId };
      await redis.set(`queue:reservation:${bestPair[0].userId}`, JSON.stringify(roomData), 'EX', 3600); // 60 min TTL (longer than match duration)
      await redis.set(`queue:reservation:${bestPair[1].userId}`, JSON.stringify(roomData), 'EX', 3600); // 60 min TTL (longer than match duration)
      
      console.log(`Matchmaker: Created match ${matchId} with reservations for ${bestPair[0].userId} and ${bestPair[1].userId}`);
      
      // Optionally publish event
      await redis.publish(RedisKeys.matchEventsChannel, JSON.stringify({ type: 'match_created', matchId, players: [bestPair[0].userId, bestPair[1].userId], at: now() }));
    } catch (e) {
      console.error('Matchmaker error:', e);
    }
  };

  // run every 1s
  setInterval(tick, 1000);
}

function cryptoRandomId() {
  // Use crypto for collision-resistant match IDs
  return require('crypto').randomBytes(16).toString('hex');
}


