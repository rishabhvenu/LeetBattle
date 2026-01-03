/**
 * Queue Routes
 * Routes for queue management and match reservations
 */

import Router from 'koa-router';
import jwt from 'jsonwebtoken';
import { getRedis, RedisKeys } from '../lib/redis';
import { enqueueUser, dequeueUser, queueSize } from '../lib/queue';
import { rateLimitMiddleware, queueLimiter } from '../lib/rateLimiter';
import { combinedAuthMiddleware } from '../lib/internalAuth';

/**
 * Resolve the reservation secret from environment
 */
function resolveReservationSecret(): string {
  const secret = process.env.COLYSEUS_RESERVATION_SECRET;
  if (!secret) {
    throw new Error('COLYSEUS_RESERVATION_SECRET environment variable not set');
  }
  return secret;
}

export function registerQueueRoutes(router: Router) {
  
  /**
   * POST /queue/enqueue
   * Add a user to the matchmaking queue
   */
  router.post('/queue/enqueue', combinedAuthMiddleware(), async (ctx) => {
    const { userId, rating } = ctx.request.body as { userId: string; rating: number };
    if (!userId || typeof rating !== 'number') { 
      ctx.status = 400; 
      ctx.body = { error: 'userId and rating required' }; 
      return; 
    }
    
    await enqueueUser(userId, rating);
    
    // Publish player queued event for bot rotation
    const redis = getRedis();
    await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ 
      type: 'playerQueued', 
      playerId: userId 
    }));
    
    ctx.body = { success: true };
  });

  /**
   * POST /queue/dequeue
   * Remove a user from the matchmaking queue
   */
  router.post('/queue/dequeue', combinedAuthMiddleware(), async (ctx) => {
    const { userId } = ctx.request.body as { userId: string };
    if (!userId) { 
      ctx.status = 400; 
      ctx.body = { error: 'userId required' }; 
      return; 
    }
    
    await dequeueUser(userId);
    
    // Publish player dequeued event for bot rotation
    const redis = getRedis();
    await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ 
      type: 'playerDequeued', 
      playerId: userId 
    }));
    
    ctx.body = { success: true };
  });

  /**
   * GET /queue/size
   * Get current queue size
   */
  router.get('/queue/size', rateLimitMiddleware(queueLimiter), async (ctx) => {
    const size = await queueSize();
    ctx.body = { size };
  });

  /**
   * GET /global/general-stats
   * Get general platform statistics
   */
  router.get('/global/general-stats', rateLimitMiddleware(queueLimiter), async (ctx) => {
    try {
      const redis = getRedis();
      const results = await redis
        .multi()
        .zcard(RedisKeys.eloQueue) // 0
        .scard(RedisKeys.activeMatchesSet) // 1
        .scard(RedisKeys.queuedPlayersSet) // 2
        .scard(RedisKeys.humanPlayersSet) // 3
        .scard(RedisKeys.botsDeployedSet) // 4
        .scard(RedisKeys.botsActiveSet) // 5
        .llen(RedisKeys.botsRotationQueue) // 6
        .exec();

      const [
        [, queueSizeRaw],
        [, activeMatchesRaw],
        [, queuedPlayersCountRaw],
        [, queuedHumansCountRaw],
        [, botsDeployedCountRaw],
        [, botsActiveCountRaw],
        [, botRotationQueueLengthRaw],
      ] = results || [];

      const queueSize = Number(queueSizeRaw || 0);
      const activeMatches = Number(activeMatchesRaw || 0);
      const queuedPlayersCount = Number(queuedPlayersCountRaw || 0);
      const queuedHumansCount = Number(queuedHumansCountRaw || 0);
      const botsDeployedCount = Number(botsDeployedCountRaw || 0);
      const botsActiveCount = Number(botsActiveCountRaw || 0);
      const botRotationQueueLength = Number(botRotationQueueLengthRaw || 0);

      // Calculate longest wait time for any human player in queue
      let longestHumanWaitMs = 0;
      if (queuedHumansCount > 0) {
        const humanPlayerIds = await redis.smembers(RedisKeys.humanPlayersSet);
        const now = Date.now();
        for (const playerId of humanPlayerIds) {
          // Check if player is actually in the queue
          const inQueue = await redis.zscore(RedisKeys.eloQueue, playerId);
          if (inQueue !== null) {
            const joinedAtRaw = await redis.get(RedisKeys.queueJoinedAtKey(playerId));
            if (joinedAtRaw) {
              const waitMs = now - parseInt(joinedAtRaw, 10);
              if (waitMs > longestHumanWaitMs) {
                longestHumanWaitMs = waitMs;
              }
            }
          }
        }
      }

      ctx.body = {
        activePlayers: queueSize + (activeMatches * 2),
        inProgressMatches: activeMatches,
        inQueue: queueSize,
        queuedPlayersCount,
        queuedHumansCount,
        botsDeployedCount,
        botsActiveCount,
        botRotationQueueLength,
        longestHumanWaitMs,
      };
    } catch (error: any) {
      console.error('Error fetching general stats:', error);
      ctx.status = 500;
      ctx.body = { error: 'Failed to fetch general statistics' };
    }
  });

  /**
   * GET /queue/reservation
   * Get a JWT token for a queue reservation
   * Returns { found: false } with 200 if no reservation exists (to avoid console spam from polling)
   */
  router.get('/queue/reservation', rateLimitMiddleware(queueLimiter), async (ctx) => {
    const userId = (ctx.request.query as any).userId as string;
    if (!userId) { 
      ctx.status = 400; 
      ctx.body = { error: 'userId required' }; 
      return; 
    }
    
    const redis = getRedis();
    const reservationRaw = await redis.get(`queue:reservation:${userId}`);
    if (!reservationRaw) { 
      // Return 200 with found: false instead of 404 to avoid browser console spam during polling
      ctx.body = { found: false }; 
      return; 
    }
    
    const reservation = JSON.parse(reservationRaw);
    
    let secret: string;
    try {
      secret = resolveReservationSecret();
    } catch (error) {
      console.error('Reservation secret misconfigured:', error);
      ctx.status = 500;
      ctx.body = { error: 'reservation_secret_not_configured' };
      return;
    }
    
    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        roomId: reservation.roomId,
        roomName: reservation.roomName,
        matchId: reservation.matchId,
        problemId: reservation.problemId,
        userId,
        iat: nowSec,
        exp: nowSec + 3600, // 60 minute validity (longer than match duration)
      },
      secret,
      { algorithm: 'HS256' }
    );
    
    ctx.body = { found: true, token, matchId: reservation.matchId };
  });

  /**
   * POST /reserve/consume
   * Consume a reservation token to join a match
   */
  router.post('/reserve/consume', rateLimitMiddleware(queueLimiter), async (ctx) => {
    const { token } = ctx.request.body as { token: string };
    if (!token) { 
      ctx.status = 400; 
      ctx.body = { error: 'token required' }; 
      return; 
    }
    
    try {
      const secret = resolveReservationSecret();
      const payload = jwt.verify(token, secret) as any;
      
      const redis = getRedis();
      const reservationRaw = await redis.get(`queue:reservation:${payload.userId}`);
      if (!reservationRaw) { 
        ctx.status = 404; 
        ctx.body = { error: 'reservation_not_found' }; 
        return; 
      }
      
      const reservation = JSON.parse(reservationRaw);
      
      // Basic cross-check to avoid token swapping
      if (reservation.roomId !== payload.roomId || reservation.matchId !== payload.matchId) {
        ctx.status = 403; 
        ctx.body = { error: 'mismatch' }; 
        return;
      }
      
      // Don't delete the reservation after consumption to allow page reloads
      // Reservations will be cleaned up when the match ends or when explicitly cleared
      // This allows both players to consume the same reservation and handle page reloads
      
      // Return room data for direct join (no seat reservation needed)
      ctx.body = {
        reservation: {
          roomId: reservation.roomId,
          roomName: reservation.roomName,
          matchId: reservation.matchId,
          problemId: reservation.problemId,
          userId: payload.userId,
        }
      };
    } catch (e) {
      if (e instanceof Error && e.message.includes('COLYSEUS_RESERVATION_SECRET')) {
        console.error('Reservation secret misconfigured:', e);
        ctx.status = 500;
        ctx.body = { error: 'reservation_secret_not_configured' };
        return;
      }
      ctx.status = 401;
      ctx.body = { error: 'invalid_token' };
    }
  });

  /**
   * POST /queue/clear
   * Clear a user's queue reservation
   */
  router.post('/queue/clear', combinedAuthMiddleware(), async (ctx) => {
    const { userId } = ctx.request.body as { userId: string };
    if (!userId) { 
      ctx.status = 400; 
      ctx.body = { error: 'userId required' }; 
      return; 
    }
    
    const redis = getRedis();
    await redis.del(`queue:reservation:${userId}`);
    ctx.body = { success: true };
  });

}

