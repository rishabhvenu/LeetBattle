"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, X, Zap, Clock } from "lucide-react";
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
                    Finding Match
                    {queueStatus === "matched" && " - Match Found!"}
                    {queueStatus === "error" && " - Error"}
                    {queueStatus === "cancelled" && " - Cancelled"}
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
                    {queueStatus === "error" && (
                      <>
                        <div className="text-center mb-6">
                          <p className="text-xl text-red-600 mb-2">
                            {errorMessage || 'An error occurred'}
                          </p>
                          <p className="text-sm text-gray-600">
                            The backend server might not be running. Please try again or contact support.
                          </p>
                        </div>
                        <div className="flex justify-center gap-4">
                          <Button
                            className="px-6 py-3 text-white font-semibold rounded-full transition-colors duration-300 text-lg"
                            onClick={() => {
                              setQueueStatus("waiting");
                              setErrorMessage(null);
                            }}
                            style={{ backgroundColor: '#10b981' }}
                          >
                            Try Again
                          </Button>
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
