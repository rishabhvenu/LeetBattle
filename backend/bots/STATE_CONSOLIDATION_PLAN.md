# Bot State Consolidation - Migration Guide

## Current State (Before Consolidation)

Bot state is currently fragmented across 8+ Redis keys:

```
1. bots:deployed          (SET)     - Bots that should be queueing
2. bots:active            (SET)     - Bots in active matches
3. bots:cycling           (SET)     - Bots with active deployment cycle
4. bots:cycling:{id}      (STRING)  - TTL-based cycling guard (duplicate)
5. bots:state:{id}        (STRING)  - Lifecycle state: queued/matched/playing
6. bot:current_match:{id} (STRING)  - Current match pointer
7. queue:elo              (ZSET)    - Queue membership with ELO score
8. queue:reservation:{id} (STRING)  - Match reservation data
```

## Problems with Current Architecture

1. **Synchronization Issues**: Each cleanup path must update 6-8 keys atomically
2. **Race Conditions**: Partial updates when errors occur mid-cleanup
3. **Debugging Complexity**: Must check 8 locations to understand bot state
4. **Code Duplication**: Every function repeats the same cleanup pattern
5. **Dual Guards**: Both `bots:cycling` SET and `bots:cycling:{id}` TTL exist

## Proposed Consolidated State

Consolidate into a single hash per bot with TTL:

```redis
HSET bots:state:{botId}
  status            "idle|deployed|queued|matched|playing"
  deployedAt        timestamp (null if not deployed)
  queuedAt          timestamp (null if not in queue)
  matchId           matchId (null if not in match)
  reservationExpiry timestamp (null if no reservation)
  rating            current ELO (for quick lookups)
  lastUpdate        timestamp of last state change
```

Keep minimal index structures:
```redis
bots:deployed       (SET) - Index of deployed bots only
bots:active         (SET) - Index of active bots only  
queue:elo           (ZSET) - Queue membership (unchanged for matchmaking)
```

## Migration Strategy

### Phase 1: Dual Write (Current Sprint)

**Status**: ✅ COMPLETED - Error handling improved, ready for Phase 2

1. ✅ Fix critical P0 bugs (timeout, race conditions, fire-and-forget)
2. ✅ Add proper error logging (safeRedisOp helper)
3. ✅ Add circuit breaker for API calls
4. ✅ Add health endpoint and metrics
5. ⏸️ Ready for Phase 2

### Phase 2: Add Consolidated State (Next Sprint)

1. Create helper functions for consolidated state:
   ```javascript
   // redisHelpers.js additions
   async function getBotState(redis, botId) {
     const state = await redis.hgetall(`bots:state:${botId}`);
     return state ? {
       status: state.status || 'idle',
       deployedAt: state.deployedAt ? parseInt(state.deployedAt) : null,
       queuedAt: state.queuedAt ? parseInt(state.queuedAt) : null,
       matchId: state.matchId || null,
       reservationExpiry: state.reservationExpiry ? parseInt(state.reservationExpiry) : null,
       rating: state.rating ? parseInt(state.rating) : null,
       lastUpdate: state.lastUpdate ? parseInt(state.lastUpdate) : null
     } : null;
   }
   
   async function setBotState(redis, botId, updates) {
     const now = Date.now();
     const fields = {
       ...updates,
       lastUpdate: now.toString()
     };
     await redis.hset(`bots:state:${botId}`, fields);
     await redis.expire(`bots:state:${botId}`, 3600); // 1 hour TTL
   }
   
   async function clearBotState(redis, botId) {
     await redis.del(`bots:state:${botId}`);
   }
   ```

2. Update all write paths to BOTH old and new state
   - deployBot(): Write to both `bots:deployed` SET and consolidated hash
   - queueBot(): Write to both `bots:state:{id}` STRING and hash
   - Match creation: Update both current_match and hash

3. Add validation: Periodically check old vs new state matches
   ```javascript
   async function validateBotState(redis, botId) {
     const consolidated = await getBotState(redis, botId);
     const legacy = {
       deployed: await redis.sismember('bots:deployed', botId),
       active: await redis.sismember('bots:active', botId),
       state: await redis.get(`bots:state:${botId}`),
       currentMatch: await redis.get(`bot:current_match:${botId}`)
     };
     
     // Log mismatches
     if (consolidated.status === 'deployed' && !legacy.deployed) {
       console.warn(`State mismatch for bot ${botId}: consolidated says deployed but not in SET`);
     }
   }
   ```

### Phase 3: Read from Consolidated State (Sprint +1)

1. Update all read paths to use consolidated state
2. Keep writing to both old and new (dual write continues)
3. Monitor for any issues in production

### Phase 4: Remove Legacy State (Sprint +2)

1. Stop writing to old keys
2. Clean up old keys from Redis
3. Remove legacy helper functions
4. Update documentation

## Code Changes Required

### Files to Modify

1. `backend/bots/lib/redisHelpers.js` - Add consolidated state helpers
2. `backend/bots/lib/matchmaking.js` - Update deployBot, queueBot, rotateBot
3. `backend/colyseus/src/rooms/QueueRoom.ts` - Update match creation
4. `backend/colyseus/src/rooms/MatchRoom.ts` - Update match lifecycle
5. `backend/colyseus/src/lib/redis.ts` - Add new RedisKeys

### Testing Strategy

1. **Unit Tests**: Test consolidated state helpers
2. **Integration Tests**: Test dual-write consistency
3. **Load Tests**: Ensure no performance regression
4. **Canary Deployment**: Roll out to 10% of instances first
5. **Monitoring**: Watch for state mismatches in logs

## Rollback Plan

If issues arise:

1. **Phase 2**: Simply stop dual-writing, continue using old state only
2. **Phase 3**: Switch reads back to old state (one-line config change)
3. **Phase 4**: Restore dual-write and revert Phase 4 changes

## Benefits After Migration

1. **Atomic Updates**: Single HSET is atomic, no partial state
2. **Easier Debugging**: One place to check bot state
3. **Cleaner Code**: Single helper function replaces 50+ lines
4. **Better Performance**: Fewer Redis operations per bot operation
5. **Automatic Cleanup**: TTL on hash auto-expires stale state

## Estimated Timeline

- Phase 2: 2-3 days (add consolidated state with dual write)
- Phase 3: 1-2 days (switch reads to consolidated state)
- Phase 4: 1 day (remove legacy state)
- Buffer: 2 days (testing, monitoring, fixes)

**Total**: 6-8 days across 3 sprints

## Decision

Given the scope and risk, **state consolidation should be done in a future sprint** after:
1. Current P0/P1 fixes are tested in production
2. Health endpoint and metrics are validated
3. Team has bandwidth for careful testing and monitoring

For now, the improved error handling (safeRedisOp) and cleanupBotState helper significantly reduce the issues caused by state fragmentation.

## Status

- ⏸️ **DEFERRED TO FUTURE SPRINT** - Prerequisites completed, ready to proceed when prioritized
- ✅ All P0/P1 fixes completed
- ✅ Error handling framework in place
- ✅ Health and metrics available for monitoring

