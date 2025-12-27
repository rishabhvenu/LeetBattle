// @ts-nocheck
'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Room } from 'colyseus.js';
import { setupRoomMessageHandlers as setupRoomHandlers } from '@/lib/utils/match/roomHandlers';
import { connectToMatchRoom } from '@/lib/utils/match/roomConnection';
import { loadMatchData } from '@/lib/utils/match/matchDataLoader';
import { toast } from 'react-toastify';
import Running, { TestCaseResult } from '@/components/Running';
import MatchupAnimation from '@/components/MatchupAnimation';
import MatchResultAnimation from '@/components/MatchResultAnimation';
import GuestSignUpModal from '@/components/GuestSignUpModal';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type {
  MatchClientProps,
  Problem,
  OpponentStats,
  UserStats,
  MatchResult,
  RatingChanges,
  TestSummary,
  FormattedSubmission,
} from '@/types/match';
import { formatSubmission } from '@/lib/utils/match/submissionFormatter';
import { MatchFooter } from './MatchFooter';
import { MatchStatsHeader } from './MatchStatsHeader';
import { ProblemDescriptionPanel } from './ProblemDescriptionPanel';
import { CodeEditorPanel } from './CodeEditorPanel';
import { SubmissionModal } from './SubmissionModal';
import { SubmissionProgressModal } from './SubmissionProgressModal';
import type { SubmissionStepType } from '@/types/match';

// Removed global singletons - now using React refs to prevent leaks

export default function MatchClient({ 
  userId, 
  username, 
  userAvatar, 
  isGuest = false, 
  guestMatchData = null 
}: MatchClientProps) {
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
  const [selectedSubmission, setSelectedSubmission] = useState<FormattedSubmission | null>(null);
  const [showSubmissionResultPopup, setShowSubmissionResultPopup] = useState(false);
  const [latestSubmissionResult, setLatestSubmissionResult] = useState<FormattedSubmission | null>(null);
  const [activeTab, setActiveTab] = useState('description');
  const [submissions, setSubmissions] = useState<FormattedSubmission[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  // Extract guest matchId once at component level to avoid re-renders
  const guestMatchId = isGuest && guestMatchData ? (guestMatchData as { matchId?: string })?.matchId || null : null;
  const [matchId, setMatchId] = useState<string | null>(guestMatchId);
  const [matchStartTime, setMatchStartTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [runPage, setRunPage] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testCaseResults, setTestCaseResults] = useState<TestCaseResult[]>([]);
  const [testSummary] = useState<TestSummary>({ passed: 0, total: 0 });
  const [opponentStats, setOpponentStats] = useState<OpponentStats>({
    name: 'Opponent',
    avatar: null,
    globalRank: 1234,
    gamesWon: 50,
    winRate: 65,
    rating: 1200,
  });
  const [userStats, setUserStats] = useState<UserStats>({
    rating: 1200,
    winRate: 0,
    totalMatches: 0,
  });
  const [userTestsPassed, setUserTestsPassed] = useState(0);
  const [opponentTestsPassed, setOpponentTestsPassed] = useState(0);
  const [totalTests, setTotalTests] = useState(0);
  const [showResultAnimation, setShowResultAnimation] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [ratingChanges, setRatingChanges] = useState<RatingChanges | null>(null);
  const [showGuestSignUpModal, setShowGuestSignUpModal] = useState(false);
  const [matchInitReceived, setMatchInitReceived] = useState(false);
  const loadMatchDataRef = useRef<boolean>(false); // Prevent duplicate loads
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadedMatchIdRef = useRef<string | null>(null); // Track which matchId we've successfully loaded
  const retryCountRef = useRef<number>(0); // Track retry count in ref to avoid state updates triggering re-renders
  const [submissionResult, setSubmissionResult] = useState<FormattedSubmission | null>(null);
  const [submissionStep, setSubmissionStep] = useState<SubmissionStepType | null>(null);
  // roomRef defined at top of component (line 64)
  const matchupAnimationShownRef = useRef(false);
  const joinFailedRef = useRef<boolean>(false); // Track if join has failed to prevent infinite retries

  // Navigation handlers
  const handleBackToHome = () => {
    window.location.href = '/play';
  };

  const handleJoinQueue = () => {
    window.location.href = '/queue';
  };

  // Memoize the effect key to prevent unnecessary re-runs
  const effectKey = useMemo(() => `${matchId}-${userId}-${connected}-${matchInitReceived}`, [matchId, userId, connected, matchInitReceived]);
  const lastEffectKeyRef = useRef<string | null>(null);
  
  // Separate effect to load match data (runs even with cached room)
  useEffect(() => {
    // Check if effect key actually changed
    if (lastEffectKeyRef.current === effectKey) {
      // Effect key hasn't changed, skip
      return;
    }
    
    // Update last effect key
    lastEffectKeyRef.current = effectKey;
    
    // Cleanup any pending retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    // For guests, sync matchId from guestMatchData if needed
    if (isGuest && guestMatchId && guestMatchId !== matchId) {
      setMatchId(guestMatchId);
      retryCountRef.current = 0; // Reset retry count when matchId changes
      return; // Will re-run after matchId is set
    }
    
    if (!matchId && !isGuest) {
      return;
    }
    
    // Reset retry count if matchId changed
    if (loadedMatchIdRef.current && loadedMatchIdRef.current !== matchId) {
      retryCountRef.current = 0;
    }
    
    // For guests, wait for match_init before loading data
    if (isGuest && !matchInitReceived) {
      return;
    }
    
    if (!connected && !isGuest) {
      return;
    }
    
    // If we've already successfully loaded this matchId, don't reload
    if (loadedMatchIdRef.current === matchId && matchId) {
      return;
    }
    
    // Prevent duplicate loads
    if (loadMatchDataRef.current) {
      return;
    }
    
    // Guests follow the same flow as regular users
    
    console.log('Loading match data for matchId:', matchId);
    
    if (matchId) {
      loadMatchData({
        matchId,
        userId,
        isGuest,
        language,
        roomRef,
        onProblemLoaded: setProblem,
        onOpponentStatsLoaded: setOpponentStats,
        onUserStatsLoaded: setUserStats,
        onCodeLoaded: setCode,
        onSubmissionsLoaded: setSubmissions,
        onUserTestsPassed: setUserTestsPassed,
        onOpponentTestsPassed: setOpponentTestsPassed,
        onTotalTests: setTotalTests,
        onLoadingChange: setLoading,
        onMatchupAnimation: setShowMatchupAnimation,
        matchupAnimationShownRef,
        retryCountRef,
        retryTimeoutRef,
        loadMatchDataRef,
        loadedMatchIdRef,
      });
    }
    
    // Cleanup function
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      // Don't reset loadMatchDataRef here - let it stay true if load is in progress
      // Only reset if we're actually changing matchId
      if (matchId && loadedMatchIdRef.current !== matchId) {
        loadMatchDataRef.current = false;
      }
    };
    // Only depend on effectKey which is memoized from the actual dependencies
    // This prevents re-runs when dependencies haven't actually changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectKey]);

  useEffect(() => {
    // If join has failed, don't retry
    if (joinFailedRef.current) {
      return;
    }
    
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
    
    const setupRoomMessageHandlers = (room: Room) => {
      console.log('Setting up message handlers for room:', room.id, 'isGuest:', isGuest);
      setupRoomHandlers(room, {
        userId,
        isGuest,
        language,
        onCodeUpdate: () => {},
        onMatchInit: () => {},
        onNewSubmission: () => {},
        onTestSubmissionResult: () => {},
        onSubmissionResult: () => {},
        onMatchWinner: () => {},
        onMatchDraw: () => {},
        onComplexityFailed: () => {},
        onTestProgressUpdate: () => {},
        onRateLimit: () => {},
        onKicked: () => {},
        setOpponentLines,
        setLines,
        setUserTestsPassed,
        setOpponentTestsPassed,
        setSubmissions,
        setActiveTab,
        setTestCaseResults,
        setSubmissionResult,
        setIsRunning,
        setIsSubmitting,
        setRunPage,
        setMatchResult,
        setRatingChanges,
        setShowResultAnimation,
        setShowGuestSignUpModal,
        setLatestSubmissionResult,
        setShowSubmissionResultPopup,
        setMatchInitReceived,
        setMatchStartTime,
        setShowMatchupAnimation,
        matchupAnimationShownRef,
        setSubmissionStep,
      });
    };

    const doJoin = async (): Promise<Room> => {
      try {
        const room = await connectToMatchRoom({
          userId,
          isGuest,
          guestMatchData,
          onMatchIdSet: (matchIdValue) => {
            setMatchId(matchIdValue);
            // Store matchId on room for later access
            if (roomRef.current) {
              (roomRef.current as unknown as { matchId?: string }).matchId = matchIdValue;
            }
          },
          onConnected: setConnected,
        });
        
        roomRef.current = room;
        joinFailedRef.current = false; // Reset failure flag on success
        console.log('Room connected, setting up message handlers for guest:', isGuest);
        return room;
      } catch (error) {
        console.error('Error in doJoin:', error);
        joinFailedRef.current = true; // Mark as failed to prevent retries
        joinPromiseRef.current = null;
        roomRef.current = null;
        setConnected(false);
        
        // Check if it's an "already full" error - connectToMatchRoom will redirect
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('already full')) {
          // connectToMatchRoom already handles redirect, just mark as failed
          return Promise.reject(error);
        }
        
        throw error;
      }
    };
    
    // Start the join process with ref-based promise
    joinPromiseRef.current = doJoin();
    joinPromiseRef.current.then(room => {
      // Set up message handlers for both guest and regular users
      setupRoomMessageHandlers(room);
    }).catch((error) => {
      // Error is already handled in doJoin
      // If it's "already full", connectToMatchRoom will redirect
      // Otherwise, we'll show an error and prevent retries
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('already full')) {
        // Only show error if it's not "already full" (which redirects)
        console.error('Failed to join room:', error);
      }
    });
    
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
  }, [userId]); // Removed matchId from dependencies - it's set inside this effect

  useEffect(() => {
    const l = (code.match(/\n/g)?.length || 0) + (code ? 1 : 0);
    setLines(l);
  }, [code]);

  // Handle submission results and show popup
  useEffect(() => {
    if (submissionResult) {
      // Only show popup if tests didn't pass (don't show modal on win)
      if (!(submissionResult as { allPassed?: boolean }).allPassed) {
        // The payload contains the submission object directly or nested
        const submission = (submissionResult as { submission?: unknown }).submission || submissionResult;
        // Format the submission to match UI expectations
        const formatted = formatSubmission(submission);
        setLatestSubmissionResult(formatted);
        setShowSubmissionResultPopup(true);
      }
    }
  }, [submissionResult, language]);

  const handleCodeChange = (value: string | undefined) => {
    const newCode = value || '';
    setCode(newCode);
    const newLines = (newCode.match(/\n/g)?.length || 0) + (newCode ? 1 : 0);
    
    if (roomRef.current) {
      console.log('Sending update_code with lines:', newLines);
      roomRef.current.send('update_code', { userId, language, code: newCode, lines: newLines });
    }
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
    setRunPage(true); // Show the run window
    roomRef.current.send('test_submit_code', { userId, language, source_code: code });
  };

  const handleSubmitClick = () => {
    console.log('[MatchClient] handleSubmitClick called');
    
    if (!roomRef.current) {
      toast.error('Not connected to match room');
      return;
    }
    
    // Check if room is actually connected
    const connection = roomRef.current.connection;
    if (!connected || !connection?.isOpen) {
      toast.error('Room not connected. Please refresh the page.');
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
    
    console.log('[MatchClient] Setting isSubmitting to true');
    setIsSubmitting(true);
    setSubmissionStep(null); // Reset step
    
    // Set a timeout to prevent infinite hanging
    const timeoutId = setTimeout(() => {
      console.error('Submission timeout - no response after 90 seconds');
      setIsSubmitting(false);
      setSubmissionStep(null);
      toast.error('Submission timed out. Please try again.');
    }, 90000); // 90 second timeout
    
    // Store timeout ID to clear it when we get a response
    let removeSubmissionListener: (() => void) | undefined;
    let removeComplexityListener: (() => void) | undefined;

    const clearSubmissionTimeout = () => {
      clearTimeout(timeoutId);
      setSubmissionStep(null); // Reset step on completion
      removeSubmissionListener?.();
      removeComplexityListener?.();
      removeSubmissionListener = undefined;
      removeComplexityListener = undefined;
    };
    
    // Set up one-time listeners to clear timeout on response
    const submissionListener = (payload: any) => {
      if (payload.userId === userId) {
        clearSubmissionTimeout();
      }
    };
    
    const complexityListener = (payload: any) => {
      if (payload.userId === userId) {
        clearSubmissionTimeout();
      }
    };
    
    try {
      console.log('Sending submit_code message:', { userId, language, codeLength: code.length });
      
      // Set up listeners before sending
      removeSubmissionListener = roomRef.current.onMessage('submission_result', submissionListener);
      removeComplexityListener = roomRef.current.onMessage('complexity_failed', complexityListener);
      
      roomRef.current.send('submit_code', { userId, language, source_code: code });
    } catch (error) {
      console.error('Error sending submit_code:', error);
      clearSubmissionTimeout();
      setIsSubmitting(false);
      toast.error('Failed to send submission. Please try again.');
    }
  };


  if (loading || !matchStartTime || !problem || !opponentStats.username) {
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
      <MatchStatsHeader
        username={username}
        userAvatar={userAvatar}
        userStats={userStats}
        userTestsPassed={userTestsPassed}
        totalTests={totalTests}
        lines={lines}
        opponentStats={opponentStats}
        opponentTestsPassed={opponentTestsPassed}
        opponentLines={opponentLines}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-row min-h-0">
        <ResizablePanelGroup direction="horizontal" className="flex-1 relative z-10 min-h-0">
        <ResizablePanel defaultSize={45} minSize={35}>
          {problem ? (
            <ProblemDescriptionPanel
              problem={problem}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              submissions={submissions}
              onSubmissionClick={setSelectedSubmission}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-black/70 bg-blue-50">
              Loading problem...
            </div>
          )}
        </ResizablePanel>
        
        <ResizableHandle className="w-1 bg-gray-200 hover:bg-gray-300 transition-colors" />
        
        <ResizablePanel className="h-full" defaultSize={55} minSize={35}>
          <CodeEditorPanel
            language={language}
            code={code}
            onLanguageChange={handleLanguageChange}
            onCodeChange={handleCodeChange}
            onRunClick={handleRunClick}
            onSubmitClick={handleSubmitClick}
            isRunning={isRunning}
            isSubmitting={isSubmitting}
            testSummary={testSummary}
            onViewDetailsClick={() => setRunPage(true)}
            matchStartTime={matchStartTime}
            matchId={matchId}
            problem={problem}
          />
        </ResizablePanel>
        </ResizablePanelGroup>
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
      <SubmissionModal
        submission={selectedSubmission!}
        isOpen={!!selectedSubmission}
        onClose={() => setSelectedSubmission(null)}
        fallbackLanguage={language}
      />

      {/* Matchup Animation Overlay */}
      {showMatchupAnimation && (
        <MatchupAnimation
          player1={{
            name: username,
            username: username,
            avatar: userAvatar || null,
          }}
          player2={{
            name: opponentStats.username,
            username: opponentStats.username,
            avatar: opponentStats.avatar || null,
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
            isWinner: matchResult.winner,
            ratingChange: ratingChanges?.[userId],
          }}
          player2={{
            name: opponentStats.username,
            username: opponentStats.username,
            avatar: opponentStats.avatar || null,
            isWinner: !matchResult.winner && !matchResult.draw,
            ratingChange: ratingChanges ? ratingChanges[Object.keys(ratingChanges).find(id => id !== userId) || ''] : undefined,
          }}
          onBackToHome={handleBackToHome}
          onJoinQueue={handleJoinQueue}
        />
      )}

      {/* Guest Sign-Up Modal */}
      {showGuestSignUpModal && isGuest && (
        <GuestSignUpModal
          matchResult={matchResult}
          testsPassed={userTestsPassed}
          totalTests={totalTests}
          opponentName={opponentStats.username}
          opponentAvatar={opponentStats.avatar}
          username={username}
          userAvatar={userAvatar ?? null}
          onClose={() => setShowGuestSignUpModal(false)}
        />
      )}

      {/* Submission Result Popup */}
      <SubmissionModal
        submission={latestSubmissionResult!}
        isOpen={showSubmissionResultPopup && !!latestSubmissionResult}
        onClose={() => setShowSubmissionResultPopup(false)}
        fallbackLanguage={language}
      />

      {/* Submission Progress Modal */}
      <SubmissionProgressModal
        isOpen={isSubmitting}
        currentStep={submissionStep}
      />
    </div>
  );
}
