'use client';

import React from 'react';
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
} from "lucide-react";
import { MatchDetails } from "@/types/match";
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

  const PlayerCard = ({ player, isCurrentUser }: { player: any; isCurrentUser: boolean }) => (
    <div className={`p-6 rounded-lg border-2 ${
      isCurrentUser 
        ? 'border-blue-200 bg-blue-50/50' 
        : 'border-gray-200 bg-gray-50/50'
    }`}>
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
                <span className={`ml-2 ${player.ratingChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
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
            <div className="p-6 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${getResultColor(matchDetails.result)} bg-opacity-20`}>
                  {getResultIcon(matchDetails.result)}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-black">
                    {getResultText(matchDetails.result)}
                  </h1>
                  <p className="text-gray-600">
                    {matchDetails.problem.title}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Modal Content */}
            <ScrollArea className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-6">
                {/* Problem Info */}
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <h2 className="text-lg font-semibold text-black mb-3">Problem Details</h2>
                  <div className="flex items-center gap-4 mb-3">
                    <Badge className={`${getDifficultyColor(matchDetails.problem.difficulty)}`}>
                      {matchDetails.problem.difficulty}
                    </Badge>
                    <div className="flex gap-2">
                      {matchDetails.problem.topics.map((topic, index) => (
                        <Badge key={index} variant="outline" className="text-gray-600">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed">
                    {matchDetails.problem.description}
                  </p>
                </div>

                {/* Match Info */}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <h2 className="text-lg font-semibold text-black mb-3">Match Information</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-600" />
                      <span className="text-sm text-black/70">Duration: {formatDuration(matchDetails.duration)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-black/70">Started: {formatDateTime(matchDetails.startedAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Player Comparison */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
                      <span className="w-3 h-3 bg-blue-600 rounded-full"></span>
                      You
                    </h2>
                    <PlayerCard player={matchDetails.players.currentUser} isCurrentUser={true} />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
                      <span className="w-3 h-3 bg-gray-600 rounded-full"></span>
                      {matchDetails.players.opponent?.username || 'Unknown Player'}
                    </h2>
                    {matchDetails.players.opponent ? (
                      <PlayerCard player={matchDetails.players.opponent} isCurrentUser={false} />
                    ) : (
                      <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                        <p className="text-gray-500 text-center">Opponent data not available</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Match ID */}
                <div className="text-center pt-4 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    Match ID: {matchDetails.matchId}
                  </p>
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
}
