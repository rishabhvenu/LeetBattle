import type { Client } from 'colyseus';
import { Room } from 'colyseus';
import { createMatch } from '../lib/matchCreation';
import { getPlayerRating } from '../services/playerService';
import { selectProblem } from '../services/problemService';
import { mergePlayersInRoomInfo, broadcastRoomInfo, cleanupPrivateRoomKeys } from '../services/roomMetadata';
import { configureRoomLifecycle } from '../services/roomLifecycle';

interface PlayerInfo {
  userId: string;
  username: string;
  sessionId: string;
}

export class PrivateRoom extends Room {
  // Allow extra sockets for safe reconnections while enforcing 2 unique players at app level
  maxClients = 4;
  public roomCode!: string; // Make public so filterBy can access it
  private creatorId!: string;
  private players: Map<string, PlayerInfo> = new Map();
  private selectedProblemId: string | null = null;
  async onCreate(options: { roomCode: string; creatorId: string; creatorUsername: string }) {
    this.roomCode = options.roomCode.toUpperCase();
    this.creatorId = options.creatorId;

    configureRoomLifecycle(this, { autoDispose: false, seatReservationSeconds: 60, isPrivate: false });

    console.log(`PrivateRoom onCreate called with roomCode: ${this.roomCode}`);
    console.log(`Room state before unlock - locked: ${this.locked}, clients: ${this.clients.length}/${this.maxClients}`);
    
    // Store room code for lookup
    this.setMetadata({ roomCode: this.roomCode });
    
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
      const blob = await mergePlayersInRoomInfo(this.roomCode, this.players, { creatorId: this.creatorId });
      await broadcastRoomInfo(this, blob);
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
      const payload = await mergePlayersInRoomInfo(this.roomCode, this.players, { creatorId: this.creatorId });
      await broadcastRoomInfo(this, payload);
    } catch (e) {
      console.error('Failed to broadcast room_info on leave:', e);
    }
    
    // If creator left, dispose room
    if (!this.players.has(this.creatorId)) {
      console.log(`Creator left, disposing private room ${this.roomCode}`);
      // Clean up Redis entries
      await cleanupPrivateRoomKeys(this.roomCode);
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
      const blob = await mergePlayersInRoomInfo(this.roomCode, this.players, {
        creatorId: this.creatorId,
        selectedProblemId: message.problemId,
      });
      await broadcastRoomInfo(this, blob);
      this.broadcast('problem_selected', { problemId: message.problemId });
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
      // Create match using shared helpers
      const playersArray = Array.from(this.players.values());
      const [player1, player2] = playersArray;

      const [player1Rating, player2Rating] = await Promise.all([
        getPlayerRating(player1.userId),
        getPlayerRating(player2.userId),
      ]);

      const problemSelection = await selectProblem({
        selectedProblemId: this.selectedProblemId,
        difficulty: 'Medium',
      });
      this.selectedProblemId = problemSelection.problemId;

      const matchResult = await createMatch(
        { userId: player1.userId, rating: player1Rating.rating },
        { userId: player2.userId, rating: player2Rating.rating },
        problemSelection.difficulty,
        true, // isPrivate
        {
          problemId: problemSelection.problemId,
          problemData: problemSelection.problemData,
          difficulty: problemSelection.difficulty,
        },
      );
      
      // Update Redis blob status and broadcast unified room_info
      try {
        const blob = await mergePlayersInRoomInfo(this.roomCode, this.players, {
          creatorId: this.creatorId,
          status: 'starting',
          matchId: matchResult.matchId,
          matchRoomId: matchResult.roomId,
          problemId: matchResult.problemId,
        });
        await broadcastRoomInfo(this, blob);
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
        await cleanupPrivateRoomKeys(this.roomCode);
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

}
