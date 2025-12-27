# Redis Cleanup Worker

## Overview

The Redis Cleanup Worker is a periodic background job that removes orphaned keys and stale state from Redis to prevent memory leaks and state drift.

**Location**: `backend/colyseus/src/workers/redisCleanup.ts`

## Architecture

The worker runs as part of the Colyseus server process and performs cleanup operations every 5 minutes (configurable).

### Cleanup Operations

1. **Expired Reservations** (`queue:reservation:*`)
   - Removes reservations for rooms that no longer exist
   - Checks against Colyseus presence keys
   - Prevents stale reservations blocking users

2. **Stale Queue Entries** (`queue:elo`)
   - Removes users stuck in queue for >10 minutes without reservations
   - Prevents queue bloat from disconnected clients
   - Handles bot state edge cases

3. **Abandoned Match Keys** (`match:*`)
   - Removes match state keys for finished matches (>1 hour old)
   - Cross-references with MongoDB `matches` collection
   - Cleans up related keys (`match:*:ratings`, `match:*:submissions`)

4. **Orphaned Bot States** (`bots:state:*`)
   - Removes bot state keys for bots not in `bots:deployed` or `bots:active`
   - Prevents memory leaks from crashed bot cycles

## Usage

### Starting the Worker

```typescript
import { startCleanupWorker } from './workers/redisCleanup';

// Start with default 5-minute interval
startCleanupWorker();

// Or customize interval
startCleanupWorker(300000); // 5 minutes in ms
```

### Getting Statistics

```typescript
import { getCleanupWorker } from './workers/redisCleanup';

const worker = getCleanupWorker();
const stats = worker.getStats();

console.log('Cleanup stats:', {
  isRunning: stats.isRunning,
  lastCleanup: stats.lastCleanup,
  totalCleanupsRun: stats.totalCleanupsRun,
  cumulativeStats: stats.cumulativeStats
});
```

### Force Cleanup (Manual Trigger)

```typescript
import { getCleanupWorker } from './workers/redisCleanup';

const worker = getCleanupWorker();
const cycleStats = await worker.forceCleanup();

console.log('Cleaned up:', {
  expiredReservations: cycleStats.expiredReservations,
  staleQueueEntries: cycleStats.staleQueueEntries,
  abandonedMatchKeys: cycleStats.abandonedMatchKeys,
  orphanedBotStates: cycleStats.orphanedBotStates,
  totalKeysRemoved: cycleStats.totalKeysRemoved
});
```

## Configuration

Default values (can be customized via constructor):

```typescript
const worker = new RedisCleanupWorker(300000); // 5 minutes
```

## Monitoring

### Logs

The worker logs cleanup activity:

```
[RedisCleanupWorker] Starting cleanup cycle
[RedisCleanupWorker] Cleanup completed in 1234ms: 42 keys removed 
  (reservations: 12, queue: 5, matches: 20, bots: 5)
```

### Metrics

Track these metrics for production monitoring:

- `totalKeysRemoved` - Total keys cleaned per cycle
- Cleanup duration (logged in ms)
- Per-category counts (reservations, queue, matches, bots)

### Alerting

Consider alerts for:

- Cleanup duration > 10 seconds (indicates large cleanup volume)
- `totalKeysRemoved` > 1000 per cycle (indicates state drift)
- Worker not running (check `isRunning` status)

## Redis Cluster Support

The worker automatically handles both Redis single instance and cluster modes:

- **Single Instance**: Uses standard `SCAN` command
- **Redis Cluster**: Scans each master node individually and aggregates results

## Performance Considerations

- Uses `SCAN` with `COUNT 100` to avoid blocking Redis
- Cleanup is non-blocking (uses cursor-based iteration)
- Default 5-minute interval balances cleanup frequency vs. Redis load
- Each cleanup cycle processes keys in batches

## Troubleshooting

### Worker Not Cleaning Up Keys

1. Check worker is running: `getCleanupWorker().getStats().isRunning`
2. Check last cleanup time: `getCleanupWorker().getStats().lastCleanup`
3. Review logs for errors during cleanup cycle
4. Verify Redis connection is healthy

### High Memory Usage Despite Cleanup

1. Check cleanup interval is appropriate for your traffic
2. Review per-category stats to identify hotspots
3. Consider reducing reservation/match TTLs
4. Verify MongoDB queries are performant (match status lookups)

### Keys Not Being Removed

The worker uses conservative logic to avoid removing active keys:

- **Reservations**: Only removed if room doesn't exist
- **Queue entries**: Only removed if >10 minutes old without reservation
- **Match keys**: Only removed if finished >1 hour ago in MongoDB
- **Bot states**: Only removed if bot not in deployed/active sets

## Related Documentation

- [`backend/overview.md`](./overview.md) - Main backend architecture
- [`backend/bot-lifecycle.md`](./bot-lifecycle.md) - Bot service lifecycle
- [`backend/matchmaking-flow.md`](./matchmaking-flow.md) - Matchmaking flow

