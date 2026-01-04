'use server';

import connectDB, { getMongoClient } from '../mongodb';
import { ObjectId } from 'mongodb';
import { getRedis, RedisKeys } from '../redis';
import { DB_NAME } from './constants';
import { getAvatarByIdAction } from './user';

export async function getMatchHistory(userId: string, page: number = 1, limit: number = 10) {
  try {
    const redis = getRedis();
    const cacheKey = `user:${userId}:matchHistory:${page}`;
    
    // Try cache first - wrap in separate try-catch to prevent Redis errors from blocking MongoDB query
    let cached: string | null = null;
    try {
      cached = await redis.get(cacheKey);
    } catch (redisError: any) {
      console.warn('Redis cache error, falling back to MongoDB:', redisError?.message);
      // Continue to MongoDB - don't let Redis errors block the query
    }
    
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {}
    }

    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    
    const userObjectId = new ObjectId(userId);
    const skip = (page - 1) * limit;
    
    // Get finished matches for the user
    const matches = await db.collection('matches').aggregate([
      {
        $match: {
          playerIds: userObjectId,
          status: 'finished',
          endedAt: { $exists: true }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'playerIds',
          foreignField: '_id',
          as: 'users'
        }
      },
      {
        $lookup: {
          from: 'bots',
          localField: 'playerIds',
          foreignField: '_id',
          as: 'bots'
        }
      },
      {
        $addFields: {
          players: {
            $concatArrays: ['$users', '$bots']
          }
        }
      },
      {
        $lookup: {
          from: 'problems',
          localField: 'problemId',
          foreignField: '_id',
          as: 'problems'
        }
      },
      {
        $addFields: {
          problem: { $arrayElemAt: ['$problems', 0] },
          opponent: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$players',
                  cond: { $ne: ['$$this._id', userObjectId] }
                }
              },
              0
            ]
          },
          currentUser: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$players',
                  cond: { $eq: ['$$this._id', userObjectId] }
                }
              },
              0
            ]
          }
        }
      },
      {
        $addFields: {
          result: {
            $cond: [
              { $eq: ['$winnerUserId', null] },
              'draw',
              {
                $cond: [
                  { $eq: ['$winnerUserId', userObjectId] },
                  'win',
                  'loss'
                ]
              }
            ]
          },
          duration: {
            $subtract: [
              { $toDate: '$endedAt' },
              { $toDate: '$startedAt' }
            ]
          },
          opponentBotStats: {
            $cond: [
              { $ne: ['$botStats', null] },
              {
                $let: {
                  vars: {
                    opponentId: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$playerIds',
                            cond: { $ne: ['$$this', userObjectId] }
                          }
                        },
                        0
                      ]
                    }
                  },
                  in: {
                    $cond: [
                      { $ne: ['$$opponentId', null] },
                      {
                        $arrayElemAt: [
                          {
                            $objectToArray: '$botStats'
                          },
                          {
                            $indexOfArray: [
                              {
                                $map: {
                                  input: { $objectToArray: '$botStats' },
                                  as: 'stat',
                                  in: '$$stat.k'
                                }
                              },
                              { $toString: '$$opponentId' }
                            ]
                          }
                        ]
                      },
                      null
                    ]
                  }
                }
              },
              null
            ]
          }
        }
      },
      {
        $sort: { endedAt: -1 }
      },
      {
        $skip: skip
      },
      {
        $limit: limit
      }
    ]).toArray();

    // Try to get rating changes from Redis for each match
    const formattedMatches = await Promise.all(matches.map(async (match) => {
      
      // Try to get rating changes from Redis match data
      let ratingChange = 0;
      let foundInRedis = false;
      try {
        const matchKey = RedisKeys.matchKey(match._id.toString());
        const matchData = await redis.get(matchKey);
        if (matchData) {
          const parsed = JSON.parse(matchData);
          if (parsed.ratingChanges && parsed.ratingChanges[userId]) {
            ratingChange = parsed.ratingChanges[userId].change || 0;
            foundInRedis = true;
          }
        }
      } catch (error: any) {
        // Ignore Redis errors for rating changes - continue with MongoDB data
        console.warn('Could not fetch rating changes from Redis for match:', match._id.toString(), error?.message);
      }
      
      // Fallback to MongoDB if Redis doesn't have the data
      let ratingBefore = 0;
      let ratingAfter = 0;
      
      // Always check MongoDB for ratingChanges (more reliable than Redis for old matches)
      if (match.ratingChanges && typeof match.ratingChanges === 'object') {
        const userIdStr = userObjectId.toString();
        
        // Try to find rating change data using various key formats
        let rcData = null;
        
        // Try with userId string as key
        if (match.ratingChanges[userIdStr]) {
          rcData = match.ratingChanges[userIdStr];
        }
        // Try finding by any key that might match (fallback)
        else {
          for (const key in match.ratingChanges) {
            if (String(key) === userIdStr || String(key) === String(userObjectId)) {
              rcData = match.ratingChanges[key];
              break;
            }
          }
        }
        
        // Use the found rating change data
        if (rcData) {
          if (!foundInRedis) {
            ratingChange = rcData.change || 0;
          }
          ratingBefore = rcData.old || 0;
          ratingAfter = rcData.new || 0;
        }
      }
      
      // Fetch opponent avatar using centralized function
      let opponentAvatar = null;
      if (match.opponent && match.opponent._id) {
        const avatarResult = await getAvatarByIdAction(match.opponent._id.toString());
        if (avatarResult.success) {
          opponentAvatar = avatarResult.avatar;
        }
      }
      
      // Extract bot stats if opponent is a bot
      let opponentBotStats = null;
      if (match.opponentBotStats && match.opponentBotStats.v) {
        opponentBotStats = {
          submissions: match.opponentBotStats.v.submissions || 0,
          testCasesSolved: match.opponentBotStats.v.testCasesSolved || 0
        };
      }

      return {
        matchId: match._id.toString(),
        opponent: match.opponent ? {
          userId: match.opponent._id.toString(),
          username: match.opponent.username,
          avatar: opponentAvatar,
          rating: match.opponent.stats?.rating || 1200,
          botStats: opponentBotStats
        } : null,
        problem: {
          title: match.problem?.title || 'Unknown Problem',
          difficulty: match.problem?.difficulty || 'Medium',
          topics: match.problem?.topics || []
        },
        result: match.result,
        ratingChange: ratingChange,
        ratingBefore: ratingBefore,
        ratingAfter: ratingAfter,
        duration: match.duration,
        endedAt: match.endedAt,
        startedAt: match.startedAt
      };
    }));

    const result = {
      matches: formattedMatches,
      page,
      limit,
      hasMore: formattedMatches.length === limit
    };

    // Cache for 5 minutes - wrap in try-catch to prevent Redis errors from blocking response
    try {
      await redis.setex(cacheKey, 300, JSON.stringify(result));
    } catch (cacheError: any) {
      console.warn('Failed to cache match history:', cacheError?.message);
      // Continue - caching failure shouldn't block the response
    }
    
    return result;
  } catch (error: any) {
    console.error('Error fetching match history:', error);
    return {
      matches: [],
      page,
      limit,
      hasMore: false,
      error: 'Failed to fetch match history'
    };
  }
}

export async function getMatchDetails(matchId: string, userId: string) {
  try {
    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    
    const userObjectId = new ObjectId(userId);
    const matchObjectId = new ObjectId(matchId);
    
    // Get match details with populated data
    const match = await db.collection('matches').aggregate([
      {
        $match: { _id: matchObjectId }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'playerIds',
          foreignField: '_id',
          as: 'users'
        }
      },
      {
        $lookup: {
          from: 'bots',
          localField: 'playerIds',
          foreignField: '_id',
          as: 'bots'
        }
      },
      {
        $addFields: {
          players: {
            $concatArrays: ['$users', '$bots']
          }
        }
      },
      {
        $lookup: {
          from: 'problems',
          localField: 'problemId',
          foreignField: '_id',
          as: 'problems'
        }
      },
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionIds',
          foreignField: '_id',
          as: 'submissions'
        }
      },
      {
        $addFields: {
          problem: { $arrayElemAt: ['$problems', 0] },
          currentUser: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$players',
                  cond: { $eq: ['$$this._id', userObjectId] }
                }
              },
              0
            ]
          },
          opponent: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$players',
                  cond: { $ne: ['$$this._id', userObjectId] }
                }
              },
              0
            ]
          }
        }
      }
    ]).toArray();

    if (!match[0]) {
      return { success: false, error: 'Match not found' };
    }

    const matchData = match[0];
    
    // Get submission stats for both players
    const userSubmissions = matchData.submissions.filter((s: { userId: { toString: () => string } }) => 
      s.userId.toString() === userId
    );
    const opponentSubmissions = matchData.submissions.filter((s: { userId: { toString: () => string } }) => 
      s.userId.toString() !== userId
    );

    const getUserStats = (submissions: Array<{ testResults?: Array<{ status: number }> }>) => {
      const bestSubmission = submissions.reduce((best, sub) => {
        const passed = sub.testResults?.filter((t) => t.status === 3).length || 0;
        const bestPassed = best?.testResults?.filter((t) => t.status === 3).length || 0;
        return passed > bestPassed ? sub : best;
      }, null);

      const testsPassed = bestSubmission?.testResults?.filter((t) => t.status === 3).length || 0;
      const totalTests = bestSubmission?.testResults?.length || 0;

      return {
        submissionsCount: submissions.length,
        testsPassed,
        totalTests,
      };
    };

    const userStats = getUserStats(userSubmissions);
    const opponentStats = getUserStats(opponentSubmissions);

    // Extract bot stats if opponent is a bot
    let opponentBotStats = null;
    if (matchData.botStats && matchData.opponent) {
      const opponentId = matchData.opponent._id.toString();
      if (matchData.botStats[opponentId]) {
        opponentBotStats = {
          submissions: matchData.botStats[opponentId].submissions || 0,
          testCasesSolved: matchData.botStats[opponentId].testCasesSolved || 0
        };
      }
    }

    // Fetch avatars using centralized function
    let currentUserAvatar = null;
    let opponentAvatar = null;
    
    const currentUserAvatarResult = await getAvatarByIdAction(userId);
    if (currentUserAvatarResult.success) {
      currentUserAvatar = currentUserAvatarResult.avatar;
    }
    
    // Check if opponent exists before accessing their avatar
    if (matchData.opponent && matchData.opponent._id) {
      const opponentAvatarResult = await getAvatarByIdAction(matchData.opponent._id.toString());
      if (opponentAvatarResult.success) {
        opponentAvatar = opponentAvatarResult.avatar;
      }
    }

    // Get ratingChanges from match document (stored when match ended)
    // Format: { userId: { change: number, old: number, new: number } }
    const matchRatingChanges = matchData.ratingChanges || {};
    const userIdStr = userId;
    const opponentIdStr = matchData.opponent?._id.toString();
    
    // Get ratings from match document ratingChanges (these are the actual match ratings)
    const currentUserRatingBefore = matchRatingChanges[userIdStr]?.old || matchData.currentUser.stats?.rating || 1200;
    const currentUserRatingAfter = matchRatingChanges[userIdStr]?.new || matchData.currentUser.stats?.rating || 1200;
    const currentUserRatingChange = matchRatingChanges[userIdStr]?.change || 0;
    
    const opponentRatingBefore = opponentIdStr ? (matchRatingChanges[opponentIdStr]?.old || matchData.opponent?.stats?.rating || 1200) : 1200;
    const opponentRatingAfter = opponentIdStr ? (matchRatingChanges[opponentIdStr]?.new || matchData.opponent?.stats?.rating || 1200) : 1200;
    const opponentRatingChange = opponentIdStr ? (matchRatingChanges[opponentIdStr]?.change || 0) : 0;

    const result = {
      success: true,
      matchId,
      problem: {
        title: matchData.problem?.title || 'Unknown Problem',
        difficulty: matchData.problem?.difficulty || 'Medium',
        topics: matchData.problem?.topics || [],
        description: matchData.problem?.description || ''
      },
      result: matchData.winnerUserId === null ? 'draw' : 
             matchData.winnerUserId.toString() === userId ? 'win' : 'loss',
      duration: new Date(matchData.endedAt).getTime() - new Date(matchData.startedAt).getTime(),
      startedAt: matchData.startedAt,
      endedAt: matchData.endedAt,
      players: {
        currentUser: {
          userId: matchData.currentUser._id.toString(),
          username: matchData.currentUser.username,
          avatar: currentUserAvatar,
          ratingBefore: currentUserRatingBefore,
          ratingAfter: currentUserRatingAfter,
          ratingChange: currentUserRatingChange,
          ...userStats
        },
        opponent: matchData.opponent ? {
          userId: matchData.opponent._id.toString(),
          username: matchData.opponent.username,
          avatar: opponentAvatar,
          ratingBefore: opponentRatingBefore,
          ratingAfter: opponentRatingAfter,
          ratingChange: opponentRatingChange,
          ...opponentStats,
          botStats: opponentBotStats
        } : null
      }
    };

    return result;
  } catch (error) {
    console.error('Error fetching match details:', error);
    return { success: false, error: 'Failed to fetch match details' };
  }
}

