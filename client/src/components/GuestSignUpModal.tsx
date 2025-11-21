"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, User, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { toast } from 'react-toastify';
import { registerUser } from '@/lib/actions';
import MatchResultAnimation from '@/components/MatchResultAnimation';
import { motion } from "framer-motion";

interface GuestSignUpModalProps {
  matchResult: { winner: boolean; draw: boolean } | null;
  testsPassed: number;
  totalTests: number;
  opponentName: string;
  opponentAvatar?: string | null;
  username: string;
  userAvatar?: string | null;
  onClose: () => void;
}

const GuestSignUpModal: React.FC<GuestSignUpModalProps> = ({
  matchResult,
  testsPassed: _testsPassed,
  totalTests: _totalTests,
  opponentName,
  opponentAvatar,
  username,
  userAvatar,
  onClose
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResultAnimation, setShowResultAnimation] = useState(matchResult?.winner ?? false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: ''
  });
  const router = useRouter();
  useEffect(() => {
    if (matchResult?.winner) {
      setShowResultAnimation(true);
      const timeoutId = setTimeout(() => setShowResultAnimation(false), 3500);
      return () => clearTimeout(timeoutId);
    }

    setShowResultAnimation(false);
  }, [matchResult]);

  const getInitials = (name: string) => {
    if (!name) return "G";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  };

  const handleClose = () => {
    router.push('/landing');
    onClose();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setFormError(null);

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      setFormError('Passwords do not match.');
      return;
    }

    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters long');
      setFormError('Password must be at least 8 characters long.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Create FormData for the registration
      const registrationFormData = new FormData();
      registrationFormData.append('username', formData.username);
      registrationFormData.append('email', formData.email);
      registrationFormData.append('password', formData.password);
      registrationFormData.append('confirmPassword', formData.confirmPassword);
      registrationFormData.append('firstName', formData.firstName);
      registrationFormData.append('lastName', formData.lastName);

      // Register the user
      const result = await registerUser(null, registrationFormData);
      
      if (result.error) {
        toast.error(result.error);
        setFormError(result.error);
        return;
      }

      // If registration was successful, the user should be redirected
      // The registration function handles the redirect
      toast.success('Account created successfully! Your match has been saved.');
      
    } catch (error) {
      console.error('Registration error:', error);
      toast.error('Failed to create account. Please try again.');
      setFormError('Failed to create account. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getResultText = () => {
    if (!matchResult) return 'Match Complete';
    if (matchResult.winner) return 'You Won!';
    if (matchResult.draw) return 'Draw!';
    return 'You Lost';
  };

  const guestDisplayName = username || 'Guest Player';
  const opponentDisplayName = opponentName || 'Opponent';

  if (showResultAnimation && matchResult?.winner) {
    const handleAnimationDismiss = () => setShowResultAnimation(false);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <MatchResultAnimation
          player1={{
            name: guestDisplayName,
            username: guestDisplayName,
            avatar: userAvatar ?? null,
            isWinner: true,
          }}
          player2={{
            name: opponentDisplayName,
            username: opponentDisplayName,
            avatar: opponentAvatar ?? null,
            isWinner: false,
          }}
          onBackToHome={handleAnimationDismiss}
          onJoinQueue={handleAnimationDismiss}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl bg-white shadow-2xl">
        <CardHeader className="relative pb-4">
          <CardTitle className="text-2xl font-bold text-center text-black">
            {getResultText()}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>
        
        <CardContent className="p-6 pt-0">
          {/* Registration Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <motion.div
                  className="space-y-2"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <Label htmlFor="firstName" className="text-sm font-medium text-black">
                    First Name
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-black/60" />
                    <Input
                      id="firstName"
                      name="firstName"
                      type="text"
                      placeholder="John"
                      required
                      value={formData.firstName}
                      onChange={handleInputChange}
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
                  <Label htmlFor="lastName" className="text-sm font-medium text-black">
                    Last Name
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-black/60" />
                    <Input
                      id="lastName"
                      name="lastName"
                      type="text"
                      placeholder="Doe"
                      required
                      value={formData.lastName}
                      onChange={handleInputChange}
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
                <Label htmlFor="username" className="text-sm font-medium text-black">
                  Username
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-black/60" />
                  <Input
                    id="username"
                    name="username"
                    type="text"
                    placeholder="leetbattler123"
                    required
                    value={formData.username}
                    onChange={handleInputChange}
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
                <Label htmlFor="email" className="text-sm font-medium text-black">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-black/60" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="john.doe@example.com"
                    required
                    value={formData.email}
                    onChange={handleInputChange}
                    className="bg-white border-blue-200 text-black placeholder:text-black/60 pl-10 focus:border-blue-500"
                  />
                </div>
              </motion.div>

              <div className="grid gap-4 sm:grid-cols-2">
                <motion.div
                  className="space-y-2"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  <Label htmlFor="password" className="text-sm font-medium text-black">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-black/60" />
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      value={formData.password}
                      onChange={handleInputChange}
                      className="bg-white border-blue-200 text-black pl-10 pr-10 focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-black/60"
                      aria-label={showPassword ? "Hide password" : "Show password"}
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
                  <Label htmlFor="confirmPassword" className="text-sm font-medium text-black">
                    Confirm Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-black/60" />
                    <Input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      required
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                      className="bg-white border-blue-200 text-black pl-10 pr-10 focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-black/60"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </motion.div>
              </div>

              {formError && (
                <motion.div
                  className="text-red-600 text-sm text-center p-2 bg-red-50 rounded-md border border-red-200"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {formError}
                </motion.div>
              )}

              <div className="space-y-4 pt-2">
                <motion.div
                  className="w-full"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full px-6 py-3 text-white font-semibold rounded-full transition-colors duration-300"
                    style={{ backgroundColor: '#2599D4' }}
                  >
                    {isSubmitting ? (
                      <>
                        <div className="h-4 w-4 mr-2 border-2 border-t-white border-white/30 rounded-full animate-spin" />
                        Creating Account...
                      </>
                    ) : (
                      'Create Account'
                    )}
                  </Button>
                </motion.div>
                <motion.div
                  className="w-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                >
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                    className="w-full px-6 py-3 text-black font-semibold rounded-full border-2 border-gray-300"
                  >
                    Maybe Later
                  </Button>
                </motion.div>
                <motion.p
                  className="text-center text-sm text-black/70"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7 }}
                >
                  Already have an account?{" "}
                  <a href="/login" className="hover:underline" style={{ color: '#2599D4' }}>
                    Sign in
                  </a>
                </motion.p>
              </div>
            </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default GuestSignUpModal;
