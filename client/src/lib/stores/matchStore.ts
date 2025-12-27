/**
 * Zustand store for Match Client state management
 * Replaces 40+ useState hooks with centralized state
 */

import { create } from 'zustand';
import { Room } from 'colyseus.js';
import type {
  Problem,
  OpponentStats,
  UserStats,
  MatchResult,
  RatingChanges,
  TestSummary,
  FormattedSubmission,
} from '@/types/match';
import { TestCaseResult } from '@/components/Running';

interface MatchState {
  // Connection state
  room: Room | null;
  connected: boolean;
  loading: boolean;
  matchInitReceived: boolean;
  
  // Match info
  matchId: string | null;
  matchStartTime: number | null;
  problem: Problem | null;
  
  // Code editor state
  language: string;
  code: string;
  lines: number;
  
  // Opponent state
  opponentLines: number;
  opponentStats: OpponentStats;
  opponentTestsPassed: number;
  
  // User state
  userStats: UserStats;
  userTestsPassed: number;
  
  // Test execution state
  runPage: boolean;
  isRunning: boolean;
  isSubmitting: boolean;
  testCaseResults: TestCaseResult[];
  testSummary: TestSummary;
  totalTests: number;
  
  // Submissions
  submissions: FormattedSubmission[];
  selectedSubmission: FormattedSubmission | null;
  latestSubmissionResult: FormattedSubmission | null;
  showSubmissionResultPopup: boolean;
  
  // UI state
  activeTab: string;
  showMatchupAnimation: boolean;
  showResultAnimation: boolean;
  showGuestSignUpModal: boolean;
  
  // Match result
  matchResult: MatchResult | null;
  ratingChanges: RatingChanges | null;
  
  // Actions
  setRoom: (room: Room | null) => void;
  setConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setMatchInitReceived: (received: boolean) => void;
  
  setMatchId: (matchId: string | null) => void;
  setMatchStartTime: (time: number | null) => void;
  setProblem: (problem: Problem | null) => void;
  
  setLanguage: (language: string) => void;
  setCode: (code: string) => void;
  setLines: (lines: number) => void;
  
  setOpponentLines: (lines: number) => void;
  setOpponentStats: (stats: OpponentStats) => void;
  setOpponentTestsPassed: (count: number) => void;
  
  setUserStats: (stats: UserStats) => void;
  setUserTestsPassed: (count: number) => void;
  
  setRunPage: (show: boolean) => void;
  setIsRunning: (running: boolean) => void;
  setIsSubmitting: (submitting: boolean) => void;
  setTestCaseResults: (results: TestCaseResult[]) => void;
  setTestSummary: (summary: TestSummary) => void;
  setTotalTests: (count: number) => void;
  
  setSubmissions: (submissions: FormattedSubmission[]) => void;
  addSubmission: (submission: FormattedSubmission) => void;
  setSelectedSubmission: (submission: FormattedSubmission | null) => void;
  setLatestSubmissionResult: (result: FormattedSubmission | null) => void;
  setShowSubmissionResultPopup: (show: boolean) => void;
  
  setActiveTab: (tab: string) => void;
  setShowMatchupAnimation: (show: boolean) => void;
  setShowResultAnimation: (show: boolean) => void;
  setShowGuestSignUpModal: (show: boolean) => void;
  
  setMatchResult: (result: MatchResult | null) => void;
  setRatingChanges: (changes: RatingChanges | null) => void;
  
  // Reset function for cleanup
  reset: () => void;
}

const initialState = {
  // Connection state
  room: null,
  connected: false,
  loading: true,
  matchInitReceived: false,
  
  // Match info
  matchId: null,
  matchStartTime: null,
  problem: null,
  
  // Code editor state
  language: typeof window !== 'undefined' 
    ? (localStorage.getItem('preferred-language') || 'javascript')
    : 'javascript',
  code: '',
  lines: 0,
  
  // Opponent state
  opponentLines: 0,
  opponentStats: {
    name: 'Opponent',
    avatar: null,
    globalRank: 1234,
    gamesWon: 50,
    winRate: 65,
    rating: 1200,
  },
  opponentTestsPassed: 0,
  
  // User state
  userStats: {
    rating: 1200,
    winRate: 0,
    totalMatches: 0,
  },
  userTestsPassed: 0,
  
  // Test execution state
  runPage: false,
  isRunning: false,
  isSubmitting: false,
  testCaseResults: [],
  testSummary: { passed: 0, total: 0 },
  totalTests: 0,
  
  // Submissions
  submissions: [],
  selectedSubmission: null,
  latestSubmissionResult: null,
  showSubmissionResultPopup: false,
  
  // UI state
  activeTab: 'description',
  showMatchupAnimation: false,
  showResultAnimation: false,
  showGuestSignUpModal: false,
  
  // Match result
  matchResult: null,
  ratingChanges: null,
};

export const useMatchStore = create<MatchState>((set) => ({
  ...initialState,
  
  // Connection actions
  setRoom: (room) => set({ room }),
  setConnected: (connected) => set({ connected }),
  setLoading: (loading) => set({ loading }),
  setMatchInitReceived: (matchInitReceived) => set({ matchInitReceived }),
  
  // Match info actions
  setMatchId: (matchId) => set({ matchId }),
  setMatchStartTime: (matchStartTime) => set({ matchStartTime }),
  setProblem: (problem) => set({ problem }),
  
  // Code editor actions
  setLanguage: (language) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferred-language', language);
    }
    set({ language });
  },
  setCode: (code) => set({ code }),
  setLines: (lines) => set({ lines }),
  
  // Opponent actions
  setOpponentLines: (opponentLines) => set({ opponentLines }),
  setOpponentStats: (opponentStats) => set({ opponentStats }),
  setOpponentTestsPassed: (opponentTestsPassed) => set({ opponentTestsPassed }),
  
  // User actions
  setUserStats: (userStats) => set({ userStats }),
  setUserTestsPassed: (userTestsPassed) => set({ userTestsPassed }),
  
  // Test execution actions
  setRunPage: (runPage) => set({ runPage }),
  setIsRunning: (isRunning) => set({ isRunning }),
  setIsSubmitting: (isSubmitting) => set({ isSubmitting }),
  setTestCaseResults: (testCaseResults) => set({ testCaseResults }),
  setTestSummary: (testSummary) => set({ testSummary }),
  setTotalTests: (totalTests) => set({ totalTests }),
  
  // Submission actions
  setSubmissions: (submissions) => set({ submissions }),
  addSubmission: (submission) => set((state) => ({
    submissions: [submission, ...state.submissions]
  })),
  setSelectedSubmission: (selectedSubmission) => set({ selectedSubmission }),
  setLatestSubmissionResult: (latestSubmissionResult) => set({ latestSubmissionResult }),
  setShowSubmissionResultPopup: (showSubmissionResultPopup) => set({ showSubmissionResultPopup }),
  
  // UI actions
  setActiveTab: (activeTab) => set({ activeTab }),
  setShowMatchupAnimation: (showMatchupAnimation) => set({ showMatchupAnimation }),
  setShowResultAnimation: (showResultAnimation) => set({ showResultAnimation }),
  setShowGuestSignUpModal: (showGuestSignUpModal) => set({ showGuestSignUpModal }),
  
  // Match result actions
  setMatchResult: (matchResult) => set({ matchResult }),
  setRatingChanges: (ratingChanges) => set({ ratingChanges }),
  
  // Reset action
  reset: () => set(initialState),
}));

// Selectors for commonly used state combinations
export const useMatchConnection = () => useMatchStore((state) => ({
  room: state.room,
  connected: state.connected,
  loading: state.loading,
  matchInitReceived: state.matchInitReceived,
}));

export const useMatchInfo = () => useMatchStore((state) => ({
  matchId: state.matchId,
  matchStartTime: state.matchStartTime,
  problem: state.problem,
}));

export const useCodeEditor = () => useMatchStore((state) => ({
  language: state.language,
  code: state.code,
  lines: state.lines,
  setLanguage: state.setLanguage,
  setCode: state.setCode,
  setLines: state.setLines,
}));

export const useMatchStats = () => useMatchStore((state) => ({
  userStats: state.userStats,
  opponentStats: state.opponentStats,
  userTestsPassed: state.userTestsPassed,
  opponentTestsPassed: state.opponentTestsPassed,
  totalTests: state.totalTests,
}));

export const useTestExecution = () => useMatchStore((state) => ({
  runPage: state.runPage,
  isRunning: state.isRunning,
  isSubmitting: state.isSubmitting,
  testCaseResults: state.testCaseResults,
  testSummary: state.testSummary,
}));

export const useSubmissions = () => useMatchStore((state) => ({
  submissions: state.submissions,
  selectedSubmission: state.selectedSubmission,
  latestSubmissionResult: state.latestSubmissionResult,
  showSubmissionResultPopup: state.showSubmissionResultPopup,
}));

