# Frontend/Backend Environment Variables Comparison

This document compares the environment variables used by the frontend (Lambda) and backend services to ensure consistency.

## Environment Variables in Frontend Infrastructure (CDK)

**File**: `client/infra/infrastructure-stack.ts` (Lambda environment variables)

### Currently Configured ✅

| Variable | Source | Status |
|----------|--------|--------|
| `MONGODB_URI` | `process.env.MONGODB_URI` | ✅ Configured |
| `REDIS_HOST` | `process.env.REDIS_HOST` | ✅ Configured |
| `REDIS_PORT` | `process.env.REDIS_PORT` | ✅ Configured (default: '6379') |
| `REDIS_PASSWORD` | `process.env.REDIS_PASSWORD` | ✅ Configured |
| `REDIS_CLUSTER_ENABLED` | `process.env.REDIS_CLUSTER_ENABLED` | ✅ Configured (default: 'true') |
| `REDIS_CLUSTER_NODES` | `process.env.REDIS_CLUSTER_NODES` | ✅ Configured |
| `NEXT_PUBLIC_COLYSEUS_HTTP_URL` | `process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL` | ✅ Configured |
| `NEXT_PUBLIC_COLYSEUS_WS_URL` | `process.env.NEXT_PUBLIC_COLYSEUS_WS_URL` | ✅ Configured |
| `NEXT_PUBLIC_API_BASE` | `process.env.NEXT_PUBLIC_API_BASE` | ✅ Configured |
| `INTERNAL_SERVICE_SECRET` | `process.env.INTERNAL_SERVICE_SECRET` | ✅ **NOW CONFIGURED** (was missing) |
| `NEXTAUTH_SECRET` | `process.env.NEXTAUTH_SECRET` | ✅ Configured |
| `NEXTAUTH_URL` | Hardcoded to 'https://leetbattle.net' | ✅ Configured |
| `S3_BUCKET_NAME` | From CDK bucket resource | ✅ Configured |
| `AWS_REGION` | `process.env.AWS_REGION` or `region` | ✅ Configured |
| `S3_ENDPOINT` | `process.env.S3_ENDPOINT` | ✅ **NOW CONFIGURED** (was missing) |

### Notes

- **AWS Credentials**: NOT needed in Lambda - IAM role credentials are used automatically
- **S3_ENDPOINT**: Only needed for MinIO (dev), not AWS S3 (production)
- **INTERNAL_SERVICE_SECRET**: **CRITICAL** - Required for frontend to authenticate with protected backend endpoints

## Environment Variables in Frontend Deployment Workflow

**File**: `.github/workflows/frontend-deploy.yml`

### Currently Passed to CDK ✅

| Variable | Source | Status |
|----------|--------|--------|
| `MONGODB_URI` | `secrets.MONGODB_URI` | ✅ Passed |
| `REDIS_HOST` | `vars.REDIS_HOST` | ✅ Passed |
| `REDIS_PORT` | `vars.REDIS_PORT` | ✅ Passed |
| `REDIS_PASSWORD` | `secrets.REDIS_PASSWORD` | ✅ Passed |
| `REDIS_CLUSTER_ENABLED` | `vars.REDIS_CLUSTER_ENABLED` | ✅ Passed |
| `REDIS_CLUSTER_NODES` | `vars.REDIS_CLUSTER_NODES` | ✅ Passed |
| `NEXT_PUBLIC_COLYSEUS_HTTP_URL` | `vars.NEXT_PUBLIC_COLYSEUS_HTTP_URL` | ✅ Passed |
| `NEXT_PUBLIC_COLYSEUS_WS_URL` | `vars.NEXT_PUBLIC_COLYSEUS_WS_URL` | ✅ Passed |
| `NEXT_PUBLIC_API_BASE` | `vars.NEXT_PUBLIC_API_BASE` | ✅ Passed |
| `INTERNAL_SERVICE_SECRET` | `secrets.INTERNAL_SERVICE_SECRET` | ✅ **NOW PASSED** (was missing) |
| `NEXTAUTH_SECRET` | `secrets.NEXTAUTH_SECRET` | ✅ Passed |
| `NEXTAUTH_URL` | `vars.NEXTAUTH_URL` | ✅ Passed |
| `AWS_REGION` | `vars.AWS_REGION` | ✅ **NOW PASSED** (was hardcoded) |
| `S3_ENDPOINT` | `vars.S3_ENDPOINT` | ✅ **NOW PASSED** (was missing) |
| `S3_BUCKET_NAME` | `vars.S3_BUCKET_NAME` | ✅ Passed |

## Backend Services Environment Variables

**Files**: `backend/k8s/deployments/*.yaml`, `backend/k8s/services/*.yaml`

### Colyseus Service

| Variable | Source | Required for Lambda? |
|----------|--------|---------------------|
| `MONGODB_URI` | Secret | ✅ Yes (via frontend) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Secret/ConfigMap | ✅ Yes (via frontend) |
| `INTERNAL_SERVICE_SECRET` | Secret | ✅ Yes (must match frontend) |
| `BOT_SERVICE_SECRET` | Secret | ❌ No (internal only) |
| `COLYSEUS_RESERVATION_SECRET` | Secret | ❌ No (internal only) |

### MongoDB Service

| Variable | Source | Required for Lambda? |
|----------|--------|---------------------|
| Connection string with credentials | Secret | ✅ Yes (via `MONGODB_URI`) |
| External access | LoadBalancer | ✅ Yes (now configured) |

### Redis Service

| Variable | Source | Required for Lambda? |
|----------|--------|---------------------|
| `REDIS_PASSWORD` | Secret | ✅ Yes |
| External access | LoadBalancer | ✅ Yes (now configured) |

## Consistency Check

### ✅ All Required Variables Are Now Configured

1. **MongoDB**: 
   - ✅ Frontend uses `MONGODB_URI` (includes credentials)
   - ✅ Backend exposes MongoDB via LoadBalancer
   - ✅ Frontend infrastructure passes `MONGODB_URI` to Lambda

2. **Redis**:
   - ✅ Frontend uses `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
   - ✅ Backend exposes Redis via LoadBalancer
   - ✅ Frontend infrastructure passes all Redis variables to Lambda
   - ✅ Frontend code uses password for authentication

3. **Colyseus**:
   - ✅ Frontend uses `NEXT_PUBLIC_COLYSEUS_HTTP_URL` and `NEXT_PUBLIC_COLYSEUS_WS_URL`
   - ✅ Backend exposes Colyseus via LoadBalancer
   - ✅ Frontend infrastructure passes Colyseus URLs to Lambda
   - ✅ Frontend code sends `X-Internal-Secret` header for protected endpoints
   - ✅ Frontend infrastructure now passes `INTERNAL_SERVICE_SECRET` to Lambda

4. **Authentication**:
   - ✅ Frontend code updated to send `X-Internal-Secret` header
   - ✅ Frontend infrastructure now includes `INTERNAL_SERVICE_SECRET` in Lambda env
   - ✅ Deployment workflow now passes `INTERNAL_SERVICE_SECRET` secret

## Required GitHub Secrets/Variables

### Secrets (sensitive data)
- `MONGODB_URI` - Full connection string with credentials
- `REDIS_PASSWORD` - Redis password
- `INTERNAL_SERVICE_SECRET` - **MUST match backend secret**
- `NEXTAUTH_SECRET` - NextAuth.js secret
- `AWS_ROLE_ARN` - For OIDC authentication
- `AWS_ACCOUNT_ID` - AWS account ID

### Variables (non-sensitive configuration)
- `REDIS_HOST` - Redis external hostname/IP
- `REDIS_PORT` - Redis port (default: 6379)
- `REDIS_CLUSTER_ENABLED` - Set to 'true' for cluster mode
- `REDIS_CLUSTER_NODES` - Optional cluster nodes list
- `NEXT_PUBLIC_COLYSEUS_HTTP_URL` - Colyseus HTTP endpoint
- `NEXT_PUBLIC_COLYSEUS_WS_URL` - Colyseus WebSocket endpoint
- `NEXT_PUBLIC_API_BASE` - Optional API base URL
- `AWS_REGION` - AWS region (default: us-east-1)
- `S3_ENDPOINT` - Optional: Only for MinIO, leave empty for AWS S3
- `S3_BUCKET_NAME` - Optional: Existing S3 bucket name
- `NEXTAUTH_URL` - Frontend URL
- `ROUTE53_HOSTED_ZONE_ID` - For DNS/certificate setup
- `ROUTE53_HOSTED_ZONE_NAME` - Optional, defaults to 'leetbattle.net'
- `NEXTJS_DOMAIN_NAME` - Optional domain name
- `COLYSEUS_DOMAIN` - Optional Colyseus subdomain
- `COLYSEUS_HOST_IP` - Optional Colyseus external IP

## Verification Checklist

Before deploying, verify:

- [ ] `INTERNAL_SERVICE_SECRET` is set in GitHub Secrets
- [ ] `INTERNAL_SERVICE_SECRET` matches the backend secret
- [ ] `MONGODB_URI` includes full connection string with credentials
- [ ] `REDIS_HOST` points to external LoadBalancer IP/domain
- [ ] `REDIS_PASSWORD` matches backend Redis password
- [ ] `NEXT_PUBLIC_COLYSEUS_HTTP_URL` points to Colyseus LoadBalancer
- [ ] `NEXT_PUBLIC_COLYSEUS_WS_URL` points to Colyseus LoadBalancer
- [ ] All backend services have `LoadBalancer` type (not ClusterIP)
- [ ] Frontend code includes `X-Internal-Secret` header in queue actions

## Recent Changes

1. ✅ Added `INTERNAL_SERVICE_SECRET` to Lambda environment variables
2. ✅ Added `AWS_REGION` to Lambda environment variables
3. ✅ Added `S3_ENDPOINT` to Lambda environment variables
4. ✅ Updated frontend deployment workflow to pass `INTERNAL_SERVICE_SECRET`
5. ✅ Updated frontend deployment workflow to pass `AWS_REGION` and `S3_ENDPOINT`
6. ✅ Updated frontend code to send `X-Internal-Secret` header
7. ✅ Updated backend services to `LoadBalancer` type for external access

