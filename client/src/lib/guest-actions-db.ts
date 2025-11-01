'use server';

export const runtime = 'nodejs';

import { getRedis } from './redis';

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
    testResults: unknown[];
    timestamp: number;
  }>;
  testsPassed: number;
  totalTests: number;
  completedAt: number;
}

/**
 * Get guest match data from Redis
 * Node runtime - Redis operations
 */
export async function getGuestMatchDataFromRedis(guestId: string): Promise<GuestMatchData | null> {
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



