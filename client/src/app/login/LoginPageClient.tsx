'use client';

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Code2, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import LoginForm from "./LoginForm";

export default function LoginPageClient() {
  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-96 h-96 bg-blue-500/5 rounded-full filter blur-3xl"></div>
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-400/4 rounded-full filter blur-2xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-600/3 rounded-full filter blur-3xl"></div>
      </div>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <Card className="bg-white/90 backdrop-blur-sm text-black border-blue-200 shadow-xl">
          <CardHeader className="space-y-1 flex flex-col items-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              className="p-3 rounded-full mb-2"
              style={{ backgroundColor: '#2599D4' }}
            >
              <Code2 className="h-6 w-6 text-white" />
            </motion.div>
            <CardTitle className="text-2xl font-bold text-black">
              Welcome back to LeetBattle
            </CardTitle>
            <CardDescription className="text-black/70">
              Enter your credentials to access your account
            </CardDescription>
          </CardHeader>
          <LoginForm />
        </Card>
      </motion.div>
    </div>
  );
}
