'use client';

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import CountUp from "react-countup";

interface GlobalStats {
  activePlayers: number;
  matchesCompleted: number;
}

const Landing: React.FC<{ restHandler: any }> = ({ restHandler }) => {
  const router = useRouter();
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        if (restHandler && restHandler.getGeneralStats) {
          const stats = await restHandler.getGeneralStats();
          setStats(stats);
        } else {
          // Mock stats if no restHandler
          setStats({
            activePlayers: 1250,
            matchesCompleted: 15600,
          });
        }
      } catch (error) {
        console.error('Error fetching stats:', error);
        // Fallback to mock stats
        setStats({
          activePlayers: 1250,
          matchesCompleted: 15600,
        });
      }
    };
    fetchStats();
  }, [restHandler]);

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <ScrollArea className="flex-1 h-screen">
      <div className="min-h-screen bg-blue-50 font-sans flex flex-col relative overflow-hidden">
        {/* Background effects to match the light theme */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-96 h-96 bg-blue-500/5 rounded-full filter blur-3xl"></div>
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-400/4 rounded-full filter blur-2xl"></div>
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-600/3 rounded-full filter blur-3xl"></div>
        </div>
        {/* Navbar */}
        <nav className="flex justify-between items-center pl-20 pr-20 py-6 relative z-10">
          <div className="flex items-center gap-1">
            <img src="/logo.png" alt="LeetBattle Logo" className="w-14 h-14" />
            <div className="text-2xl font-semibold font-mono" style={{ color: '#2599D4' }}>LeetBattle</div>
          </div>
          <button
            onClick={() => router.push("/login")}
            className="text-white px-6 py-1 rounded-full transition-colors duration-300 text-lg font-medium shadow-sm"
            style={{ backgroundColor: '#2599D4' }}
          >
            Login
          </button>
        </nav>

        {/* Main Content - Top Half */}
        <div className="flex-1 flex items-center justify-center relative z-10">
          <div className="text-center max-w-4xl mx-auto px-6">
            {/* Main Heading */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-8"
            >
              <h1 className="text-5xl font-light text-black mb-6">
                <span style={{ color: '#2599D4' }}>1v1</span> Your Way to the Job.
              </h1>
              <p className="text-xl text-black/80 max-w-2xl mx-auto">
                Practice for technical interviews with real-time 1v1 LeetCode battles. 
                Face off against developers worldwide and sharpen your coding skills for your next job interview.
              </p>
            </motion.div>

            {/* Statistics */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex gap-16 justify-center"
            >
              <div className="text-center">
                <div className="text-4xl font-medium text-black mb-2">
                  <CountUp
                    end={stats ? stats.activePlayers : 0}
                    duration={2.5}
                    separator=","
                  />
                  +
                </div>
                <div className="text-black/70 font-light">Active Players</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-medium text-black mb-2">
                  <CountUp
                    end={stats ? stats.matchesCompleted : 0}
                    duration={2.5}
                    separator=","
                  />
                  +
                </div>
                <div className="text-black/70 font-light">Challenges Completed</div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Call-to-Action - Bottom */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="pb-16 relative z-10"
        >
          <div className="max-w-4xl mx-auto px-6 text-center">
            <button
              onClick={() => router.push("/register")}
              className="text-black hover:text-gray-700 transition-colors duration-300 text-xl font-medium underline decoration-black/30 hover:decoration-black/70 underline-offset-4"
            >
              Get Started
            </button>
          </div>
        </motion.div>
      </div>
    </ScrollArea>
  );
};

export default Landing;
