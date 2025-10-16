import { Server } from 'colyseus';
import { createServer } from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import { MongoClient, ObjectId } from 'mongodb';
import { QueueRoom } from './rooms/QueueRoom';
import { MatchRoom } from './rooms/MatchRoom';
import { startMatchmaker } from './workers/matchmaker';
import { enqueueUser, dequeueUser, queueSize } from './lib/queue';
import { getRedis, RedisKeys } from './lib/redis';
import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import AWS from 'aws-sdk';
import { 
  rateLimitMiddleware, 
  queueLimiter, 
  matchLimiter, 
  adminLimiter 
} from './lib/rateLimiter';

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

// OpenAI client singleton
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// AWS S3 (MinIO) client
const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'http://codeclashers-minio:9000',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin123',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
  region: process.env.AWS_REGION || 'us-east-1',
});

const app = new Koa();
const router = new Router();
app.use(bodyParser());
app.use(cors({ origin: '*', allowMethods: ['GET','POST','OPTIONS'], allowHeaders: ['Content-Type','Authorization'] }));
app.use(router.routes());
app.use(router.allowedMethods());

// Queue endpoints with rate limiting
router.post('/queue/enqueue', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const { userId, rating } = ctx.request.body as { userId: string; rating: number };
  if (!userId || typeof rating !== 'number') { ctx.status = 400; ctx.body = { error: 'userId and rating required' }; return; }
  await enqueueUser(userId, rating);
  ctx.body = { success: true };
});

router.post('/queue/dequeue', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const { userId } = ctx.request.body as { userId: string };
  if (!userId) { ctx.status = 400; ctx.body = { error: 'userId required' }; return; }
  await dequeueUser(userId);
  ctx.body = { success: true };
});

router.get('/queue/size', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const size = await queueSize();
  ctx.body = { size };
});

router.get('/queue/reservation', rateLimitMiddleware(queueLimiter), async (ctx) => {
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

router.post('/reserve/consume', rateLimitMiddleware(queueLimiter), async (ctx) => {
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

router.post('/queue/clear', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const { userId } = ctx.request.body as { userId: string };
  if (!userId) { ctx.status = 400; ctx.body = { error: 'userId required' }; return; }
  const redis = getRedis();
  await redis.del(`queue:reservation:${userId}`);
  ctx.body = { success: true };
});

// Private room endpoints - simple Redis-based approach
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

router.post('/private/join', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const { roomCode, userId, username } = ctx.request.body as { roomCode: string; userId: string; username: string };
  if (!roomCode || !userId || !username) { 
    ctx.status = 400; 
    ctx.body = { error: 'roomCode, userId, and username required' }; 
    return; 
  }
  
  const redis = getRedis();
  const roomKey = `private:room:${roomCode.toUpperCase()}`;
  const roomDataRaw = await redis.get(roomKey);
  
  let roomData;
  if (!roomDataRaw) {
    // Create new room
    roomData = {
      roomCode: roomCode.toUpperCase(),
      players: [{ userId, username }],
      creatorId: userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000 // 1 hour
    };
    await redis.setex(roomKey, 3600, JSON.stringify(roomData));
    await redis.setex(`private:user:${userId}`, 3600, roomCode.toUpperCase());
  } else {
    // Join existing room
    roomData = JSON.parse(roomDataRaw);
    
    // Check if user is already in the room
    if (roomData.players.some((p: any) => p.userId === userId)) {
      ctx.body = { ...roomData, isCreator: roomData.creatorId === userId };
      return;
    }
    
    // Check if room is full
    if (roomData.players.length >= 2) {
      ctx.status = 400;
      ctx.body = { error: 'Room is full' };
      return;
    }
    
    // Add player to room
    roomData.players.push({ userId, username });
    await redis.setex(roomKey, 3600, JSON.stringify(roomData));
    await redis.setex(`private:user:${userId}`, 3600, roomCode.toUpperCase());
  }
  
  ctx.body = { ...roomData, isCreator: roomData.creatorId === userId };
});

router.get('/private/room', rateLimitMiddleware(queueLimiter), async (ctx) => {
  const roomCode = (ctx.request.query as any).roomCode as string;
  if (!roomCode) { 
    ctx.status = 400; 
    ctx.body = { error: 'roomCode required' }; 
    return; 
  }
  
  const redis = getRedis();
  const roomDataRaw = await redis.get(`private:room:${roomCode.toUpperCase()}`);
  
  if (!roomDataRaw) {
    ctx.status = 404;
    ctx.body = { error: 'Room not found or expired' };
    return;
  }
  
  const roomData = JSON.parse(roomDataRaw);
  
  // If we have 2 players, auto-start the match
  if (roomData.players.length === 2) {
    try {
      const { matchMaker } = await import('colyseus');
      const { MongoClient } = await import('mongodb');
      
      // Select a random problem
      const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://codeclashers-mongodb:27017/codeclashers';
      const mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      const db = mongoClient.db('codeclashers');
      
      const problems = await db.collection('problems')
        .aggregate([
          { $match: { difficulty: 'Medium', verified: true } },
          { $sample: { size: 1 } }
        ])
        .toArray();
      
      if (problems.length === 0) {
        throw new Error('No problems available');
      }
      
      const problemId = problems[0]._id.toString();
      const matchId = `private_${roomCode}_${Date.now()}`;
      
      // Create match room
      const matchRoom = await matchMaker.create('match', { 
        matchId, 
        problemId,
        problemData: problems[0]
      });
      
      // Create reservations for both players
      for (const player of roomData.players) {
        const reservation = {
          roomId: matchRoom.room.roomId,
          roomName: 'match',
          matchId,
          problemId,
          timestamp: Date.now()
        };
        await redis.setex(`queue:reservation:${player.userId}`, 3600, JSON.stringify(reservation));
      }
      
      // Initialize match in Redis
      const matchKey = RedisKeys.matchKey(matchId);
      const matchObj = {
        matchId,
        problemId,
        problem: problems[0],
        players: roomData.players.reduce((acc: any, p: any) => {
          acc[p.userId] = { username: p.username };
          return acc;
        }, {}),
        playersCode: {},
        linesWritten: {},
        submissions: [],
        status: 'ongoing',
        startedAt: Date.now(),
        private: true,
        roomCode: roomCode.toUpperCase()
      };
      await redis.setex(matchKey, 3600, JSON.stringify(matchObj));
      // Ensure private matches are tracked as active as well
      await redis.sadd(RedisKeys.activeMatchesSet, matchId);
      
      // Clean up private room
      await redis.del(`private:room:${roomCode.toUpperCase()}`);
      for (const player of roomData.players) {
        await redis.del(`private:user:${player.userId}`);
      }
      
      await mongoClient.close();
      
      // Return match info
      ctx.body = { matchId, roomId: matchRoom.room.roomId, matchStarted: true };
      return;
    } catch (error: any) {
      console.error('Error auto-starting match:', error);
    }
  }
  
  ctx.body = roomData;
});

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
router.post('/admin/validate-solutions', rateLimitMiddleware(adminLimiter), async (ctx) => {
  console.log('Validation endpoint called with body:', JSON.stringify(ctx.request.body, null, 2));
  
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
      } catch (error: any) {
        verificationErrors.push(`${langKey} verification error: ${error.message}`);
        console.error(`Error verifying ${langKey}:`, error);
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
    console.error('Validation endpoint error:', error);
    ctx.status = 500;
    ctx.body = { error: 'Internal validation error', message: error.message };
  }
});

// Bot Management Endpoints

router.post('/admin/bots/init', async (ctx) => {
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

router.get('/admin/bots', async (ctx) => {
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

router.post('/admin/bots/generate', async (ctx) => {
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
    
    // Drop existing collection if it exists to avoid schema conflicts
    const collections = await db.listCollections({ name: 'bots' }).toArray();
    if (collections.length > 0) {
      console.log('Dropping existing bots collection to recreate with new schema...');
      await db.dropCollection('bots');
    }
    
    console.log('Creating bots collection with new schema...');
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
                enum: ['male', 'female', 'nonbinary'],
                description: 'Gender must be male, female, or nonbinary'
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
      console.log('Bots collection created successfully');
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
        avatar: '/placeholder_avatar.png', // Will be updated with generated avatar
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

router.post('/admin/bots/deploy', async (ctx) => {
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

router.put('/admin/bots/:id', async (ctx) => {
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

router.delete('/admin/bots/:id', async (ctx) => {
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

router.post('/admin/bots/reset', async (ctx) => {
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

    await s3.deleteObject(deleteParams).promise();
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
                const fileName = `bot-avatar-${bot._id}-${Date.now()}.png`;
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
        console.error(`DALL-E avatar generation failed for ${bot._id}, using fallback:`, dalleError);
        
        // Fallback to emoji avatars
        if (bot.gender === 'female') {
          const femaleAvatars = [
            '/api/placeholder/200/200?text=🌸', // Flower
            '/api/placeholder/200/200?text=🌙', // Moon
            '/api/placeholder/200/200?text=✨', // Stars
            '/api/placeholder/200/200?text=🦋', // Butterfly
            '/api/placeholder/200/200?text=🌺', // Hibiscus
            '/api/placeholder/200/200?text=🍃', // Leaf
            '/api/placeholder/200/200?text=🌊', // Wave
            '/api/placeholder/200/200?text=🌿', // Herb
            '/api/placeholder/200/200?text=💎', // Diamond
            '/api/placeholder/200/200?text=🎭', // Theater masks
          ];
          avatarUrl = femaleAvatars[Math.floor(Math.random() * femaleAvatars.length)];
        } else {
          const maleAvatars = [
            '/api/placeholder/200/200?text=👨', // Man
            '/api/placeholder/200/200?text=🧑', // Person
            '/api/placeholder/200/200?text=👨‍💼', // Business person
            '/api/placeholder/200/200?text=👨‍🎓', // Student
            '/api/placeholder/200/200?text=👨‍💻', // Technologist
            '/api/placeholder/200/200?text=🎮', // Gaming controller
            '/api/placeholder/200/200?text=💻', // Laptop
            '/api/placeholder/200/200?text=⚡', // Lightning
            '/api/placeholder/200/200?text=🔥', // Fire
            '/api/placeholder/200/200?text=🌟', // Star
            '/api/placeholder/200/200?text=🎯', // Target
            '/api/placeholder/200/200?text=⚔️', // Swords
            '/api/placeholder/200/200?text=🏆', // Trophy
            '/api/placeholder/200/200?text=🚀', // Rocket
            '/api/placeholder/200/200?text=💡', // Light bulb
            '/api/placeholder/200/200?text=🎲', // Dice
            '/api/placeholder/200/200?text=🧩', // Puzzle piece
          ];
          avatarUrl = maleAvatars[Math.floor(Math.random() * maleAvatars.length)];
        }
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

gameServer.listen(port).then(async () => {
  console.log(`Colyseus listening on :${port}`);
  
  // Start the background matchmaker
  startMatchmaker(gameServer);
  console.log('Background matchmaker started');
});

