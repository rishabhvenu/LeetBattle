# Environment Variable Audit Report

This document lists all environment variables used across frontend and backend services, ensuring no hardcoded values remain.

## Frontend (Next.js)

### Required Environment Variables

**Backend Connection:**
- `NEXT_PUBLIC_API_BASE` - Primary API base URL (e.g., `https://api.leetbattle.net`)
- `NEXT_PUBLIC_COLYSEUS_HTTP_URL` - Colyseus HTTP endpoint (e.g., `https://api.leetbattle.net`)
- `NEXT_PUBLIC_COLYSEUS_WS_URL` - Colyseus WebSocket endpoint (e.g., `wss://api.leetbattle.net`)

**Database & Cache:**
- `MONGODB_URI` - MongoDB connection string (server-side only)
- `REDIS_HOST` - Redis hostname
- `REDIS_PORT` - Redis port
- `REDIS_PASSWORD` - Redis password
- `REDIS_CLUSTER_ENABLED` - Enable Redis Cluster mode (`true`/`false`)
- `REDIS_CLUSTER_NODES` - Comma-separated list of cluster nodes (optional)

**Storage:**
- `S3_BUCKET_NAME` - AWS S3 bucket name for avatars
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `AWS_REGION` - AWS region (default: `us-east-1`)
- `S3_ENDPOINT` - Optional S3 endpoint (for MinIO in dev)

**Authentication:**
- `NEXTAUTH_SECRET` - NextAuth.js secret
- `NEXTAUTH_URL` - Frontend URL for NextAuth callbacks

### Fixed Issues

✅ **Removed hardcoded localhost URLs:**
- `RestEndpoints.tsx` - Now uses env vars with proper fallback chain
- `server-actions.ts` - Removed `http://localhost:2567` fallback
- `guest-actions.ts` - Removed `http://localhost:2567` fallback
- `actions.ts` - Removed `http://localhost:2567` fallback
- `RestHandler.tsx` - Uses proper env var chain

✅ **Redis connection:**
- `redis.ts` - Now requires `REDIS_HOST` and `REDIS_PORT` (no fallback to `127.0.0.1`)

## Backend Services

### Colyseus Service

**Required Environment Variables:**
- `PORT` / `COLYSEUS_PORT` - Server port (default: 2567)
- `REDIS_HOST` - Redis hostname ⚠️ **REQUIRED** (no fallback)
- `REDIS_PORT` - Redis port ⚠️ **REQUIRED** (no fallback)
- `REDIS_PASSWORD` - Redis password
- `REDIS_CLUSTER_ENABLED` - Enable Redis Cluster mode
- `REDIS_CLUSTER_NODES` - Cluster nodes list
- `MONGODB_URI` - MongoDB connection string ⚠️ **REQUIRED** (no fallback)
- `JUDGE0_URL` - Judge0 API URL ⚠️ **REQUIRED** (constructed from `JUDGE0_HOST` and `JUDGE0_PORT`)
- `JUDGE0_HOST` - Judge0 service hostname (from ConfigMap)
- `JUDGE0_PORT` - Judge0 port (from secrets)
- `CORS_ORIGIN` - Frontend origin for CORS (optional, defaults to localhost:3000 in dev)
- `OPENAI_API_KEY` - OpenAI API key
- `INTERNAL_SERVICE_SECRET` - Secret for internal service authentication
- `BOT_SERVICE_SECRET` - Secret for bot service authentication
- `COLYSEUS_RESERVATION_SECRET` - Secret for room reservations
- `AWS_ACCESS_KEY_ID` - AWS access key for S3
- `AWS_SECRET_ACCESS_KEY` - AWS secret key for S3
- `S3_BUCKET_NAME` - S3 bucket name
- `AWS_REGION` - AWS region

**Fixed Issues:**
✅ Removed all `127.0.0.1` fallbacks - now throws error if env vars missing
✅ Removed hardcoded MongoDB URIs - now requires `MONGODB_URI` env var
✅ Removed hardcoded Judge0 URL - uses `JUDGE0_URL` constructed from env vars
✅ Removed hardcoded `http://localhost:3000` CORS - uses `CORS_ORIGIN` env var

### Bots Service

**Required Environment Variables:**
- `REDIS_HOST` ⚠️ **REQUIRED** (no fallback)
- `REDIS_PORT` ⚠️ **REQUIRED** (no fallback)
- `REDIS_PASSWORD` - Redis password
- `MONGODB_URI` ⚠️ **REQUIRED** (no fallback)
- `COLYSEUS_URL` - WebSocket URL to Colyseus ⚠️ **REQUIRED** (constructed from `COLYSEUS_HOST` and `COLYSEUS_PORT`)
- `COLYSEUS_HOST` - Colyseus service hostname (from ConfigMap)
- `COLYSEUS_PORT` - Colyseus port (from secrets)
- `BOT_SERVICE_SECRET` - Secret for bot service authentication

**Fixed Issues:**
✅ Removed `127.0.0.1` Redis fallback - now throws error if missing
✅ Removed `ws://localhost:2567` Colyseus fallback - now throws error if missing
✅ Removed hardcoded MongoDB URI - now requires env var

### Judge0 Services

**Required Environment Variables:**
- `REDIS_HOST` ⚠️ **REQUIRED** (from secrets)
- `REDIS_PORT` ⚠️ **REQUIRED** (from secrets)
- `REDIS_PASSWORD` ⚠️ **REQUIRED** (from secrets)
- `POSTGRES_HOST` - PostgreSQL hostname (from ConfigMap)
- `POSTGRES_USER` - PostgreSQL username (from secrets)
- `POSTGRES_PASSWORD` - PostgreSQL password (from secrets)
- `POSTGRES_DB` - PostgreSQL database name (from secrets)

**Note about `JUDGE0_PORT`:**
- Judge0 runs on a **fixed port 2358** internally
- `JUDGE0_PORT` is stored in secrets **for other services** (like Colyseus) to know how to connect to Judge0
- Judge0 itself doesn't use the `JUDGE0_PORT` env var - it always listens on 2358
- The Kubernetes service NodePort matches this value for external access

## Kubernetes Configuration

### Secrets (app-secrets)

All ports and connection details come from secrets:
- `REDIS_HOST` - Redis service name
- `REDIS_PORT` - Redis port
- `REDIS_PASSWORD` - Redis password
- `JUDGE0_PORT` - Judge0 port
- `MONGODB_PORT` - MongoDB port
- `COLYSEUS_PORT` - Colyseus port
- `MONGODB_URI` - Full MongoDB connection string (external)
- `MONGODB_URI_INTERNAL` - MongoDB connection string for Kubernetes services

### ConfigMap (app-config)

Service hostnames for inter-service communication:
- `JUDGE0_HOST` - `judge0-server` (Kubernetes service name)
- `COLYSEUS_HOST` - `colyseus` (Kubernetes service name)
- `POSTGRES_HOST` - `postgres` (Kubernetes service name)
- `MONGODB_HOST` - `mongodb` (Kubernetes service name)
- `REDIS_HOST` - `redis-cluster` (can be overridden by secret)

### Service Communication

**Internal (Kubernetes):**
- Services use Kubernetes DNS names: `<service-name>.codeclashers.svc.cluster.local`
- Ports come from secrets or ConfigMap
- Example: `mongodb.codeclashers.svc.cluster.local:27017`

**External (From Frontend):**
- Frontend connects via public URLs configured in GitHub Variables
- `NEXT_PUBLIC_COLYSEUS_HTTP_URL` - Public HTTP endpoint
- `NEXT_PUBLIC_COLYSEUS_WS_URL` - Public WebSocket endpoint
- `NEXT_PUBLIC_API_BASE` - API base URL

## Validation

All critical environment variables now:
1. ✅ **Throw errors if missing** (no silent fallbacks to localhost/127.0.0.1)
2. ✅ **Use environment variables** (no hardcoded URLs or IPs)
3. ✅ **Reference services correctly** (use Kubernetes service names from ConfigMap)
4. ✅ **Use ports from secrets** (all ports configurable via GitHub Variables)

## Remaining Considerations

⚠️ **CORS_ORIGIN**: Currently optional in Colyseus (falls back to localhost:3000 in dev). For production, set this via ConfigMap or environment variable.

⚠️ **Port Validation**: Services now throw errors if critical env vars are missing, which means deployments will fail fast rather than connecting to wrong endpoints.

## Testing Checklist

Before deploying, verify:
- [ ] All GitHub Variables/Secrets are set
- [ ] `REDIS_HOST`, `REDIS_PORT` set correctly
- [ ] `JUDGE0_URL` constructed correctly (uses `JUDGE0_HOST` + `JUDGE0_PORT`)
- [ ] `COLYSEUS_URL` constructed correctly (uses `COLYSEUS_HOST` + `COLYSEUS_PORT`)
- [ ] `MONGODB_URI` points to correct replica set
- [ ] `NEXT_PUBLIC_COLYSEUS_HTTP_URL` and `NEXT_PUBLIC_COLYSEUS_WS_URL` point to public endpoints
- [ ] Frontend can reach backend services
- [ ] Backend services can reach each other via Kubernetes DNS

