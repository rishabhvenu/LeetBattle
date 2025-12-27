// Colyseus server entry point - main game server
// Trigger rebuild with updated MONGODB_URI
import { Server, matchMaker } from 'colyseus';
import { RedisPresence } from '@colyseus/redis-presence';
import { RedisDriver } from '@colyseus/redis-driver';
import { createServer } from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import { ObjectId, Db } from 'mongodb';
import { QueueRoom } from './rooms/QueueRoom';
import { MatchRoom } from './rooms/MatchRoom';
import { PrivateRoom } from './rooms/PrivateRoom';
// Matchmaking is now integrated into QueueRoom
import { enqueueUser, dequeueUser, queueSize } from './lib/queue';
import { getRedis, RedisKeys, isBotUser } from './lib/redis';
import { getMongoClient, getDbName } from './lib/mongo';
import { prepareTestCasesForExecution, type ProblemTestCase, type SpecialInputConfig } from './lib/specialInputs';
import Redis, { RedisOptions, ClusterNode, ClusterOptions } from 'ioredis';
import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import AWS from 'aws-sdk';
import { 
  rateLimitMiddleware, 
  queueLimiter, 
  matchLimiter, 
  adminLimiter 
} from './lib/rateLimiter';
import { internalAuthMiddleware, botAuthMiddleware, combinedAuthMiddleware, adminAuthMiddleware } from './lib/internalAuth';
import { startCleanupWorker } from './workers/redisCleanup';

const DB_NAME = getDbName();
const isProduction = process.env.NODE_ENV === 'production';

type RedisEndpoint = { host: string; port: number };

interface RedisScalingConfig {
  options: RedisOptions;
  endpoints?: RedisEndpoint[];
}

function parseClusterEndpoints(raw?: string | null): RedisEndpoint[] | undefined {
  if (!raw) {
    return undefined;
  }

  const endpoints = raw
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [host, rawPort] = segment.split(':');
      const port = parseInt(rawPort ?? '6379', 10);
      if (!host) {
        return undefined;
      }
      return {
        host,
        port: Number.isNaN(port) ? 6379 : port,
      } satisfies RedisEndpoint;
    })
    .filter((endpoint): endpoint is RedisEndpoint => Boolean(endpoint));

  return endpoints.length > 0 ? endpoints : undefined;
}

function buildRedisScalingConfig(): RedisScalingConfig {
  if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
    throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
  }

  const options: RedisOptions = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT, 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };

  if (process.env.REDIS_USERNAME) {
    (options as unknown as { username: string }).username = process.env.REDIS_USERNAME;
  }

  if (process.env.REDIS_DB) {
    const db = parseInt(process.env.REDIS_DB, 10);
    if (!Number.isNaN(db)) {
      options.db = db;
    }
  }

  if ((process.env.REDIS_TLS || '').toLowerCase() === 'true') {
    options.tls = {
      rejectUnauthorized: (process.env.REDIS_TLS_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false',
    };
  }

  const endpoints = parseClusterEndpoints(process.env.REDIS_CLUSTER_NODES);

  return { options, endpoints };
}

const redisScalingConfig = buildRedisScalingConfig();

async function getBotsInActiveMatches(redis: ReturnType<typeof getRedis>): Promise<string[]> {
  try {
    const activeMatchIds = await redis.smembers(RedisKeys.activeMatchesSet);
    if (!activeMatchIds || activeMatchIds.length === 0) {
      return [];
    }

    const matchKeys = activeMatchIds.map((id) => RedisKeys.matchKey(id));
    const matches = await redis.mget(matchKeys);
    const botIds = new Set<string>();

    matches.forEach((data, idx) => {
      if (!data) {
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed?.players) {
          Object.keys(parsed.players).forEach((playerId) => {
            botIds.add(playerId);
          });
        }
      } catch (err) {
        console.error(`Failed to parse match data for ${activeMatchIds[idx]}:`, err);
      }
    });

    return Array.from(botIds);
  } catch (error) {
    console.error('Failed to enumerate bots in active matches:', error);
    return [];
  }
}

function createRedisPresence() {
  if (redisScalingConfig.endpoints && redisScalingConfig.endpoints.length > 0) {
    const clusterOptions: ClusterOptions = {
      redisOptions: redisScalingConfig.options,
    };
    return new RedisPresence(redisScalingConfig.endpoints as ClusterNode[], clusterOptions);
  }
  return new RedisPresence(redisScalingConfig.options as RedisOptions);
}

function createRedisDriver() {
  if (redisScalingConfig.endpoints && redisScalingConfig.endpoints.length > 0) {
    const clusterOptions: ClusterOptions = {
      redisOptions: redisScalingConfig.options,
    };
    return new RedisDriver(redisScalingConfig.endpoints as ClusterNode[], clusterOptions);
  }
  return new RedisDriver(redisScalingConfig.options as RedisOptions);
}

const redisPresence = createRedisPresence();
const redisDriver = createRedisDriver();

function resolveReservationSecret(): string {
  const secret = process.env.COLYSEUS_RESERVATION_SECRET;
  if (!secret || (secret === 'dev_secret' && isProduction)) {
    throw new Error('COLYSEUS_RESERVATION_SECRET must be configured in production.');
  }
  return secret || 'dev_secret';
}

type ParticipantStats = {
  rating: number;
  wins: number;
  losses: number;
  totalMatches: number;
  globalRank: number;
};

async function fetchParticipantStats(userId: string, db: Db): Promise<ParticipantStats> {
  const defaultStats: ParticipantStats = {
    rating: 1200,
    wins: 0,
    losses: 0,
    totalMatches: 0,
    globalRank: 1234,
  };

  if (!userId || userId.startsWith('guest_')) {
    return defaultStats;
  }

  if (!ObjectId.isValid(userId)) {
    return defaultStats;
  }

  const userObjectId = new ObjectId(userId);
  const matchesCollection = db.collection('matches');
  const botsCollection = db.collection('bots');
  const usersCollection = db.collection('users');

  const botDoc = await botsCollection.findOne(
    { _id: userObjectId },
    { projection: { 'stats.rating': 1, 'stats.wins': 1, 'stats.losses': 1, 'stats.totalMatches': 1 } }
  );

  if (botDoc) {
    const rating = botDoc.stats?.rating ?? 1200;
    const totalMatches = botDoc.stats?.totalMatches ?? 0;
    const wins = botDoc.stats?.wins ?? 0;
    const losses = botDoc.stats?.losses ?? 0;
    const higherBots = await botsCollection.countDocuments({ 'stats.rating': { $gt: rating } });
    return {
      rating,
      wins,
      losses,
      totalMatches,
      globalRank: higherBots + 1,
    };
  }

  const totalMatches = await matchesCollection.countDocuments({ playerIds: userObjectId });
  const wins = await matchesCollection.countDocuments({ winnerUserId: userObjectId });
  const losses = Math.max(totalMatches - wins, 0);

  const userDoc = await usersCollection.findOne(
    { _id: userObjectId },
    { projection: { 'stats.rating': 1 } }
  );

  const rating = userDoc?.stats?.rating ?? 1200;
  const higherUsers = await usersCollection.countDocuments({ 'stats.rating': { $gt: rating } });

  return {
    rating,
    wins,
    losses,
    totalMatches,
    globalRank: higherUsers + 1,
  };
}

async function fetchParticipantIdentity(userId: string, db: Db): Promise<{ username: string; fullName: string; avatar: string | null }> {
  if (!userId) {
    return { username: 'Opponent', fullName: 'Opponent', avatar: null };
  }

  if (userId.startsWith('guest_')) {
    return { username: 'Guest', fullName: 'Guest User', avatar: null };
  }

  if (!ObjectId.isValid(userId)) {
    return { username: 'Opponent', fullName: 'Opponent', avatar: null };
  }

  const userObjectId = new ObjectId(userId);
  const usersCollection = db.collection('users');
  const botsCollection = db.collection('bots');

  const userDoc = await usersCollection.findOne(
    { _id: userObjectId },
    { projection: { username: 1, avatar: 1, 'profile.avatar': 1, 'profile.firstName': 1, 'profile.lastName': 1 } }
  );

  if (userDoc) {
    const username = userDoc.username || 'Opponent';
    const fullName = `${userDoc.profile?.firstName || ''} ${userDoc.profile?.lastName || ''}`.trim() || username;
    const avatar = (userDoc.profile?.avatar || userDoc.avatar || null) ?? null;
    return { username, fullName, avatar };
  }

  const botDoc = await botsCollection.findOne(
    { _id: userObjectId },
    { projection: { username: 1, fullName: 1, avatar: 1 } }
  );

  if (botDoc) {
    return {
      username: botDoc.username || 'Bot',
      fullName: botDoc.fullName || botDoc.username || 'Bot',
      avatar: botDoc.avatar || null,
    };
  }

  return { username: 'Opponent', fullName: 'Opponent', avatar: null };
}

// OpenAI client singleton
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Helper function to scan Redis for keys matching a pattern
 */
async function scanRedisKeys(redis: ReturnType<typeof getRedis>, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  
  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');
  
  return keys;
}

function createS3Client() {
  const config: AWS.S3.ClientConfiguration = {
    region: process.env.AWS_REGION || 'us-east-1',
    signatureVersion: 'v4',
  };

  const resolvedEndpoint =
    process.env.S3_ENDPOINT ||
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_ACCESS_KEY_ID.startsWith('minio')
      ? 'http://minio-dev:9000'
      : undefined) ||
    (!isProduction ? 'http://localhost:9000' : undefined);
  if (resolvedEndpoint) {
    config.endpoint = resolvedEndpoint;
    config.s3ForcePathStyle = true;
  }

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  return new AWS.S3(config);
}

const s3 = createS3Client();

const app = new Koa();
const router = new Router();

// Guest user endpoints
router.post('/guest/match/create', async (ctx) => {
  try {
    const { findAvailableBotForGuest, createMatch, preflightValidatePlayers } = await import('./lib/matchCreation');
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
    
    // Clean up guest data
    await redis.del(RedisKeys.guestSessionKey(guestId));
    await redis.del(RedisKeys.guestMatchKey(guestId));
    
    ctx.body = {
      success: true,
      message: 'Guest match claimed successfully'
    };
  } catch (error: any) {
    console.error('Error claiming guest match:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to claim guest match' };
  }
});

// Bot rotation endpoints
router.post('/admin/bots/rotation/config', adminAuthMiddleware(), async (ctx) => {
  try {
    const { maxDeployed } = ctx.request.body as { maxDeployed: number };
    
    if (typeof maxDeployed !== 'number' || maxDeployed < 0) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'maxDeployed must be a non-negative number' };
      return;
    }
    
    // Create a separate Redis connection for admin operations
    if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
      throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
    }
    const redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
    });
    
    // Get total bots count
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const bots = db.collection('bots');
    const totalBots = await bots.countDocuments({});
    
    // Update rotation config
    await redis.hset(RedisKeys.botsRotationConfig, {
      maxDeployed: maxDeployed.toString(),
      totalBots: totalBots.toString()
    });
    
    // Notify bot service to update rotation
    await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ 
      type: 'rotateConfig', 
      maxDeployed 
    }));
    
    ctx.body = {
      success: true,
      message: `Rotation config updated: maxDeployed = ${maxDeployed}`
    };
  } catch (error: any) {
    console.error('Error updating rotation config:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to update rotation config' };
  }
});

router.get('/admin/bots/rotation/status', adminAuthMiddleware(), async (ctx) => {
  try {
    const redis = getRedis();

    // Verify Redis connectivity (works for both single node and cluster clients)
    await redis.ping();
    
    // Get rotation config, initialize if it doesn't exist
    const configExists = await redis.exists(RedisKeys.botsRotationConfig);
    let config = {};
    
    if (!configExists) {
      // Initialize rotation config with default values
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      const bots = db.collection('bots');
      const totalBots = await bots.countDocuments({});
      
      await redis.hset(RedisKeys.botsRotationConfig, {
        maxDeployed: '5',
        totalBots: totalBots.toString()
      });
      
      config = { maxDeployed: '5', totalBots: totalBots.toString() };
    } else {
      config = await redis.hgetall(RedisKeys.botsRotationConfig);
    }
    
    const maxDeployed = parseInt((config as any).maxDeployed || '5');
    const totalBots = parseInt((config as any).totalBots || '0');
    
    const deployedBots = await redis.smembers(RedisKeys.botsDeployedSet);
    const activeSet = await redis.smembers(RedisKeys.botsActiveSet);
    const matchActiveBots = await getBotsInActiveMatches(redis);
    const rotationQueue = await redis.lrange(RedisKeys.botsRotationQueue, 0, -1);

    const activeBotSet = new Set<string>([...activeSet, ...matchActiveBots]);
    const activeBotIds = Array.from(activeBotSet);
    const activeCount = activeBotIds.length;

    const deployedSet = new Set<string>(deployedBots);
    const totalDeployedSet = new Set<string>([...deployedBots, ...activeBotIds]);
    const deployedCount = totalDeployedSet.size;
    const allDeployedBots = Array.from(totalDeployedSet);
    
    const queuedPlayersCount = await redis.scard(RedisKeys.queuedPlayersSet);
    const queuedHumansCount = await redis.scard(RedisKeys.humanPlayersSet);
    
    ctx.body = {
      success: true,
      status: {
        maxDeployed,
        totalBots,
        deployedCount,
        deployedBots: allDeployedBots,
        activeCount,
        activeBots: activeBotIds,
        rotationQueue,
        queueLength: rotationQueue.length,
        queuedPlayersCount,
        queuedHumansCount,
        targetDeployed: maxDeployed
      }
    };
  } catch (error: any) {
    console.error('Error getting rotation status:', error);
    console.error('Error details:', error.message, error.stack);
    ctx.status = 500;
    ctx.body = { success: false, error: `Failed to get rotation status: ${error.message}` };
  }
});

// Initialize rotation system endpoint
router.post('/admin/bots/rotation/init', adminAuthMiddleware(), async (ctx) => {
  try {
    // Create a separate Redis connection for admin operations
    if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
      throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
    }
    const redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
    });
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const bots = db.collection('bots');
    
    // Get all bots
    const allBots = await bots.find({}).toArray();
    const totalBots = allBots.length;
    
    // Clear and rebuild rotation queue
    await redis.del(RedisKeys.botsRotationQueue);
    
    // Add bots that are NOT currently deployed (per Redis) to rotation queue
    const deployedBotIds = await redis.smembers(RedisKeys.botsDeployedSet);
    const deployedSet = new Set(deployedBotIds);
    const undeployedBots = allBots.filter(bot => !deployedSet.has(bot._id.toString()));
    for (const bot of undeployedBots) {
      await redis.rpush(RedisKeys.botsRotationQueue, bot._id.toString());
    }
    
    // Initialize or update rotation config
    await redis.hset(RedisKeys.botsRotationConfig, {
      maxDeployed: '5',
      totalBots: totalBots.toString()
    });
    
    // Notify bot service to refresh
    await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ type: 'deploy' }));
    
    ctx.body = {
      success: true,
      message: `Rotation system initialized with ${totalBots} total bots, ${undeployedBots.length} in queue`
    };
  } catch (error: any) {
    console.error('Error initializing rotation system:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to initialize rotation system' };
  }
});

app.use(bodyParser());
app.use(cors({ 
  origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000'), 
  allowMethods: ['GET','POST','PUT','DELETE','OPTIONS'], 
  allowHeaders: ['Content-Type','Authorization','X-Internal-Secret','X-Bot-Secret','X-Service-Name','Cookie'],
  credentials: true 
}));

// Health check endpoint for Kubernetes probes (registered as app middleware BEFORE router to ensure it's always accessible)
app.use(async (ctx, next) => {
  if (ctx.path === '/health' && ctx.method === 'GET') {
    ctx.status = 200;
    ctx.body = { status: 'ok' };
    return;
  }
  await next();
});

app.use(router.routes());
app.use(router.allowedMethods());

// Queue endpoints with rate limiting
router.post('/queue/enqueue', combinedAuthMiddleware(), async (ctx) => {
  const { userId, rating } = ctx.request.body as { userId: string; rating: number };
  if (!userId || typeof rating !== 'number') { ctx.status = 400; ctx.body = { error: 'userId and rating required' }; return; }
  await enqueueUser(userId, rating);
  
  // Publish player queued event for bot rotation
  const redis = getRedis();
  await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ 
    type: 'playerQueued', 
    playerId: userId 
  }));
  
  ctx.body = { success: true };
});

router.post('/queue/dequeue', combinedAuthMiddleware(), async (ctx) => {
  const { userId } = ctx.request.body as { userId: string };
  if (!userId) { ctx.status = 400; ctx.body = { error: 'userId required' }; return; }
  await dequeueUser(userId);
  
  // Publish player dequeued event for bot rotation
  const redis = getRedis();
  await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ 
    type: 'playerDequeued', 
    playerId: userId 
  }));
  
  ctx.body = { success: true };
});

router.get('/queue/size', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const size = await queueSize();
  ctx.body = { size };
});

// General statistics endpoint
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

    // Query MongoDB for total completed matches count
    let matchesCompleted = 0;
    try {
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      matchesCompleted = await db.collection('matches').countDocuments({ status: 'finished' });
    } catch (mongoErr) {
      console.error('Error fetching matches count from MongoDB:', mongoErr);
    }

    ctx.body = {
      activePlayers: queueSize + (activeMatches * 2),
      matchesCompleted,
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

router.get('/queue/reservation', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const userId = (ctx.request.query as any).userId as string;
  if (!userId) { ctx.status = 400; ctx.body = { error: 'userId required' }; return; }
  const redis = getRedis();
  const reservationRaw = await redis.get(`queue:reservation:${userId}`);
  // Return 200 with found: false instead of 404 to avoid browser console spam during polling
  if (!reservationRaw) { ctx.body = { found: false }; return; }
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

router.post('/reserve/consume', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const { token } = ctx.request.body as { token: string };
  if (!token) { ctx.status = 400; ctx.body = { error: 'token required' }; return; }
  try {
    const secret = resolveReservationSecret();
    const payload = jwt.verify(token, secret) as any;
    const redis = getRedis();
    const reservationRaw = await redis.get(`queue:reservation:${payload.userId}`);
    if (!reservationRaw) { ctx.status = 404; ctx.body = { error: 'reservation_not_found' }; return; }
    const reservation = JSON.parse(reservationRaw);
    // Basic cross-check to avoid token swapping
    if (reservation.roomId !== payload.roomId || reservation.matchId !== payload.matchId) {
      ctx.status = 403; ctx.body = { error: 'mismatch' }; return;
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

router.get('/match/snapshot', rateLimitMiddleware(matchLimiter), async (ctx) => {
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

router.get('/match/submissions', rateLimitMiddleware(matchLimiter), async (ctx) => {
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

router.post('/queue/clear', combinedAuthMiddleware(), async (ctx) => {
  const { userId } = ctx.request.body as { userId: string };
  if (!userId) { ctx.status = 400; ctx.body = { error: 'userId required' }; return; }
  const redis = getRedis();
  await redis.del(`queue:reservation:${userId}`);
  ctx.body = { success: true };
});

// DieseDie endpoint for creating rooms
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// FIXED PRIVATE ROOM CREATE - UNLOCK BEFORE CLIENT JOINS
router.post('/private/create', async (ctx) => {
  const { userId, username } = ctx.request.body as { userId: string; username: string };
  if (!userId || !username) { 
    ctx.status = 400; 
    ctx.body = { error: 'userId and username required' }; 
    return; 
  }
  
  try {
    const redis = getRedis();
    
    // Generate a unique room code
    let normalizedCode: string;
    let attempts = 0;
    do {
      normalizedCode = generateRoomCode();
      attempts++;
      
      if (attempts > 10) {
        ctx.status = 500;
        ctx.body = { error: 'Could not generate unique room code' };
        return;
      }
    } while (await redis.exists(`private:room:${normalizedCode}`));
    
    console.log(`Creating new room with code: ${normalizedCode}`);
    
    // Create the Colyseus room
    const room = await matchMaker.create('private', { 
      roomCode: normalizedCode, 
      creatorId: userId, 
      creatorUsername: username 
    });
    
    console.log(`Successfully created room: ${room.room.roomId}`);
    
    // CRITICAL: Store room info in Redis FIRST so it can be found
    await redis.setex(
      `private:room:${normalizedCode}`,
      1800, // 30 minute timeout
      JSON.stringify({
        roomId: room.room.roomId,
        creatorId: userId,
        createdAt: Date.now()
      })
    );
    
    // Add creator to players set so HTTP state immediately reflects host presence
    try {
      const infoKey = `private:room:${normalizedCode}:info`;
      const roomInfoBlob = {
        roomCode: normalizedCode,
        roomId: room.room.roomId,
        creatorId: userId,
        players: [{ userId, username }],
        selectedProblemId: null,
        status: 'waiting'
      };
      await redis.setex(infoKey, 1800, JSON.stringify(roomInfoBlob));
    } catch (e) {
      console.error('Failed writing creator room info blob:', e);
    }
    
    console.log(`Stored room ${normalizedCode} in Redis with roomId: ${room.room.roomId}`);
    
    // CRITICAL: Wait for room to be fully initialized AND unlocked
    await new Promise(resolve => setTimeout(resolve, 1000)); // Give it time to initialize
    
    // Verify room is accessible
    const roomState = room.room;
    console.log(`Room ${normalizedCode} state - locked: ${roomState.locked}, maxClients: ${roomState.maxClients}`);
    
    console.log(`Room ${normalizedCode} is ready for connections (including creator)`);
    
    // Return full room info blob
    const infoKey = `private:room:${normalizedCode}:info`;
    const blobRaw = await redis.get(infoKey);
    const blob = blobRaw ? JSON.parse(blobRaw) : {
      roomCode: normalizedCode,
      roomId: room.room.roomId,
      creatorId: userId,
      players: [{ userId, username }],
      selectedProblemId: null,
      status: 'waiting'
    };
    
    ctx.body = { success: true, ...blob, isCreator: true };
  } catch (error) {
    console.error('Error creating private room:', error);
    ctx.status = 500;
    ctx.body = { error: 'Failed to create private room' };
  }
});

// FIXED PRIVATE ROOM JOIN - RETURN ROOM INFO FOR WEBSOCKET CONNECTION
router.post('/private/join', async (ctx) => {
  const { roomCode, userId, username } = ctx.request.body as { roomCode: string; userId: string; username: string };
  if (!roomCode || !userId || !username) { 
    ctx.status = 400; 
    ctx.body = { error: 'roomCode, userId, and username required' }; 
    return; 
  }
  
  try {
    const redis = getRedis();
    const normalizedCode = roomCode.toUpperCase();
    
    console.log(`Attempting to join private room with code: ${normalizedCode}`);
    
    // Check if room exists in Redis
    const roomInfoRaw = await redis.get(`private:room:${normalizedCode}`);
    
    if (roomInfoRaw) {
      const roomInfo = JSON.parse(roomInfoRaw);
      console.log(`Found existing room: ${roomInfo.roomId}`);
      
      // Special handling for creator joining their own room
      if (roomInfo.creatorId === userId) {
        console.log(`Creator ${username} joining their own room: ${normalizedCode}`);
      } else {
        console.log(`Player ${username} joining room created by ${roomInfo.creatorId}`);
      }
      
      // Update full room info blob with this player
      try {
        const infoKey = `private:room:${normalizedCode}:info`;
        const raw = await redis.get(infoKey);
        let blob = raw ? JSON.parse(raw) : { roomCode: normalizedCode, roomId: roomInfo.roomId, creatorId: roomInfo.creatorId, players: [], selectedProblemId: null, status: 'waiting' };
        const exists = Array.isArray(blob.players) && blob.players.some((p: any) => p.userId === userId);
        if (!exists) {
          blob.players = [...(blob.players || []), { userId, username }];
        }
        await redis.setex(infoKey, 1800, JSON.stringify(blob));
      } catch (e) {
        console.error('Failed to update joiner into room info blob:', e);
      }
      
      // Return full room info blob for immediate UI render
      const infoKey = `private:room:${normalizedCode}:info`;
      const blobRaw = await redis.get(infoKey);
      const blob = blobRaw ? JSON.parse(blobRaw) : {
        roomCode: normalizedCode,
        roomId: roomInfo.roomId,
        creatorId: roomInfo.creatorId,
        players: [{ userId, username }],
        selectedProblemId: null,
        status: 'waiting'
      };
      ctx.body = { success: true, ...blob, isCreator: blob.creatorId === userId };
    } else {
      console.log(`Room ${normalizedCode} not found`);
      ctx.status = 404;
      ctx.body = { error: 'Room not found. Please check the room code.' };
    }
  } catch (error) {
    console.error('Error joining private room:', error);
    ctx.status = 500;
    ctx.body = { error: 'Failed to join private room' };
  }
});

// Private room: get current state (players, creator)
router.get('/private/state', async (ctx) => {
  try {
    const { roomCode } = ctx.request.query as any;
    if (!roomCode) { ctx.status = 400; ctx.body = { error: 'roomCode required' }; return; }
    const redis = getRedis();
    const normalizedCode = String(roomCode).toUpperCase();
    
    const infoKey = `private:room:${normalizedCode}:info`;
    let blobRaw = await redis.get(infoKey);
    if (!blobRaw) { ctx.status = 404; ctx.body = { error: 'Room not found' }; return; }
    const blob = JSON.parse(blobRaw);
    
    // Hardening: ensure creatorId is present using base room key if missing
    if (!blob.creatorId) {
      const roomBaseRaw = await redis.get(`private:room:${normalizedCode}`);
      if (roomBaseRaw) {
        const roomBase = JSON.parse(roomBaseRaw);
        if (roomBase.creatorId) {
          blob.creatorId = roomBase.creatorId;
          await redis.setex(infoKey, 1800, JSON.stringify(blob));
          // refresh local blobRaw for consistency
          blobRaw = JSON.stringify(blob);
        }
      }
    }
    ctx.body = { success: true, role: 'creator', ...blob };
    ctx.body = { success: true, ...blob };
  } catch (error) {
    console.error('Error getting private room state:', error);
    ctx.status = 500;
    ctx.body = { error: 'Failed to get private room state' };
  }
});

// Private room: leave
router.post('/private/leave', async (ctx) => {
  try {
    const { roomCode, userId } = ctx.request.body as { roomCode: string; userId: string };
    if (!roomCode || !userId) { ctx.status = 400; ctx.body = { error: 'roomCode and userId required' }; return; }
    const redis = getRedis();
    const normalizedCode = roomCode.toUpperCase();
    
    // Remove the player from the Redis players set
    const members = await redis.smembers(`private:room:${normalizedCode}:players`);
    for (const m of members) {
      try {
        const obj = JSON.parse(m);
        if (obj && obj.userId === userId) {
          await redis.srem(`private:room:${normalizedCode}:players`, m);
        }
      } catch {}
    }
    
    ctx.body = { success: true };
  } catch (error) {
    console.error('Error leaving private room:', error);
    ctx.status = 500;
    ctx.body = { error: 'Failed to leave private room' };
  }
});

// Get available problems for selection
router.get('/problems/list', async (ctx) => {
  try {
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    
    const problems = await db.collection('problems')
      .find({ verified: true })
      .project({ 
        _id: 1, 
        title: 1, 
        difficulty: 1, 
        topics: 1 
      })
      .sort({ difficulty: 1, title: 1 })
      .toArray();
    
    ctx.body = {
      success: true,
      problems: problems.map(p => ({
        _id: p._id.toString(),
        title: p.title,
        difficulty: p.difficulty,
        topics: p.topics || []
      }))
    };
  } catch (error: any) {
    console.error('Error fetching problems:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to fetch problems' };
  }
});

// DEPRECATED: Use WebSocket connection to PrivateRoom instead
// router.get('/private/room', ...) - Removed in favor of WebSocket

// Select problem for private room (host only)
router.post('/private/select-problem', async (ctx) => {
  const { roomCode, problemId, userId } = ctx.request.body as { roomCode: string; problemId: string; userId: string };
  if (!roomCode || !problemId || !userId) { 
    ctx.status = 400; 
    ctx.body = { error: 'roomCode, problemId, and userId required' }; 
    return; 
  }
  
  const redis = getRedis();
  const roomKey = `private:room:${roomCode.toUpperCase()}`;
  const roomDataRaw = await redis.get(roomKey);
  
  if (!roomDataRaw) {
    ctx.status = 404;
    ctx.body = { error: 'Room not found or expired' };
    return;
  }
  
  const roomData = JSON.parse(roomDataRaw);
  
  // Verify user is the room creator
  if (roomData.creatorId !== userId) {
    ctx.status = 403;
    ctx.body = { error: 'Only the room creator can select problems' };
    return;
  }
  
  // Verify problem exists
  try {
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const problem = await db.collection('problems').findOne({ 
      _id: new ObjectId(problemId), 
      verified: true 
    });
    
    if (!problem) {
      ctx.status = 404;
      ctx.body = { error: 'Problem not found or not verified' };
      return;
    }
    
    // Update room with selected problem
    roomData.selectedProblemId = problemId;
    await redis.setex(roomKey, 3600, JSON.stringify(roomData));
    
    ctx.body = { 
      success: true, 
      selectedProblem: {
        _id: problem._id.toString(),
        title: problem.title,
        difficulty: problem.difficulty,
        topics: problem.topics || []
      }
    };
  } catch (error: any) {
    console.error('Error selecting problem:', error);
    ctx.status = 500;
    ctx.body = { error: 'Failed to select problem' };
  }
});

// DEPRECATED: Match starting is now handled via WebSocket in PrivateRoom
// router.post('/private/start', ...) - Removed in favor of WebSocket

router.post('/private/leave', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const { userId } = ctx.request.body as { userId: string };
  if (!userId) { 
    ctx.status = 400; 
    ctx.body = { error: 'userId required' }; 
    return; 
  }
  
  const redis = getRedis();
  const roomCode = await redis.get(`private:user:${userId}`);
  
  if (!roomCode) {
    ctx.body = { success: true };
    return;
  }
  
  const roomDataRaw = await redis.get(`private:room:${roomCode}`);
  if (roomDataRaw) {
    const roomData = JSON.parse(roomDataRaw);
    
    // Remove player from room
    roomData.players = roomData.players.filter((p: any) => p.userId !== userId);
    
    if (roomData.players.length === 0) {
      // Delete room if empty
      await redis.del(`private:room:${roomCode}`);
    } else {
      // Update room data
      await redis.setex(`private:room:${roomCode}`, 3600, JSON.stringify(roomData));
    }
  }
  
  await redis.del(`private:user:${userId}`);
  ctx.body = { success: true };
});

// Removed: /admin/create-match endpoint
// Matchmaking is now handled by backend/colyseus/workers/matchmaker.ts
// which runs automatically in the background

// Admin endpoint with stricter rate limiting
router.post('/admin/validate-solutions', adminAuthMiddleware(), async (ctx) => {
  console.log('Validation endpoint called');
  
  try {
    // Check if request body exists and is valid
    if (!ctx.request.body) {
      console.error('No request body received');
      ctx.status = 400;
      ctx.body = { error: 'No request body received' };
      return;
    }
    
    console.log('Request body size:', JSON.stringify(ctx.request.body).length);
    console.log('Request headers:', ctx.headers);
    
    const { signature, solutions, testCases, specialInputs } = ctx.request.body as {
      signature: { functionName: string; parameters: Array<{ name: string; type: string }>; returnType: string };
      solutions: { python?: string; cpp?: string; java?: string; js?: string };
      testCases: ProblemTestCase[];
      specialInputs?: SpecialInputConfig[];
    };
    
    console.log('Parsed data:', {
      signature: signature ? 'present' : 'missing',
      solutions: solutions ? 'present' : 'missing',
      testCases: testCases ? `present (${testCases.length} cases)` : 'missing'
    });
    
    if (!signature || !solutions || !testCases) {
      console.error('Missing required fields:', {
        signature: !!signature,
        solutions: !!solutions,
        testCases: !!testCases
      });
      ctx.status = 400;
      ctx.body = { 
        error: 'signature, solutions, and testCases required',
        received: {
          signature: !!signature,
          solutions: !!solutions,
          testCases: !!testCases
        }
      };
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

      console.log('Starting validation process...');
      const preparedTestCases = prepareTestCasesForExecution(
        testCases,
        specialInputs || []
      );
      console.log('Test cases count:', preparedTestCases.length);
      console.log('Solutions available:', Object.keys(solutions));

      for (const [langKey, langValue] of Object.entries(languageMap)) {
      const solution = solutions[langKey as keyof typeof solutions];
      
      if (!solution) {
        verificationErrors.push(`Missing solution for ${langKey}`);
        continue;
      }

      if (langKey === 'cpp') {
        console.log('C++ solution snippet:', solution.slice(0, 200));
      }

      try {
        console.log(`Starting verification for ${langKey}...`);
        const validationResult = await executeAllTestCases(
          langValue,
          solution,
          signature,
          preparedTestCases
        );

        verificationResults[langKey] = {
          allPassed: validationResult.allPassed,
          totalTests: validationResult.totalTests,
          passedTests: validationResult.passedTests,
          failedTests: validationResult.failedTests,
          results: validationResult.results, // Include detailed test results
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
        console.log(`Completed verification for ${langKey}`);
      } catch (error: any) {
        console.error(`Error verifying ${langKey}:`, error);
        console.error(`Error stack:`, error.stack);
        verificationErrors.push(`${langKey} verification error: ${error.message}`);
      }
    }

    if (verificationErrors.length > 0) {
      console.log('Verification failed, sending results:', JSON.stringify(verificationResults, null, 2));
      ctx.status = 200; // Change to 200 so frontend can process the results
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
      console.error('Validation process error:', error);
      console.error('Error stack:', error.stack);
      console.error('Error message:', error.message);
      ctx.status = 500;
      ctx.body = { 
        error: 'Internal validation error', 
        message: error.message,
        stack: error.stack // Include stack trace for debugging
      };
    }
  } catch (error: any) {
    console.error('Validation endpoint error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error message:', error.message);
    ctx.status = 500;
    ctx.body = { 
      error: 'Request processing error', 
      message: error.message,
      stack: error.stack // Include stack trace for debugging
    };
  }
});

// Bot Management Endpoints

router.post('/admin/bots/init', adminAuthMiddleware(), async (ctx) => {
  try {
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    
    // Check if bots collection exists
    const collections = await db.listCollections({ name: 'bots' }).toArray();
    if (collections.length > 0) {
      ctx.body = { success: true, message: 'Bots collection already exists' };
      return;
    }
    
    // Create the collection with validation
    // NOTE: deployed status is tracked in Redis (bots:deployed set), not MongoDB
    await db.createCollection('bots', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['fullName', 'username', 'avatar', 'gender', 'stats', 'matchIds', 'createdAt', 'updatedAt'],
          properties: {
            fullName: {
              bsonType: 'string',
              minLength: 1,
              maxLength: 100,
              description: 'Full name is required'
            },
            username: {
              bsonType: 'string',
              minLength: 1,
              maxLength: 50,
              description: 'Username is required'
            },
            avatar: {
              bsonType: 'string',
              description: 'Avatar URL is required'
            },
            gender: {
              enum: ['male', 'female'],
              description: 'Gender must be male or female'
            },
            stats: {
              bsonType: 'object',
              required: ['rating', 'wins', 'losses', 'draws', 'totalMatches'],
              properties: {
                rating: { bsonType: 'number', minimum: 0 },
                wins: { bsonType: 'number', minimum: 0 },
                losses: { bsonType: 'number', minimum: 0 },
                draws: { bsonType: 'number', minimum: 0 },
                totalMatches: { bsonType: 'number', minimum: 0 }
              }
            },
            matchIds: {
              bsonType: 'array',
              description: 'Array of match IDs'
            },
            createdAt: {
              bsonType: 'date',
              description: 'Created date'
            },
            updatedAt: {
              bsonType: 'date',
              description: 'Updated date'
            }
          }
        }
      }
    });
    
    // Create indexes (deployed status is in Redis, not indexed here)
    const bots = db.collection('bots');
    await bots.createIndex({ 'stats.rating': 1 });
    await bots.createIndex({ username: 1 }, { unique: true });
    
    ctx.body = {
      success: true,
      message: 'Bots collection created successfully with validation and indexes'
    };
  } catch (error: any) {
    console.error('Error initializing bots collection:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to initialize bots collection' };
  }
});

router.get('/admin/bots', adminAuthMiddleware(), async (ctx) => {
  try {
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const bots = db.collection('bots');
    
    const allBots = await bots.find({}).sort({ createdAt: -1 }).toArray();

    // Overlay real-time deployment state from Redis so the admin UI reflects actual bot status
    const redis = getRedis();
    const [deployedIds, activeIds, matchActiveIds] = await Promise.all([
      redis.smembers(RedisKeys.botsDeployedSet),
      redis.smembers(RedisKeys.botsActiveSet),
      getBotsInActiveMatches(redis),
    ]);
    const deployedSet = new Set(deployedIds);
    const activeSet = new Set(activeIds);
    const matchActiveSet = new Set(matchActiveIds);

    const botsWithRealtimeState = allBots.map((bot) => {
      const botId = bot._id.toString();
      const isActive = activeSet.has(botId) || matchActiveSet.has(botId);
      const isDeployed = deployedSet.has(botId) || isActive;
      // Bot is considered "deployed" if it's in deployed set OR active set (in a match)
      return {
        ...bot,
        deployed: isDeployed,
        active: isActive,
      };
    });
    
    ctx.body = {
      success: true,
      bots: botsWithRealtimeState
    };
  } catch (error: any) {
    console.error('Error fetching bots:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to fetch bots' };
  }
});

router.post('/admin/bots/generate', adminAuthMiddleware(), async (ctx) => {
  try {
    const { count, gender, rating = 1200 } = ctx.request.body as { count: number; gender?: 'male' | 'female' | 'random'; rating?: number };
    
    if (!count || count < 1 || count > 50) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Count must be between 1 and 50' };
      return;
    }

    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const bots = db.collection('bots');
    
    // Ensure the bots collection exists (it should be created via /admin/bots/init)
    const collections = await db.listCollections({ name: 'bots' }).toArray();
    if (collections.length === 0) {
      console.log('Bots collection does not exist. Please run /admin/bots/init first.');
      ctx.status = 400;
      ctx.body = { 
        success: false, 
        error: 'Bots collection not initialized. Please run /admin/bots/init first.' 
      };
      return;
    }
    
    // Generate OpenAI profiles
    const profiles = await generateBotProfiles(count, gender);
    
    // Create bot documents
    const botDocs: any[] = [];
    for (let i = 0; i < count; i++) {
      const profile = profiles[i];
      
      const botDoc = {
        fullName: profile.fullName,
        username: profile.username,
        avatar: 'placeholder_avatar.png', // Will be updated with generated avatar
        gender: profile.gender === 'male' || profile.gender === 'female' || profile.gender === 'nonbinary' ? profile.gender : 'male', // Ensure valid gender
        stats: {
          rating,
          wins: 0,
          losses: 0,
          draws: 0,
          totalMatches: 0
        },
        matchIds: [], // Initialize empty array for match history
        // NOTE: deployed status is tracked in Redis (bots:deployed set), not MongoDB
        createdAt: new Date(),
        updatedAt: new Date()
      };
      botDocs.push(botDoc);
    }
    
    // Validate bot documents before insertion
    console.log(`Validating ${botDocs.length} bot documents...`);
    for (let i = 0; i < botDocs.length; i++) {
      const botDoc = botDocs[i];
      console.log(`Validating bot ${i + 1}:`, {
        fullName: botDoc.fullName,
        username: botDoc.username,
        gender: botDoc.gender,
        hasStats: !!botDoc.stats,
        hasMatchIds: Array.isArray(botDoc.matchIds),
        hasDates: !!(botDoc.createdAt && botDoc.updatedAt)
      });
      
      if (!botDoc.fullName || !botDoc.username || !botDoc.avatar || !botDoc.gender || !botDoc.stats || !Array.isArray(botDoc.matchIds) || !botDoc.createdAt || !botDoc.updatedAt) {
        throw new Error(`Invalid bot document ${i + 1}: ${JSON.stringify(botDoc)}`);
      }
    }
    
    // Log the exact documents being inserted for debugging
    console.log('Documents to be inserted:', JSON.stringify(botDocs, null, 2));
    
    // Insert bots
    const result = await bots.insertMany(botDocs);
    
    // Generate avatars asynchronously
    const botDocsWithIds = Object.values(result.insertedIds).map((id, index) => ({
      _id: id,
      gender: botDocs[index].gender
    }));
    generateBotAvatars(botDocsWithIds).catch(err => console.error('Avatar generation failed:', err));
    
    // Add newly created bots to rotation queue
    const redis = getRedis();
    const newBotIds = Object.keys(result.insertedIds).map(key => result.insertedIds[parseInt(key)].toString());
    
    try {
      // Update totalBots count in rotation config
      const totalBotsNow = await bots.countDocuments({});
      await redis.hset(RedisKeys.botsRotationConfig, 'totalBots', totalBotsNow.toString());
      
      // Add new bots to rotation queue
      for (const botId of newBotIds) {
        await redis.rpush(RedisKeys.botsRotationQueue, botId);
      }
      console.log(`Added ${newBotIds.length} new bots to rotation queue`);
      
      // Trigger deployment check via pub/sub to deploy if below minimum
      await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({
        type: 'checkDeployment',
        reason: 'new_bots_created',
        count: newBotIds.length
      }));
      console.log(`Notified bot service of ${newBotIds.length} new bots`);
    } catch (redisError) {
      console.error('Failed to add bots to rotation queue:', redisError);
      // Continue - bots are created in MongoDB, they can be added to rotation manually
    }
    
    ctx.body = {
      success: true,
      message: `Generated ${count} bots successfully and added to rotation queue`,
      botIds: newBotIds
    };
  } catch (error: any) {
    console.error('Error generating bots:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      writeErrors: error.writeErrors,
      errorResponse: error.errorResponse
    });
    
    // Log detailed validation errors if available
    if (error.writeErrors && error.writeErrors.length > 0) {
      console.error('Detailed write errors:');
      error.writeErrors.forEach((writeError: any, index: number) => {
        console.error(`Write error ${index}:`, {
          code: writeError.code,
          errmsg: writeError.errmsg,
          errInfo: writeError.errInfo
        });
      });
    }
    
    ctx.status = 500;
    ctx.body = { 
      success: false, 
      error: 'Failed to generate bots',
      details: error.message
    };
  }
});

router.post('/admin/bots/deploy', adminAuthMiddleware(), async (ctx) => {
  try {
    const { botIds, deploy } = ctx.request.body as { botIds: string[]; deploy: boolean };
    
    const redis = getRedis();
    
    // Deployed status is tracked in Redis only (bots:deployed set)
    if (deploy) {
      // Add to Redis deployed set
      for (const botId of botIds) {
        await redis.sadd(RedisKeys.botsDeployedSet, botId);
      }
      
      // Notify bot service to start cycles
      await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ type: 'deploy' }));
    } else {
      // Remove from deployed set
      for (const botId of botIds) {
        await redis.srem(RedisKeys.botsDeployedSet, botId);
      }
      
      // Notify bot service to stop specific bots
      await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ 
        type: 'stop', 
        botIds 
      }));
    }
    
    ctx.body = {
      success: true,
      message: `${deploy ? 'Deployed' : 'Stopped'} ${botIds.length} bots`
    };
  } catch (error: any) {
    console.error('Error deploying bots:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to deploy bots' };
  }
});

router.put('/admin/bots/:id', adminAuthMiddleware(), async (ctx) => {
  try {
    const botId = ctx.params.id;
    const updates = ctx.request.body;
    
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const bots = db.collection('bots');
    
    const result = await bots.updateOne(
      { _id: new ObjectId(botId) },
      { 
        $set: { 
          ...(updates as any),
          updatedAt: new Date()
        }
      }
    );
    
    if (result.matchedCount === 0) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Bot not found' };
      return;
    }
    
    ctx.body = {
      success: true,
      message: 'Bot updated successfully'
    };
  } catch (error: any) {
    console.error('Error updating bot:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to update bot' };
  }
});

router.delete('/admin/bots/:id', adminAuthMiddleware(), async (ctx) => {
  try {
    const botId = ctx.params.id;
    
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const bots = db.collection('bots');
    const users = db.collection('users');
    const redis = getRedis();
    
    // Get bot info before deletion
    const bot = await bots.findOne({ _id: new ObjectId(botId) });
    
    if (!bot) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Bot not found' };
      return;
    }
    
    const botIdStr = bot._id.toString();
    
    // 1. Check if bot is in an active match - end it with opponent winning
    const currentMatchId = await redis.get(`bot:current_match:${botIdStr}`);
    let matchEnded = false;
    if (currentMatchId) {
      console.log(`Bot ${botIdStr} is in active match ${currentMatchId}, ending match with opponent winning`);
      
      // Get match data to find opponent and roomId
      const matchBlob = await redis.get(RedisKeys.matchKey(currentMatchId));
      if (matchBlob) {
        try {
          const matchData = JSON.parse(matchBlob);
          const playerIds = matchData.playerIds || [];
          const opponentId = playerIds.find((id: string) => id !== botIdStr);
          const roomId = matchData.roomId;
          
          if (opponentId && roomId) {
            // Try to end the match directly via matchMaker
            try {
              const room = await matchMaker.getRoomById(roomId);
              if (room && room.roomName === 'match') {
                const matchRoom = room as any;
                if (typeof matchRoom.endMatch === 'function') {
                  // End match with opponent as winner (bot_deleted reason)
                  await matchRoom.endMatch(`winner_${opponentId}`);
                  matchEnded = true;
                  console.log(`Ended match ${currentMatchId} with opponent ${opponentId} as winner (bot deleted)`);
                }
              }
            } catch (roomErr) {
              console.warn(`Failed to end match via room:`, roomErr);
              // Fallback: publish event for any listeners
              await redis.publish(
                RedisKeys.matchEventsChannel,
                JSON.stringify({
                  type: 'force_end_match',
                  matchId: currentMatchId,
                  winnerUserId: opponentId,
                  reason: 'bot_deleted',
                  deletedBotId: botIdStr
                })
              );
            }
          }
        } catch (parseErr) {
          console.warn(`Failed to parse match blob for ${currentMatchId}:`, parseErr);
        }
      }
    }
    
    // 2. Remove bot from ELO matchmaking queue
    await redis.zrem(RedisKeys.eloQueue, botIdStr);
    await redis.del(RedisKeys.queueJoinedAtKey(botIdStr));
    console.log(`Removed bot ${botIdStr} from matchmaking queue`);
    
    // 3. Clean up all Redis state for this bot
    await redis.srem(RedisKeys.botsActiveSet, botIdStr);
    await redis.srem(RedisKeys.botsDeployedSet, botIdStr);
    await redis.lrem(RedisKeys.botsRotationQueue, 0, botIdStr);
    await redis.del(`bot:current_match:${botIdStr}`);
    await redis.del(RedisKeys.botStateKey(botIdStr));
    await redis.del(`queue:reservation:${botIdStr}`);
    console.log(`Cleaned up Redis state for bot ${botIdStr}`);
    
    // 4. Delete orphaned user document with this bot's ID (if exists)
    try {
      const orphanResult = await users.deleteOne({ _id: new ObjectId(botId) });
      if (orphanResult.deletedCount > 0) {
        console.log(`Deleted orphaned user document for bot ${botIdStr}`);
      }
    } catch (orphanErr) {
      console.warn(`Failed to check/delete orphaned user document:`, orphanErr);
    }
    
    // 5. Delete the bot from bots collection
    const result = await bots.deleteOne({ _id: new ObjectId(botId) });
    
    // 6. Clean up avatar file from MinIO/S3
    if (bot.avatar) {
      await deleteBotAvatar(bot.avatar);
    }
    
    // 7. Update totalBots count in rotation config
    const totalBotsNow = await bots.countDocuments({});
    await redis.hset(RedisKeys.botsRotationConfig, 'totalBots', totalBotsNow.toString());
    
    // 8. Clear leaderboard cache (bots appear in leaderboard)
    const leaderboardKeys = await scanRedisKeys(redis, 'leaderboard:*');
    if (leaderboardKeys.length > 0) {
      await redis.del(...leaderboardKeys);
      console.log(`Cleared ${leaderboardKeys.length} leaderboard cache entries`);
    }
    
    // 9. Notify bot service that a bot was deleted
    await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({
      type: 'botDeleted',
      botId: botIdStr
    }));
    
    ctx.body = {
      success: true,
      message: 'Bot deleted successfully',
      details: {
        wasInMatch: !!currentMatchId,
        matchEnded: matchEnded,
        matchId: currentMatchId || null,
        leaderboardCacheCleared: leaderboardKeys.length
      }
    };
  } catch (error: any) {
    console.error('Error deleting bot:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to delete bot' };
  }
});

router.post('/admin/bots/reset', adminAuthMiddleware(), async (ctx) => {
  try {
    const { resetType = 'stats' } = ctx.request.body as { resetType?: 'stats' | 'all' };
    
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const bots = db.collection('bots');
    const redis = getRedis();
    
    if (resetType === 'all') {
      // Get all bots with avatars before deletion
      const botsWithAvatars = await bots.find({}).toArray();
      
      // Clean up avatar files from MinIO/S3
      for (const bot of botsWithAvatars) {
        if (bot.avatar) {
          await deleteBotAvatar(bot.avatar);
        }
      }
      
      // Delete all bots and clear Redis
      await bots.deleteMany({});
      await redis.del(RedisKeys.botsActiveSet);
      await redis.del(RedisKeys.botsDeployedSet);
      await redis.del(RedisKeys.botsRotationQueue);
      
      // Update totalBots count to 0
      await redis.hset(RedisKeys.botsRotationConfig, 'totalBots', '0');
    } else {
      // Reset stats only
      await bots.updateMany({}, {
        $set: {
          'stats.rating': 1200,
          'stats.wins': 0,
          'stats.losses': 0,
          'stats.draws': 0,
          'stats.totalMatches': 0,
          matchIds: [], // Reset match history
          updatedAt: new Date()
        }
      });
      
      // Clear Redis sets (deployed status is tracked in Redis)
      await redis.del(RedisKeys.botsActiveSet);
      await redis.del(RedisKeys.botsDeployedSet);
      
      // Notify bot service to stop all bots
      await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ type: 'stop' }));
    }
    
    ctx.body = {
      success: true,
      message: `Bot data ${resetType === 'all' ? 'deleted' : 'reset'} successfully`
    };
  } catch (error: any) {
    console.error('Error resetting bot data:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to reset bot data' };
  }
});

// Cleanup orphaned user records (users without usernames that appear on leaderboard)
router.post('/admin/users/cleanup-orphans', adminAuthMiddleware(), async (ctx) => {
  try {
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const users = db.collection('users');
    const redis = getRedis();
    
    // Find users with stats.totalMatches > 0 but no username (orphaned records)
    const orphanedUsers = await users.find({
      'stats.totalMatches': { $gt: 0 },
      $or: [
        { username: { $exists: false } },
        { username: null },
        { username: '' }
      ]
    }).toArray();
    
    if (orphanedUsers.length === 0) {
      ctx.body = { success: true, message: 'No orphaned user records found', deletedCount: 0 };
      return;
    }
    
    // Log what we're about to delete
    console.log(`Found ${orphanedUsers.length} orphaned user records:`, 
      orphanedUsers.map(u => ({ _id: u._id.toString(), rating: u.stats?.rating, totalMatches: u.stats?.totalMatches }))
    );
    
    // Delete orphaned records
    const deleteResult = await users.deleteMany({
      _id: { $in: orphanedUsers.map(u => u._id) }
    });
    
    // Clear leaderboard cache
    const leaderboardKeys = await scanRedisKeys(redis, 'leaderboard:*');
    if (leaderboardKeys.length > 0) {
      await redis.del(...leaderboardKeys);
      console.log(`Cleared ${leaderboardKeys.length} leaderboard cache entries`);
    }
    
    ctx.body = {
      success: true,
      message: `Deleted ${deleteResult.deletedCount} orphaned user record(s)`,
      deletedCount: deleteResult.deletedCount,
      deletedIds: orphanedUsers.map(u => u._id.toString()),
      leaderboardCacheCleared: leaderboardKeys.length
    };
  } catch (error: any) {
    console.error('Error cleaning up orphaned users:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to cleanup orphaned users' };
  }
});

// Cleanup stale bot entries from botsActiveSet and invalid matches from activeMatchesSet
router.post('/admin/bots/cleanup-stale', adminAuthMiddleware(), async (ctx) => {
  try {
    const redis = getRedis();
    const activeBots = await redis.smembers(RedisKeys.botsActiveSet);
    const activeMatchIds = await redis.smembers(RedisKeys.activeMatchesSet);
    const activeMatchIdsSet = new Set(activeMatchIds);
    
    const cleanedBots: string[] = [];
    const keptBots: string[] = [];
    const cleanedMatches: string[] = [];
    
    // First, clean up matches that don't have match blobs or are finished
    for (const matchId of activeMatchIds) {
      const matchKey = RedisKeys.matchKey(matchId);
      const matchRaw = await redis.get(matchKey);
      
      if (!matchRaw) {
        // Match blob doesn't exist - remove from active set
        await redis.srem(RedisKeys.activeMatchesSet, matchId);
        cleanedMatches.push(matchId);
        console.log(`Cleaned up match without blob: ${matchId}`);
        continue;
      }
      
      const matchData = JSON.parse(matchRaw);
      if (matchData.status === 'finished' || matchData.endedAt) {
        // Match is finished - remove from active set
        await redis.srem(RedisKeys.activeMatchesSet, matchId);
        cleanedMatches.push(matchId);
        console.log(`Cleaned up finished match: ${matchId}`);
      }
    }
    
    // Update activeMatchIdsSet after cleaning
    const remainingMatchIds = await redis.smembers(RedisKeys.activeMatchesSet);
    const remainingMatchIdsSet = new Set(remainingMatchIds);
    
    // Now clean up stale bot entries
    for (const botId of activeBots) {
      // Check if bot has a current match pointer
      const currentMatchId = await redis.get(`bot:current_match:${botId}`);
      
      if (currentMatchId && remainingMatchIdsSet.has(currentMatchId)) {
        // Verify the match blob exists and has this bot as a player
        const matchKey = RedisKeys.matchKey(currentMatchId);
        const matchRaw = await redis.get(matchKey);
        
        if (matchRaw) {
          const matchData = JSON.parse(matchRaw);
          const playerIds = Object.keys(matchData.players || {});
          
          if (playerIds.includes(botId) && matchData.status !== 'finished' && !matchData.endedAt) {
            // Bot is in a valid active match
            keptBots.push(botId);
            continue;
          }
        }
      }
      
      // Bot doesn't have a valid active match - remove from active set
      await redis.srem(RedisKeys.botsActiveSet, botId);
      await redis.del(`bot:current_match:${botId}`);
      cleanedBots.push(botId);
      console.log(`Cleaned up stale bot entry: ${botId}`);
    }
    
    ctx.body = {
      success: true,
      cleanedBotsCount: cleanedBots.length,
      keptBotsCount: keptBots.length,
      cleanedMatchesCount: cleanedMatches.length,
      cleanedBots,
      keptBots,
      cleanedMatches
    };
  } catch (error: any) {
    console.error('Error cleaning up stale bot entries:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'Failed to clean up stale bot entries' };
  }
});

router.get('/admin/matches/active', adminAuthMiddleware(), async (ctx) => {
  try {
    const redis = getRedis();
    const activeMatchIds = await redis.smembers(RedisKeys.activeMatchesSet);

    if (activeMatchIds.length === 0) {
      ctx.body = { success: true, matches: [] };
      return;
    }

    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const usersCollection = db.collection('users');
    const botsCollection = db.collection('bots');
    const problemsCollection = db.collection('problems');

    const matches: any[] = [];

    for (const matchId of activeMatchIds) {
      try {
        const matchRaw = await redis.get(RedisKeys.matchKey(matchId));
        if (!matchRaw) {
          continue;
        }

        const matchData = JSON.parse(matchRaw);

        if (matchData.status === 'finished' || matchData.endedAt) {
          continue;
        }

        let problemTitle = 'Unknown Problem';
        let difficulty: 'Easy' | 'Medium' | 'Hard' = 'Medium';

        if (matchData.problem) {
          problemTitle = matchData.problem.title || problemTitle;
          const diff = matchData.problem.difficulty || difficulty;
          difficulty = (diff === 'Easy' || diff === 'Medium' || diff === 'Hard') ? diff : difficulty;
        } else if (matchData.problemId) {
          try {
            const problemDoc = await problemsCollection.findOne({ _id: new ObjectId(matchData.problemId) }, { projection: { title: 1, difficulty: 1 } });
            if (problemDoc) {
              problemTitle = problemDoc.title || problemTitle;
              const diff = problemDoc.difficulty || difficulty;
              difficulty = (diff === 'Easy' || diff === 'Medium' || diff === 'Hard') ? diff : difficulty;
            }
          } catch (error) {
            console.warn(`Failed to load problem ${matchData.problemId}:`, error);
          }
        }

        const players: any[] = [];
        const playerEntries = matchData.players || {};
        const playerIds = Array.isArray(playerEntries) ? playerEntries : Object.keys(playerEntries);

        for (const playerId of playerIds) {
          const defaultInfo = {
            userId: playerId,
            username: playerEntries[playerId]?.username || playerId,
            isBot: false,
            rating: 1200,
            linesWritten: matchData.linesWritten?.[playerId] || 0,
            avatar: undefined,
            botCompletionInfo: matchData.botCompletionTimes?.[playerId] || null,
          };

          try {
            if (ObjectId.isValid(playerId)) {
              const userDoc = await usersCollection.findOne({ _id: new ObjectId(playerId) }, { projection: { username: 1, 'profile.avatar': 1, 'stats.rating': 1 } });
              if (userDoc) {
                players.push({
                  ...defaultInfo,
                  username: userDoc.username || defaultInfo.username,
                  rating: userDoc.stats?.rating || defaultInfo.rating,
                  avatar: userDoc.profile?.avatar || defaultInfo.avatar,
                });
                continue;
              }

              const botDoc = await botsCollection.findOne({ _id: new ObjectId(playerId) }, { projection: { username: 1, avatar: 1, 'stats.rating': 1 } });
              if (botDoc) {
                players.push({
                  ...defaultInfo,
                  username: botDoc.username || defaultInfo.username,
                  isBot: true,
                  avatar: botDoc.avatar || defaultInfo.avatar,
                  rating: botDoc.stats?.rating || defaultInfo.rating,
                });
                continue;
              }
            }
          } catch (error) {
            console.warn(`Failed to enrich player ${playerId} for match ${matchId}:`, error);
          }

          players.push(defaultInfo);
        }

        const startTime = matchData.startedAt ? new Date(matchData.startedAt).getTime() : Date.now();
        const now = Date.now();
        const timeElapsed = now - startTime;
        const maxDuration = 45 * 60 * 1000;
        const timeRemaining = Math.max(0, maxDuration - timeElapsed);

        const submissions = (matchData.submissions || []).map((submission: any) => ({
          userId: submission.userId,
          timestamp: submission.timestamp,
          passed: submission.passed,
          language: submission.language,
        }));

        matches.push({
          matchId,
          problemId: matchData.problemId,
          problemTitle,
          difficulty,
          players,
          status: matchData.status || 'ongoing',
          startedAt: matchData.startedAt || new Date(startTime).toISOString(),
          timeElapsed,
          timeRemaining,
          submissions,
        });
      } catch (error) {
        console.warn(`Failed to process active match ${matchId}:`, error);
      }
    }

    ctx.body = { success: true, matches };
  } catch (error) {
    console.error('Error fetching active matches:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch active matches',
      matches: [],
    };
  }
});

// Force a bot to win a match instantly
router.post('/admin/matches/:matchId/force-bot-win', adminAuthMiddleware(), async (ctx) => {
  try {
    const matchId = ctx.params.matchId;
    const { botUserId } = ctx.request.body as { botUserId: string };

    if (!matchId || !botUserId) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'matchId and botUserId are required' };
      return;
    }

    const redis = getRedis();
    const matchKey = RedisKeys.matchKey(matchId);
    const matchRaw = await redis.get(matchKey);

    if (!matchRaw) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Match not found' };
      return;
    }

    const matchData = JSON.parse(matchRaw);

    // Check if match is already finished
    if (matchData.status === 'finished' || matchData.endedAt) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Match is already finished' };
      return;
    }

    // Validate botUserId is actually a bot
    const isBot = await isBotUser(botUserId);
    if (!isBot) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'User is not a bot' };
      return;
    }

    // Validate bot is in the match
    const playerEntries = matchData.players || {};
    const playerIds = Array.isArray(playerEntries) ? playerEntries : Object.keys(playerEntries);
    if (!playerIds.includes(botUserId)) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Bot is not a player in this match' };
      return;
    }

    // Get roomId from match blob
    const roomId = matchData.roomId;
    if (!roomId) {
      ctx.status = 500;
      ctx.body = { success: false, error: 'Room ID not found in match data' };
      return;
    }

    // Get the room instance
    try {
      const room = await matchMaker.getRoomById(roomId);
      if (!room) {
        ctx.status = 404;
        ctx.body = { success: false, error: 'Match room not found (may have been disposed)' };
        return;
      }

      // Verify this is a MatchRoom instance
      if (room.roomName !== 'match') {
        ctx.status = 500;
        ctx.body = { success: false, error: 'Room is not a match room' };
        return;
      }

      // Call endMatch with winner reason
      // Note: endMatch is private, but we can access it via type assertion
      const matchRoom = room as any;
      if (typeof matchRoom.endMatch === 'function') {
        await matchRoom.endMatch(`winner_${botUserId}`);
        ctx.body = { success: true, message: `Bot ${botUserId} has been forced to win match ${matchId}` };
      } else {
        ctx.status = 500;
        ctx.body = { success: false, error: 'Unable to end match - endMatch method not found' };
      }
    } catch (roomError: any) {
      console.error('Error accessing match room:', roomError);
      ctx.status = 500;
      ctx.body = { 
        success: false, 
        error: `Failed to access match room: ${roomError.message || 'Unknown error'}` 
      };
    }
  } catch (error: any) {
    console.error('Error forcing bot win:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to force bot win',
    };
  }
});

router.get('/match/data', async (ctx) => {
  const matchId = ctx.request.query.matchId as string | undefined;
  const userId = ctx.request.query.userId as string | undefined;

  if (!matchId || !userId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'matchId_and_userId_required' };
    return;
  }

  try {
    const redis = getRedis();
    const matchKey = RedisKeys.matchKey(matchId);
    const matchRaw = await redis.get(matchKey);

    if (!matchRaw) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'match_not_found' };
      return;
    }

    const matchData = JSON.parse(matchRaw);
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const usersCollection = db.collection('users');
    const botsCollection = db.collection('bots');
    const problemsCollection = db.collection('problems');

    // Determine opponent ID
    const playerEntries = matchData.players || {};
    const playerIds: string[] = Array.isArray(playerEntries)
      ? playerEntries
      : Object.keys(playerEntries);

    const opponentUserId = playerIds.find((id) => id !== userId) || playerIds[0];

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

    opponentUsername = identity.username;
    opponentName = identity.fullName;
    opponentAvatar = identity.avatar;

    // Sanitize problem data
    let problem = matchData.problem;
    if (!problem && matchData.problemId) {
      try {
        const problemDoc = await problemsCollection.findOne(
          { _id: new ObjectId(matchData.problemId) },
          {
            projection: {
              title: 1,
              description: 1,
              difficulty: 1,
              topics: 1,
              signature: 1,
              starterCode: 1,
              examples: 1,
              constraints: 1,
              testCases: 0,
              solutions: 0,
              testCasesCount: 1,
            },
          }
        );
        if (problemDoc) {
          problem = {
            _id: problemDoc._id,
            title: problemDoc.title,
            description: problemDoc.description,
            difficulty: problemDoc.difficulty,
            topics: problemDoc.topics,
            signature: problemDoc.signature,
            starterCode: problemDoc.starterCode,
            examples: problemDoc.examples,
            constraints: problemDoc.constraints,
            testCasesCount: problemDoc.testCasesCount,
          };
        }
      } catch (error) {
        console.warn(`Failed to load problem ${matchData.problemId}:`, error);
      }
    } else if (problem) {
      const { testCases, solutions, ...sanitized } = problem;
      problem = sanitized;
    }

    // Ensure starter code exists
    if (problem && !problem.starterCode && matchData.problem?.starterCode) {
      problem.starterCode = matchData.problem.starterCode;
    }

    const opponentData = {
      userId: opponentUserId,
      username: opponentUsername,
      name: opponentName,
      avatar: opponentAvatar,
      globalRank: opponentStats.globalRank ?? 1234,
      gamesWon: opponentStats.wins ?? 0,
      winRate: opponentStats.totalMatches > 0
        ? Math.round(((opponentStats.wins ?? 0) / opponentStats.totalMatches) * 100)
        : 0,
      rating: opponentStats.rating ?? 1200,
    };

    ctx.body = {
      success: true,
      matchId,
      problem,
      opponent: opponentData,
      userStats,
    };
  } catch (error) {
    console.error('Error fetching match data:', error);
    ctx.status = 500;
    ctx.body = { success: false, error: 'failed_to_fetch_match_data' };
  }
});

// Helper functions for bot generation

async function deleteBotAvatar(avatarUrl: string): Promise<void> {
  try {
    // Skip deletion for placeholder avatars
    if (!avatarUrl || 
        avatarUrl.includes('/api/placeholder') || 
        avatarUrl.includes('/placeholder_avatar.png') ||
        avatarUrl.startsWith('/')) {
      return;
    }

    // Extract filename from avatar URL
    let fileName = avatarUrl;
    if (avatarUrl.includes('/')) {
      fileName = avatarUrl.split('/').pop() || avatarUrl;
    }

    // Delete from MinIO/S3
    const deleteParams = {
      Bucket: process.env.S3_BUCKET_NAME || 'codeclashers-avatars',
      Key: fileName
    };

    // await s3.deleteObject(deleteParams).promise(); // Commented out for now
    console.log(`Deleted avatar file: ${fileName}`);
  } catch (error) {
    console.warn(`Failed to delete avatar ${avatarUrl}:`, error);
    // Don't throw error - avatar cleanup failure shouldn't prevent bot deletion
  }
}

async function generateBotProfiles(count: number, gender?: 'male' | 'female' | 'random') {
  try {
    const genderText = gender && gender !== 'random' ? gender : 'random';
    const prompt = `Generate ${count} user profiles for a competitive coding platform. These should feel like REAL people scraped from an actual leaderboard—messy, inconsistent, human.

**FULL NAMES (display names):**
These are what people set as their visible name. Real platforms have:
- Actual full names with global diversity: "Priya Sharma", "Marcus Oyelaran", "김지훈", "Fatima Al-Hassan", "João Pedro Silva", "Yuki Tanaka", "Oluwaseun Adebayo"
- Mixed heritage names that reflect real demographics: "Emily Nakamura", "Carlos Wei", "Aisha Johnson"
- Single names or nicknames used as display names: "Dex", "Mango", "just kevin"
- Lowercase or stylized names: "alex t.", "ryan !!!", "diana 🌙"
- Names that are clearly usernames used as display names: "coolcat2003", "notarobot"
- Occasional joke names: "Two Raccoons in a Trenchcoat", "Error 404"

**USERNAMES (handles):**
These are @handles. Real ones look like:
- Birth year suffixes: priya98, marcusO2001, jlee_99, fatima2k5
- Keyboard laziness: thiago__, kev1n, _yuki, jao.pedro
- Old childhood usernames that stuck: xXdragonslayerXx, sk8rboi, coolgamer123
- Professional-ish: psharm, m.oyelaran, jtanaka
- Random words + numbers: bluetiger47, mangolover, codebean99
- Typos and abbreviations: jshn, prvya, mrcus_, emmyK
- Inside jokes that make no sense: crunchwrap, notbread, fishleg
- Minimal: jh, pt99, rx, mei_

**CRITICAL REALISM RULES:**
- NO fantasy/epic compound words (ShadowFlame, NightStorm, CyberWolf, TechNinja)
- NO overly clean camelCase (DataWizard, CodeMaster, ByteRunner)
- Usernames should look TYPED not DESIGNED—lowercase preferred, occasional typos
- Global representation: include names from India, Nigeria, Brazil, Japan, Korea, Middle East, Europe, Latin America, Southeast Asia
- Some should look like they haven't changed their username since 2012
- Variety in "effort level"—some people care, some clearly don't

Gender distribution: ${genderText}

Return ONLY a JSON array, no markdown:
[{"fullName": "...", "username": "...", "gender": "male"}, ...]`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    // Parse the JSON response
    const profiles = JSON.parse(response);
    
    // Validate and sanitize the profiles
    return profiles.map((profile: any) => ({
      ...profile,
      gender: profile.gender === 'male' || profile.gender === 'female' ? profile.gender : 'male'
    }));
  } catch (error) {
    console.error('OpenAI profile generation failed, using fallback:', error);
    
    // Fallback to mock data
    const profiles: { fullName: string; username: string; gender: 'male' | 'female' }[] = [];
    const genders: ('male' | 'female')[] = (gender && gender !== 'random') ? [gender] : ['male', 'female'];
    
    for (let i = 0; i < count; i++) {
      const selectedGender = genders[i % genders.length];
      const mockNames: Record<'male' | 'female', string[]> = {
        male: [
          'Alex Chen', 'Sam Johnson', 'Jordan Smith', 'Casey Brown', 'Taylor Davis',
          'Ryan Martinez', 'Chris Wilson', 'Drew Anderson', 'Jamie Garcia', 'Blake Taylor',
          'Aiden Kim', 'Cameron Lee', 'Dakota Brown', 'Hayden White', 'Logan Davis',
          'Morgan Cooper', 'Parker Johnson', 'Quinn Miller', 'Riley Thompson', 'Sage Wilson',
          'River Chen', 'Phoenix Johnson', 'Blake Smith', 'Emery Davis', 'Rowan Kim'
        ],
        female: [
          'Morgan Lee', 'Avery Kim', 'Riley Wang', 'Quinn Taylor', 'Sage Martinez',
          'Emery Chen', 'River Johnson', 'Phoenix Davis', 'Blake Wilson', 'Cameron Brown',
          'Dakota Garcia', 'Hayden White', 'Jordan Miller', 'Logan Anderson', 'Parker Taylor',
          'Rowan Kim', 'Sage Lee', 'Taylor Chen', 'Valerie Martinez', 'Zoe Wilson',
          'Avery Taylor', 'Cameron Lee', 'Dakota Wilson', 'Hayden Brown', 'Jordan Garcia'
        ]
      };
      
      const names = mockNames[selectedGender];
      const fullName = names[i % names.length];
      
      // Generate more realistic usernames
      const [firstName, lastName] = fullName.split(' ');
      const usernameVariants = [
        `${firstName.toLowerCase()}${lastName.toLowerCase()}${Math.floor(Math.random() * 100)}`,
        `${firstName.toLowerCase()}${Math.floor(Math.random() * 1000)}`,
        `${lastName.toLowerCase()}${firstName.charAt(0).toLowerCase()}${Math.floor(Math.random() * 100)}`,
        `${firstName.toLowerCase()}${Math.floor(Math.random() * 10)}${lastName.toLowerCase()}`,
        `${firstName.charAt(0).toLowerCase()}${lastName.toLowerCase()}${Math.floor(Math.random() * 100)}`
      ];
      const username = usernameVariants[Math.floor(Math.random() * usernameVariants.length)];
      
      profiles.push({
        fullName,
        username,
        gender: selectedGender
      });
    }
    
    return profiles;
  }
}

async function generateBotAvatars(botDocs: any[]) {
  for (const bot of botDocs) {
    try {
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      const bots = db.collection('bots');
      
      let avatarUrl = '';
      
      try {
        // Generate avatar with GPT Image (gender-agnostic, privacy-focused)
        const styles = [
          "cinematic silhouette with soft backlighting",
          "over-the-shoulder shot with blurred facial features",
          "person sitting at a desk with face out of frame",
          "aesthetic workspace with laptop and ambient lighting",
          "bokeh photography with a vague human outline",
          "minimalist geometric tech avatar",
          "soft ambient abstract gradient art",
          "nature macro photography (leaves, petals, water droplets)",
          "urban street silhouette during golden hour",
          "shadowed figure with strong rim light (no visible face)",
          "flat modern icon with subtle shading",
          "profile shot with the head turned away from camera",
          "cinematic coder-themed environment (no faces)",
          "pixel art character with non-specific features",
          "cyberpunk silhouette with masked/unseen facial area"
        ];

        const selectedStyle = styles[Math.floor(Math.random() * styles.length)];
        const prompt = `
Create a realistic, anonymous profile picture. 

Style: ${selectedStyle}. 

Do NOT show any identifiable human facial features. 

Faces must be blurred, shadowed, turned away, cropped out, or replaced by silhouettes. 

Use soft ambient lighting, a square 1:1 frame, no text, no watermarks, and no distortions.
`;

        const imageResponse = await openai.images.generate({
          model: "dall-e-3",
          prompt: prompt,
          size: "1024x1024",
          // Note: quality parameter removed - 'standard' is deprecated
          // Valid values for newer API: 'low', 'medium', 'high', 'auto'
        });
        
        const imageUrl = imageResponse.data?.[0]?.url;
        if (!imageUrl) {
          throw new Error('No image URL from OpenAI image generation');
        }
        
        // Download the image
        const imageBuffer = await fetch(imageUrl).then(res => res.arrayBuffer());
        
        // Upload to MinIO
        const fileName = `${bot._id}.png`;
        const uploadParams = {
          Bucket: process.env.S3_BUCKET_NAME || 'codeclashers-avatars',
          Key: fileName,
          Body: Buffer.from(imageBuffer),
          ContentType: 'image/png',
          ACL: 'public-read'
        };
        
        await s3.upload(uploadParams).promise();
        
        // Store just the filename, not the full URL
        avatarUrl = fileName;
        
      } catch (dalleError) {
        console.error(`OpenAI avatar generation failed for ${bot._id}, using fallback:`, dalleError);
        
        // Fallback to placeholder avatar
        avatarUrl = 'placeholder_avatar.png';
      }
      
      await bots.updateOne(
        { _id: bot._id },
        { $set: { avatar: avatarUrl } }
      );
    } catch (err) {
      console.error(`Failed to generate avatar for ${bot._id}:`, err);
    }
  }
}

const port = parseInt(process.env.PORT || '2567', 10);
const httpServer = createServer(app.callback());
const gameServer = new Server({
  server: httpServer,
  presence: redisPresence,
  driver: redisDriver,
});

gameServer.define('queue', QueueRoom);
gameServer.define('match', MatchRoom);
gameServer.define('private', PrivateRoom)
  .filterBy(['roomCode']);

// Explicitly bind HTTP server to 0.0.0.0 for IPv4 compatibility with Kubernetes health checks
// Then start the game server
httpServer.listen(port, '0.0.0.0', async () => {
  console.log(`Colyseus listening on :${port}`);
  console.log('Integrated matchmaking enabled in QueueRoom');
  if (process.env.COLYSEUS_RESERVATION_SECRET) {
    console.log('Reservation secret configured.');
  } else {
    console.warn('Reservation secret not configured; using default dev secret.');
  }

  // Start Redis cleanup worker
  try {
    startCleanupWorker();
    console.log('Redis cleanup worker started successfully');
  } catch (cleanupError) {
    console.error('Failed to start Redis cleanup worker:', cleanupError);
  }

  try {
    const bootstrapRoom = await matchMaker.createRoom('queue', { bootstrap: true });
    console.log(`QueueRoom bootstrap complete - persistent roomId=${bootstrapRoom.roomId}`);
  } catch (bootstrapError) {
    console.error('Failed to bootstrap persistent QueueRoom:', bootstrapError);
  }
});
// Trigger rebuild
// Trigger rebuild
// Trigger rebuild
