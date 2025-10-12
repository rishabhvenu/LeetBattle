'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Client, Room } from 'colyseus.js';
import { consumeReservation, getMatchData } from '@/lib/actions';
import { toast } from 'react-toastify';
import CountdownTimer from '@/components/CountdownTimer';
import Running, { TestCaseResult } from '@/components/Running';
import MatchupAnimation from '@/components/MatchupAnimation';
import MatchResultAnimation from '@/components/MatchResultAnimation';
import Editor from "@monaco-editor/react";
import { getAvatarUrl } from '@/lib/utils';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Check,
  Trophy,
  Clock,
  Brain,
  Code2,
  Timer,
  Target,
  FileText,
  ListChecks,
  User,
  CheckCircle,
  Gamepad2,
  X,
} from "lucide-react";

// Removed global singletons - now using React refs to prevent leaks

const languages = [
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
];

const difficultyConfig: Record<string, { color: string; bg: string; text: string; icon: React.ElementType }> = {
  easy: { color: "text-green-600", bg: "bg-green-100", text: "text-green-600", icon: Brain },
  medium: { color: "text-yellow-600", bg: "bg-yellow-100", text: "text-yellow-600", icon: Code2 },
  hard: { color: "text-red-600", bg: "bg-red-100", text: "text-red-600", icon: Timer },
};

export default function MatchClient({ userId, username, userAvatar }: { userId: string; username: string; userAvatar?: string | null }) {
  // Use refs to persist state across renders without leaking across component instances
  const roomRef = useRef<Room | null>(null);
  const joinPromiseRef = useRef<Promise<Room> | null>(null);
  
  const [connected, setConnected] = useState(false);
  const [showMatchupAnimation, setShowMatchupAnimation] = useState(false);
  const [lines, setLines] = useState(0);
  const [opponentLines, setOpponentLines] = useState(0);
  const [language, setLanguage] = useState(() => {
    // Load last selected language from localStorage
    if (typeof window !== 'undefined') {
      return localStorage.getItem('preferred-language') || 'javascript';
    }
    return 'javascript';
  });
  const [code, setCode] = useState('');
  const [selectedSubmission, setSelectedSubmission] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState('description');
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [problem, setProblem] = useState<{
    _id: string;
    title: string;
    description: string;
    difficulty: string;
    signature?: {
      functionName: string;
      parameters: Array<{ name: string; type: string }>;
      returnType: string;
    };
    testCasesCount?: number;
    starterCode?: Record<string, string>;
    topics?: string[];
    examples?: Array<{
      input: string;
      output: string;
      explanation?: string;
    }>;
    constraints?: string[];
  } | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchStartTime, setMatchStartTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [runPage, setRunPage] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testCaseResults, setTestCaseResults] = useState<TestCaseResult[]>([]);
  const [opponentStats, setOpponentStats] = useState<{
    name: string;
    avatar: string | null;
    globalRank: number;
    gamesWon: number;
    winRate: number;
    rating: number;
  }>({
    name: 'Opponent',
    avatar: null,
    globalRank: 1234,
    gamesWon: 50,
    winRate: 65,
    rating: 1200,
  });
  const [userStats, setUserStats] = useState<{
    rating: number;
    winRate: number;
    totalMatches: number;
  }>({
    rating: 1200,
    winRate: 0,
    totalMatches: 0,
  });
  const [userTestsPassed, setUserTestsPassed] = useState(0);
  const [opponentTestsPassed, setOpponentTestsPassed] = useState(0);
  const [totalTests, setTotalTests] = useState(0);
  const [showResultAnimation, setShowResultAnimation] = useState(false);
  const [matchResult, setMatchResult] = useState<{ winner: boolean; draw: boolean } | null>(null);
  // roomRef defined at top of component (line 64)
  const matchupAnimationShownRef = useRef(false);

  // Animation handlers
  const handleResultAnimationComplete = () => {
    setShowResultAnimation(false);
    // Redirect to play page after animation completes
    setTimeout(() => {
      window.location.href = '/play';
    }, 1000);
  };

  // Separate effect to load match data (runs even with cached room)
  useEffect(() => {
    if (!matchId) {
      console.log('No matchId yet, skipping data load');
      return;
    }
    
    console.log('Loading match data for matchId:', matchId);
    
    const loadMatchData = async () => {
      try {
        const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
        
        // Load full match data (problem and opponent)
        const matchDataResult = await getMatchData(matchId, userId);
        
        if (!matchDataResult.success) {
          console.error('Failed to load match data:', matchDataResult.error);
          // Clear potentially stale reservation and redirect to queue
          await fetch(`${base}/queue/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
          });
          toast.error('Match no longer exists. Redirecting to queue...');
          setTimeout(() => {
            window.location.href = '/queue';
          }, 2000);
          return;
        }
        
        console.log('Match data loaded successfully');
        
        // Set problem data
        if (matchDataResult.problem) {
          setProblem(matchDataResult.problem);
          // Set total test cases count
          if (matchDataResult.problem.testCasesCount) {
            setTotalTests(matchDataResult.problem.testCasesCount);
          }
        }
        
        // Set opponent stats FIRST before showing animation
        if (matchDataResult.opponent) {
          setOpponentStats({
            name: matchDataResult.opponent.name,
            avatar: matchDataResult.opponent.avatar,
            globalRank: matchDataResult.opponent.globalRank,
            gamesWon: matchDataResult.opponent.gamesWon,
            winRate: matchDataResult.opponent.winRate,
            rating: matchDataResult.opponent.rating,
          });
          
          // Force a small delay to ensure state updates
          await new Promise<void>(resolve => setTimeout(resolve, 100));
        }
        
        // Set current user stats
        if (matchDataResult.userStats) {
          setUserStats({
            rating: matchDataResult.userStats.rating || 1200,
            winRate: matchDataResult.userStats.winRate || 0,
            totalMatches: matchDataResult.userStats.totalMatches || 0,
          });
        }
        
        // Load snapshot for saved code and submissions (time comes from WebSocket now)
        const snapResp = await fetch(`${base}/match/snapshot?matchId=${encodeURIComponent(matchId)}`);
        
        if (snapResp.ok) {
          const snap = await snapResp.json();
          
          // Restore code
          const myCodeByLang = snap.playersCode?.[userId] || {};
          if (myCodeByLang[language] && myCodeByLang[language].trim().length > 0) {
            setCode(myCodeByLang[language]);
          } else if (matchDataResult.problem?.starterCode?.[language]) {
            setCode(matchDataResult.problem.starterCode[language]);
          }
          
          // Load submissions
          if (snap.submissions && Array.isArray(snap.submissions)) {
            const userSubmissions = snap.submissions
              .filter((s: any) => s.userId === userId)
              .map((s: any) => formatSubmission(s))
              .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            setSubmissions(userSubmissions);
            console.log('Loaded', userSubmissions.length, 'submissions');
            
            // Find best submission (most tests passed) for both players
            const allSubmissions = snap.submissions || [];
            const userBest = allSubmissions
              .filter((s: any) => s.userId === userId)
              .reduce((max: any, s: any) => {
                const passed = s.testResults?.filter((t: any) => t.status === 3).length || 0;
                const maxPassed = max?.testResults?.filter((t: any) => t.status === 3).length || 0;
                return passed > maxPassed ? s : max;
              }, null);
            
            const opponentBest = allSubmissions
              .filter((s: any) => s.userId !== userId)
              .reduce((max: any, s: any) => {
                const passed = s.testResults?.filter((t: any) => t.status === 3).length || 0;
                const maxPassed = max?.testResults?.filter((t: any) => t.status === 3).length || 0;
                return passed > maxPassed ? s : max;
              }, null);
            
            if (userBest) {
              const passed = userBest.testResults?.filter((t: any) => t.status === 3).length || 0;
              setUserTestsPassed(passed);
            }
            
            if (opponentBest) {
              const passed = opponentBest.testResults?.filter((t: any) => t.status === 3).length || 0;
              setOpponentTestsPassed(passed);
            }
          }
        }
        
        // Mark as loaded and show matchup animation (only once)
        // Delay to ensure opponent stats state has updated
        await new Promise(resolve => setTimeout(resolve, 50));
        setLoading(false);
        if (!matchupAnimationShownRef.current) {
          setShowMatchupAnimation(true);
          matchupAnimationShownRef.current = true;
        }
        console.log('Match data load complete');
      } catch (err) {
        console.error('Error loading match data:', err);
        // Still set loading to false to prevent infinite loading
        setLoading(false);
      }
    };
    
    loadMatchData();
  }, [matchId, userId, language]);

  useEffect(() => {
    // Use ref-based singleton to prevent duplicate joins from React Strict Mode
    if (roomRef.current) {
      console.log('Using existing room connection');
      setConnected(true);
      // Extract matchId from room metadata if not set
      if (roomRef.current.sessionId) {
        // Try to get matchId from the room's state or metadata
        const roomMatchId = (roomRef.current as unknown as { matchId?: string }).matchId;
        if (roomMatchId && !matchId) {
          setMatchId(roomMatchId);
        }
      }
      // Don't block - let the separate useEffect load the data
      return;
    }
    
    if (joinPromiseRef.current) {
      console.log('Join already in progress, waiting...');
      joinPromiseRef.current.then(room => {
        roomRef.current = room;
        setConnected(true);
        // Extract matchId if not set
        const roomMatchId = (room as unknown as { matchId?: string }).matchId;
        if (roomMatchId && !matchId) {
          setMatchId(roomMatchId);
        }
      }).catch(() => {});
      return;
    }
    
    const doJoin = async (): Promise<Room> => {
      try {
        // Get fresh reservation from server
        console.log('Consuming reservation for userId:', userId);
        const res = await consumeReservation(userId);
        console.log('Reservation result:', res);
        
        if (!res.success || !res.reservation) { 
          joinPromiseRef.current = null;
          setConnected(false); 
          toast.error('Reservation expired.'); 
          window.location.href = '/queue'; 
          throw new Error('Reservation expired');
        }
        
        const reservation = res.reservation;
        const matchIdValue = reservation?.matchId;
        setMatchId(matchIdValue);
        
        console.log('Joining room:', reservation.roomId);
        
      const client = new Client(process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!);
        
        let room: Room;
        try {
          room = await client.joinById(reservation.roomId, { userId, matchId: reservation.matchId });
          console.log('Successfully joined room:', room.id);
        } catch (joinError) {
          console.error('Join failed:', joinError);
          // Clear the reservation since we couldn't join
          await fetch(`${process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL}/queue/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
          });
          joinPromiseRef.current = null;
          throw joinError;
        }
        
        roomRef.current = room;
      roomRef.current = room;
      setConnected(true);
        
        // Setup room event handlers
      room.onMessage('code_update', (payload) => {
          console.log('Received code_update:', payload);
          if (payload?.userId && payload.userId !== userId) {
          setOpponentLines(payload.lines || 0);
        }
      });
        
      room.onMessage('kicked', () => {
        toast.error('You were disconnected: another connection detected.');
        try { room.leave(); } catch {}
      });
      
      // Receive match initialization data via WebSocket
      room.onMessage('match_init', (payload) => {
        console.log('Received match_init:', payload);
        
        // Set match start time from the server
        if (payload.startedAt) {
          const startTime = new Date(payload.startedAt).getTime();
          setMatchStartTime(startTime);
          console.log('Match started at (from WebSocket):', new Date(startTime).toISOString());
          
          // Trigger matchup animation (only once)
          if (!matchupAnimationShownRef.current) {
            setShowMatchupAnimation(true);
            matchupAnimationShownRef.current = true;
          }
        }
        
        // Restore lines written
        if (payload.linesWritten) {
          setLines(payload.linesWritten[userId] || 0);
          const otherUserId = Object.keys(payload.linesWritten).find((u: string) => u !== userId);
          if (otherUserId) {
            setOpponentLines(payload.linesWritten[otherUserId] || 0);
          }
        }
      });
      
      // Listen for new submissions (from backend with correct data)
      room.onMessage('new_submission', (payload) => {
        console.log('New submission received:', payload);
        // Handle submissions for this user
        if (payload.userId === userId) {
          const formattedSubmission = formatSubmission(payload.submission);
          setSubmissions(prev => [formattedSubmission, ...prev]);
          setActiveTab('submissions');
        } else {
          // Opponent submission - update their solved count
          console.log('Opponent submission:', payload.submission);
          if (payload.submission?.passed) {
            setOpponentTestsPassed(prev => {
              const total = problem?.testCases?.length || 0;
              return total;
            });
          } else if (payload.submission?.testResults) {
            const passed = payload.submission.testResults.filter((t: any) => t.status === 3).length;
            setOpponentTestsPassed(passed);
          }
        }
      });
        
      room.onMessage('rate_limit', ({ action }) => {
        const msg = action === 'submit_code' ? 'Too many submits. Slow down.' : 'Too many test runs.';
        toast.info(msg);
      });

      room.onMessage('match_winner', (payload) => {
        console.log('Match winner received:', payload);
        const isWinner = payload.userId === userId;
        
        setMatchResult({ winner: isWinner, draw: false });
        setShowResultAnimation(true);
      });

      room.onMessage('match_draw', (payload) => {
        console.log('Match draw received:', payload);
        
        setMatchResult({ winner: false, draw: true });
        setShowResultAnimation(true);
      });
        
        room.onMessage('test_submission_result', (payload) => {
          console.log('Test results received:', payload);
          setIsRunning(false);
          
          if (payload.success) {
            setTestCaseResults(payload.testResults || []);
            setRunPage(true);
          } else {
            toast.error(payload.error || 'Test run failed');
          }
        });
        
        room.onMessage('submission_result', (payload) => {
          console.log('Submission results received:', payload);
          setIsSubmitting(false);
          
          if (payload.success) {
            // Update test cases passed count
            if (payload.allPassed) {
              setUserTestsPassed(payload.totalTests || problem?.testCases?.length || 0);
            } else {
              const passed = payload.passedTests || 0;
              setUserTestsPassed(passed);
            }
          }
        });

        room.onMessage('complexity_failed', (payload) => {
          console.log('Complexity check failed:', payload);
          // User passed all tests but failed complexity
          setUserTestsPassed(problem?.testCases?.length || 0);
          setIsSubmitting(false);
        });

        // Store matchId on room for later access
        (room as unknown as { matchId?: string }).matchId = matchIdValue;
        
        return room;
      } catch (error) {
        console.error('Error in doJoin:', error);
        joinPromiseRef.current = null;
        roomRef.current = null;
        setConnected(false); 
        toast.error(`Failed to join match: ${error instanceof Error ? error.message : 'Unknown error'}`); 
        window.location.href = '/queue'; 
        throw error;
      }
    };
    
    // Start the join process with ref-based promise
    joinPromiseRef.current = doJoin();
    joinPromiseRef.current.catch(() => {});
    
    // Cleanup: leave room when window closes
    if (typeof window !== 'undefined') {
      const handleBeforeUnload = () => {
        if (roomRef.current) {
          try {
            roomRef.current.leave();
            console.log('Left room on page unload');
          } catch {
            // Ignore errors on leave
          }
        }
        roomRef.current = null;
        joinPromiseRef.current = null;
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, [userId, matchId]);

  useEffect(() => {
    const l = (code.match(/\n/g)?.length || 0) + (code ? 1 : 0);
    setLines(l);
  }, [code]);

  const handleCodeChange = (value: string | undefined) => {
    const newCode = value || '';
    setCode(newCode);
    const newLines = (newCode.match(/\n/g)?.length || 0) + (newCode ? 1 : 0);
    
    if (roomRef.current) {
      console.log('Sending update_code with lines:', newLines);
      roomRef.current.send('update_code', { userId, language, code: newCode, lines: newLines });
    }
  };

  // Convert timestamp to relative time (e.g., "5 minutes ago")
  const getRelativeTime = (timestamp: string | number) => {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diff = now - time;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };

  // Format backend submission to UI format
  const formatSubmission = (submission: any) => {
    // Check if this is a complexity failed submission
    if (submission.complexityFailed) {
      return {
        id: submission.timestamp,
        status: 'Time Complexity Failed',
        errorType: 'complexity',
        language: submission.language.charAt(0).toUpperCase() + submission.language.slice(1),
        time: getRelativeTime(submission.timestamp),
        date: getRelativeTime(submission.timestamp),
        timestamp: submission.timestamp,
        code: submission.code || '// Code not available',
        passedTests: submission.testResults?.filter((t: any) => t.status === 3).length || 0,
        totalTests: submission.testResults?.length || 0,
        runtime: submission.averageTime ? `${submission.averageTime} ms` : '—',
        memory: submission.averageMemory ? `${submission.averageMemory} MB` : '—',
        timeComplexity: submission.derivedComplexity || 'Unknown',
        expectedComplexity: submission.expectedComplexity,
        spaceComplexity: 'O(1)',
        complexityError: 'All tests passed, but your solution does not meet the required time complexity.'
      };
    }
    
    const firstFailedTest = submission.testResults?.find((t: any) => t.status !== 3 && t.status?.id !== 3);
    const actualPassedTests = submission.testResults?.filter((t: any) => t.status === 3 || t.status?.id === 3).length || 0;
    const totalTests = submission.testResults?.length || 0;
    
    let status = 'Accepted';
    let errorType = { type: '', label: '' };
    
    // Check if submission passed or failed
    if (!submission.passed) {
      // Submission failed - determine why
      if (firstFailedTest) {
        const statusId = typeof firstFailedTest.status === 'number' ? firstFailedTest.status : firstFailedTest.status?.id;
        errorType = getErrorType(statusId || 4);
        status = errorType.label;
      } else {
        // No test results but marked as failed
        status = 'Wrong Answer';
        errorType = { type: 'wrong', label: 'Wrong Answer' };
      }
    } else if (totalTests > 0 && actualPassedTests !== totalTests) {
      // Has test results but not all passed (shouldn't happen if submission.passed is true, but handle it)
      const statusId = typeof firstFailedTest?.status === 'number' ? firstFailedTest.status : firstFailedTest?.status?.id;
      errorType = getErrorType(statusId || 4);
      status = errorType.label;
    }

    return {
      id: submission.timestamp,
      status,
      errorType: errorType.type,
      language: submission.language.charAt(0).toUpperCase() + submission.language.slice(1),
      time: getRelativeTime(submission.timestamp),
      date: getRelativeTime(submission.timestamp),
      timestamp: submission.timestamp,
      code: submission.code || '// Code not available',
      passedTests: actualPassedTests,
      totalTests: totalTests,
      runtime: submission.averageTime ? `${submission.averageTime} ms` : '—',
      memory: submission.averageMemory ? `${submission.averageMemory} MB` : '—',
      timeComplexity: 'O(n)', // Placeholder
      spaceComplexity: 'O(1)', // Placeholder
      compileError: firstFailedTest?.error && errorType.type === 'compile' ? firstFailedTest.error : undefined,
      runtimeError: firstFailedTest?.error && errorType.type === 'runtime' ? firstFailedTest.error : undefined,
      systemError: firstFailedTest?.error && errorType.type === 'system' ? firstFailedTest.error : undefined,
      timeoutError: firstFailedTest?.error && errorType.type === 'timeout' ? firstFailedTest.error : undefined,
      memoryError: firstFailedTest?.error && errorType.type === 'memory' ? firstFailedTest.error : undefined,
      failedTestCase: firstFailedTest ? {
        input: firstFailedTest.input || '',
        expected: firstFailedTest.expectedOutput || '',
        actual: firstFailedTest.userOutput || '',
      } : undefined,
    };
  };

  const handleLanguageChange = async (newLang: string) => {
    setLanguage(newLang);
    
    // Save to localStorage for persistence across page reloads
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferred-language', newLang);
    }
    
    // Try to load saved code for this language first
    if (matchId) {
      try {
        const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
        const resp = await fetch(`${base}/match/snapshot?matchId=${encodeURIComponent(matchId)}`);
        if (resp.ok) {
          const snap = await resp.json();
          const myCodeByLang = snap.playersCode?.[userId] || {};
          
          if (myCodeByLang[newLang] && myCodeByLang[newLang].trim().length > 0) {
            setCode(myCodeByLang[newLang]);
          } else if (problem?.starterCode && problem.starterCode[newLang]) {
            // No saved code, use starter code
            setCode(problem.starterCode[newLang]);
          }
        }
      } catch {}
    } else if (problem?.starterCode && problem.starterCode[newLang]) {
      // No matchId yet, just load starter code
      setCode(problem.starterCode[newLang]);
    }
    
    if (roomRef.current) {
      roomRef.current.send('set_language', { userId, language: newLang });
    }
  };

  const handleRunClick = () => {
    if (!roomRef.current) {
      toast.error('Not connected to match room');
      return;
    }
    
    if (isRunning) {
      toast.warning('Already running tests...');
      return;
    }
    
    if (isSubmitting) {
      toast.warning('Please wait for submission to complete');
      return;
    }
    
    setIsRunning(true);
    setTestCaseResults([]);
    roomRef.current.send('test_submit_code', { userId, language, source_code: code });
  };

  const handleSubmitClick = () => {
    if (!roomRef.current) {
      toast.error('Not connected to match room');
      return;
    }
    
    if (isSubmitting) {
      toast.warning('Already submitting...');
      return;
    }
    
    if (isRunning) {
      toast.warning('Please wait for test run to complete');
      return;
    }
    
    setIsSubmitting(true);
    roomRef.current.send('submit_code', { userId, language, source_code: code });
  };

  const diffStyle = problem ? difficultyConfig[problem.difficulty?.toLowerCase() || 'medium'] : difficultyConfig.medium;
  const DifficultyIcon = diffStyle?.icon || Brain;

  // Helper function to determine error type from Judge0 status
  const getErrorType = (status: number): { type: string; label: string } => {
    switch (status) {
      case 6: return { type: 'compile', label: 'Compile Error' };
      case 11: return { type: 'runtime', label: 'Runtime Error' };
      case 5: return { type: 'timeout', label: 'Time Limit Exceeded' };
      case 4: return { type: 'wrong', label: 'Wrong Answer' };
      case 12: return { type: 'memory', label: 'Memory Limit Exceeded' };
      case 13: return { type: 'system', label: 'System Error' };
      default: return { type: 'wrong', label: 'Wrong Answer' };
    }
  };

  // Helper function to render profile picture
  const renderProfilePicture = (avatar: string | null | undefined, isOpponent: boolean = false) => {
    const avatarUrl = getAvatarUrl(avatar);
    return (
      <img 
        src={avatarUrl}
        alt="Profile"
        className="w-10 h-10 rounded-full object-cover border-2"
        style={{ borderColor: isOpponent ? '#ef4444' : '#2599D4' }}
        onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
          e.currentTarget.src = '/placeholder_avatar.png';
        }}
      />
    );
  };

  if (loading || !matchStartTime) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-blue-50 relative overflow-hidden">
        {/* Background decorative elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
          <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-cyan-400/6 rounded-full filter blur-3xl"></div>
        </div>
        <div className="text-black text-2xl relative z-10">Loading match...</div>
      </div>
    );
  }

  // Helper to get initials from username
  const getInitials = (name: string) => {
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-blue-50 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-cyan-400/6 rounded-full filter blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] bg-blue-500/6 rounded-full filter blur-3xl"></div>
      </div>
      
      {/* Main content wrapper with blur effect when animations are showing */}
      <div className={`flex flex-col flex-1 transition-all duration-300 min-h-0 ${(showMatchupAnimation || showResultAnimation) ? 'blur-sm' : ''}`}>
      
      {/* Player Stats Header */}
      <div className="h-16 flex items-center justify-between px-8 bg-white/90 border-b border-blue-200 z-20 flex-shrink-0">
        <div className="flex items-center gap-6">
          {/* Current User */}
          <div className="flex items-center gap-3">
            <div className="relative">
              {renderProfilePicture(userAvatar, false)}
            </div>
            <div>
              <div className="text-sm font-semibold text-black">{username}</div>
              <div className="text-xs text-black/70">Rating: {userStats.rating}</div>
            </div>
          </div>

          {/* Current User Stats */}
          <div className="flex items-center gap-4 pl-4 border-l border-blue-200">
            <div className="flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-yellow-600" />
              <span className="text-xs text-black/70">Win Rate: {userStats.winRate}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Target className="w-4 h-4" style={{ color: '#2599D4' }} />
              <span className="text-xs text-black/70">Lines: {lines}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-xs text-black/70">Solved: {userTestsPassed}/{totalTests}</span>
            </div>
          </div>
        </div>

        {/* VS Separator */}
        <div className="text-lg font-bold text-black/50">VS</div>

        {/* Opponent Stats & Info */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 pr-4 border-r border-blue-200">
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-xs text-black/70">Solved: {opponentTestsPassed}/{totalTests}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Target className="w-4 h-4" style={{ color: '#2599D4' }} />
              <span className="text-xs text-black/70">Lines: {opponentLines}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-yellow-600" />
              <span className="text-xs text-black/70">Win Rate: {opponentStats.winRate}%</span>
            </div>
          </div>

          {/* Opponent Info */}
          <div className="flex items-center gap-3">
            <div>
              <div className="text-sm font-semibold text-black text-right">{opponentStats.name}</div>
              <div className="text-xs text-black/70 text-right">Rating: {opponentStats.rating}</div>
            </div>
            <div className="relative">
              {renderProfilePicture(opponentStats.avatar, true)}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-row min-h-0">
        <ResizablePanelGroup direction="horizontal" className="flex-1 relative z-10 min-h-0">
        <ResizablePanel defaultSize={45} minSize={35}>
      {/* Left Panel - Problem Description */}
          <div className="relative w-full h-full bg-blue-50 z-10">
            {problem ? (
              <div className="h-full flex flex-col">
                {/* Tabs */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col h-full">
                  <TabsList className="w-full justify-start rounded-none border-b border-blue-200 bg-white/90 p-0 h-12 flex-shrink-0 [&_[data-state=active]]:bg-[#2599D4] [&_[data-state=active]]:text-white [&_[data-state=active]]:border-b-2 [&_[data-state=active]]:border-[#2599D4]">
                    <TabsTrigger
                      value="description"
                      className="rounded-none px-6 h-full text-sm font-medium data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black transition-all duration-200 flex items-center gap-2 border-b-2 border-transparent"
                    >
                      <FileText className="h-4 w-4" />
                      Description
                    </TabsTrigger>
                    <TabsTrigger
                      value="submissions"
                      className="rounded-none px-6 h-full text-sm font-medium data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black transition-all duration-200 flex items-center gap-2 border-b-2 border-transparent"
                    >
                      <ListChecks className="h-4 w-4" />
                      Submissions
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="description" className="flex-1 overflow-hidden m-0 min-h-0">
                    <ScrollArea className="h-full w-full">
                      <div className="p-6 space-y-8 bg-white/95 rounded-lg shadow-lg border border-gray-100">
                        {/* Problem Header */}
                        <div className="space-y-4">
                          <h1 className="text-3xl font-bold text-gray-900 leading-tight">{problem.title}</h1>
                          <div className="flex gap-2 items-center flex-wrap">
                            <Badge className={`${diffStyle.bg} ${diffStyle.text} text-xs font-medium px-3 py-1 rounded-full border shadow-sm hover:shadow-md transition-all duration-200 hover:opacity-90`}>
                              {problem.difficulty}
                            </Badge>
                            {problem.topics?.map((topic: string, index: number) => (
                              <Badge key={index} className="bg-gray-600 text-white text-xs font-medium px-3 py-1 rounded-full border border-gray-700 shadow-sm hover:shadow-md hover:bg-gray-700 transition-all duration-200">
                                {topic}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {/* Problem Description */}
                        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-md">
                          <div className="max-w-2xl mx-auto">
                            <p className="text-gray-700 leading-relaxed whitespace-pre-line text-base">
                              {problem.description}
                            </p>
                          </div>
                        </div>

                {/* Examples Section */}
                {problem.examples && problem.examples.length > 0 && (
                  <div className="space-y-6">
                    <div className="border-t border-gray-300 pt-6">
                      <h2 className="text-2xl font-bold text-gray-900 mb-6">Examples</h2>
                    </div>
                    {problem.examples.map((example, index) => (
                      <div key={index} className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                        <h3 className="text-xl font-semibold text-gray-900 mb-4">Example {index + 1}</h3>
                        <div className="space-y-4">
                          <div>
                            <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Input</span>
                            <code className="text-sm bg-gray-50 px-4 py-3 rounded-lg font-mono text-gray-800 border block">
                              {example.input}
                            </code>
                          </div>
                          <div>
                            <span className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Output</span>
                            <code className="text-sm bg-gray-50 px-4 py-3 rounded-lg font-mono text-gray-800 border block">
                              {example.output}
                            </code>
                          </div>
                          {example.explanation && (
                            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                              <span className="text-sm font-semibold text-blue-800 mb-2 block">Explanation</span>
                              <p className="text-sm text-blue-700 leading-relaxed">{example.explanation}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Constraints Section */}
                {problem.constraints && problem.constraints.length > 0 && (
                  <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                    <h2 className="text-2xl font-bold text-gray-900 mb-4">Constraints</h2>
                    <ul className="space-y-3">
                      {problem.constraints.map((constraint, index) => (
                        <li key={index} className="flex items-start gap-3 text-base text-gray-700 leading-relaxed">
                          <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                          <span>{constraint}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
          </div>
        </ScrollArea>
                  </TabsContent>

                  <TabsContent value="submissions" className="flex-1 overflow-hidden m-0 min-h-0">
                    <ScrollArea className="h-full w-full">
                      <div className="p-6 space-y-4">
                        <h2 className="text-xl font-semibold text-black mb-4">Submissions</h2>
                        
                        {submissions.length === 0 ? (
                          <div className="text-center py-12">
                            <p className="text-gray-500">No submissions yet. Submit your code to see results here.</p>
                  </div>
                        ) : (
                          submissions.map(submission => (
                            <div 
                              key={submission.id} 
                              className="bg-white/90 cursor-pointer hover:bg-white transition-colors rounded-lg p-4"
                              onClick={() => setSelectedSubmission(submission)}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <div className="w-20 flex-shrink-0">
                                    <span className={`inline-flex px-2 py-1 rounded text-xs font-semibold ${
                                      submission.status === 'Accepted' 
                                        ? 'bg-green-100 text-green-600' 
                                        : submission.errorType === 'compile'
                                        ? 'bg-orange-100 text-orange-600'
                                        : submission.errorType === 'runtime'
                                        ? 'bg-purple-100 text-purple-600'
                                        : submission.errorType === 'timeout'
                                        ? 'bg-yellow-100 text-yellow-600'
                                        : submission.errorType === 'memory'
                                        ? 'bg-indigo-100 text-indigo-600'
                                        : submission.errorType === 'system'
                                        ? 'bg-gray-100 text-gray-600'
                                        : submission.errorType === 'complexity'
                                        ? 'bg-rose-100 text-rose-600'
                                        : 'bg-red-100 text-red-600'
                                    }`}>
                                      {submission.errorType === 'wrong' ? 'WA' : 
                                       submission.errorType === 'compile' ? 'CE' :
                                       submission.errorType === 'runtime' ? 'RE' :
                                       submission.errorType === 'timeout' ? 'TLE' :
                                       submission.errorType === 'memory' ? 'MLE' :
                                       submission.errorType === 'system' ? 'SE' :
                                       submission.errorType === 'complexity' ? 'TCF' :
                                       submission.status}
                    </span>
                  </div>
                                  <div className="w-20 flex-shrink-0">
                                    <span className="text-sm text-black/70">{submission.language}</span>
                </div>
                                  <div className="flex-1">
                                    <span className="text-sm text-black/70">{submission.time}</span>
                  </div>
                </div>
              </div>
                  </div>
                          ))
                        )}
                </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-black/70">
                Loading problem...
            </div>
            )}
          </div>
        </ResizablePanel>
        
        <ResizableHandle className="w-1 bg-blue-200 hover:bg-[#2599D4] transition-colors" />
        
        <ResizablePanel className="h-full" defaultSize={55} minSize={35}>
          <div className="h-full flex flex-col bg-slate-900">
            {/* Language selector and buttons */}
            <div className="flex items-center justify-between px-4 h-12 bg-white/90 flex-shrink-0">
            <Select value={language} onValueChange={handleLanguageChange}>
              <SelectTrigger className="w-[150px] h-8 text-sm bg-white text-black border-blue-200 focus:ring-blue-500 focus:border-blue-500">
                <SelectValue placeholder="Select Language" />
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-8 px-4 text-white hover:opacity-90"
                style={{ backgroundColor: '#2599D4' }}
                onClick={handleRunClick}
                disabled={isRunning || isSubmitting}
              >
                {isRunning ? (
                  <>
                    <div className="h-4 w-4 mr-2 border-2 border-t-white border-white/30 rounded-full animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Tests
                  </>
                )}
              </Button>
              <Button
                size="sm"
                className="h-8 px-4 bg-green-600 text-white hover:bg-green-700"
                style={{ backgroundColor: '#10b981' }}
                onClick={handleSubmitClick}
                disabled={isSubmitting || isRunning}
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 mr-2 border-2 border-t-white border-white/30 rounded-full animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Submit
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Monaco Editor */}
          <div className="flex-1 overflow-hidden">
            <Editor
              height="100%"
              language={language}
              value={code}
              theme="vs-dark"
              onChange={handleCodeChange}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>

        </div>
        </ResizablePanel>
        </ResizablePanelGroup>
        </div>

      {/* Game Info Footer */}
      <div className="h-14 flex items-center justify-between px-8 bg-white/90 border-t border-blue-200 z-20 flex-shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-black/70" />
            <span className="text-sm text-black">
              Time Remaining: <CountdownTimer matchStartTime={matchStartTime} />
            </span>
          </div>
          <Separator orientation="vertical" className="h-6 bg-blue-200" />
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-4 h-4 text-black/70" />
            <span className="text-sm text-black">Difficulty: {problem?.difficulty || 'Medium'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-black/70">Match ID:</span>
          <span className="text-sm font-mono text-black">{matchId?.slice(0, 8)}</span>
        </div>
      </div>

      </div>
      {/* End of main content wrapper */}
      
      {/* Running Panel */}
      <Running 
        isVisible={runPage}
        setRunningPage={setRunPage}
        isLoading={isRunning}
        testCaseResults={testCaseResults}
      />
      
      {/* Submission Details Modal */}
      {selectedSubmission && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setSelectedSubmission(null)}
        >
          <div 
            className="bg-white w-[900px] h-[80vh] overflow-hidden rounded-lg shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200 flex items-start justify-between flex-shrink-0">
              <div>
                <h1 className={`text-2xl font-bold mb-2 ${
                  selectedSubmission.status === 'Accepted' 
                    ? 'text-green-600' 
                    : selectedSubmission.errorType === 'wrong'
                    ? 'text-red-600' 
                    : selectedSubmission.errorType === 'compile'
                    ? 'text-orange-600'
                    : selectedSubmission.errorType === 'runtime'
                    ? 'text-purple-600'
                    : selectedSubmission.errorType === 'timeout'
                    ? 'text-yellow-600'
                    : selectedSubmission.errorType === 'memory'
                    ? 'text-indigo-600'
                    : selectedSubmission.errorType === 'system'
                    ? 'text-gray-600'
                    : 'text-black'
                }`}>
                  {selectedSubmission.status}
                </h1>
                <p className="text-gray-600">
                  {selectedSubmission.passedTests}/{selectedSubmission.totalTests} testcases passed
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Submitted {selectedSubmission.date}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedSubmission(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Performance Metrics - Only for Accepted submissions */}
            {selectedSubmission.status === 'Accepted' && (
              <div className="p-6 bg-gray-50 border-b border-gray-200 flex-shrink-0">
                <div className="grid grid-cols-4 gap-6">
                  {/* Runtime */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Runtime</h3>
                    <div className="text-2xl font-bold text-black">
                      {selectedSubmission.runtime === '—' ? '0 ms' : selectedSubmission.runtime}
                    </div>
                  </div>

                  {/* Memory */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Memory</h3>
                    <div className="text-2xl font-bold text-black">
                      {selectedSubmission.memory === '—' ? '19.12 MB' : selectedSubmission.memory}
                    </div>
                  </div>

                  {/* Time Complexity */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Time Complexity</h3>
                    <div className="text-2xl font-bold text-black">
                      {selectedSubmission.timeComplexity}
                    </div>
                  </div>

                  {/* Space Complexity */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Space Complexity</h3>
                    <div className="text-2xl font-bold text-black">
                      {selectedSubmission.spaceComplexity}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto min-h-0">
            {/* Compile Error Section */}
            {selectedSubmission.errorType === 'compile' && selectedSubmission.compileError && (
              <div className="p-6 bg-orange-50 border-b border-orange-200">
                <h3 className="text-lg font-semibold text-orange-700 mb-4">Compile Error</h3>
                <div className="bg-orange-100 rounded-lg p-4 border border-orange-300">
                  <pre className="text-sm text-orange-800 font-mono whitespace-pre-wrap">{selectedSubmission.compileError}</pre>
                </div>
              </div>
            )}

            {/* Runtime Error Section */}
            {selectedSubmission.errorType === 'runtime' && selectedSubmission.runtimeError && (
              <div className="p-6 bg-purple-50 border-b border-purple-200">
                <h3 className="text-lg font-semibold text-purple-700 mb-4">Runtime Error</h3>
                <div className="space-y-4">
                  {selectedSubmission.failedTestCase && selectedSubmission.failedTestCase.input && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Input</h4>
                      <div className="bg-white rounded-lg p-3 border border-gray-200">
                        <code className="text-sm text-black font-mono">{selectedSubmission.failedTestCase.input}</code>
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="bg-purple-100 rounded-lg p-4 border border-purple-300">
                      <pre className="text-sm text-purple-800 font-mono whitespace-pre-wrap">{selectedSubmission.runtimeError}</pre>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Time Limit Exceeded Section */}
            {selectedSubmission.errorType === 'timeout' && selectedSubmission.timeoutError && (
              <div className="p-6 bg-yellow-50 border-b border-yellow-200">
                <h3 className="text-lg font-semibold text-yellow-700 mb-4">Time Limit Exceeded</h3>
                <div className="bg-yellow-100 rounded-lg p-4 border border-yellow-300">
                  <p className="text-sm text-yellow-800">Your solution took too long to execute. Try optimizing your algorithm.</p>
                </div>
              </div>
            )}

            {/* Memory Limit Exceeded Section */}
            {selectedSubmission.errorType === 'memory' && selectedSubmission.memoryError && (
              <div className="p-6 bg-indigo-50 border-b border-indigo-200">
                <h3 className="text-lg font-semibold text-indigo-700 mb-4">Memory Limit Exceeded</h3>
                <div className="bg-indigo-100 rounded-lg p-4 border border-indigo-300">
                  <p className="text-sm text-indigo-800">Your solution used too much memory. Try optimizing your space usage.</p>
                </div>
              </div>
            )}

            {/* System Error Section */}
            {selectedSubmission.errorType === 'system' && selectedSubmission.systemError && (
              <div className="p-6 bg-gray-50 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">System Error</h3>
                <div className="bg-gray-100 rounded-lg p-4 border border-gray-300">
                  <pre className="text-sm text-gray-800 font-mono whitespace-pre-wrap">{selectedSubmission.systemError}</pre>
                </div>
              </div>
            )}

            {/* Time Complexity Failed Section */}
            {selectedSubmission.errorType === 'complexity' && selectedSubmission.complexityError && (
              <div className="p-6 bg-rose-50 border-b border-rose-200">
                <h3 className="text-lg font-semibold text-rose-700 mb-4">Time Complexity Failed</h3>
                <div className="bg-rose-100 rounded-lg p-4 border border-rose-300">
                  <p className="text-sm text-rose-800 mb-3">{selectedSubmission.complexityError}</p>
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <h4 className="text-xs font-semibold text-rose-700 mb-1">Expected Complexity:</h4>
                      <code className="text-sm text-rose-900 font-mono bg-white px-2 py-1 rounded">
                        {selectedSubmission.expectedComplexity || 'N/A'}
                      </code>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-rose-700 mb-1">Your Complexity:</h4>
                      <code className="text-sm text-rose-900 font-mono bg-white px-2 py-1 rounded">
                        {selectedSubmission.timeComplexity}
                      </code>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Failed Test Case Section (Wrong Answer) */}
            {selectedSubmission.errorType === 'wrong' && selectedSubmission.failedTestCase && (
              <div className="p-6 bg-red-50 border-b border-red-200">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Input</h4>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <code className="text-sm text-black font-mono">{selectedSubmission.failedTestCase.input}</code>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Expected Output</h4>
                    <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                      <code className="text-sm text-green-700 font-mono">{selectedSubmission.failedTestCase.expected}</code>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Your Output</h4>
                    <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                      <code className="text-sm text-red-700 font-mono">{selectedSubmission.failedTestCase.actual}</code>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Code Section */}
            <div className="p-6">
              <h3 className="text-lg font-semibold text-black mb-4">
                Code | {selectedSubmission.language}
              </h3>
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <div style={{ position: 'relative', pointerEvents: 'none' }}>
                  <Editor
                    height="300px"
                    language={selectedSubmission.language.toLowerCase()}
                    value={selectedSubmission.code}
                    theme="vs-dark"
                    options={{
                      readOnly: true,
                      domReadOnly: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      cursorBlinking: "solid",
                      cursorStyle: "line",
                      cursorWidth: 0,
                      contextmenu: "off",
                      selectOnLineNumbers: false,
                      selectionHighlight: false,
                      occurrencesHighlight: false,
                    }}
                  />
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Matchup Animation Overlay */}
      {showMatchupAnimation && (
        <MatchupAnimation
          player1={{
            name: username,
            username: username,
            avatar: userAvatar || null,
            initials: getInitials(username),
          }}
          player2={{
            name: opponentStats.name,
            username: opponentStats.name,
            avatar: opponentStats.avatar || null,
            initials: getInitials(opponentStats.name),
          }}
          onAnimationComplete={() => setShowMatchupAnimation(false)}
        />
      )}

      {/* Match Result Animation Overlay */}
      {showResultAnimation && matchResult && (
        <MatchResultAnimation
          player1={{
            name: username,
            username: username,
            avatar: userAvatar || null,
            initials: getInitials(username),
            isWinner: matchResult.winner,
          }}
          player2={{
            name: opponentStats.name,
            username: opponentStats.name,
            avatar: opponentStats.avatar || null,
            initials: getInitials(opponentStats.name),
            isWinner: !matchResult.winner && !matchResult.draw,
          }}
          onAnimationComplete={handleResultAnimationComplete}
        />
      )}
    </div>
  );
}
