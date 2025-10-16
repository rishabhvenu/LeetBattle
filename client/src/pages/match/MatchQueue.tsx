"use client";
import React, { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, X, Zap, Clock, Copy, Check } from "lucide-react";
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from "framer-motion";
import { Client, Room } from 'colyseus.js';

interface MatchQueueProps { userId: string; rating: number; }

interface PlayerInfo {
  userId: string;
  username: string;
}

interface PrivateRoomData {
  roomCode: string;
  players: PlayerInfo[];
  isCreator: boolean;
}

const MatchQueue: React.FC<MatchQueueProps> = ({ userId, rating }) => {
  const searchParams = useSearchParams();
  const isPrivate = searchParams?.get('private') === 'true';
  const roomCodeParam = searchParams?.get('roomCode');
  
  const [queueStatus, setQueueStatus] = useState<
    "waiting" | "matched" | "error" | "cancelled"
  >("waiting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queueStats, setQueueStats] = useState({ playersInQueue: 0, ongoingMatches: 0, averageWaitTime: 0 });
  const [privateRoomData, setPrivateRoomData] = useState<PrivateRoomData | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const router = useRouter();
  const roomRef = useRef<Room | null>(null);
  const shouldCancelRef = useRef(true);

  useEffect(() => {
    let isMounted = true;

    if (isPrivate && roomCodeParam) {
      // Private room logic - simple Redis-based approach
      const joinPrivateRoom = async () => {
        try {
          const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
          
          // Join the private room
          const response = await fetch(`${base}/private/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              roomCode: roomCodeParam, 
              userId, 
              username: userId // You might want to get actual username from session
            })
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to join room');
          }
          
          const roomData = await response.json();
          if (!isMounted) return;
          
          setPrivateRoomData(roomData);
          setIsCreator(roomData.isCreator);
          
          // Start polling for updates
          pollPrivateRoom();
          
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to join room';
          console.error('Failed to join private room:', error);
          toast.error('Failed to join room: ' + message);
          setQueueStatus("error");
          setErrorMessage(message);
        }
      };

      const pollPrivateRoom = async () => {
        try {
          const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
          const response = await fetch(`${base}/private/room?roomCode=${roomCodeParam}`);
          
          if (response.ok) {
            const data = await response.json();
            if (!isMounted) return;
            
            setPrivateRoomData(data);
            
            // If we have 2 players, auto-start the match
            if (data.players && data.players.length === 2) {
              shouldCancelRef.current = false;
              toast.success('Match starting!');
              router.push('/match');
              return;
            }
          } else {
            // Room not found or error
            toast.error('Private room not found or expired');
            setQueueStatus('error');
            return;
          }
        } catch (error) {
          console.error('Error polling private room:', error);
        }
      };

      // Initial join
      joinPrivateRoom();
      
      // Poll every 2 seconds for updates
      const pollInterval = setInterval(() => {
        if (isMounted && shouldCancelRef.current) {
          pollPrivateRoom();
        }
      }, 2000);
      
      return () => {
        isMounted = false;
        clearInterval(pollInterval);
      };
    } else {
      // Public queue logic (existing)
      const joinQueue = async () => {
        try {
          console.log('Connecting to queue room...', userId, rating);
          
          const client = new Client(process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!);
          const room = await client.joinOrCreate('queue', { userId, rating });
          roomRef.current = room;
          
          console.log('Joined queue room:', room.id);
          
          room.onMessage('match_found', (data) => {
            console.log('Match found!', data);
            setQueueStatus('matched');
            shouldCancelRef.current = false;
            try { room.leave(); } catch {}
            router.push('/match');
          });
          
          room.onMessage('already_in_match', (data) => {
            console.log('Already in active match:', data);
            shouldCancelRef.current = false;
            toast.info('Redirecting to your active match...');
            try { room.leave(); } catch {}
            router.push('/match');
          });
          
          room.onError((code, message) => {
            console.error('Queue room error:', code, message);
            toast.error('Queue error: ' + message);
            setQueueStatus('error');
          });
          
          room.onLeave((code) => {
            console.log('Left queue room:', code);
            if (shouldCancelRef.current && isMounted) {
              setQueueStatus('cancelled');
            }
          });
          
        } catch (error) {
          console.error('Failed to join queue:', error);
          toast.error('Failed to join queue.');
          setQueueStatus("error");
        }
      };

      const checkForMatch = async () => {
        try {
          const response = await fetch(
            `${process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL}/queue/reservation?userId=${userId}`
          );
          
          if (response.ok) {
            console.log('Match reservation found! Redirecting...');
            setQueueStatus('matched');
            shouldCancelRef.current = false;
            if (roomRef.current) {
              try { roomRef.current.leave(); } catch {}
            }
            router.push('/match');
          }
        } catch {
          // No reservation yet
        }
      };

      const fetchQueueStats = async () => {
        setQueueStats({
          playersInQueue: Math.floor(Math.random() * 100) + 50,
          ongoingMatches: Math.floor(Math.random() * 50) + 20,
          averageWaitTime: Math.floor(Math.random() * 30) + 15,
        });
      };

      joinQueue();
      fetchQueueStats();

      const statsInterval = setInterval(fetchQueueStats, 5000);
      const matchCheckInterval = setInterval(checkForMatch, 1000);

      return () => {
        isMounted = false;
        clearInterval(statsInterval);
        clearInterval(matchCheckInterval);
        if (roomRef.current && shouldCancelRef.current) {
          try {
            roomRef.current.leave();
          } catch {}
        }
      };
    }
  }, [userId, rating, router, isPrivate, roomCodeParam]);

  const handleCancelQueue = async () => {
    try {
      shouldCancelRef.current = false;
      setQueueStatus("cancelled");
      
      if (isPrivate && roomCodeParam) {
        // Leave private room
        const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
        await fetch(`${base}/private/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        });
      } else {
        // Leave queue room
        if (roomRef.current) {
          await roomRef.current.leave();
        }
      }
      
      router.push("/play");
    } catch (error) {
      console.error("Error cancelling queue:", error);
      setQueueStatus("error");
      setErrorMessage("Failed to cancel queue. Please try again.");
    }
  };

  const copyRoomCode = () => {
    if (roomCodeParam) {
      navigator.clipboard.writeText(roomCodeParam);
      setCopiedCode(true);
      toast.success('Room code copied to clipboard!');
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.5,
        staggerChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
      },
    },
  };

  return (
    <div className="min-h-screen bg-blue-50 p-4 sm:p-8 relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 overflow-hidden opacity-10">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-cyan-400 rounded-full filter blur-3xl"></div>
      </div>

      <motion.div
        className="relative z-10 max-w-5xl mx-auto flex items-center justify-center min-h-screen"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="w-full space-y-8">
          {!isPrivate && (
            <motion.div variants={itemVariants}>
              <Card className="bg-white/90 border-blue-200 shadow-xl">
                <CardHeader>
                  <CardTitle className="text-2xl font-bold text-center text-black">
                    Queue Statistics
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <Users className="h-8 w-8 mx-auto mb-2" style={{ color: '#2599D4' }} />
                    <p className="text-2xl font-bold text-black">
                      {queueStats.playersInQueue}
                    </p>
                    <p className="text-sm text-black/70">Players in Queue</p>
                  </div>
                  <div className="text-center">
                    <Zap className="h-8 w-8 mx-auto mb-2 text-yellow-600" />
                    <p className="text-2xl font-bold text-black">
                      {queueStats.ongoingMatches}
                    </p>
                    <p className="text-sm text-black/70">Ongoing Matches</p>
                  </div>
                  <div className="text-center">
                    <Clock className="h-8 w-8 mx-auto mb-2 text-green-600" />
                    <p className="text-2xl font-bold text-black">
                      {queueStats.averageWaitTime}s
                    </p>
                    <p className="text-sm text-black/70">Avg. Wait Time</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={queueStatus}
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
            >
              <Card className="bg-white/90 border-blue-200 shadow-xl overflow-hidden">
                <CardHeader className="bg-white/50">
                  <CardTitle className="text-2xl font-bold text-center text-black">
                    {isPrivate ? "Private Room" : "Finding Match"}
                    {queueStatus === "matched" && " - Match Found!"}
                    {queueStatus === "error" && " - Error"}
                    {queueStatus === "cancelled" && " - Cancelled"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8">
                  <motion.div variants={itemVariants}>
                    {queueStatus === "waiting" && (
                      <>
                        {isPrivate && privateRoomData ? (
                          <div className="space-y-6">
                            {/* Room Code Display */}
                            <div className="bg-blue-50 rounded-lg p-6 border-2 border-blue-200">
                              <p className="text-sm text-black/70 mb-2 text-center">Room Code</p>
                              <div className="flex items-center justify-center gap-3">
                                <p className="text-4xl font-bold text-black tracking-wider">
                                  {roomCodeParam}
                                </p>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={copyRoomCode}
                                  className="ml-2"
                                >
                                  {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </Button>
                              </div>
                              <p className="text-xs text-black/60 mt-2 text-center">
                                Share this code with your friend to join
                              </p>
                            </div>

                            {/* Players List */}
                            <div>
                              <p className="text-lg font-semibold text-black mb-3">Players ({privateRoomData.players?.length || 0}/2)</p>
                              <div className="space-y-2">
                                {privateRoomData.players?.map((player: PlayerInfo, idx: number) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between bg-white rounded-lg p-3 border border-blue-200"
                                  >
                                    <div className="flex items-center gap-2">
                                      <Users className="h-5 w-5 text-blue-500" />
                                      <span className="font-medium text-black">{player.username}</span>
                                      {player.userId === userId && (
                                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">You</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Leave Button */}
                            <div className="flex justify-center">
                              <Button
                                variant="outline"
                                className="px-6 py-3 text-black font-semibold rounded-full border-2 border-red-500 text-red-500"
                                onClick={handleCancelQueue}
                              >
                                <X className="mr-2 h-5 w-5" />
                                Leave Room
                              </Button>
                            </div>

                            <p className="text-center text-black/60">
                              Waiting for another player to join...
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="flex justify-center mb-6">
                              <div className="relative">
                                <Loader2 className="h-20 w-20 animate-spin text-blue-500" />
                                <Users className="h-10 w-10 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-slate-200" />
                              </div>
                            </div>
                            <p className="text-center mb-6 text-xl text-black/70">
                              {isPrivate ? 'Setting up private room...' : 'Searching for an opponent...'}
                            </p>
                            <div className="flex justify-center">
                              <Button
                                className="px-6 py-3 text-white font-semibold rounded-full transition-colors duration-300 flex items-center text-lg"
                                onClick={handleCancelQueue}
                                style={{ backgroundColor: '#dc2626' }}
                              >
                                <X className="mr-2 h-5 w-5" />
                                Cancel
                              </Button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                    {queueStatus === "error" && (
                      <>
                        <p className="text-center mb-6 text-xl text-red-600">
                          {errorMessage || 'An error occurred'}
                        </p>
                        <div className="flex justify-center">
                          <Button
                            className="px-6 py-3 text-white font-semibold rounded-full transition-colors duration-300 text-lg"
                            onClick={() => router.push("/play")}
                            style={{ backgroundColor: '#2599D4' }}
                          >
                            Back to Play
                          </Button>
                        </div>
                      </>
                    )}
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default MatchQueue;