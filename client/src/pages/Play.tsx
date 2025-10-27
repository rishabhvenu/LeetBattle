'use client';

import React, { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Users, Swords, Clock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

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

export default function Play({ session, ongoingMatches }: { session: any; ongoingMatches: number }) {
  const router = useRouter();
  const [matchesCount, setMatchesCount] = useState<number>(ongoingMatches || 0);
  const [stats, setStats] = useState<{ inQueue: number; activePlayers: number }>({ inQueue: 0, activePlayers: 0 });
  const [roomCode, setRoomCode] = useState<string>('');
  const [isCreatingRoom, setIsCreatingRoom] = useState<boolean>(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState<boolean>(false);
  const [joinError, setJoinError] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
        const res = await fetch(`${base}/queue/size`);
        const data = res.ok ? await res.json() : { size: 0 };
        if (!mounted) return;
        const inQueue = typeof data.size === 'number' ? data.size : 0;
        // Basic estimate: active players ≈ ongoing matches * 2
        setStats({ inQueue, activePlayers: (matchesCount || 0) * 2 });
      } catch {
        if (!mounted) return;
        setStats({ inQueue: 0, activePlayers: (matchesCount || 0) * 2 });
      }
    };
    fetchStats();
    const id = setInterval(fetchStats, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, [matchesCount]);

  const handleStartQuickMatch = async () => {
    // Check if user already has an active match before queuing
    try {
      const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
      const response = await fetch(`${base}/queue/reservation?userId=${encodeURIComponent(session._id)}`);
      
      if (response.ok) {
        const data = await response.json();
        
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
    } catch (error) {
      // No active match or error checking, proceed to queue
      console.log('No active match found, proceeding to queue');
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
          userId: session._id,
          username: session.username || 'User'
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
          userId: session._id,
          username: session.username || 'User'
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
    <div className="flex-1 bg-blue-50 min-h-screen relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-cyan-400/6 rounded-full filter blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] bg-blue-500/6 rounded-full filter blur-3xl"></div>
      </div>
      <ScrollArea className="h-screen w-full relative z-10">
        <motion.div
          className="p-8 max-w-7xl mx-auto"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.h1
            className="text-5xl font-bold mb-2 text-black text-center"
            variants={itemVariants}
          >
            Ready to Code?
          </motion.h1>
          <motion.p
            className="text-xl text-black/70 text-center mb-12"
            variants={itemVariants}
          >
            Choose your battlefield and prove your skills
          </motion.p>

          <Tabs defaultValue="matchmaking" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-14 mb-8 bg-white/50 p-1 rounded-lg border border-blue-200 [&_[data-state=active]]:bg-[#2599D4] [&_[data-state=active]]:text-white">
              <TabsTrigger
                value="matchmaking"
                className="rounded-md h-12 text-lg font-medium transition-colors data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black"
              >
                <Swords className="mr-2 h-5 w-5" />
                Matchmaking
              </TabsTrigger>
              <TabsTrigger
                value="private"
                className="rounded-md h-12 text-lg font-medium transition-colors data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black"
              >
                <Users className="mr-2 h-5 w-5" />
                Private Match
              </TabsTrigger>
            </TabsList>

            <TabsContent value="matchmaking" className="space-y-6">
              <motion.div variants={itemVariants}>
                <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                  <CardHeader>
                    <CardTitle className="text-2xl font-semibold text-black flex items-center">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center mr-3" style={{ backgroundColor: '#2599D4' }}>
                        ⚡
                      </div>
                      Quick Match
                    </CardTitle>
                    <CardDescription className="text-black/70">
                      Jump into a coding battle with a random opponent
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-black/70">
                        <span>Estimated wait time:</span>
                        <span className="flex items-center">
                          <Clock className="mr-1 h-4 w-4 text-green-600" />
                          ~2 minutes
                        </span>
                      </div>
                      <Button
                        className="w-full text-white text-lg py-6 rounded-full transition-colors duration-300"
                        onClick={handleStartQuickMatch}
                        style={{ backgroundColor: '#2599D4' }}
                      >
                        Start Quick Match
                      </Button>
                      <div className="text-center text-sm text-black/70">
                        {stats ? stats.inQueue : 0} players currently in queue
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>

            <TabsContent value="private" className="space-y-6">
              <motion.div variants={itemVariants}>
                <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                  <CardHeader>
                    <CardTitle className="text-2xl font-semibold text-black flex items-center">
                      <Users className="mr-2 h-6 w-6" style={{ color: '#2599D4' }} />
                      Private Match
                    </CardTitle>
                    <CardDescription className="text-black/70">
                      Challenge your friends to a coding duel
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <Label
                          htmlFor="room-code"
                          className="text-sm font-medium text-black"
                        >
                          Room Code
                        </Label>
                        <div className="relative">
                          <Input
                            id="room-code"
                            placeholder="Enter room code"
                            className="bg-white border-blue-200 text-black placeholder:text-black/60 pl-10 pr-4 py-2 focus:border-blue-500 uppercase"
                            value={roomCode}
                            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                            maxLength={6}
                          />
                          <Users className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black/60 h-5 w-5" />
                        </div>
                      </div>
                      <Button 
                        className="w-full text-white py-6 text-lg font-semibold transition-all duration-300 transform hover:scale-105 rounded-full" 
                        style={{ backgroundColor: '#2599D4' }}
                        onClick={handleJoinPrivateRoom}
                        disabled={isJoiningRoom || !roomCode.trim()}
                      >
                        {isJoiningRoom ? 'Joining...' : 'Join Private Room'}
                      </Button>
                      {joinError && (
                        <div className="mt-2 text-center">
                          <p className="text-sm text-red-600">{joinError}</p>
                        </div>
                      )}
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t border-blue-200"></span>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-blue-50 px-2 text-black/60">
                            Or
                          </span>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <Button
                          variant="outline"
                          className="w-full border-2 py-6 text-lg font-semibold transition-all duration-300 rounded-full"
                          style={{ borderColor: '#2599D4', color: '#2599D4' }}
                          onClick={handleCreatePrivateRoom}
                          disabled={isCreatingRoom}
                        >
                          {isCreatingRoom ? 'Creating...' : 'Create New Room'}
                        </Button>
                        <p className="text-center text-sm text-black/70">
                          Create a private room and invite your friends to join
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>
          </Tabs>

          <motion.div className="mt-12 mb-8" variants={itemVariants}>
            <h2 className="text-2xl font-bold mb-6 text-black text-center">
              LeetBattle Stats
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <motion.div variants={itemVariants}>
                <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-center">
                      <Users className="h-8 w-8" style={{ color: '#2599D4' }} />
                      <div className="text-right">
                        <div className="text-3xl font-bold text-black">
                          {stats ? stats.activePlayers : 0}
                        </div>
                        <div className="text-sm text-black/70">
                          Active Players
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div variants={itemVariants}>
                <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                  <CardContent className="p-6">
                      <div className="flex justify-between items-center">
                        <Swords className="h-8 w-8 text-green-600" />
                        <div className="text-right">
                          <div className="text-3xl font-bold text-black">
                            {matchesCount}
                          </div>
                          <div className="text-sm text-black/70">
                            Ongoing Matches
                          </div>
                        </div>
                      </div>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div variants={itemVariants}>
                <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-center">
                      <Users className="h-8 w-8 text-yellow-600" />
                      <div className="text-right">
                        <div className="text-3xl font-bold text-black">
                          #{session.globalRank}
                        </div>
                        <div className="text-sm text-black/70">
                          Your Global Rank
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      </ScrollArea>
    </div>
  );
}
