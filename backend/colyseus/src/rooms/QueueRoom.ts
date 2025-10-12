import { Client, Room, matchMaker } from 'colyseus';
import { getRedis, RedisKeys } from '../lib/redis';
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://codeclashers-mongodb:27017';
const DB_NAME = 'codeclashers';

interface QueuedPlayer {
  userId: string;
  sessionId: string;
  rating: number;
  joinedAt: number;
}

export class QueueRoom extends Room {
  maxClients = 1000;
  private redis = getRedis();
  // Removed: in-memory Map - now using Redis as single source of truth
  // Queue is managed via Redis ZSET (lib/queue.ts)
  // Background worker (workers/matchmaker.ts) handles all matching

  async onCreate(options: any) {
    console.log('QueueRoom created - players managed in Redis, matched by background worker');
    // Removed: local matchmaking interval - worker handles this
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
    // Or store sessionId->userId mapping when they join
    console.log(`Client ${client.sessionId} left queue room`);
  }

  async onDispose() {
    console.log('QueueRoom disposed');
  }

  // DEPRECATED: This entire method is no longer used
  // Background worker (workers/matchmaker.ts) handles all matching from Redis
  private async tryMatchPlayers_DEPRECATED() {
    return; // No-op

    this.isMatching = true;

    try {
      const players = Array.from(this.queuedPlayers.values());
      
      // Find two closest players by rating
      players.sort((a, b) => a.rating - b.rating);
      
      // Create as many matches as possible
      const matchedPlayers = new Set<string>();
      
      for (let i = 0; i < players.length - 1; i++) {
        if (matchedPlayers.has(players[i].userId)) continue;
        
        // Find best match for this player among remaining players
        let bestMatch: QueuedPlayer | null = null;
        let bestDiff = Number.POSITIVE_INFINITY;
        
        for (let j = i + 1; j < players.length; j++) {
          if (matchedPlayers.has(players[j].userId)) continue;
          
          const diff = Math.abs(players[i].rating - players[j].rating);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestMatch = players[j];
          }
        }
        
        if (bestMatch) {
          const player1 = players[i];
          const player2 = bestMatch;
          
          console.log(`Creating match: ${player1.userId} (${player1.rating}) vs ${player2.userId} (${player2.rating}), diff: ${bestDiff}`);
          
          // Mark as matched
          matchedPlayers.add(player1.userId);
          matchedPlayers.add(player2.userId);
          
          // Remove from queue
          this.queuedPlayers.delete(player1.userId);
          this.queuedPlayers.delete(player2.userId);
          
          // Create match (don't await - do it async)
          this.createMatch(player1, player2).catch(error => {
            console.error('Error creating match:', error);
            // Re-add players to queue on failure
            this.queuedPlayers.set(player1.userId, player1);
            this.queuedPlayers.set(player2.userId, player2);
          });
        }
      }
      
      if (matchedPlayers.size > 0) {
        console.log(`Queue status: ${this.queuedPlayers.size} players remaining`);
      }
    } finally {
      this.isMatching = false;
    }
  }

  // Removed: createMatch() - background worker creates matches
  
  private async createMatch_DEPRECATED(player1: QueuedPlayer, player2: QueuedPlayer) {
    // This method is no longer used - kept for reference
    // Background worker (workers/matchmaker.ts) now handles match creation
    const matchId = this.generateMatchId();
    
    // Select problem based on ratings
    const avgRating = (player1.rating + player2.rating) / 2;
    const difficulty = this.getDifficultyFromRating(avgRating);
    const problem = await this.selectRandomProblem(difficulty);
    
    if (!problem) {
      console.error('No problem found for difficulty:', difficulty);
      return;
    }
    
    console.log(`Creating match ${matchId} with problem: ${problem.title}`);
    
    // Fetch player info from MongoDB (username, avatar)
    const playerInfo = await this.getPlayersInfo([player1.userId, player2.userId]);
    
    // Create match room
    const room = await matchMaker.createRoom('match', { 
      matchId, 
      problemId: problem._id,
      problemData: problem 
    });
    
    // Store match data in Redis
    await this.redis.set(
      RedisKeys.matchKey(matchId),
      JSON.stringify({
        matchId,
        problemId: problem._id,
        problem,
        status: 'ongoing',
        startedAt: new Date().toISOString(),
        players: [player1.userId, player2.userId], // Array of player IDs
        playerData: {
          [player1.userId]: { 
            rating: player1.rating,
            username: playerInfo[player1.userId]?.username || 'Player 1',
            avatar: playerInfo[player1.userId]?.avatar || null,
          },
          [player2.userId]: { 
            rating: player2.rating,
            username: playerInfo[player2.userId]?.username || 'Player 2',
            avatar: playerInfo[player2.userId]?.avatar || null,
          },
        },
        playersCode: {},
        linesWritten: {},
        submissions: [],
      }),
      'EX',
      3600
    );
    
    // Store room info for both players
    const roomData = { roomId: room.roomId, roomName: 'match', matchId, problemId: problem._id };
    await this.redis.set(`queue:reservation:${player1.userId}`, JSON.stringify(roomData), 'EX', 3600);
    await this.redis.set(`queue:reservation:${player2.userId}`, JSON.stringify(roomData), 'EX', 3600);
    
    // Notify players via their client connections
    const client1 = this.clients.find(c => c.sessionId === player1.sessionId);
    const client2 = this.clients.find(c => c.sessionId === player2.sessionId);
    
    if (client1) {
      client1.send('match_found', { matchId, roomId: room.roomId });
    }
    if (client2) {
      client2.send('match_found', { matchId, roomId: room.roomId });
    }
    
    console.log(`Match ${matchId} created successfully`);
  }

  private getDifficultyFromRating(avgRating: number): string {
    // Map ELO rating to problem difficulty
    if (avgRating < 1400) {
      return 'Easy';
    } else if (avgRating < 1800) {
      return 'Medium';
    } else {
      return 'Hard';
    }
  }

  private async selectRandomProblem(difficulty: string) {
    const client = new MongoClient(MONGODB_URI, {
      monitorCommands: false,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    try {
      await client.connect();
      
      const db = client.db(DB_NAME);
      const problemsCollection = db.collection('problems');

      const problems = await problemsCollection
        .aggregate([
          { $match: { difficulty, verified: true } },
          { $sample: { size: 1 } }
        ])
        .toArray();

      if (problems.length === 0) {
        return null;
      }

      const problem = problems[0];
      
      return {
        _id: problem._id.toString(),
        title: problem.title,
        difficulty: problem.difficulty,
        topics: problem.topics || [],
        description: problem.description,
        examples: problem.examples || [],
        constraints: problem.constraints || [],
        signature: problem.signature || null,
        testCasesCount: (problem.testCases || []).length,
      };
    } catch (error) {
      console.error('Error selecting problem:', error);
      return null;
    } finally {
      // Always close connection to prevent leaks
      await client.close();
    }
  }

  private generateMatchId(): string {
    // Use crypto for collision-resistant match IDs
    return require('crypto').randomBytes(16).toString('hex');
  }

  private async getPlayersInfo(playerIds: string[]): Promise<Record<string, { username: string; avatar: string | null }>> {
    const client = new MongoClient(MONGODB_URI);
    
    try {
      await client.connect();
      
      const db = client.db(DB_NAME);
      const usersCollection = db.collection('users');

      const { ObjectId } = await import('mongodb');
      const objectIds = playerIds.map(id => new ObjectId(id));
      
      const users = await usersCollection
        .find({ _id: { $in: objectIds } })
        .project({ username: 1, 'profile.avatar': 1 })
        .toArray();

      const result: Record<string, { username: string; avatar: string | null }> = {};
      
      for (const user of users) {
        const userId = user._id.toString();
        const profile = (user as any).profile;
        const avatar = profile?.avatar || null;
        
        result[userId] = {
          username: user.username as string || 'Player',
          avatar: avatar,
        };
        
        console.log(`Fetched player ${userId}: username=${result[userId].username}, avatar=${avatar}`);
      }

      return result;
    } catch (error) {
      console.error('Error fetching player info:', error);
      return {};
    } finally {
      // Always close connection to prevent leaks
      await client.close();
    }
  }
}

