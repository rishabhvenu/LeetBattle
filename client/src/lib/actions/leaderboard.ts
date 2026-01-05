'use server';

import { getRedis } from '../redis';
import { getMongoClient } from '../mongodb';
import { DB_NAME } from './constants';

export async function getLeaderboardData(page: number = 1, limit: number = 10) {
  // Validate and sanitize inputs
  const validPage = Math.max(1, Math.floor(page));
  const validLimit = Math.max(1, Math.floor(limit));
  
  const cacheKey = `leaderboard:page:${validPage}:limit:${validLimit}`;

  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const usersCollection = db.collection('users');
    const botsCollection = db.collection('bots');

    // Users need at least one match to appear on leaderboard
    const userFilter = { 'stats.totalMatches': { $gt: 0 } };
    // Bots always appear on leaderboard (even with 0 matches)
    const [userCount, botCount] = await Promise.all([
      usersCollection.countDocuments(userFilter),
      botsCollection.countDocuments({}),
    ]);

    const totalEntries = userCount + botCount;
    const totalPages = Math.max(1, Math.ceil(totalEntries / validLimit));
    const skip = (validPage - 1) * validLimit;

    const leaderboardEntries = await usersCollection
      .aggregate([
        { $match: userFilter },
        {
          $project: {
            username: 1,
            stats: 1,
            avatarFromProfile: '$profile.avatar',
            avatarUrl: 1,
          },
        },
        {
          $addFields: {
            avatar: {
              $ifNull: ['$avatarFromProfile', '$avatarUrl'],
            },
            isBot: false,
          },
        },
        { $project: { avatarFromProfile: 0, avatarUrl: 0 } },
        {
          $unionWith: {
            coll: 'bots',
            pipeline: [
              // No filter for bots - include all bots
              {
                $project: {
                  username: 1,
                  stats: 1,
                  avatar: 1,
                  isBot: { $literal: true },
                },
              },
            ],
          },
        },
        {
          $addFields: {
            rating: {
              $round: [{ $ifNull: ['$stats.rating', 1200] }, 0],
            },
          },
        },
        { $sort: { rating: -1 } },
        { $skip: skip },
        { $limit: validLimit },
      ])
      .toArray();

    const usersPage = leaderboardEntries.map((entry) => ({
      _id: String(entry._id),
      username: entry.username || (entry.isBot ? 'Unknown Bot' : 'Unknown'),
      avatar: entry.avatar || null,
      rating: entry.rating ?? 1200,
      stats: {
        gamesWon: entry.stats?.wins || 0,
        gamesLost: entry.stats?.losses || 0,
        gamesDrawn: entry.stats?.draws || 0,
        gamesPlayed: entry.stats?.totalMatches || 0,
      },
      isBot: Boolean(entry.isBot),
    }));

    const payload = { users: usersPage, totalPages };

    // Cache the result for 60 seconds
    await redis.set(cacheKey, JSON.stringify(payload), 'EX', 60);

    return payload;
  } catch (err) {
    console.error('Leaderboard server action error', err);
    return { users: [], totalPages: 1 };
  }
}

