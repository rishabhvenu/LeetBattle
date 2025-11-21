# Colyseus Index.ts Refactoring Plan

## Overview

The `backend/colyseus/src/index.ts` file (2,579 lines) needs to be split into modular components for better maintainability.

## Planned Structure

```
backend/colyseus/src/
├── index.ts                    # Main entry point (server setup, room definitions)
├── config.ts                   # Configuration (Redis, OpenAI, S3 clients) ✅ Created
├── helpers.ts                  # Helper functions (participant stats, bot generation, etc.)
└── routes/
    ├── guest.ts               # Guest user routes
    ├── admin.ts               # Admin routes (bots, validation, etc.)
    ├── queue.ts               # Queue management routes
    ├── match.ts               # Match data routes
    ├── private.ts             # Private room routes
    └── problems.ts            # Problem listing routes
```

## Module Breakdown

### `config.ts` ✅
- Redis configuration (parseClusterEndpoints, buildRedisScalingConfig)
- Redis presence and driver creation
- OpenAI client initialization
- S3 client initialization
- Reservation secret resolution
- Database name and production flag

### `helpers.ts` (Planned)
- `getBotsInActiveMatches()` - Get bots currently in active matches
- `fetchParticipantStats()` - Fetch participant statistics from MongoDB
- `fetchParticipantIdentity()` - Fetch participant identity (user/bot) from MongoDB
- `generateBotProfiles()` - Generate bot profiles using OpenAI
- `generateBotAvatars()` - Generate bot avatars using DALL-E
- `deleteBotAvatar()` - Delete bot avatar from S3
- `generateRoomCode()` - Generate unique room code for private rooms

### `routes/guest.ts` (Planned)
- `POST /guest/match/create` - Create guest match
- `GET /guest/check` - Check guest session
- `POST /guest/match/claim` - Claim guest match

### `routes/admin.ts` (Planned)
- `POST /admin/bots/rotation/config` - Configure bot rotation
- `GET /admin/bots/rotation/status` - Get bot rotation status
- `POST /admin/bots/rotation/init` - Initialize bot rotation
- `POST /admin/validate-solutions` - Validate problem solutions
- `POST /admin/bots/init` - Initialize bots collection
- `GET /admin/bots` - Get all bots
- `POST /admin/bots/generate` - Generate bot profiles
- `POST /admin/bots/deploy` - Deploy/undeploy bots
- `PUT /admin/bots/:id` - Update bot
- `DELETE /admin/bots/:id` - Delete bot
- `POST /admin/bots/reset` - Reset bot data
- `POST /admin/bots/cleanup-stale` - Cleanup stale bots
- `GET /admin/matches/active` - Get active matches

### `routes/queue.ts` (Planned)
- `POST /queue/enqueue` - Enqueue user
- `POST /queue/dequeue` - Dequeue user
- `GET /queue/size` - Get queue size
- `GET /global/general-stats` - Get general stats
- `GET /queue/reservation` - Get reservation
- `POST /reserve/consume` - Consume reservation
- `POST /queue/clear` - Clear queue

### `routes/match.ts` (Planned)
- `GET /match/snapshot` - Get match snapshot
- `GET /match/submissions` - Get match submissions
- `GET /match/data` - Get match data

### `routes/private.ts` (Planned)
- `POST /private/create` - Create private room
- `POST /private/join` - Join private room
- `GET /private/state` - Get private room state
- `POST /private/leave` - Leave private room
- `POST /private/select-problem` - Select problem for private room

### `routes/problems.ts` (Planned)
- `GET /problems/list` - List problems

## Status

- ✅ `config.ts` created
- ⏳ Remaining modules to be created

## Benefits

1. **Separation of Concerns**: Configuration, helpers, and routes are clearly separated
2. **Easier Testing**: Each module can be tested independently
3. **Better Organization**: Related routes are grouped together
4. **Reduced File Size**: Main index.ts will be much smaller
5. **Improved Maintainability**: Changes to specific routes don't affect other modules

