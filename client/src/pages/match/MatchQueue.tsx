"use client";
import React, { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, X, Zap, Clock, Copy, Check, Search, Play } from "lucide-react";
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from "framer-motion";
import { Client, Room } from 'colyseus.js';

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
  
  const [queueStatus, setQueueStatus] = useState<
    "waiting" | "matched" | "error" | "cancelled"
  >("waiting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  const shouldCancelRef = useRef(true);

  useEffect(() => {
    let isMounted = true;

    if (isPrivate && roomCodeParam) {
      // Private room logic - WebSocket-based approach
      const joinPrivateRoom = async () => {
        try {
          const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
          
          // First, get room info from HTTP endpoint
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
            throw new Error(error.error || 'Failed to join room');
          }
          
          const roomInfo = await response.json();
          if (!isMounted) return;
          
          // Now connect to the specific WebSocket room using the roomId from the HTTP response
          const client = new Client(process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!);
          
          // Use join() instead of joinById to connect to existing room
          const room = await client.join('private', { 
            roomCode: roomCodeParam, 
            userId, 
            username 
          });
          
          roomRef.current = room;
          setIsCreator(roomInfo.isCreator);
          
          // Listen for player updates
          room.onMessage('players_updated', (data) => {
            if (!isMounted) return;
            
            setPrivateRoomData({
              roomCode: roomCodeParam,
              players: data.players,
              isCreator: data.creatorId === userId
            });
            setIsCreator(data.creatorId === userId);
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
          
          console.log('Connected to private room via WebSocket');
          
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to join room';
          console.error('Failed to join private room:', error);
          toast.error('Failed to join room: ' + message);
          setQueueStatus("error");
          setErrorMessage(message);
        }
      };

      // Initial join
      joinPrivateRoom();
      
      return () => {
        isMounted = false;
        if (roomRef.current && shouldCancelRef.current) {
          roomRef.current.leave();
        }
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

      return () => {
        isMounted = false;
        clearInterval(statsInterval);
        if (roomRef.current && shouldCancelRef.current) {
          try {
            roomRef.current.leave();
          } catch {}
        }
      };
    }
  }, [userId, username, rating, router, isPrivate, roomCodeParam, availableProblems]);

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

  // Handle problem selection
  const handleSelectProblem = (problem: Problem) => {
    if (!isCreator || !roomRef.current) return;
    
    roomRef.current.send('select_problem', {
      userId,
      problemId: problem._id
    });
  };

  // Handle starting the match
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
                                    privateRoomData.players.length === 2
                                      ? 'bg-green-500 hover:bg-green-600 transform hover:scale-105'
                                      : 'bg-gray-400 cursor-not-allowed'
                                  }`}
                                  onClick={handleStartMatch}
                                  disabled={privateRoomData.players.length !== 2 || isStartingMatch}
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
                                {privateRoomData.players.length === 2 
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