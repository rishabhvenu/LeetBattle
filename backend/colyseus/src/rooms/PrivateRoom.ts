import { Client, Room } from 'colyseus';
import { getRedis, RedisKeys } from '../lib/redis';
import { createMatch } from '../lib/matchCreation';
import { getProblemWithTestCases } from '../lib/problemData';
import { MongoClient, ObjectId } from 'mongodb';

interface PlayerInfo {
  userId: string;
  username: string;
  sessionId: string;
}

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

export class PrivateRoom extends Room {
  // Allow extra sockets for safe reconnections while enforcing 2 unique players at app level
  maxClients = 4;
  public roomCode!: string; // Make public so filterBy can access it
  private creatorId!: string;
  private players: Map<string, PlayerInfo> = new Map();
  private selectedProblemId: string | null = null;
  private redis = getRedis();

  async onCreate(options: { roomCode: string; creatorId: string; creatorUsername: string }) {
    this.roomCode = options.roomCode.toUpperCase();
    this.creatorId = options.creatorId;
    
    // Keep room alive even if temporarily empty (creator navigates)
    this.autoDispose = false;

    console.log(`PrivateRoom onCreate called with roomCode: ${this.roomCode}`);
    console.log(`Room state before unlock - locked: ${this.locked}, clients: ${this.clients.length}/${this.maxClients}`);
    
    // Store room code for lookup
    this.setMetadata({ roomCode: this.roomCode });
    
    // CRITICAL: Configure room to be joinable (not private) and unlocked
    this.setPrivate(false); // Make room joinable
    this.unlock(); // Explicitly unlock the room immediately
    
    console.log(`Room state after unlock - locked: ${this.locked}, clients: ${this.clients.length}/${this.maxClients}`);
    console.log(`PrivateRoom created and unlocked: ${this.roomCode}`);
    
    // Initial room is empty; HTTP layer seeds Redis info blob. We rely on room_info updates after joins.

    // Handle problem selection (creator only)
    this.onMessage('select_problem', (client, message: { userId: string; problemId: string }) => {
      this.handleSelectProblem(client, message);
    });

    // Handle match start (creator only)
    this.onMessage('start_match', (client, message: { userId: string }) => {
      this.handleStartMatch(client, message);
    });
  }

  async onAuth(client: Client, options: any) {
    // Verify room code matches if provided
    if (options.roomCode && options.roomCode.toUpperCase() !== this.roomCode) {
      console.log(`Room code mismatch: expected ${this.roomCode}, got ${options.roomCode}`);
      throw new Error('Invalid room code');
    }
    
    // Allow reconnections by same userId. Only block if room already has 2 unique users and this user is not one of them.
    const isKnownUser = options.userId && this.players.has(options.userId);
    if (this.players.size >= 2 && !isKnownUser) {
      console.log(`Room ${this.roomCode} is full: ${this.players.size} players, ${this.clients.length} clients`);
      throw new Error('Room is full');
    }
    
    return { userId: options.userId, username: options.username, roomCode: options.roomCode };
  }

  async onJoin(client: Client, options: { userId: string; username: string }) {
    const { userId, username } = options;
    
    // CRITICAL: Ensure room stays unlocked when players join
    this.unlock();
    
    // Ensure we don't duplicate players (in case of reconnection)
    if (!this.players.has(userId)) {
      this.players.set(userId, {
        userId,
        username,
        sessionId: client.sessionId
      });
    } else {
      // Update session ID if user reconnected with new session
      const existingPlayer = this.players.get(userId);
      if (existingPlayer) {
        existingPlayer.sessionId = client.sessionId;
      }
      console.log(`User ${username} reconnected to private room ${this.roomCode}`);
    }
    
    // Broadcast updated player list to all clients (merge with existing HTTP-seeded blob to avoid wiping host)
    try {
      const infoKey = `private:room:${this.roomCode}:info`;
      const raw = await this.redis.get(infoKey);
      if (raw) {
        const blob = JSON.parse(raw);
        const existingPlayers: Array<{ userId: string; username: string }> = Array.isArray(blob.players) ? blob.players : [];
        const inMemoryPlayers = Array.from(this.players.values()).map(p => ({ userId: p.userId, username: p.username }));
        // Merge by userId, prefer in-memory username/session freshness
        const mergedMap = new Map<string, { userId: string; username: string }>();
        for (const p of existingPlayers) mergedMap.set(p.userId, p);
        for (const p of inMemoryPlayers) mergedMap.set(p.userId, p);
        blob.players = Array.from(mergedMap.values());
        // Ensure creatorId persists
        if (!blob.creatorId) { blob.creatorId = this.creatorId; }
        await this.redis.setex(infoKey, 1800, JSON.stringify(blob));
        this.broadcast('room_info', blob);
      }
    } catch (e) {
      console.error('Failed to broadcast room_info on join:', e);
    }
    
    console.log(`Player ${username} joined private room ${this.roomCode}`);
  }

  async onLeave(client: Client, consented: boolean) {
    // Find and remove player
    let leftUserId: string | undefined;
    for (const [userId, player] of this.players.entries()) {
      if (player.sessionId === client.sessionId) {
        leftUserId = userId;
        this.players.delete(userId);
        console.log(`Player ${player.username} left private room ${this.roomCode}`);
        break;
      }
    }
    
    // No separate players set; info blob is the source of truth
    
    // Broadcast updated room info (merge without wiping HTTP-seeded host)
    try {
      const infoKey = `private:room:${this.roomCode}:info`;
      const raw = await this.redis.get(infoKey);
      if (raw) {
        const blob = JSON.parse(raw);
        const existingPlayers: Array<{ userId: string; username: string }> = Array.isArray(blob.players) ? blob.players : [];
        // Remove the left user from existing list if present
        const filteredExisting = existingPlayers.filter(p => p.userId !== leftUserId);
        const inMemoryPlayers = Array.from(this.players.values()).map(p => ({ userId: p.userId, username: p.username }));
        const mergedMap = new Map<string, { userId: string; username: string }>();
        for (const p of filteredExisting) mergedMap.set(p.userId, p);
        for (const p of inMemoryPlayers) mergedMap.set(p.userId, p);
        blob.players = Array.from(mergedMap.values());
        if (!blob.creatorId) { blob.creatorId = this.creatorId; }
        await this.redis.setex(infoKey, 1800, JSON.stringify(blob));
        this.broadcast('room_info', blob);
      }
    } catch (e) {
      console.error('Failed to broadcast room_info on leave:', e);
    }
    
    // If creator left, dispose room
    if (!this.players.has(this.creatorId)) {
      console.log(`Creator left, disposing private room ${this.roomCode}`);
      // Clean up Redis entries
      await this.redis.del(`private:room:${this.roomCode}`);
      await this.redis.del(`private:room:${this.roomCode}:info`);
      await this.redis.del(`private:room:${this.roomCode}:players`);
      this.disconnect();
    }
  }


  private async handleSelectProblem(client: Client, message: { userId: string; problemId: string }) {
    if (message.userId !== this.creatorId) {
      client.send('error', { message: 'Only creator can select problem' });
      return;
    }
    
    this.selectedProblemId = message.problemId;
    
    // Update Redis room info blob
    try {
      const infoKey = `private:room:${this.roomCode}:info`;
      const raw = await this.redis.get(infoKey);
      if (raw) {
        const blob = JSON.parse(raw);
        blob.selectedProblemId = message.problemId;
        await this.redis.setex(infoKey, 1800, JSON.stringify(blob));
        // Broadcast unified room_info for clients
        this.broadcast('room_info', blob);
        // Also emit problem_selected for clients expecting this event
        this.broadcast('problem_selected', { problemId: message.problemId });
      }
    } catch (e) {
      console.error('Failed to update selectedProblem in room info:', e);
    }
    console.log(`Problem selected in private room ${this.roomCode}: ${message.problemId}`);
  }

  private async handleStartMatch(client: Client, message: { userId: string }) {
    if (message.userId !== this.creatorId) {
      client.send('error', { message: 'Only creator can start match' });
      return;
    }
    
    if (this.players.size !== 2) {
      client.send('error', { message: 'Need exactly 2 players to start' });
      return;
    }
    
    try {
      // Create match using existing createMatch logic
      const playersArray = Array.from(this.players.values());
      const player1 = playersArray[0];
      const player2 = playersArray[1];
      
      // Get ratings from MongoDB
      const player1Rating = await this.getPlayerRating(player1.userId);
      const player2Rating = await this.getPlayerRating(player2.userId);
      
      // Determine difficulty
      let difficulty = 'Medium';
      let problemId = this.selectedProblemId;
      
      if (!problemId) {
        // Select random Medium problem if none selected
        problemId = await this.selectRandomProblem(difficulty);
      }
      
      // Fetch problem data
      const problemData = await getProblemWithTestCases(problemId);
      
      if (!problemData) {
        throw new Error('Failed to fetch problem data');
      }
      
      // Create match
      const matchResult = await createMatch(
        { userId: player1.userId, rating: player1Rating },
        { userId: player2.userId, rating: player2Rating },
        problemData.difficulty,
        true // isPrivate
      );
      
      // Update Redis blob status and broadcast unified room_info
      try {
        const infoKey = `private:room:${this.roomCode}:info`;
        const raw = await this.redis.get(infoKey);
        if (raw) {
          const blob = JSON.parse(raw);
          blob.status = 'starting';
          blob.matchId = matchResult.matchId;
          blob.matchRoomId = matchResult.roomId;
          blob.problemId = matchResult.problemId;
          await this.redis.setex(infoKey, 1800, JSON.stringify(blob));
          this.broadcast('room_info', blob);
        }
      } catch (e) {
        console.error('Failed to update room status on start:', e);
      }
      
      console.log(`Private match started: ${matchResult.matchId}`);
      
      // Emit explicit match_started event for clients listening to it
      this.broadcast('match_started', {
        matchId: matchResult.matchId,
        roomId: matchResult.roomId,
        problemId: matchResult.problemId
      });

      // Clean up room metadata in Redis after starting
      try {
        await this.redis.del(`private:room:${this.roomCode}`);
        await this.redis.del(`private:room:${this.roomCode}:info`);
        await this.redis.del(`private:room:${this.roomCode}:players`);
      } catch (e) {
        console.error('Failed to cleanup private room keys after match start:', e);
      }

      // Dispose room after short delay
      setTimeout(() => this.disconnect(), 1000);
      
    } catch (error) {
      console.error('Error starting private match:', error);
      client.send('error', { message: 'Failed to start match' });
    }
  }

  private async getPlayerRating(userId: string): Promise<number> {
    try {
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      
      // Check if user is a bot
      const bots = db.collection('bots');
      const bot = await bots.findOne({ _id: new ObjectId(userId) });
      if (bot) {
        return bot.stats?.rating || 1200;
      }
      
      // Check regular users
      const users = db.collection('users');
      const user = await users.findOne({ _id: new ObjectId(userId) });
      if (user) {
        return user.stats?.rating || 1200;
      }
      
      return 1200; // Default rating
    } catch (error) {
      console.error('Error fetching player rating:', error);
      return 1200;
    }
  }

  private async selectRandomProblem(difficulty: string): Promise<string> {
    try {
      const mongoClient = await getMongoClient();
      const db = mongoClient.db(DB_NAME);
      const problems = db.collection('problems');
      
      const randomProblems = await problems
        .aggregate([
          { $match: { difficulty, verified: true } },
          { $sample: { size: 1 } }
        ])
        .toArray();
      
      if (randomProblems.length > 0) {
        return randomProblems[0]._id.toString();
      }
      
      // Fallback to any verified problem
      const anyProblems = await problems
        .aggregate([
          { $match: { verified: true } },
          { $sample: { size: 1 } }
        ])
        .toArray();
      
      if (anyProblems.length > 0) {
        return anyProblems[0]._id.toString();
      }
      
      throw new Error('No problems available');
    } catch (error) {
      console.error('Error selecting random problem:', error);
      throw error;
    }
  }
}
