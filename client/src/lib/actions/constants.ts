export const DB_NAME = 'codeclashers';
export const USERS_COLLECTION = 'users';
export const SESSIONS_COLLECTION = 'sessions';

export const ADMIN_GUARD_ERROR = 'Admin privileges required';
export const AUTH_REQUIRED_ERROR = 'Authentication required';

export interface User {
  _id?: string;
  username: string;
  email: string;
  password: string;
  profile: {
    firstName: string;
    lastName: string;
    avatar?: string;
    bio?: string;
  };
  stats: {
    totalMatches: number;
    wins: number;
    losses: number;
    draws: number;
    rating: number;
  };
  matchIds?: string[];
  lastLogin: Date;
  createdAt: Date;
  updatedAt: Date;
}

