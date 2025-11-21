'use server';

// Re-export all functions from domain modules for backward compatibility
// This allows existing imports like `import { registerUser } from '@/lib/actions'` to continue working

// Auth functions
export {
  getSession,
  registerUser,
  loginUser,
  logoutUser,
  changePassword,
} from './auth';

// User functions
export {
  getUserStatsCached,
  getUserActivityCached,
  saveUserAvatar,
  getAvatarByIdAction,
  generatePresignedUploadUrl,
} from './user';

// Leaderboard
export {
  getLeaderboardData,
} from './leaderboard';

// Queue functions
export {
  enqueueUser,
  dequeueUser,
  consumeReservation,
  clearReservation,
} from './queue';

// Match functions
export {
  getMatchData,
  finalizeMatch,
  persistMatchFromState,
  setMatchUserCode,
  getMatchUserCode,
  getAllMatchUserCode,
  initMatchStateInCache,
  getMatchStateFromCache,
  setMatchUserCodeInCache,
  addMatchSubmissionToCache,
  finishMatchInCache,
  selectRandomProblem,
  selectProblemForMatch,
  getOngoingMatchesCount,
  getActiveMatches,
} from './match';

// Problem functions
export {
  fetchLeetCodeProblemDetails,
  generateProblem,
  legacyGenerateProblem,
  verifyProblemSolutions,
  getUnverifiedProblems,
  getProblemById,
  updateProblem,
  deleteProblem,
  getVerifiedProblems,
} from './problem';

// Bot functions
export {
  generateBotProfile,
  generateBotAvatar,
  initializeBotsCollection,
  getBots,
  deployBots,
  updateBot,
  deleteBot,
  resetBotData,
  deleteAllBots,
  resetBotStats,
  setRotationConfig,
  getRotationStatus,
  initializeRotationSystem,
} from './bot';

// Admin functions
export {
  resetAllPlayerData,
  getUsers,
  getTotalUsersCount,
  updateUser,
  getUserById,
} from './admin';

// Match history functions
export {
  getMatchHistory,
  getMatchDetails,
} from './matchHistory';

// Types and constants
export type { User } from './constants';
export { DB_NAME, USERS_COLLECTION, SESSIONS_COLLECTION, ADMIN_GUARD_ERROR, AUTH_REQUIRED_ERROR } from './constants';

