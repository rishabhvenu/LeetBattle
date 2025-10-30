import { Client, Room } from 'colyseus';
import { getRedis, RedisKeys } from '../lib/redis';
import { executeAllTestCases } from '../lib/testExecutor';
import { getProblemWithTestCases } from '../lib/problemData';
import { analyzeTimeComplexity } from '../lib/complexityAnalyzer';
import { MongoClient, ObjectId } from 'mongodb';
import { calculateDifficultyMultiplier, applyDifficultyAdjustment } from '../lib/eloSystem';
import { createHash } from 'crypto';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://codeclashers-mongodb:27017/codeclashers';
const DB_NAME = 'codeclashers';

let mongoClientCache: MongoClient | null = null;

async function getMongoClient(): Promise<MongoClient> {
  if (mongoClientCache) {
    try {
      await mongoClientCache.db(DB_NAME).admin().ping();
      return mongoClientCache;
    } catch {
      mongoClientCache = null;
    }
  }
  mongoClientCache = new MongoClient(MONGODB_URI, {
    monitorCommands: false,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  });
  await mongoClientCache.connect();
  return mongoClientCache;
}

type PlayerState = {
  code: Record<string, string>;             // language -> code
  linesWritten: number;                     // derived from current code
  submissions: string[];                    // competitive submissions tokens/ids
  testSubmissions: string[];                // practice/test run tokens/ids
  languages: string[];                      // approved languages available to user
  currentLanguage?: string;                 // selected language
};

export class MatchRoom extends Room {
  maxClients = 2;
  
  private redis = getRedis();
  private matchId!: string;
  private problemId!: string;
  private problemData: any = null; // Cache problem data to avoid re-fetching
  private startTime!: number;
  private maxDuration = 45 * 60 * 1000;
  private matchDuration!: number; // Time the match lasted in milliseconds
  private lastSubmitAt: Record<string, number> = {};
  private testCounter: Record<string, { windowStart: number; count: number }> = {};
  private userIdToSession: Record<string, string> = {};
  private connectingUserIds: Set<string> = new Set(); // Track users currently connecting
  private botCompletionTimers: Record<string, any> = {};
  
  // Bot simulation tracking
  private botSimulationTimers: Record<string, { codeTimer: any; testTimer: any }> = {};
  private botSimulationState: Record<string, { currentLines: number; currentTests: number; maxTests: number }> = {};
  private botStats: Record<string, { submissions: number; testCasesSolved: number }> = {};

  /**
   * Generate a deterministic hash for submission caching
   */
  private generateSubmissionCacheKey(userId: string, language: string, sourceCode: string): string {
    // Normalize source code by trimming whitespace
    const normalizedCode = sourceCode.trim();
    
    // Create hash from normalized code + language + problemId
    const hashInput = `${normalizedCode}:${language}:${this.problemId}`;
    const hash = createHash('sha256').update(hashInput).digest('hex');
    
    return hash;
  }

  /**
   * Get cached submission result from Redis
   */
  private async getCachedSubmissionResult(userId: string, language: string, sourceCode: string): Promise<any | null> {
    try {
      const codeHash = this.generateSubmissionCacheKey(userId, language, sourceCode);
      const cacheKey = RedisKeys.submissionCacheKey(this.matchId, userId, codeHash);
      const cachedResult = await this.redis.get(cacheKey);
      
      if (cachedResult) {
        console.log(`Cache hit for user ${userId} submission`);
        return JSON.parse(cachedResult);
      }
      
      return null;
    } catch (error) {
      console.error('Error getting cached submission result:', error);
      return null;
    }
  }

  /**
   * Cache submission result in Redis with TTL
   */
  private async cacheSubmissionResult(userId: string, language: string, sourceCode: string, result: any): Promise<void> {
    try {
      const codeHash = this.generateSubmissionCacheKey(userId, language, sourceCode);
      const cacheKey = RedisKeys.submissionCacheKey(this.matchId, userId, codeHash);
      
      // Cache for 50 minutes (45 min match + 5 min buffer)
      const ttlSeconds = 50 * 60;
      await this.redis.setex(cacheKey, ttlSeconds, JSON.stringify(result));
      
      console.log(`Cached submission result for user ${userId}`);
    } catch (error) {
      console.error('Error caching submission result:', error);
      // Don't throw - caching failure shouldn't break submission
    }
  }

  async onCreate(options: { matchId: string; problemId: string; problemData?: any; player1Id?: string; player2Id?: string }) {
    this.matchId = options.matchId;
    this.problemId = options.problemId;
    this.problemData = options.problemData; // Cache if provided
    this.startTime = Date.now();
    
    // Store player IDs for bot completion time calculation
    (this as any).player1Id = options.player1Id;
    (this as any).player2Id = options.player2Id;
    
    // Don't auto-dispose when all clients leave - only dispose on match end
    this.autoDispose = false;

    console.log(`MatchRoom onCreate - matchId: ${this.matchId}, maxClients: ${this.maxClients}`);

    // Load problem data from Redis (selected by Next.js)
    let problemData = options.problemData;
    if (!problemData || this.problemId === 'pending') {
      const matchKey = RedisKeys.matchKey(this.matchId);
      const existingMatch = await this.redis.get(matchKey);
      if (existingMatch) {
        const matchObj = JSON.parse(existingMatch);
        if (matchObj.problem) {
          problemData = matchObj.problem;
          this.problemId = matchObj.problemId;
        }
      }
    }
    
    // If still no problem data, fetch from MongoDB
    if (!problemData && this.problemId && this.problemId !== 'pending') {
      console.log(`Fetching problem ${this.problemId} from MongoDB`);
      try {
        problemData = await getProblemWithTestCases(this.problemId);
        this.problemData = problemData;
        console.log(`Problem loaded: ${problemData?.title || 'Unknown'}`);
      } catch (error) {
        console.error(`Failed to load problem ${this.problemId}:`, error);
      }
    }

    // Don't use setState - we're not syncing state via Colyseus
    // Everything is stored in Redis
    
    // CRITICAL: Configure room to stay unlocked and alive
    this.setSeatReservationTime(3600); // 60 minute timeout for players to join
    this.setPrivate(false); // Not private
    
    // Explicitly unlock the room
    this.unlock();
    console.log(`Room created and unlocked. Locked: ${this.locked}`);
    
    // initialize redis match blob with TTL 1 hour
    await this.updateMatchBlob((obj) => {
      obj.matchId = this.matchId;
      obj.problemId = this.problemId;
      obj.status = 'ongoing';
      obj.startedAt = new Date().toISOString();
      obj.players = obj.players || {}; // Use object map for players
      obj.playersCode = obj.playersCode || {};
      obj.linesWritten = obj.linesWritten || {};
      obj.submissions = obj.submissions || [];
      obj.isPrivate = false; // Default to false, can be updated later
      obj.ratings = obj.ratings || {};
      
      // Always set problem data if we have it
      if (problemData) {
        // Sanitize problem data for client (remove test cases and solutions)
        const sanitizedProblem = {
          _id: problemData._id,
          title: problemData.title,
          description: problemData.description,
          difficulty: problemData.difficulty,
          topics: problemData.topics,
          signature: problemData.signature,
          starterCode: problemData.starterCode,
          examples: problemData.examples,
          constraints: problemData.constraints,
          testCasesCount: problemData.testCasesCount
        };
        obj.problem = sanitizedProblem;
      }
    });
    
    // Create initial match document in MongoDB
    await this.createInitialMatchDocument();

    // Calculate and store bot completion times immediately
    console.log(`MatchRoom: Starting bot completion time calculation for match ${this.matchId}`);
    console.log(`MatchRoom: Player IDs - player1Id: ${(this as any).player1Id}, player2Id: ${(this as any).player2Id}`);
    await this.calculateAndStoreBotCompletionTimes();
    
    // Add player information to match data
    await this.updateMatchBlob((obj) => {
      if ((this as any).player1Id && (this as any).player2Id) {
        obj.players = {
          [(this as any).player1Id]: { 
            username: (this as any).player1Id,
            rating: 1200 // Default rating, will be updated when players join
          },
          [(this as any).player2Id]: { 
            username: (this as any).player2Id,
            rating: 1200 // Default rating, will be updated when players join
          }
        };
        
        // Add ratings from Redis if available
        const ratingsKey = `match:${this.matchId}:ratings`;
        this.redis.hgetall(ratingsKey).then(ratings => {
          if (ratings && ratings.player1 && ratings.player2) {
            this.updateMatchBlob((obj) => {
              obj.ratings = {
                player1: parseInt(ratings.player1),
                player2: parseInt(ratings.player2)
              };
            });
          }
        }).catch(err => console.warn('Failed to fetch ratings:', err));
      }
    });
    
    await this.redis.expire(RedisKeys.matchKey(this.matchId), 3600);

    // Bot completion scheduling is now handled in calculateAndStoreBotCompletionTimes()

    // End match timer
    this.clock.setInterval(async () => {
      if (Date.now() - this.startTime >= this.maxDuration) {
        console.log(`Match ${this.matchId} timed out - declaring draw`);
        
        // Calculate rating changes for draw
        const ratingChanges = await this.calculateRatingChanges(null, true);
        // Store rating changes for UI and persist to DB
        await this.updateMatchBlob((obj) => {
          obj.ratingChanges = ratingChanges;
        });
        await this.persistRatings(ratingChanges, null, true);
        this.broadcast('match_draw', { 
          reason: 'timeout',
          ratingChanges 
        });
        this.endMatch('timeout');
      }
    }, 1000);

    // Basic message handlers
    this.onMessage('update_code', async (client, message: { language: string; code: string; userId: string; lines?: number }) => {
      const { userId, language, code, lines: clientLines } = message;
      this.ensurePlayer(userId);
      // Calculate lines from code or use client-provided value
      const lines = clientLines !== undefined ? clientLines : ((code?.match(/\n/g)?.length || 0) + (code ? 1 : 0));
      
      console.log(`update_code from ${userId}: ${lines} lines in ${language}`);
      
      // ensure language tracked
      this.ensureLanguage(userId, language);
      // Persist live code in Redis match blob
      await this.persistCode(userId, language, code, lines);
      // Notify opponent via room broadcast
      this.broadcast('code_update', { userId, language, lines }, { except: client });
      console.log(`Broadcasted code_update to opponents: ${userId} has ${lines} lines`);
    });

    this.onMessage('set_language', async (client, message: { userId: string; language: string }) => {
      const { userId, language } = message;
      this.ensurePlayer(userId);
      this.ensureLanguage(userId, language);
      // this.state.players[userId].currentLanguage = language;
      await this.updateMatchBlob((obj) => {
        obj.playerData = obj.playerData || {};
        obj.playerData[userId] = obj.playerData[userId] || {};
        obj.playerData[userId].currentLanguage = language;
      });
      this.broadcast('language_changed', { userId, language });
    });

    this.onMessage('submit_code', async (client, message: { userId: string; language: string; source_code: string }) => {
      const { userId, language, source_code } = message;
      
      console.log(`Received submit_code from ${userId} with language ${language}`);
      
      // rate limit: 1 submit per 2s per user
      const now = Date.now();
      const last = this.lastSubmitAt[userId] || 0;
      if (now - last < 2000) {
        console.log(`Rate limit hit for ${userId} - too many submissions`);
        this.clientSendRateLimit(client, 'submit_code');
        return;
      }
      this.lastSubmitAt[userId] = now;

      try {
        // Fetch problem with testCases from MongoDB (cached after first fetch)
        if (!this.problemData) {
          console.log(`Fetching problem data for ${this.problemId}`);
          this.problemData = await getProblemWithTestCases(this.problemId);
          console.log(`Problem data fetched:`, this.problemData ? 'Success' : 'Failed');
        }
        const problem = this.problemData;
        
        if (!problem || !problem.signature || !problem.testCases || problem.testCases.length === 0) {
          console.log(`Problem data not available for ${userId}:`, { 
            hasProblem: !!problem, 
            hasSignature: !!problem?.signature, 
            hasTestCases: !!problem?.testCases, 
            testCasesLength: problem?.testCases?.length 
          });
          client.send('submission_result', {
            userId,
            success: false,
            error: 'Problem data not available'
          });
          return;
        }

        // Map language names to supported types
        const langMap: Record<string, 'python' | 'javascript' | 'java' | 'cpp'> = {
          'python': 'python',
          'javascript': 'javascript',
          'js': 'javascript',
          'java': 'java',
          'cpp': 'cpp',
          'c++': 'cpp'
        };

        const mappedLang = langMap[language.toLowerCase()];
        if (!mappedLang) {
          client.send('submission_result', {
            userId,
            success: false,
            error: `Unsupported language: ${language}`
          });
          return;
        }

        // Check cache for identical submission
        const cachedResult = await this.getCachedSubmissionResult(userId, language, source_code);
        if (cachedResult) {
          console.log(`Using cached result for user ${userId} competitive submission`);
          
          // Send cached result back to client
          client.send('submission_result', {
            userId,
            success: true,
            allPassed: cachedResult.allPassed,
            passedTests: cachedResult.passedTests,
            totalTests: cachedResult.totalTests,
            testResults: cachedResult.testResults,
            averageTime: cachedResult.averageTime,
            averageMemory: cachedResult.averageMemory
          });
          
          // Broadcast cached submission to both players
          client.send('new_submission', {
            userId,
            submission: cachedResult.submission
          });
          this.broadcast('new_submission', { userId, submission: cachedResult.submission }, { except: client });

          // If cached result shows all tests passed, declare winner
          if (cachedResult.allPassed) {
            await this.updateMatchBlob((obj) => {
              obj.winnerUserId = userId;
              obj.endedAt = new Date().toISOString();
              obj.status = 'finished';
            });
            
            // Calculate rating changes
            const ratingChanges = await this.calculateRatingChanges(userId, false);
            // Store rating changes for UI and persist to DB
            await this.updateMatchBlob((obj) => {
              obj.ratingChanges = ratingChanges;
              obj.winnerUserId = userId;
            });
            await this.persistRatings(ratingChanges, userId, false);
            this.broadcast('match_winner', { 
              userId, 
              reason: 'all_tests_passed',
              ratingChanges 
            });
            // Delay endMatch to allow client to receive the submission_result message
            setTimeout(async () => {
              await this.endMatch(`winner_${userId}`);
            }, 2000);
          }
          
          return; // Exit early with cached result
        }

        // Execute code against all testCases
        const executionResult = await executeAllTestCases(
          mappedLang,
          source_code,
          problem.signature,
          problem.testCases
        );

        // Format results for UI
        const testResults = executionResult.results.map((testResult, idx) => ({
          input: JSON.stringify(testResult.testCase.input),
          expectedOutput: JSON.stringify(testResult.testCase.output),
          userOutput: testResult.actualOutput ? JSON.stringify(testResult.actualOutput) : null,
          status: testResult.passed ? 3 : (testResult.status?.id || (testResult.error ? 6 : 4)), // Use actual Judge0 status
          error: testResult.error || null
        }));

        // If all tests passed, analyze time complexity BEFORE storing submission
        if (executionResult.allPassed && problem.timeComplexity) {
          try {
            console.log(`Analyzing time complexity for user ${userId}, expected: ${problem.timeComplexity}`);
            // Dynamically import to avoid requiring OpenAI API key at startup
            const { analyzeTimeComplexity } = await import('../lib/complexityAnalyzer');
            const complexityResult = await analyzeTimeComplexity(source_code, problem.timeComplexity);
            
            if (complexityResult.verdict === 'FAIL') {
              // Complexity check failed - store as failed submission
              console.log(`Time complexity check failed for user ${userId}. Derived: ${complexityResult.derived_complexity}, Expected: ${problem.timeComplexity}`);
              
              const failedSubmission = {
                userId,
                language,
                timestamp: new Date().toISOString(),
                passed: false,
                complexityFailed: true,
                derivedComplexity: complexityResult.derived_complexity,
                expectedComplexity: problem.timeComplexity,
                testResults,
                code: source_code,
                averageTime: executionResult.averageTime,
                averageMemory: executionResult.averageMemory,
                testsPassed: executionResult.passedTests,
                totalTests: executionResult.totalTests,
              };
              
              await this.updateMatchBlob((obj) => {
                obj.submissions = obj.submissions || [];
                obj.submissions.push(failedSubmission);
              });
              
              // IMMEDIATELY persist complexity-failed submission to MongoDB
              try {
                const client = await getMongoClient();
                const db = client.db(DB_NAME);
                const submissions = db.collection('submissions') as any;
                
                const submissionDoc = {
                  matchId: new ObjectId(this.matchId),
                  problemId: new ObjectId(this.problemId),
                  userId: userId.startsWith('guest_') ? userId : new ObjectId(userId),
                  language,
                  sourceCode: source_code,
                  passed: false,
                  complexityFailed: true,
                  derivedComplexity: complexityResult.derived_complexity,
                  expectedComplexity: problem.timeComplexity,
                  testResults,
                  averageTime: executionResult.averageTime,
                  averageMemory: executionResult.averageMemory,
                  testsPassed: executionResult.passedTests,
                  totalTests: executionResult.totalTests,
                  timestamp: new Date(failedSubmission.timestamp),
                  createdAt: new Date(),
                };
                
                const result = await submissions.insertOne(submissionDoc);
                const submissionId = result.insertedId;
                
                console.log(`Saved complexity-failed submission ${submissionId} to MongoDB`);
                
          // Update match document with submission ID
          const matches = db.collection('matches') as any;
          await matches.updateOne(
            { _id: new ObjectId(this.matchId) },
            { 
              $addToSet: { submissionIds: submissionId },
              $set: {
                startedAt: new Date(this.startTime),
                problemId: new ObjectId(this.problemId),
                status: 'ongoing'
              },
              $setOnInsert: {
                playerIds: []
              }
            },
            { upsert: true }
          );
              } catch (dbError) {
                console.error('Failed to save complexity-failed submission to MongoDB:', dbError);
              }
              
              // Send complexity failed event with submission details
              client.send('complexity_failed', {
                userId,
                language,
                derivedComplexity: complexityResult.derived_complexity,
                expectedComplexity: problem.timeComplexity,
                passedTests: executionResult.passedTests,
                totalTests: executionResult.totalTests,
                averageTime: executionResult.averageTime,
                averageMemory: executionResult.averageMemory,
                code: source_code,
                message: 'All tests passed, but your solution does not meet the required time complexity.'
              });
              
              // Broadcast new submission to both players
              client.send('new_submission', {
                userId,
                submission: failedSubmission
              });
              this.broadcast('new_submission', { userId, submission: failedSubmission }, { except: client });
              
              // Cache the complexity-failed result
              await this.cacheSubmissionResult(userId, language, source_code, {
                allPassed: false,
                passedTests: executionResult.passedTests,
                totalTests: executionResult.totalTests,
                testResults,
                averageTime: executionResult.averageTime,
                averageMemory: executionResult.averageMemory,
                submission: failedSubmission
              });
              
              return; // Don't declare winner, don't send submission_result
            }
            
            console.log(`Time complexity check passed for user ${userId}. Derived: ${complexityResult.derived_complexity}`);
          } catch (complexityError) {
            console.error('Error analyzing time complexity:', complexityError);
            // If complexity analysis fails, we continue with normal flow (fail-safe)
          }
        }

        // Store submission results (either tests failed, or tests passed and complexity is OK)
        const submission = {
          userId,
          language,
          timestamp: new Date().toISOString(),
          passed: executionResult.allPassed,
          testResults,
          code: source_code,
          averageTime: executionResult.averageTime,
          averageMemory: executionResult.averageMemory,
          testsPassed: executionResult.passedTests,
          totalTests: executionResult.totalTests,
        };
        
        await this.updateMatchBlob((obj) => {
          obj.submissions = obj.submissions || [];
          obj.submissions.push(submission);
        });
        
        // IMMEDIATELY persist submission to MongoDB
        try {
          const client = await getMongoClient();
          const db = client.db(DB_NAME);
          const submissions = db.collection('submissions') as any;
          
          const submissionDoc = {
            matchId: new ObjectId(this.matchId),
            problemId: new ObjectId(this.problemId),
            userId: userId.startsWith('guest_') ? userId : new ObjectId(userId),
            language,
            sourceCode: source_code,
            passed: executionResult.allPassed,
            testResults,
            averageTime: executionResult.averageTime,
            averageMemory: executionResult.averageMemory,
            testsPassed: executionResult.passedTests,
            totalTests: executionResult.totalTests,
            timestamp: new Date(submission.timestamp),
            createdAt: new Date(),
          };
          
          const result = await submissions.insertOne(submissionDoc);
          const submissionId = result.insertedId;
          
          console.log(`Saved submission ${submissionId} to MongoDB`);
          
          // Update match document with submission ID
          const matches = db.collection('matches') as any;
          await matches.updateOne(
            { _id: new ObjectId(this.matchId) },
            { 
              $addToSet: { submissionIds: submissionId },
              $set: {
                startedAt: new Date(this.startTime),
                problemId: new ObjectId(this.problemId),
                status: 'ongoing'
              },
              $setOnInsert: {
                playerIds: [] // Will be updated properly on match end
              }
            },
            { upsert: true }
          );
          
          console.log(`Added submission ${submissionId} to match ${this.matchId}`);
        } catch (dbError) {
          console.error('Failed to save submission to MongoDB:', dbError);
          // Don't fail the submission if DB save fails
        }

        // Cache the submission result for future identical submissions
        await this.cacheSubmissionResult(userId, language, source_code, {
          allPassed: executionResult.allPassed,
          passedTests: executionResult.passedTests,
          totalTests: executionResult.totalTests,
          testResults,
          averageTime: executionResult.averageTime,
          averageMemory: executionResult.averageMemory,
          submission
        });

        // Send results back to client
        client.send('submission_result', {
          userId,
          success: true,
          allPassed: executionResult.allPassed,
          passedTests: executionResult.passedTests,
          totalTests: executionResult.totalTests,
          testResults,
          averageTime: executionResult.averageTime,
          averageMemory: executionResult.averageMemory
        });
        
        // Broadcast new submission to both players
        client.send('new_submission', {
          userId,
          submission
        });
        this.broadcast('new_submission', { userId, submission }, { except: client });

        // If all tests passed and we reach here, declare winner
        if (executionResult.allPassed) {
          await this.updateMatchBlob((obj) => {
            obj.winnerUserId = userId;
            obj.endedAt = new Date().toISOString();
            obj.status = 'finished';
          });
          
          // Calculate rating changes
          const ratingChanges = await this.calculateRatingChanges(userId, false);
          // Store rating changes for UI and persist to DB
          await this.updateMatchBlob((obj) => {
            obj.ratingChanges = ratingChanges;
            obj.winnerUserId = userId;
          });
          await this.persistRatings(ratingChanges, userId, false);
          this.broadcast('match_winner', { 
            userId, 
            reason: 'all_tests_passed',
            ratingChanges 
          });
          await this.endMatch(`winner_${userId}`);
        }

      } catch (e) {
        console.error('Submit error:', e);
        client.send('submission_result', {
          userId,
          success: false,
          error: (e as Error).message || 'Submission failed'
        });
      }
    });

    this.onMessage('test_submit_code', async (client, message: { userId: string; language: string; source_code: string }) => {
      const { userId, language, source_code } = message;
      
      // rate limit: 2 test runs per 2s per user
      const now = Date.now();
      const rec = this.testCounter[userId] || { windowStart: now, count: 0 };
      if (now - rec.windowStart > 2000) { rec.windowStart = now; rec.count = 0; }
      if (rec.count >= 2) {
        this.clientSendRateLimit(client, 'test_submit_code');
        this.testCounter[userId] = rec;
        return;
      }
      rec.count += 1;
      this.testCounter[userId] = rec;

      try {
        // Fetch problem with testCases from MongoDB (cached after first fetch)
        if (!this.problemData) {
          this.problemData = await getProblemWithTestCases(this.problemId);
        }
        const problem = this.problemData;
        
        if (!problem || !problem.signature || !problem.testCases || problem.testCases.length === 0) {
          client.send('test_submission_result', {
            userId,
            success: false,
            error: 'Problem data not available'
          });
          return;
        }

        // Map language names
        const langMap: Record<string, 'python' | 'javascript' | 'java' | 'cpp'> = {
          'python': 'python',
          'javascript': 'javascript',
          'js': 'javascript',
          'java': 'java',
          'cpp': 'cpp',
          'c++': 'cpp'
        };

        const mappedLang = langMap[language.toLowerCase()];
        if (!mappedLang) {
          client.send('test_submission_result', {
            userId,
            success: false,
            error: `Unsupported language: ${language}`
          });
          return;
        }

        // Run against first 3 test cases for quick feedback
        const testCasesToRun = problem.testCases.slice(0, 3);

        // Execute code against test cases
        const executionResult = await executeAllTestCases(
          mappedLang,
          source_code,
          problem.signature,
          testCasesToRun
        );

        // Format results for UI
        const testResults = executionResult.results.map((testResult) => ({
          input: JSON.stringify(testResult.testCase.input),
          expectedOutput: JSON.stringify(testResult.testCase.output),
          userOutput: testResult.actualOutput ? JSON.stringify(testResult.actualOutput) : null,
          status: testResult.passed ? 3 : (testResult.status?.id || (testResult.error ? 6 : 4)), // Use actual Judge0 status
          error: testResult.error || null
        }));

        // Store test submission results
        const testSubmission = {
          userId,
          language,
          timestamp: new Date().toISOString(),
          passed: executionResult.allPassed,
          testResults,
          code: source_code,
          averageTime: executionResult.averageTime,
          averageMemory: executionResult.averageMemory,
          testsPassed: executionResult.passedTests,
          totalTests: executionResult.totalTests,
          submissionType: 'test'
        };
        
        await this.updateMatchBlob((obj) => {
          obj.testSubmissions = obj.testSubmissions || [];
          obj.testSubmissions.push(testSubmission);
        });

        // Save test submission to MongoDB
        try {
          const client = await getMongoClient();
          const db = client.db(DB_NAME);
          const submissions = db.collection('submissions') as any;
          
          const testSubmissionDoc = {
            matchId: new ObjectId(this.matchId),
            problemId: new ObjectId(this.problemId),
            userId: userId.startsWith('guest_') ? userId : new ObjectId(userId),
            language,
            sourceCode: source_code,
            passed: executionResult.allPassed,
            testResults,
            averageTime: executionResult.averageTime,
            averageMemory: executionResult.averageMemory,
            testsPassed: executionResult.passedTests,
            totalTests: executionResult.totalTests,
            submissionType: 'test',
            timestamp: new Date(testSubmission.timestamp),
            createdAt: new Date(),
          };
          
          const result = await submissions.insertOne(testSubmissionDoc);
          const testSubmissionId = result.insertedId;
          
          console.log(`Saved test submission ${testSubmissionId} to MongoDB`);
          
          // Update match document with test submission ID
          const matches = db.collection('matches') as any;
          await matches.updateOne(
            { _id: new ObjectId(this.matchId) },
            { 
              $addToSet: { testRunIds: testSubmissionId }
            }
          );
          
          console.log(`Added test submission ${testSubmissionId} to match ${this.matchId}`);
        } catch (dbError) {
          console.error('Failed to save test submission to MongoDB:', dbError);
        }

        // Send results back to client
        client.send('test_submission_result', {
          userId,
          success: true,
          allPassed: executionResult.allPassed,
          passedTests: executionResult.passedTests,
          totalTests: executionResult.totalTests,
          testResults,
          averageTime: executionResult.averageTime,
          averageMemory: executionResult.averageMemory
        });

      } catch (e) {
        console.error('Test submit error:', e);
        client.send('test_submission_result', {
          userId,
          success: false,
          error: (e as Error).message || 'Test submission failed'
        });
      }
    });

    this.onMessage('end_match', async (client, message: { winnerUserId?: string; reason?: string }) => {
      const { winnerUserId, reason } = message;
      await this.redis.publish(RedisKeys.matchEventsChannel, JSON.stringify({ type: 'match_end_request', matchId: this.matchId, winnerUserId, reason }));
      await this.endMatch(reason || 'manual');
    });
  }

  async onAuth(client: Client, options: { userId: string }) {
    const { userId } = options;
    
    console.log(`onAuth - userId: ${userId}, sessionId: ${client.sessionId}, existing clients: ${this.clients.length}, connecting: ${Array.from(this.connectingUserIds).join(', ')}`);
    
    // Check if this userId is already connected or currently connecting
    if (this.userIdToSession[userId]) {
      const existingSession = this.userIdToSession[userId];
      if (existingSession !== client.sessionId) {
        // Different session - allow reconnection, kick old one
        console.log(`User ${userId} reconnecting, kicking old session ${existingSession}`);
        const prev = this.clients.find((c) => c.sessionId === existingSession);
        if (prev) {
          this.connectingUserIds.delete(userId);
          delete this.userIdToSession[userId];
          try { await prev.leave(1000); } catch {}
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        // Same session - duplicate join
        console.log(`REJECTING duplicate join from same session`);
        return false;
      }
    }
    
    // Check if this userId is currently in the process of connecting
    if (this.connectingUserIds.has(userId)) {
      console.log(`REJECTING - User ${userId} is already connecting to this room`);
      return false;
    }
    
    // Mark this userId as connecting
    this.connectingUserIds.add(userId);
    console.log(`Auth approved for userId: ${userId}`);
    return { userId };
  }

  async onJoin(client: Client, options: { userId: string }) {
    const { userId } = options;
    const currentUserIds = Object.keys(this.userIdToSession);
    console.log(`onJoin - userId: ${userId}, current clients: ${this.clients.length}/${this.maxClients}, current users: ${currentUserIds.join(', ')}, locked: ${this.locked}`);
    
    this.ensurePlayer(userId);
    this.userIdToSession[userId] = client.sessionId;
    
    // Add userId to players object if not already there
    await this.updateMatchBlob((obj) => {
      obj.players = obj.players || {};
      if (!obj.players[userId]) {
        obj.players[userId] = { username: userId }; // Will be updated with actual username later
      }
    });
    
    // Remove from connecting set since they've successfully joined
    this.connectingUserIds.delete(userId);
    
    console.log(`User ${userId} joined successfully. Total unique users in room: ${Object.keys(this.userIdToSession).length}`);
    
    // Send match info to the client via WebSocket
    const matchKey = RedisKeys.matchKey(this.matchId);
    const matchData = await this.redis.get(matchKey);
    
    if (matchData) {
      const matchObj = JSON.parse(matchData);
      
      // Send match initialization data
      client.send('match_init', {
        matchId: this.matchId,
        startedAt: matchObj.startedAt || new Date(this.startTime).toISOString(),
        problemId: this.problemId,
        linesWritten: matchObj.linesWritten || {},
      });
      
      console.log(`Sent match_init to ${userId}:`, {
        matchId: this.matchId,
        startedAt: matchObj.startedAt,
      });
    } else {
      // Fallback if no match data in Redis
      client.send('match_init', {
        matchId: this.matchId,
        startedAt: new Date(this.startTime).toISOString(),
        problemId: this.problemId,
        linesWritten: {},
      });
    }
    
    // Track bot players in active matches set
    try {
      const isBot = await this.redis.get(`bots:state:${userId}`);
      if (isBot) {
        console.log(`Bot ${userId} joined match, adding to active set`);
        await this.redis.sadd(RedisKeys.botsActiveSet, userId);
        await this.redis.setex(RedisKeys.botStateKey(userId), 3600, 'playing');
      }
    } catch (error) {
      console.error('Error tracking bot in match:', error);
    }
    
    // CRITICAL: Always keep room unlocked
    this.unlock();
    console.log('Room explicitly unlocked');
  }

  async onLeave(client: Client, consented: boolean) {
    // cleanup mapping if matches
    const userId = Object.keys(this.userIdToSession).find((uid) => this.userIdToSession[uid] === client.sessionId);
    console.log(`onLeave - sessionId: ${client.sessionId}, userId: ${userId}, consented: ${consented}`);
    
    if (userId) {
      delete this.userIdToSession[userId];
      this.connectingUserIds.delete(userId); // Clean up connecting set too
      console.log(`Removed user ${userId}. Remaining users: ${Object.keys(this.userIdToSession).length}`);
    }
    
    // Always unlock when someone leaves so others can join
    this.unlock();
    console.log(`Room unlocked after player left. Current clients: ${this.clients.length - 1}`);
  }

  async onDispose() {
    console.log(`MatchRoom disposed - matchId: ${this.matchId}`);
    // Room disposal happens only when match ends (via disconnect() in endMatch)
    // NOT when players disconnect temporarily
    
    // Clear all bot completion timers
    for (const botId of Object.keys(this.botCompletionTimers)) {
      try {
        if (this.botCompletionTimers[botId] && typeof this.botCompletionTimers[botId].clear === 'function') {
          this.botCompletionTimers[botId].clear();
        }
      } catch {}
    }
    this.botCompletionTimers = {};
    
    // Clean up bot simulation timers
    for (const botUserId of Object.keys(this.botSimulationTimers)) {
      this.stopBotSimulation(botUserId);
    }
    
    // Clean up bot states and notify bot service of match completion
    try {
      // Get player information from Redis instead of undefined state
      const matchKey = RedisKeys.matchKey(this.matchId);
      const matchRaw = await this.redis.get(matchKey);
      
      if (matchRaw) {
        const matchData = JSON.parse(matchRaw);
        const playersField = matchData.players;
        const playerIds: string[] = Array.isArray(playersField)
          ? playersField
          : (playersField && typeof playersField === 'object')
            ? Object.keys(playersField)
            : [];

        for (const playerId of playerIds) {
          // Check if this player is a bot
          const isBot = await this.redis.get(`bots:state:${playerId}`);
          if (isBot) {
            console.log(`Cleaning up bot state for ${playerId} after match completion`);
            
            // Remove bot from active matches set
            await this.redis.srem(RedisKeys.botsActiveSet, playerId);
            
            // Clear bot state
            await this.redis.del(RedisKeys.botStateKey(playerId));
            
            // Notify bot service that this bot completed a match
            await this.redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({
              type: 'botMatchComplete',
              botId: playerId
            }));
            
            console.log(`Notified bot service that bot ${playerId} completed match`);
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning up bot states:', error);
    }
  }

  private ensurePlayer(userId: string) {
    // State is stored in Redis, not in Colyseus state
    // if (!this.state.players[userId]) {
    //   this.state.players[userId] = { code: {}, linesWritten: 0, submissions: [], testSubmissions: [], languages: [] };
    // }
  }

  private ensureLanguage(userId: string, language: string) {
    // State is stored in Redis, not in Colyseus state
    // const ps = this.state.players[userId];
    // if (!ps.languages.includes(language)) {
    //   ps.languages.push(language);
    // }
  }

  private async persistCode(userId: string, language: string, code: string, lines: number) {
    const key = RedisKeys.matchKey(this.matchId);
    const raw = await this.redis.get(key);
    let obj: any = raw ? JSON.parse(raw) : {};
    obj.playersCode = obj.playersCode || {};
    obj.playersCode[userId] = obj.playersCode[userId] || {};
    obj.playersCode[userId][language] = code;
    obj.linesWritten = obj.linesWritten || {};
    obj.linesWritten[userId] = lines;
    await this.redis.set(key, JSON.stringify(obj));
    await this.redis.expire(key, 3600);
  }

  private async endMatch(reason: string) {
    // Calculate match duration in milliseconds
    this.matchDuration = Date.now() - this.startTime;
    console.log(`Match ${this.matchId} ended after ${this.matchDuration}ms (${Math.round(this.matchDuration / 1000)}s)`);
    
    // Check if we need to calculate rating changes (if no winner determined yet)
    const matchKey = RedisKeys.matchKey(this.matchId);
    const matchRaw = await this.redis.get(matchKey);
    let needsRatingCalculation = false;
    let winnerUserId = null;
    
    if (matchRaw) {
      const matchData = JSON.parse(matchRaw);
      if (!matchData.winnerUserId && !matchData.ratingChanges) {
        needsRatingCalculation = true;
        // For disconnections, treat as draw unless one player clearly won
        if (reason.includes('winner_')) {
          winnerUserId = reason.replace('winner_', '');
        }
      }
    }
    
    // Calculate rating changes if needed
    if (needsRatingCalculation) {
      console.log(`Calculating rating changes for match end reason: ${reason}, winner: ${winnerUserId || 'none'}`);
      const ratingChanges = await this.calculateRatingChanges(winnerUserId, !winnerUserId);
      await this.updateMatchBlob((obj) => {
        obj.ratingChanges = ratingChanges;
        if (winnerUserId) {
          obj.winnerUserId = winnerUserId;
        }
      });
      await this.persistRatings(ratingChanges, winnerUserId, !winnerUserId);
      
      if (winnerUserId) {
        this.broadcast('match_winner', { userId: winnerUserId, reason, ratingChanges });
      } else {
        this.broadcast('match_draw', { reason, ratingChanges });
      }
    }
    
    // Update match state in Redis before publishing event
    await this.updateMatchBlob((obj) => {
      obj.status = 'finished';
      obj.endedAt = obj.endedAt || new Date().toISOString();
      // winnerUserId is already set for wins; for timeouts we won't set extra flags
      // Store final bot stats
      obj.botStats = this.botStats;
    });

    // Handle guest user match storage
    await this.handleGuestMatchStorage();

    // Clear all bot completion timers
    for (const botId of Object.keys(this.botCompletionTimers)) {
      try {
        if (this.botCompletionTimers[botId] && typeof this.botCompletionTimers[botId].clear === 'function') {
          this.botCompletionTimers[botId].clear();
        }
      } catch {}
    }
    this.botCompletionTimers = {};
    
    // Clean up bot simulation timers
    for (const botUserId of Object.keys(this.botSimulationTimers)) {
      this.stopBotSimulation(botUserId);
    }

    const matchKeyForCleanup = RedisKeys.matchKey(this.matchId);
    try {
      // Clear reservations for both players ONLY when match actually ends
      const matchRaw = await this.redis.get(matchKeyForCleanup);
      if (matchRaw) {
        const matchData = JSON.parse(matchRaw);
        const playersField = matchData.players;
        const playerIds: string[] = Array.isArray(playersField)
          ? playersField
          : (playersField && typeof playersField === 'object')
            ? Object.keys(playersField)
            : [];

        for (const playerId of playerIds) {
          try {
            await this.redis.del(`queue:reservation:${playerId}`);
            console.log(`Cleared reservation for player ${playerId} - match ended`);
          } catch (err) {
            console.warn(`Failed clearing reservation for ${playerId}:`, err);
          }
        }
      }
    } finally {
      // Always publish end event and remove from active set
      try {
        await this.redis.publish(
          RedisKeys.matchEventsChannel,
          JSON.stringify({ type: 'match_end', matchId: this.matchId, reason, at: Date.now() })
        );
      } catch (err) {
        console.warn('Failed publishing match_end event:', err);
      }
      try {
        await this.redis.srem(RedisKeys.activeMatchesSet, this.matchId);
        
        // Remove bots from active set
        const ratingsKey = `match:${this.matchId}:ratings`;
        const userId1 = await this.redis.hget(ratingsKey, 'userId1');
        const userId2 = await this.redis.hget(ratingsKey, 'userId2');
        const players = [userId1, userId2].filter(Boolean) as string[];
        
          for (const playerId of players) {
            if (playerId && await this.isBotUser(playerId)) {
              const wasActive = await this.redis.srem(RedisKeys.botsActiveSet, playerId);
              if (wasActive) {
                // This was a bot that was active, trigger rotation
                console.log(`Bot ${playerId} completed match, triggering rotation`);
                await this.redis.publish(
                  RedisKeys.botsCommandsChannel,
                  JSON.stringify({ type: 'botMatchComplete', botId: playerId })
                );
              }
            }
          }
      } catch (err) {
        console.warn('Failed removing match from active set:', err);
      }
      // Disconnect room regardless to trigger disposal
      this.disconnect();
    }
  }

  private async handleGuestMatchStorage() {
    try {
      // Check if any player is a guest user
      const matchKey = RedisKeys.matchKey(this.matchId);
      const matchRaw = await this.redis.get(matchKey);
      
      if (!matchRaw) return;
      
      const matchData = JSON.parse(matchRaw);
      const players = matchData.players || {};
      const playerIds = Object.keys(players);
      
      // Find guest user
      const guestUserId = playerIds.find(id => id.startsWith('guest_'));
      if (!guestUserId) return;
      
      // Get opponent ID (should be the bot)
      const opponentId = playerIds.find(id => id !== guestUserId);
      if (!opponentId) return;
      
      // Determine match result for guest
      let result = 'draw';
      if (matchData.winnerUserId === guestUserId) {
        result = 'win';
      } else if (matchData.winnerUserId === opponentId) {
        result = 'loss';
      }
      
      // Get guest's submissions and test results
      const guestSubmissions = matchData.submissions || [];
      const guestSubmissionsData = guestSubmissions
        .filter((sub: any) => sub.userId === guestUserId)
        .map((sub: any) => ({
          language: sub.language,
          code: sub.code,
          passed: sub.passed,
          testResults: sub.testResults,
          timestamp: sub.timestamp
        }));
      
      // Calculate tests passed
      const latestSubmission = guestSubmissionsData[guestSubmissionsData.length - 1];
      const testsPassed = latestSubmission?.testResults?.filter((t: any) => t.status === 3).length || 0;
      const totalTests = latestSubmission?.testResults?.length || 0;
      
      // Store guest match data in Redis with 3-hour TTL
      const guestMatchData = {
        matchId: this.matchId,
        guestId: guestUserId,
        opponentId: opponentId,
        problemId: this.problemId,
        result: result,
        submissions: guestSubmissionsData,
        testsPassed: testsPassed,
        totalTests: totalTests,
        completedAt: Date.now()
      };
      
      await this.redis.setex(
        RedisKeys.guestMatchKey(guestUserId), 
        3 * 3600, // 3 hours TTL
        JSON.stringify(guestMatchData)
      );
      
      console.log(`Stored guest match data for ${guestUserId}: ${result}, ${testsPassed}/${totalTests} tests passed`);
    } catch (error) {
      console.error('Error storing guest match data:', error);
    }
  }

  private async updateMatchBlob(mutator: (obj: any) => void) {
    const key = RedisKeys.matchKey(this.matchId);
    const raw = await this.redis.get(key);
    let obj: any = raw ? JSON.parse(raw) : {};
    mutator(obj);
    await this.redis.set(key, JSON.stringify(obj));
    // Extend expiration time to ensure data persists for match history
    await this.redis.expire(key, 86400); // 24 hours
  }

  private async createInitialMatchDocument() {
    try {
      const client = await getMongoClient();
      const db = client.db(DB_NAME);
      const matches = db.collection('matches') as any;
      
      // Create initial match document with startedAt
      await matches.updateOne(
        { _id: new ObjectId(this.matchId) },
        {
          $set: {
            startedAt: new Date(this.startTime),
            problemId: new ObjectId(this.problemId),
            status: 'ongoing',
            playerIds: []
          },
          $setOnInsert: {
            submissionIds: []
          }
        },
        { upsert: true }
      );
      
      console.log(`Created initial match document for ${this.matchId} with startedAt: ${new Date(this.startTime).toISOString()}`);
    } catch (error) {
      console.error('Failed to create initial match document:', error);
    }
  }

  private async createBotCompletionSubmission(botUserId: string) {
    try {
      const client = await getMongoClient();
      const db = client.db(DB_NAME);
      const submissions = db.collection('submissions') as any;
      
      // Create a submission document for bot completion
      const submissionDoc = {
        matchId: new ObjectId(this.matchId),
        problemId: new ObjectId(this.problemId),
        userId: new ObjectId(botUserId),
        language: 'javascript', // Default language for bot
        sourceCode: '// Bot completed the problem', // Placeholder code
        passed: true,
        testResults: [], // Bot automatically passes all tests
        averageTime: 0,
        averageMemory: 0,
        testsPassed: this.problemData?.testCases?.length || 0, // Bot passes all test cases
        totalTests: this.problemData?.testCases?.length || 0,
        timestamp: new Date(),
        createdAt: new Date(),
        isBotCompletion: true
      };
      
      const result = await submissions.insertOne(submissionDoc);
      const submissionId = result.insertedId;
      
      console.log(`Created bot completion submission ${submissionId} for bot ${botUserId}`);
      
      // Update match document with submission ID
      const matches = db.collection('matches') as any;
      await matches.updateOne(
        { _id: new ObjectId(this.matchId) },
        { 
          $addToSet: { submissionIds: submissionId }
        }
      );
      
      console.log(`Added bot completion submission ${submissionId} to match ${this.matchId}`);
    } catch (error) {
      console.error('Failed to create bot completion submission:', error);
    }
  }

  // Calculate and store bot completion times immediately when room is created
  private async calculateAndStoreBotCompletionTimes() {
    try {
      // Get player IDs from options passed during room creation
      const userId1 = (this as any).player1Id;
      const userId2 = (this as any).player2Id;
      
      if (!userId1 || !userId2) {
        console.log('Player IDs not provided in room options, skipping bot completion time calculation');
        return;
      }
      
      const players = [userId1, userId2];
      console.log(`Calculating bot completion times for players: ${players.join(', ')}`);
      
      // Track all bots and their completion times
      const botCompletionData: Array<{ botId: string; completionMs: number }> = [];
      
      for (const playerId of players) {
        try {
          // Check if this is a bot
          const bot = await this.isBotUser(playerId);
          if (bot) {
            console.log(`Player ${playerId} is a bot, calculating completion time`);
            
            const problemDifficulty = (this.problemData?.difficulty || 'Medium') as 'Easy' | 'Medium' | 'Hard';
            const completionMs = this.sampleBotCompletionMs(problemDifficulty, this.matchId, playerId);
            
            if (completionMs < this.maxDuration) {
              console.log(`Storing bot completion time for ${playerId}: ${completionMs}ms`);
              
              await this.updateMatchBlob((obj) => {
                if (!obj.botCompletionTimes) obj.botCompletionTimes = {};
                obj.botCompletionTimes[playerId] = {
                  plannedCompletionMs: completionMs,
                  plannedCompletionTime: new Date(Date.now() + completionMs).toISOString()
                };
              });
              
              // Add bot to completion data for timer scheduling
              botCompletionData.push({ botId: playerId, completionMs });
              
              console.log(`Bot completion time stored for ${playerId}: ${completionMs}ms`);
            } else {
              console.log(`Bot completion time ${completionMs}ms exceeds max duration, not storing`);
            }
          } else {
            console.log(`Player ${playerId} is not a bot`);
          }
        } catch (error) {
          console.warn(`Failed to check if ${playerId} is a bot:`, error);
        }
      }
      
      // Start bot simulation and schedule completion timers for ALL bots
      for (const { botId, completionMs } of botCompletionData) {
        console.log(`🤖 Bot detected in match ${this.matchId}: ${botId}`);
        this.startBotSimulation(botId);
        
        console.log(`Scheduling bot completion timer for ${botId} in ${completionMs}ms`);
        
        this.botCompletionTimers[botId] = this.clock.setTimeout(async () => {
          try {
            console.log(`🤖 Bot completion timer fired for ${botId} in match ${this.matchId}`);
            
            // Check if match is already finished
            const matchKey = RedisKeys.matchKey(this.matchId);
            const matchRaw = await this.redis.get(matchKey);
            if (matchRaw) {
              const matchData = JSON.parse(matchRaw);
              if (matchData.status === 'finished' || matchData.winnerUserId) {
                console.log(`Match ${this.matchId} already finished, skipping bot ${botId} completion`);
                return;
              }
            }
            
            console.log(`🤖 Bot ${botId} completing match ${this.matchId} - creating submission`);
            
            // Create a submission document for bot completion
            await this.createBotCompletionSubmission(botId);
            
            console.log(`🤖 Bot ${botId} submission created, declaring winner`);
            
            // Mark bot as completed by simulating a perfect submission outcome
            const winnerId = botId; // Bot wins by completing first
            await this.updateMatchBlob((obj) => {
              obj.winnerUserId = winnerId;
              obj.endedAt = new Date().toISOString();
              obj.status = 'finished';
            });
            const ratingChanges = await this.calculateRatingChanges(winnerId, false);
            await this.updateMatchBlob((obj) => { obj.ratingChanges = ratingChanges; });
            await this.persistRatings(ratingChanges, winnerId, false);
            
            console.log(`🤖 Bot ${botId} declared winner, broadcasting match_winner`);
            this.broadcast('match_winner', { userId: winnerId, reason: 'bot_completion', ratingChanges });
            await this.endMatch('bot_completion');
            
            console.log(`🤖 Bot ${botId} match ended successfully`);
          } catch (err) {
            console.error('Bot completion error:', err);
          }
        }, completionMs);
      }
    } catch (error) {
      console.error('Failed to calculate bot completion times:', error);
    }
  }

  // Persist rating changes to MongoDB and invalidate caches
  private async persistRatings(
    ratingChanges: Record<string, { oldRating: number; newRating: number; change: number }>,
    winnerUserId: string | null,
    isDraw: boolean
  ) {
    // Ensure matchDuration is calculated if not already set
    if (this.matchDuration === undefined || this.matchDuration === null) {
      this.matchDuration = Date.now() - this.startTime;
      console.log(`Calculated matchDuration in persistRatings: ${this.matchDuration}ms`);
    }
    try {
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      const users = db.collection('users');
      const bots = db.collection('bots');
      const matches = db.collection('matches');

      const playerIds = Object.keys(ratingChanges);
      if (playerIds.length !== 2) return;

      // Prepare rating change doc for match
      const ratingChangesDoc: Record<string, { change: number; old: number; new: number }> = {};
      for (const [uid, rc] of Object.entries(ratingChanges)) {
        ratingChangesDoc[uid] = { change: rc.change, old: rc.oldRating, new: rc.newRating };
      }

      // Upsert match document with final linkage
      try {
        // Get ObjectIds for players (bots need special handling)
        const playerObjectIds = [];
        for (const playerId of playerIds) {
          if (await this.isBotUser(playerId)) {
            // PlayerId is already the MongoDB ObjectId for bots
            try {
              playerObjectIds.push(new ObjectId(playerId));
            } catch {
              console.warn(`Invalid ObjectId for bot ${playerId}`);
              continue;
            }
          } else {
            // Regular user with ObjectId
            try {
              playerObjectIds.push(new ObjectId(playerId));
            } catch {
              console.warn(`Invalid ObjectId for user ${playerId}`);
              continue;
            }
          }
        }

        let problemIdValue: any = this.problemId;
        try { 
          // Only convert to ObjectId if it's a valid 24-character hex string
          if (this.problemId && this.problemId.length === 24 && /^[0-9a-fA-F]+$/.test(this.problemId)) {
            problemIdValue = new ObjectId(this.problemId); 
          }
        } catch {}
        
        // Get winner ObjectId
        let winnerObjectId = null;
        if (winnerUserId) {
          if (await this.isBotUser(winnerUserId)) {
            // WinnerUserId is already the MongoDB ObjectId for bots
            try {
              winnerObjectId = new ObjectId(winnerUserId);
            } catch {
              console.warn(`Invalid ObjectId for winner bot ${winnerUserId}`);
            }
          } else {
            try {
              winnerObjectId = new ObjectId(winnerUserId);
            } catch {}
          }
        }

        await matches.updateOne(
          { _id: new ObjectId(this.matchId) },
          {
            $set: {
              playerIds: playerObjectIds,
              problemId: problemIdValue,
              winnerUserId: winnerObjectId,
              endedAt: new Date(),
              status: 'finished',
              ratingChanges: ratingChangesDoc,
              startedAt: new Date(this.startTime),
              botStats: this.botStats
            },
            $setOnInsert: {
              submissionIds: []
            }
          },
          { upsert: true }
        );
      } catch (err) {
        console.warn('Failed to upsert match document:', err);
      }

      for (const playerId of playerIds) {
        const change = ratingChanges[playerId]?.change ?? 0;

        const statUpdate: any = { 
          'stats.totalMatches': 1, 
          'stats.rating': change,
          'stats.timeCoded': this.matchDuration || 0 // Add time coded in milliseconds, default to 0 if undefined
        };
        if (isDraw) {
          statUpdate['stats.draws'] = 1;
        } else if (winnerUserId === playerId) {
          statUpdate['stats.wins'] = 1;
        } else {
          statUpdate['stats.losses'] = 1;
        }

        if (await this.isBotUser(playerId)) {
          // Update bot stats and add match to history
          console.log(`🤖 Updating bot stats for ${playerId}, change: ${change}, isDraw: ${isDraw}, winnerUserId: ${winnerUserId}`);
          try {
            // Validate ObjectId format
            let botObjectId: ObjectId;
            try {
              botObjectId = new ObjectId(playerId);
            } catch (error) {
              console.error(`Invalid bot ID format: ${playerId}`, error);
              continue;
            }
            
            // Ensure bot has proper stats structure before updating
            const botDoc = await bots.findOne({ _id: botObjectId });
            if (!botDoc) {
              console.error(`Bot ${playerId} not found in database`);
              continue;
            }
            console.log(`🤖 Found bot document for ${playerId}:`, botDoc.username, 'current rating:', botDoc.stats?.rating);
            
            // Initialize stats if missing
            if (!botDoc.stats) {
              await bots.updateOne(
                { _id: botObjectId },
                { 
                  $set: { 
                    stats: { 
                      rating: 1200, 
                      wins: 0, 
                      losses: 0, 
                      draws: 0, 
                      totalMatches: 0,
                      timeCoded: 0
                    },
                    updatedAt: new Date()
                  }
                }
              );
              console.log(`Initialized stats for bot ${playerId}`);
            }
            
            // Update bot stats with proper rating calculation
            const currentRating = botDoc.stats?.rating || 1200;
            const newRating = currentRating + change;
            
            console.log(`🤖 Updating bot ${playerId}: ${currentRating} -> ${newRating} (change: ${change})`);
            console.log(`🤖 Match result: ${isDraw ? 'draw' : (winnerUserId === playerId ? 'win' : 'loss')}`);
            
            const updateResult = await bots.updateOne(
              { _id: botObjectId },
              { 
                $inc: { 
                  'stats.totalMatches': 1, 
                  'stats.draws': isDraw ? 1 : 0, 
                  'stats.wins': (winnerUserId === playerId && !isDraw) ? 1 : 0, 
                  'stats.losses': (winnerUserId !== playerId && !isDraw) ? 1 : 0,
                  'stats.timeCoded': this.matchDuration || 0 // Add time coded in milliseconds, default to 0 if undefined
                },
                $set: { 'stats.rating': newRating, updatedAt: new Date() },
                $push: { matchIds: new ObjectId(this.matchId) } as any
              }
            );
            
            console.log(`🤖 Bot ${playerId} rating updated: ${currentRating} -> ${newRating} (change: ${change}), match result: ${isDraw ? 'draw' : (winnerUserId === playerId ? 'win' : 'loss')}, updateResult:`, updateResult);
          } catch (err) {
            console.error(`Failed to update bot ${playerId} stats:`, err);
          }
        } else {
          // Update user stats
          try {
            // Validate ObjectId format
            let objectId: ObjectId;
            try {
              objectId = new ObjectId(playerId);
            } catch (error) {
              console.error(`Invalid user ID format: ${playerId}`, error);
              continue;
            }
            
            // Ensure defaults then increment
            await users.updateOne(
              { _id: objectId },
              { $setOnInsert: { 'stats.wins': 0, 'stats.losses': 0, 'stats.draws': 0, 'stats.totalMatches': 0, 'stats.rating': 1200, 'stats.timeCoded': 0 } },
              { upsert: true }
            );
            await users.updateOne(
              { _id: objectId },
              { $inc: statUpdate }
            );

            // Link this match to the user
            try {
              await users.updateOne(
                { _id: objectId },
                { $addToSet: { matchIds: new ObjectId(this.matchId) } }
              );
            } catch (linkErr) {
              console.warn(`Failed to add match ${this.matchId} to user ${playerId}:`, linkErr);
            }
          } catch (err) {
            console.warn(`Failed to update user ${playerId} stats:`, err);
          }
        }

        // Invalidate cached stats for this user/bot
        try {
          const statsCacheKey = `user:${playerId}:stats`;
          await this.redis.del(statsCacheKey);
          
          // Also invalidate activity cache
          const activityCacheKey = `user:${playerId}:activity`;
          await this.redis.del(activityCacheKey);
        } catch {}
      }
    } catch (err) {
      console.error('Failed persisting rating changes:', err);
    }
  }

  // Deterministic RNG using simple xorshift32 seeded by matchId HMAC or hash
  private createSeededRng(seedString: string): () => number {
    let h = 2166136261;
    for (let i = 0; i < seedString.length; i++) {
      h ^= seedString.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let state = h >>> 0;
    return () => {
      state ^= state << 13; state >>>= 0;
      state ^= state >>> 17; state >>>= 0;
      state ^= state << 5; state >>>= 0;
      return (state >>> 0) / 4294967296;
    };
  }

  private async isBotUser(userId: string): Promise<boolean> {
    try {
      // Guest users are not bots
      if (userId.startsWith('guest_')) {
        return false;
      }
      
      // Check if this is a valid ObjectId format first
      if (!ObjectId.isValid(userId)) {
        return false;
      }
      
      // getMongoClient is already available in this file
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      const bots = db.collection('bots');
      
      const bot = await bots.findOne({ _id: new ObjectId(userId) });
      return bot !== null;
    } catch (error) {
      console.warn('Failed to check if user is bot:', error);
      return false;
    }
  }

  // Sample completion time in ms from configured distribution. If no config, return +Infinity.
  private sampleBotCompletionMs(difficulty: 'Easy' | 'Medium' | 'Hard', matchId: string, botId: string): number {
    const dist = (process.env.BOT_TIME_DIST || 'lognormal').toLowerCase();
    const rng = this.createSeededRng(`${matchId}:${difficulty}:${botId}`);

    // Parse params from env JSON per difficulty
    const envKey = `BOT_TIME_PARAMS_${difficulty.toUpperCase()}`;
    const raw = process.env[envKey];
    if (!raw) return Number.POSITIVE_INFINITY;
    let params: any;
    try { params = JSON.parse(raw); } catch { return Number.POSITIVE_INFINITY; }

    if (dist === 'gamma') {
      const k = Number(params.shapeK);
      const scaleMin = Number(params.scaleMinutes);
      if (!isFinite(k) || !isFinite(scaleMin) || k <= 0 || scaleMin <= 0) return Number.POSITIVE_INFINITY;
      // Marsaglia and Tsang method for Gamma(k, theta) where theta in minutes
      const theta = scaleMin * 60 * 1000; // minutes -> ms per unit
      const sampleGamma = (shape: number): number => {
        if (shape < 1) {
          const u = rng();
          return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
        }
        const d = shape - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);
        while (true) {
          let x = 0, v = 0, u = 0;
          // Box-Muller for normal
          const u1 = Math.max(1e-12, rng());
          const u2 = Math.max(1e-12, rng());
          const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          x = z;
          v = Math.pow(1 + c * x, 3);
          if (v <= 0) continue;
          u = rng();
          if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v;
          if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
        }
      };
      const minutes = sampleGamma(k) * (theta / (60 * 1000));
      return Math.max(0, Math.floor(minutes * 60 * 1000));
    }

    // Default: lognormal with params { muMinutes, sigma }
    const muMin = Number(params.muMinutes);
    const sigma = Number(params.sigma);
    if (!isFinite(muMin) || !isFinite(sigma) || sigma <= 0 || muMin <= 0) return Number.POSITIVE_INFINITY;
    const u1 = Math.max(1e-12, rng());
    const u2 = Math.max(1e-12, rng());
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // N(0,1)
    const minutes = Math.exp(Math.log(muMin) + sigma * z);
    return Math.max(0, Math.floor(minutes * 60 * 1000));
  }

  private clientSendRateLimit(client: Client, action: string) {
    // inform client about rate limiting
    try {
      client.send('rate_limit', { action });
    } catch {}
  }

  /**
   * Calculate rating changes for both players based on match result
   */
  private async calculateRatingChanges(winnerUserId: string | null, isDraw: boolean): Promise<Record<string, { oldRating: number; newRating: number; change: number }>> {
    try {
      // Get match data to find player IDs
      const matchKey = RedisKeys.matchKey(this.matchId);
      const matchRaw = await this.redis.get(matchKey);
      if (!matchRaw) {
        console.error('Match data not found for rating calculation');
        return {};
      }

      const matchData = JSON.parse(matchRaw);
      const playersField = matchData.players;
      const playerIds: string[] = Array.isArray(playersField)
        ? playersField
        : (playersField && typeof playersField === 'object')
          ? Object.keys(playersField)
          : [];

      if (playerIds.length !== 2) {
        console.error('Invalid player count for rating calculation:', playerIds.length);
        return {};
      }

      // Get player ratings from MongoDB (check both users and bots collections)
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      const users = db.collection('users');
      const bots = db.collection('bots');

      // Validate and convert player IDs to ObjectIds
      let player1Id: ObjectId;
      let player2Id: ObjectId;
      
      try {
        player1Id = new ObjectId(playerIds[0]);
      } catch (error) {
        console.error(`Invalid player1 ID format: ${playerIds[0]}`, error);
        return {};
      }
      
      try {
        player2Id = new ObjectId(playerIds[1]);
      } catch (error) {
        console.error(`Invalid player2 ID format: ${playerIds[1]}`, error);
        return {};
      }

      // Get ratings for both players, checking both users and bots collections
      let player1Rating = 1200;
      let player2Rating = 1200;

      // Check if player1 is a bot
      const player1Bot = await bots.findOne({ _id: player1Id }, { projection: { 'stats.rating': 1 } });
      if (player1Bot) {
        player1Rating = player1Bot.stats?.rating || 1200;
        console.log(`Player1 ${playerIds[0]} is a bot with rating ${player1Rating}`);
      } else {
        const player1User = await users.findOne({ _id: player1Id }, { projection: { 'stats.rating': 1 } });
        player1Rating = player1User?.stats?.rating || 1200;
        console.log(`Player1 ${playerIds[0]} is a user with rating ${player1Rating}`);
      }

      // Check if player2 is a bot
      const player2Bot = await bots.findOne({ _id: player2Id }, { projection: { 'stats.rating': 1 } });
      if (player2Bot) {
        player2Rating = player2Bot.stats?.rating || 1200;
        console.log(`Player2 ${playerIds[1]} is a bot with rating ${player2Rating}`);
      } else {
        const player2User = await users.findOne({ _id: player2Id }, { projection: { 'stats.rating': 1 } });
        player2Rating = player2User?.stats?.rating || 1200;
        console.log(`Player2 ${playerIds[1]} is a user with rating ${player2Rating}`);
      }

      // Difficulty-aware scaling using problemElo from ratings hash
      const problemEloRaw = await this.redis.hget(`match:${this.matchId}:ratings`, 'problemElo');
      const problemElo = problemEloRaw ? parseInt(problemEloRaw) : 1500;
      const player1Factor = calculateDifficultyMultiplier(player1Rating, problemElo);
      const player2Factor = calculateDifficultyMultiplier(player2Rating, problemElo);

      // Calculate ELO changes
      const K = 32;
      let player1Change: number;
      let player2Change: number;

      if (isDraw) {
        const expectedPlayer1 = 1 / (1 + Math.pow(10, (player2Rating - player1Rating) / 400));
        const expectedPlayer2 = 1 / (1 + Math.pow(10, (player1Rating - player2Rating) / 400));
        const baseP1 = K * (0.5 - expectedPlayer1);
        const baseP2 = K * (0.5 - expectedPlayer2);
        player1Change = applyDifficultyAdjustment(baseP1, player1Factor);
        player2Change = applyDifficultyAdjustment(baseP2, player2Factor);
      } else {
        // Determine winner and loser
        const isPlayer1Winner = winnerUserId === playerIds[0];
        const winnerRating = isPlayer1Winner ? player1Rating : player2Rating;
        const loserRating = isPlayer1Winner ? player2Rating : player1Rating;

        const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
        const expectedLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));
        const baseWinner = K * (1 - expectedWinner);
        const baseLoser = K * (0 - expectedLoser);
        const winnerFactor = calculateDifficultyMultiplier(winnerRating, problemElo);
        const loserFactor = calculateDifficultyMultiplier(loserRating, problemElo);
        const adjWinner = applyDifficultyAdjustment(baseWinner, winnerFactor);
        const adjLoser = applyDifficultyAdjustment(baseLoser, loserFactor);
        player1Change = isPlayer1Winner ? adjWinner : adjLoser;
        player2Change = isPlayer1Winner ? adjLoser : adjWinner;
      }

      return {
        [playerIds[0]]: {
          oldRating: player1Rating,
          newRating: player1Rating + player1Change,
          change: player1Change
        },
        [playerIds[1]]: {
          oldRating: player2Rating,
          newRating: player2Rating + player2Change,
          change: player2Change
        }
      };
    } catch (error) {
      console.error('Error calculating rating changes:', error);
      return {};
    }
  }

  // Bot simulation methods
  private startBotSimulation(botUserId: string) {
    console.log(`🤖 Starting bot simulation for ${botUserId}`);
    console.log(`🤖 Problem data:`, this.problemData?.title, 'Test cases:', this.problemData?.testCasesCount);
    
    // Initialize bot simulation state
    this.botSimulationState[botUserId] = {
      currentLines: 0,
      currentTests: 0,
      maxTests: this.problemData?.testCasesCount || 10
    };
    
    // Initialize bot stats
    this.botStats[botUserId] = {
      submissions: 0,
      testCasesSolved: 0
    };
    
    console.log(`🤖 Bot simulation state initialized:`, this.botSimulationState[botUserId]);
    
    // Start code simulation
    this.scheduleBotCodeUpdate(botUserId);
    
    // Start test case simulation (less frequent)
    this.scheduleBotTestCaseUpdate(botUserId);
    
    console.log(`🤖 Bot simulation timers scheduled for ${botUserId}`);
  }

  private stopBotSimulation(botUserId: string) {
    console.log(`Stopping bot simulation for ${botUserId}`);
    
    // Clear timers
    if (this.botSimulationTimers[botUserId]) {
      if (this.botSimulationTimers[botUserId].codeTimer) {
        this.botSimulationTimers[botUserId].codeTimer.clear();
      }
      if (this.botSimulationTimers[botUserId].testTimer) {
        this.botSimulationTimers[botUserId].testTimer.clear();
      }
      delete this.botSimulationTimers[botUserId];
    }
    
    // Clear state
    delete this.botSimulationState[botUserId];
    delete this.botStats[botUserId];
  }

  private scheduleBotCodeUpdate(botUserId: string) {
    // Random interval between 1-60 seconds
    const interval = Math.random() * 59000 + 1000; // 1-60 seconds
    
    const timer = this.clock.setTimeout(() => {
      this.performBotCodeUpdate(botUserId);
      // Schedule next update
      this.scheduleBotCodeUpdate(botUserId);
    }, interval);
    
    // Store timer reference
    if (!this.botSimulationTimers[botUserId]) {
      this.botSimulationTimers[botUserId] = { codeTimer: null, testTimer: null };
    }
    this.botSimulationTimers[botUserId].codeTimer = timer;
  }

  private scheduleBotTestCaseUpdate(botUserId: string) {
    // Random interval between 500-1000 seconds (much less frequent than code updates)
    const interval = Math.random() * 500000 + 500000; // 500-1000 seconds
    
    const timer = this.clock.setTimeout(() => {
      this.performBotTestCaseUpdate(botUserId);
      // Schedule next update
      this.scheduleBotTestCaseUpdate(botUserId);
    }, interval);
    
    // Store timer reference
    if (!this.botSimulationTimers[botUserId]) {
      this.botSimulationTimers[botUserId] = { codeTimer: null, testTimer: null };
    }
    this.botSimulationTimers[botUserId].testTimer = timer;
  }

  private performBotCodeUpdate(botUserId: string) {
    console.log(`🤖 performBotCodeUpdate called for ${botUserId}`);
    const state = this.botSimulationState[botUserId];
    if (!state) {
      console.log(`🤖 No state found for bot ${botUserId}`);
      return;
    }
    
    // Random change: 1-2 lines at a time, max 75 total
    const change = Math.floor(Math.random() * 2) + 1; // 1-2 lines
    const newLines = Math.min(state.currentLines + change, 75);
    
    console.log(`🤖 Bot ${botUserId} code change: ${state.currentLines} -> ${newLines} lines (change: +${change})`);
    
    if (newLines !== state.currentLines) {
      state.currentLines = newLines;
      
      // Broadcast code update to all clients
      this.broadcast('code_update', { 
        userId: botUserId, 
        language: 'javascript', // Default language for bot
        lines: newLines 
      });
      
      console.log(`🤖 Bot ${botUserId} code update broadcasted: ${newLines} lines`);
    }
  }

  private async performBotTestCaseUpdate(botUserId: string) {
    console.log(`🤖 performBotTestCaseUpdate called for ${botUserId}`);
    const state = this.botSimulationState[botUserId];
    if (!state) {
      console.log(`🤖 No state found for bot ${botUserId}`);
      return;
    }
    
    // Random change: 0-2 test cases, never decrease, max is problem's testCasesCount
    const change = Math.floor(Math.random() * 3); // 0-2 test cases
    const newTests = Math.min(state.currentTests + change, state.maxTests);
    
    console.log(`🤖 Bot ${botUserId} test change: ${state.currentTests} -> ${newTests} tests (change: +${change})`);
    
    if (newTests !== state.currentTests) {
      state.currentTests = newTests;
      
      // Update bot stats - increment submissions count and update test cases solved
      if (this.botStats[botUserId]) {
        this.botStats[botUserId].submissions += 1;
        this.botStats[botUserId].testCasesSolved = newTests;
        
        // Store bot stats in Redis match blob
        await this.updateMatchBlob((obj) => {
          obj.botStats = this.botStats;
        });
      }
      
      // Broadcast test progress update
      this.broadcast('test_progress_update', {
        userId: botUserId,
        testsPassed: newTests,
        totalTests: state.maxTests
      });
      
      console.log(`🤖 Bot ${botUserId} test update broadcasted: ${newTests}/${state.maxTests} tests passed`);
      console.log(`🤖 Bot ${botUserId} stats updated: submissions=${this.botStats[botUserId]?.submissions}, testCasesSolved=${this.botStats[botUserId]?.testCasesSolved}`);
    }
  }
}


