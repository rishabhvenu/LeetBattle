'use client';

import React, { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Trophy,
  Medal,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Crown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { User } from "@/types/rest";
import { getAvatarUrl } from "@/lib/utils";
import { getLeaderboardData } from "@/lib/actions";
// Image import removed - using regular img tags instead

interface LeaderboardProps {
  currentUserId?: string;
}

function LeaderboardTable({
  data,
  startRank,
  currentUserId,
}: {
  data: Partial<User>[];
  startRank: number;
  currentUserId?: string;
}) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className="w-full text-sm text-left text-black border-collapse">
        <thead className="text-xs uppercase bg-white/90 text-black/70">
          <tr>
            <th scope="col" className="px-6 py-2">
              Rank
            </th>
            <th scope="col" className="px-6 py-2">
              User
            </th>
            <th scope="col" className="px-6 py-2">
              Rating
            </th>
            <th scope="col" className="px-6 py-2 text-center">
              Wins
            </th>
            <th scope="col" className="px-6 py-2 text-center">
              Losses
            </th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false} mode="wait">
            {data.map((user, index) => {
              const rank = startRank + index + 1;
              const isCurrentUser = user._id === currentUserId;
              const isFirst = rank === 1;
              const isSecond = rank === 2;
              const isThird = rank === 3;

              // Row styling for emotional weight
              let rowClassName = "border-b border-blue-100 transition-all duration-200 hover:bg-blue-50/50";
              
              // Compact height adjustments
              if (isFirst) rowClassName += " h-20 bg-yellow-50/40"; // 80px
              else if (isSecond) rowClassName += " h-16 bg-slate-50/40"; // 64px
              else if (isThird) rowClassName += " h-16 bg-orange-50/40"; // 64px
              else rowClassName += " bg-white/90 h-12"; // ~48px

              // Current user highlight
              if (isCurrentUser) {
                rowClassName += " ring-2 ring-blue-500/20 bg-blue-50/80 z-10 relative shadow-sm";
              }

              return (
                <motion.tr
                  key={user._id}
                  className={rowClassName}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.05 }}
                >
                  <th
                    scope="row"
                    className="px-6 py-2 font-bold whitespace-nowrap text-lg"
                  >
                    <div className="flex items-center">
                      {isFirst ? (
                        <div className="relative">
                          <Crown className="h-8 w-8 text-yellow-500 fill-yellow-200 animate-pulse" />
                          <span className="absolute -top-1 -right-1 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                          </span>
                        </div>
                      ) : isSecond ? (
                        <Medal className="h-6 w-6 text-slate-400 fill-slate-100" />
                      ) : isThird ? (
                        <Medal className="h-6 w-6 text-amber-600 fill-amber-100" />
                      ) : (
                        <span className={`w-6 text-center ${rank <= 10 ? 'text-black font-extrabold' : 'text-black/50'}`}>
                          {rank}
                        </span>
                      )}
                    </div>
                  </th>
                  <td className="px-6 py-2">
                    <div className="flex items-center gap-3">
                      <div className={`relative ${isFirst ? 'h-14 w-14' : isSecond || isThird ? 'h-10 w-10' : 'h-8 w-8'} transition-all`}>
                        <Avatar className="h-full w-full border-2 border-white shadow-sm">
                          <AvatarImage
                            src={getAvatarUrl(user.avatar)}
                            alt={user.username}
                          />
                          <AvatarFallback>
                            <img 
                              src="/placeholder_avatar.png"
                              alt="Profile placeholder"
                              className="w-full h-full object-cover opacity-80"
                            />
                          </AvatarFallback>
                        </Avatar>
                        {isFirst && (
                          <div className="absolute -bottom-2 -right-2 bg-yellow-400 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm">
                            #1
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className={`font-bold ${isFirst ? 'text-lg text-yellow-700' : 'text-sm'}`}>
                          {user.username}
                        </span>
                        {isCurrentUser && (
                          <span className="text-[10px] text-blue-600 font-medium bg-blue-100 px-1.5 py-0.5 rounded-full w-fit">
                            You
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-2">
                    <div className="flex flex-col">
                      <span className="font-bold text-base">{user.rating?.toLocaleString() || '1200'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-2 text-center">
                    <div className="flex flex-col items-center">
                      <span className="text-green-600 font-bold text-base">
                        {user.stats?.gamesWon || 0}W
                      </span>
                      {/* Win bar visualization */}
                      <div className="h-1 w-12 bg-gray-100 rounded-full mt-1 overflow-hidden">
                        <div 
                          className="h-full bg-green-500 rounded-full" 
                          style={{ 
                            width: `${Math.min(100, ((user.stats?.gamesWon || 0) / Math.max(1, (user.stats?.gamesWon || 0) + (user.stats?.gamesLost || 0))) * 100)}%` 
                          }} 
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-2 text-center">
                    <div className="flex flex-col items-center">
                      <span className="text-red-500 font-semibold text-sm">
                        {user.stats?.gamesLost || 0}L
                      </span>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
      
      {/* Visual hint for more content */}
      {data.length >= 10 && (
        <div className="text-center py-1 text-xs text-black/40 italic flex justify-center items-center gap-1">
          <span>More ranks below</span>
          <motion.div 
            animate={{ y: [0, 3, 0] }} 
            transition={{ repeat: Infinity, duration: 2 }}
          >
            ↓
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default function Leaderboard({ currentUserId }: LeaderboardProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [users, setUsers] = useState<Partial<User>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const entriesPerPage = 10;

  useEffect(() => {
    fetchUsers();
  }, [currentPage]);

  const fetchUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getLeaderboardData(currentPage, entriesPerPage);
      setUsers(data.users || []);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error("Error fetching users:", err);
      setError("Failed to fetch leaderboard data. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  return (
    <div className="flex-1 bg-blue-50 min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
      </div>
      <div className="w-full max-w-[1000px] z-10">
          <motion.h1
            className="text-3xl font-bold mb-1 text-black text-center"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            LeetBattle Leaderboard
          </motion.h1>
          <motion.p
            className="text-lg text-black/70 text-center mb-4"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            See how you stack up against the competition
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="bg-white/90 border-blue-200 backdrop-blur-sm shadow-xl overflow-hidden">
              <CardHeader className="bg-white/50 border-b border-blue-100 py-3">
                <CardTitle className="text-xl font-semibold text-black flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-600" />
                    <span>Top Performers</span>
                  </div>
                  {currentUserId && (
                    <div className="text-xs font-normal text-black/50 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                      Top 100 Players
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  </div>
                ) : error ? (
                  <div className="text-center text-red-600 p-8">{error}</div>
                ) : (
                  <>
                    <LeaderboardTable
                      data={users}
                      startRank={(currentPage - 1) * entriesPerPage}
                      currentUserId={currentUserId}
                    />
                    <div className="p-2 bg-white/50 border-t border-blue-100 flex justify-between items-center sticky bottom-0 backdrop-blur-sm">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="border-blue-200 hover:bg-blue-50 hover:text-blue-700 h-8 text-xs"
                      >
                        <ChevronLeft className="h-3 w-3 mr-1" />
                        Previous
                      </Button>
                      <span className="text-xs font-medium text-black/60">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="border-blue-200 hover:bg-blue-50 hover:text-blue-700 h-8 text-xs"
                      >
                        Next
                        <ChevronRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
    </div>
  );
}
