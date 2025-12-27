# Backend Context Overview

Index for backend documentation covering deployment, development, and architecture.

---

## Core Documentation

| Document | Description |
|----------|-------------|
| `deployment.md` | Complete deployment guide for Kubernetes (k3s) on Oracle Cloud VM |
| `local-development.md` | Local dev environment setup with Docker Desktop or k3s |
| `environment-variables.md` | All environment variables for frontend and backend services |
| `refactoring-plans.md` | Planned refactoring for large "god files" (index.ts, MatchRoom, etc.) |

---

## Feature Deep Dives

| Document | Description |
|----------|-------------|
| `matchmaking-flow.md` | Colyseus queue pairing for humans and bots, Redis key map |
| `bot-lifecycle.md` | Bot service architecture, leader election, deployment rules |
| `judge0-runbook.md` | Submission flow, failure modes, troubleshooting for Judge0 |
| `circuit-breaker-judge0.md` | Circuit breaker for Judge0 with backpressure and graceful degradation |
| `redis-cleanup.md` | Periodic Redis cleanup worker for orphaned keys |
| `debugging.md` | Comprehensive debugging guide for dev and production |

---

## Production Notes

| Document | Description |
|----------|-------------|
| `README-JUDGE0-LIMITATION.md` | ARM64 limitations and mitigation options for Judge0 |

---

## Atomic Operations & Race Condition Fixes

The backend uses atomic operations to prevent race conditions:

1. **Bot Matching** - Uses Lua script (`matchBot.lua`) for atomic user dequeue
2. **ELO Updates** - MongoDB `$inc` operator instead of read-modify-write
3. **Leadership Election** - Atomic `SET NX` with proper error handling
4. **Circuit Breaker** - Protects Judge0 from overload with state machine
5. **Submission Queue** - Rate limiting and backpressure for Judge0 submissions

---

## Modular Architecture

**Bot Service** (`backend/bots/`):
- Split from 1,264-line monolith into focused modules:
  - `index.js` (~200 lines) - Orchestration
  - `lib/config.js` - Configuration & validation
  - `lib/leaderElection.js` - Leadership with error handling
  - `lib/matchmaking.js` - Bot deployment & rotation
  - `lib/apiClient.js` - HTTP client for Colyseus
  - `lib/queueCleanup.js` - Queue cleanup utilities

**Frontend Actions** (completed):
- See `../frontend/refactoring-complete.md` for the completed actions module refactoring

**Remaining Refactoring** (planned):
- See `refactoring-plans.md` for index.ts, MatchRoom.ts, codeRunner.ts, QueueRoom.ts

---

## Quick Reference

### Development
```bash
# Setup local dev environment
./scripts/dev-setup.sh

# View logs
kubectl logs -n codeclashers-dev -f deployment/colyseus

# Restart services
kubectl rollout restart deployment/colyseus -n codeclashers-dev
```

### Production
```bash
# Check pod status
kubectl get pods -n codeclashers

# View logs
kubectl logs -n codeclashers -f deployment/colyseus

# Rollback
kubectl rollout undo deployment/colyseus -n codeclashers
```
