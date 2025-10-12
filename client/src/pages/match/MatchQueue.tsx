"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, X, Zap, Clock } from "lucide-react";
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from "framer-motion";
import { Client, Room } from 'colyseus.js';

interface MatchQueueProps { userId: string; rating: number; }

const MatchQueue: React.FC<MatchQueueProps> = ({ userId, rating }) => {
  const [queueStatus, setQueueStatus] = useState<
    "waiting" | "matched" | "error" | "cancelled"
  >("waiting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queueStats, setQueueStats] = useState({ playersInQueue: 0, ongoingMatches: 0, averageWaitTime: 0 });
  const router = useRouter();
  const queueRoomRef = useRef<Room | null>(null);
  const shouldCancelRef = useRef(true);

  const handleMatchFound = useCallback(() => { 
    setQueueStatus('matched'); 
    shouldCancelRef.current = false; 
    router.push('/match'); 
  }, [router]);

  useEffect(() => {
    let isMounted = true;

    const joinQueue = async () => {
      try {
        console.log('Connecting to queue room...', userId, rating);
        
        // Connect to Colyseus QueueRoom (joinOrCreate ensures room exists)
        const client = new Client(process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!);
        const room = await client.joinOrCreate('queue', { userId, rating });
        queueRoomRef.current = room;
        
        console.log('Joined queue room:', room.id);
        
        // Listen for match found
        room.onMessage('match_found', (data) => {
          console.log('Match found!', data);
          setQueueStatus('matched');
          shouldCancelRef.current = false;
          
          // Leave queue room
          try { room.leave(); } catch {}
          
          router.push('/match');
        });
        
        // Listen for already in match
        room.onMessage('already_in_match', (data) => {
          console.log('Already in active match:', data);
          shouldCancelRef.current = false;
          toast.info('Redirecting to your active match...');
          
          // Leave queue room
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

    const fetchQueueStats = async () => {
      // Mock stats for now
      setQueueStats({
        playersInQueue: Math.floor(Math.random() * 100) + 50,
        ongoingMatches: Math.floor(Math.random() * 50) + 20,
        averageWaitTime: Math.floor(Math.random() * 30) + 15,
      });
    };

    joinQueue();
    fetchQueueStats();

    const statsInterval = setInterval(fetchQueueStats, 5000);

    return () => {
      isMounted = false;
      clearInterval(statsInterval);
      
      // Leave queue room on unmount if still waiting
      if (queueRoomRef.current && shouldCancelRef.current) {
        try {
          queueRoomRef.current.leave();
        } catch {}
      }
    };
  }, [userId, rating, router]);

  const handleCancelQueue = async () => {
    try {
      shouldCancelRef.current = false;
      setQueueStatus("cancelled");
      
      // Leave queue room
      if (queueRoomRef.current) {
        await queueRoomRef.current.leave();
      }
      
      router.push("/play");
    } catch (error) {
      console.error("Error cancelling queue:", error);
      setQueueStatus("error");
      setErrorMessage("Failed to cancel queue. Please try again.");
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.5,
        ease: "easeOut",
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
                      {queueStatus === "waiting" && "Finding Match"}
                      {queueStatus === "matched" && "Match Found!"}
                      {queueStatus === "error" && "Error"}
                      {queueStatus === "cancelled" && "Queue Cancelled"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-8">
                    <motion.div variants={itemVariants}>
                      {queueStatus === "waiting" && (
                        <>
                          <div className="flex justify-center mb-6">
                            <div className="relative">
                              <Loader2 className="h-20 w-20 animate-spin text-blue-500" />
                              <Users className="h-10 w-10 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-slate-200" />
                            </div>
                          </div>
                          <p className="text-center mb-6 text-xl text-black/70">
                            Searching for an opponent...
                          </p>
                          <div className="flex justify-center">
                            <Button
                              className="px-6 py-3 text-black font-semibold rounded-full transition-colors duration-300 flex items-center text-lg"
                              onClick={handleCancelQueue}
                              style={{ backgroundColor: '#dc2626' }}
                            >
                              <X className="mr-2 h-5 w-5" />
                              Cancel Queue
                            </Button>
                          </div>
                        </>
                      )}
                      {queueStatus === "error" && (
                        <>
                          <p className="text-center mb-6 text-xl text-red-600">
                            {errorMessage}
                          </p>
                          <div className="flex justify-center">
                            <Button
                              className="px-6 py-3 text-black font-semibold rounded-full transition-colors duration-300 text-lg"
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
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
};

export default MatchQueue;
