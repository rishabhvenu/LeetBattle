import { Client, Room } from 'colyseus';
import { getRedis, RedisKeys } from '../lib/redis';
import { executeAllTestCases } from '../lib/testExecutor';
import { getProblemWithTestCases } from '../lib/problemData';
import { analyzeTimeComplexity } from '../lib/complexityAnalyzer';

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
  private lastSubmitAt: Record<string, number> = {};
  private testCounter: Record<string, { windowStart: number; count: number }> = {};
  private userIdToSession: Record<string, string> = {};
  private connectingUserIds: Set<string> = new Set(); // Track users currently connecting

  async onCreate(options: { matchId: string; problemId: string; problemData?: any }) {
    this.matchId = options.matchId;
    this.problemId = options.problemId;
    this.problemData = options.problemData; // Cache if provided
    this.startTime = Date.now();
    
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
      obj.players = obj.players || []; // Initialize players array if not set
      // Always set problem data if we have it
      if (problemData) {
        obj.problem = problemData;
      }
    });
    await this.redis.expire(RedisKeys.matchKey(this.matchId), 3600);

    // End match timer
    this.clock.setInterval(() => {
      if (Date.now() - this.startTime >= this.maxDuration) {
        console.log(`Match ${this.matchId} timed out - declaring draw`);
        this.broadcast('match_draw', { reason: 'timeout' });
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
      
      // rate limit: 1 submit per 2s per user
      const now = Date.now();
      const last = this.lastSubmitAt[userId] || 0;
      if (now - last < 2000) {
        this.clientSendRateLimit(client, 'submit_code');
        return;
      }
      this.lastSubmitAt[userId] = now;

      try {
        // Fetch problem with testCases from MongoDB (cached after first fetch)
        if (!this.problemData) {
          this.problemData = await getProblemWithTestCases(this.problemId);
        }
        const problem = this.problemData;
        
        if (!problem || !problem.signature || !problem.testCases || problem.testCases.length === 0) {
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
              };
              
              await this.updateMatchBlob((obj) => {
                obj.submissions = obj.submissions || [];
                obj.submissions.push(failedSubmission);
              });
              
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
        };
        
        await this.updateMatchBlob((obj) => {
          obj.submissions = obj.submissions || [];
          obj.submissions.push(submission);
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
          this.broadcast('match_winner', { userId, reason: 'all_tests_passed' });
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
    
    // Add userId to players array if not already there
    await this.updateMatchBlob((obj) => {
      obj.players = obj.players || [];
      if (!obj.players.includes(userId)) {
        obj.players.push(userId);
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
    // Update match state in Redis before publishing event
    await this.updateMatchBlob((obj) => {
      obj.status = 'finished';
      obj.endedAt = obj.endedAt || new Date().toISOString();
      obj.endReason = reason;
      // If timeout, ensure no winner is set (draw)
      if (reason === 'timeout' && !obj.winnerUserId) {
        obj.winnerUserId = null;
        obj.isDraw = true;
      }
    });
    
    // Clear reservations for both players ONLY when match actually ends
    const matchKey = RedisKeys.matchKey(this.matchId);
    const matchRaw = await this.redis.get(matchKey);
    if (matchRaw) {
      const matchData = JSON.parse(matchRaw);
      const playerIds = matchData.players || [];
      for (const playerId of playerIds) {
        await this.redis.del(`queue:reservation:${playerId}`);
        console.log(`Cleared reservation for player ${playerId} - match ended`);
      }
    }
    
    await this.redis.publish(RedisKeys.matchEventsChannel, JSON.stringify({ type: 'match_end', matchId: this.matchId, reason, at: Date.now() }));
    await this.redis.srem(RedisKeys.activeMatchesSet, this.matchId);
    this.disconnect();
  }

  private async updateMatchBlob(mutator: (obj: any) => void) {
    const key = RedisKeys.matchKey(this.matchId);
    const raw = await this.redis.get(key);
    let obj: any = raw ? JSON.parse(raw) : {};
    mutator(obj);
    await this.redis.set(key, JSON.stringify(obj));
  }

  private clientSendRateLimit(client: Client, action: string) {
    // inform client about rate limiting
    try {
      client.send('rate_limit', { action });
    } catch {}
  }
}


