'use client';

import React, { useState } from "react";
import { loginUser } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      className="w-full text-white"
      style={{ backgroundColor: '#2599D4' }}
      disabled={pending}
    >
      {pending ? "Signing In..." : "Sign In"}
    </Button>
  );
}

export default function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction] = useActionState(loginUser, { error: '' });

  return (
    <form action={formAction}>
      <CardContent className="space-y-4">
        {state?.error && (
          <div className="text-red-600 text-sm text-center">{state.error}</div>
        )}
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Label htmlFor="email" className="text-black">
            Email
          </Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black/60" />
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="john.doe@example.com"
              required
              className="bg-white border-blue-200 text-black placeholder:text-black/60 pl-10 focus:border-blue-500"
            />
          </div>
        </motion.div>
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Label htmlFor="password" className="text-black">
            Password
          </Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black/60" />
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              className="bg-white border-blue-200 text-black pl-10 pr-10 focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-black/60"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </motion.div>
        {state?.error && (
          <motion.div
            className="text-red-600 text-sm text-center p-2 bg-red-50 rounded-md border border-red-200"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {state.error}
          </motion.div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <motion.div
          className="w-full"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <SubmitButton />
        </motion.div>
        <motion.div
          className="text-center text-sm text-black/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          Don't have an account?{" "}
          <a href="/register" className="hover:underline" style={{ color: '#2599D4' }}>
            Sign up
          </a>
        </motion.div>
      </CardFooter>
    </form>
  );
}
