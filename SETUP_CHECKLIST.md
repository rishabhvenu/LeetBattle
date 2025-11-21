# Setup Checklist - Getting the Refactored System Working

Follow these steps in order to get your refactored CI/CD system working.

## Prerequisites

- Oracle Cloud VM with SSH access
- GitHub repository with all secrets configured
- Access to GitHub Actions

---

## Step 1: Populate Judge0 Source Code

**Location:** SSH into your Oracle VM or use your local machine

```bash
# Clone Judge0 repository (one-time setup)
git clone https://github.com/judge0/judge0.git /tmp/judge0-src

# Navigate to your repo
cd /path/to/CodeClashers

# Copy Judge0 source to API directory (preserving Dockerfile)
rsync -av --exclude='Dockerfile' /tmp/judge0-src/ backend/judge0/api/

# Copy config.json explicitly
cp /tmp/judge0-src/config.json backend/judge0/api/config.json

# Filter config.json for ARM64 (remove unsupported languages)
cd backend/judge0/api
jq 'del(.languages[] | select(.name | test("Swift|Pascal|Mono|C#|Go|Kotlin|PHP|Perl|Ruby"; "i")))' config.json > config.json.tmp && mv config.json.tmp config.json

# Same for worker directory
cd ../../worker
rsync -av --exclude='Dockerfile' /tmp/judge0-src/ backend/judge0/worker/
cp /tmp/judge0-src/config.json backend/judge0/worker/config.json
jq 'del(.languages[] | select(.name | test("Swift|Pascal|Mono|C#|Go|Kotlin|PHP|Perl|Ruby"; "i")))' config.json > config.json.tmp && mv config.json.tmp config.json

# Commit the changes
cd /path/to/CodeClashers
git add backend/judge0/
git commit -m "Add Judge0 source code with ARM64 support"
git push origin main
```

> Ensure `config.json` and the `scripts/` directory exist inside both `backend/judge0/api/` and `backend/judge0/worker/` before building.

**Note:** If `rsync` is not available, see the alternative method in `backend/judge0/README.md`.

---

## Step 2: Bootstrap k3s on Oracle VM

**Location:** SSH into your Oracle Cloud VM

```bash
# Clone your repository
cd /opt
sudo git clone https://github.com/your-org/codeclashers.git
cd codeclashers

# Run bootstrap script (installs k3s if not present)
sudo bash infra/bootstrap-master.sh

# Verify k3s is running
k3s kubectl get nodes
k3s kubectl cluster-info
```

This installs k3s with:
- Traefik disabled
- Privileged containers enabled (for Judge0 workers)
- Standard ports enabled (1-65535)
- Kubeconfig set up in `~/.kube/config`

---

## Step 3: Verify GitHub Secrets Are Set

**Location:** GitHub Repository → Settings → Secrets and variables → Actions

Ensure these secrets exist:

**Required Secrets:**
- ✅ `REDIS_PASSWORD`
- ✅ `MONGODB_URI` (must include credentials)
- ✅ `MONGODB_PASSWORD` (optional fallback only)
- ✅ `JUDGE0_POSTGRES_USER`
- ✅ `JUDGE0_POSTGRES_PASSWORD`
- ✅ `JUDGE0_POSTGRES_DB`
- ✅ `OPENAI_API_KEY`
- ✅ `INTERNAL_SERVICE_SECRET`
- ✅ `BOT_SERVICE_SECRET`
- ✅ `COLYSEUS_RESERVATION_SECRET`
- ✅ `AWS_ACCESS_KEY_ID`
- ✅ `AWS_SECRET_ACCESS_KEY`
- ✅ `GRAFANA_ADMIN_PASSWORD` (if using Grafana)

**Required Variables:**
- ✅ `COLYSEUS_HOST_IP` (your Oracle VM's public IP)
- ✅ `S3_BUCKET_NAME`
- ✅ `AWS_REGION` (defaults to us-east-1 if not set)

Optional resource limit variables (defaults are fine):
- `K8S_COLYSEUS_REPLICAS`, `K8S_MONGODB_REPLICAS`, etc.

---

## Step 4: Sync Secrets to Kubernetes

**Location:** GitHub Actions

1. Go to your repository on GitHub
2. Click **Actions** tab
3. Select **"Sync Secrets to Kubernetes"** workflow
4. Click **"Run workflow"** → **"Run workflow"** (manual trigger)
5. Wait for completion and verify:
   ```bash
   # SSH into VM and check secrets
   kubectl get secrets -n codeclashers
   ```
   
   You should see:
   - `app-secrets`
   - `mongodb-secrets`
   - `mongodb-keyfile`
   - `ghcr-secret`

---

## Step 5: Deploy Application

**Location:** GitHub Actions (or push to main)

The deployment will trigger automatically when you push to `main`, OR you can manually trigger it:

1. Go to **Actions** → **"Deploy Backend to Oracle Cloud (Kubernetes)"**
2. Click **"Run workflow"** → **"Run workflow"**

The workflow will:
- Build Docker images (Colyseus, Bots, Judge0 API, Judge0 Worker)
- Push to GitHub Container Registry
- Deploy to Kubernetes

**Note:** First deployment will take longer (~10-15 minutes) due to image builds.

---

## Step 6: Verify Deployment

**Location:** SSH into Oracle VM

```bash
# Check all pods are running
kubectl get pods -n codeclashers

# Check services
kubectl get svc -n codeclashers

# Check deployments
kubectl get deployments -n codeclashers

# View logs if needed
kubectl logs -f deployment/colyseus -n codeclashers
kubectl logs -f deployment/judge0-server -n codeclashers
kubectl logs -f deployment/judge0-worker -n codeclashers
```

---

## Troubleshooting

### Issue: Judge0 images fail to build

**Solution:** Ensure Judge0 source code is properly copied:
```bash
# Verify files exist
ls -la backend/judge0/api/scripts/
ls -la backend/judge0/worker/scripts/

# Verify config.json exists
test -f backend/judge0/api/config.json && echo "API config OK"
test -f backend/judge0/worker/config.json && echo "Worker config OK"
```

### Issue: Secrets not found error

**Solution:** Run sync-secrets workflow manually, then retry deployment:
```bash
# On VM, verify secrets exist
kubectl get secret app-secrets -n codeclashers
```

### Issue: Pods stuck in ImagePullBackOff

**Solution:** Verify `ghcr-secret` exists and GitHub Container Registry access:
```bash
kubectl get secret ghcr-secret -n codeclashers
kubectl describe secret ghcr-secret -n codeclashers
```

### Issue: Judge0 migrations fail

**Solution:** The migration command now has `|| true` - it will skip if DB already exists. Check logs:
```bash
kubectl logs -f deployment/judge0-worker -n codeclashers
```

---

## Summary

**Critical Steps:**
1. ✅ Populate `backend/judge0/api/` and `backend/judge0/worker/` with Judge0 source
2. ✅ Bootstrap k3s on Oracle VM (`infra/bootstrap-master.sh`)
3. ✅ Configure all GitHub Secrets/Variables
4. ✅ Run sync-secrets workflow (one-time or when secrets change)
5. ✅ Deploy (automatic on push, or manual trigger)

**After Setup:**
- Secrets sync: Manual (via workflow) when secrets change
- Deployments: Automatic on push to `main`, or manual trigger
- No more dynamic patching, k3s installation, or pod deletion in CI

---

## Quick Reference Commands

```bash
# Check cluster status
kubectl get nodes
kubectl get pods -n codeclashers

# Restart a deployment
kubectl rollout restart deployment/colyseus -n codeclashers

# View logs
kubectl logs -f deployment/<name> -n codeclashers

# Sync secrets manually (on VM)
cd /opt/codeclashers
# Then run sync-secrets.yml workflow from GitHub Actions

# Force image pull
kubectl rollout restart deployment/<name> -n codeclashers
```

