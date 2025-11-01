'use client';

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Code, Trophy, ActivityIcon } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion } from "framer-motion";

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

interface HomeProps {
  session: {
    user?: {
      username: string;
    };
    stats?: {
      totalMatches: number;
      wins: number;
      losses: number;
      draws: number;
      rating: number;
    };
    activity?: Array<{
      date: string;
      matches: number;
    }>;
  };
  restHandler: unknown;
}

export default function Home({ session, restHandler }: HomeProps) {
  const [username, setUsername] = useState<string | null>(null);
  const [data, setData] = useState<{ date: string; matches: number }[] | null>(null);

  useEffect(() => {
    setUsername(session?.user?.username || 'User');

    // Use activity data from props, or show empty state if no activity
    if (session?.activity && session.activity.length > 0) {
      setData(session.activity);
    } else {
      // Show empty state for users with no activity
      setData([]);
    }
  }, [session]);

  return (
    <div className="min-h-screen bg-blue-50 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-0 top-0 h-[500px] w-[500px] bg-blue-400/8 rounded-full filter blur-3xl"></div>
        <div className="absolute right-0 bottom-0 h-[500px] w-[500px] bg-cyan-400/6 rounded-full filter blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] bg-blue-500/6 rounded-full filter blur-3xl"></div>
      </div>
      <ScrollArea className="h-screen w-full relative z-10">
        <motion.div
          className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.h1
            className="text-4xl font-bold mb-8 text-center text-black"
            variants={itemVariants}
          >
            Welcome back, {username}!
          </motion.h1>

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8"
            variants={containerVariants}
          >
            <StatCard
              icon={Clock}
              title="Time Coded"
              value="0h"
            />
            <StatCard
              icon={Code}
              title="Games Played"
              value={session?.stats?.totalMatches?.toString() || "0"}
            />
            <StatCard
              icon={Trophy}
              title="Current Rating"
              value={session?.stats?.rating?.toString() || "1200"}
            />
            <StatCard
              icon={ActivityIcon}
              title="Wins"
              value={session?.stats?.wins?.toString() || "0"}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card className="bg-white/90 border-blue-200 shadow-lg backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-xl font-semibold text-black">
                  Your Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  {data && data.length > 0 && data.some(d => d.matches > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" stroke="#64748b" />
                        <YAxis stroke="#64748b" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#ffffff",
                            border: "1px solid #e2e8f0",
                            borderRadius: "8px",
                            boxShadow:
                              "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                          }}
                          labelStyle={{ color: "#64748b" }}
                          itemStyle={{ color: "#2599D4" }}
                          formatter={(value, name) => [value, 'Matches Played']}
                        />
                        <Line
                          type="monotone"
                          dataKey="matches"
                          stroke='#2599D4'
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 8 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="text-gray-400 mb-2">
                          <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-600 mb-1">No Activity Yet</h3>
                        <p className="text-gray-500 text-sm">
                          No matches in the last 7 days.<br />
                          Start playing to track your activity!
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </ScrollArea>
    </div>
  );
};

interface StatCardProps {
  icon: React.ElementType;
  title: string;
  value: string;
}

function StatCard({ icon: Icon, title, value }: StatCardProps) {
  return (
    <motion.div variants={itemVariants}>
      <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-black/70">
            {title}
          </CardTitle>
          <Icon className="h-4 w-4" style={{ color: '#2599D4' }} />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-black">{value}</div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
