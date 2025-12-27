import React from 'react';
import { getMatchData } from '@/lib/actions';
import { formatSubmission } from './submissionFormatter';
import type { Problem, OpponentStats, UserStats, FormattedSubmission } from '@/types/match';
import { Room } from 'colyseus.js';
import { toast } from 'react-toastify';

interface MatchDataLoaderConfig {
  matchId: string;
  userId: string;
  isGuest: boolean;
  language: string;
  roomRef: React.MutableRefObject<Room | null>;
  onProblemLoaded: (problem: Problem) => void;
  onOpponentStatsLoaded: (stats: OpponentStats) => void;
  onUserStatsLoaded: (stats: UserStats) => void;
  onCodeLoaded: (code: string) => void;
  onSubmissionsLoaded: (submissions: FormattedSubmission[]) => void;
  onUserTestsPassed: (count: number) => void;
  onOpponentTestsPassed: (count: number) => void;
  onTotalTests: (count: number) => void;
  onLoadingChange: (loading: boolean) => void;
  onMatchupAnimation: (show: boolean) => void;
  matchupAnimationShownRef: React.MutableRefObject<boolean>;
  retryCountRef: React.MutableRefObject<number>;
  retryTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  loadMatchDataRef: React.MutableRefObject<boolean>;
  loadedMatchIdRef: React.MutableRefObject<string | null>;
}

export async function loadMatchData(config: MatchDataLoaderConfig): Promise<void> {
  const {
    matchId,
    userId,
    isGuest,
    language,
    roomRef,
    onProblemLoaded,
    onOpponentStatsLoaded,
    onUserStatsLoaded,
    onCodeLoaded,
    onSubmissionsLoaded,
    onUserTestsPassed,
    onOpponentTestsPassed,
    onTotalTests,
    onLoadingChange,
    onMatchupAnimation,
    matchupAnimationShownRef,
    retryCountRef,
    retryTimeoutRef,
    loadMatchDataRef,
    loadedMatchIdRef,
  } = config;

  if (loadMatchDataRef.current) {
    return;
  }
  loadMatchDataRef.current = true;

  try {
    const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;

    if (!matchId) {
      loadMatchDataRef.current = false;
      return;
    }

    const matchDataResult = await getMatchData(matchId, userId);

    if (!matchDataResult.success) {
      console.error('Failed to load match data:', matchDataResult.error);

      if (matchDataResult.error === 'match_not_found' && roomRef.current && retryCountRef.current < 5) {
        retryCountRef.current = retryCountRef.current + 1;
        const currentRetry = retryCountRef.current;
        console.log(`Match data not ready yet, retrying in 3000ms... (attempt ${currentRetry}/5)`);

        loadMatchDataRef.current = false;

        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }

        retryTimeoutRef.current = setTimeout(() => {
          if (retryCountRef.current <= 5 && roomRef.current && loadedMatchIdRef.current !== matchId && !loadMatchDataRef.current) {
            // Recursively call loadMatchData with the same config
            loadMatchData(config).catch(err => {
              console.error('Error in retry loadMatchData:', err);
              loadMatchDataRef.current = false;
            });
          } else {
            loadMatchDataRef.current = false;
            console.log('Retry cancelled - conditions no longer met');
          }
        }, 3000);
      } else {
        loadMatchDataRef.current = false;
        console.log('Stopping match data load - max retries reached or match not found');
        if (loadedMatchIdRef.current !== matchId) {
          if (userId) {
            await fetch(`${base}/queue/clear`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ userId })
            });
          }
          toast.error('Match no longer exists. Redirecting to queue...');
          setTimeout(() => {
            window.location.href = '/queue';
          }, 2000);
        }
      }
      return;
    }

    retryCountRef.current = 0;
    loadMatchDataRef.current = false;
    loadedMatchIdRef.current = matchId;

    if (matchDataResult.problem) {
      onProblemLoaded(matchDataResult.problem);
      if (matchDataResult.problem.testCasesCount) {
        onTotalTests(matchDataResult.problem.testCasesCount);
      }
    }

    if (matchDataResult.opponent) {
      onOpponentStatsLoaded({
        name: matchDataResult.opponent.name,
        username: matchDataResult.opponent.username,
        avatar: matchDataResult.opponent.avatar,
        globalRank: matchDataResult.opponent.globalRank,
        gamesWon: matchDataResult.opponent.gamesWon,
        winRate: matchDataResult.opponent.winRate,
        rating: matchDataResult.opponent.rating,
      });
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }

    if (matchDataResult.userStats) {
      onUserStatsLoaded({
        rating: matchDataResult.userStats.rating || 1200,
        winRate: matchDataResult.userStats.winRate || 0,
        totalMatches: matchDataResult.userStats.totalMatches || 0,
      });
    }

    const snapResp = await fetch(`${base}/match/snapshot?matchId=${encodeURIComponent(matchId)}`);
    if (snapResp.ok) {
      const snap = await snapResp.json();
      const myCodeByLang = snap.playersCode?.[userId] || {};
      if (myCodeByLang[language] && myCodeByLang[language].trim().length > 0) {
        onCodeLoaded(myCodeByLang[language]);
      } else if (matchDataResult.problem?.starterCode?.[language]) {
        onCodeLoaded(matchDataResult.problem.starterCode[language]);
      }

      if (snap.submissions && Array.isArray(snap.submissions)) {
        const userSubmissions = snap.submissions
          .filter((s: unknown) => (s as { userId: string }).userId === userId)
          .map((s: unknown) => formatSubmission(s))
          .sort((a: unknown, b: unknown) => new Date((b as { timestamp: string }).timestamp).getTime() - new Date((a as { timestamp: string }).timestamp).getTime());
        onSubmissionsLoaded(userSubmissions);

        const allSubmissions = snap.submissions || [];
        const userBest = allSubmissions
          .filter((s: unknown) => (s as { userId: string }).userId === userId)
          .reduce((max: unknown, s: unknown) => {
            const submission = s as { testResults?: Array<{ status: number }> };
            const maxSub = max as { testResults?: Array<{ status: number }> } | null;
            const passed = submission.testResults?.filter((t) => t.status === 3).length || 0;
            const maxPassed = maxSub?.testResults?.filter((t) => t.status === 3).length || 0;
            return passed > maxPassed ? s : max;
          }, null);

        const opponentBest = allSubmissions
          .filter((s: unknown) => (s as { userId: string }).userId !== userId)
          .reduce((max: unknown, s: unknown) => {
            const submission = s as { testResults?: Array<{ status: number }> };
            const maxSub = max as { testResults?: Array<{ status: number }> } | null;
            const passed = submission.testResults?.filter((t) => t.status === 3).length || 0;
            const maxPassed = maxSub?.testResults?.filter((t) => t.status === 3).length || 0;
            return passed > maxPassed ? s : max;
          }, null);

        if (userBest) {
          const bestSub = userBest as { testResults?: Array<{ status: number }> };
          const passed = bestSub.testResults?.filter((t) => t.status === 3).length || 0;
          onUserTestsPassed(passed);
        }

        if (opponentBest) {
          const bestOpponentSub = opponentBest as { testResults?: Array<{ status: number }> };
          const passed = bestOpponentSub.testResults?.filter((t) => t.status === 3).length || 0;
          onOpponentTestsPassed(passed);
        }
      }
    }

    await new Promise(resolve => setTimeout(resolve, 50));
    onLoadingChange(false);
    if (!matchupAnimationShownRef.current) {
      onMatchupAnimation(true);
      matchupAnimationShownRef.current = true;
    }
  } catch (err) {
    console.error('Error loading match data:', err);
    onLoadingChange(false);
    loadMatchDataRef.current = false;
  }
}

