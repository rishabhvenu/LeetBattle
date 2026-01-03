/**
 * Match Routes
 * Routes for match data and snapshots
 */

import Router from 'koa-router';
import { ObjectId, Db } from 'mongodb';
import { getRedis, RedisKeys, isBotUser } from '../lib/redis';
import { getMongoClient, getDbName } from '../lib/mongo';
import { rateLimitMiddleware, matchLimiter } from '../lib/rateLimiter';
import { fetchParticipantStats, fetchParticipantIdentity } from '../helpers/statsHelpers';

const DB_NAME = getDbName();

export function registerMatchRoutes(router: Router) {
  
  /**
   * GET /match/snapshot
   * Get current match state from Redis
   */
  router.get('/match/snapshot', rateLimitMiddleware(matchLimiter), async (ctx) => {
    const matchId = (ctx.request.query as any).matchId as string;
    if (!matchId) { 
      ctx.status = 400; 
      ctx.body = { error: 'matchId required' }; 
      return; 
    }
    
    const redis = getRedis();
    const raw = await redis.get(RedisKeys.matchKey(matchId));
    if (!raw) { 
      ctx.status = 404; 
      ctx.body = { error: 'not_found' }; 
      return; 
    }
    
    try {
      const obj = JSON.parse(raw);
      ctx.body = {
        matchId: obj.matchId,
        problemId: obj.problemId,
        playersCode: obj.playersCode || {},
        linesWritten: obj.linesWritten || {},
        players: obj.players || {},
        submissions: obj.submissions || [],
        status: obj.status || 'ongoing',
        startedAt: obj.startedAt,
      };
    } catch {
      ctx.status = 500; 
      ctx.body = { error: 'parse_error' };
    }
  });

  /**
   * GET /match/submissions
   * Get match submissions
   */
  router.get('/match/submissions', rateLimitMiddleware(matchLimiter), async (ctx) => {
    const matchId = (ctx.request.query as any).matchId as string;
    if (!matchId) { 
      ctx.status = 400; 
      ctx.body = { error: 'matchId required' }; 
      return; 
    }
    
    const redis = getRedis();
    const raw = await redis.get(RedisKeys.matchKey(matchId));
    if (!raw) { 
      ctx.status = 404; 
      ctx.body = { error: 'not_found' }; 
      return; 
    }
    
    try {
      const obj = JSON.parse(raw);
      ctx.body = { submissions: obj.submissions || [] };
    } catch {
      ctx.status = 500; 
      ctx.body = { error: 'parse_error' };
    }
  });

  /**
   * GET /match/data
   * Get comprehensive match data including problem, opponent stats, and submissions
   */
  router.get('/match/data', rateLimitMiddleware(matchLimiter), async (ctx) => {
    try {
      const matchId = (ctx.request.query as any).matchId as string;
      const userId = (ctx.request.query as any).userId as string;

      // #region agent log
      console.log(`[DEBUG] GET /match/data - matchId: ${matchId}, userId: ${userId}, hypothesisId: A`);
      // #endregion

      if (!matchId || !userId) {
        ctx.status = 400;
        ctx.body = { error: 'matchId and userId required' };
        return;
      }

      const redis = getRedis();
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);

      // Get match data from Redis
      const matchRaw = await redis.get(RedisKeys.matchKey(matchId));
      if (!matchRaw) {
        ctx.status = 404;
        ctx.body = { error: 'Match not found' };
        return;
      }

      const matchData = JSON.parse(matchRaw);

      // Determine opponent ID
      const playerEntries = matchData.players || {};
      const playerIds: string[] = Array.isArray(playerEntries)
        ? playerEntries
        : Object.keys(playerEntries);

      // #region agent log
      console.log(`[DEBUG] match/data players structure - type: ${typeof playerEntries}, isArray: ${Array.isArray(playerEntries)}, keys: ${JSON.stringify(playerIds)}, userId: ${userId}, hypothesisId: A`);
      // #endregion

      const opponentUserId = playerIds.find((id) => id !== userId) || playerIds[0];

      // #region agent log
      console.log(`[DEBUG] match/data opponentUserId resolved - opponentUserId: ${opponentUserId}, playerIds: ${JSON.stringify(playerIds)}, hypothesisId: A,B`);
      // #endregion

      // Resolve opponent stats
      const opponentStats = opponentUserId
        ? await fetchParticipantStats(opponentUserId, db).catch((error) => {
            console.warn(`Failed to get opponent stats for ${opponentUserId}:`, error);
            return { rating: 1200, wins: 0, losses: 0, totalMatches: 0, globalRank: 1234 };
          })
        : { rating: 1200, wins: 0, losses: 0, totalMatches: 0, globalRank: 1234 };

      const userStats = await fetchParticipantStats(userId, db).catch((error) => {
        console.warn(`Failed to get user stats for ${userId}:`, error);
        return { rating: 1200, wins: 0, losses: 0, totalMatches: 0, globalRank: 1234 };
      });

      // Resolve opponent identity
      let opponentUsername = 'Opponent';
      let opponentName = 'Opponent';
      let opponentAvatar: string | null = null;

      const identity = await fetchParticipantIdentity(opponentUserId, db).catch((error) => {
        console.warn(`Failed to resolve opponent identity for ${opponentUserId}:`, error);
        return { username: 'Opponent', fullName: 'Opponent', avatar: null };
      });

      // #region agent log
      console.log(`[DEBUG] match/data identity resolved - opponentUserId: ${opponentUserId}, username: ${identity.username}, avatar: ${identity.avatar ? 'present' : 'null'}, hypothesisId: B,C,E`);
      // #endregion

      opponentUsername = identity.username;
      opponentName = identity.fullName;
      opponentAvatar = identity.avatar;

      // Sanitize problem data
      let problem = matchData.problem;
      if (problem && problem.testCases) {
        problem = {
          ...problem,
          testCases: problem.testCases.map((tc: any) => ({
            input: tc.input,
            output: tc.output,
            isHidden: tc.isHidden,
          })),
        };
      }

      // Get persisted code if available
      const persistedCode: Record<string, string> = {};
      for (const lang of ['javascript', 'python', 'java', 'cpp', 'go']) {
        const key = `match:${matchId}:code:${userId}:${lang}`;
        const code = await redis.get(key);
        if (code) {
          persistedCode[lang] = code;
        }
      }

      // Get submissions
      const submissions = matchData.submissions || [];

      ctx.body = {
        matchId,
        problem,
        opponentStats: {
          ...opponentStats,
          name: opponentName,
          username: opponentUsername,
          avatar: opponentAvatar,
        },
        userStats,
        persistedCode,
        submissions,
        players: matchData.players || {},
        playerData: matchData.playerData || {},
      };
    } catch (error: any) {
      console.error('Error fetching match data:', error);
      ctx.status = 500;
      ctx.body = { error: 'Failed to fetch match data' };
    }
  });

}

