# Session Summary: Bot Generation Fix (Dec 1, 2025)

## Problem
User reported "Failed to generate bot profile" toast when trying to generate bots. This worked locally but not in production.

## Root Cause Analysis

### Issue 1: Authentication Failure
- **Problem**: Frontend (Lambda) was making HTTP requests to Colyseus backend `/admin/bots/generate` endpoint
- **Root Cause**: The endpoint uses `adminAuthMiddleware()` which primarily checked session cookies
- **Why it failed**: Session cookies are not reliably forwarded from AWS Lambda to the Colyseus backend in server-to-server calls

### Issue 2: Wrong API Endpoint
- **Problem**: `REST_ENDPOINTS.API_BASE` was resolving to frontend domain (`https://leetbattle.net`) instead of backend
- **Fix**: Use `process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL` explicitly

### Issue 3: Type Mismatch
- **Problem**: `getBots()` was returning objects that didn't fully conform to `BotDoc` interface
- **Fix**: Ensure all required fields are present and correctly typed (`_id` as `ObjectId`, `matchIds` as `ObjectId[]`, etc.)

## Solution Implemented

### 1. Added Internal Service Secret Authentication
**File**: `backend/colyseus/src/lib/internalAuth.ts`
- Modified `adminAuthMiddleware()` to check `X-Internal-Secret` header first
- If header matches `INTERNAL_SERVICE_SECRET`, grant access without checking cookies
- Falls back to cookie authentication if header is missing/invalid
- Added comprehensive logging for debugging

**Key Code**:
```typescript
const internalSecret = ctx.get('X-Internal-Secret');
const expectedInternalSecret = process.env.INTERNAL_SERVICE_SECRET;

if (internalSecret && expectedInternalSecret && internalSecret === expectedInternalSecret) {
  // Grant access
  ctx.state.internalService = true;
  ctx.state.adminUser = true;
  await next();
  return;
}
```

### 2. Updated Frontend Server Actions
**File**: `client/src/lib/actions/shared.ts`
- Modified `getSessionCookieHeader()` to include `X-Internal-Secret` header
- Header value comes from `process.env.INTERNAL_SERVICE_SECRET`

**File**: `client/src/lib/actions/bot.ts`
- Updated `generateBotProfile()` to use `NEXT_PUBLIC_COLYSEUS_HTTP_URL`
- Added fallback to convert HTTPS to HTTP if needed
- Added comprehensive debugging logs

### 3. Converted Bot Actions to Direct MongoDB Access
**File**: `client/src/lib/actions/bot.ts`
- Converted `generateBotProfile`, `initializeBotsCollection`, `getBots`, etc. to directly interact with MongoDB
- Eliminated need for HTTP endpoints for these specific actions
- This simplifies architecture and removes reliance on backend endpoints

**Note**: Some actions like `deployBots`, `setRotationConfig` still use HTTP endpoints and now use internal secret authentication

## Debugging Process

### Step 1: Added Debugging Logs
- Added logs in `generateBotProfile()` to show API base URL, internal secret presence, request body
- Added logs in `adminAuthMiddleware()` to show secret comparison details

### Step 2: SSH into VM and Test
```bash
# SSH into VM
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179

# Get internal secret
INTERNAL_SECRET=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.INTERNAL_SERVICE_SECRET}' | base64 -d)

# Test endpoint directly
curl -X POST http://matchmaker.leetbattle.net:2567/admin/bots/generate \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -H 'X-Service-Name: test' \
  -d '{"count":1}'
```

### Step 3: Check Logs
```bash
# Colyseus logs
sudo k3s kubectl logs -n codeclashers -l app=colyseus --tail=50 | grep -E 'adminAuth|internal|secret'

# Lambda logs (requires AWS credentials)
export AWS_ACCESS_KEY_ID=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_ACCESS_KEY_ID}' | base64 -d)
export AWS_SECRET_ACCESS_KEY=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_SECRET_ACCESS_KEY}' | base64 -d)
export AWS_DEFAULT_REGION=us-east-1
LAMBDA_NAME='FrontendStack-NextJsLambda7B47D540-duvgyXgxXsxP'
aws logs filter-log-events \
  --log-group-name /aws/lambda/$LAMBDA_NAME \
  --start-time $(date -u -d '5 minutes ago' +%s)000 \
  --query 'events[*].message' \
  --output text | grep -E 'generateBotProfile|API base|Internal secret'
```

### Step 4: Restart Services
```bash
# Restart Colyseus to pick up new code
sudo k3s kubectl rollout restart deployment colyseus -n codeclashers

# Wait for rollout
sudo k3s kubectl rollout status deployment colyseus -n codeclashers --timeout=60s

# Note: Colyseus uses hostPort: 2567, so only one pod can run
# If new pod is stuck in Pending, delete old pod:
OLD_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=colyseus --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')
sudo k3s kubectl delete pod $OLD_POD -n codeclashers
```

## Verification

### Successful Test Results
1. **Authentication**: Logs showed `[adminAuth] checking internal secret` with `secretsMatch: true`
2. **Endpoint Response**: `{"success":true,"message":"Generated 1 bots successfully"}`
3. **Collection Initialization**: `{"success":true,"message":"Bots collection created successfully"}`

### Key Logs to Look For
- `[adminAuth] checking internal secret` - Shows secret comparison
- `[adminAuth] internal service authentication SUCCESS` - Authentication worked
- `[generateBotProfile] Using API base: ...` - Shows which endpoint is being used
- `[generateBotProfile] Response status: 200` - Request succeeded

## Files Changed

1. `backend/colyseus/src/lib/internalAuth.ts` - Added internal secret authentication
2. `client/src/lib/actions/shared.ts` - Added `X-Internal-Secret` header
3. `client/src/lib/actions/bot.ts` - Updated API endpoint and added debugging

## Important Notes

1. **INTERNAL_SERVICE_SECRET must match** between:
   - Lambda environment variables (GitHub Secrets)
   - Kubernetes secret `app-secrets.INTERNAL_SERVICE_SECRET`
   - Colyseus pod environment variable

2. **Bots collection must be initialized** before generating bots:
   - Use admin UI "Initialize Collection" button, or
   - Call `/admin/bots/init` endpoint directly

3. **API Endpoint**: Frontend should use `NEXT_PUBLIC_COLYSEUS_HTTP_URL` which should be `http://matchmaker.leetbattle.net:2567`

4. **Deployment**: After code changes, both backend and frontend need to be redeployed:
   - Backend: `.github/workflows/deploy-backend.yml`
   - Frontend: `.github/workflows/frontend-build.yml` + `frontend-deploy.yml`

## Next Steps for Future Debugging

1. Check if collection is initialized
2. Verify `INTERNAL_SERVICE_SECRET` matches across all services
3. Test endpoint directly with curl
4. Check logs (Colyseus and Lambda)
5. Verify environment variables are set correctly
6. Restart services if needed

See `docs/debugging-guide.md` for comprehensive debugging procedures.



