import { Client, Room } from 'colyseus.js';
import { consumeReservation, clearReservation } from '@/lib/actions';
import { toast } from 'react-toastify';

interface RoomConnectionConfig {
  userId: string;
  isGuest: boolean;
  guestMatchData: unknown;
  onMatchIdSet: (matchId: string) => void;
  onConnected: (connected: boolean) => void;
}

export async function connectToMatchRoom(config: RoomConnectionConfig): Promise<Room> {
  const { userId, isGuest, guestMatchData, onMatchIdSet, onConnected } = config;

  try {
    if (isGuest) {
      if (!guestMatchData) {
        const error = new Error('No guest match data');
        console.error('Guest join failed:', error);
        onConnected(false);
        toast.error('No match data found. Please join the queue again.');
        window.location.href = '/queue';
        throw error;
      }

      if (!(guestMatchData as { roomId?: string }).roomId) {
        const error = new Error('No roomId in guest match data');
        console.error('Guest join failed:', error);
        onConnected(false);
        toast.error('Invalid match data. Please join the queue again.');
        window.location.href = '/queue';
        throw error;
      }

      const reservation = {
        roomId: (guestMatchData as { roomId?: string }).roomId,
        matchId: (guestMatchData as { matchId?: string }).matchId
      };

      const client = new Client(process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!);
      let room: Room;
      try {
        room = await client.joinById(reservation.roomId, { userId, matchId: reservation.matchId });
      } catch (joinError) {
        const errorMessage = joinError instanceof Error ? joinError.message : String(joinError);
        console.error('Guest join failed:', joinError);
        onConnected(false);
        
        // Check if room is already full or doesn't exist
        if (errorMessage.includes('already full') || errorMessage.includes('not found') || errorMessage.includes('404')) {
          toast.error('This match is no longer available. Redirecting to queue...');
        } else {
          toast.error(`Failed to join match: ${errorMessage || 'Unknown error'}`);
        }
        window.location.href = '/queue';
        throw joinError;
      }
      
      onMatchIdSet(reservation.matchId || '');
      onConnected(true);
      
      return room;
    }

    // Regular authenticated user flow
    const res = await consumeReservation(userId);

    if (!res.success || !res.reservation) {
      onConnected(false);
      toast.error('Reservation expired.');
      window.location.href = '/queue';
      throw new Error('Reservation expired');
    }

    const reservation = res.reservation;
    const matchIdValue = reservation?.matchId;
    onMatchIdSet(matchIdValue || '');

    const client = new Client(process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!);
    
    let room: Room;
    try {
      room = await client.joinById(reservation.roomId, { userId, matchId: reservation.matchId });
    } catch (joinError) {
      console.error('Join failed:', joinError);
      
      // Check if room is already full - this is a non-recoverable error
      const errorMessage = joinError instanceof Error ? joinError.message : String(joinError);
      if (errorMessage.includes('already full')) {
        onConnected(false);
        toast.error('This match is already full. Redirecting to queue...');
        window.location.href = '/queue';
        throw joinError;
      }
      
      // Try to clear reservation (non-critical, ignore errors)
      // Use server action which includes proper authentication
      try {
        await clearReservation(userId);
      } catch {
        // Ignore errors from queue/clear - it's not critical
      }
      
      onConnected(false);
      throw joinError;
    }

    (room as unknown as { matchId?: string }).matchId = matchIdValue;
    onConnected(true);
    
    return room;
  } catch (error) {
    console.error('Error connecting to match room:', error);
    onConnected(false);
    toast.error(`Failed to join match: ${error instanceof Error ? error.message : 'Unknown error'}`);
    window.location.href = '/queue';
    throw error;
  }
}

