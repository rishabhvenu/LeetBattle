import { Server } from 'colyseus';
import { createServer } from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import { QueueRoom } from './rooms/QueueRoom';
import { MatchRoom } from './rooms/MatchRoom';
import { startMatchmaker } from './workers/matchmaker';
import { enqueueUser, dequeueUser, queueSize } from './lib/queue';
import { getRedis, RedisKeys } from './lib/redis';
import jwt from 'jsonwebtoken';

const app = new Koa();
const router = new Router();
app.use(bodyParser());
app.use(cors({ origin: '*', allowMethods: ['GET','POST','OPTIONS'], allowHeaders: ['Content-Type','Authorization'] }));
app.use(router.routes());
app.use(router.allowedMethods());
router.post('/queue/enqueue', async (ctx) => {
  const { userId, rating } = ctx.request.body as { userId: string; rating: number };
  if (!userId || typeof rating !== 'number') { ctx.status = 400; ctx.body = { error: 'userId and rating required' }; return; }
  await enqueueUser(userId, rating);
  ctx.body = { success: true };
});

router.post('/queue/dequeue', async (ctx) => {
  const { userId } = ctx.request.body as { userId: string };
  if (!userId) { ctx.status = 400; ctx.body = { error: 'userId required' }; return; }
  await dequeueUser(userId);
  ctx.body = { success: true };
});

router.get('/queue/size', async (ctx) => {
  const size = await queueSize();
  ctx.body = { size };
});

router.get('/queue/reservation', async (ctx) => {
  const userId = (ctx.request.query as any).userId as string;
  if (!userId) { ctx.status = 400; ctx.body = { error: 'userId required' }; return; }
  const redis = getRedis();
  const reservationRaw = await redis.get(`queue:reservation:${userId}`);
  if (!reservationRaw) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
  const reservation = JSON.parse(reservationRaw);
  const secret = process.env.COLYSEUS_RESERVATION_SECRET || 'dev_secret';
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
  ctx.body = { token };
});

router.post('/reserve/consume', async (ctx) => {
  const { token } = ctx.request.body as { token: string };
  if (!token) { ctx.status = 400; ctx.body = { error: 'token required' }; return; }
  try {
    const secret = process.env.COLYSEUS_RESERVATION_SECRET || 'dev_secret';
    const payload = jwt.verify(token, secret) as any;
    const redis = getRedis();
    const reservationRaw = await redis.get(`queue:reservation:${payload.userId}`);
    if (!reservationRaw) { ctx.status = 404; ctx.body = { error: 'reservation_not_found' }; return; }
    const reservation = JSON.parse(reservationRaw);
    // Basic cross-check to avoid token swapping
    if (reservation.roomId !== payload.roomId || reservation.matchId !== payload.matchId) {
      ctx.status = 403; ctx.body = { error: 'mismatch' }; return;
    }
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
    ctx.status = 401;
    ctx.body = { error: 'invalid_token' };
  }
});

router.get('/match/snapshot', async (ctx) => {
  const matchId = (ctx.request.query as any).matchId as string;
  if (!matchId) { ctx.status = 400; ctx.body = { error: 'matchId required' }; return; }
  const redis = getRedis();
  const raw = await redis.get(RedisKeys.matchKey(matchId));
  if (!raw) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
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
    ctx.status = 500; ctx.body = { error: 'parse_error' };
  }
});

router.get('/match/submissions', async (ctx) => {
  const matchId = (ctx.request.query as any).matchId as string;
  if (!matchId) { ctx.status = 400; ctx.body = { error: 'matchId required' }; return; }
  const redis = getRedis();
  const raw = await redis.get(RedisKeys.matchKey(matchId));
  if (!raw) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
  try {
    const obj = JSON.parse(raw);
    ctx.body = { submissions: obj.submissions || [] };
  } catch {
    ctx.status = 500; ctx.body = { error: 'parse_error' };
  }
});

router.post('/queue/clear', async (ctx) => {
  const { userId } = ctx.request.body as { userId: string };
  if (!userId) { ctx.status = 400; ctx.body = { error: 'userId required' }; return; }
  const redis = getRedis();
  await redis.del(`queue:reservation:${userId}`);
  ctx.body = { success: true };
});

// Removed: /admin/create-match endpoint
// Matchmaking is now handled by backend/colyseus/workers/matchmaker.ts
// which runs automatically in the background

// Validate generated problem solutions (called by Next.js admin)
router.post('/admin/validate-solutions', async (ctx) => {
  const { signature, solutions, testCases } = ctx.request.body as {
    signature: { functionName: string; parameters: Array<{ name: string; type: string }>; returnType: string };
    solutions: { python?: string; cpp?: string; java?: string; js?: string };
    testCases: Array<{ input: Record<string, unknown>; output: unknown }>;
  };
  
  if (!signature || !solutions || !testCases) {
    ctx.status = 400;
    ctx.body = { error: 'signature, solutions, and testCases required' };
    return;
  }

  try {
    const { executeAllTestCases } = await import('./lib/testExecutor');
    const verificationErrors: string[] = [];
    const verificationResults: Record<string, any> = {};

    const languageMap: Record<string, 'python' | 'javascript' | 'java' | 'cpp'> = {
      python: 'python',
      js: 'javascript',
      java: 'java',
      cpp: 'cpp',
    };

    for (const [langKey, langValue] of Object.entries(languageMap)) {
      const solution = solutions[langKey as keyof typeof solutions];
      
      if (!solution) {
        verificationErrors.push(`Missing solution for ${langKey}`);
        continue;
      }

      try {
        const validationResult = await executeAllTestCases(
          langValue,
          solution,
          signature,
          testCases
        );

        verificationResults[langKey] = {
          allPassed: validationResult.allPassed,
          totalTests: validationResult.totalTests,
          passedTests: validationResult.passedTests,
          failedTests: validationResult.failedTests,
        };

        if (!validationResult.allPassed) {
          verificationErrors.push(
            `${langKey} solution failed ${validationResult.failedTests}/${validationResult.totalTests} tests`
          );
          
          // Log failed test details
          validationResult.results.forEach((result, idx) => {
            if (!result.passed) {
              console.error(`${langKey} test ${idx + 1} failed:`, {
                input: result.testCase.input,
                expected: result.testCase.output,
                actual: result.actualOutput,
                error: result.error
              });
            }
          });
        }
      } catch (error: any) {
        verificationErrors.push(`${langKey} verification error: ${error.message}`);
        console.error(`Error verifying ${langKey}:`, error);
      }
    }

    if (verificationErrors.length > 0) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: 'Solution verification failed',
        details: verificationErrors,
        results: verificationResults
      };
      return;
    }

    ctx.body = {
      success: true,
      message: 'All solutions verified successfully',
      results: verificationResults
    };
  } catch (error: any) {
    console.error('Validation endpoint error:', error);
    ctx.status = 500;
    ctx.body = { error: 'Internal validation error', message: error.message };
  }
});

const port = parseInt(process.env.PORT || '2567', 10);
const gameServer = new Server({ server: createServer(app.callback()) });

gameServer.define('queue', QueueRoom);
gameServer.define('match', MatchRoom);

gameServer.listen(port).then(async () => {
  console.log(`Colyseus listening on :${port}`);
  
  // Start the background matchmaker
  startMatchmaker(gameServer);
  console.log('Background matchmaker started');
});

