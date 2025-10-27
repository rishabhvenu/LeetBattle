export interface User {
  _id: string | number;
  username: string;
  email: string;
  password: string;
  name: string;
  avatar: string;
  rating: number;
  joinDate: Date;
  globalRank: number;
  preferredLanguages: string[];
  stats: {
    easyProblemsSolved: number;
    mediumProblemsSolved: number;
    hardProblemsSolved: number;
    gamesWon: number;
    gamesLost: number;
    gamesDrawn: number;
    gamesPlayed: number;
  };
}
