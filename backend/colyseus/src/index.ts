import { Server } from 'colyseus';
import { createServer } from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import { MongoClient, ObjectId } from 'mongodb';
import { QueueRoom } from './rooms/QueueRoom';
import { MatchRoom } from './rooms/MatchRoom';
import { PrivateRoom } from './rooms/PrivateRoom';
// Matchmaking is now integrated into QueueRoom
import { enqueueUser, dequeueUser, queueSize } from './lib/queue';
import { getRedis, RedisKeys } from './lib/redis';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
// import AWS from 'aws-sdk'; // Commented out for now to fix build
import { 
  rateLimitMiddleware, 
  queueLimiter, 
  matchLimiter, 
  adminLimiter 
} from './lib/rateLimiter';
import { internalAuthMiddleware, botAuthMiddleware, combinedAuthMiddleware, adminAuthMiddleware } from './lib/internalAuth';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://codeclashers-mongodb:27017/codeclashers';
const DB_NAME = 'codeclashers';
const isProduction = process.env.NODE_ENV === 'production';

function resolveReservationSecret(): string {
  const secret = process.env.COLYSEUS_RESERVATION_SECRET;
  if (!secret || (secret === 'dev_secret' && isProduction)) {
    throw new Error('COLYSEUS_RESERVATION_SECRET must be configured in production.');
  }
  return secret || 'dev_secret';
}

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

// OpenAI client singleton
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// AWS S3 (MinIO) client - commented out for now
// const s3 = new AWS.S3({
//   endpoint: process.env.S3_ENDPOINT || 'http://codeclashers-minio:9000',
//   accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
//   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin123',
//   s3ForcePathStyle: true,
//   signatureVersion: 'v4',
//   region: process.env.AWS_REGION || 'us-east-1',
// });

const app = new Koa();
const router = new Router();

// Guest user endpoints
router.post('/guest/match/create', async (ctx) => {
  try {
    const { findAvailableBotForGuest, createMatch } = await import('./lib/matchCreation');
    const redis = getRedis();
    
    // Find an available bot
    const bot = await findAvailableBotForGuest();
    if (!bot) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'No bots available for guest match' };
      return;
    }
    
    // Generate guest user ID
    const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create match between guest and bot
    const matchResult = await createMatch(
      { userId: guestId, rating: 1200, username: 'Guest' },
      bot,
      undefined, // Let createMatch calculate difficulty based on ratings
      false // Not private
    );
    
    // Store guest session in Redis with 7-day TTL
    await redis.setex(RedisKeys.guestSessionKey(guestId), 7 * 24 * 3600, JSON.stringify({
      guestId,
      matchId: matchResult.matchId,
      roomId: matchResult.roomId,
      createdAt: Date.now()
    }));
    
    ctx.body = {
      success: true,
      guestId,
      matchId: matchResult.matchId,
      roomId: matchResult.roomId,
      bot: {
        username: bot.username,
        rating: bot.rating
      }
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
    const redis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
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
    // Create a separate Redis connection for admin operations
    const redis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
    });
    
    // Test Redis connection first
    await redis.ping();
    console.log('Redis connection successful');
    
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
    
    // Get current deployed count
    const deployedCount = await redis.scard(RedisKeys.botsDeployedSet);
    
    // Get deployed bot IDs
    const deployedBots = await redis.smembers(RedisKeys.botsDeployedSet);
    
    // Get rotation queue
    const rotationQueue = await redis.lrange(RedisKeys.botsRotationQueue, 0, -1);
    
    // Get active bots count
    const activeCount = await redis.scard(RedisKeys.botsActiveSet);
    
    // Get queued players count
    const queuedPlayersCount = await redis.scard(RedisKeys.queuedPlayersSet);
    
    ctx.body = {
      success: true,
      status: {
        maxDeployed,
        totalBots,
        deployedCount,
        deployedBots, // Add deployed bot IDs
        activeCount,
        rotationQueue,
        queueLength: rotationQueue.length,
        queuedPlayersCount,
        targetDeployed: maxDeployed + queuedPlayersCount
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
    const redis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
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
    
    // Add undeployed bots to rotation queue
    const undeployedBots = allBots.filter(bot => !bot.deployed);
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
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000', 
  allowMethods: ['GET','POST','PUT','DELETE','OPTIONS'], 
  allowHeaders: ['Content-Type','Authorization','X-Internal-Secret','X-Bot-Secret','X-Service-Name','Cookie'],
  credentials: true 
}));
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
    const cacheKey = 'global:general-stats';
    
    // Try to get cached stats first (cache for 30 seconds)
    const cached = await redis.get(cacheKey);
    if (cached) {
      ctx.body = JSON.parse(cached);
      return;
    }
    
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    
    // Get current queue size (includes players, bots, and guests)
    const queueSize = await redis.zcard(RedisKeys.eloQueue);
    
    // Get active matches count
    const activeMatches = await redis.scard(RedisKeys.activeMatchesSet);
    
    // Each active match has 2 players, so total players in matches = activeMatches * 2
    // Total active players = players in queue + players in matches
    const activePlayers = queueSize + (activeMatches * 2);
    
    // Get total matches completed
    const matchesCompleted = await db.collection('matches').countDocuments({
      status: 'finished'
    });
    
    const stats = {
      activePlayers,
      matchesCompleted,
      inProgressMatches: activeMatches,
      inQueue: queueSize
    };
    
    // Cache the results for 30 seconds to keep stats more real-time
    await redis.setex(cacheKey, 30, JSON.stringify(stats));
    
    ctx.body = stats;
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
  if (!reservationRaw) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
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
  ctx.body = { token };
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
    const { matchMaker } = await import('colyseus');
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
    
    const { signature, solutions, testCases } = ctx.request.body as {
      signature: { functionName: string; parameters: Array<{ name: string; type: string }>; returnType: string };
      solutions: { python?: string; cpp?: string; java?: string; js?: string };
      testCases: Array<{ input: Record<string, unknown>; output: unknown }>;
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
      console.log('Test cases count:', testCases.length);
      console.log('Solutions available:', Object.keys(solutions));

      for (const [langKey, langValue] of Object.entries(languageMap)) {
      const solution = solutions[langKey as keyof typeof solutions];
      
      if (!solution) {
        verificationErrors.push(`Missing solution for ${langKey}`);
        continue;
      }

      try {
        console.log(`Starting verification for ${langKey}...`);
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
    await db.createCollection('bots', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['fullName', 'username', 'avatar', 'gender', 'stats', 'matchIds', 'deployed', 'createdAt', 'updatedAt'],
          properties: {
            fullName: {
              bsonType: 'string',
              minLength: 1,
              maxLength: 100,
              description: 'Full name is required and must be a string'
            },
            username: {
              bsonType: 'string',
              minLength: 1,
              maxLength: 50,
              description: 'Username is required and must be a string'
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
                rating: {
                  bsonType: 'number',
                  minimum: 0,
                  description: 'Rating must be a non-negative number'
                },
                wins: {
                  bsonType: 'number',
                  minimum: 0,
                  description: 'Wins must be a non-negative number'
                },
                losses: {
                  bsonType: 'number',
                  minimum: 0,
                  description: 'Losses must be a non-negative number'
                },
                draws: {
                  bsonType: 'number',
                  minimum: 0,
                  description: 'Draws must be a non-negative number'
                },
                totalMatches: {
                  bsonType: 'number',
                  minimum: 0,
                  description: 'Total matches must be a non-negative number'
                }
              }
            },
            matchIds: {
              bsonType: 'array',
              description: 'Array of match IDs is required'
            },
            deployed: {
              bsonType: 'bool',
              description: 'Deployed status is required'
            },
            createdAt: {
              bsonType: 'date',
              description: 'Created date is required'
            },
            updatedAt: {
              bsonType: 'date',
              description: 'Updated date is required'
            }
          }
        }
      }
    });
    
    // Create indexes
    const bots = db.collection('bots');
    await bots.createIndex({ deployed: 1 });
    await bots.createIndex({ 'stats.rating': 1 });
    await bots.createIndex({ deployed: 1, 'stats.rating': 1 });
    
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
    
    ctx.body = {
      success: true,
      bots: allBots
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
        deployed: false,
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
        deployed: botDoc.deployed,
        hasStats: !!botDoc.stats,
        hasMatchIds: Array.isArray(botDoc.matchIds),
        hasDates: !!(botDoc.createdAt && botDoc.updatedAt)
      });
      
      if (!botDoc.fullName || !botDoc.username || !botDoc.avatar || !botDoc.gender || !botDoc.stats || !Array.isArray(botDoc.matchIds) || typeof botDoc.deployed !== 'boolean' || !botDoc.createdAt || !botDoc.updatedAt) {
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
    
    ctx.body = {
      success: true,
      message: `Generated ${count} bots successfully`,
      botIds: Object.keys(result.insertedIds).map(key => result.insertedIds[parseInt(key)].toString())
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
    
    const mongoClient = await getMongoClient();
    const db = mongoClient.db(DB_NAME);
    const bots = db.collection('bots');
    const redis = getRedis();
    
    // Update bot deployment status
    await bots.updateMany(
      { _id: { $in: botIds.map(id => new ObjectId(id)) } },
      { 
        $set: { 
          deployed: deploy,
          updatedAt: new Date()
        }
      }
    );
    
    // Update Redis deployed set
    if (deploy) {
      // Get bot IDs for Redis
      const deployedBots = await bots.find({ _id: { $in: botIds.map(id => new ObjectId(id)) } }).toArray();
      for (const bot of deployedBots) {
        await redis.sadd(RedisKeys.botsDeployedSet, bot._id.toString());
      }
      
      // Notify bot service to start cycles
      await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ type: 'deploy' }));
    } else {
      // Remove from deployed set
      const deployedBots = await bots.find({ _id: { $in: botIds.map((id: string) => new ObjectId(id)) } }).toArray();
      const deployedBotIds = deployedBots.map((bot: any) => bot._id.toString());
      
      for (const bot of deployedBots) {
        await redis.srem(RedisKeys.botsDeployedSet, bot._id.toString());
      }
      
      // Notify bot service to stop specific bots
      await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({ 
        type: 'stop', 
        botIds: deployedBotIds 
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
    const redis = getRedis();
    
    // Get bot info before deletion
    const bot = await bots.findOne({ _id: new ObjectId(botId) });
    
    const result = await bots.deleteOne({ _id: new ObjectId(botId) });
    
    // Clean up avatar file from MinIO/S3
    if (bot && bot.avatar) {
      await deleteBotAvatar(bot.avatar);
    }
    
    // Remove from Redis sets
    if (bot) {
      await redis.srem(RedisKeys.botsActiveSet, bot._id.toString());
      await redis.srem(RedisKeys.botsDeployedSet, bot._id.toString());
    }
    
    if (result.deletedCount === 0) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Bot not found' };
      return;
    }
    
    ctx.body = {
      success: true,
      message: 'Bot deleted successfully'
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
          deployed: false,
          updatedAt: new Date()
        }
      });
      
      // Clear Redis sets
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
    const prompt = `You are simulating a natural list of player identities from a real online gaming or coding platform.

Generate ${count} user profiles, each with:

A display name (fullName) — what users might actually choose. Sometimes it's a real name, sometimes a nickname, sometimes weird, stylized, or includes numbers.

A username handle that looks like something real users pick (mixes of lowercase, numbers, symbols, slight misspellings, etc.).

✅ Keep variety and realism:

40% should look like normal gamer tags: NovaX, breezy_09, Artemis, jaydenlol
30% should resemble real names or slightly modified ones: sarah_mendez, kevinliu21, t_akari  
20% should be weird or meme-y: fishgod, 0rangejuice, crunchybeans
10% should be minimalist or mysterious: lxr, m1nt, _void

DONT MAKE THEM EXACTLY THE THINGS THAT HAVE BEEN MENTIONED ABOVE. PLEASE ADD VARIETY AND GO OUT OF THE BOX AND HAVE NAMES FROM DIFFERENT CULTURES AROUND THE WORLD.

Gender distribution: ${genderText}

❌ Avoid perfectly clean or AI-looking usernames (like "SolarRift" or "DreamWalker").
❌ Avoid repeating structure — randomness and inconsistency are good.
❌ Make full names naturally plausible with realistic global diversity, sometimes include something obviously fake.

Return as JSON array:
[
  {"fullName": "...", "username": "...", "gender": "male"},
  ...
]`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
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
        // Generate avatar with DALL-E 3
        let prompt = '';
        
        if (bot.gender === 'female') {
          // For female profiles: NO FACES, use abstract/nature/objects
          const femaleStyles = [
            "abstract watercolor art",
            "geometric patterns", 
            "nature photography (flowers/butterflies/leaves)",
            "celestial bodies (moon/stars)",
            "minimalist shapes",
            "botanical illustration",
            "crystal/gemstone art",
            "ocean waves",
            "mountain landscape"
          ];
          const selectedStyle = femaleStyles[Math.floor(Math.random() * femaleStyles.length)];
          prompt = `Create a profile picture with NO human faces. Style: ${selectedStyle}`;
        } else {
          // For male profiles: can have people, objects, or abstract
          const maleStyles = [
            "professional headshot photo",
            "minimalist geometric avatar", 
            "abstract tech-themed art",
            "pixel art character",
            "illustrated portrait",
            "neon cyberpunk style",
            "flat design icon"
          ];
          const selectedStyle = maleStyles[Math.floor(Math.random() * maleStyles.length)];
          prompt = `Create a profile picture for a coding competition participant. Style: ${selectedStyle}`;
        }
        
        const imageResponse = await openai.images.generate({
          model: "dall-e-3",
          prompt: prompt,
          size: "1024x1024",
          quality: "standard",
          n: 1,
        });
        
        const imageUrl = imageResponse.data?.[0]?.url;
        if (!imageUrl) {
          throw new Error('No image URL from DALL-E');
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
        
        // await s3.upload(uploadParams).promise(); // Commented out for now
        
        // Store just the filename, not the full URL
        avatarUrl = fileName;
        
      } catch (dalleError) {
        console.error(`DALL-E avatar generation failed for ${bot._id}, using fallback:`, dalleError);
        
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
const gameServer = new Server({ server: createServer(app.callback()) });

gameServer.define('queue', QueueRoom);
gameServer.define('match', MatchRoom);
gameServer.define('private', PrivateRoom)
  .filterBy(['roomCode']);

gameServer.listen(port).then(async () => {
  console.log(`Colyseus listening on :${port}`);
  console.log('Integrated matchmaking enabled in QueueRoom');
});
