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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { User } from "@/types/rest";
import Link from "next/link";
import { getAvatarUrl } from "@/lib/utils";
import { getLeaderboardData } from "@/lib/actions";

interface LeaderboardProps {}

function LeaderboardTable({
  data,
  startRank,
}: {
  data: Partial<User>[];
  startRank: number;
}) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className="w-full text-sm text-left text-black">
        <thead className="text-xs uppercase bg-white/90 text-black/70">
          <tr>
            <th scope="col" className="px-6 py-3">
              Rank
            </th>
            <th scope="col" className="px-6 py-3">
              User
            </th>
            <th scope="col" className="px-6 py-3">
              Rating
            </th>
            <th scope="col" className="px-6 py-3">
              Wins
            </th>
            <th scope="col" className="px-6 py-3">
              Losses
            </th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false} mode="wait">
            {data.map((user, index) => {
              const rank = startRank + index + 1;
              return (
                <motion.tr
                  key={user._id}
                  className="bg-white/90 border-b border-blue-200"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <th
                    scope="row"
                    className="px-6 py-4 font-medium whitespace-nowrap"
                  >
                    {rank <= 3 ? (
                      <Medal
                        className={`inline-block mr-2 h-5 w-5 ${
                          rank === 1
                            ? "text-yellow-600"
                            : rank === 2
                            ? "text-black/70"
                            : "text-amber-600"
                        }`}
                      />
                    ) : null}
                    {rank}
                  </th>
                  <td className="px-6 py-4 flex items-center">
                    <Avatar className="h-8 w-8 mr-2">
                      <AvatarImage
                        src={getAvatarUrl(user.avatar)}
                        alt={user.username}
                      />
                      <AvatarFallback>
                        <img 
                          src="/placeholder_avatar.png"
                          alt="Profile placeholder"
                          className="w-full h-full object-cover"
                        />
                      </AvatarFallback>
                    </Avatar>
                    <Link
                      href={`/profile/${user._id}`}
                      className="hover:underline transition-colors duration-200"
                      style={{ color: '#2599D4' }}
                    >
                      {user.username}
                    </Link>
                  </td>
                  <td className="px-6 py-4">{user.rating.toLocaleString()}</td>
                  <td className="px-6 py-4">{user.stats.gamesWon}</td>
                  <td className="px-6 py-4">
                    {user.stats.gamesPlayed - user.stats.gamesWon}
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

export default function Leaderboard({}: LeaderboardProps) {
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
    <div className="flex-1 bg-blue-50 min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
      </div>
      <ScrollArea className="h-screen relative z-10">
        <div className="max-w-[1200px] mx-auto p-4 lg:p-8">
          <motion.h1
            className="text-4xl font-bold mb-2 text-black text-center"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            LeetBattle Leaderboard
          </motion.h1>
          <motion.p
            className="text-xl text-black/70 text-center mb-8 lg:mb-12"
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
            <Card className="bg-white/90 border-blue-200 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-2xl font-semibold text-black flex items-center gap-2">
                  <Trophy className="h-6 w-6 text-yellow-600" />
                  Top Performers
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#2599D4' }} />
                  </div>
                ) : error ? (
                  <div className="text-center text-red-600">{error}</div>
                ) : (
                  <>
                    <LeaderboardTable
                      data={users}
                      startRank={(currentPage - 1) * entriesPerPage}
                    />
                    <div className="mt-6 flex justify-between items-center">
                      <Button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="  text-white"
                      >
                        <ChevronLeft className="h-4 w-4 mr-2" />
                        Previous
                      </Button>
                      <span className="text-black/70">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="  text-white"
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-2" />
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </ScrollArea>
    </div>
  );
}
