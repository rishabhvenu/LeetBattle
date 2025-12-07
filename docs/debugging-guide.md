# Debugging Guide for CodeClashers Production

## SSH Access to Oracle Cloud VM

### Prerequisites
- SSH key file: `~/.ssh/oci.pem`
- VM IP: `40.233.103.179`
- User: `ubuntu`

### SSH Command
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
```

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

### 1. Bot Generation Issues

#### Problem: "Failed to generate bot profile" toast

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
  --output text | grep -E 'generateBotProfile|API base|Internal secret|Response|ERROR|error'
```

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

3. **Wrong API endpoint**
   - Frontend should use `NEXT_PUBLIC_COLYSEUS_HTTP_URL` (falls back to `http://matchmaker.leetbattle.net:2567`)
   - Check Lambda environment variables

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
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
export AWS_ACCESS_KEY_ID=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_ACCESS_KEY_ID}' | base64 -d)
export AWS_SECRET_ACCESS_KEY=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_SECRET_ACCESS_KEY}' | base64 -d)
export AWS_DEFAULT_REGION=us-east-1
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
# SSH into VM
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179

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



