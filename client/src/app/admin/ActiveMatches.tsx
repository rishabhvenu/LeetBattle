// @ts-nocheck
'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'react-toastify';
import { getAvatarUrl } from '@/lib/utils';
import { getActiveMatches } from '@/lib/actions';
import { Clock, Users, Bot, Trophy, Timer, Eye } from 'lucide-react';

interface ActiveMatch {
  matchId: string;
  problemId: string;
  problemTitle: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  players: Array<{
    userId: string;
    username: string;
    isBot?: boolean;
    rating?: number;
    linesWritten?: number;
    avatar?: string;
    botCompletionInfo?: {
      plannedCompletionMs: number;
      plannedCompletionTime: string;
    };
  }>;
  status: 'ongoing' | 'finished';
  startedAt: string;
  timeElapsed: number;
  timeRemaining: number;
  submissions: Array<{
    userId: string;
    timestamp: string;
    passed: boolean;
    language: string;
  }>;
}

export default function ActiveMatches() {
  const [activeMatches, setActiveMatches] = useState<ActiveMatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      fetchActiveMatches();
      // Refresh every 5 seconds
      const interval = setInterval(fetchActiveMatches, 5000);
      return () => clearInterval(interval);
    }
  }, [mounted]);

  // Update bot completion times every second for real-time display
  useEffect(() => {
    if (!mounted) return;
    
    const updateInterval = setInterval(() => {
      // Force re-render to update bot completion times
      setActiveMatches(prev => [...prev]);
    }, 1000);
    
    return () => clearInterval(updateInterval);
  }, [mounted]);

  const fetchActiveMatches = async () => {
    try {
      const result = await getActiveMatches();
      
      if (result.success) {
        console.log('Active matches data:', result.matches);
        // Debug each match individually
        result.matches.forEach((match, index) => {
          console.log(`Match ${index}:`, {
            matchId: match.matchId,
            players: match.players.map(p => ({
              userId: p.userId,
              username: p.username,
              isBot: p.isBot,
              hasBotCompletionInfo: !!p.botCompletionInfo
            }))
          });
        });
        setActiveMatches(result.matches);
      } else {
        console.error('Error fetching active matches:', result.error);
        toast.error(result.error || 'Failed to fetch active matches');
      }
    } catch (error) {
      console.error('Error fetching active matches:', error);
      toast.error('Failed to fetch active matches');
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (milliseconds: number) => {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatBotCompletionTime = (botCompletionInfo: { plannedCompletionMs: number; plannedCompletionTime: string }, matchStartedAt: string) => {
    const matchStartTime = new Date(matchStartedAt).getTime();
    const currentTime = Date.now();
    const elapsed = currentTime - matchStartTime;
    const remaining = botCompletionInfo.plannedCompletionMs - elapsed;
    
    console.log('Bot completion time calculation:', {
      plannedCompletionMs: botCompletionInfo.plannedCompletionMs,
      matchStartedAt,
      matchStartTime,
      currentTime,
      elapsed,
      remaining
    });
    
    if (remaining <= 0) {
      return "Any moment now...";
    }
    
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'Easy': return 'bg-green-600';
      case 'Medium': return 'bg-yellow-600';
      case 'Hard': return 'bg-red-600';
      default: return 'bg-gray-600';
    }
  };

  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-white/60 rounded w-1/4 mb-6"></div>
          <div className="h-4 bg-white/60 rounded w-1/2 mb-4"></div>
          <div className="h-4 bg-white/60 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-black mb-2 flex items-center gap-2">
            <Eye className="h-6 w-6" style={{ color: '#2599D4' }} />
            Active Matches
          </h2>
          <p className="text-black/70">Monitor ongoing matches and player activity</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-black/70">
            {activeMatches.length} active match{activeMatches.length !== 1 ? 'es' : ''}
          </div>
          <Button
            onClick={fetchActiveMatches}
            variant="outline"
            size="sm"
            className="border-blue-200 text-black hover:bg-blue-50"
          >
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: '#2599D4' }}></div>
          <p className="text-black/70 mt-2">Loading active matches...</p>
        </div>
      ) : activeMatches.length === 0 ? (
        <Card className="bg-white/90 border-blue-200 shadow-lg">
          <CardContent className="text-center py-12">
            <Users className="h-12 w-12 mx-auto mb-4" style={{ color: '#2599D4' }} />
            <h3 className="text-lg font-semibold text-black mb-2">No Active Matches</h3>
            <p className="text-black/70">No matches are currently in progress</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {activeMatches.map((match) => (
            <Card key={match.matchId} className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-black text-lg line-clamp-1">
                      {match.problemTitle}
                    </CardTitle>
                    <CardDescription className="text-black/70 text-sm">
                      Match ID: {match.matchId}
                    </CardDescription>
                  </div>
                  <Badge className={`${getDifficultyColor(match.difficulty)} text-white`}>
                    {match.difficulty}
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {/* Timer */}
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Timer className="h-4 w-4" style={{ color: '#2599D4' }} />
                    <span className="text-sm text-black/70">Time Remaining</span>
                  </div>
                  <div className="text-lg font-mono text-black">
                    {formatTime(match.timeRemaining)}
                  </div>
                </div>

                {/* Players */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" style={{ color: '#2599D4' }} />
                    <span className="text-sm font-medium text-black/70">Players</span>
                  </div>
                  <div className="space-y-2">
                    {match.players.map((player) => {
                      console.log('Rendering player:', {
                        userId: player.userId,
                        username: player.username,
                        isBot: player.isBot,
                        botCompletionInfo: player.botCompletionInfo
                      });
                      
                      return (
                      <div key={player.userId} className="flex items-center justify-between p-2 bg-blue-50 rounded">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage
                              src={getAvatarUrl(player.avatar)}
                              alt={player.username}
                            />
                            <AvatarFallback className={`text-white text-xs ${player.isBot ? 'bg-blue-600' : 'bg-gray-600'}`}>
                              {player.isBot ? '🤖' : player.username.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-black font-medium text-sm">
                                {player.username}
                              </span>
                              {player.isBot && (
                                <Badge variant="outline" className="text-xs border-blue-500 text-blue-600 bg-blue-50">
                                  <Bot className="h-3 w-3 mr-1" />
                                  BOT
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-black/70">
                              <span>Rating: {player.rating?.toLocaleString() || 'N/A'}</span>
                              <span>•</span>
                              <span>{player.linesWritten || 0} lines</span>
                              {player.isBot && player.botCompletionInfo && (
                                <>
                                  <span>•</span>
                                  <span className="text-blue-600 font-medium">
                                    Wins in: {formatBotCompletionTime(player.botCompletionInfo, match.startedAt)}
                                  </span>
                                </>
                              )}
                              {player.isBot && !player.botCompletionInfo && (
                                <>
                                  <span>•</span>
                                  <span className="text-yellow-600 font-medium">
                                    No completion time
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {match.submissions.some(sub => sub.userId === player.userId && sub.passed) && (
                          <Trophy className="h-4 w-4 text-yellow-500" />
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>

                {/* Submissions */}
                {match.submissions.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" style={{ color: '#2599D4' }} />
                      <span className="text-sm font-medium text-black/70">Recent Submissions</span>
                    </div>
                    <div className="space-y-1">
                      {match.submissions.slice(-3).map((submission, index) => {
                        const player = match.players.find(p => p.userId === submission.userId);
                        return (
                          <div key={index} className="flex items-center justify-between text-xs p-2 bg-blue-50 rounded">
                            <div className="flex items-center gap-2">
                              <span className="text-black/70">
                                {player?.isBot ? '🤖' : '👤'} {player?.username}
                              </span>
                              <Badge 
                                variant="outline" 
                                className={`text-xs ${
                                  submission.passed 
                                    ? 'border-green-500 text-green-600 bg-green-50' 
                                    : 'border-red-500 text-red-600 bg-red-50'
                                }`}
                              >
                                {submission.passed ? 'PASSED' : 'FAILED'}
                              </Badge>
                            </div>
                            <div className="text-black/70">
                              {submission.language}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Match Status */}
                <div className="pt-2 border-t border-blue-200">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-black/70">
                      Started {formatTime(Date.now() - new Date(match.startedAt).getTime())} ago
                    </span>
                    <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50">
                      {match.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
