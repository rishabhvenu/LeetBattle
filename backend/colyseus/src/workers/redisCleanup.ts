/**
 * Redis Cleanup Worker
 * Periodically cleans up orphaned Redis keys from disconnected users, stale matches, etc.
 */

import { Redis, Cluster } from 'ioredis';
import { getRedis } from '../lib/redis';
import { getMongoClient, getDbName } from '../lib/mongo';
import { ObjectId } from 'mongodb';

type RedisClient = Redis | Cluster;

export interface CleanupStats {
  expiredReservations: number;
  staleQueueEntries: number;
  abandonedMatchKeys: number;
  orphanedBotStates: number;
  totalKeysRemoved: number;
}

export class RedisCleanupWorker {
  private redis: RedisClient;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastCleanup: Date | null = null;
  private totalCleanupsRun: number = 0;
  private stats: CleanupStats = {
    expiredReservations: 0,
    staleQueueEntries: 0,
    abandonedMatchKeys: 0,
    orphanedBotStates: 0,
    totalKeysRemoved: 0,
  };

  constructor(private cleanupIntervalMs: number = 300000) {
    // Default: 5 minutes
    this.redis = getRedis();
  }

  /**
   * Start the cleanup worker
   */
  start(): void {
    if (this.isRunning) {
      console.log('[RedisCleanupWorker] Already running');
      return;
    }

    this.isRunning = true;
    console.log(
      `[RedisCleanupWorker] Starting with interval ${this.cleanupIntervalMs}ms`
    );

    // Run immediately on start
    this.runCleanup().catch((error) => {
      console.error('[RedisCleanupWorker] Initial cleanup failed:', error);
    });

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runCleanup().catch((error) => {
        console.error('[RedisCleanupWorker] Periodic cleanup failed:', error);
      });
    }, this.cleanupIntervalMs);
  }

  /**
   * Stop the cleanup worker
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    console.log('[RedisCleanupWorker] Stopped');
  }

  /**
   * Run cleanup cycle
   */
  private async runCleanup(): Promise<CleanupStats> {
    console.log('[RedisCleanupWorker] Starting cleanup cycle');
    const startTime = Date.now();

    const cycleStats: CleanupStats = {
      expiredReservations: 0,
      staleQueueEntries: 0,
      abandonedMatchKeys: 0,
      orphanedBotStates: 0,
      totalKeysRemoved: 0,
    };

    try {
      // 1. Clean up expired reservations
      cycleStats.expiredReservations = await this.cleanupExpiredReservations();

      // 2. Clean up stale queue entries
      cycleStats.staleQueueEntries = await this.cleanupStaleQueueEntries();

      // 3. Clean up abandoned match keys
      cycleStats.abandonedMatchKeys = await this.cleanupAbandonedMatchKeys();

      // 4. Clean up orphaned bot states
      cycleStats.orphanedBotStates = await this.cleanupOrphanedBotStates();
      
      // 5. Clean up orphaned entries in matches:active set
      const orphanedActiveMatches = await this.cleanupOrphanedActiveMatches();

      cycleStats.totalKeysRemoved =
        cycleStats.expiredReservations +
        cycleStats.staleQueueEntries +
        cycleStats.abandonedMatchKeys +
        cycleStats.orphanedBotStates +
        orphanedActiveMatches;

      // Update cumulative stats
      this.stats.expiredReservations += cycleStats.expiredReservations;
      this.stats.staleQueueEntries += cycleStats.staleQueueEntries;
      this.stats.abandonedMatchKeys += cycleStats.abandonedMatchKeys;
      this.stats.orphanedBotStates += cycleStats.orphanedBotStates;
      this.stats.totalKeysRemoved += cycleStats.totalKeysRemoved;

      this.lastCleanup = new Date();
      this.totalCleanupsRun++;

      const duration = Date.now() - startTime;
      console.log(
        `[RedisCleanupWorker] Cleanup completed in ${duration}ms: ` +
          `${cycleStats.totalKeysRemoved} keys removed ` +
          `(reservations: ${cycleStats.expiredReservations}, ` +
          `queue: ${cycleStats.staleQueueEntries}, ` +
          `matches: ${cycleStats.abandonedMatchKeys}, ` +
          `bots: ${cycleStats.orphanedBotStates})`
      );
    } catch (error) {
      console.error('[RedisCleanupWorker] Cleanup cycle failed:', error);
    }

    return cycleStats;
  }

  /**
   * Clean up expired reservations (queue:reservation:*)
   * Remove reservations that don't have corresponding active rooms
   */
  private async cleanupExpiredReservations(): Promise<number> {
    try {
      const pattern = 'queue:reservation:*';
      const keys = await this.scanKeys(pattern);

      let removed = 0;
      for (const key of keys) {
        const value = await this.redis.get(key);
        if (!value) {
          continue;
        }

        try {
          const reservation = JSON.parse(value);
          const roomId = reservation.roomId;

          // Check if room still exists in Colyseus (via Redis presence keys)
          const roomKey = `colyseus:presence:${roomId}`;
          const roomExists = await this.redis.exists(roomKey);

          if (!roomExists) {
            // Room doesn't exist, remove reservation
            await this.redis.del(key);
            removed++;
          }
        } catch (error) {
          // Invalid JSON or other error, remove the key
          await this.redis.del(key);
          removed++;
        }
      }

      return removed;
    } catch (error) {
      console.error(
        '[RedisCleanupWorker] Failed to cleanup expired reservations:',
        error
      );
      return 0;
    }
  }

  /**
   * Clean up stale queue entries (queue:elo)
   * Remove users from queue who don't have valid reservations or active sessions
   */
  private async cleanupStaleQueueEntries(): Promise<number> {
    try {
      const queueKey = 'queue:elo';
      const members = await this.redis.zrange(queueKey, 0, -1);

      let removed = 0;
      for (const userId of members) {
        // Check if user has a reservation
        const reservationKey = `queue:reservation:${userId}`;
        const hasReservation = await this.redis.exists(reservationKey);

        // Check if user has an active bot state (for bots)
        const botStateKey = `bots:state:${userId}`;
        const hasBotState = await this.redis.exists(botStateKey);

        // If user has been in queue for more than 10 minutes without reservation, remove
        const score = await this.redis.zscore(queueKey, userId);
        if (score) {
          const queueTime = Date.now() - parseFloat(score);
          const tenMinutes = 10 * 60 * 1000;

          if (queueTime > tenMinutes && !hasReservation && !hasBotState) {
            await this.redis.zrem(queueKey, userId);
            removed++;
          }
        }
      }

      return removed;
    } catch (error) {
      console.error(
        '[RedisCleanupWorker] Failed to cleanup stale queue entries:',
        error
      );
      return 0;
    }
  }

  /**
   * Clean up abandoned match keys (match:*)
   * Remove match state keys for matches that have ended in MongoDB
   */
  private async cleanupAbandonedMatchKeys(): Promise<number> {
    try {
      const pattern = 'match:*';
      const keys = await this.scanKeys(pattern);

      // Filter to only match state keys (not match:*:ratings or other suffixes)
      const matchStateKeys = keys.filter(
        (key) => key.match(/^match:[^:]+$/) !== null
      );

      let removed = 0;
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(getDbName());
      const matches = db.collection('matches');

      for (const key of matchStateKeys) {
        const matchId = key.replace('match:', '');

        // Check if match exists and is finished in MongoDB
        if (ObjectId.isValid(matchId)) {
          const match = await matches.findOne(
            { _id: new ObjectId(matchId) },
            { projection: { status: 1, endedAt: 1 } }
          );

          if (match && match.status === 'finished' && match.endedAt) {
            // Match is finished, can remove Redis state after 1 hour
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            if (match.endedAt < oneHourAgo) {
              await this.redis.del(key);
              // Also remove related keys
              await this.redis.del(`${key}:ratings`);
              await this.redis.del(`${key}:submissions`);
              removed++;
            }
          }
        } else {
          // Invalid match ID format, remove the key
          await this.redis.del(key);
          removed++;
        }
      }

      return removed;
    } catch (error) {
      console.error(
        '[RedisCleanupWorker] Failed to cleanup abandoned match keys:',
        error
      );
      return 0;
    }
  }

  /**
   * Clean up orphaned bot states (bots:state:*)
   * Remove bot state keys for bots that are not in deployed or active sets
   */
  private async cleanupOrphanedBotStates(): Promise<number> {
    try {
      const pattern = 'bots:state:*';
      const keys = await this.scanKeys(pattern);

      const deployedBots = await this.redis.smembers('bots:deployed');
      const activeBots = await this.redis.smembers('bots:active');
      const allValidBots = new Set([...deployedBots, ...activeBots]);

      let removed = 0;
      for (const key of keys) {
        const botId = key.replace('bots:state:', '');

        if (!allValidBots.has(botId)) {
          // Bot is not deployed or active, remove state
          await this.redis.del(key);
          removed++;
        }
      }

      return removed;
    } catch (error) {
      console.error(
        '[RedisCleanupWorker] Failed to cleanup orphaned bot states:',
        error
      );
      return 0;
    }
  }

  /**
   * Clean up orphaned entries in matches:active set
   * Remove match IDs where:
   * - The match blob doesn't exist, OR
   * - The match blob status is 'finished' or has an endedAt, OR
   * - The match started more than maxDuration (45 min) + buffer (15 min) ago and is still 'ongoing'
   */
  private async cleanupOrphanedActiveMatches(): Promise<number> {
    try {
      const activeMatchIds = await this.redis.smembers('matches:active');
      
      let removed = 0;
      const maxMatchDuration = 45 * 60 * 1000; // 45 minutes
      const bufferTime = 15 * 60 * 1000; // 15 minutes buffer
      const maxAge = maxMatchDuration + bufferTime;
      
      for (const matchId of activeMatchIds) {
        const matchKey = `match:${matchId}`;
        const matchRaw = await this.redis.get(matchKey);
        
        let shouldRemove = false;
        let reason = '';
        
        if (!matchRaw) {
          // Match blob doesn't exist
          shouldRemove = true;
          reason = 'no_blob';
        } else {
          try {
            const matchData = JSON.parse(matchRaw);
            
            if (matchData.status === 'finished' || matchData.status === 'abandoned' || matchData.endedAt) {
              // Match is already finished/abandoned
              shouldRemove = true;
              reason = 'already_finished';
            } else if (matchData.startedAt) {
              // Check if match is too old
              const startedAt = new Date(matchData.startedAt).getTime();
              const age = Date.now() - startedAt;
              
              if (age > maxAge) {
                // Match is older than max allowed time, clean it up
                shouldRemove = true;
                reason = `too_old_${Math.round(age / 1000 / 60)}min`;
                
                // Update the match blob to mark as abandoned
                matchData.status = 'abandoned';
                matchData.endedAt = new Date().toISOString();
                matchData.abandonReason = 'cleanup_worker_timeout';
                await this.redis.setex(matchKey, 3600, JSON.stringify(matchData));
              }
            }
          } catch (parseError) {
            // Invalid JSON
            shouldRemove = true;
            reason = 'invalid_json';
          }
        }
        
        if (shouldRemove) {
          await this.redis.srem('matches:active', matchId);
          removed++;
          console.log(`[RedisCleanupWorker] Removed orphaned active match ${matchId}: ${reason}`);
        }
      }
      
      return removed;
    } catch (error) {
      console.error('[RedisCleanupWorker] Failed to cleanup orphaned active matches:', error);
      return 0;
    }
  }

  /**
   * Scan Redis keys using pattern (handles both cluster and single instance)
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];

    try {
      // Check if we're using cluster
      if (typeof (this.redis as any).nodes === 'function') {
        // Redis Cluster mode
        const nodes = (this.redis as any).nodes('master');
        for (const node of nodes) {
          const nodeKeys = await this.scanNode(node, pattern);
          keys.push(...nodeKeys);
        }
      } else {
        // Single instance mode
        const singleKeys = await this.scanNode(this.redis, pattern);
        keys.push(...singleKeys);
      }
    } catch (error) {
      console.error(`[RedisCleanupWorker] Error scanning keys ${pattern}:`, error);
    }

    return keys;
  }

  /**
   * Scan a single Redis node for keys
   */
  private async scanNode(node: RedisClient, pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const result = await node.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');

    return keys;
  }

  /**
   * Get cleanup statistics
   */
  getStats(): {
    isRunning: boolean;
    lastCleanup: Date | null;
    totalCleanupsRun: number;
    cumulativeStats: CleanupStats;
  } {
    return {
      isRunning: this.isRunning,
      lastCleanup: this.lastCleanup,
      totalCleanupsRun: this.totalCleanupsRun,
      cumulativeStats: { ...this.stats },
    };
  }

  /**
   * Force run cleanup immediately (for testing/manual triggering)
   */
  async forceCleanup(): Promise<CleanupStats> {
    console.log('[RedisCleanupWorker] Force cleanup triggered');
    return await this.runCleanup();
  }
}

// Global singleton instance
let cleanupWorkerInstance: RedisCleanupWorker | null = null;

/**
 * Get or create the global cleanup worker instance
 */
export function getCleanupWorker(intervalMs?: number): RedisCleanupWorker {
  if (!cleanupWorkerInstance) {
    cleanupWorkerInstance = new RedisCleanupWorker(intervalMs);
  }
  return cleanupWorkerInstance;
}

/**
 * Start the global cleanup worker
 */
export function startCleanupWorker(intervalMs?: number): void {
  const worker = getCleanupWorker(intervalMs);
  worker.start();
}

/**
 * Stop the global cleanup worker
 */
export function stopCleanupWorker(): void {
  if (cleanupWorkerInstance) {
    cleanupWorkerInstance.stop();
  }
}

