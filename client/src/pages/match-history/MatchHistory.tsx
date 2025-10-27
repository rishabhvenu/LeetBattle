'use client';

import React, { useState, useEffect } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  History,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MatchHistoryItem, MatchDetails } from "@/types/match";
import { getMatchHistory, getMatchDetails, getAvatarByIdAction } from '@/lib/actions';
import { getAvatarUrl } from '@/lib/utils';
import MatchDetailsModal from '@/components/MatchDetailsModal';
// Image import removed - using regular img tags instead

interface MatchHistoryProps {
  initialData: {
    matches: MatchHistoryItem[];
    page: number;
    limit: number;
    hasMore: boolean;
  };
  userId: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
  },
};

export default function MatchHistory({ initialData, userId }: MatchHistoryProps) {
  const [matches, setMatches] = useState<MatchHistoryItem[]>(initialData.matches);
  const [currentPage, setCurrentPage] = useState(initialData.page);
  const [hasMore, setHasMore] = useState(initialData.hasMore);
  const [loading, setLoading] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<MatchDetails | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null);

  // Fetch current user's avatar on component mount
  useEffect(() => {
    const fetchCurrentUserAvatar = async () => {
      try {
        const result = await getAvatarByIdAction(userId);
        if (result.success) {
          setCurrentUserAvatar(result.avatar);
        }
      } catch (error) {
        console.error('Error fetching current user avatar:', error);
      }
    };
    fetchCurrentUserAvatar();
  }, [userId]);

  const fetchMatches = async (page: number) => {
    setLoading(true);
    try {
      const result = await getMatchHistory(userId, page, 10);
      setMatches(result.matches);
      setHasMore(result.hasMore);
      setCurrentPage(result.page);
    } catch (error) {
      console.error('Error fetching matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && !loading) {
      fetchMatches(newPage);
    }
  };

  const handleMatchClick = async (matchId: string) => {
    setModalLoading(true);
    try {
      const result = await getMatchDetails(matchId, userId);
      if (result.success) {
        setSelectedMatch(result);
      }
    } catch (error) {
      console.error('Error fetching match details:', error);
    } finally {
      setModalLoading(false);
    }
  };

  const formatDuration = (duration: number) => {
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
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

  const getResultColor = (result: string) => {
    switch (result) {
      case 'win': return 'bg-green-100 text-green-600';
      case 'loss': return 'bg-red-100 text-red-600';
      case 'draw': return 'bg-blue-100 text-blue-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getCardBorderColor = (result: string) => {
    switch (result) {
      case 'win': return 'border-green-300 shadow-green-100';
      case 'loss': return 'border-red-300 shadow-red-100';
      case 'draw': return 'border-blue-300 shadow-blue-100';
      default: return 'border-blue-200 shadow-lg';
    }
  };

  const getCardBackgroundColor = (result: string) => {
    switch (result) {
      case 'win': return 'bg-gradient-to-r from-green-50 to-white';
      case 'loss': return 'bg-gradient-to-r from-red-50 to-white';
      case 'draw': return 'bg-gradient-to-r from-blue-50 to-white';
      default: return 'bg-white/90';
    }
  };


  return (
    <div className="flex-1 bg-blue-50 min-h-screen relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
      </div>
      
      <ScrollArea className="h-screen relative z-10">
        <div className="max-w-6xl mx-auto p-4 lg:p-8">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <motion.div
              className="text-center mb-8"
              variants={itemVariants}
            >
              <h1 className="text-4xl font-bold mb-2 text-black">
                Match History
              </h1>
              <p className="text-xl text-black/70">
                Review your past battles and track your progress
              </p>
            </motion.div>

            {matches.length === 0 ? (
              <motion.div
                className="text-center py-16"
                variants={itemVariants}
              >
                <History className="w-16 h-16 mx-auto mb-4 text-black/30" />
                <h2 className="text-2xl font-semibold text-black/70 mb-2">
                  No matches yet
                </h2>
                <p className="text-black/50">
                  Start playing to see your match history here
                </p>
              </motion.div>
            ) : (
              <>
                <motion.div
                  className="grid gap-4 mb-8"
                  variants={containerVariants}
                >
                  <AnimatePresence mode="wait">
                    {matches.map((match) => (
                      <motion.div
                        key={match.matchId}
                        variants={itemVariants}
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <Card
                          className={`${getCardBackgroundColor(match.result)} border-2 ${getCardBorderColor(match.result)} shadow-xl hover:shadow-2xl transition-all duration-300 cursor-pointer`}
                          onClick={() => handleMatchClick(match.matchId)}
                        >
                          <CardContent className="p-6 relative">

                            <div className="flex items-center justify-between">
                              {/* Current User */}
                              <div className="flex items-center gap-4">
                                <Avatar className="w-12 h-12 border-2 border-blue-200">
                                  <AvatarImage
                                    src={getAvatarUrl(currentUserAvatar)}
                                    alt="Your avatar"
                                  />
                                  <AvatarFallback>
                                    <img 
                                      src="/placeholder_avatar.png"
                                      alt="Profile placeholder"
                                      width={48}
                                      height={48}
                                      className="w-full h-full object-cover"
                                    />
                                  </AvatarFallback>
                                </Avatar>
                                <div className="text-left">
                                  <div className="font-semibold text-black">You</div>
                                  <div className="text-sm text-black/70">
                                    Rating: {match.ratingAfter || 1200}
                                    {match.ratingChange !== 0 && (
                                      <span className={`ml-1 font-semibold ${match.ratingChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        ({match.ratingChange > 0 ? '+' : ''}{match.ratingChange})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* VS Display */}
                              <div className="text-center">
                                <div className="text-3xl font-bold text-black/60">VS</div>
                              </div>

                              {/* Opponent */}
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <div className="font-semibold text-black">
                                    {match.opponent?.username || 'Unknown Player'}
                                  </div>
                                  <div className="text-sm text-black/70">
                                    Rating: {match.opponent?.rating || 'N/A'}
                                    <span className={`ml-1 font-semibold ${match.ratingChange > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                      ({match.ratingChange > 0 ? '-' : '+'}{Math.abs(match.ratingChange)})
                                    </span>
                                  </div>
                                </div>
                                <Avatar className="w-12 h-12 border-2 border-red-200">
                                  <AvatarImage
                                    src={getAvatarUrl(match.opponent?.avatar)}
                                    alt={match.opponent?.username || 'Unknown Player'}
                                  />
                                  <AvatarFallback>
                                    <img 
                                      src="/placeholder_avatar.png"
                                      alt="Profile placeholder"
                                      width={48}
                                      height={48}
                                      className="w-full h-full object-cover"
                                    />
                                  </AvatarFallback>
                                </Avatar>
                              </div>
                            </div>

                            {/* Bottom Info */}
                            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                              <div className="flex items-center gap-1 text-sm text-black/70">
                                <Clock className="w-4 h-4" />
                                {formatDuration(match.duration)}
                              </div>
                              <div className="text-sm text-black/50">
                                {formatDate(match.endedAt)}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>

                {/* Pagination */}
                <motion.div
                  className="flex justify-center items-center gap-4"
                  variants={itemVariants}
                >
                  <Button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || loading}
                    variant="outline"
                    className="bg-white text-black border-blue-200 hover:bg-blue-50"
                  >
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Previous
                  </Button>
                  
                  <div className="flex items-center gap-2">
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                    ) : (
                      <span className="text-black/70">
                        Page {currentPage}
                      </span>
                    )}
                  </div>

                  <Button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={!hasMore || loading}
                    variant="outline"
                    className="bg-white text-black border-blue-200 hover:bg-blue-50"
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </motion.div>
              </>
            )}
          </motion.div>
        </div>
      </ScrollArea>

      {/* Match Details Modal */}
      {selectedMatch && (
        <MatchDetailsModal
          matchDetails={selectedMatch}
          isOpen={!!selectedMatch}
          onClose={() => setSelectedMatch(null)}
          loading={modalLoading}
        />
      )}
    </div>
  );
}
