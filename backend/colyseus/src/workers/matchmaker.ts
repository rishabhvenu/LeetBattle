import { Server } from 'colyseus';
import { getRedis, RedisKeys } from '../lib/redis';
import { createMatch } from '../lib/matchCreation';

type QueueEntry = { userId: string; rating: number; joinedAt: number };

function now() { return Date.now(); }


export function startMatchmaker(server: Server) {
  const redis = getRedis();
  
  console.log('Matchmaker starting with standalone matchMaker module');

  const tick = async () => {
    try {
      // Pull up to N users from ELO queue
      const entries = await redis.zrange(RedisKeys.eloQueue, 0, 49, 'WITHSCORES');
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
        // Fetch joinedAt if present
        let joinedAt = 0;
        try {
          const raw = await redis.get(RedisKeys.queueJoinedAtKey(userId));
          joinedAt = raw ? parseInt(raw, 10) : 0;
        } catch {}
        queued.push({ userId, rating, joinedAt });
      }

      const botsEnabled = (process.env.BOTS_ENABLED || 'true').toLowerCase() === 'true';
      const graceMs = parseInt(process.env.BOT_FILL_DELAY_MS || '15000', 10);
      const nowMs = now();

      if (queued.length < 2) {
        // Consider bot fallback if exactly one user is waiting and grace exceeded
        if (!botsEnabled || queued.length === 0) return;
        const q = queued[0];
        const waited = q.joinedAt ? (nowMs - q.joinedAt) : Number.POSITIVE_INFINITY; // if missing, assume long wait
        if (waited < graceMs) return;

        // Attempt to allocate a bot from availability list
        let botPayload: string | null = null;
        try {
          botPayload = await redis.lpop('bots:available');
        } catch {}
        if (!botPayload) {
          // Notify bot service of demand
          try { await redis.lpush('bots:requests', JSON.stringify({ at: nowMs })); } catch {}
          return; // Wait next tick
        }
        try {
          const bot = JSON.parse(botPayload);
          const botId: string = bot._id?.toString();
          
          // Fetch bot rating from MongoDB
          let botRating = 1200; // default
          try {
            const { MongoClient, ObjectId } = await import('mongodb');
            const mongoClient = new MongoClient(process.env.MONGODB_URI || 'mongodb://codeclashers-mongodb:27017/codeclashers');
            await mongoClient.connect();
            const db = mongoClient.db('codeclashers');
            const bots = db.collection('bots');
            const botDoc = await bots.findOne({ _id: new ObjectId(botId) });
            if (botDoc && typeof botDoc.stats?.rating === 'number') {
              botRating = botDoc.stats.rating;
            }
            await mongoClient.close();
          } catch (mongoErr) {
            console.warn(`Failed to fetch bot rating for ${botId}, using default:`, mongoErr);
          }
          
          // Check if bot is already in an active match
          const isBotActive = await redis.sismember(RedisKeys.botsActiveSet, botId);
          if (isBotActive) {
            console.log(`Bot ${botId} is already in an active match, skipping`);
            // Return bot to available list
            try { await redis.rpush('bots:available', botPayload); } catch {}
            return;
          }

          // Remove human from queue atomically
          await redis.zrem(RedisKeys.eloQueue, q.userId);
          try { await redis.del(RedisKeys.queueJoinedAtKey(q.userId)); } catch {}

          const result = await createMatch({ userId: q.userId, rating: q.rating }, { userId: botId, rating: botRating }, undefined, false);
          console.log(`Matchmaker: Created human-vs-bot match ${result.matchId} (${q.userId} vs ${botId})`);
          return;
        } catch (e) {
          console.warn('Failed to parse/allocate bot:', e);
          return;
        }
      }

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

      // Create the match using the shared function
      const player1 = {
        userId: bestPair[0].userId,
        rating: bestPair[0].rating
      };
      const player2 = {
        userId: bestPair[1].userId,
        rating: bestPair[1].rating
      };
      const result = await createMatch(player1, player2, undefined, false); // false = not private
      console.log(`Matchmaker: Created match ${result.matchId} with room ${result.roomId}`);
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


