// @ts-nocheck
'use client';

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Swords, Clock, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
  },
};

export default function Play({ session, ongoingMatches }: { session: unknown; ongoingMatches: number }) {
  const router = useRouter();
  const [matchesCount, setMatchesCount] = useState<number>(ongoingMatches || 0);
  const [stats, setStats] = useState<{ inQueue: number; activePlayers: number }>({ inQueue: 0, activePlayers: 0 });
  const [roomCode, setRoomCode] = useState<string>('');
  const [isCreatingRoom, setIsCreatingRoom] = useState<boolean>(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState<boolean>(false);
  const [joinError, setJoinError] = useState<string>('');
  
  const [activeTab, setActiveTab] = useState("matchmaking");

  // Detect first-time user (no matches played)
  const isFirstTimeUser = (session as { totalMatches?: number })?.totalMatches === 0;

  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
        // Fetch general stats which includes match count and active players
        const res = await fetch(`${base}/global/general-stats`);
        if (res.ok) {
          const data = await res.json();
          if (!mounted) return;
          const inProgressMatches = data.inProgressMatches || 0;
          const activePlayers = data.activePlayers || 0;
          const inQueue = data.inQueue || 0;
          setMatchesCount(inProgressMatches);
          setStats({ inQueue, activePlayers });
        } else {
          // Fallback to queue/size if general-stats fails
          const queueRes = await fetch(`${base}/queue/size`);
          const queueData = queueRes.ok ? await queueRes.json() : { size: 0 };
          if (!mounted) return;
          const inQueue = typeof queueData.size === 'number' ? queueData.size : 0;
          // Use current matchesCount for activePlayers calculation if we can't get updated count
          setStats({ inQueue, activePlayers: (matchesCount || 0) * 2 });
        }
      } catch {
        if (!mounted) return;
        // Fallback calculation
        setStats({ inQueue: 0, activePlayers: (matchesCount || 0) * 2 });
      }
    };
    fetchStats();
    const id = setInterval(fetchStats, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const handleStartQuickMatch = async () => {
    // Check if user already has an active match before queuing
    try {
      const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
      const response = await fetch(`${base}/queue/reservation?userId=${encodeURIComponent(session._id)}`);
      
      if (response.ok) {
        const data = await response.json();
        
        // Check if a reservation was found (returns { found: false } when none exists)
        if (data.found && data.matchId) {
          // Verify the match still exists before redirecting
          const matchCheckResponse = await fetch(`${base}/match/snapshot?matchId=${encodeURIComponent(data.matchId)}`);
          
          if (matchCheckResponse.ok) {
            // Match exists, redirect to it
            console.log('User already has an active match, redirecting to match page');
            router.push("/match");
            return;
          } else {
            // Match doesn't exist, clear stale reservation
            console.log('Match no longer exists, clearing stale reservation');
            await fetch(`${base}/queue/clear`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: session._id })
            });
          }
        }
      }
    } catch (error) {
      // Error checking, proceed to queue
      console.log('Error checking for active match, proceeding to queue');
    }
    
    router.push("/queue");
  };

  const handleCreatePrivateRoom = async () => {
    setIsCreatingRoom(true);
    try {
      // Create the room on the backend first
      const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
      const response = await fetch(`${base}/private/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
          userId: (session as any)?.user?.id || (session as any)?._id,
          username: (session as any)?.user?.username || (session as any)?.username || 'User'
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        router.push(`/queue?private=true&roomCode=${data.roomCode}`);
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create room');
      }
    } catch (error) {
      console.error('Error creating private room:', error);
      alert('Failed to create private room. Please try again.');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleJoinPrivateRoom = async () => {
    if (!roomCode.trim()) {
      setJoinError('Please enter a room code');
      return;
    }
    
    setIsJoiningRoom(true);
    setJoinError(''); // Clear any previous errors
    try {
      // Join the room on the backend first
      const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
      const response = await fetch(`${base}/private/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
          roomCode: roomCode.toUpperCase(),
          userId: (session as any)?.user?.id || (session as any)?._id,
          username: (session as any)?.user?.username || (session as any)?.username || 'User'
        })
      });
      
      if (response.ok) {
        router.push(`/queue?private=true&roomCode=${roomCode.toUpperCase()}`);
      } else {
        const error = await response.json();
        setJoinError(error.error || 'Failed to join room. Please check the room code and try again.');
      }
    } catch (error) {
      console.error('Error joining private room:', error);
      setJoinError('Failed to join private room. Please check the room code and try again.');
    } finally {
      setIsJoiningRoom(false);
    }
  };

  const generateRoomCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  return (
    <div className="h-screen w-full bg-blue-50 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-cyan-400/6 rounded-full filter blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] bg-blue-500/6 rounded-full filter blur-3xl"></div>
      </div>
      
      {/* Main Content Area - Centered Vertically */}
      <div className="absolute inset-0 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-8">
          <motion.div
            className="w-full max-w-5xl mx-auto"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <motion.h1
              className="text-5xl font-bold mb-2 text-black text-center"
              variants={itemVariants}
            >
              Find Your Match
            </motion.h1>
            <motion.p
              className="text-xl text-black/70 text-center mb-10"
              variants={itemVariants}
            >
              {isFirstTimeUser 
                ? "Solve problems head-to-head. Get ranked." 
                : "Fast, fair 1v1 coding battles. Queue in under 2 minutes."}
            </motion.p>

            <Tabs defaultValue="matchmaking" value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-16 mb-8 bg-white/50 p-1.5 rounded-xl border border-blue-200 [&_[data-state=active]]:bg-[#2599D4] [&_[data-state=active]]:text-white">
                <TabsTrigger
                  value="matchmaking"
                  className="rounded-lg h-full text-xl font-medium transition-colors data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black"
                >
                  <Swords className="mr-2.5 h-6 w-6" />
                  Ranked
                </TabsTrigger>
                <TabsTrigger
                  value="private"
                  className="rounded-lg h-full text-xl font-medium transition-colors data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black"
                >
                  <Users className="mr-2.5 h-6 w-6" />
                  Private
                </TabsTrigger>
              </TabsList>

              <TabsContent value="matchmaking" className="space-y-6">
                <motion.div variants={itemVariants}>
                  <Card className="bg-white/90 border-blue-200 shadow-sm hover:shadow-md transition-all duration-300">
                    <CardContent className="p-6">
                      <div className="flex gap-5 items-center mb-5">
                        <div className="h-12 w-12 rounded-2xl bg-[#2599D4]/10 flex items-center justify-center shrink-0">
                          <Zap className="h-6 w-6 text-[#2599D4]" fill="currentColor" />
                        </div>
                        <h3 className="text-2xl font-bold text-black leading-none">Ranked Match</h3>
                      </div>

                      <div className="space-y-3">
                        <Button
                          autoFocus
                          className={`w-full text-white text-lg h-16 font-semibold rounded-2xl transition-all duration-200 shadow-md hover:shadow-lg hover:brightness-110 active:scale-[0.98] transform hover:-translate-y-0.5 ${
                            stats.inQueue > 0 ? 'animate-pulse-subtle' : ''
                          }`}
                          onClick={handleStartQuickMatch}
                          style={{ backgroundColor: '#2599D4' }}
                        >
                          {isFirstTimeUser ? 'Start First Match' : 'Find Opponent'}
                        </Button>
                        
                        <div className="flex items-center justify-center px-1">
                          <p className="text-sm font-medium text-black/50 flex items-center justify-center gap-2">
                            <Clock className="h-4 w-4" />
                            Starts in under 2 minutes
                            {stats.inQueue > 0 && (
                              <AnimatePresence mode="wait">
                                <motion.span
                                  key={stats.inQueue}
                                  initial={{ opacity: 0, x: -5 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: 5 }}
                                  transition={{ duration: 0.2 }}
                                  className="inline-flex items-center"
                                >
                                  <span className="mx-1.5 opacity-50">·</span>
                                  <span className="text-[#2599D4]">{stats.inQueue} in queue now</span>
                                </motion.span>
                              </AnimatePresence>
                            )}
                          </p>
                        </div>

                        {isFirstTimeUser && (
                          <p className="text-xs text-black/40 px-1 text-center">
                            Your first match calibrates your skill rating.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div className="mt-10 mb-8" variants={itemVariants}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 opacity-80 hover:opacity-100 transition-opacity">
                    <motion.div variants={itemVariants}>
                      <Card className="bg-white/60 border-blue-100 shadow-sm">
                        <CardContent className="p-6">
                          <div className="flex justify-between items-center">
                            <Users className="h-6 w-6 text-[#2599D4]/70" />
                            <div className="text-right">
                              <AnimatePresence mode="wait">
                                <motion.div
                                  key={stats.activePlayers}
                                  initial={{ opacity: 0, y: 5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -5 }}
                                  transition={{ duration: 0.2 }}
                                  className="text-3xl font-bold text-black/80"
                                >
                                  {stats.activePlayers}
                                </motion.div>
                              </AnimatePresence>
                              <div className="text-sm font-bold text-black/50 uppercase tracking-wide">
                                Playing Now
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                    <motion.div variants={itemVariants}>
                      <Card className="bg-white/60 border-blue-100 shadow-sm">
                        <CardContent className="p-6">
                            <div className="flex justify-between items-center">
                              <Swords className="h-6 w-6 text-green-600/70" />
                              <div className="text-right">
                                <AnimatePresence mode="wait">
                                  <motion.div
                                    key={matchesCount}
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    transition={{ duration: 0.2 }}
                                    className="text-3xl font-bold text-black/80"
                                  >
                                    {matchesCount}
                                  </motion.div>
                                </AnimatePresence>
                                <div className="text-sm font-bold text-black/50 uppercase tracking-wide">
                                  Live Matches
                                </div>
                              </div>
                            </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                    {!isFirstTimeUser && (
                      <motion.div variants={itemVariants}>
                        <Card className="bg-white/60 border-blue-100 shadow-sm">
                          <CardContent className="p-6">
                            <div className="flex justify-between items-center">
                              <Users className="h-6 w-6 text-yellow-600/70" />
                              <div className="text-right">
                                <div className="text-3xl font-bold text-black/80">
                                  #{(session as { globalRank?: number })?.globalRank ?? 1}
                                </div>
                                <div className="text-sm font-bold text-black/50 uppercase tracking-wide">
                                  Your Rank
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              </TabsContent>

              <TabsContent value="private" className="space-y-6">
                <motion.div variants={itemVariants}>
                  <Card className="bg-white/90 border-blue-200 shadow-sm hover:shadow-md transition-all duration-300">
                    <CardContent className="p-6">
                      <div className="flex gap-5 items-center mb-5">
                        <div className="h-12 w-12 rounded-2xl bg-[#2599D4]/10 flex items-center justify-center shrink-0">
                          <Users className="h-6 w-6 text-[#2599D4]" />
                        </div>
                        <h3 className="text-2xl font-bold text-black leading-none">Private Match</h3>
                      </div>

                      <div className="space-y-5">
                        <div className="space-y-2">
                          <Label
                            htmlFor="room-code"
                            className="text-sm font-bold text-black/50 uppercase tracking-wider"
                          >
                            Room Code
                          </Label>
                          <div className="relative">
                            <Input
                              id="room-code"
                              placeholder="CODE"
                              className="bg-gray-50/50 border-blue-100 text-black placeholder:text-black/30 pl-12 pr-6 h-14 text-2xl tracking-[0.2em] font-mono focus:border-[#2599D4] uppercase transition-all rounded-xl"
                              value={roomCode}
                              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                              maxLength={6}
                            />
                            <Users className="absolute left-4 top-1/2 transform -translate-y-1/2 text-black/30 h-6 w-6" />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Button 
                            className="w-full text-white h-14 text-lg font-semibold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg hover:brightness-110 active:scale-[0.98] transform hover:-translate-y-0.5" 
                            style={{ backgroundColor: '#2599D4' }}
                            onClick={handleJoinPrivateRoom}
                            disabled={isJoiningRoom || !roomCode.trim()}
                          >
                            {isJoiningRoom ? 'Joining...' : 'Join Room'}
                          </Button>
                          
                          {joinError && (
                            <div className="text-center">
                              <p className="text-sm font-medium text-red-500 bg-red-50 py-2 px-3 rounded-lg inline-block">{joinError}</p>
                            </div>
                          )}
                        </div>

                        <div className="relative py-1">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-blue-100"></span>
                          </div>
                          <div className="relative flex justify-center text-xs font-bold uppercase tracking-widest">
                            <span className="bg-white px-4 text-black/30">
                              Or create new
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Button
                            variant="outline"
                            className="w-full border-2 h-12 text-lg font-semibold transition-all duration-200 rounded-xl hover:bg-blue-50 hover:border-[#2599D4] active:scale-[0.98]"
                            style={{ borderColor: '#2599D4', color: '#2599D4' }}
                            onClick={handleCreatePrivateRoom}
                            disabled={isCreatingRoom}
                          >
                            {isCreatingRoom ? 'Creating...' : 'Create Room'}
                          </Button>
                          <p className="text-center text-sm text-black/40">
                            Share the code with your opponent.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
