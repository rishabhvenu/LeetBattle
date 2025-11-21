import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Client, Room } from 'colyseus.js';
import { toast } from 'react-toastify';

export type QueueStatus = "waiting" | "matched" | "error" | "cancelled";

interface UseQueueWebSocketOptions {
  userId: string;
  rating: number;
  isGuest?: boolean;
  onMatchFound?: (data: { matchId: string; roomId: string; problemId?: string }) => void;
  enabled?: boolean;
}

interface UseQueueWebSocketReturn {
  room: Room | null;
  queueStatus: QueueStatus;
  setQueueStatus: (status: QueueStatus) => void;
  errorMessage: string | null;
  setErrorMessage: (message: string | null) => void;
  shouldCancelRef: React.MutableRefObject<boolean>;
  leaveQueue: () => Promise<void>;
}

export function useQueueWebSocket({
  userId,
  rating,
  isGuest = false,
  onMatchFound,
  enabled = true,
}: UseQueueWebSocketOptions): UseQueueWebSocketReturn {
  const router = useRouter();
  const [queueStatus, setQueueStatus] = useState<QueueStatus>("waiting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const clientRef = useRef<Client | null>(null);
  const shouldCancelRef = useRef(true);
  const joinPromiseRef = useRef<Promise<unknown> | null>(null);
  const reservationPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueStatusRef = useRef<QueueStatus>("waiting");

  // Keep ref in sync with state
  useEffect(() => {
    queueStatusRef.current = queueStatus;
  }, [queueStatus]);

  // Helper to stop polling
  const stopPolling = () => {
    if (reservationPollIntervalRef.current) {
      clearInterval(reservationPollIntervalRef.current);
      reservationPollIntervalRef.current = null;
    }
  };

  // Helper to handle match found
  const handleMatchFound = (data: { matchId: string; roomId: string; problemId?: string }) => {
    console.log('Match found!', data);
    setQueueStatus('matched');
    shouldCancelRef.current = false;
    stopPolling();
    
    // Call custom handler if provided
    if (onMatchFound) {
      onMatchFound(data);
    }
    
    // For guests, store match info in cookie
    if (isGuest && data.matchId && data.roomId) {
      const matchBootstrap = {
        guestId: userId,
        matchId: data.matchId,
        roomId: data.roomId,
        createdAt: Date.now(),
      };
      document.cookie = `codeclashers.guest.match=${encodeURIComponent(JSON.stringify(matchBootstrap))}; path=/; max-age=${7 * 24 * 60 * 60}; samesite=lax`;
    }
    
    if (roomRef.current) {
      try { roomRef.current.leave(); } catch {}
    }
    
    setTimeout(() => {
      router.push('/match');
    }, isGuest ? 500 : 0);
  };

  // Start reservation polling
  const startReservationPolling = (isMounted: boolean) => {
    // Clear any existing polling
    stopPolling();
    
    const checkReservation = async () => {
      // Only poll if we're still waiting and mounted
      if (!isMounted || queueStatusRef.current !== 'waiting' || shouldCancelRef.current === false) {
        stopPolling();
        return;
      }

      try {
        const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
        const response = await fetch(`${base}/queue/reservation?userId=${encodeURIComponent(userId)}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.token) {
            // Reservation found - match was created while tab was hidden
            console.log('Match reservation found via HTTP poll - match was created while tab was hidden');
            try {
              const consumeResponse = await fetch(`${base}/reserve/consume`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: data.token })
              });
              
              if (consumeResponse.ok) {
                const reservationData = await consumeResponse.json();
                handleMatchFound({
                  matchId: reservationData.reservation.matchId,
                  roomId: reservationData.reservation.roomId,
                  problemId: reservationData.reservation.problemId
                });
              }
            } catch (error) {
              console.error('Failed to consume reservation:', error);
            }
          }
        } else if (response.status === 404) {
          // No reservation - continue polling
        } else {
          console.warn('Unexpected response from reservation check:', response.status);
        }
      } catch (error) {
        console.error('Error checking reservation:', error);
        // Continue polling even on error
      }
    };

    // Check immediately, then every 2 seconds
    checkReservation();
    reservationPollIntervalRef.current = setInterval(checkReservation, 2000);
  };

  // Register message handlers on a room
  const registerMessageHandlers = (room: Room, isMounted: boolean) => {
    // Server confirmation that we're in the queue
    room.onMessage('queued', (data) => {
      console.log('Queued, position:', data?.position);
    });
    
    room.onMessage('match_found', handleMatchFound);
    
    room.onMessage('already_in_match', (data) => {
      console.log('Already in active match:', data);
      shouldCancelRef.current = false;
      stopPolling();
      
      // For guests, store match info in cookie
      if (isGuest && data.matchId && data.roomId) {
        const matchBootstrap = {
          guestId: userId,
          matchId: data.matchId,
          roomId: data.roomId,
          createdAt: Date.now(),
        };
        document.cookie = `codeclashers.guest.match=${encodeURIComponent(JSON.stringify(matchBootstrap))}; path=/; max-age=${7 * 24 * 60 * 60}; samesite=lax`;
      }
      
      toast.info('Redirecting to your active match...');
      if (roomRef.current) {
        try { roomRef.current.leave(); } catch {}
      }
      setTimeout(() => {
        router.push('/match');
      }, isGuest ? 500 : 0);
    });
    
    room.onError((code, message) => {
      console.error('Queue room error:', code, message);
      toast.error('Queue error: ' + message);
      if (isMounted) {
        setQueueStatus('error');
        setErrorMessage(message);
      }
    });
    
    room.onLeave((code) => {
      console.log('Left queue room:', code);
      if (shouldCancelRef.current && isMounted) {
        setQueueStatus('cancelled');
      }
    });
  };

  // Connect to queue room
  const connectToQueue = async (isMounted: boolean) => {
    try {
      if (roomRef.current) {
        console.log('Queue room already connected, skipping duplicate join');
        return;
      }
      if (joinPromiseRef.current) {
        console.log('Queue join already in progress, waiting for completion');
        await joinPromiseRef.current;
        return;
      }

      console.log('Connecting to queue room...', userId, rating);
      
      const client = new Client(process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!);
      clientRef.current = client;
      const pendingJoin = client.joinOrCreate('queue', { userId, rating });
      joinPromiseRef.current = pendingJoin;
      const room = await pendingJoin;
      roomRef.current = room;
      joinPromiseRef.current = null;
      
      console.log('Joined queue room:', room.id);

      registerMessageHandlers(room, isMounted);
      startReservationPolling(isMounted);
      
    } catch (error) {
      joinPromiseRef.current = null;
      console.error('Failed to join queue:', error);
      const message = error instanceof Error ? error.message : 'Failed to join queue';
      toast.error(isGuest ? message : 'Failed to join queue.');
      if (isMounted) {
        setQueueStatus("error");
        setErrorMessage(message);
      }
    }
  };

  // Reconnect logic
  const reconnectToQueue = async (isMounted: boolean) => {
    if (!clientRef.current || joinPromiseRef.current) {
      return;
    }

    try {
      const newRoom = await clientRef.current.joinOrCreate('queue', { userId, rating });
      roomRef.current = newRoom;
      
      registerMessageHandlers(newRoom, isMounted);
      startReservationPolling(isMounted);
      
      console.log('Reconnected to queue room:', newRoom.id);
    } catch (error) {
      console.error('Failed to reconnect to queue room:', error);
    }
  };

  // Check for reservation when page becomes visible
  const checkReservationOnVisible = async () => {
    try {
      const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
      const response = await fetch(`${base}/queue/reservation?userId=${encodeURIComponent(userId)}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          console.log('Match reservation found when tabbing back in - match was created while tab was hidden');
          try {
            const consumeResponse = await fetch(`${base}/reserve/consume`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: data.token })
            });
            
            if (consumeResponse.ok) {
              const reservationData = await consumeResponse.json();
              
              // For guests, store match info in cookie
              if (isGuest && reservationData.reservation?.matchId && reservationData.reservation?.roomId) {
                const matchBootstrap = {
                  guestId: userId,
                  matchId: reservationData.reservation.matchId,
                  roomId: reservationData.reservation.roomId,
                  createdAt: Date.now(),
                };
                document.cookie = `codeclashers.guest.match=${encodeURIComponent(JSON.stringify(matchBootstrap))}; path=/; max-age=${7 * 24 * 60 * 60}; samesite=lax`;
              }
              
              setQueueStatus('matched');
              shouldCancelRef.current = false;
              stopPolling();
              if (roomRef.current) {
                try { roomRef.current.leave(); } catch {}
              }
              setTimeout(() => {
                router.push('/match');
              }, isGuest ? 500 : 0);
            }
          } catch (error) {
            console.error('Failed to consume reservation:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error checking reservation on visibility change:', error);
    }
  };

  // Main effect to connect to queue
  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;
    shouldCancelRef.current = true;

    connectToQueue(isMounted);

    return () => {
      isMounted = false;
      stopPolling();
      if (roomRef.current && shouldCancelRef.current) {
        try {
          roomRef.current.leave();
          roomRef.current = null;
        } catch {}
      }
    };
  }, [userId, rating, enabled]);

  // Handle visibility changes for reconnection
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = async () => {
      // Handle page becoming hidden
      if (document.visibilityState === 'hidden') {
        return;
      }

      // Handle page becoming visible - check connection and poll for missed matches
      if (document.visibilityState === 'visible' && queueStatusRef.current === 'waiting') {
        console.log('Page became visible - checking connection state and polling for matches');
        
        // Check if WebSocket connection is still alive
        const room = roomRef.current;
        if (room) {
          try {
            const connection = (room as any).connection;
            const isConnected = connection && (connection.isOpen === true || connection.readyState === WebSocket.OPEN);
            
            if (!isConnected) {
              console.log('WebSocket connection is dead, reconnecting...');
              
              // Clean up old connection
              try {
                room.leave();
              } catch {}
              roomRef.current = null;
              
              await reconnectToQueue(true);
            } else {
              console.log('WebSocket connection is still alive');
            }
          } catch (error) {
            console.error('Error checking connection state:', error);
          }
        } else {
          console.log('No room connection found, attempting to reconnect...');
          await reconnectToQueue(true);
        }
        
        // Immediately check for reservation when page becomes visible
        await checkReservationOnVisible();
      }
    };

    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [userId, rating, enabled, router, isGuest]);

  // Leave queue function
  const leaveQueue = async () => {
    shouldCancelRef.current = false;
    stopPolling();
    if (roomRef.current) {
      try {
        await roomRef.current.leave();
        roomRef.current = null;
      } catch (error) {
        console.warn('Failed to leave queue room:', error);
      }
    }
  };

  return {
    room: roomRef.current, // Note: This is a ref value, not reactive. Components typically don't need direct room access.
    queueStatus,
    setQueueStatus,
    errorMessage,
    setErrorMessage,
    shouldCancelRef,
    leaveQueue,
  };
}

