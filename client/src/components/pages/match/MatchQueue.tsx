"use client";
import React, { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, X, Zap, Clock, Copy, Check, Search, Play } from "lucide-react";
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from "framer-motion";
import { Client, Room } from 'colyseus.js';
import { useQueueWebSocket } from '@/lib/hooks/useQueueWebSocket';

interface MatchQueueProps { userId: string; username: string; rating: number; }

interface PlayerInfo {
  userId: string;
  username: string;
}

interface PrivateRoomData {
  roomCode: string;
  players: PlayerInfo[];
  isCreator: boolean;
  selectedProblemId?: string;
}

interface Problem {
  _id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topics: string[];
}

const MatchQueue: React.FC<MatchQueueProps> = ({ userId, username, rating }) => {
  const searchParams = useSearchParams();
  const isPrivate = searchParams?.get('private') === 'true';
  const roomCodeParam = searchParams?.get('roomCode');
  
  const [queueStats, setQueueStats] = useState({ playersInQueue: 0, ongoingMatches: 0, averageWaitTime: 0 });
  const [privateRoomData, setPrivateRoomData] = useState<PrivateRoomData | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [availableProblems, setAvailableProblems] = useState<Problem[]>([]);
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isStartingMatch, setIsStartingMatch] = useState(false);
  const router = useRouter();
  const roomRef = useRef<Room | null>(null);
  const statePollActiveRef = useRef(false);
  const isCreatorLockedRef = useRef(false);
  const joinPromiseRef = useRef<Promise<unknown> | null>(null); // Guard against duplicate joins
  // Track initial mount/unmount in React 18 StrictMode so we don't tear down the real
  // websocket connection on the first (test) unmount.
  const hasInitializedRef = useState(false)[0];
  const firstUnmountSkippedRef = useRef(false);

  // Use shared hook for public queue WebSocket logic
  const {
    queueStatus,
    setQueueStatus,
    errorMessage,
    setErrorMessage,
    shouldCancelRef,
    leaveQueue,
  } = useQueueWebSocket({
    userId,
    rating,
    isGuest: false,
    enabled: !isPrivate, // Only enable for public queue
  });

  useEffect(() => {
    let isMounted = true;
    let initialized = hasInitializedRef as boolean;

    if (isPrivate && roomCodeParam) {
      // Guard: Prevent duplicate joins from React Strict Mode
      if (roomRef.current) {
        console.log('Private room already connected, using existing connection');
        return;
      }
      
      // FIXED PRIVATE ROOM LOGIC - HTTP-first, WS for updates
      const joinPrivateRoom = async () => {
        try {
          console.log('Starting private room join process...');
          const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
          
          // First, get room info from HTTP endpoint
          console.log(`Fetching room info for code: ${roomCodeParam}`);
          const response = await fetch(`${base}/private/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              roomCode: roomCodeParam, 
              userId, 
              username: username
            })
          });
          
          if (!response.ok) {
            const error = await response.json();
            console.error('HTTP join request failed:', error);
            throw new Error(error.error || 'Failed to join room');
          }
          
          const roomInfo = await response.json();
          console.log('Received room info:', roomInfo);
          if (!isMounted) return;
          
          if (!roomInfo.roomId) {
            throw new Error('Room ID not found in response');
          }
          
          // Immediately honor isCreator/role from HTTP response and lock it
          const initialIsCreator = roomInfo?.isCreator === true || roomInfo?.role === 'creator';
          setIsCreator(initialIsCreator);
          isCreatorLockedRef.current = true;

          // Immediately reflect joined state in UI using HTTP state/blob response
          try {
            const stateRes = await fetch(`${base}/private/state?roomCode=${encodeURIComponent(roomCodeParam)}`);
            if (stateRes.ok) {
              const state = await stateRes.json();
              if (!isMounted) return;
              setPrivateRoomData({
                roomCode: state.roomCode,
                players: state.players || [{ userId, username }],
                isCreator: initialIsCreator
              });
              // isCreator already set and locked from HTTP join
            } else {
              setPrivateRoomData({ roomCode: roomCodeParam, players: [{ userId, username }], isCreator: !!roomInfo.isCreator });
              // isCreator already set and locked from HTTP join
            }
          } catch {
            setPrivateRoomData({ roomCode: roomCodeParam, players: [{ userId, username }], isCreator: !!roomInfo.isCreator });
            // isCreator already set and locked from HTTP join
          }
          // Prevent auto-leave on dev HMR while connecting
          shouldCancelRef.current = false;
          
          // Fetch initial state via HTTP so UI doesn't depend on WS
          try {
            const stateRes = await fetch(`${base}/private/state?roomCode=${encodeURIComponent(roomCodeParam)}`);
            if (stateRes.ok) {
              const state = await stateRes.json();
              if (state?.players) {
                setPrivateRoomData({
                  roomCode: roomCodeParam,
                  players: state.players,
                  isCreator: state.creatorId === userId
                });
                setIsCreator(state.creatorId === userId);
              }
            }
          } catch {}
          
          // Poll HTTP state every 2s as a fallback to ensure UI updates even if WS is slow
          statePollActiveRef.current = true;
          const poll = async () => {
            try {
              const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
              const res = await fetch(`${base}/private/state?roomCode=${encodeURIComponent(roomCodeParam)}`);
              if (res.ok) {
                const data = await res.json();
                if (!isMounted) return;
                if (data?.players) {
                  setPrivateRoomData({
                    roomCode: roomCodeParam,
                    players: data.players,
                    isCreator: isCreatorLockedRef.current ? isCreator : (data.creatorId === userId)
                  });
                  if (!isCreatorLockedRef.current) setIsCreator(data.creatorId === userId);
                }
              }
            } catch {}
            if (isMounted && statePollActiveRef.current) {
              setTimeout(poll, 2000);
            }
          };
          poll();

          // Now connect to the WebSocket room with retry logic and timeout
          const client = new Client(process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!);
          
          // Create a timeout promise that will reject if connection takes too long
          const connectionTimeoutMs = 10000; // 10 seconds total timeout
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error('Connection timeout: Room setup took too long. Please try again.'));
            }, connectionTimeoutMs);
          });

          // Retry logic with exponential backoff for "locked" errors
          let room: Room | null = null;
          let lastError: Error | null = null;
          const maxRetries = 4;
          const delays = [500, 1000, 2000, 3000]; // Exponential backoff in ms
          
          // Race the join attempt against the timeout
          const joinAttempt = async (attempt: number): Promise<Room> => {
            console.log(`Join attempt ${attempt + 1}/${maxRetries + 1}...`);
            try {
              const joinPromise = client.joinById(roomInfo.roomId, { 
                roomCode: roomCodeParam, 
                userId, 
                username 
              });
              return await Promise.race([joinPromise, timeoutPromise]);
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              const errorMessage = err.message.toLowerCase();
              console.log(`Join attempt ${attempt + 1} failed:`, errorMessage);
              
              // Retry on "locked" errors or other room-related timing errors
              const isRetryableError = errorMessage.includes('locked') || 
                                      errorMessage.includes('room') ||
                                      (errorMessage.includes('not found') && attempt < maxRetries);
              
              if (isRetryableError && attempt < maxRetries) {
                console.log(`Retrying in ${delays[attempt]}ms...`);
                await new Promise(resolve => setTimeout(resolve, delays[attempt]));
                return joinAttempt(attempt + 1);
              } else {
                throw err;
              }
            }
          };
          
          try {
            room = await Promise.race([
              joinAttempt(0),
              timeoutPromise
            ]);
            console.log('Successfully connected to room:', room.id);
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.error('Failed to join room after all attempts:', lastError);
            throw lastError;
          }

          if (!room) {
            throw lastError || new Error('Failed to join room after retries');
          }
          
          roomRef.current = room;
          setIsCreator(roomInfo.isCreator);
          shouldCancelRef.current = false; // Don't auto-leave when component unmounts

          // Immediately reflect joined state in UI to avoid "Setting up" hang
          setPrivateRoomData({
            roomCode: roomCodeParam,
            players: [{ userId, username }],
            isCreator: roomInfo.isCreator
          });
          
          // Listen for unified room info updates
          room.onMessage('room_info', (data) => {
            if (!isMounted) return;
            setPrivateRoomData({ roomCode: data.roomCode, players: data.players || [], isCreator: data.creatorId === userId });
            if (!isCreatorLockedRef.current) setIsCreator(data.creatorId === userId);
          });
          
          // Listen for problem selection
          room.onMessage('problem_selected', (data) => {
            if (!isMounted) return;
            
            const problem = availableProblems.find(p => p._id === data.problemId);
            if (problem) {
              setSelectedProblem(problem);
              toast.success(`Problem selected: ${problem.title}`);
            }
          });
          
          // Listen for match start
          room.onMessage('match_started', (data) => {
            if (!isMounted) return;
            
            console.log('Match started:', data);
            shouldCancelRef.current = false;
            toast.success('Match starting!');
            router.push('/match');
          });
          
          room.onMessage('error', (data) => {
            if (!isMounted) return;
            
            toast.error(data.message);
          });
          
          console.log('Successfully connected to private room via WebSocket');
          
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to join room';
          console.error('Failed to join private room:', error);
          toast.error('Failed to join room: ' + message);
          setQueueStatus("error");
          setErrorMessage(message);
        } finally {
          joinPromiseRef.current = null; // Clear the promise ref
        }
      };

      // Initial join - guard against React StrictMode double invocation by only joining once
      if (!initialized) {
        initialized = true;
        joinPromiseRef.current = joinPrivateRoom()
          .catch(() => {})
          .finally(() => {
            joinPromiseRef.current = null;
          });
      }
      
          return () => {
        isMounted = false;
        statePollActiveRef.current = false;
        if (roomRef.current && shouldCancelRef.current) {
          if (firstUnmountSkippedRef.current) {
            console.log('Leaving private room due to actual component unmount');
            roomRef.current.leave();
          } else {
            console.log('Skipping private room leave on initial StrictMode unmount');
            firstUnmountSkippedRef.current = true;
          }
        }
      };
    } else {
      // Public queue - stats fetching only (WebSocket handled by hook)
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
        isMounted = false;
        clearInterval(statsInterval);
      };
    }
  }, [userId, username, rating, router, isPrivate, roomCodeParam, availableProblems, hasInitializedRef, isCreator, setErrorMessage, setQueueStatus, shouldCancelRef]);

  // Handle page unload/close/navigation - ensure cleanup happens
  useEffect(() => {
    const handleBeforeUnload = () => {
      // For private rooms
      if (roomRef.current && shouldCancelRef.current && isPrivate) {
        try {
          roomRef.current.leave();
          console.log('Left private room on page unload');
        } catch {
          // Ignore errors on leave
        }
      }
      
      // For private rooms, also try to leave via HTTP endpoint
      if (isPrivate && roomCodeParam && shouldCancelRef.current) {
        try {
          const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
          // Use sendBeacon for reliable delivery during page unload
          if (navigator.sendBeacon) {
            const data = JSON.stringify({ userId });
            navigator.sendBeacon(`${base}/private/leave`, data);
            console.log('Sent private room leave via sendBeacon');
          }
        } catch {
          // Ignore errors on leave
        }
      }
      
      roomRef.current = null;
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
      
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, [isPrivate, roomCodeParam, userId, shouldCancelRef]);

  // Fetch available problems when component mounts
  useEffect(() => {
    const fetchProblems = async () => {
      try {
        const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
        const response = await fetch(`${base}/problems/list`);
        
        if (response.ok) {
          const data = await response.json();
          setAvailableProblems(data.problems || []);
        }
      } catch (error) {
        console.error('Failed to fetch problems:', error);
      }
    };

    if (isPrivate) {
      fetchProblems();
    }
  }, [isPrivate]);

  // Filter problems based on difficulty and search
  const filteredProblems = availableProblems.filter(problem => {
    const matchesDifficulty = difficultyFilter === 'All' || problem.difficulty === difficultyFilter;
    const matchesSearch = problem.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDifficulty && matchesSearch;
  });

  // Handle problem selection - RESTORED WEBSOCKET APPROACH
  const handleSelectProblem = (problem: Problem) => {
    if (!isCreator || !roomRef.current) return;
    
    roomRef.current.send('select_problem', {
      userId,
      problemId: problem._id
    });
  };

  // Handle starting the match - RESTORED WEBSOCKET APPROACH
  const handleStartMatch = () => {
    if (!isCreator || !roomRef.current || privateRoomData?.players.length !== 2) return;
    
    setIsStartingMatch(true);
    roomRef.current.send('start_match', { userId });
  };

  const handleCancelQueue = async () => {
    try {
      shouldCancelRef.current = false;
      setQueueStatus("cancelled");
      
      if (isPrivate && roomCodeParam) {
        // Leave private room via WebSocket
        if (roomRef.current) {
          try {
            await roomRef.current.leave();
          } catch (error) {
            console.warn('Failed to leave private room:', error);
          }
        }
      } else {
        // Leave public queue room using hook
        await leaveQueue();
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
                        {isPrivate ? (
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
                              <p className="text-lg font-semibold text-black mb-3">Players ({(privateRoomData?.players || [{ userId, username }]).length}/2)</p>
                              <div className="space-y-2">
                                {(privateRoomData?.players || [{ userId, username }]).map((player: PlayerInfo, idx: number) => (
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

                            {/* Problem Selection (Host Only) */}
                            {isCreator && (
                              <div className="bg-white rounded-lg p-6 border border-blue-200">
                                <h3 className="text-lg font-semibold text-black mb-4">Select Problem</h3>
                                
                                {/* Selected Problem Display */}
                                {selectedProblem ? (
                                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                                    <p className="text-sm text-green-700 font-medium">Selected Problem:</p>
                                    <p className="text-black font-semibold">{selectedProblem.title}</p>
                                    <div className="flex gap-2 mt-1">
                                      <span className={`text-xs px-2 py-1 rounded ${
                                        selectedProblem.difficulty === 'Easy' ? 'bg-green-100 text-green-700' :
                                        selectedProblem.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                                        'bg-red-100 text-red-700'
                                      }`}>
                                        {selectedProblem.difficulty}
                                      </span>
                                      {selectedProblem.topics.slice(0, 2).map((topic, idx) => (
                                        <span key={idx} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                          {topic}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                                    <p className="text-sm text-yellow-700">No problem selected - will use random Medium problem</p>
                                  </div>
                                )}

                                {/* Difficulty Filter */}
                                <div className="mb-4">
                                  <p className="text-sm font-medium text-black mb-2">Filter by Difficulty:</p>
                                  <div className="flex gap-2">
                                    {['All', 'Easy', 'Medium', 'Hard'].map((diff) => (
                                      <Button
                                        key={diff}
                                        variant={difficultyFilter === diff ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setDifficultyFilter(diff)}
                                        className={difficultyFilter === diff ? "bg-blue-500 text-white" : ""}
                                      >
                                        {diff}
                                      </Button>
                                    ))}
                                  </div>
                                </div>

                                {/* Search */}
                                <div className="mb-4">
                                  <div className="relative">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                                    <input
                                      type="text"
                                      placeholder="Search problems..."
                                      value={searchQuery}
                                      onChange={(e) => setSearchQuery(e.target.value)}
                                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                  </div>
                                </div>

                                {/* Problems List */}
                                <div className="max-h-60 overflow-y-auto space-y-2">
                                  {filteredProblems.map((problem) => (
                                    <div
                                      key={problem._id}
                                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                                        selectedProblem?._id === problem._id
                                          ? 'border-blue-500 bg-blue-50'
                                          : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                                      }`}
                                      onClick={() => handleSelectProblem(problem)}
                                    >
                                      <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                          <p className="font-medium text-black">{problem.title}</p>
                                          <div className="flex gap-2 mt-1">
                                            <span className={`text-xs px-2 py-1 rounded ${
                                              problem.difficulty === 'Easy' ? 'bg-green-100 text-green-700' :
                                              problem.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-red-100 text-red-700'
                                            }`}>
                                              {problem.difficulty}
                                            </span>
                                            {problem.topics.slice(0, 3).map((topic, idx) => (
                                              <span key={idx} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                                                {topic}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                        {selectedProblem?._id === problem._id && (
                                          <Check className="h-5 w-5 text-blue-500" />
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Start Match Button (Host Only) */}
                            {isCreator && (
                              <div className="flex justify-center">
                                <Button
                                  className={`px-8 py-3 text-white font-semibold rounded-full transition-all duration-300 ${
                                    (privateRoomData?.players || []).length === 2
                                      ? 'bg-green-500 hover:bg-green-600 transform hover:scale-105'
                                      : 'bg-gray-400 cursor-not-allowed'
                                  }`}
                                  onClick={handleStartMatch}
                                  disabled={(privateRoomData?.players || []).length !== 2 || isStartingMatch}
                                >
                                  {isStartingMatch ? (
                                    <>
                                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                      Starting...
                                    </>
                                  ) : (
                                    <>
                                      <Play className="mr-2 h-5 w-5" />
                                      Start Match
                                    </>
                                  )}
                                </Button>
                              </div>
                            )}

                            {/* Status Message */}
                            {isCreator ? (
                              <p className="text-center text-black/60">
                                {(privateRoomData?.players || []).length === 2 
                                  ? "Ready to start the match!" 
                                  : "Waiting for another player to join..."
                                }
                              </p>
                            ) : (
                              <p className="text-center text-black/60">
                                {selectedProblem 
                                  ? `Host selected: ${selectedProblem.title}` 
                                  : "Host is selecting a problem..."
                                }
                              </p>
                            )}

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