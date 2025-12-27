'use client';

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  X,
  Crown,
  Scale,
  Clock,
  Trophy,
  Target,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { MatchDetails, PlayerMatchStats } from "@/types/match";
import { getAvatarUrl } from '@/lib/utils';
// Image import removed - using regular img tags instead

interface MatchDetailsModalProps {
  matchDetails: MatchDetails;
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
}

export default function MatchDetailsModal({
  matchDetails,
  isOpen,
  onClose,
  loading,
}: MatchDetailsModalProps) {
  const [isProblemExpanded, setIsProblemExpanded] = useState(false);

  if (!isOpen) return null;

  const formatDuration = (duration: number) => {
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty.toLowerCase()) {
      case 'easy': return 'bg-green-100 text-green-600';
      case 'medium': return 'bg-yellow-100 text-yellow-600';
      case 'hard': return 'bg-red-100 text-red-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getResultIcon = (result: string) => {
    switch (result) {
      case 'win': return <Crown className="w-6 h-6 text-green-600" />;
      case 'loss': return <X className="w-6 h-6 text-red-600" />;
      case 'draw': return <Scale className="w-6 h-6 text-blue-600" />;
      default: return null;
    }
  };

  const getResultText = (result: string) => {
    switch (result) {
      case 'win': return 'Victory';
      case 'loss': return 'Defeat';
      case 'draw': return 'Draw';
      default: return 'Unknown';
    }
  };

  const getResultColor = (result: string) => {
    switch (result) {
      case 'win': return 'text-green-600';
      case 'loss': return 'text-red-600';
      case 'draw': return 'text-blue-600';
      default: return 'text-gray-600';
    }
  };

  const getMatchSummary = () => {
    const { currentUser, opponent } = matchDetails.players;
    const durationStr = formatDuration(matchDetails.duration);

    if (matchDetails.result === 'win') {
      const opponentAction = opponent?.submissionsCount === 0 
        ? "did not submit" 
        : `passed ${opponent?.testsPassed || 0}/${opponent?.totalTests || 0} tests`;
      return `You solved the problem in ${durationStr}. Your opponent ${opponentAction}.`;
    }
    
    if (matchDetails.result === 'loss') {
      const userAction = currentUser.testsPassed === currentUser.totalTests
        ? "but were slower"
        : `passed ${currentUser.testsPassed}/${currentUser.totalTests} tests`;
      return `Your opponent solved the problem in ${durationStr}. You ${userAction}.`;
    }

    return `Time ran out. You passed ${currentUser.testsPassed}/${currentUser.totalTests} tests.`;
  };

  const PlayerCard = ({ player, isCurrentUser, isWinner }: { player: PlayerMatchStats; isCurrentUser: boolean; isWinner?: boolean }) => (
    <div className={`p-6 rounded-xl border-2 transition-all duration-300 ${
      isWinner
        ? 'border-yellow-400 bg-yellow-50/80 shadow-lg scale-[1.02] relative overflow-hidden'
        : isCurrentUser 
          ? 'border-blue-200 bg-blue-50/50' 
          : 'border-gray-200 bg-gray-50/30 opacity-90'
    }`}>
      {isWinner && (
        <div className="absolute top-0 right-0 p-2">
          <Crown className="w-6 h-6 text-yellow-500 fill-yellow-500" />
        </div>
      )}
      <div className="flex items-center gap-4 mb-4">
        <Avatar className="w-16 h-16 border-4 border-white shadow-lg">
          <AvatarImage
            src={getAvatarUrl(player.avatar)}
            alt={player.username}
          />
          <AvatarFallback>
            <img 
              src="/placeholder_avatar.png"
              alt="Profile placeholder"
              width={40}
              height={40}
              className="w-full h-full object-cover"
            />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-black">{player.username}</h3>
          <div className="flex items-center gap-2 mt-1">
            <Trophy className="w-4 h-4 text-yellow-600" />
            <span className="text-sm text-black/70">
              {player.ratingBefore} → {player.ratingAfter}
              {player.ratingChange !== 0 && (
                <span className={`ml-1 font-semibold ${player.ratingChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ({player.ratingChange > 0 ? '+' : ''}{player.ratingChange})
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="text-center p-3 bg-white rounded-lg">
          <div className="text-2xl font-bold text-black">{player.submissionsCount}</div>
          <div className="text-sm text-black/70">Submissions</div>
        </div>
        <div className="text-center p-3 bg-white rounded-lg">
          <div className="text-2xl font-bold text-black">
            {player.testsPassed}/{player.totalTests}
          </div>
          <div className="text-sm text-black/70">Tests Passed</div>
        </div>
      </div>

    </div>
  );

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white w-full max-w-6xl h-[90vh] overflow-hidden rounded-lg shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
              <p className="text-black/70">Loading match details...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-white">
              <div className="flex items-center gap-5">
                <div className={`p-4 rounded-2xl ${
                  matchDetails.result === 'win' ? 'bg-green-100' :
                  matchDetails.result === 'loss' ? 'bg-red-100' : 'bg-blue-100'
                }`}>
                  {getResultIcon(matchDetails.result)}
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-black mb-1">
                    {getResultText(matchDetails.result)}
                  </h1>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full h-12 w-12"
              >
                <X className="h-8 w-8" />
              </Button>
            </div>

            {/* Modal Content */}
            <ScrollArea className="flex-1 overflow-y-auto bg-gray-50/30">
              <div className="p-8 space-y-8">
                
                {/* Player Comparison - Promoted to top */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="flex flex-col h-full">
                    <h2 className="text-sm font-bold text-black/40 uppercase tracking-wider mb-4 flex items-center gap-2 px-1">
                      You
                    </h2>
                    <PlayerCard 
                      player={matchDetails.players.currentUser} 
                      isCurrentUser={true}
                      isWinner={matchDetails.result === 'win'} 
                    />
                  </div>
                  <div className="flex flex-col h-full">
                    <h2 className="text-sm font-bold text-black/40 uppercase tracking-wider mb-4 flex items-center gap-2 px-1">
                      Opponent
                    </h2>
                    {matchDetails.players.opponent ? (
                      <PlayerCard 
                        player={matchDetails.players.opponent} 
                        isCurrentUser={false}
                        isWinner={matchDetails.result === 'loss'}
                      />
                    ) : (
                      <div className="p-8 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50 flex items-center justify-center h-full">
                        <p className="text-gray-400 font-medium">Opponent data not available</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Problem Info - Collapsible */}
                <div className="bg-white rounded-xl p-1 border border-gray-200 shadow-sm overflow-hidden">
                  <button 
                    onClick={() => setIsProblemExpanded(!isProblemExpanded)}
                    className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 font-bold">
                        <CheckCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-black">{matchDetails.problem.title}</h2>
                        <div className="flex gap-2 mt-1">
                          <Badge variant="secondary" className={`${getDifficultyColor(matchDetails.problem.difficulty)} bg-opacity-10 border-0`}>
                            {matchDetails.problem.difficulty}
                          </Badge>
                          <span className="text-sm text-gray-400 flex items-center">
                            {matchDetails.problem.topics.slice(0, 3).join(', ')}
                            {matchDetails.problem.topics.length > 3 && ` +${matchDetails.problem.topics.length - 3}`}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-blue-600">
                      {isProblemExpanded ? 'Hide Details' : 'View Problem Details'}
                      {isProblemExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>
                  
                  {isProblemExpanded && (
                    <div className="px-6 pb-6 pt-2 border-t border-gray-100">
                      <div className="prose prose-sm max-w-none text-gray-600">
                        <p className="whitespace-pre-wrap font-sans text-base leading-relaxed">
                          {matchDetails.problem.description}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Match Metadata */}
                <div className="flex items-center justify-center gap-8 py-4 text-sm text-gray-400 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>Duration: {formatDuration(matchDetails.duration)}</span>
                  </div>
                  <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    <span>{formatDateTime(matchDetails.startedAt)}</span>
                  </div>
                  <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                  <span>ID: {matchDetails.matchId.slice(0, 8)}...</span>
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
}
