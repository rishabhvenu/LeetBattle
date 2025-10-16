'use client';

import React, { useState } from "react";
import { registerUser } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      className="w-full text-white transition-colors duration-300 rounded-full"
      style={{ backgroundColor: '#2599D4' }}
      disabled={pending}
    >
      {pending ? "Creating Account..." : "Create Account"}
    </Button>
  );
}

export default function RegisterForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction] = useActionState(registerUser, { error: '' });

  return (
    <form action={formAction}>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <motion.div
            className="space-y-2"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Label htmlFor="firstName" className="text-black">
              First Name
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black/60" />
              <Input
                id="firstName"
                name="firstName"
                type="text"
                placeholder="John"
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
            <Label htmlFor="lastName" className="text-black">
              Last Name
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black/60" />
              <Input
                id="lastName"
                name="lastName"
                type="text"
                placeholder="Doe"
                required
                className="bg-white border-blue-200 text-black placeholder:text-black/60 pl-10 focus:border-blue-500"
              />
            </div>
          </motion.div>
        </div>
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Label htmlFor="username" className="text-black">
            Username
          </Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black/60" />
            <Input
              id="username"
              name="username"
              type="text"
              placeholder="leetbattler123"
              required
              className="bg-white border-blue-200 text-black placeholder:text-black/60 pl-10 focus:border-blue-500"
            />
          </div>
        </motion.div>
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4 }}
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
          transition={{ delay: 0.5 }}
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
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Label htmlFor="confirmPassword" className="text-black">
            Confirm Password
          </Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-black/60" />
            <Input
              id="confirmPassword"
              name="confirmPassword"
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
          transition={{ delay: 0.7 }}
        >
          Already have an account?{" "}
          <a href="/login" className="hover:underline" style={{ color: '#2599D4' }}>
            Sign in
          </a>
        </motion.div>
      </CardFooter>
    </form>
  );
}
