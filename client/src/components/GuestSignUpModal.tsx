"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Trophy, Target, CheckCircle, User, Mail, Lock } from "lucide-react";
import { toast } from 'react-toastify';
import { registerUser } from '@/lib/actions';
import { claimGuestMatch, clearGuestSession } from '@/lib/guest-actions';

interface GuestSignUpModalProps {
  matchResult: { winner: boolean; draw: boolean } | null;
  testsPassed: number;
  totalTests: number;
  opponentName: string;
  onClose: () => void;
}

const GuestSignUpModal: React.FC<GuestSignUpModalProps> = ({
  matchResult,
  testsPassed,
  totalTests,
  opponentName,
  onClose
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: ''
  });
  const router = useRouter();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters long');
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
        return;
      }

      // If registration was successful, the user should be redirected
      // The registration function handles the redirect
      toast.success('Account created successfully! Your match has been saved.');
      
    } catch (error) {
      console.error('Registration error:', error);
      toast.error('Failed to create account. Please try again.');
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

  const getResultColor = () => {
    if (!matchResult) return 'text-blue-600';
    if (matchResult.winner) return 'text-green-600';
    if (matchResult.draw) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl bg-white shadow-2xl">
        <CardHeader className="relative">
          <CardTitle className="text-2xl font-bold text-center text-black">
            {getResultText()}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>
        
        <CardContent className="p-6">
          {/* Match Stats */}
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="text-lg font-semibold text-black mb-3">Your Match Results</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-600" />
                <span className="text-sm text-black/70">Result: <span className={getResultColor()}>{getResultText()}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5" style={{ color: '#2599D4' }} />
                <span className="text-sm text-black/70">Opponent: {opponentName}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-sm text-black/70">Tests Passed: {testsPassed}/{totalTests}</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-gray-600" />
                <span className="text-sm text-black/70">Mode: Guest Match</span>
              </div>
            </div>
          </div>

          {/* Sign Up Prompt */}
          <div className="mb-6 text-center">
            <h2 className="text-xl font-bold text-black mb-2">
              Sign up to save this match and play more!
            </h2>
            <p className="text-gray-600">
              Create an account to keep your progress and compete with other players.
            </p>
          </div>

          {/* Registration Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName" className="text-sm font-medium text-black">
                  First Name
                </Label>
                <Input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={handleInputChange}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="lastName" className="text-sm font-medium text-black">
                  Last Name
                </Label>
                <Input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={handleInputChange}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="username" className="text-sm font-medium text-black">
                Username
              </Label>
              <Input
                id="username"
                name="username"
                type="text"
                required
                value={formData.username}
                onChange={handleInputChange}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="email" className="text-sm font-medium text-black">
                Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                value={formData.email}
                onChange={handleInputChange}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="password" className="text-sm font-medium text-black">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                value={formData.password}
                onChange={handleInputChange}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="confirmPassword" className="text-sm font-medium text-black">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                value={formData.confirmPassword}
                onChange={handleInputChange}
                className="mt-1"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-6 py-3 text-white font-semibold rounded-full transition-colors duration-300"
                style={{ backgroundColor: '#2599D4' }}
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 mr-2 border-2 border-t-white border-white/30 rounded-full animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  'Create Account & Save Match'
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="px-6 py-3 text-black font-semibold rounded-full border-2 border-gray-300"
              >
                Maybe Later
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default GuestSignUpModal;
