'use server';

import { cookies } from 'next/headers';
import { getGuestMatchDataFromRedis, type GuestMatchData } from './guest-actions-db';

// Note: Types should be imported directly from './guest-actions-db' since
// 'use server' files can only export async functions

const COLYSEUS_HTTP_URL =
  process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || process.env.NEXT_PUBLIC_API_BASE || '';
const GUEST_MATCH_TIMEOUT_MS = (() => {
  const raw = process.env.NEXT_PUBLIC_GUEST_MATCH_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    // Backend keeps polling for bots for up to 15s; add buffer to avoid premature aborts.
    return 20000;
  }
  return parsed;
})();

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
    cookieStore.delete('codeclashers.guest.match');
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
export async function createGuestMatch(): Promise<{
  success: boolean;
  guestId?: string;
  matchId?: string;
  roomId?: string;
  bot?: unknown;
  error?: string;
  timedOut?: boolean;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GUEST_MATCH_TIMEOUT_MS);
    
    const response = await fetch(`${COLYSEUS_HTTP_URL}/guest/match/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data?.error || 'Failed to create guest match';
      if (errorMessage === 'No bots available for guest match') {
        return {
          success: false,
          timedOut: true,
          error: 'Still searching for an available bot opponent. Please stay in the queue.',
        };
      }
      return { success: false, error: errorMessage };
    }

    if (!data?.success) {
      return {
        success: false,
        error: data?.error || 'Still searching for an available bot opponent. Please stay in the queue.',
        timedOut: Boolean(data?.timedOut),
      };
    }

    return {
      success: true,
      guestId: data.guestId,
      matchId: data.matchId,
      roomId: data.roomId,
      bot: data.bot
    };
  } catch (error) {
    console.error('Error creating guest match:', error);
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        timedOut: true,
        error: 'Guest match request is taking longer than expected; still working on pairing you.',
      };
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
    
    await response.json();
    return { success: true };
  } catch (error) {
    console.error('Error claiming guest match:', error);
    return { success: false, error: 'Failed to claim guest match' };
  }
}

/**
 * Get guest match data from Redis
 * Edge runtime orchestrator - delegates to Node runtime
 */
export async function getGuestMatchData(guestId: string): Promise<GuestMatchData | null> {
  const redisData = await getGuestMatchDataFromRedis(guestId);
  if (redisData && redisData.matchId && redisData.roomId) {
    return redisData;
  }

  try {
    const cookieStore = await cookies();
    const fallbackCookie = cookieStore.get('codeclashers.guest.match')?.value;
    if (!fallbackCookie) {
      return redisData;
    }

    const parsed = JSON.parse(decodeURIComponent(fallbackCookie));
    if (!parsed || parsed.guestId !== guestId || !parsed.matchId || !parsed.roomId) {
      return redisData;
    }

    return {
      matchId: parsed.matchId,
      roomId: parsed.roomId,
      guestId: parsed.guestId,
      opponentId: '',
      problemId: '',
      result: 'draw',
      submissions: [],
      testsPassed: 0,
      totalTests: 0,
      completedAt: 0,
    };
  } catch (error) {
    console.error('Error reading guest match fallback cookie:', error);
    return redisData;
  }
}
