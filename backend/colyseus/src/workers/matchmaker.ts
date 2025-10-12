import { Server, matchMaker } from 'colyseus';
import { getRedis, RedisKeys } from '../lib/redis';
import fs from 'fs';
import path from 'path';

type QueueEntry = { userId: string; rating: number; joinedAt: number };

function now() { return Date.now(); }

// Problem selection (moved from Next.js)
function chooseProblemId(): string {
  try {
    // Problems are in client/problems.json - read from there or copy to backend
    const file = path.join(__dirname, '../../..', 'client', 'problems.json');
    const raw = fs.readFileSync(file, 'utf-8');
    const obj = JSON.parse(raw);
    const keys = Object.keys(obj);
    if (!keys.length) return 'two-sum'; // Fallback
    
    const difficulty = process.env.MATCH_DIFFICULTY || 'Medium';
    const filtered = keys.filter((k) => obj[k]?.difficulty === difficulty);
    const pool = filtered.length ? filtered : keys;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return pick;
  } catch (error) {
    console.error('Error selecting problem:', error);
    return 'two-sum'; // Fallback to a safe default
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

      // Select a problem based on difficulty
      const problemId = chooseProblemId();
      console.log(`Matchmaker: Selected problem ${problemId} for match ${matchId}`);
      
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
  // Simple random ID (not cryptographically secure). Good enough for internal match ids in PoC.
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}


