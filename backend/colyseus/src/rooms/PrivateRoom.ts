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
  maxClients = 2;
  private roomCode!: string;
  private creatorId!: string;
  private players: Map<string, PlayerInfo> = new Map();
  private selectedProblemId: string | null = null;
  private redis = getRedis();

  async onCreate(options: { roomCode: string; creatorId: string; creatorUsername: string }) {
    this.roomCode = options.roomCode.toUpperCase();
    this.creatorId = options.creatorId;
    
    console.log(`PrivateRoom onCreate called with roomCode: ${this.roomCode}`);
    
    // Store room code for lookup
    this.setMetadata({ roomCode: this.roomCode });
    
    // Set 10 minute timeout for room
    this.setSeatReservationTime(600);
    
    console.log(`PrivateRoom created: ${this.roomCode}`);
    
    // Handle problem selection (creator only)
    this.onMessage('select_problem', (client, message: { userId: string; problemId: string }) => {
      this.handleSelectProblem(client, message);
    });

    // Handle match start (creator only)
    this.onMessage('start_match', (client, message: { userId: string }) => {
      this.handleStartMatch(client, message);
    });
  }

  async onAuth(client: Client, options: { userId: string; username: string; roomCode: string }) {
    // Verify room code matches
    if (options.roomCode.toUpperCase() !== this.roomCode) {
      throw new Error('Invalid room code');
    }
    
    // Check if room is full
    if (this.clients.length >= 2) {
      throw new Error('Room is full');
    }
    
    return { userId: options.userId, username: options.username };
  }

  async onJoin(client: Client, options: { userId: string; username: string }) {
    const { userId, username } = options;
    
    this.players.set(userId, {
      userId,
      username,
      sessionId: client.sessionId
    });
    
    // Broadcast updated player list to all clients
    this.broadcast('players_updated', {
      players: Array.from(this.players.values()).map(p => ({ userId: p.userId, username: p.username })),
      creatorId: this.creatorId
    });
    
    console.log(`Player ${username} joined private room ${this.roomCode}`);
  }

  async onLeave(client: Client, consented: boolean) {
    // Find and remove player
    for (const [userId, player] of this.players.entries()) {
      if (player.sessionId === client.sessionId) {
        this.players.delete(userId);
        console.log(`Player ${player.username} left private room ${this.roomCode}`);
        break;
      }
    }
    
    // Broadcast updated player list
    this.broadcast('players_updated', {
      players: Array.from(this.players.values()).map(p => ({ userId: p.userId, username: p.username })),
      creatorId: this.creatorId
    });
    
    // If creator left, dispose room
    if (!this.players.has(this.creatorId)) {
      console.log(`Creator left, disposing private room ${this.roomCode}`);
      // Clean up Redis entry
      const redis = getRedis();
      await redis.del(`private:room:${this.roomCode}`);
      this.disconnect();
    }
  }


  private async handleSelectProblem(client: Client, message: { userId: string; problemId: string }) {
    if (message.userId !== this.creatorId) {
      client.send('error', { message: 'Only creator can select problem' });
      return;
    }
    
    this.selectedProblemId = message.problemId;
    
    // Broadcast to all players
    this.broadcast('problem_selected', { problemId: message.problemId });
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
      
      // Broadcast match_started to ALL players
      this.broadcast('match_started', {
        matchId: matchResult.matchId,
        roomId: matchResult.roomId,
        problemId: matchResult.problemId
      });
      
      console.log(`Private match started: ${matchResult.matchId}`);
      
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
