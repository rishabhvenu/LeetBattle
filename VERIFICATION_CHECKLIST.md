# Verification Checklist - Is Everything Working?

Use this checklist to verify your refactored CI/CD setup is working correctly.

## Pre-Deployment Checks

### 1. Verify GitHub Secrets Are Set

**Location:** GitHub → Settings → Secrets and variables → Actions

**Required Secrets:**
```bash
# Check these exist:
- REDIS_PASSWORD
- MONGODB_URI (must include credentials)
- JUDGE0_POSTGRES_USER
- JUDGE0_POSTGRES_PASSWORD
- JUDGE0_POSTGRES_DB
- OPENAI_API_KEY
- INTERNAL_SERVICE_SECRET
- BOT_SERVICE_SECRET
- COLYSEUS_RESERVATION_SECRET
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- GRAFANA_ADMIN_PASSWORD (if using Grafana)
```

**Required Variables:**
```bash
- COLYSEUS_HOST_IP (your Oracle VM public IP)
- S3_BUCKET_NAME
- AWS_REGION (optional, defaults to us-east-1)
```

### 2. Verify Repository Structure

**On your local machine:**
```bash
cd /Users/ase/Documents/CodeClashers

# Check Judge0 structure
ls -la backend/judge0/api/Dockerfile
ls -la backend/judge0/worker/Dockerfile
ls -la backend/judge0/api/scripts/server
ls -la backend/judge0/worker/scripts/workers

# Check bootstrap script
ls -la infra/bootstrap-master.sh

# Check secret template
ls -la backend/k8s/secrets/secrets.yaml.template

# Check workflows
ls -la .github/workflows/deploy-backend.yml
ls -la .github/workflows/sync-secrets.yml
```

### 3. Verify VM Setup

**SSH into your VM:**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179
```

**Check k3s is running:**
```bash
# Check k3s service
sudo systemctl status k3s

# Check cluster
k3s kubectl get nodes
k3s kubectl cluster-info

# Check namespace exists (or will be created)
k3s kubectl get namespace codeclashers || echo "Will be created on first deploy"
```

**Check Docker is available:**
```bash
docker --version
docker buildx version
```

**Check required tools:**
```bash
which envsubst || echo "Will be installed during deploy"
which jq || echo "Optional"
```

---

## Step-by-Step Verification

### Step 1: Sync Secrets (First Time Only)

**In GitHub Actions:**
1. Go to **Actions** tab
2. Select **"Sync Secrets to Kubernetes"** workflow
3. Click **"Run workflow"** → **"Run workflow"**
4. Wait for completion (should take ~30 seconds)

**Verify on VM:**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179

# Check secrets were created
k3s kubectl get secrets -n codeclashers

# Should see:
# - app-secrets
# - mongodb-secrets
# - mongodb-keyfile
# - ghcr-secret

# Verify secret contents (should show keys, not values)
k3s kubectl describe secret app-secrets -n codeclashers
```

**Expected Result:** ✅ All 4 secrets exist

---

### Step 2: Test Image Build (Optional - Can Skip)

**In GitHub Actions:**
1. Go to **Actions** tab
2. Select **"Deploy Backend to Oracle Cloud (Kubernetes)"** workflow
3. Click **"Run workflow"** → **"Run workflow"**
4. Watch the build steps

**Check build logs for:**
- ✅ "Set up Docker Buildx" - succeeds
- ✅ "Log in to GitHub Container Registry" - succeeds
- ✅ "Build and push Colyseus image" - succeeds
- ✅ "Build and push Bots image" - succeeds
- ✅ "Build and push Judge0 API image" - succeeds
- ✅ "Build and push Judge0 Worker image" - succeeds

**Verify images in GitHub Container Registry:**
1. Go to GitHub → Your profile → **Packages**
2. Look for:
   - `codeclashers-colyseus`
   - `codeclashers-bots`
   - `codeclashers-judge0-api-arm64`
   - `codeclashers-judge0-worker-arm64`

**Expected Result:** ✅ All images build successfully and appear in GHCR

---

### Step 3: Verify Deployment

**After deployment completes, check on VM:**
```bash
ssh -i ~/.ssh/oci.pem ubuntu@40.233.103.179

# Check all pods are running
k3s kubectl get pods -n codeclashers

# Expected output (after a few minutes):
# NAME                              READY   STATUS    RESTARTS   AGE
# colyseus-xxx                      1/1     Running   0         2m
# bots-xxx                          1/1     Running   0         2m
# judge0-server-xxx                 1/1     Running   0         2m
# judge0-worker-xxx                 1/1     Running   0         2m
# mongodb-0                         1/1     Running   0         5m
# postgres-0                        1/1     Running   0         5m
# redis-cluster-0                   1/1     Running   0         5m
```

**Check services:**
```bash
k3s kubectl get svc -n codeclashers

# Should see services with external IPs set
```

**Check deployments:**
```bash
k3s kubectl get deployments -n codeclashers

# All should show READY 1/1
```

**Expected Result:** ✅ All pods are Running, services have external IPs

---

### Step 4: Check Pod Logs (Troubleshooting)

**If pods are not running, check logs:**
```bash
# Check Colyseus logs
k3s kubectl logs -f deployment/colyseus -n codeclashers --tail=50

# Check Judge0 server logs
k3s kubectl logs -f deployment/judge0-server -n codeclashers --tail=50

# Check Judge0 worker logs
k3s kubectl logs -f deployment/judge0-worker -n codeclashers --tail=50

# Check Bots logs
k3s kubectl logs -f deployment/bots -n codeclashers --tail=50
```

**Common issues to look for:**
- ❌ "ImagePullBackOff" → Check `ghcr-secret` exists
- ❌ "CrashLoopBackOff" → Check logs for errors
- ❌ "Pending" → Check resource limits or node capacity
- ❌ "Secrets not found" → Run sync-secrets workflow

---

### Step 5: Verify Application Functionality

**Test Colyseus endpoint:**
```bash
# From your local machine or VM
curl http://<YOUR_VM_IP>:2567/health || echo "Check if service is exposed"

# Or check service directly
k3s kubectl port-forward svc/colyseus 2567:2567 -n codeclashers &
curl http://localhost:2567/health
```

**Test Judge0 endpoint:**
```bash
# Port forward Judge0 service
k3s kubectl port-forward svc/judge0-server 2358:2358 -n codeclashers &
curl http://localhost:2358/health || echo "Check Judge0 health"
```

**Expected Result:** ✅ Services respond to health checks

---

## Quick Verification Script

**Run this on your VM for a quick health check:**
```bash
#!/bin/bash
echo "=== Kubernetes Cluster ==="
k3s kubectl get nodes
echo ""

echo "=== Namespace ==="
k3s kubectl get namespace codeclashers
echo ""

echo "=== Secrets ==="
k3s kubectl get secrets -n codeclashers
echo ""

echo "=== Pods ==="
k3s kubectl get pods -n codeclashers
echo ""

echo "=== Services ==="
k3s kubectl get svc -n codeclashers
echo ""

echo "=== Deployments ==="
k3s kubectl get deployments -n codeclashers
echo ""

echo "=== Recent Events ==="
k3s kubectl get events -n codeclashers --sort-by='.lastTimestamp' | tail -10
```

---

## Troubleshooting Guide

### Issue: Workflow fails at "Set up Docker Buildx"

**Solution:**
```bash
# On VM, check Docker
docker --version
docker buildx version

# If buildx missing, install:
docker buildx install
```

### Issue: Workflow fails at "Build and push Judge0 API image"

**Solution:**
```bash
# Check Judge0 source files exist
ls -la /opt/CodeClashers/backend/judge0/api/scripts/
ls -la /opt/CodeClashers/backend/judge0/api/Gemfile

# If missing, re-populate Judge0 source (see SETUP_CHECKLIST.md)
```

### Issue: Pods stuck in "ImagePullBackOff"

**Solution:**
```bash
# Check image pull secret
k3s kubectl get secret ghcr-secret -n codeclashers

# If missing, re-run sync-secrets workflow
# Or manually create:
k3s kubectl create secret docker-registry ghcr-secret \
  --namespace=codeclashers \
  --docker-server=ghcr.io \
  --docker-username=<your-github-username> \
  --docker-password=<your-github-token>
```

### Issue: Pods crash immediately

**Solution:**
```bash
# Check logs
k3s kubectl logs <pod-name> -n codeclashers --previous

# Check events
k3s kubectl describe pod <pod-name> -n codeclashers

# Common causes:
# - Missing secrets
# - Wrong environment variables
# - Database connection issues
```

### Issue: Services don't have external IPs

**Solution:**
```bash
# Check service configuration
k3s kubectl describe svc <service-name> -n codeclashers

# Verify COLYSEUS_HOST_IP variable is set in GitHub Variables
# Re-run deploy workflow after setting variable
```

---

## Success Criteria

✅ **Everything is working if:**
1. All GitHub Secrets/Variables are set
2. Sync-secrets workflow completes successfully
3. Deploy workflow builds all 4 images successfully
4. All pods are in "Running" state
5. Services have external IPs configured
6. Health checks respond successfully
7. No errors in pod logs

---

## Next Steps After Verification

Once everything is verified:
1. ✅ Monitor first few deployments
2. ✅ Set up monitoring/alerts (optional)
3. ✅ Document any environment-specific configurations
4. ✅ Test full application flow end-to-end

