// Client-safe actions that don't import server-side packages
// These are just type definitions and utility functions

export interface Session {
  id: string;
  userId: string;
  user: {
    id: string;
    username: string;
    email?: string;
    profile?: {
      firstName?: string;
      lastName?: string;
      avatar?: string;
    };
  };
}

export interface User {
  id: string;
  username: string;
  email?: string;
  profile?: {
    firstName?: string;
    lastName?: string;
    avatar?: string;
  };
  stats?: {
    rating: number;
    wins: number;
    losses: number;
  };
}

export interface MatchHistoryItem {
  id: string;
  problemId: string;
  problemTitle: string;
  opponentId: string;
  opponentUsername: string;
  opponentAvatar?: string;
  status: 'won' | 'lost' | 'draw';
  startedAt: string;
  endedAt: string;
  duration: number;
  ratingChange: number;
}

export interface LeaderboardData {
  users: Partial<User>[];
  totalPages: number;
  currentPage: number;
}

// Client-side utility functions

// These functions will be implemented as API calls
export async function getSession(): Promise<Session | null> {
  try {
    const response = await fetch('/api/auth/session');
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Session error:', error);
    return null;
  }
}

export async function getLeaderboardData(page: number = 1, limit: number = 10): Promise<LeaderboardData> {
  try {
    const response = await fetch(`/api/leaderboard?page=${page}&limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch leaderboard data');
    return await response.json();
  } catch (error) {
    console.error('Leaderboard error:', error);
    return { users: [], totalPages: 0, currentPage: 1 };
  }
}

export async function getMatchHistory(userId: string, page: number = 1, limit: number = 10): Promise<{
  matches: MatchHistoryItem[];
  page: number;
  limit: number;
  hasMore: boolean;
}> {
  try {
    const response = await fetch(`/api/match-history?userId=${userId}&page=${page}&limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch match history');
    return await response.json();
  } catch (error) {
    console.error('Match history error:', error);
    return { matches: [], page: 1, limit: 10, hasMore: false };
  }
}

export async function getMatchDetails(matchId: string): Promise<any> {
  try {
    const response = await fetch(`/api/match-details/${matchId}`);
    if (!response.ok) throw new Error('Failed to fetch match details');
    return await response.json();
  } catch (error) {
    console.error('Match details error:', error);
    return null;
  }
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/landing';
  } catch (error) {
    console.error('Logout error:', error);
  }
}
