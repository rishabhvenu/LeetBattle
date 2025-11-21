import React from 'react';
import { Clock, Gamepad2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import CountdownTimer from '@/components/CountdownTimer';
import type { Problem } from '@/types/match';

interface MatchFooterProps {
  matchStartTime: number | null;
  matchId: string | null;
  problem: Problem | null;
}

export function MatchFooter({ matchStartTime, matchId, problem }: MatchFooterProps) {
  return (
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
  );
}

