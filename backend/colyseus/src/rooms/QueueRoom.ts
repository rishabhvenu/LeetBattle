import { Client, Room } from 'colyseus';
import { getRedis, RedisKeys, addHumanPlayer, removeHumanPlayer, isHumanPlayer, isBotUser } from '../lib/redis';
import { createMatch } from '../lib/matchCreation';
// MongoDB is not used directly here anymore for bot fallback selection

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
  private needsBotTimers = new Map<string, any>(); // userId -> timer for marking player as needing bot
  private matchmakingInProgress = false;

  async onCreate(options: any) {
    this.autoDispose = false;
    console.log('QueueRoom created - integrated matchmaking enabled');
    console.log('♾️ QueueRoom autoDispose disabled - matchmaking loop will persist after last client disconnects');
    
    // CRITICAL: Set longer seat reservation time to prevent "seat reservation expired" errors
    // This is especially important for bots that may have network latency or processing delays
    this.setSeatReservationTime(60); // 60 seconds should be plenty for WebSocket upgrade
    
    // Run matchmaking every 5 seconds (not 10 seconds)
    this.clock.setInterval(async () => {
      await this.runMatchmakingCycle();
    }, 5000);
    
    console.log('✅ Matchmaking interval set up - will run every 5 seconds (startup bootstrap if available)');
  }

  async onJoin(client: Client, options: { userId: string; rating: number }) {
    const { userId, rating } = options;
    
    console.log(`Player ${userId} attempting to join queue with rating ${rating}`);
    const joinStartTs = Date.now();
    
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
        
        // Clean up and let the client close the connection after processing the message
        this.cleanupClient(userId);
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
    // Only schedule marking timer for humans (to mark as needing bot after 15s)
    if (!isBot) {
      this.scheduleNeedsBotMarking(userId);
    }
    
    // Remove from processing set
    this.processingUsers.delete(userId);
    
    // Send confirmation to client
    client.send('queued', { position: await this.redis.zcard(RedisKeys.eloQueue) });
    console.log(`Player ${userId} join queue completed in ${Date.now() - joinStartTs}ms`);
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
      
      // Unmark player as needing bot if they were marked
      await this.unmarkNeedsBot(userId);
      
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

  // Queue-only policy: no DB fallback for additional bots

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
      
      // Don't return early - process all players through normal flow
      // This allows bot-bot matching when there are 2+ bots, and human-bot matching when appropriate

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
        if (waitTime >= MIN_QUEUE_WAIT_MS) {
          const player = { userId, rating, joinedAt };
          queued.push(player);
          
          // Check if this is a human player (not a bot)
          const isHuman = !(await isBotUser(userId));
          if (isHuman) {
            humanPlayers.push(player);
          } else {
            // For bots, check if they're already active in a match
            const isBotActive = await this.redis.sismember(RedisKeys.botsActiveSet, userId);
            const currentMatch = await this.redis.get(`bot:current_match:${userId}`);
            if (!isBotActive && !currentMatch) {
              botPlayers.push(player);
            } else {
              console.log(`⚠️ Bot ${userId} is already active or linked to match ${currentMatch || ''}, skipping from matchmaking`);
            }
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
      if (humanPlayers.length === 0 && botPlayers.length >= 1) {
        console.log(`No human players waiting, allowing bot-bot matches (${botPlayers.length} bot(s) in queue)`);
        
        // If we have 2+ bots in queue, match them together
        if (botPlayers.length >= 2) {
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
        } else if (botPlayers.length === 1) {
          // Queue-only policy: do not source bots from MongoDB fallback
          const queuedBot = botPlayers[0];
          console.log(`Only 1 bot in queue (${queuedBot.userId}); queue-only policy forbids DB fallback. Waiting for another queued bot.`);
          // Optionally, a separate component can react to queue state to deploy more bots
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
   * Note: Delete keys separately to avoid CROSSSLOT errors in Redis Cluster
   */
  private async releaseMatchLock(player1Id: string, player2Id: string): Promise<void> {
    await Promise.all([
      this.redis.del(`lock:match:${player1Id}`),
      this.redis.del(`lock:match:${player2Id}`)
    ]);
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
    
    let p1InQueue: string | null = null;
    let p2InQueue: string | null = null;
    let p1Reservation: string | null = null;
    let p2Reservation: string | null = null;
    let p1IsBotActive = 0;
    let p2IsBotActive = 0;
    let p1IsHuman = false;
    let p2IsHuman = false;

    try {
      console.log(`Creating match - ${player1.userId} (${player1.rating}) vs ${player2.userId} (${player2.rating}), diff: ${Math.abs(player1.rating - player2.rating)}`);
      
      // Step 2: Verify players still available
      // Note: We rely on distributed locks (acquireMatchLock) for atomicity instead of WATCH
      // because Redis Cluster requires all WATCH keys to hash to the same slot, which is
      // not possible with our current key structure (queue:* and bots:* hash to different slots)
      // The distributed locks provide sufficient protection against race conditions
      const availabilityResults = await Promise.all([
        this.redis.zscore(RedisKeys.eloQueue, player1.userId),
        this.redis.zscore(RedisKeys.eloQueue, player2.userId),
        this.redis.get(`queue:reservation:${player1.userId}`),
        this.redis.get(`queue:reservation:${player2.userId}`),
        this.redis.sismember(RedisKeys.botsActiveSet, player1.userId),
        this.redis.sismember(RedisKeys.botsActiveSet, player2.userId)
      ]);
      p1InQueue = availabilityResults[0];
      p2InQueue = availabilityResults[1];
      p1Reservation = availabilityResults[2];
      p2Reservation = availabilityResults[3];
      p1IsBotActive = availabilityResults[4];
      p2IsBotActive = availabilityResults[5];
      
      // Player1 must be in queue, but player2 might not be (for bot-bot matching with deployed bots)
      const p2IsBot = await isBotUser(player2.userId);
      const p2CanBeNonQueued = p2IsBot; // Bots can be matched even if not in queue
      
      // CRITICAL: For bots, check BOTH reservation AND active set
      // A bot with a reservation (even if expired) or in active set should NOT be matched
      if (!p1InQueue || p1Reservation || p1IsBotActive || 
          (!p2CanBeNonQueued && !p2InQueue) || p2Reservation || p2IsBotActive) {
        console.log(`Players no longer available for matching: p1InQueue=${!!p1InQueue}, p2InQueue=${!!p2InQueue} (canBeNonQueued=${p2CanBeNonQueued}), p1Reservation=${!!p1Reservation}, p2Reservation=${!!p2Reservation}, p1IsBotActive=${p1IsBotActive}, p2IsBotActive=${p2IsBotActive}`);
        return;
      }
      
      // ADDITIONAL SAFETY CHECK: For bots, verify they're not in any active match
      // by checking if they have a current_match pointer
      if (p2IsBot) {
        const p2CurrentMatch = await this.redis.get(`bot:current_match:${player2.userId}`);
        if (p2CurrentMatch) {
          console.log(`Bot ${player2.userId} already has current_match ${p2CurrentMatch}, rejecting match`);
          return;
        }
      }
      const p1IsBot = await isBotUser(player1.userId);
      if (p1IsBot) {
        const p1CurrentMatch = await this.redis.get(`bot:current_match:${player1.userId}`);
        if (p1CurrentMatch) {
          console.log(`Bot ${player1.userId} already has current_match ${p1CurrentMatch}, rejecting match`);
          return;
        }
      }
      
      // Step 3: Create reservations BEFORE creating match room
      // Note: We can't use MULTI with keys from different slots in Redis Cluster
      // Instead, we perform operations individually. The distributed locks ensure atomicity.
      const tempReservation = JSON.stringify({ status: 'creating' });
      
      // Create reservations
      await Promise.all([
        this.redis.setex(`queue:reservation:${player1.userId}`, 60, tempReservation),
        this.redis.setex(`queue:reservation:${player2.userId}`, 60, tempReservation)
      ]);
      
      // Remove from queue
      await this.redis.zrem(RedisKeys.eloQueue, player1.userId);
      if (p2InQueue) {
        await this.redis.zrem(RedisKeys.eloQueue, player2.userId);
      }
      
      // Remove humans from both queued players set and human players set
      p1IsHuman = !(await isBotUser(player1.userId));
      p2IsHuman = !(await isBotUser(player2.userId));
      if (p1IsHuman) {
        await Promise.all([
          this.redis.srem(RedisKeys.queuedPlayersSet, player1.userId),
          this.redis.srem(RedisKeys.humanPlayersSet, player1.userId)
        ]);
      }
      if (p2IsHuman) {
        await Promise.all([
          this.redis.srem(RedisKeys.queuedPlayersSet, player2.userId),
          this.redis.srem(RedisKeys.humanPlayersSet, player2.userId)
        ]);
      }
      
      // CRITICAL: Add bots to active set IMMEDIATELY to prevent duplicate matches
      if (!p1IsHuman) {
        await this.redis.sadd(RedisKeys.botsActiveSet, player1.userId);
      }
      if (!p2IsHuman) {
        await this.redis.sadd(RedisKeys.botsActiveSet, player2.userId);
      }
      
      // Step 4: Now create the match (players locked out of queue)
      const result = await createMatch(
        { userId: player1.userId, rating: player1.rating },
        { userId: player2.userId, rating: player2.rating },
        undefined,
        false
      );
      
      // Unmark both players as needing bot if they were marked
      await this.unmarkNeedsBot(player1.userId);
      await this.unmarkNeedsBot(player2.userId);

      // Notify both players via WebSocket
      // Get client references BEFORE cleanup - don't cleanup until after we try to send
      const player1Client = this.userIdToClient.get(player1.userId);
      const player2Client = this.userIdToClient.get(player2.userId);
      console.log(
        `Attempting to notify players for match ${result.matchId}:`,
        {
          player1: {
            userId: player1.userId,
            hasClient: !!player1Client,
          },
          player2: {
            userId: player2.userId,
            hasClient: !!player2Client,
          },
          activeClientSessionIds: this.clients.map(c => c.sessionId),
        }
      );
      
      let player1Notified = false;
      let player2Notified = false;
      
      if (player1Client) {
        try {
          // Verify client is still connected to the room
          const isStillConnected = this.clients.find(c => c.sessionId === player1Client.sessionId);
          if (isStillConnected) {
            player1Client.send('match_found', {
              matchId: result.matchId,
              roomId: result.roomId,
              problemId: result.problemId
            });
            player1Notified = true;
            console.log(`✅ Sent match_found to player1 ${player1.userId} (session ${player1Client.sessionId})`);
          } else {
            console.warn(
              `⚠️ Player1 ${player1.userId} client ${player1Client.sessionId} is no longer connected to room; active sessions:`,
              this.clients.map(c => c.sessionId)
            );
          }
        } catch (error) {
          console.error(`❌ Failed to send match_found to player1 ${player1.userId}:`, error);
        }
        // Only cleanup after we've attempted to send the message
        this.cleanupClient(player1.userId);
      } else {
        console.warn(`⚠️ Player1 ${player1.userId} client not found in userIdToClient map`);
      }
      
      if (player2Client) {
        try {
          // Verify client is still connected to the room
          const isStillConnected = this.clients.find(c => c.sessionId === player2Client.sessionId);
          if (isStillConnected) {
            player2Client.send('match_found', {
              matchId: result.matchId,
              roomId: result.roomId,
              problemId: result.problemId
            });
            player2Notified = true;
            console.log(`✅ Sent match_found to player2 ${player2.userId} (session ${player2Client.sessionId})`);
          } else {
            console.warn(
              `⚠️ Player2 ${player2.userId} client ${player2Client.sessionId} is no longer connected to room; active sessions:`,
              this.clients.map(c => c.sessionId)
            );
          }
        } catch (error) {
          console.error(`❌ Failed to send match_found to player2 ${player2.userId}:`, error);
        }
        // Only cleanup after we've attempted to send the message
        this.cleanupClient(player2.userId);
      } else {
        console.warn(`⚠️ Player2 ${player2.userId} client not found in userIdToClient map`);
      }

      if (player1Notified && player2Notified) {
        console.log(`✅ Match ${result.matchId} created and both players notified`);
      } else {
        console.warn(`⚠️ Match ${result.matchId} created but not all players notified (p1: ${player1Notified}, p2: ${player2Notified})`);
      }
      
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
      
      try {
        // Rollback: Clear temporary reservations
        await Promise.all([
          this.redis.del(`queue:reservation:${player1.userId}`),
          this.redis.del(`queue:reservation:${player2.userId}`)
        ]);

        // Ensure bots no longer appear as active if match creation failed
        if (!p1IsHuman) {
          await this.redis.srem(RedisKeys.botsActiveSet, player1.userId);
        }
        if (!p2IsHuman) {
          await this.redis.srem(RedisKeys.botsActiveSet, player2.userId);
        }

        // Restore queue membership that was removed prior to match creation
        if (p1InQueue) {
          await this.redis.zadd(RedisKeys.eloQueue, player1.rating, player1.userId);
        }
        if (p2InQueue) {
          await this.redis.zadd(RedisKeys.eloQueue, player2.rating, player2.userId);
        }

        // Re-add human tracking state if it was removed
        if (p1IsHuman) {
          await Promise.all([
            this.redis.sadd(RedisKeys.queuedPlayersSet, player1.userId),
            this.redis.sadd(RedisKeys.humanPlayersSet, player1.userId)
          ]);
        }
        if (p2IsHuman) {
          await Promise.all([
            this.redis.sadd(RedisKeys.queuedPlayersSet, player2.userId),
            this.redis.sadd(RedisKeys.humanPlayersSet, player2.userId)
          ]);
        }

        console.warn(
          `Rolled back reservations for players ${player1.userId} and ${player2.userId} after match creation failure`
        );
      } catch (rollbackError) {
        console.error(
          'Failed to rollback reservations after match creation error:',
          rollbackError
        );
      }
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
      // Re-check availability (we rely on the matchmaking cycle's sequential processing
      // and the fact that we check availability right before matching to prevent duplicates)
      const [stillInQueue, humanReservation, botStillInQueue, botReservation, botIsActive] = await Promise.all([
        this.redis.zscore(RedisKeys.eloQueue, userId),
        this.redis.get(`queue:reservation:${userId}`),
        this.redis.zscore(RedisKeys.eloQueue, botMatch.userId),
        this.redis.get(`queue:reservation:${botMatch.userId}`),
        this.redis.sismember(RedisKeys.botsActiveSet, botMatch.userId)
      ]);
      
      if (!stillInQueue || humanReservation || !botStillInQueue || botReservation || botIsActive) {
        console.log(`Match no longer available: humanInQueue=${!!stillInQueue}, humanReservation=${!!humanReservation}, botInQueue=${!!botStillInQueue}, botReservation=${!!botReservation}, botIsActive=${botIsActive}`);
        return false;
      }
      
      // Remove from queue, create reservations, and add to active set
      // Note: We can't use MULTI with keys from different slots in Redis Cluster
      // The matchmaking cycle's sequential processing provides sufficient protection
      const tempReservation = JSON.stringify({ status: 'creating' });
      await Promise.all([
        this.redis.setex(`queue:reservation:${userId}`, 60, tempReservation),
        this.redis.setex(`queue:reservation:${botMatch.userId}`, 60, tempReservation)
      ]);
      
      await this.redis.zrem(RedisKeys.eloQueue, userId, botMatch.userId);
      await Promise.all([
        this.redis.del(RedisKeys.queueJoinedAtKey(userId)),
        this.redis.del(RedisKeys.queueJoinedAtKey(botMatch.userId))
      ]);
      
      await this.redis.sadd(RedisKeys.botsActiveSet, botMatch.userId); // CRITICAL: Mark bot as active immediately
      
      // Remove human from queued players set and human players set
      await Promise.all([
        this.redis.srem(RedisKeys.queuedPlayersSet, userId),
        this.redis.srem(RedisKeys.humanPlayersSet, userId)
      ]);

      // Create human vs bot match (players are now locked out of queue)
      const result = await createMatch(
        { userId, rating },
        { userId: botMatch.userId, rating: botMatch.rating },
        undefined,
        false
      );

      // Unmark player as needing bot if they were marked
      await this.unmarkNeedsBot(userId);

      // Notify human player
      const playerClient = this.userIdToClient.get(userId);
      let playerNotified = false;
      if (playerClient) {
        try {
          // Verify client is still connected to the room
          const isStillConnected = this.clients.find(c => c.sessionId === playerClient.sessionId);
          if (isStillConnected) {
            playerClient.send('match_found', {
              matchId: result.matchId,
              roomId: result.roomId,
              problemId: result.problemId
            });
            playerNotified = true;
            console.log(`✅ Sent match_found to human player ${userId} (session ${playerClient.sessionId})`);
          } else {
            console.warn(`⚠️ Human player ${userId} client ${playerClient.sessionId} is no longer connected to room`);
          }
        } catch (error) {
          console.error(`❌ Failed to send match_found to human player ${userId}:`, error);
        }
        // Only cleanup after we've attempted to send the message
        this.cleanupClient(userId);
      } else {
        console.warn(`⚠️ Human player ${userId} client not found in userIdToClient map`);
      }

      // Notify bot via WebSocket (if bot is connected to queue room)
      const botClient = this.userIdToClient.get(botMatch.userId);
      let botNotified = false;
      if (botClient) {
        try {
          // Verify client is still connected to the room
          const isStillConnected = this.clients.find(c => c.sessionId === botClient.sessionId);
          if (isStillConnected) {
            botClient.send('match_found', {
              matchId: result.matchId,
              roomId: result.roomId,
              problemId: result.problemId
            });
            botNotified = true;
            console.log(`✅ Sent match_found to bot ${botMatch.userId} (session ${botClient.sessionId})`);
          } else {
            console.warn(`⚠️ Bot ${botMatch.userId} client ${botClient.sessionId} is no longer connected to room`);
          }
        } catch (error) {
          console.error(`❌ Failed to send match_found to bot ${botMatch.userId}:`, error);
        }
        // Only cleanup after we've attempted to send the message
        this.cleanupClient(botMatch.userId);
      } else {
        console.log(`ℹ️ Bot ${botMatch.userId} client not found in userIdToClient map (may not be connected to queue room)`);
      }

      console.log(`Matchmaker: Created human-vs-bot match ${result.matchId} (${userId} vs ${botMatch.userId})`);
      return true;
    } catch (e) {
      console.warn('Failed to create bot match:', e);
      
      try {
        // Rollback: Clear reservations and restore state
        await Promise.all([
          this.redis.del(`queue:reservation:${userId}`),
          this.redis.del(`queue:reservation:${botMatch.userId}`)
        ]);
        
        await this.redis.srem(RedisKeys.botsActiveSet, botMatch.userId);

        // Restore queue membership and tracking for both players
        await Promise.all([
          this.redis.zadd(RedisKeys.eloQueue, rating, userId),
          this.redis.zadd(RedisKeys.eloQueue, botMatch.rating, botMatch.userId),
          this.redis.sadd(RedisKeys.queuedPlayersSet, userId),
          this.redis.sadd(RedisKeys.humanPlayersSet, userId)
        ]);

        // Restore joined timestamps so wait-time logic remains consistent
        await Promise.all([
          this.redis.setex(RedisKeys.queueJoinedAtKey(userId), 3600, Date.now().toString()),
          this.redis.setex(RedisKeys.queueJoinedAtKey(botMatch.userId), 3600, Date.now().toString())
        ]);
        
        console.warn(
          `Rolled back reservations for human ${userId} and bot ${botMatch.userId} after failed bot match`
        );
      } catch (rollbackError) {
        console.error(
          'Failed to rollback bot match reservations after error:',
          rollbackError
        );
      }
      return false;
    }
  }

  /**
   * Schedule marking a player as needing bot deployment after waiting too long
   */
  private scheduleNeedsBotMarking(userId: string) {
    // Cancel any existing timer for this player
    this.cancelNeedsBotTimer(userId);
    
    // Schedule marking after 7 seconds
    const timer = this.clock.setTimeout(async () => {
      try {
        // Check if player is still in queue
        const isInQueue = await this.redis.zscore(RedisKeys.eloQueue, userId);
        if (!isInQueue) {
          console.log(`Player ${userId} no longer in queue, skipping needsBot marking`);
          return;
        }
        
        // Check if player already has a reservation
        const existingReservation = await this.redis.get(`queue:reservation:${userId}`);
        if (existingReservation) {
          console.log(`Player ${userId} already has a reservation, skipping needsBot marking`);
          return;
        }
        
        // Mark player as needing bot deployment
        await this.redis.sadd(RedisKeys.needsBotSet, userId);
        console.log(`Marked player ${userId} as needing bot deployment (waited >7s)`);
        
        // The bot system will check this set when calculating required bot count
        
      } catch (error) {
        console.error(`Error marking player ${userId} as needing bot:`, error);
      }
    }, 7000); // 7 seconds
    
    this.needsBotTimers.set(userId, timer);
    console.log(`Scheduled needsBot marking for player ${userId} in 7 seconds`);
  }

  /**
   * Cancel needsBot marking timer for a player
   */
  private cancelNeedsBotTimer(userId: string) {
    const timer = this.needsBotTimers.get(userId);
    if (timer) {
      timer.clear();
      this.needsBotTimers.delete(userId);
      console.log(`Cancelled needsBot marking timer for player ${userId}`);
    }
  }

  /**
   * Unmark a player as needing bot deployment
   */
  private async unmarkNeedsBot(userId: string) {
    // Cancel any pending timer
    this.cancelNeedsBotTimer(userId);
    
    // Remove from needsBot set if marked
    const removed = await this.redis.srem(RedisKeys.needsBotSet, userId);
    if (removed > 0) {
      console.log(`Unmarked player ${userId} as needing bot deployment`);
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
        
        // If player has been waiting for more than 7 seconds and doesn't have a marking timer
        if (waitTime > 7000 && !this.needsBotTimers.has(userId)) {
          // Check if already marked
          const isMarked = await this.redis.sismember(RedisKeys.needsBotSet, userId);
          if (!isMarked) {
            console.log(`Player ${userId} has been waiting for ${waitTime}ms, marking as needing bot`);
            await this.redis.sadd(RedisKeys.needsBotSet, userId);
          }
        }
        
        // Let the matchmaking loop handle matching (no manual attemptMatch)
      }
    } catch (error) {
      console.error('Error checking for waiting players:', error);
    }
  }
}
