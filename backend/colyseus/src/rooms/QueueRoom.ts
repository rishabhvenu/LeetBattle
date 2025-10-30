import { Client, Room } from 'colyseus';
import { getRedis, RedisKeys, addHumanPlayer, removeHumanPlayer, isHumanPlayer, isBotUser } from '../lib/redis';
import { createMatch } from '../lib/matchCreation';

type QueueEntry = { userId: string; rating: number; joinedAt: number };

function now() { return Date.now(); }

// ELO threshold configuration
const ELO_THRESHOLD_INITIAL = parseInt(process.env.QUEUE_ELO_THRESHOLD_INITIAL || '50', 10);
const ELO_THRESHOLD_STEP = parseInt(process.env.QUEUE_ELO_THRESHOLD_STEP || '50', 10);
const ELO_THRESHOLD_MAX = parseInt(process.env.QUEUE_ELO_THRESHOLD_MAX || '250', 10);
const BOT_MATCH_DELAY_MS = parseInt(process.env.QUEUE_BOT_MATCH_DELAY_MS || '45000', 10);
const MIN_QUEUE_WAIT_MS = 3000; // 3 seconds minimum

/**
 * Calculate ELO threshold based on wait time
 */
function getEloThreshold(waitTimeMs: number): number {
  if (waitTimeMs < 10000) return ELO_THRESHOLD_INITIAL; // 0-10s: ±50 ELO
  if (waitTimeMs < 20000) return ELO_THRESHOLD_INITIAL + ELO_THRESHOLD_STEP; // 10-20s: ±100 ELO
  if (waitTimeMs < 30000) return ELO_THRESHOLD_INITIAL + (ELO_THRESHOLD_STEP * 2); // 20-30s: ±150 ELO
  if (waitTimeMs < 45000) return ELO_THRESHOLD_INITIAL + (ELO_THRESHOLD_STEP * 3); // 30-45s: ±200 ELO
  return ELO_THRESHOLD_MAX; // 45s+: ±250 ELO
}

/**
 * Find the best compatible match for a player
 */
function findCompatibleMatch(player: QueueEntry, allQueued: QueueEntry[]): QueueEntry | null {
  const waitTime = now() - player.joinedAt;
  const maxEloDiff = getEloThreshold(waitTime);
  
  // Filter compatible players (excluding self)
  const compatible = allQueued.filter(p => 
    p.userId !== player.userId && 
    Math.abs(p.rating - player.rating) <= maxEloDiff
  );
  
  if (compatible.length === 0) return null;
  
  // Find the closest ELO match
  return compatible.reduce((best, current) => {
    const currentDiff = Math.abs(current.rating - player.rating);
    const bestDiff = Math.abs(best.rating - player.rating);
    return currentDiff < bestDiff ? current : best;
  });
}

export class QueueRoom extends Room {
  maxClients = 1000;
  private redis = getRedis();
  private userIdToClient = new Map<string, Client>(); // userId -> client mapping
  private processingUsers = new Set<string>(); // Track users currently being processed
  private emergencyBotTimers = new Map<string, any>(); // userId -> timer for emergency bot deployment
  private matchmakingInProgress = false;

  async onCreate(options: any) {
    console.log('QueueRoom created - integrated matchmaking enabled');
    
    // Run matchmaking every 5 seconds (not 10 seconds)
    this.clock.setInterval(async () => {
      await this.runMatchmakingCycle();
    }, 5000);
    
    console.log('✅ Matchmaking interval set up - will run every 5 seconds');
  }

  async onJoin(client: Client, options: { userId: string; rating: number }) {
    const { userId, rating } = options;
    
    console.log(`Player ${userId} attempting to join queue with rating ${rating}`);
    
    // Store client mapping
    this.userIdToClient.set(userId, client);
    
    // Check if this is a bot user (used throughout the function)
    const isBot = await isBotUser(userId);
    
    // Check if player already has an active match
    const existingReservation = await this.redis.get(`queue:reservation:${userId}`);
    if (existingReservation) {
      const reservationData = JSON.parse(existingReservation);
      console.log(`Player ${userId} already has an active match: ${reservationData.matchId}`);
      
      if (isBot) {
        // For bots: don't let them queue, just disconnect them
        console.log(`Bot ${userId} already has an active match, preventing queue join`);
        this.cleanupClient(userId);
        client.leave();
        return;
      } else {
        // For humans: send them to the match page
        console.log(`Human player ${userId} already has an active match, redirecting to match page`);
        client.send('already_in_match', { 
          matchId: reservationData.matchId,
          roomId: reservationData.roomId,
          redirectToMatch: true
        });
        
        // Clean up and kick them from queue room
        this.cleanupClient(userId);
        client.leave();
        return;
      }
    }
    
    // Check if player is already in queue to prevent duplicate entries
    const isInQueue = await this.redis.zscore(RedisKeys.eloQueue, userId);
    if (isInQueue !== null) {
      console.log(`Player ${userId} is already in queue, ignoring duplicate join`);
      client.send('queued', { position: await this.redis.zcard(RedisKeys.eloQueue) });
      return;
    }
    
    // Additional validation for bots: check if already in active match set
    if (isBot) {
      const isBotActive = await this.redis.sismember(RedisKeys.botsActiveSet, userId);
      if (isBotActive) {
        console.log(`Bot ${userId} is already in active match set, rejecting queue join`);
        this.cleanupClient(userId);
        client.leave();
        return;
      }
    }
    
    // Check if player is currently being processed
    if (this.processingUsers.has(userId)) {
      console.log(`Player ${userId} is currently being processed, ignoring duplicate join`);
      client.send('queued', { position: await this.redis.zcard(RedisKeys.eloQueue) });
      return;
    }
    
    console.log(`Player ${userId} added to Redis queue with rating ${rating}`);
    
    // Add player to Redis queue
    await this.redis.zadd(RedisKeys.eloQueue, rating || 1200, userId);
    
    // Set joined timestamp for wait time calculation
    const joinedAt = Date.now();
    await this.redis.setex(RedisKeys.queueJoinedAtKey(userId), 3600, joinedAt.toString());
    console.log(`⏰ Set joined timestamp for ${userId}: ${joinedAt}`);
    
    // Track human player for prioritization and bot service (only humans)
    // Check if this is NOT a bot user (i.e., it's a human player)
    if (!isBot) {
      await addHumanPlayer(this.redis, userId);
      await this.redis.sadd(RedisKeys.queuedPlayersSet, userId);
      console.log(`Added human player ${userId} to tracking sets`);
      
      // Notify bot service that a human player joined the queue
      await this.redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({
        type: 'playerQueued',
        playerId: userId
      }));
      console.log(`Notified bot service that human player ${userId} joined queue`);
    } else {
      console.log(`Player ${userId} is a bot, not adding to human tracking`);
    }
    
    // Mark user as being processed
    this.processingUsers.add(userId);
    
    // Don't match immediately - let matchmaking loop handle it
    // Only schedule emergency deployment timer
    this.scheduleEmergencyBotDeployment(userId);
    
    // Remove from processing set
    this.processingUsers.delete(userId);
    
    // Send confirmation to client
    client.send('queued', { position: await this.redis.zcard(RedisKeys.eloQueue) });
  }

  async onLeave(client: Client, consented: boolean) {
    // Find userId for this client
    let userId: string | undefined;
    for (const [uid, cli] of this.userIdToClient.entries()) {
      if (cli === client) {
        userId = uid;
        break;
      }
    }
    
    if (userId) {
      console.log(`Player ${userId} left queue room`);
      this.cleanupClient(userId);
      
      // Remove from Redis queue and cleanup all related data
      await this.redis.zrem(RedisKeys.eloQueue, userId);
      await this.redis.del(RedisKeys.queueJoinedAtKey(userId));
      console.log(`Removed player ${userId} from Redis queue`);
      
      // Check if this was a human player (not a bot)
      const wasHuman = !(await isBotUser(userId));
      
      // Remove from human players tracking and queued players set (only if human)
      if (wasHuman) {
        await removeHumanPlayer(this.redis, userId);
        await this.redis.srem(RedisKeys.queuedPlayersSet, userId);
        console.log(`Removed human player ${userId} from tracking sets`);
      }
      
      // Notify bot service if human player left
      if (wasHuman) {
        await this.redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({
          type: 'playerDequeued',
          playerId: userId
        }));
        console.log(`Notified bot service that human player ${userId} left queue`);
      }
      
      // Cancel emergency bot deployment timer if exists
      this.cancelEmergencyBotDeployment(userId);
      
      // Let the matchmaking loop handle re-evaluation (no manual attemptMatch)
    } else {
      console.log(`Client ${client.sessionId} left queue room (no userId found)`);
    }
  }

  /**
   * Centralized matchmaking cycle that runs every 5 seconds
   */
  private async runMatchmakingCycle() {
    if (this.matchmakingInProgress) {
      console.log('Matchmaking already in progress, skipping');
      return;
    }
    
    this.matchmakingInProgress = true;
    try {
      console.log('🔄 Running matchmaking cycle...');
      // Only match players who have waited minimum time (e.g., 3-5 seconds)
      const matched = await this.attemptMatch();
      console.log(`🔄 Matchmaking cycle complete, matched: ${matched}`);
    } catch (error) {
      console.error('❌ Error in matchmaking cycle:', error);
    } finally {
      this.matchmakingInProgress = false;
    }
  }

  async onDispose() {
    console.log('QueueRoom disposed');
    this.userIdToClient.clear();
  }

  private cleanupClient(userId: string) {
    // Remove from client mapping
    this.userIdToClient.delete(userId);
    // Remove from processing set
    this.processingUsers.delete(userId);
  }

  /**
   * Attempt to match a specific player with others in queue
   * Returns true if a match was found, false otherwise
   */
  private async attemptMatch(triggerPlayerId?: string): Promise<boolean> {
    try {
      // Get all players in queue
      const entries = await this.redis.zrange(RedisKeys.eloQueue, 0, -1, 'WITHSCORES');
      console.log(`🔍 Attempting match - found ${entries.length / 2} players in queue`);
      
      if (entries.length < 2) {
        // Check for bot matching if only one player
        if (entries.length === 1) {
          console.log('🔍 Only 1 player in queue, attempting bot match');
          return await this.attemptBotMatch(entries);
        }
        console.log('🔍 Not enough players for matching');
        return false;
      }

      // Convert to QueueEntry format and separate humans from bots
      // Filter out players who haven't waited long enough
      const queued: QueueEntry[] = [];
      const humanPlayers: QueueEntry[] = [];
      const botPlayers: QueueEntry[] = [];
      
      for (let i = 0; i < entries.length; i += 2) {
        const userId = entries[i];
        const rating = parseFloat(entries[i + 1]);
        let joinedAt = 0;
        try {
          const raw = await this.redis.get(RedisKeys.queueJoinedAtKey(userId));
          joinedAt = raw ? parseInt(raw, 10) : now();
          console.log(`🔍 Player ${userId}: raw=${raw}, joinedAt=${joinedAt}, current=${now()}`);
        } catch {}
        
        const waitTime = now() - joinedAt;
        
        // Only include players who have waited minimum time
        if (waitTime >= MIN_QUEUE_WAIT_MS) {
          const player = { userId, rating, joinedAt };
          queued.push(player);
          
          // Check if this is a human player (not a bot)
          const isHuman = !(await isBotUser(userId));
          if (isHuman) {
            humanPlayers.push(player);
          } else {
            botPlayers.push(player);
          }
        } else {
          console.log(`⏰ Player ${userId} has only waited ${waitTime}ms, needs ${MIN_QUEUE_WAIT_MS}ms minimum`);
        }
      }
      
      console.log(`🔍 Eligible players: ${queued.length} total, ${humanPlayers.length} humans, ${botPlayers.length} bots`);

      // PRIORITY 1: Try to match human players first
      if (humanPlayers.length >= 2) {
        console.log(`Found ${humanPlayers.length} human players, prioritizing human-human matches`);
        
        // If triggered by a specific human player, try to match them first
        if (triggerPlayerId && !(await isBotUser(triggerPlayerId))) {
          const triggerPlayer = humanPlayers.find(p => p.userId === triggerPlayerId);
          if (triggerPlayer) {
            const match = findCompatibleMatch(triggerPlayer, humanPlayers);
            if (match) {
              await this.createPlayerMatch(triggerPlayer, match);
              return true;
            }
          }
        }
        
        // Otherwise, find the best human-human match
        let bestHumanMatch: [QueueEntry, QueueEntry] | null = null;
        let bestEloDiff = Number.POSITIVE_INFINITY;

        for (const player of humanPlayers) {
          const match = findCompatibleMatch(player, humanPlayers);
          if (match) {
            const eloDiff = Math.abs(player.rating - match.rating);
            if (eloDiff < bestEloDiff) {
              bestEloDiff = eloDiff;
              bestHumanMatch = [player, match];
            }
          }
        }

        if (bestHumanMatch) {
          await this.createPlayerMatch(bestHumanMatch[0], bestHumanMatch[1]);
          return true;
        }
      }

      // PRIORITY 2: If no human-human matches possible, try human-bot matches
      if (humanPlayers.length >= 1 && botPlayers.length >= 1) {
        console.log(`No human-human matches found, trying human-bot matches`);
        
        // If triggered by a specific human player, try to match them with a bot
        if (triggerPlayerId && !(await isBotUser(triggerPlayerId))) {
          const triggerPlayer = humanPlayers.find(p => p.userId === triggerPlayerId);
          if (triggerPlayer) {
            const match = findCompatibleMatch(triggerPlayer, botPlayers);
            if (match) {
              await this.createPlayerMatch(triggerPlayer, match);
              return true;
            }
          }
        }
        
        // Otherwise, find the best human-bot match
        let bestHumanBotMatch: [QueueEntry, QueueEntry] | null = null;
        let bestEloDiff = Number.POSITIVE_INFINITY;

        for (const humanPlayer of humanPlayers) {
          const match = findCompatibleMatch(humanPlayer, botPlayers);
          if (match) {
            const eloDiff = Math.abs(humanPlayer.rating - match.rating);
            if (eloDiff < bestEloDiff) {
              bestEloDiff = eloDiff;
              bestHumanBotMatch = [humanPlayer, match];
            }
          }
        }

        if (bestHumanBotMatch) {
          await this.createPlayerMatch(bestHumanBotMatch[0], bestHumanBotMatch[1]);
          return true;
        }
      }

      // PRIORITY 3: Only if no humans are waiting, allow bot-bot matches
      if (humanPlayers.length === 0 && botPlayers.length >= 2) {
        console.log(`No human players waiting, allowing bot-bot matches`);
        
        // Find the best bot-bot match
        let bestBotMatch: [QueueEntry, QueueEntry] | null = null;
        let bestEloDiff = Number.POSITIVE_INFINITY;

        for (const player of botPlayers) {
          const match = findCompatibleMatch(player, botPlayers);
          if (match) {
            const eloDiff = Math.abs(player.rating - match.rating);
            if (eloDiff < bestEloDiff) {
              bestEloDiff = eloDiff;
              bestBotMatch = [player, match];
            }
          }
        }

        if (bestBotMatch) {
          await this.createPlayerMatch(bestBotMatch[0], bestBotMatch[1]);
          return true;
        }
      }

      return false;
    } catch (e) {
      console.error('Matchmaker error:', e);
      return false;
    }
  }

  /**
   * Acquire distributed locks for match creation
   */
  private async acquireMatchLock(player1Id: string, player2Id: string): Promise<boolean> {
    const lockKey1 = `lock:match:${player1Id}`;
    const lockKey2 = `lock:match:${player2Id}`;
    const lockValue = `${Date.now()}`;
    const lockTTL = 10; // 10 seconds
    
    // Try to acquire both locks atomically
    const result1 = await this.redis.set(lockKey1, lockValue, 'EX', lockTTL, 'NX');
    if (result1 !== 'OK') return false;
    
    const result2 = await this.redis.set(lockKey2, lockValue, 'EX', lockTTL, 'NX');
    if (result2 !== 'OK') {
      await this.redis.del(lockKey1); // Release first lock
      return false;
    }
    
    return true;
  }

  /**
   * Release distributed locks for match creation
   */
  private async releaseMatchLock(player1Id: string, player2Id: string): Promise<void> {
    await this.redis.del(`lock:match:${player1Id}`, `lock:match:${player2Id}`);
  }

  /**
   * Create a match between two players
   */
  private async createPlayerMatch(player1: QueueEntry, player2: QueueEntry) {
    // Step 1: Acquire distributed locks
    const lockAcquired = await this.acquireMatchLock(player1.userId, player2.userId);
    if (!lockAcquired) {
      console.log(`Failed to acquire locks for ${player1.userId} and ${player2.userId}`);
      return;
    }
    
    try {
      console.log(`Creating match - ${player1.userId} (${player1.rating}) vs ${player2.userId} (${player2.rating}), diff: ${Math.abs(player1.rating - player2.rating)}`);
      
      // Step 2: Use Redis WATCH/MULTI/EXEC for atomic check-and-set
      await this.redis.watch(
        RedisKeys.eloQueue,
        `queue:reservation:${player1.userId}`,
        `queue:reservation:${player2.userId}`,
        RedisKeys.botStateKey(player1.userId),
        RedisKeys.botStateKey(player2.userId)
      );
      
      // Verify players still available
      const [p1InQueue, p2InQueue, p1Reservation, p2Reservation] = await Promise.all([
        this.redis.zscore(RedisKeys.eloQueue, player1.userId),
        this.redis.zscore(RedisKeys.eloQueue, player2.userId),
        this.redis.get(`queue:reservation:${player1.userId}`),
        this.redis.get(`queue:reservation:${player2.userId}`)
      ]);
      
      if (!p1InQueue || !p2InQueue || p1Reservation || p2Reservation) {
        await this.redis.unwatch();
        console.log('Players no longer available for matching');
        return;
      }
      
      // Step 3: Create reservations BEFORE creating match room
      const tempReservation = JSON.stringify({ status: 'creating' });
      const multi = this.redis.multi();
      multi.setex(`queue:reservation:${player1.userId}`, 60, tempReservation);
      multi.setex(`queue:reservation:${player2.userId}`, 60, tempReservation);
      multi.zrem(RedisKeys.eloQueue, player1.userId, player2.userId);
      
      // Remove humans from both queued players set and human players set
      const p1IsHuman = !(await isBotUser(player1.userId));
      const p2IsHuman = !(await isBotUser(player2.userId));
      if (p1IsHuman) {
        multi.srem(RedisKeys.queuedPlayersSet, player1.userId);
        multi.srem(RedisKeys.humanPlayersSet, player1.userId);
      }
      if (p2IsHuman) {
        multi.srem(RedisKeys.queuedPlayersSet, player2.userId);
        multi.srem(RedisKeys.humanPlayersSet, player2.userId);
      }
      
      const execResult = await multi.exec();
      if (!execResult) {
        console.log('Transaction failed - players were matched by another process');
        return;
      }
      
      // Step 4: Now create the match (players locked out of queue)
      const result = await createMatch(
        { userId: player1.userId, rating: player1.rating },
        { userId: player2.userId, rating: player2.rating },
        undefined,
        false
      );
      
      // Cancel emergency bot deployment timers for both players
      this.cancelEmergencyBotDeployment(player1.userId);
      this.cancelEmergencyBotDeployment(player2.userId);

      // Notify both players via WebSocket
      const player1Client = this.userIdToClient.get(player1.userId);
      const player2Client = this.userIdToClient.get(player2.userId);
      
      if (player1Client) {
        player1Client.send('match_found', {
          matchId: result.matchId,
          roomId: result.roomId,
          problemId: result.problemId
        });
        this.cleanupClient(player1.userId);
        // Don't call client.leave() - let the client disconnect naturally when they join the match room
      }
      
      if (player2Client) {
        player2Client.send('match_found', {
          matchId: result.matchId,
          roomId: result.roomId,
          problemId: result.problemId
        });
        this.cleanupClient(player2.userId);
        // Don't call client.leave() - let the client disconnect naturally when they join the match room
      }

      console.log(`Match ${result.matchId} created and players notified`);
      
      // Notify bot service if humans were matched (so it can reduce deployed bot count)
      if (p1IsHuman || p2IsHuman) {
        const humanPlayerIds = [];
        if (p1IsHuman) humanPlayerIds.push(player1.userId);
        if (p2IsHuman) humanPlayerIds.push(player2.userId);
        
        for (const humanId of humanPlayerIds) {
          await this.redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({
            type: 'playerDequeued',
            playerId: humanId
          }));
          console.log(`Notified bot service that human player ${humanId} was matched`);
        }
      }
    } catch (e) {
      console.error('Error creating match:', e);
    } finally {
      await this.releaseMatchLock(player1.userId, player2.userId);
    }
  }

  /**
   * Attempt to match a player with a bot
   * Returns true if a match was found, false otherwise
   */
  private async attemptBotMatch(entries: string[]): Promise<boolean> {
    const botsEnabled = (process.env.BOTS_ENABLED || 'true').toLowerCase() === 'true';
    if (!botsEnabled) return false;

    const userId = entries[0];
    const rating = parseFloat(entries[1]);
    
    // Check if player already has a reservation
    const existingReservation = await this.redis.get(`queue:reservation:${userId}`);
    if (existingReservation) {
      console.log(`Bot match cancelled - player ${userId} already has a reservation`);
      return false;
    }
    
    // Get when player joined
    let joinedAt = 0;
    try {
      const raw = await this.redis.get(RedisKeys.queueJoinedAtKey(userId));
      joinedAt = raw ? parseInt(raw, 10) : now();
    } catch {}
    
    const waitTime = now() - joinedAt;
    if (waitTime < BOT_MATCH_DELAY_MS) return false; // Not enough wait time

    // Find a bot that's currently queued (not from available list)
    const queuedEntries = await this.redis.zrange(RedisKeys.eloQueue, 0, -1, 'WITHSCORES');
    let botMatch: { userId: string; rating: number } | null = null;
    
    for (let i = 0; i < queuedEntries.length; i += 2) {
      const queuedUserId = queuedEntries[i];
      const queuedRating = parseFloat(queuedEntries[i + 1]);
      
      // Skip the current player
      if (queuedUserId === userId) continue;
      
      // Check if this is a bot (not a human player)
      const isBot = await isBotUser(queuedUserId);
      if (isBot) {
        // Check if bot is available for matching
        const botState = await this.redis.get(`bots:state:${queuedUserId}`);
        const isBotActive = await this.redis.sismember(RedisKeys.botsActiveSet, queuedUserId);
        
        if (botState === 'queued' && !isBotActive) {
          botMatch = { userId: queuedUserId, rating: queuedRating };
          console.log(`Found available bot ${queuedUserId} with state ${botState}`);
          break;
        } else {
          console.log(`Bot ${queuedUserId} not available - state: ${botState}, active: ${isBotActive}`);
        }
      }
    }
    
    if (!botMatch) {
      console.log(`No available bots found for player ${userId}`);
      return false;
    }

    try {
      // Remove both players from queue
      await this.redis.zrem(RedisKeys.eloQueue, userId, botMatch.userId);
      await this.redis.del(RedisKeys.queueJoinedAtKey(userId));
      await this.redis.del(RedisKeys.queueJoinedAtKey(botMatch.userId));

      // Create human vs bot match
      const result = await createMatch(
        { userId, rating },
        { userId: botMatch.userId, rating: botMatch.rating },
        undefined,
        false
      );

      // Notify human player
      const playerClient = this.userIdToClient.get(userId);
      if (playerClient) {
        playerClient.send('match_found', {
          matchId: result.matchId,
          roomId: result.roomId,
          problemId: result.problemId
        });
        this.cleanupClient(userId);
        // Don't call client.leave() - let the client disconnect naturally when they join the match room
      }

      // Notify bot via WebSocket (if bot is connected to queue room)
      const botClient = this.userIdToClient.get(botMatch.userId);
      if (botClient) {
        botClient.send('match_found', {
          matchId: result.matchId,
          roomId: result.roomId,
          problemId: result.problemId
        });
        this.cleanupClient(botMatch.userId);
      }

      console.log(`Matchmaker: Created human-vs-bot match ${result.matchId} (${userId} vs ${botMatch.userId})`);
      return true;
    } catch (e) {
      console.warn('Failed to create bot match:', e);
      return false;
    }
  }

  /**
   * Schedule emergency bot deployment for a player who's been waiting too long
   */
  private scheduleEmergencyBotDeployment(userId: string) {
    // Cancel any existing timer for this player
    this.cancelEmergencyBotDeployment(userId);
    
    // Schedule emergency bot deployment after 15 seconds
    const timer = this.clock.setTimeout(async () => {
      try {
        // Check if player is still in queue
        const isInQueue = await this.redis.zscore(RedisKeys.eloQueue, userId);
        if (!isInQueue) {
          console.log(`Player ${userId} no longer in queue, cancelling emergency bot deployment`);
          return;
        }
        
        // Check if player already has a reservation
        const existingReservation = await this.redis.get(`queue:reservation:${userId}`);
        if (existingReservation) {
          console.log(`Player ${userId} already has a reservation, cancelling emergency bot deployment`);
          return;
        }
        
        console.log(`Emergency bot deployment triggered for player ${userId}`);
        
        // Request additional bot deployment
        await this.redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({
          type: 'playerQueued',
          playerId: userId
        }));
        
        // Let the matchmaking loop handle matching (no manual attempts)
        
      } catch (error) {
        console.error(`Error in emergency bot deployment for ${userId}:`, error);
      }
    }, 15000); // 15 seconds
    
    this.emergencyBotTimers.set(userId, timer);
    console.log(`Scheduled emergency bot deployment for player ${userId} in 15 seconds`);
  }

  /**
   * Cancel emergency bot deployment timer for a player
   */
  private cancelEmergencyBotDeployment(userId: string) {
    const timer = this.emergencyBotTimers.get(userId);
    if (timer) {
      timer.clear();
      this.emergencyBotTimers.delete(userId);
      console.log(`Cancelled emergency bot deployment timer for player ${userId}`);
    }
  }

  /**
   * Periodically check for players who have been waiting too long
   */
  private async checkForWaitingPlayers() {
    try {
      // Get all players in queue
      const entries = await this.redis.zrange(RedisKeys.eloQueue, 0, -1, 'WITHSCORES');
      
      for (let i = 0; i < entries.length; i += 2) {
        const userId = entries[i];
        const rating = parseFloat(entries[i + 1]);
        
        // Check if this is a human player
        const isHuman = !(await isBotUser(userId));
        if (!isHuman) continue; // Skip bots
        
        // Get when player joined
        let joinedAt = 0;
        try {
          const raw = await this.redis.get(RedisKeys.queueJoinedAtKey(userId));
          joinedAt = raw ? parseInt(raw, 10) : now();
        } catch {}
        
        const waitTime = now() - joinedAt;
        
        // If player has been waiting for more than 15 seconds and doesn't have an emergency timer
        if (waitTime > 15000 && !this.emergencyBotTimers.has(userId)) {
          console.log(`Player ${userId} has been waiting for ${waitTime}ms, scheduling emergency bot deployment`);
          this.scheduleEmergencyBotDeployment(userId);
        }
        
        // Let the matchmaking loop handle matching (no manual attemptMatch)
      }
    } catch (error) {
      console.error('Error checking for waiting players:', error);
    }
  }
}
