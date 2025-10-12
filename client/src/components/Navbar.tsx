'use client';

import React from "react";
import {
  Home,
  Play,
  Settings,
  LogOut,
  Trophy,
  ChevronLeft,
  Menu,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/play", icon: Play, label: "Play" },
  { to: "/leaderboard", icon: Trophy, label: "Leaderboard" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

interface NavbarProps {
  session: {
    _id: string;
    username: string;
  } | null;
  logoutAction: () => Promise<void>;
}

export default function Navbar({ session, logoutAction }: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = React.useState(true);

  const toggleNavbar = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <motion.aside
      className="bg-gradient-to-b from-blue-50 to-blue-100 text-black flex flex-col h-screen border-r border-blue-200"
      initial={{ width: "20rem" }}
      animate={{ width: isExpanded ? "20rem" : "6rem" }}
      transition={{ duration: 0.3 }}
    >
      <div className="p-6 flex items-center justify-center border-b border-blue-200 relative bg-white/50">
        <AnimatePresence>
          {isExpanded ? (
            <motion.div
              className="flex items-center gap-2 justify-center w-full"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.3 }}
            >
              <img
                src="/logo.png"
                alt="LeetBattle Logo"
                className="h-8 w-8"
              />
              <span className="text-xl font-semibold font-mono" style={{ color: '#2599D4' }}>
                LeetBattle
              </span>
            </motion.div>
          ) : (
            <motion.div
              className="w-full h-full flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <img
                src="/logo.png"
                alt="LeetBattle Logo"
                className="h-8 w-8"
              />
            </motion.div>
          )}
        </AnimatePresence>
        {isExpanded && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleNavbar}
            className="absolute right-4 top-1/2 transform -translate-y-1/2 text-black/60 hover:text-black hover:bg-blue-100/50"
          >
            <ChevronLeft className="w-8 h-8" />
          </Button>
        )}
        {!isExpanded && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleNavbar}
            className="absolute inset-0 w-full h-full flex items-center justify-center text-black/60 hover:text-black hover:bg-blue-100/50"
          >
            <Menu className="w-8 h-8 stroke-2" />
          </Button>
        )}
      </div>
      <ScrollArea className="flex-1 bg-gradient-to-b from-white/30 to-blue-50/30">
        <nav className="py-6">
          {navItems.map((item) => (
            <Link
              key={item.to}
              href={item.to}
              className="flex items-center px-4 py-4 mb-3 mx-2 rounded-lg transition-colors text-black/70 hover:text-black hover:bg-white/50"
            >
              <item.icon className="w-8 h-8 flex-shrink-0" />
              <AnimatePresence>
                {isExpanded && (
                  <motion.span
                    className="ml-4 text-xl"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          ))}
        </nav>
      </ScrollArea>
      <div className="p-4 border-t border-blue-200 bg-white/50">
        <form action={logoutAction}>
          <Button
            type="submit"
            variant="ghost"
            className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 py-4"
          >
            <LogOut className="w-8 h-8 flex-shrink-0" />
            <AnimatePresence>
              {isExpanded && (
                <motion.span
                  className="ml-4 text-xl"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  Logout
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </form>
      </div>
    </motion.aside>
  );
}
