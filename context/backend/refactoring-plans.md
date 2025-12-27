# Backend Refactoring Plans

This document outlines the refactoring plans for large "god files" in the Colyseus backend. These files mix multiple responsibilities and should be split into focused modules.

---

## Overview

| File | Current Size | Target Size | Status |
|------|-------------|-------------|--------|
| `index.ts` | 2,726 lines | ~150 lines | ⏳ Planned |
| `MatchRoom.ts` | 2,333 lines | ~300 lines | ⏳ Planned |
| `codeRunner.ts` | 1,201 lines | ~100 lines | ⏳ Planned |
| `QueueRoom.ts` | 1,074 lines | ~200 lines | ⏳ Planned |

---

## 1. index.ts Refactoring

**Current Location**: `backend/colyseus/src/index.ts`  
**Problem**: God file mixing server setup, routes, helpers, and configuration

### Proposed Structure

```
backend/colyseus/src/
├── index.ts                      # ~150 lines (main entry point)
├── config.ts                     # Already exists ✅
├── helpers/
│   ├── botHelpers.ts            # Bot profile/avatar generation
│   ├── statsHelpers.ts          # Participant stats/identity fetching
│   ├── roomHelpers.ts           # Room code generation
│   └── redisHelpers.ts          # Redis configuration helpers
└── routes/
    ├── guest.ts                 # Guest user routes
    ├── admin.ts                 # Admin routes
    ├── queue.ts                 # Queue management
    ├── match.ts                 # Match data
    ├── private.ts               # Private room routes
    └── problems.ts              # Problem listing
```

### Helper Modules

**helpers/redisHelpers.ts** (~100 lines)
- `parseClusterEndpoints()`
- `buildRedisScalingConfig()`
- `createRedisPresence()`
- `createRedisDriver()`

**helpers/botHelpers.ts** (~200 lines)
- `getBotsInActiveMatches()`
- `generateBotProfile()`
- `generateBotAvatar()`
- `deleteBotAvatar()`

**helpers/statsHelpers.ts** (~150 lines)
- `fetchParticipantStats()`
- `fetchParticipantIdentity()`

**helpers/roomHelpers.ts** (~100 lines)
- `generateRoomCode()`
- `validateRoomCode()`

### Route Modules

| Module | Routes |
|--------|--------|
| `routes/guest.ts` | `POST /guest/match/create`, `GET /guest/check`, `POST /guest/match/claim` |
| `routes/admin.ts` | Bot CRUD, rotation config, validation, active matches |
| `routes/queue.ts` | Enqueue, dequeue, size, reservations, clear |
| `routes/match.ts` | Snapshot, submissions, match data |
| `routes/private.ts` | Create, join, state, leave, select-problem |
| `routes/problems.ts` | Problem listing |

---

## 2. MatchRoom.ts Refactoring

**Current Location**: `backend/colyseus/src/rooms/MatchRoom.ts`  
**Problem**: Single file handles game state, submissions, timers, chat, disconnections

### Proposed Structure

```
backend/colyseus/src/rooms/
├── MatchRoom.ts                    # ~300 lines (orchestration only)
└── match/
    ├── submissionHandler.ts        # Submission logic (~400 lines)
    ├── timerManager.ts             # Match timer lifecycle (~250 lines) ✅ Partially done
    ├── chatHandler.ts              # Chat message handling (~100 lines)
    ├── stateManager.ts             # State updates (~300 lines)
    ├── disconnectionHandler.ts     # Reconnection logic (~200 lines)
    ├── botSimulator.ts             # Bot simulation (~350 lines)
    └── ratingCalculator.ts         # ELO calculations (~200 lines) ✅ Atomic updates done
```

### Module Responsibilities

**submissionHandler.ts**
- `handleTestRun()` - Run code against sample test cases
- `handleCompetitiveSubmit()` - Submit for competitive evaluation
- `getCachedSubmissionResult()` / `cacheSubmissionResult()` - Redis caching

**timerManager.ts**
- Timer tracking with `allTimers` and `allIntervals` Sets
- `createTimeout()` / `createInterval()` - Tracked timer creation
- `clearAll()` - Cleanup on room dispose

**chatHandler.ts**
- `handleChatMessage()` - Process and broadcast messages
- `validateMessage()` - Content validation

**stateManager.ts**
- `updateMatchBlob()` / `getMatchBlob()` - Redis state management
- `persistCode()` / `loadInitialCode()` - User code persistence

**disconnectionHandler.ts**
- `handleClientLeave()` - Process disconnection
- `handleReconnection()` - Restore client state
- `cleanupDisconnectedClient()` - Resource cleanup

**botSimulator.ts**
- `startBotSimulation()` / `stopBotSimulation()`
- Scheduled code/test updates
- `sampleBotCompletionMs()` - Difficulty-based timing

**ratingCalculator.ts** ✅ Atomic updates implemented
- `calculateRatingChanges()` - ELO delta computation
- `persistRatings()` - Atomic MongoDB updates
- `calculateEloChange()` - ELO formula

---

## 3. codeRunner.ts Refactoring

**Current Location**: `backend/colyseus/src/lib/codeRunner.ts`  
**Problem**: Mixes Judge0 API, polling, parsing, caching, code generation

### Proposed Structure

```
backend/colyseus/src/lib/codeRunner/
├── index.ts                    # Main orchestrator (~100 lines)
├── judge0Client.ts             # HTTP API client (~250 lines)
├── pollManager.ts              # Polling logic (~200 lines)
├── resultParser.ts             # Result parsing (~300 lines)
├── cacheManager.ts             # Redis caching (~150 lines)
└── codeGenerator.ts            # Code generation (~200 lines)
```

### Module Responsibilities

**judge0Client.ts**
```typescript
export class Judge0Client {
  private baseUrl: string;
  private submissionQueue: SubmissionQueue; // ✅ Circuit breaker integration
  
  async createSubmission(code: string, languageId: number, stdin: string): Promise<string>;
  async getSubmission(token: string): Promise<SubmissionResult>;
  async getBatchSubmissions(tokens: string[]): Promise<SubmissionResult[]>;
}
```

**pollManager.ts**
```typescript
export class PollManager {
  async pollUntilComplete(token: string, maxAttempts: number): Promise<SubmissionResult>;
  async pollBatch(tokens: string[], maxAttempts: number): Promise<SubmissionResult[]>;
  private shouldRetry(result: SubmissionResult): boolean;
  private getBackoffDelay(attempt: number): number;
}
```

**resultParser.ts**
```typescript
export class ResultParser {
  parseSubmissionResult(raw: any): SubmissionResult;
  formatErrorMessage(result: SubmissionResult): string;
  extractTestCaseResults(output: string, expected: string[]): TestCaseResult[];
  parseCompilerError(stderr: string): CompilerError;
}
```

**cacheManager.ts**
```typescript
export class CacheManager {
  async getCached(cacheKey: string): Promise<SubmissionResult | null>;
  async setCached(cacheKey: string, result: SubmissionResult, ttl: number): Promise<void>;
  generateCacheKey(code: string, languageId: number, stdin: string): string;
}
```

**codeGenerator.ts**
```typescript
export class CodeGenerator {
  generateTestHarness(language: string, functionSig: FunctionSignature, testCases: TestCase[]): string;
  wrapSolutionClass(language: string, code: string, testHarness: string): string;
  generateStdin(testCases: TestCase[]): string;
}
```

---

## 4. QueueRoom.ts Refactoring

**Current Location**: `backend/colyseus/src/rooms/QueueRoom.ts`  
**Problem**: Queue logic mixed with validation, stats, bot integration

### Proposed Structure

```
backend/colyseus/src/rooms/queue/
├── QueueRoom.ts                # ~200 lines (orchestration)
├── queueManager.ts             # Queue data structure (~250 lines)
├── matchmaker.ts               # Matching algorithm (~300 lines)
├── validator.ts                # User validation (~150 lines)
└── statsTracker.ts             # Queue statistics (~150 lines)
```

### Module Responsibilities

**queueManager.ts**
- `enqueue()` / `dequeue()` - Queue operations
- `getQueuePosition()` / `getQueueSize()` - Status queries
- Redis-backed queue storage

**matchmaker.ts**
- `findMatch()` - Rating-based matching
- `createMatch()` - Match room creation
- `calculateRatingDifference()` - Matching criteria
- `selectProblemForMatch()` - Difficulty selection

**validator.ts**
- `validateUser()` - Eligibility checks
- `checkBanStatus()` - Ban verification
- `checkQueueEligibility()` - Queue rules

**statsTracker.ts**
- `trackEnqueue()` / `trackDequeue()` - Event logging
- `trackMatch()` - Match statistics
- `getQueueStats()` - Aggregate metrics

---

## Migration Strategy

### Phase 1: Create Modules (No Breaking Changes)
- Create new module files alongside existing code
- Move code incrementally, one module at a time
- Maintain backward compatibility

### Phase 2: Update Imports
- Update index.ts to use new modules
- Test thoroughly
- Keep old code as fallback

### Phase 3: Cleanup
- Remove old duplicated code
- Update documentation
- Run full test suite

### Phase 4: Validation
- Performance testing
- Memory leak testing
- Integration tests

---

## Success Criteria

- ✅ No files over 500 lines
- ✅ All tests passing
- ✅ Performance maintained or improved
- ✅ Clear module boundaries
- ✅ Documentation updated
- ✅ No memory leaks

---

## Notes

- **Circuit breaker** already implemented in `lib/circuitBreaker.ts` ✅
- **Timer tracking** partially implemented in MatchRoom ✅
- **ELO atomic updates** implemented using MongoDB `$inc` ✅
- Can refactor incrementally (one module at a time)
- Monitor performance during migration
- Keep backward compatibility throughout

