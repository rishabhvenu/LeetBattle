"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, X, Zap, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueueWebSocket } from '@/lib/hooks/useQueueWebSocket';

interface GuestQueueProps {
  isAlreadyPlayed: boolean;
}

const GuestQueue: React.FC<GuestQueueProps> = ({ isAlreadyPlayed }) => {
  const [queueStats, setQueueStats] = useState({ playersInQueue: 0, ongoingMatches: 0, averageWaitTime: 0 });
  const [guestId, setGuestId] = useState<string | null>(null);
  const router = useRouter();

  // Use shared hook for queue WebSocket logic
  const {
    queueStatus,
    setQueueStatus,
    errorMessage,
    setErrorMessage,
    shouldCancelRef,
    leaveQueue,
  } = useQueueWebSocket({
    userId: guestId || '',
    rating: 1200,
    isGuest: true,
    enabled: !isAlreadyPlayed && !!guestId,
  });

  // Initialize guest ID
  useEffect(() => {
    if (isAlreadyPlayed) {
      setQueueStatus("cancelled");
      return;
    }

    // Helper to get cookie value
    const getCookie = (name: string): string | null => {
      if (typeof document === 'undefined') return null;
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) {
        return parts.pop()?.split(';').shift() || null;
      }
      return null;
    };

    // Initialize guest ID (get existing or create new)
    let existingGuestId = getCookie('codeclashers.guest.sid');
    
    if (!existingGuestId) {
      // Generate new guest ID on client
      existingGuestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      // Set cookie with 7-day expiry
      document.cookie = `codeclashers.guest.sid=${existingGuestId}; path=/; max-age=${7 * 24 * 60 * 60}; samesite=lax`;
    }
    
    setGuestId(existingGuestId);
  }, [isAlreadyPlayed, setQueueStatus]);

  // Fetch queue stats
  useEffect(() => {
    if (isAlreadyPlayed) return;

    const fetchQueueStats = async () => {
      try {
        const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
        const [queueRes, statsRes] = await Promise.all([
          fetch(`${base}/queue/size`),
          fetch(`${base}/global/general-stats`)
        ]);

        const queueData = queueRes.ok ? await queueRes.json() : { size: 0 };
        const statsData = statsRes.ok ? await statsRes.json() : { inProgressMatches: 0 };

        setQueueStats({
          playersInQueue: typeof queueData.size === 'number' ? queueData.size : 0,
          ongoingMatches: typeof statsData.inProgressMatches === 'number' ? statsData.inProgressMatches : 0,
          averageWaitTime: 10,
        });
      } catch {
        setQueueStats({ playersInQueue: 0, ongoingMatches: 0, averageWaitTime: 10 });
      }
    };

    fetchQueueStats();
    const statsInterval = setInterval(fetchQueueStats, 5000);

    return () => {
      clearInterval(statsInterval);
    };
  }, [isAlreadyPlayed]);


  const handleCancelQueue = async () => {
    try {
      setQueueStatus("cancelled");
      shouldCancelRef.current = true;
      // Clear guest match bootstrap cookie so we don't keep stale data
      if (typeof document !== 'undefined') {
        document.cookie = 'codeclashers.guest.match=; path=/; max-age=0; samesite=lax';
      }
      // Leave queue room using hook
      await leaveQueue();
      router.push("/landing");
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

  if (isAlreadyPlayed) {
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
          <Card className="bg-white/90 border-blue-200 shadow-xl">
            <CardHeader>
              <CardTitle className="text-2xl font-bold text-center text-black">
                You&apos;ve Already Played!
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 text-center">
              <div className="mb-6">
                <p className="text-lg text-black/70 mb-4">
                  You&apos;ve already completed your guest match. To play more matches and save your progress, please create an account.
                </p>
                <div className="flex justify-center gap-4">
                  <Button
                    className="px-6 py-3 text-white font-semibold rounded-full transition-colors duration-300"
                    style={{ backgroundColor: '#2599D4' }}
                    onClick={() => router.push('/register')}
                  >
                    Sign Up Now
                  </Button>
                  <Button
                    variant="outline"
                    className="px-6 py-3 text-black font-semibold rounded-full border-2 border-gray-300"
                    onClick={() => router.push('/landing')}
                  >
                    Back to Home
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

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
          <AnimatePresence mode="wait">
            <motion.div
              key={queueStatus}
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
            >
              <Card className="bg-white/90 border-blue-200 shadow-xl overflow-hidden">
                <CardHeader className={`${queueStatus !== "waiting" ? 'bg-white/50' : 'hidden'}`}>
                  {queueStatus !== "waiting" && (
                    <CardTitle className="text-2xl font-bold text-center text-black">
                      {queueStatus === "matched" && "Match Found!"}
                      {queueStatus === "error" && "Error"}
                      {queueStatus === "cancelled" && "Cancelled"}
                    </CardTitle>
                  )}
                </CardHeader>
                <CardContent className="p-8">
                  <motion.div variants={itemVariants}>
                    {queueStatus === "waiting" && (
                      <div className="flex flex-col items-center justify-center py-4">
                        {/* Spinner with pulsing effect */}
                        <div className="relative mb-8 mt-2">
                          <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse"></div>
                          <Loader2 className="h-20 w-20 animate-spin text-blue-500 relative z-10" />
                        </div>

                        {/* Status Text */}
                        <h3 className="text-xl font-medium text-black mb-2 animate-pulse">
                          Searching for an opponent...
                        </h3>
                        <p className="text-black/50 text-sm mb-8 font-medium">
                          Usually starts in under 1 minute
                        </p>

                        {/* Inline Stats */}
                        <div className="flex flex-wrap justify-center items-center gap-4 sm:gap-6 text-sm text-black/60 bg-blue-50/80 px-6 py-3 rounded-full border border-blue-100 mb-8 backdrop-blur-sm">
                          <div className="flex items-center gap-2" title="Players currently queuing">
                            <Users className="h-4 w-4 text-blue-500" />
                            <span className="font-medium">
                              {queueStats.playersInQueue > 0 
                                ? `${queueStats.playersInQueue} in queue` 
                                : "Queue is active"}
                            </span>
                          </div>
                          <div className="hidden sm:block w-px h-4 bg-blue-200"></div>
                          <div className="flex items-center gap-2" title="Matches currently being played">
                            <Zap className="h-4 w-4 text-yellow-500" />
                            <span className="font-medium">{queueStats.ongoingMatches} active matches</span>
                          </div>
                        </div>

                        {/* Cancel Button */}
                        <Button
                          className="px-8 py-2 text-white font-medium rounded-full transition-all duration-300 flex items-center shadow-none hover:shadow-sm hover:bg-red-600 active:scale-95"
                          onClick={handleCancelQueue}
                          style={{ backgroundColor: '#dc2626' }}
                        >
                          <X className="mr-2 h-4 w-4" />
                          Cancel Search
                        </Button>
                      </div>
                    )}
                    {queueStatus === "matched" && (
                      <div className="flex flex-col items-center justify-center py-8">
                        <div className="relative mb-6">
                          <div className="absolute inset-0 bg-green-500/20 rounded-full blur-xl animate-pulse"></div>
                          <Check className="h-20 w-20 text-green-500 relative z-10" />
                        </div>
                        <h3 className="text-2xl font-bold text-black mb-2 animate-bounce">
                          Opponent Found!
                        </h3>
                        <p className="text-black/60 text-lg">
                          Starting match...
                        </p>
                      </div>
                    )}
                    {queueStatus === "error" && (
                      <>
                        <p className="text-center mb-6 text-xl text-red-600">
                          {errorMessage || 'An error occurred'}
                        </p>
                        <div className="flex justify-center">
                          <Button
                            className="px-6 py-3 text-white font-semibold rounded-full transition-colors duration-300 text-lg"
                            onClick={() => router.push("/landing")}
                            style={{ backgroundColor: '#2599D4' }}
                          >
                            Back to Home
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

export default GuestQueue;
