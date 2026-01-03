/**
 * Stats Helper Functions
 * Extracted from index.ts to improve modularity
 */

import { Db, ObjectId } from 'mongodb';

export type ParticipantStats = {
  rating: number;
  wins: number;
  losses: number;
  totalMatches: number;
  globalRank: number;
};

export type ParticipantIdentity = {
  username: string;
  fullName: string;
  avatar: string | null;
};

/**
 * Fetch participant statistics from database
 * Handles users, bots, and guests
 */
export async function fetchParticipantStats(userId: string, db: Db): Promise<ParticipantStats> {
  const defaultStats: ParticipantStats = {
    rating: 1200,
    wins: 0,
    losses: 0,
    totalMatches: 0,
    globalRank: 1234,
  };

  if (!userId || userId.startsWith('guest_')) {
    return defaultStats;
  }

  // Check if it's a bot
  const botsCollection = db.collection('bots');
  const usersCollection = db.collection('users');

  let participant: any = null;

  if (ObjectId.isValid(userId)) {
    participant = await botsCollection.findOne({ _id: new ObjectId(userId) });
    
    if (!participant) {
      participant = await usersCollection.findOne({ _id: new ObjectId(userId) });
    }
  }

  if (!participant) {
    return defaultStats;
  }

  // For bots, use bot.stats
  if (participant.isBot === true || participant.stats) {
    const stats = participant.stats || {};
    const rating = stats.rating ?? 1200;
    const wins = stats.wins ?? 0;
    const losses = stats.losses ?? 0;
    const totalMatches = stats.totalMatches ?? 0;

    // Calculate global rank (position among all users/bots with same or higher rating)
    const higherUsersCount = await usersCollection.countDocuments({
      'profile.rating': { $gt: rating },
    });
    const higherBotsCount = await botsCollection.countDocuments({
      'stats.rating': { $gt: rating },
    });
    const higherUsers = higherUsersCount + higherBotsCount;

    return {
      rating,
      wins,
      losses,
      totalMatches,
      globalRank: higherUsers + 1,
    };
  }

  // For regular users, use user.profile
  const profile = participant.profile || {};
  const rating = profile.rating ?? 1200;
  const wins = profile.wins ?? 0;
  const losses = profile.losses ?? 0;
  const totalMatches = profile.totalMatches ?? 0;

  // Calculate global rank
  const higherUsers = await usersCollection.countDocuments({
    'profile.rating': { $gt: rating },
  });

  return {
    rating,
    wins,
    losses,
    totalMatches,
    globalRank: higherUsers + 1,
  };
}

/**
 * Fetch participant identity (username, full name, avatar)
 * Handles users, bots, and guests
 */
export async function fetchParticipantIdentity(userId: string, db: Db): Promise<ParticipantIdentity> {
  // #region agent log
  console.log(`[DEBUG] fetchParticipantIdentity called - userId: ${userId}, hypothesisId: B`);
  // #endregion

  if (!userId) {
    // #region agent log
    console.log(`[DEBUG] fetchParticipantIdentity - userId is empty/null, returning defaults, hypothesisId: B`);
    // #endregion
    return { username: 'Opponent', fullName: 'Opponent', avatar: null };
  }

  if (userId.startsWith('guest_')) {
    return { username: 'Guest', fullName: 'Guest User', avatar: null };
  }

  if (!ObjectId.isValid(userId)) {
    // #region agent log
    console.log(`[DEBUG] fetchParticipantIdentity - userId not valid ObjectId: ${userId}, hypothesisId: B`);
    // #endregion
    return { username: 'Opponent', fullName: 'Opponent', avatar: null };
  }

  // Check bots first
  const botsCollection = db.collection('bots');
  const bot = await botsCollection.findOne({ _id: new ObjectId(userId) });
  
  // #region agent log
  console.log(`[DEBUG] fetchParticipantIdentity - bot lookup result: ${bot ? `found (${bot.username})` : 'not found'}, userId: ${userId}, hypothesisId: C,E`);
  // #endregion
  
  if (bot) {
    return {
      username: bot.username || 'Bot',
      fullName: bot.fullName || bot.username || 'Bot',
      avatar: bot.avatar || null,
    };
  }

  // Check users
  const usersCollection = db.collection('users');
  const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
  
  // #region agent log
  console.log(`[DEBUG] fetchParticipantIdentity - user lookup result: ${user ? `found (${user.username})` : 'not found'}, userId: ${userId}, hypothesisId: C,E`);
  // #endregion
  
  if (user) {
    return {
      username: user.username || 'User',
      fullName: user.fullName || user.username || 'User',
      avatar: user.avatar || null,
    };
  }

  // #region agent log
  console.log(`[DEBUG] fetchParticipantIdentity - participant not found in bots or users, userId: ${userId}, hypothesisId: E`);
  // #endregion
  return { username: 'Opponent', fullName: 'Opponent', avatar: null };
}

/**
 * Fetch stats for multiple participants in parallel
 */
export async function fetchMultipleParticipantStats(
  userIds: string[],
  db: Db
): Promise<Map<string, ParticipantStats>> {
  const statsMap = new Map<string, ParticipantStats>();
  
  const promises = userIds.map(async (userId) => {
    const stats = await fetchParticipantStats(userId, db);
    return { userId, stats };
  });

  const results = await Promise.all(promises);
  
  results.forEach(({ userId, stats }) => {
    statsMap.set(userId, stats);
  });

  return statsMap;
}

/**
 * Fetch identities for multiple participants in parallel
 */
export async function fetchMultipleParticipantIdentities(
  userIds: string[],
  db: Db
): Promise<Map<string, ParticipantIdentity>> {
  const identitiesMap = new Map<string, ParticipantIdentity>();
  
  const promises = userIds.map(async (userId) => {
    const identity = await fetchParticipantIdentity(userId, db);
    return { userId, identity };
  });

  const results = await Promise.all(promises);
  
  results.forEach(({ userId, identity }) => {
    identitiesMap.set(userId, identity);
  });

  return identitiesMap;
}

