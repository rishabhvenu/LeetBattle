/**
 * Guest Routes
 * Routes for guest user functionality (play without account)
 */

import Router from 'koa-router';
import { ObjectId } from 'mongodb';
import { getRedis, RedisKeys } from '../lib/redis';
import { getMongoClient, getDbName } from '../lib/mongo';

const DB_NAME = getDbName();

export function registerGuestRoutes(router: Router) {
  
  /**
   * POST /guest/match/create
   * Create a match for a guest user with an available bot
   */
  router.post('/guest/match/create', async (ctx) => {
    try {
      const { findAvailableBotForGuest, createMatch, preflightValidatePlayers } = await import('../lib/matchCreation');
      const redis = getRedis();

      // Generate guest user ID up-front (used for emergency deployment signal)
      const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Helper to select an eligible queued bot
      async function selectQueuedBot() {
        const candidate = await findAvailableBotForGuest();
        return candidate;
      }

      const pollIntervalMs = parseInt(process.env.GUEST_BOT_POLL_INTERVAL_MS || '1000', 10);
      const timeoutMs = parseInt(process.env.GUEST_BOT_WAIT_TIMEOUT_MS || '45000', 10);

      let bot = await selectQueuedBot();
      if (!bot) {
        // Trigger emergency deployment signal for bots service
        try {
          await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({
            type: 'playerQueued',
            playerId: guestId,
          }));
          console.log(`[guest] Triggered emergency bot deployment for ${guestId}`);
        } catch (e) {
          console.warn('[guest] Failed to publish emergency deployment signal:', e);
        }

        // Poll for a queued bot to appear within timeout window
        const start = Date.now();
        while (!bot && (Date.now() - start) < timeoutMs) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          bot = await selectQueuedBot();
        }
      }

      if (!bot) {
        console.warn(`[guest] No bots became available within ${timeoutMs}ms for ${guestId}`);
        ctx.status = 200;
        ctx.body = {
          success: false,
          timedOut: true,
          error: 'Still searching for an available bot opponent. Please stay in the queue.',
        };
        return;
      }

      // Additional preflight (non-atomic) before atomic reservation
      try {
        await preflightValidatePlayers(guestId, bot.userId);
      } catch (e) {
        ctx.status = 409;
        ctx.body = { success: false, error: 'Bot no longer available' };
        return;
      }

      // Atomically reserve guest and bot, remove bot from queue, and mark bot active
      const watchKeys = [
        RedisKeys.eloQueue,
        `queue:reservation:${guestId}`,
        `queue:reservation:${bot.userId}`,
        RedisKeys.botsActiveSet,
      ];
      await (redis as any).watch(...watchKeys);

      const [stillInQueue, guestReservation, botReservation, botIsActive] = await Promise.all([
        (redis as any).zscore(RedisKeys.eloQueue, bot.userId),
        (redis as any).get(`queue:reservation:${guestId}`),
        (redis as any).get(`queue:reservation:${bot.userId}`),
        (redis as any).sismember(RedisKeys.botsActiveSet, bot.userId),
      ]);

      if (!stillInQueue || guestReservation || botReservation || botIsActive) {
        await (redis as any).unwatch();
        ctx.status = 409;
        ctx.body = { success: false, error: 'Bot no longer available' };
        return;
      }

      const tempReservation = JSON.stringify({ status: 'creating' });
      const multi = (redis as any).multi();
      multi.setex(`queue:reservation:${guestId}`, 60, tempReservation);
      multi.setex(`queue:reservation:${bot.userId}`, 60, tempReservation);
      multi.zrem(RedisKeys.eloQueue, bot.userId);
      multi.del(RedisKeys.queueJoinedAtKey(bot.userId));
      multi.sadd(RedisKeys.botsActiveSet, bot.userId);

      const execResult = await multi.exec();
      if (!execResult) {
        ctx.status = 409;
        ctx.body = { success: false, error: 'Bot selection conflicted, please retry' };
        return;
      }

      // Create match between guest and bot (createMatch will set long-lived reservations)
      const matchResult = await createMatch(
        { userId: guestId, rating: 1200, username: 'Guest' },
        bot,
        undefined,
        false
      );

      // Store guest session in Redis with 7-day TTL
      await redis.setex(RedisKeys.guestSessionKey(guestId), 7 * 24 * 3600, JSON.stringify({
        guestId,
        matchId: matchResult.matchId,
        roomId: matchResult.roomId,
        createdAt: Date.now(),
      }));

      ctx.body = {
        success: true,
        guestId,
        matchId: matchResult.matchId,
        roomId: matchResult.roomId,
        bot: {
          username: bot.username,
          rating: bot.rating,
        },
      };
    } catch (error: any) {
      console.error('Error creating guest match:', error);
      ctx.status = 500;
      ctx.body = { success: false, error: 'Failed to create guest match' };
    }
  });

  /**
   * GET /guest/check
   * Check if a guest user has completed a match
   */
  router.get('/guest/check', async (ctx) => {
    try {
      const guestId = ctx.request.query.guestId as string;
      if (!guestId) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'guestId required' };
        return;
      }
      
      const redis = getRedis();
      
      // Check if guest has completed a match (has match data stored)
      const matchData = await redis.get(RedisKeys.guestMatchKey(guestId));
      
      ctx.body = {
        success: true,
        hasPlayed: !!matchData
      };
    } catch (error: any) {
      console.error('Error checking guest session:', error);
      ctx.status = 500;
      ctx.body = { success: false, error: 'Failed to check guest session' };
    }
  });

  /**
   * POST /guest/match/claim
   * Claim a guest match when signing up
   */
  router.post('/guest/match/claim', async (ctx) => {
    try {
      const { guestId, userId } = ctx.request.body as { guestId: string; userId: string };
      if (!guestId || !userId) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'guestId and userId required' };
        return;
      }
      
      const redis = getRedis();
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      
      // Get guest session data
      const sessionData = await redis.get(RedisKeys.guestSessionKey(guestId));
      if (!sessionData) {
        ctx.status = 404;
        ctx.body = { success: false, error: 'Guest session not found' };
        return;
      }
      
      const session = JSON.parse(sessionData);
      const matchId = session.matchId;
      
      // Get guest match data from Redis
      const matchData = await redis.get(RedisKeys.guestMatchKey(guestId));
      if (!matchData) {
        ctx.status = 404;
        ctx.body = { success: false, error: 'Guest match data not found' };
        return;
      }
      
      const match = JSON.parse(matchData);
      
      // Create match document in MongoDB
      const matchesCollection = db.collection('matches');
      const matchDoc = {
        _id: new ObjectId(matchId),
        playerIds: [new ObjectId(userId), new ObjectId(match.opponentId)],
        problemId: new ObjectId(match.problemId),
        submissionIds: match.submissions || [],
        winnerUserId: match.result === 'win' ? new ObjectId(userId) : 
                     match.result === 'loss' ? new ObjectId(match.opponentId) : null,
        endedAt: new Date(match.completedAt),
        startedAt: new Date(match.completedAt - 45 * 60 * 1000), // Assume 45 min match
        createdAt: new Date(match.completedAt - 45 * 60 * 1000),
        mode: 'public',
        status: 'finished' as const
      };
      
      await matchesCollection.insertOne(matchDoc);
      
      // Update user document with matchId and stats
      const usersCollection = db.collection('users');
      
      // First, ensure the user has a matchIds field
      await usersCollection.updateOne(
        { _id: new ObjectId(userId), matchIds: { $exists: false } },
        { $set: { matchIds: [] } }
      );
      
      // Now update with match data
      const updateFields: any = {
        $inc: { 
          'stats.totalMatches': 1
        },
        $addToSet: { matchIds: new ObjectId(matchId) }
      };
      
      // Add win/loss specific updates
      if (match.result === 'win') {
        updateFields.$inc['stats.wins'] = 1;
        updateFields.$inc['stats.rating'] = 25; // Simple rating gain for guest match
      } else if (match.result === 'loss') {
        updateFields.$inc['stats.losses'] = 1;
        updateFields.$inc['stats.rating'] = -15; // Simple rating loss for guest match
      }
      
      await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        updateFields
      );
      
      // Clean up guest data from Redis
      await redis.del(
        RedisKeys.guestSessionKey(guestId),
        RedisKeys.guestMatchKey(guestId)
      );
      
      ctx.body = {
        success: true,
        matchId,
        message: 'Guest match claimed successfully'
      };
    } catch (error: any) {
      console.error('Error claiming guest match:', error);
      ctx.status = 500;
      ctx.body = { success: false, error: 'Failed to claim guest match' };
    }
  });

}

