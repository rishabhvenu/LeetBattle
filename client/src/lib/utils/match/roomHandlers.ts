import React from 'react';
import { Room } from 'colyseus.js';
import { toast } from 'react-toastify';
import { formatSubmission } from './submissionFormatter';
import type { TestCaseResult } from '@/components/Running';
import type { FormattedSubmission, MatchResult, RatingChanges, SubmissionStepType } from '@/types/match';

interface RoomHandlersConfig {
  userId: string;
  isGuest: boolean;
  language: string;
  onCodeUpdate: (lines: number) => void;
  onMatchInit: (payload: {
    startedAt?: string;
    linesWritten?: Record<string, number>;
  }) => void;
  onNewSubmission: (submission: FormattedSubmission, passed: number) => void;
  onTestSubmissionResult: (results: TestCaseResult[], passed: number) => void;
  onSubmissionResult: (result: unknown) => void;
  onMatchWinner: (result: MatchResult, ratingChanges: RatingChanges | null) => void;
  onMatchDraw: (result: MatchResult, ratingChanges: RatingChanges | null) => void;
  onComplexityFailed: (result: FormattedSubmission) => void;
  onTestProgressUpdate: (testsPassed: number) => void;
  onRateLimit: (action: string) => void;
  onKicked: () => void;
  setOpponentLines: (lines: number) => void;
  setLines: (lines: number) => void;
  setUserTestsPassed: (count: number) => void;
  setOpponentTestsPassed: (count: number) => void;
  setSubmissions: React.Dispatch<React.SetStateAction<FormattedSubmission[]>>;
  setActiveTab: (tab: string) => void;
  setTestCaseResults: (results: TestCaseResult[]) => void;
  setSubmissionResult: (result: FormattedSubmission | null) => void;
  setIsRunning: (running: boolean) => void;
  setIsSubmitting: (submitting: boolean) => void;
  setRunPage: (show: boolean) => void;
  setMatchResult: (result: MatchResult) => void;
  setRatingChanges: (changes: RatingChanges | null) => void;
  setShowResultAnimation: (show: boolean) => void;
  setShowGuestSignUpModal: (show: boolean) => void;
  setLatestSubmissionResult: (result: FormattedSubmission) => void;
  setShowSubmissionResultPopup: (show: boolean) => void;
  setMatchInitReceived: (received: boolean) => void;
  setMatchStartTime: (time: number | null) => void;
  setShowMatchupAnimation: (show: boolean) => void;
  matchupAnimationShownRef: React.MutableRefObject<boolean>;
  setSubmissionStep: (step: SubmissionStepType | null) => void;
}

export function setupRoomMessageHandlers(room: Room, config: RoomHandlersConfig) {
  const {
    userId,
    isGuest,
    language,
    onCodeUpdate,
    onMatchInit,
    onNewSubmission,
    onTestSubmissionResult,
    onSubmissionResult,
    onMatchWinner,
    onMatchDraw,
    onComplexityFailed,
    onTestProgressUpdate,
    onRateLimit,
    onKicked,
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
  } = config;

  room.onMessage('code_update', (payload) => {
    if (payload?.userId && payload.userId !== userId) {
      setOpponentLines(payload.lines || 0);
    }
  });

  room.onMessage('kicked', () => {
    toast.error('You were disconnected: another connection detected.');
    try { room.leave(); } catch {}
    onKicked();
  });

  room.onMessage('match_init', (payload) => {
    if (isGuest) {
      setMatchInitReceived(true);
    }

    if (payload.startedAt) {
      const startTime = new Date(payload.startedAt).getTime();
      setMatchStartTime(startTime);

      if (!matchupAnimationShownRef.current) {
        setShowMatchupAnimation(true);
        matchupAnimationShownRef.current = true;
      }
    }

    if (payload.linesWritten) {
      setLines(payload.linesWritten[userId] || 0);
      const otherUserId = Object.keys(payload.linesWritten).find((u: string) => u !== userId);
      if (otherUserId) {
        setOpponentLines(payload.linesWritten[otherUserId] || 0);
      }
    }

    onMatchInit(payload);
  });

  room.onMessage('new_submission', (payload) => {
    const passed = payload.submission.testResults?.filter((t: TestCaseResult) => t.status === 3).length || 0;

    if (payload.userId === userId) {
      const formattedSubmission = formatSubmission(payload.submission);
      const submissionId = formattedSubmission.id;
      setSubmissions(prev => {
        if (!submissionId) return prev;
        const next = prev.filter((existing) => existing.id !== submissionId);
        return [formattedSubmission, ...next];
      });
      setActiveTab('submissions');
      setUserTestsPassed(passed);
      onNewSubmission(formattedSubmission, passed);
      return;
    }

    setOpponentTestsPassed(passed);
  });

  room.onMessage('rate_limit', ({ action }) => {
    const msg = action === 'submit_code' ? 'Too many submits. Slow down.' : 'Too many test runs.';
    toast.info(msg);
    onRateLimit(action);
  });

  room.onMessage('match_winner', (payload) => {
    const isWinner = payload.userId === userId;
    const result = { winner: isWinner, draw: false };
    setMatchResult(result);
    setRatingChanges(payload.ratingChanges || null);
    setRunPage(false);

    if (isGuest) {
      setTimeout(() => setShowGuestSignUpModal(true), 2000);
    } else {
      setShowResultAnimation(true);
    }

    onMatchWinner(result, payload.ratingChanges || null);
  });

  room.onMessage('match_draw', (payload) => {
    const result = { winner: false, draw: true };
    setMatchResult(result);
    setRatingChanges(payload.ratingChanges || null);
    setRunPage(false);

    if (isGuest) {
      setTimeout(() => setShowGuestSignUpModal(true), 2000);
    } else {
      setShowResultAnimation(true);
    }

    onMatchDraw(result, payload.ratingChanges || null);
  });

  room.onMessage('test_submission_result', (payload) => {
    setIsRunning(false);
    if (payload.userId === userId) {
      setTestCaseResults(payload.testResults);
      const passed = payload.testResults?.filter((t: TestCaseResult) => t.status === 3).length || 0;
      setUserTestsPassed(passed);
      onTestSubmissionResult(payload.testResults, passed);
    } else {
      const passed = payload.testResults?.filter((t: TestCaseResult) => t.status === 3).length || 0;
      setOpponentTestsPassed(passed);
    }
  });

  room.onMessage('submission_result', (payload) => {
    setIsSubmitting(false);
    if (payload.userId === userId) {
      setSubmissionResult(payload);
      setRunPage(false);
      onSubmissionResult(payload);
    }
  });

  room.onMessage('complexity_failed', (payload) => {
    if (payload.userId === userId) {
      setIsSubmitting(false);
      const complexityFailureResult = {
        ...payload,
        allPassed: false,
        errorType: 'complexity',
        complexityError: 'All tests passed, but your solution does not meet the required time complexity.',
        expectedComplexity: payload.expectedComplexity,
        timeComplexity: payload.derivedComplexity,
        language: payload.language || language
      } as FormattedSubmission;
      setLatestSubmissionResult(complexityFailureResult);
      setShowSubmissionResultPopup(true);
      setRunPage(false);
      onComplexityFailed(complexityFailureResult);
    }
  });

  room.onMessage('test_progress_update', (payload) => {
    if (payload?.userId && payload.userId !== userId) {
      setOpponentTestsPassed(payload.testsPassed || 0);
      onTestProgressUpdate(payload.testsPassed || 0);
    }
  });

  room.onMessage('submission_step', (payload) => {
    console.log('[roomHandlers] submission_step received:', payload);
    if (payload?.userId === userId) {
      console.log('[roomHandlers] Setting step to:', payload.step);
      setSubmissionStep(payload.step);
    } else {
      console.log('[roomHandlers] Ignoring submission_step for different user:', payload?.userId, 'my userId:', userId);
    }
  });
}

