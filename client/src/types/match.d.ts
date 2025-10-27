export type OpponentStats = {
  _id: string;
  username: string;
  name: string;
  initials: string;
  globalRank: number;
  gamesWon: number;
  winRate: number;
  rating: number;
  badges: string[];
  country: string;
  avatar: string;
};

export type MatchInfo = {
  status: string;
  opponent: OpponentStats;
  problem: ProblemData;
  languages: Map<string, string>;
};

export type Activity = {
  [date: string]: {
    count: number;
    matches: {
      matchId: string;
      players: string[]; // Array of player usernames
      winner: string; // Username of the winner
      difficulty: "easy" | "medium" | "hard"; // Difficulty of the match
      createdAt: string; // Date in ISO string format
    }[];
  };
};

export type GlobalStats = {
  activePlayers: number;
  inProgressMatches: number;
  inQueue: number;
  matchesCompleted: number;
};

export type RunInfo = {
  userOutput: unknown;
  expectedOutput: unknown;
  runSuccess: boolean;
};

// Match History Types
export interface MatchHistoryItem {
  matchId: string;
  opponent: {
    userId: string;
    username: string;
    avatar?: string;
    rating: number;
    botStats?: {
      submissions: number;
      testCasesSolved: number;
    };
  };
  problem: {
    title: string;
    difficulty: 'Easy' | 'Medium' | 'Hard';
    topics: string[];
  };
  result: 'win' | 'loss' | 'draw';
  ratingChange: number;
  ratingBefore: number;
  ratingAfter: number;
  duration: number; // in milliseconds
  endedAt: string;
  startedAt: string;
}

export interface PlayerMatchStats {
  userId: string;
  username: string;
  avatar?: string;
  ratingBefore: number;
  ratingAfter: number;
  ratingChange: number;
  submissionsCount: number;
  testsPassed: number;
  totalTests: number;
  botStats?: {
    submissions: number;
    testCasesSolved: number;
  };
}

export interface MatchDetails {
  matchId: string;
  problem: {
    title: string;
    difficulty: 'Easy' | 'Medium' | 'Hard';
    topics: string[];
    description: string;
  };
  result: 'win' | 'loss' | 'draw';
  duration: number;
  startedAt: string;
  endedAt: string;
  players: {
    currentUser: PlayerMatchStats;
    opponent: PlayerMatchStats;
  };
}
