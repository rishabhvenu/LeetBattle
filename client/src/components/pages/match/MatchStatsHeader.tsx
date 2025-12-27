import React, { useEffect, useState, useRef } from 'react';
import { Trophy, Target, CheckCircle } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { getAvatarUrl } from '@/lib/utils';
import type { OpponentStats, UserStats } from '@/types/match';

interface MatchStatsHeaderProps {
  username: string;
  userAvatar?: string | null;
  userStats: UserStats;
  userTestsPassed: number;
  totalTests: number;
  lines: number;
  opponentStats: OpponentStats;
  opponentTestsPassed: number;
  opponentLines: number;
}

export function MatchStatsHeader({
  username,
  userAvatar,
  userStats,
  userTestsPassed,
  totalTests,
  lines,
  opponentStats,
  opponentTestsPassed,
  opponentLines,
}: MatchStatsHeaderProps) {
  const [isOpponentSolvedFlashing, setIsOpponentSolvedFlashing] = useState(false);
  const prevOpponentTestsPassed = useRef(opponentTestsPassed);

  useEffect(() => {
    if (opponentTestsPassed > prevOpponentTestsPassed.current) {
      setIsOpponentSolvedFlashing(true);
      const timer = setTimeout(() => setIsOpponentSolvedFlashing(false), 2000);
      return () => clearTimeout(timer);
    }
    prevOpponentTestsPassed.current = opponentTestsPassed;
  }, [opponentTestsPassed]);

  const renderProfilePicture = (avatar: string | null | undefined, isOpponent: boolean = false) => {
    const avatarUrl = getAvatarUrl(avatar);
    const borderColor = isOpponent ? '#ef4444' : '#2599D4';

    return (
      <Avatar className="w-10 h-10 border-2" style={{ borderColor }}>
        <AvatarImage
          src={avatarUrl || "/placeholder_avatar.png"}
          alt="Profile"
        />
        <AvatarFallback className="bg-gray-200">
          <img
            src="/placeholder_avatar.png"
            alt="Placeholder avatar"
            className="w-full h-full object-cover"
          />
        </AvatarFallback>
      </Avatar>
    );
  };

  return (
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
      <div className="flex flex-col items-center justify-center px-4">
        <span className="text-2xl font-black italic text-transparent bg-clip-text bg-gradient-to-br from-red-600 to-red-500 tracking-wider" style={{ textShadow: '0 2px 10px rgba(220, 38, 38, 0.2)' }}>
          VS
        </span>
      </div>

      {/* Opponent Stats & Info */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4 pr-4 border-r border-blue-200">
          <div className={`flex items-center gap-1.5 transition-all duration-300 ${
            isOpponentSolvedFlashing 
              ? 'scale-110 bg-green-100 px-2 py-0.5 rounded-full shadow-sm ring-2 ring-green-400' 
              : ''
          }`}>
            <CheckCircle className={`w-4 h-4 ${isOpponentSolvedFlashing ? 'text-green-700' : 'text-green-600'}`} />
            <span className={`text-xs ${isOpponentSolvedFlashing ? 'text-green-900 font-bold' : 'text-black/70'}`}>
              Solved: {opponentTestsPassed}/{totalTests}
            </span>
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
            <div className="text-sm font-semibold text-black text-right">{opponentStats.username}</div>
            <div className="text-xs text-black/70 text-right">Rating: {opponentStats.rating}</div>
          </div>
          <div className="relative">
            {renderProfilePicture(opponentStats.avatar, true)}
          </div>
        </div>
      </div>
    </div>
  );
}

