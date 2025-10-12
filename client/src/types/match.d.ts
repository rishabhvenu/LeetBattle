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
  userOutput: any;
  expectedOutput: any;
  runSuccess: boolean;
};
