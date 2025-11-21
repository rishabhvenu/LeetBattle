# Matchmaking Flow Deep Dive

This document explains how the Colyseus `QueueRoom` orchestrates matchmaking,
how Redis state is used, and the safeguards in place when pairing humans and
bots. Use it when debugging queue behaviour, unexpected bot matches, or rating
discrepancies.

## Overview

- Entry point: `backend/colyseus/src/rooms/QueueRoom.ts`
- Runs a matchmaking loop every 5 seconds (see `onCreate`)
- Uses Redis sorted set `queue:elo` (via `RedisKeys.eloQueue`) to store queued
  players keyed by `userId` and scored by rating
- Human presence is tracked in sets `queue:humans` and `queuedPlayersSet`
- Bot fallbacks are coordinated via Redis pub/sub channel
  `RedisKeys.botsCommandsChannel`
- Emergency bot deployment timers fire if a human waits longer than
  `QUEUE_BOT_MATCH_DELAY_MS` (default 45s)

## Queue Join Flow

Checklist when a player joins:

1. Validate connection and store `userId -> client` mapping
2. Check reservation key `queue:reservation:${userId}` to avoid duplicate
   matches
3. Ensure the player is not already in Redis queue or processing set
4. Store joined timestamp in `queue:joined:${userId}` (TTL 1 hour)
5. For humans:
   - Add to human tracking sets via `addHumanPlayer`
   - Publish `playerQueued` command to bot service
6. Schedule emergency bot deployment timer for humans

If duplicates occur, the room sends `queued` message without re-adding.

## Matchmaking Cycle

Every 5 seconds `runMatchmakingCycle()` does:

- Prevent overlapping runs via `matchmakingInProgress`
- Load all queued entries (`zrange` + `zscore` lookups)
- Attempt human-human matches first:
  - For each player compute wait time and dynamic ELO threshold
  - `getEloThreshold(waitTime)` expands tolerance from ±50 to ±250 by 45s
  - Use `findCompatibleMatch` to pick the closest rating match
  - Pair players by removing both from Redis and calling `createMatch`
- If no human match is found, schedule bots:
  - Checks `bots:queued` and `bots:active` sets
  - Nudges bot service by publishing `bots:nudges` if needed

### Emergency Bot Deployment

- Timer per human triggered in `scheduleEmergencyBotDeployment`
- If no human match within `QUEUE_BOT_MATCH_DELAY_MS` (45s), enqueue bot request
  via Redis channel and mark `noBotCycles`
- Cancels automatically once human leaves queue or match is created

## Redis Keys Snapshot

| Key | Type | Purpose |
|-----|------|---------|
| `queue:elo` (alias `RedisKeys.eloQueue`) | sorted set | players awaiting match (`userId` score = rating) |
| `queue:reservation:${userId}` | string | serialized reservation info returned to client |
| `queue:joined:${userId}` | string (TTL 1h) | queue entry timestamp for wait-time calculations |
| `queue:humans` | set | human players currently queued |
| `bots:deployed` | set | bots launched by bot service |
| `bots:queued` | set | bots currently queued |
| `bots:active` | set | bots in active match |
| `bots:commands` | pub/sub | notifications to bot service |
| `bots:nudges` | pub/sub | requests for emergency bot deployment |

## Debugging Tips

- **Check queue contents:** `redis-cli zrange queue:elo 0 -1 WITHSCORES`
- **Inspect human tracking:** `redis-cli smembers queue:humans`
- **Confirm timers:** look for logs `🧵 Scheduling emergency bot deployment`
- **Match not created:** ensure `createMatch` resolved; check server logs for
  errors before `✅ Created match` log
- **Bots not arriving:** verify bot service leadership, inspect
  `bots:rotation:config` and `bots:nudges` metrics

## Related Files

- `backend/colyseus/src/lib/matchCreation.ts` – actual match creation workflow
- `backend/bots/index.js` – bot service that responds to queue commands
- `context/backend/bot-lifecycle.md` – deeper dive on bot orchestration


