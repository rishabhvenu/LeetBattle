# Environment Variable Fixes - Summary

## Overview

All services have been updated to:
1. ✅ **Remove hardcoded URLs** (localhost, 127.0.0.1, service names)
2. ✅ **Require environment variables** (throw errors if missing)
3. ✅ **Use Kubernetes service names** (from ConfigMap for inter-service communication)
4. ✅ **Use ports from secrets** (all ports configurable)

## Frontend Changes

### Files Modified:
- `client/src/constants/RestEndpoints.tsx`
- `client/src/lib/server-actions.ts`
- `client/src/lib/guest-actions.ts`
- `client/src/lib/actions.ts`
- `client/src/rest/RestHandler.tsx`
- `client/src/lib/redis.ts`

### Changes:
- ❌ Removed: `'http://localhost:2567'` fallbacks
- ✅ Now uses: `NEXT_PUBLIC_API_BASE` → `NEXT_PUBLIC_COLYSEUS_HTTP_URL` → `''` (empty string if missing)
- ❌ Removed: `'127.0.0.1'` Redis fallback
- ✅ Now requires: `REDIS_HOST` and `REDIS_PORT` (throws error if missing)

## Backend Changes

### Colyseus Service

**Files Modified:**
- `backend/colyseus/src/index.ts`
- `backend/colyseus/src/lib/redis.ts`
- `backend/colyseus/src/lib/judge0.ts`
- `backend/colyseus/src/lib/matchCreation.ts`
- `backend/colyseus/src/rooms/MatchRoom.ts`
- `backend/colyseus/src/rooms/PrivateRoom.ts`
- `backend/colyseus/src/lib/problemData.ts`
- `backend/colyseus/src/lib/internalAuth.ts`

**Changes:**
- ❌ Removed: `'127.0.0.1'` Redis fallbacks (3 occurrences)
- ✅ Now requires: `REDIS_HOST` and `REDIS_PORT` (throws error if missing)
- ❌ Removed: `'mongodb://codeclashers-mongodb:27017/codeclashers'` fallbacks (7 occurrences)
- ✅ Now requires: `MONGODB_URI` (throws error if missing)
- ❌ Removed: `'http://codeclashers-judge0:2358'` fallback
- ✅ Now requires: `JUDGE0_URL` (throws error if missing)
- ⚠️ Updated: `CORS_ORIGIN` - still has fallback for dev mode only

### Bots Service

**Files Modified:**
- `backend/bots/index.js`

**Changes:**
- ❌ Removed: `'127.0.0.1'` Redis fallback
- ✅ Now requires: `REDIS_HOST` and `REDIS_PORT` (throws error if missing)
- ❌ Removed: `'mongodb://codeclashers-mongodb:27017/codeclashers'` fallback
- ✅ Now requires: `MONGODB_URI` (throws error if missing)
- ❌ Removed: `'ws://localhost:2567'` fallback
- ✅ Now requires: `COLYSEUS_URL` (throws error if missing)

### Kubernetes Deployments

**Files Modified:**
- `backend/k8s/deployments/colyseus.yaml`
- `backend/k8s/deployments/bots.yaml`
- `backend/k8s/deployments/judge0-server.yaml`
- `backend/k8s/deployments/judge0-worker.yaml`
- `backend/k8s/configmaps/app-config.yaml`

**Changes:**
- ✅ All deployments read ports from secrets (`REDIS_PORT`, `JUDGE0_PORT`, `COLYSEUS_PORT`, `MONGODB_PORT`)
- ✅ Service URLs constructed from env vars:
  - `JUDGE0_URL = "http://$(JUDGE0_HOST):$(JUDGE0_PORT)"`
  - `COLYSEUS_URL = "ws://$(COLYSEUS_HOST):$(COLYSEUS_PORT)"`
- ✅ Added `CORS_ORIGIN` to ConfigMap and Colyseus deployment

## Inter-Service Communication

### Before (Hardcoded):
- ❌ `ws://localhost:2567`
- ❌ `http://codeclashers-judge0:2358`
- ❌ `mongodb://codeclashers-mongodb:27017/codeclashers`
- ❌ `127.0.0.1:6379`

### After (Environment Variables):
- ✅ `ws://$(COLYSEUS_HOST):$(COLYSEUS_PORT)` → `ws://colyseus:2567`
- ✅ `http://$(JUDGE0_HOST):$(JUDGE0_PORT)` → `http://judge0-server:2358`
- ✅ `$(MONGODB_URI)` → `mongodb://mongodb.codeclashers.svc.cluster.local:27017/...`
- ✅ `$(REDIS_HOST):$(REDIS_PORT)` → `redis-cluster:6379`

## Validation

All critical environment variables now:
1. ✅ **Throw errors if missing** - No silent failures
2. ✅ **No localhost/127.0.0.1** - All removed
3. ✅ **No hardcoded service names** - All use env vars
4. ✅ **Dynamic URL construction** - Uses env vars for all URLs

## GitHub Variables/Secrets Required

**Variables:**
- `REDIS_HOST` (default: `redis-cluster`)
- `REDIS_PORT` (default: `6379`)
- `JUDGE0_PORT` (default: `2358`)
- `MONGODB_PORT` (default: `27017`)
- `COLYSEUS_PORT` (default: `2567`)
- `CORS_ORIGIN` (optional, for production)

**Secrets:**
- `REDIS_PASSWORD`
- `MONGODB_URI` (external connection string)
- All other existing secrets (unchanged)

## Deployment Notes

⚠️ **Important**: Services will now **fail to start** if required environment variables are missing. This is intentional - better to fail fast than connect to wrong endpoints.

Ensure all GitHub Variables and Secrets are set before deploying!

