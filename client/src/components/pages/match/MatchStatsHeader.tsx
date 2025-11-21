import React from 'react';
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
  );
}

