import { Client, Room } from 'colyseus';
import { getRedis, RedisKeys } from '../lib/redis';

export class QueueRoom extends Room {
  maxClients = 1000;
  private redis = getRedis();
  // Queue managed via Redis ZSET (lib/queue.ts)
  // Background worker (workers/matchmaker.ts) handles all matching

  async onCreate(options: any) {
    console.log('QueueRoom created - players managed in Redis, matched by background worker');
  }

  async onJoin(client: Client, options: { userId: string; rating: number }) {
    const { userId, rating } = options;
    
    console.log(`Player ${userId} attempting to join queue with rating ${rating}`);
    
    // Check if player already has an active match
    const existingReservation = await this.redis.get(`queue:reservation:${userId}`);
    if (existingReservation) {
      const reservationData = JSON.parse(existingReservation);
      console.log(`Player ${userId} already has an active match: ${reservationData.matchId}`);
      
      // Send them the match info and disconnect them from queue
      client.send('already_in_match', { 
        matchId: reservationData.matchId,
        roomId: reservationData.roomId 
      });
      
      // Kick them from queue room
      client.leave();
      return;
    }
    
    console.log(`Player ${userId} added to Redis queue with rating ${rating}`);
    
    // Add player to Redis queue (same as HTTP endpoint)
    // This ensures background worker will match them
    await this.redis.zadd(RedisKeys.eloQueue, rating || 1200, userId);
    
    // Send confirmation to client
    client.send('queued', { position: await this.redis.zcard(RedisKeys.eloQueue) });
  }

  async onLeave(client: Client, consented: boolean) {
    // Note: We don't have userId from client object directly
    // Client should call /queue/dequeue HTTP endpoint when leaving
    console.log(`Client ${client.sessionId} left queue room`);
  }

  async onDispose() {
    console.log('QueueRoom disposed');
  }
}
