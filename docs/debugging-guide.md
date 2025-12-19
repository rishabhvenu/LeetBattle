# Debugging Guide for CodeClashers Production

## Prerequisites and Access Methods

### Credentials and Connection Information

**Oracle Cloud Credentials:**
- All Oracle Cloud Infrastructure (OCI) details are stored in `credentials/oracle_info`
- This file contains:
  - Region: Canada Southeast (Toronto)
  - User OCID
  - Compartment OCID
  - Instance IP address
  - Username for SSH access

**SSH Key:**
- SSH private key: `~/.ssh/oci.pem` (Oracle Cloud Infrastructure key)
- This key is used for SSH access to the production VM
- **Note:** The `credentials/` folder is gitignored and will never be committed to the repository

### SSH Access to Oracle Cloud VM

**Prerequisites:**
- SSH key file: `~/.ssh/oci.pem` (must have correct permissions: `chmod 600 ~/.ssh/oci.pem`)
- VM IP: See `credentials/oracle_info` (currently `40.233.103.179`)
- User: `ubuntu` (or see `credentials/oracle_info`)

**SSH Command:**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
```

**Setting correct permissions (if needed):**
```bash
chmod 600 ~/.ssh/oci.pem
```

### AWS CLI Access

**Prerequisites:**
- AWS CLI installed (`brew install awscli` on macOS, or `pip install awscli`)
- AWS credentials configured (via `aws configure` or environment variables)
- AWS credentials can be retrieved from Kubernetes secrets on the VM

**Getting AWS Credentials from Kubernetes:**
```bash
# SSH into the VM first
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179

# Export AWS credentials from Kubernetes secrets
export AWS_ACCESS_KEY_ID=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_ACCESS_KEY_ID}' | base64 -d)
export AWS_SECRET_ACCESS_KEY=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_SECRET_ACCESS_KEY}' | base64 -d)
export AWS_DEFAULT_REGION=us-east-1

# Verify AWS CLI access
aws sts get-caller-identity
```

**Common AWS CLI Commands for Debugging:**

```bash
# View Lambda logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/<LAMBDA_NAME> \
  --start-time $(date -u -d '10 minutes ago' +%s)000 \
  --query 'events[*].message' \
  --output text

# Check Lambda function configuration
aws lambda get-function-configuration \
  --function-name <LAMBDA_NAME> \
  --query 'Environment.Variables' \
  --output json

# List CloudFront distributions
aws cloudfront list-distributions \
  --query 'DistributionList.Items[*].[Id,DomainName,Status]' \
  --output table

# Check S3 bucket contents
aws s3 ls s3://<BUCKET_NAME>/

# View CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=<LAMBDA_NAME> \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --period 300 \
  --statistics Sum
```

### CI/CD Pipeline Overview

**All deployments are automated via GitHub Actions workflows:**

1. **Backend Deployment** (`.github/workflows/deploy-backend.yml`)
   - **Trigger:** Push to `main` branch with changes in `backend/**`
   - **Manual trigger:** Available via `workflow_dispatch` with options to build specific services
   - **Process:**
     - Detects changed files (Colyseus, Bots, Judge0 API, Judge0 Worker)
     - Builds Docker images and pushes to GitHub Container Registry (GHCR)
     - Deploys to Kubernetes on Oracle Cloud VM (runs on self-hosted runner)
     - Uses `k3s kubectl` to apply Kubernetes manifests
   - **Services deployed:** Colyseus, Bots, Judge0 API, Judge0 Worker, MongoDB, Redis, PostgreSQL

2. **Frontend Build** (`.github/workflows/frontend-build.yml`)
   - **Trigger:** Push to `main` branch with changes in `client/**`
   - **Manual trigger:** Available via `workflow_dispatch`
   - **Process:**
     - Builds Next.js application with OpenNext
     - Uploads build artifacts to GitHub Actions artifacts
     - Artifacts are versioned by commit SHA

3. **Frontend Deploy** (`.github/workflows/frontend-deploy.yml`)
   - **Trigger:** Automatically after successful frontend build, or manual dispatch
   - **Process:**
     - Downloads OpenNext build artifacts from build workflow
     - Deploys to AWS using CDK (CloudFront + Lambda)
     - Uses OIDC authentication for AWS (no long-lived credentials)
     - Configures CloudFront distribution, Lambda functions, S3 buckets

4. **Secrets Sync** (`.github/workflows/sync-secrets.yml`)
   - Manages Kubernetes secrets synchronization
   - Ensures secrets match GitHub Secrets

**Monitoring CI/CD:**
```bash
# View recent workflow runs
gh run list --limit 10

# Watch a specific workflow run
gh run watch <RUN_ID>

# View workflow logs
gh run view <RUN_ID> --log

# List workflows
gh workflow list

# Trigger a workflow manually
gh workflow run deploy-backend.yml
```

**Key CI/CD Features:**
- ✅ Automatic deployments on push to `main`
- ✅ Manual workflow dispatch available for all workflows
- ✅ Build caching for faster Docker builds
- ✅ Conditional builds (only builds changed services)
- ✅ OIDC authentication for AWS (secure, no credentials stored)
- ✅ Self-hosted runner on Oracle Cloud VM for backend deployments
- ✅ Artifact management for frontend builds
- ✅ Concurrency control (prevents multiple deployments running simultaneously)

## Architecture Overview

### Services Running on Kubernetes (k3s)
- **Colyseus Backend**: Game/matchmaking server (port 2567)
- **Redis**: Single instance (port 6380 externally, 6379 internally)
- **MongoDB**: Database
- **Judge0**: Code execution service

### Frontend
- **AWS Lambda**: Next.js serverless functions
- **CloudFront**: CDN serving static assets
- **S3**: Static asset storage

   ### Key Environment Variables
- `INTERNAL_SERVICE_SECRET`: Used for server-to-server authentication between Lambda and Colyseus
- `REDIS_PORT`: `6380` (DO NOT CHANGE - defined in GitHub Secrets)
- `REDIS_HOST`: Redis service hostname/IP

## Common Debugging Scenarios

### 1. Bot Generation and Rotation Status Issues

#### Problem: "Failed to generate bot profile" toast or "Failed to fetch rotation status: Failed to get rotation status"

**Common Causes:**
- Network connectivity issues from Lambda to Colyseus backend
- API base URL (`NEXT_PUBLIC_COLYSEUS_HTTP_URL`) not configured or incorrect
- CORS issues preventing fetch requests
- Session cookie not being passed correctly from Lambda
- Fetch timeout or connection refused errors

#### Debugging Steps:

**Step 1: Check if bots collection is initialized**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl exec -n codeclashers -it $(sudo k3s kubectl get pods -n codeclashers -l app=colyseus -o jsonpath='{.items[0].metadata.name}') -- mongosh mongodb://localhost:27017/codeclashers --eval "db.getCollectionNames()" | grep bots
```

**Step 2: Check Colyseus logs for authentication errors**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl logs -n codeclashers -l app=colyseus --tail=50 | grep -E 'adminAuth|internal|secret|generate|401|Unauthorized'
```

**Step 3: Test endpoint directly with internal secret**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
INTERNAL_SECRET=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.INTERNAL_SERVICE_SECRET}' | base64 -d)
curl -v http://matchmaker.leetbattle.net:2567/admin/bots/generate \
  -X POST \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -H 'X-Service-Name: test' \
  -d '{"count":1}'
```

**Step 4: Check Lambda logs for frontend errors**

**Option A: Using AWS CLI from local machine (requires AWS credentials configured)**
```bash
# Ensure AWS CLI is configured (or export credentials)
aws logs filter-log-events \
  --log-group-name /aws/lambda/<LAMBDA_NAME> \
  --start-time $(date -u -d '5 minutes ago' +%s)000 \
  --query 'events[*].message' \
  --output text | grep -E 'generateBotProfile|getRotationStatus|API base|Making request|Fetch error|Network error|NOT SET'
```

**Option B: Using AWS CLI from Oracle Cloud VM (credentials from Kubernetes secrets)**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
export AWS_ACCESS_KEY_ID=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_ACCESS_KEY_ID}' | base64 -d)
export AWS_SECRET_ACCESS_KEY=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_SECRET_ACCESS_KEY}' | base64 -d)
export AWS_DEFAULT_REGION=us-east-1
LAMBDA_NAME='FrontendStack-NextJsLambda7B47D540-duvgyXgxXsxP'
aws logs filter-log-events \
  --log-group-name /aws/lambda/$LAMBDA_NAME \
  --start-time $(date -u -d '5 minutes ago' +%s)000 \
  --query 'events[*].message' \
  --output text | grep -E 'generateBotProfile|getRotationStatus|API base|Making request|Fetch error|Network error|NOT SET'
```

**Step 4b: Check for specific fetch errors in Lambda logs**
Look for these log patterns:
- `[generateBotProfile] Making request` - Shows the URL being called and cookie status
- `[getRotationStatus] Making request` - Shows the URL being called and cookie status
- `[generateBotProfile] Fetch error` - Shows detailed error information
- `[getRotationStatus] Fetch error` - Shows detailed error information
- `API base URL not configured` - Indicates `NEXT_PUBLIC_COLYSEUS_HTTP_URL` is missing
- `Network error` - Indicates connectivity issues

**Step 4c: Verify API base URL is set in Lambda**
```bash
# Check Lambda environment variables (replace LAMBDA_NAME with actual name)
aws lambda get-function-configuration \
  --function-name $LAMBDA_NAME \
  --query 'Environment.Variables.NEXT_PUBLIC_COLYSEUS_HTTP_URL' \
  --output text
```

**Step 4d: Test connectivity from Lambda to Colyseus**
The Lambda should be able to reach `http://matchmaker.leetbattle.net:2567` or your configured API URL. Check:
- Network connectivity (VPC configuration if Lambda is in VPC)
- Security group rules allowing outbound connections
- DNS resolution for the API hostname

**Step 5: Verify INTERNAL_SERVICE_SECRET is set in Colyseus pod**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
COLYSEUS_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=colyseus -o jsonpath='{.items[0].metadata.name}')
sudo k3s kubectl exec -n codeclashers $COLYSEUS_POD -- env | grep INTERNAL_SERVICE_SECRET
```

**Step 6: Check if secret exists in Kubernetes**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.INTERNAL_SERVICE_SECRET}' | base64 -d | wc -c
```

#### Common Issues and Fixes:

1. **Authentication failing (401 Unauthorized)**
   - Check if `INTERNAL_SERVICE_SECRET` matches between Lambda env and Kubernetes secret
   - Verify Colyseus pod has the environment variable set
   - Check Colyseus logs for `[adminAuth] checking internal secret` - should show `secretsMatch: true`

2. **Bots collection not initialized**
   - Run: `curl -X POST http://matchmaker.leetbattle.net:2567/admin/bots/init -H "X-Internal-Secret: $INTERNAL_SECRET"`
   - Or use the admin UI "Initialize Collection" button

3. **Wrong API endpoint or fetch failures**
   - Frontend should use `NEXT_PUBLIC_COLYSEUS_HTTP_URL` (must include port: `http://matchmaker.leetbattle.net:2567`)
   - **Common issue**: URL missing port `:2567` or using HTTPS when server only supports HTTP
   - Check Lambda environment variables: `aws lambda get-function-configuration --function-name <LAMBDA_NAME> --query 'Environment.Variables.NEXT_PUBLIC_COLYSEUS_HTTP_URL'`
   - **Quick fix**: Update Lambda env var directly:
     ```bash
     aws lambda update-function-configuration \
       --function-name FrontendStack-NextJsLambda7B47D540-duvgyXgxXsxP \
       --environment "Variables={NEXT_PUBLIC_COLYSEUS_HTTP_URL=http://matchmaker.leetbattle.net:2567,...}"
     ```
   - **Permanent fix**: Update GitHub repository variable `NEXT_PUBLIC_COLYSEUS_HTTP_URL` to `http://matchmaker.leetbattle.net:2567` and redeploy
   - Verify the URL is accessible from Lambda (network connectivity, DNS resolution)
   - Check Lambda logs for `[generateBotProfile] Making request` or `[getRotationStatus] Making request` to see the actual URL being called
   - Look for `Fetch error` logs which will show network errors, timeouts, or connection refused errors
   - **Error pattern**: `Connect Timeout Error (attempted address: matchmaker.leetbattle.net:80)` indicates missing port (defaults to port 80)

4. **Network/Fetch errors**
   - **Connection timeout on port 80**: URL missing port `:2567` - update `NEXT_PUBLIC_COLYSEUS_HTTP_URL` to include port
   - **HTTPS/SSL errors**: Server only supports HTTP - use `http://` not `https://` in URL
   - **Connection refused**: Colyseus backend is not accessible from Lambda (check network/VPC configuration)
   - **Timeout**: Backend is taking too long to respond (check Colyseus pod health and logs)
   - **DNS resolution failure**: API hostname cannot be resolved (check DNS configuration)
   - **CORS errors**: Check Colyseus CORS configuration allows requests from Lambda origin
   
   **Example fix for "Failed to fetch rotation status" or "Failed to generate bot":**
   ```bash
   # Verify current value (should be http://matchmaker.leetbattle.net:2567)
   aws lambda get-function-configuration \
     --function-name FrontendStack-NextJsLambda7B47D540-duvgyXgxXsxP \
     --query 'Environment.Variables.NEXT_PUBLIC_COLYSEUS_HTTP_URL' \
     --output text
   
   # If wrong, update it (replace ... with all other env vars)
   # Better: Update GitHub variable NEXT_PUBLIC_COLYSEUS_HTTP_URL and redeploy
   ```

### 2. Redis Connection Issues

#### Problem: "Stream isn't writeable and enableOfflineQueue options is false" or "Connection is closed"

#### Debugging Steps:

**Step 1: Check Redis pod status**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl get pods -n codeclashers -l app=redis-single
```

**Step 2: Check Redis service**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl get svc -n codeclashers redis-single
```

**Step 3: Test Redis connectivity from Colyseus pod**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
COLYSEUS_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=colyseus -o jsonpath='{.items[0].metadata.name}')
REDIS_HOST=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.REDIS_HOST}' | base64 -d)
REDIS_PORT=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.REDIS_PORT}' | base64 -d)
sudo k3s kubectl exec -n codeclashers $COLYSEUS_POD -- nc -zv $REDIS_HOST $REDIS_PORT
```

**Step 4: Check Redis logs**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl logs -n codeclashers -l app=redis-single --tail=50
```

**Step 5: Test Redis from Lambda (check CloudWatch logs)**
- Redis should be accessible on port `6380` externally
- Check Lambda logs for Redis connection errors

#### Common Issues and Fixes:

1. **Redis not externally accessible**
   - Service type should be `LoadBalancer` with `externalIPs` set to VM IP
   - Port should be `6380` (DO NOT CHANGE - defined in GitHub Secrets)

2. **Redis cluster mode enabled when it shouldn't be**
   - Set `REDIS_CLUSTER_ENABLED=false` in Lambda environment
   - Check `client/src/lib/redis.ts` - cluster detection logic should use `AND` not `OR`

3. **Connection timeouts**
   - Check firewall rules allow port 6380
   - Verify Redis pod is running and healthy

### 3. MongoDB Data Persistence Issues

#### Problem: MongoDB data is wiped when server restarts

#### Root Cause:
MongoDB uses `local-path` storage class which stores data on the host filesystem at `/var/lib/rancher/k3s/storage/`. On a normal VM, this should be persistent, but data can be lost if:
- k3s is reset/reinstalled (wipes `/var/lib/rancher/k3s/storage/`)
- The StatefulSet is deleted and PVCs are manually deleted
- The storage directory is on a tmpfs/ephemeral filesystem (unlikely on normal VM)

#### Debugging Steps:

**Step 1: Check if PVCs exist and are bound**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl get pvc -n codeclashers | grep mongodb
```

**Step 2: Check where local-path storage is located**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
# Check local-path provisioner configuration
sudo k3s kubectl get storageclass local-path -o yaml
# Check where volumes are actually stored (should exist and have data)
sudo ls -la /var/lib/rancher/k3s/storage/
# Check if directory exists and has MongoDB data
sudo find /var/lib/rancher/k3s/storage/ -name "*mongodb*" -type d
```

**Step 3: Verify storage location is persistent**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
# Check filesystem type (should NOT be tmpfs)
df -T /var/lib/rancher/k3s/storage/
# Check mount point (should be on root filesystem or persistent disk)
mount | grep "/var/lib/rancher/k3s"
# Verify it's not on tmpfs (if it shows tmpfs, that's the problem)
```

**Step 4: Check MongoDB pod volumes**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
MONGODB_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=mongodb -o jsonpath='{.items[0].metadata.name}')
sudo k3s kubectl describe pod $MONGODB_POD -n codeclashers | grep -A 10 "Volumes:"
```

**Step 5: Verify data exists in volume**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
MONGODB_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=mongodb -o jsonpath='{.items[0].metadata.name}')
# Check if data directory has files
sudo k3s kubectl exec -n codeclashers $MONGODB_POD -- ls -la /data/db/
# Check database count
sudo k3s kubectl exec -n codeclashers $MONGODB_POD -- mongosh --quiet --eval "db.adminCommand('listDatabases')"
```

#### Common Issues and Fixes:

1. **StatefulSet deleted/recreated during deployment**
   - **Problem**: If StatefulSet is deleted, new PVCs might be created instead of reusing old ones
   - **Check**: `sudo k3s kubectl get pvc -n codeclashers` - should see PVCs like `data-mongodb-0`
   - **Fix**: Ensure deployment workflow uses `kubectl apply` (not `delete` then `create`). PVCs should persist.
   - **Verify**: After restart, check if old PVCs still exist and are bound

2. **k3s reset/reinstalled**
   - **Problem**: If k3s is reset (`k3s-killall.sh` + reinstall), `/var/lib/rancher/k3s/storage/` is wiped
   - **Check**: `sudo ls -la /var/lib/rancher/k3s/storage/` - should have MongoDB data directories
   - **Fix**: Never reset k3s without backing up `/var/lib/rancher/k3s/storage/` first
   - **Prevention**: Backup MongoDB regularly, or use external storage

3. **PVCs manually deleted**
   - **Problem**: Someone deleted PVCs manually: `kubectl delete pvc data-mongodb-0`
   - **Check**: `sudo k3s kubectl get pvc -n codeclashers | grep mongodb` - should show Bound PVCs
   - **Fix**: Never manually delete PVCs. They contain your data!
   - **Recovery**: If deleted, data is lost unless you have backups

4. **Storage location is on tmpfs (rare)**
   - **Problem**: `/var/lib/rancher/k3s/storage/` mounted on tmpfs (ephemeral)
   - **Check**: `mount | grep k3s` - should NOT show tmpfs
   - **Fix**: This shouldn't happen on normal VM, but if it does, configure local-path to use persistent location

#### Prevention:

1. **Never delete StatefulSet or PVCs manually**:
   ```bash
   # WRONG - Don't do this:
   # sudo k3s kubectl delete statefulset mongodb -n codeclashers
   # sudo k3s kubectl delete pvc -l app=mongodb -n codeclashers
   
   # CORRECT - Use kubectl apply to update:
   sudo k3s kubectl apply -f mongodb/statefulset.yaml
   ```

2. **Backup MongoDB regularly**:
   ```bash
   MONGODB_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=mongodb -o jsonpath='{.items[0].metadata.name}')
   sudo k3s kubectl exec -n codeclashers $MONGODB_POD -- mongodump --out /data/backup/$(date +%Y%m%d)
   # Copy backup off the VM
   sudo k3s kubectl cp codeclashers/$MONGODB_POD:/data/backup ./mongodb-backup
   ```

3. **Verify PVCs exist before restarting**:
   ```bash
   # Before any maintenance, verify PVCs exist
   sudo k3s kubectl get pvc -n codeclashers | grep mongodb
   # Should show: data-mongodb-0, data-mongodb-1, etc. all in Bound state
   ```

4. **Never reset k3s without backup**:
   ```bash
   # If you need to reset k3s, backup storage first:
   sudo tar -czf /tmp/k3s-storage-backup.tar.gz /var/lib/rancher/k3s/storage/
   # Then copy off VM before resetting
   ```

### 4. Server-Side Errors on `/play` Page

#### Problem: "Application error: a server-side exception has occurred"

#### Debugging Steps:

**Step 1: Check Lambda logs for the error**

**Using AWS CLI (from local machine or VM):**
```bash
# If running from local machine, ensure AWS credentials are configured
# If running from VM, export credentials from Kubernetes secrets first:
# export AWS_ACCESS_KEY_ID=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_ACCESS_KEY_ID}' | base64 -d)
# export AWS_SECRET_ACCESS_KEY=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_SECRET_ACCESS_KEY}' | base64 -d)
# export AWS_DEFAULT_REGION=us-east-1

LAMBDA_NAME='FrontendStack-NextJsLambda7B47D540-duvgyXgxXsxP'
aws logs filter-log-events \
  --log-group-name /aws/lambda/$LAMBDA_NAME \
  --start-time $(date -u -d '10 minutes ago' +%s)000 \
  --query 'events[*].message' \
  --output text | tail -100
```

**Step 2: Check if Redis operations are timing out**
- Look for "Redis unavailable" or "Redis timeout" messages
- Server actions should fall back to MongoDB if Redis fails

**Step 3: Check MongoDB connectivity**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl get pods -n codeclashers -l app=mongodb
```

### 4. Deployment Issues

#### CI/CD Pipeline Overview

**All deployments are fully automated via GitHub Actions:**

- **Backend:** Auto-deploys on push to `main` (backend changes)
- **Frontend Build:** Auto-builds on push to `main` (client changes)
- **Frontend Deploy:** Auto-deploys after successful build
- **Secrets Sync:** Manages Kubernetes secrets from GitHub Secrets

See the [Prerequisites and Access Methods](#prerequisites-and-access-methods) section above for full CI/CD details.

#### Checking Deployment Status

**Backend Deployment:**
```bash
cd /Users/ase/Documents/CodeClashers
gh run list --workflow=deploy-backend.yml --limit 5
gh run watch <RUN_ID> --exit-status
```

**Frontend Build:**
```bash
cd /Users/ase/Documents/CodeClashers
gh run list --workflow=frontend-build.yml --limit 5
gh run watch <RUN_ID> --exit-status
```

**Frontend Deploy:**
```bash
cd /Users/ase/Documents/CodeClashers
gh run list --workflow=frontend-deploy.yml --limit 5
gh run watch <RUN_ID> --exit-status
```

**Manual Deployment Trigger:**
```bash
# Trigger backend deployment manually
gh workflow run deploy-backend.yml

# Trigger frontend build manually
gh workflow run frontend-build.yml

# Trigger frontend deploy manually (requires artifact name)
gh workflow run frontend-deploy.yml -f artifact_name=open-next-artifacts-<SHA>
```

#### Restarting Services

**Restart Colyseus pod:**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl rollout restart deployment colyseus -n codeclashers
sudo k3s kubectl rollout status deployment colyseus -n codeclashers --timeout=60s
```

**Force image pull (if new code not loading):**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl set image deployment/colyseus colyseus=ghcr.io/rishabhvenu/codeclashers-colyseus:<TAG> -n codeclashers
sudo k3s kubectl rollout restart deployment colyseus -n codeclashers
```

**Note:** Colyseus uses `hostPort: 2567`, so only one pod can run at a time. Delete old pod before new one starts:
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
OLD_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=colyseus --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')
sudo k3s kubectl delete pod $OLD_POD -n codeclashers
```

## Key Files and Locations

### Frontend (Next.js)
- `client/src/lib/actions/bot.ts` - Bot management server actions
- `client/src/lib/redis.ts` - Redis client configuration
- `client/src/lib/actions/shared.ts` - `getSessionCookieHeader()` adds `X-Internal-Secret`
- `client/src/app/play/page.tsx` - Play page server component

### Backend (Colyseus)
- `backend/colyseus/src/lib/internalAuth.ts` - Admin authentication middleware
- `backend/colyseus/src/routes/admin.ts` - Admin API routes

### Kubernetes
- `backend/k8s/deployments/colyseus.yaml` - Colyseus deployment (includes `INTERNAL_SERVICE_SECRET` env var)
- `backend/k8s/services/redis-single-service.yaml` - Redis service (port 6380)
- `backend/k8s/secrets/secrets.yaml.template` - Secret templates

### GitHub Actions
- `.github/workflows/deploy-backend.yml` - Backend deployment
- `.github/workflows/frontend-build.yml` - Frontend build
- `.github/workflows/frontend-deploy.yml` - Frontend deployment

## Important Notes

1. **NEVER change `REDIS_PORT`** - It's `6380` and defined in GitHub Secrets. Changing it will break everything.

2. **Internal Service Authentication:**
   - Lambda → Colyseus uses `X-Internal-Secret` header
   - Secret must match between Lambda env vars and Kubernetes secret `app-secrets.INTERNAL_SERVICE_SECRET`
   - Check `client/src/lib/actions/shared.ts` for header setup

3. **Redis Configuration:**
   - Single instance mode: `REDIS_CLUSTER_ENABLED=false`
   - Cluster detection in `client/src/lib/redis.ts` uses `AND` logic (not `OR`)
   - `enableOfflineQueue: true` prevents "Stream isn't writeable" errors

4. **Error Handling:**
   - Server actions should gracefully fall back to MongoDB if Redis fails
   - Use `Promise.race` with timeout for Redis operations
   - Wrap Redis calls in try-catch blocks

5. **Debugging Flow:**
   - Always check logs first (Colyseus, Lambda, Redis)
   - Test endpoints directly with curl
   - Verify environment variables match between services
   - Check Kubernetes secrets match GitHub Secrets

## Quick Reference Commands

```bash
# SSH into VM (IP from credentials/oracle_info)
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179

# View Oracle Cloud credentials
cat credentials/oracle_info

# Get Colyseus pod name
COLYSEUS_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=colyseus -o jsonpath='{.items[0].metadata.name}')

# View Colyseus logs
sudo k3s kubectl logs -n codeclashers -l app=colyseus --tail=100 -f

# Get internal secret
INTERNAL_SECRET=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.INTERNAL_SERVICE_SECRET}' | base64 -d)

# Test bot generation endpoint
curl -X POST http://matchmaker.leetbattle.net:2567/admin/bots/generate \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -H 'X-Service-Name: test' \
  -d '{"count":1}'

# Check all pods
sudo k3s kubectl get pods -n codeclashers

# Check all services
sudo k3s kubectl get svc -n codeclashers

# Check secrets
sudo k3s kubectl get secrets -n codeclashers

# View deployment
sudo k3s kubectl describe deployment colyseus -n codeclashers
```

## MongoDB Data Persistence Issues

### Problem: Users have to recreate accounts after waiting

**Symptoms:**
- User accounts disappear after some time
- Users report having to recreate accounts
- Data appears to be lost

**Common Causes:**
1. **StatefulSet deleted and recreated** - New StatefulSet doesn't reuse old PVCs
2. **PVCs deleted** - Persistent volumes were accidentally deleted
3. **Ephemeral storage** - Data stored on tmpfs/ephemeral filesystem
4. **MongoDB pod restarted with empty volume** - Volume mount issue

### Debugging Steps

**Step 1: Check if PVCs exist and are bound**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
sudo k3s kubectl get pvc -n codeclashers | grep mongodb
```

Expected output should show PVCs in `Bound` status:
```
NAME              STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGE CLASS   AGE
data-mongodb-0    Bound    pvc-xxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx    8Gi        RWO            local-path      XXd
```

**Step 2: Verify StatefulSet PVC retention policy**
```bash
sudo k3s kubectl get statefulset mongodb -n codeclashers -o jsonpath='{.spec.persistentVolumeClaimRetentionPolicy}'
```

Should show:
```json
{"whenDeleted":"Retain","whenScaled":"Retain"}
```

**Step 3: Check storage filesystem type**
```bash
df -T /var/lib/rancher/k3s/storage/
```

Should show `ext4` or another persistent filesystem (NOT `tmpfs`).

**Step 4: Verify MongoDB data exists**
```bash
MONGODB_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=mongodb -o jsonpath='{.items[0].metadata.name}')
sudo k3s kubectl exec -n codeclashers $MONGODB_POD -- ls -la /data/db/ | head -20
```

Should show MongoDB data files (WiredTiger files, etc.).

**Step 5: Check user count in database**
```bash
MONGODB_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=mongodb -o jsonpath='{.items[0].metadata.name}')
sudo k3s kubectl exec -n codeclashers $MONGODB_POD -- mongosh mongodb://localhost:27017/codeclashers --quiet --eval 'db.users.countDocuments({})'
```

**Step 6: Check MongoDB pod restart history**
```bash
sudo k3s kubectl get pod mongodb-0 -n codeclashers -o jsonpath='{.status.containerStatuses[0].restartCount}'
sudo k3s kubectl get pod mongodb-0 -n codeclashers -o jsonpath='{.status.startTime}'
```

### Solutions

**Solution 1: Ensure PVC retention policy is set**
The StatefulSet should have `persistentVolumeClaimRetentionPolicy` set to `Retain`:
```yaml
spec:
  persistentVolumeClaimRetentionPolicy:
    whenDeleted: Retain
    whenScaled: Retain
```

**Solution 2: Create TTL index for sessions (automatic cleanup)**
```bash
MONGODB_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=mongodb -o jsonpath='{.items[0].metadata.name}')
sudo k3s kubectl exec -n codeclashers $MONGODB_POD -- mongosh mongodb://localhost:27017/codeclashers --quiet --eval 'db.sessions.createIndex({expires: 1}, {expireAfterSeconds: 0})'
```

**Solution 3: Verify StatefulSet is not being deleted during deployments**
Check deployment scripts/workflows to ensure StatefulSet is not deleted:
```bash
# Check StatefulSet creation time
sudo k3s kubectl get statefulset mongodb -n codeclashers -o jsonpath='{.metadata.creationTimestamp}'

# Check if StatefulSet was recently recreated
sudo k3s kubectl get events -n codeclashers --sort-by='.lastTimestamp' | grep mongodb | tail -20
```

**Solution 4: Backup MongoDB data**
Always backup before major operations:
```bash
MONGODB_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=mongodb -o jsonpath='{.items[0].metadata.name}')
sudo k3s kubectl exec -n codeclashers $MONGODB_POD -- mongodump --out /data/backup/$(date +%Y%m%d)
```

### Prevention

1. **Never delete StatefulSet** - Use `kubectl scale` or `kubectl apply` instead
2. **Always verify PVC retention** - Ensure `persistentVolumeClaimRetentionPolicy` is set
3. **Use persistent storage** - Ensure `local-path` storage is on persistent filesystem
4. **Regular backups** - Set up automated MongoDB backups
5. **Monitor PVC status** - Alert if PVCs become unbound or deleted

### Related Files
- `backend/k8s/mongodb/statefulset.yaml` - StatefulSet configuration
- `backend/k8s/mongodb/README.md` - MongoDB deployment documentation
- `backend/k8s/mongodb/init-indexes.js` - Index initialization script



