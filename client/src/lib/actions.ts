// This file has been refactored into domain-specific modules.
// All exports are re-exported for backward compatibility.
// New code should import directly from the domain modules (e.g., './actions/auth').

// Auth functions
export {
  getSession,
  registerUser,
  loginUser,
  logoutUser,
  changePassword,
} from './actions/auth';

// User functions
export {
  getUserStatsCached,
  getUserActivityCached,
  saveUserAvatar,
  getAvatarByIdAction,
  generatePresignedUploadUrl,
} from './actions/user';

// Leaderboard
export {
  getLeaderboardData,
} from './actions/leaderboard';

// Queue functions
export {
  enqueueUser,
  dequeueUser,
  consumeReservation,
  clearReservation,
} from './actions/queue';

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
  forceBotWin,
} from './actions/match';

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
} from './actions/problem';

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
} from './actions/bot';

// Admin functions
export {
  resetAllPlayerData,
  getUsers,
  getTotalUsersCount,
  updateUser,
  getUserById,
} from './actions/admin';

// Match history functions
export {
  getMatchHistory,
  getMatchDetails,
} from './actions/matchHistory';

// Types and constants
export type { User } from './actions/constants';
export { DB_NAME, USERS_COLLECTION, SESSIONS_COLLECTION, ADMIN_GUARD_ERROR, AUTH_REQUIRED_ERROR } from './actions/constants';
