# Actions Module Refactoring

## Overview

The `client/src/lib/actions.ts` file (originally 4,693 lines) has been refactored into a modular structure with domain-specific modules. This improves maintainability, readability, and follows the single responsibility principle.

## New Structure

```
client/src/lib/actions/
├── index.ts                    # Re-exports all functions for backward compatibility
├── constants.ts                 # Shared constants (DB_NAME, collections, error messages)
├── shared.ts                   # Shared utilities (ensureAdminAccess, getSessionCookieHeader)
├── auth.ts                     # Authentication functions
├── user.ts                     # User management functions
├── leaderboard.ts              # Leaderboard data functions
├── queue.ts                    # Queue management functions
├── match.ts                    # Match-related functions
├── match/
│   └── helpers.ts              # Match helper functions (starter code generation)
├── problem.ts                  # Problem management functions
├── problem/
│   └── helpers.ts              # Problem helper functions (LeetCode parsing, normalization)
├── bot.ts                      # Bot management functions
├── admin.ts                    # Admin functions (user management, data reset)
└── matchHistory.ts             # Match history functions
```

## Module Breakdown

### `constants.ts`
- Database name and collection constants
- Error message constants
- Type definitions (User interface)

### `shared.ts`
- `ensureAdminAccess()` - Admin access validation
- `getSessionCookieHeader()` - Session cookie header generation

### `auth.ts`
- `getSession()` - Get current session
- `registerUser()` - User registration
- `loginUser()` - User login
- `logoutUser()` - User logout
- `changePassword()` - Password change

### `user.ts`
- `getUserStatsCached()` - Get user statistics (cached)
- `getUserActivityCached()` - Get user activity (cached)
- `saveUserAvatar()` - Save user avatar
- `getAvatarByIdAction()` - Get avatar by user/bot ID
- `generatePresignedUploadUrl()` - Generate presigned upload URL

### `leaderboard.ts`
- `getLeaderboardData()` - Get leaderboard data with pagination

### `queue.ts`
- `enqueueUser()` - Enqueue user for matchmaking
- `dequeueUser()` - Dequeue user from matchmaking
- `consumeReservation()` - Consume match reservation
- `clearReservation()` - Clear match reservation

### `match.ts`
- `getMatchData()` - Get match data for a specific match
- `finalizeMatch()` - Finalize a match
- `persistMatchFromState()` - Persist match state to MongoDB
- `setMatchUserCode()` - Set user code for a match
- `getMatchUserCode()` - Get user code for a match
- `getAllMatchUserCode()` - Get all user code for a match
- `initMatchStateInCache()` - Initialize match state in Redis
- `getMatchStateFromCache()` - Get match state from Redis
- `setMatchUserCodeInCache()` - Set user code in Redis cache
- `addMatchSubmissionToCache()` - Add submission to Redis cache
- `finishMatchInCache()` - Finish match in Redis cache
- `selectRandomProblem()` - Select random problem by difficulty
- `selectProblemForMatch()` - Select problem for match based on ratings
- `getOngoingMatchesCount()` - Get count of ongoing matches
- `getActiveMatches()` - Get active matches (admin)

### `match/helpers.ts`
- `generateStarterCode()` - Generate starter code from function signature
- `convertToJavaType()` - Convert type to Java type
- `convertToCppType()` - Convert type to C++ type
- `getJavaDefaultReturn()` - Get Java default return value
- `getCppDefaultReturn()` - Get C++ default return value

### `problem.ts`
- `fetchLeetCodeProblemDetails()` - Fetch problem details from LeetCode
- `generateProblem()` - Generate problem using OpenAI
- `legacyGenerateProblem()` - Legacy problem generation (wrapper)
- `verifyProblemSolutions()` - Verify problem solutions against test cases
- `getUnverifiedProblems()` - Get unverified problems
- `getProblemById()` - Get problem by ID
- `updateProblem()` - Update problem details
- `deleteProblem()` - Delete a problem
- `getVerifiedProblems()` - Get verified problems

### `problem/helpers.ts`
- LeetCode parsing functions (extractConstraints, extractExamples, etc.)
- Problem generation helpers (applyLinkedListCycleMetadata, etc.)
- Solution normalization functions
- Test case normalization functions

### `bot.ts`
- `generateBotProfile()` - Generate bot profile using OpenAI
- `generateBotAvatar()` - Generate bot avatar
- `initializeBotsCollection()` - Initialize bots collection
- `getBots()` - Get all bots
- `deployBots()` - Deploy/undeploy bots
- `updateBot()` - Update bot details
- `deleteBot()` - Delete a bot
- `resetBotData()` - Reset bot data
- `deleteAllBots()` - Delete all bots
- `resetBotStats()` - Reset bot statistics
- `setRotationConfig()` - Set bot rotation configuration
- `getRotationStatus()` - Get bot rotation status
- `initializeRotationSystem()` - Initialize bot rotation system

### `admin.ts`
- `resetAllPlayerData()` - Reset all player data (matches, submissions, stats)
- `getUsers()` - Get paginated users with search
- `getTotalUsersCount()` - Get total user count
- `updateUser()` - Update user details
- `getUserById()` - Get user by ID

### `matchHistory.ts`
- `getMatchHistory()` - Get user match history with pagination
- `getMatchDetails()` - Get detailed match information

## Backward Compatibility

The original `actions.ts` file has been replaced with a simple re-export from `actions/index.ts`, ensuring all existing imports continue to work:

```typescript
// Old imports still work
import { registerUser, getMatchData } from '@/lib/actions';

// New imports are also available
import { registerUser } from '@/lib/actions/auth';
import { getMatchData } from '@/lib/actions/match';
```

## Benefits

1. **Improved Maintainability**: Each module has a clear, focused responsibility
2. **Better Organization**: Related functions are grouped together
3. **Easier Testing**: Smaller modules are easier to test
4. **Reduced Cognitive Load**: Developers can focus on specific domains
5. **Better Code Reuse**: Shared utilities are centralized
6. **Easier Navigation**: Finding specific functionality is faster

## Migration Notes

- All existing imports continue to work without changes
- New code can import directly from domain modules for better tree-shaking
- The refactoring maintains 100% backward compatibility

## File Sizes

- Original `actions.ts`: 4,693 lines
- After refactoring:
  - `auth.ts`: ~200 lines
  - `user.ts`: ~260 lines
  - `queue.ts`: ~80 lines
  - `leaderboard.ts`: ~120 lines
  - `match.ts`: ~800 lines
  - `match/helpers.ts`: ~200 lines
  - `problem.ts`: ~750 lines
  - `problem/helpers.ts`: ~833 lines
  - `bot.ts`: ~400 lines
  - `admin.ts`: ~380 lines
  - `matchHistory.ts`: ~280 lines
  - `constants.ts`: ~30 lines
  - `shared.ts`: ~28 lines
  - `index.ts`: ~105 lines

Total: ~4,466 lines (slight reduction due to eliminated duplication)

