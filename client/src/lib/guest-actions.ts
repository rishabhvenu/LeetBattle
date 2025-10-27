'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRedis } from './redis';

const COLYSEUS_HTTP_URL = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || 'http://localhost:2567';

export interface GuestSession {
  guestId: string;
  matchId: string;
  roomId: string;
  createdAt: number;
}

export interface GuestMatchData {
  matchId: string;
  roomId: string;
  guestId: string;
  opponentId: string;
  problemId: string;
  result: 'win' | 'loss' | 'draw';
  submissions: Array<{
    language: string;
    code: string;
    passed: boolean;
    testResults: any[];
    timestamp: number;
  }>;
  testsPassed: number;
  totalTests: number;
  completedAt: number;
}

/**
 * Create a guest session with a 7-day cookie
 */
export async function createGuestSession(): Promise<{ success: boolean; guestId?: string; error?: string }> {
  try {
    const cookieStore = await cookies();
    
    // Check if guest already has a session
    const existingGuestId = cookieStore.get('codeclashers.guest.sid')?.value;
    if (existingGuestId) {
      return { success: true, guestId: existingGuestId };
    }
    
    // Generate new guest ID
    const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Set cookie with 7-day expiry
    cookieStore.set('codeclashers.guest.sid', guestId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/'
    });
    
    return { success: true, guestId };
  } catch (error) {
    console.error('Error creating guest session:', error);
    return { success: false, error: 'Failed to create guest session' };
  }
}

/**
 * Get the current guest session ID from cookie
 */
export async function getGuestSession(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get('codeclashers.guest.sid')?.value || null;
  } catch (error) {
    console.error('Error getting guest session:', error);
    return null;
  }
}

/**
 * Clear the guest session cookie
 */
export async function clearGuestSession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('codeclashers.guest.sid');
  } catch (error) {
    console.error('Error clearing guest session:', error);
  }
}

/**
 * Check if guest has already played (has a session cookie)
 */
export async function hasGuestPlayed(): Promise<boolean> {
  const guestId = await getGuestSession();
  if (!guestId) return false;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(`${COLYSEUS_HTTP_URL}/guest/check?guestId=${encodeURIComponent(guestId)}`, {
      signal: controller.signal,
      headers: {
        'Cache-Control': 'no-cache',
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) return false;
    
    const data = await response.json();
    return data.success && data.hasPlayed;
  } catch (error) {
    console.error('Error checking guest play status:', error);
    // If backend is not accessible, assume guest hasn't played to avoid blocking
    return false;
  }
}

/**
 * Create a guest match by calling the backend API
 */
export async function createGuestMatch(): Promise<{ success: boolean; guestId?: string; matchId?: string; roomId?: string; bot?: any; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(`${COLYSEUS_HTTP_URL}/guest/match/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.error || 'Failed to create guest match' };
    }
    
    const data = await response.json();
    return {
      success: true,
      guestId: data.guestId,
      matchId: data.matchId,
      roomId: data.roomId,
      bot: data.bot
    };
  } catch (error) {
    console.error('Error creating guest match:', error);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timed out - backend server may not be running' };
    }
    return { success: false, error: 'Failed to create guest match' };
  }
}

/**
 * Claim a guest match after user signs up
 */
export async function claimGuestMatch(guestId: string, userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${COLYSEUS_HTTP_URL}/guest/match/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ guestId, userId }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.error || 'Failed to claim guest match' };
    }
    
    const data = await response.json();
    return { success: true };
  } catch (error) {
    console.error('Error claiming guest match:', error);
    return { success: false, error: 'Failed to claim guest match' };
  }
}

/**
 * Get guest match data from Redis
 */
export async function getGuestMatchData(guestId: string): Promise<GuestMatchData | null> {
  try {
    const redis = getRedis();
    
    // Get session data which contains the match info
    const sessionData = await redis.get(`guest:session:${guestId}`);
    if (!sessionData) return null;
    
    const parsedSession = JSON.parse(sessionData);
    
    // Return session data as match data (contains matchId, roomId, etc.)
    return {
      matchId: parsedSession.matchId,
      roomId: parsedSession.roomId,
      guestId: parsedSession.guestId,
      // These will be filled in after match completion
      opponentId: '',
      problemId: '',
      result: 'draw' as const,
      submissions: [],
      testsPassed: 0,
      totalTests: 0,
      completedAt: 0
    };
  } catch (error) {
    console.error('Error getting guest match data:', error);
    return null;
  }
}
