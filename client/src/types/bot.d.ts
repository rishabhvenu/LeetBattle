import { ObjectId } from 'mongodb';

export interface BotDoc {
  _id: ObjectId;
  fullName: string;
  username: string;
  avatar: string; // MinIO URL
  gender: 'male' | 'female';
  stats: {
    rating: number;
    wins: number;
    losses: number;
    draws: number;
    totalMatches: number;
  };
  matchIds: ObjectId[]; // Array of match IDs this bot has participated in
  deployed: boolean; // whether bot is actively queueing
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBotRequest {
  count: number;
  gender?: 'male' | 'female' | 'nonbinary';
  rating?: number;
}

export interface BotListResponse {
  success: boolean;
  bots: BotDoc[];
  error?: string;
}

export interface DeployBotsRequest {
  botIds: string[];
  deploy: boolean; // true to deploy, false to stop
}

export interface BotStats {
  totalBots: number;
  deployedBots: number;
  activeBots: number;
  totalMatches: number;
  averageRating: number;
}
