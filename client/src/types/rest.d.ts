interface Post {
  _id: string;
  author: User;
  content: string;
  likes: string[] | number;
  comments:
    | {
        _id: string;
        author: string;
        content: string;
        createdAt: string;
      }[]
    | number;
  tags: string[];
  visibility: "public" | "friends" | "private";
  createdAt: string;
  updatedAt: string;
}

export interface User {
  _id: any;
  username: string;
  email: string;
  password: string;
  name: string;
  avatar: string;
  initials: string;
  bio: string;
  location: string;
  rating: number;
  joinDate: Date;
  globalRank: number;
  problemsSolved: number;
  timeCoded: number;
  currentStreak: number;
  longestStreak: number;
  totalSubmissions: number;
  successfulSubmissions: number;
  achievements: Achievement[];
  badges: Badge[];
  friends: mongoose.Types.ObjectId[];
  friendRequests: mongoose.Types.ObjectId[];
  preferredLanguages: string[];
  recentActivity: Activity[];
  stats: {
    easyProblemsSolved: number;
    mediumProblemsSolved: number;
    hardProblemsSolved: number;
    gamesWon: number;
    gamesPlayed: number;
  };
  settings: {
    theme: "light" | "dark" | "system";
    emailNotifications: boolean;
    pushNotifications: boolean;
  };
  status: "online" | "offline" | "busy" | "away";
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  dateEarned: string;
}

export interface Badge {
  id: string;
  name: string;
  icon: string;
  level: "bronze" | "silver" | "gold" | "platinum";
}

export interface Activity {
  id: string;
  type:
    | "problem_solved"
    | "contest_participated"
    | "achievement_earned"
    | "friend_added";
  timestamp: string;
  details: {
    problemId?: string;
    problemName?: string;
    contestId?: string;
    contestName?: string;
    achievementId?: string;
    achievementName?: string;
    friendId?: string;
    friendName?: string;
  };
}

export interface Message {
  isPending: any;
  _id: string;
  sender: User;
  recipient: User;
  content: string;
  timestamp: Date | string;
  read: boolean;
  chatRoom?: string;
}

export interface Conversation {
  _id: string;
  user: User;
  lastMessage: Message;
  unreadCount: number;
}

export interface Comment {
  createdAt: string | number | Date;
  author: User;
  _id: string;
  content: any;
}
