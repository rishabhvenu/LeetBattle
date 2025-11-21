# Deployment Guide

This guide covers the deployment architecture and procedures for CodeClashers backend on Kubernetes.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Initial Setup](#initial-setup)
3. [Bootstrap Scripts](#bootstrap-scripts)
4. [Secret Management](#secret-management)
5. [Deployment Workflow](#deployment-workflow)
6. [Rebuilding Judge0](#rebuilding-judge0)
7. [Pod Management](#pod-management)
8. [Troubleshooting](#troubleshooting)

## Architecture Overview

### Deployment Components

- **Static Dockerfiles** - All Docker images are built from static files in the repository
- **Static Kubernetes Manifests** - All K8s resources are defined in `backend/k8s/`
- **Separate Secret Sync** - Secrets are synced manually via `sync-secrets.yml` workflow
- **Clean Deploy Pipeline** - Main deploy workflow only builds and applies manifests

### Key Directories

- `backend/judge0/api/` - Judge0 API server Dockerfile and config
- `backend/judge0/worker/` - Judge0 worker Dockerfile and config
- `backend/k8s/secrets/` - Secret templates (excluded from auto-deploy)
- `infra/` - Bootstrap scripts for k3s installation

## Initial Setup

### 1. Bootstrap Master Node

On a new Oracle Cloud VM (master node), run:

```bash
# Clone the repository
git clone https://github.com/your-org/codeclashers.git
cd codeclashers

# Run bootstrap script
sudo bash infra/bootstrap-master.sh
```

This script will:
- Install k3s with required configuration
- Set up kubeconfig for your user
- Verify cluster is ready

### 2. Bootstrap Worker Nodes (Optional)

If you need additional worker nodes:

```bash
# On the master node, get the token:
sudo cat /var/lib/rancher/k3s/server/node-token

# On the worker node, set environment variables and run:
export K3S_URL=https://<master-ip>:6443
export K3S_TOKEN=<token-from-master>
sudo bash infra/bootstrap-worker.sh
```

### 3. Sync Secrets

Before deploying, secrets must be synced from GitHub to Kubernetes:

1. Ensure all required secrets are set in GitHub Secrets/Variables
2. Go to GitHub Actions → `sync-secrets.yml` workflow
3. Click "Run workflow" → "Run workflow" (manual trigger)
4. Verify secrets are created:
   ```bash
   kubectl get secrets -n codeclashers
   ```

## Bootstrap Scripts

### bootstrap-master.sh

**Location:** `infra/bootstrap-master.sh`

**Usage:**
```bash
sudo bash infra/bootstrap-master.sh
```

**What it does:**
- Installs k3s master node
- Disables Traefik (uses standard Services)
- Enables privileged containers (for Judge0 workers)
- Sets NodePort range to 1-65535 (standard ports)
- Configures kubeconfig for your user
- Idempotent - safe to run multiple times

**Configuration:**
- Uses `--disable traefik`
- Uses `--secrets-encryption` for security
- Uses `--write-kubeconfig-mode 644` for accessibility
- Uses `--service-node-port-range=1-65535` for standard ports

### bootstrap-worker.sh

**Location:** `infra/bootstrap-worker.sh`

**Usage:**
```bash
export K3S_URL=https://<master-ip>:6443
export K3S_TOKEN=<token-from-master>
sudo bash infra/bootstrap-worker.sh
```

**What it does:**
- Installs k3s-agent on worker node
- Joins the node to the existing cluster
- Configures the agent with master connection details

**Prerequisites:**
- `K3S_URL` environment variable (master API endpoint)
- `K3S_TOKEN` environment variable (from master node)

## Secret Management

### Architecture

Secrets follow a two-tier approach:

1. **GitHub Secrets/Variables** - Source of truth
2. **Kubernetes Secrets** - Runtime values (synced on-demand)

### Why Separate Secret Sync?

- ✅ **Intentional updates** - Secrets only change when you explicitly sync them
- ✅ **Stable deployments** - Deploy workflow doesn't accidentally overwrite secrets
- ✅ **Audit trail** - Manual sync actions are visible in GitHub Actions
- ✅ **Rollback safety** - Secrets don't change on every code deployment

### Secret Templates

**Location:** `backend/k8s/secrets/secrets.yaml.template`

**Important:** This directory is **excluded** from the main deploy workflow to prevent accidental application of templates.

### Syncing Secrets

**Manual Process:**
1. Go to GitHub Actions
2. Select `sync-secrets.yml` workflow
3. Click "Run workflow" → "Run workflow"
4. Workflow will:
   - Read all secrets from GitHub
   - Substitute into templates using `envsubst`
   - Apply to Kubernetes cluster

**Required GitHub Secrets:**
- `REDIS_PASSWORD`
- `MONGODB_URI` (must include credentials)
- `MONGODB_PASSWORD` (optional fallback only)
- `JUDGE0_POSTGRES_USER`
- `JUDGE0_POSTGRES_PASSWORD`
- `JUDGE0_POSTGRES_DB`
- `OPENAI_API_KEY`
- `INTERNAL_SERVICE_SECRET`
- `BOT_SERVICE_SECRET`
- `COLYSEUS_RESERVATION_SECRET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `GITHUB_TOKEN` (automatically available)

**Required GitHub Variables:**
- `S3_BUCKET_NAME`
- `AWS_REGION` (defaults to us-east-1)
- `COLYSEUS_HOST_IP` (for external service access)
- `REDIS_PORT`, `JUDGE0_PORT`, `MONGODB_PORT`, `COLYSEUS_PORT` (with defaults)

### Secret Types Created

1. **app-secrets** - Main application secrets (Redis, MongoDB, AWS, etc.)
2. **mongodb-secrets** - MongoDB credentials for StatefulSet
3. **mongodb-keyfile** - MongoDB replica set keyfile (auto-generated)
4. **ghcr-secret** - GitHub Container Registry authentication

## Deployment Workflow

### Automated Deployment

**Trigger:** Push to `main` branch with changes in `backend/` or `.github/workflows/deploy-backend.yml`

**What it does:**
1. Builds Docker images:
   - Colyseus
   - Bots
   - Judge0 API (ARM64)
   - Judge0 Worker (ARM64)
2. Pushes images to GitHub Container Registry
3. Applies Kubernetes manifests:
   - Namespaces
   - ConfigMaps
   - Storage
   - StatefulSets
   - Services
   - Deployments
   - PodDisruptionBudgets

**What it does NOT do:**
- ❌ Install k3s (use bootstrap scripts)
- ❌ Create/update secrets (use sync-secrets.yml)
- ❌ Delete pods or StatefulSets
- ❌ Perform health checks or rollbacks
- ❌ Apply secrets/ directory

### Manual Deployment

If you need to manually deploy:

```bash
# Set image tag
export IMAGE_TAG=$(git rev-parse --short HEAD)
export COLYSEUS_IMAGE="ghcr.io/rishabhvenu/codeclashers-colyseus:${IMAGE_TAG}"
export BOTS_IMAGE="ghcr.io/rishabhvenu/codeclashers-bots:${IMAGE_TAG}"
export JUDGE0_IMAGE="ghcr.io/rishabhvenu/codeclashers-judge0-api-arm64:${IMAGE_TAG}"
export JUDGE0_WORKER_IMAGE="ghcr.io/rishabhvenu/codeclashers-judge0-worker-arm64:${IMAGE_TAG}"
export ORACLE_VM_IP="<your-vm-ip>"

# Apply manifests (excluding secrets/)
cd backend/k8s
kubectl apply -f namespaces/
kubectl apply -f configmaps/
kubectl apply -f storage/
kubectl apply -f statefulsets/
kubectl apply -f pdbs/
kubectl apply -f services/
kubectl apply -f deployments/

# Or with envsubst for image tags:
envsubst < deployments/colyseus.yaml | kubectl apply -f -
```

## Rebuilding Judge0

### When to Rebuild

- Judge0 source code changes
- Config.json updates (language support)
- Script changes (server, workers)

### Process

**1. Update Judge0 Source**

The Judge0 directory structure:
```
backend/judge0/
├── api/
│   ├── Dockerfile
│   ├── config.json
│   └── scripts/
└── worker/
    ├── Dockerfile
    ├── config.json
    └── scripts/
```

**2. Update Source Code**

Clone Judge0 repository and copy files:

```bash
# Clone Judge0
git clone https://github.com/judge0/judge0.git /tmp/judge0-src

# Copy to API directory (preserve ARM64 Dockerfile)
rsync -av --exclude='Dockerfile' /tmp/judge0-src/ backend/judge0/api/
cp /tmp/judge0-src/config.json backend/judge0/api/config.json

# Copy to worker directory (preserve ARM64 Dockerfile)
rsync -av --exclude='Dockerfile' /tmp/judge0-src/ backend/judge0/worker/
cp /tmp/judge0-src/config.json backend/judge0/worker/config.json

# Filter config.json for ARM64 compatibility (removes unsupported languages)
cd backend/judge0/api
jq 'del(.languages[] | select(.name | test("Swift|Pascal|Mono|C#|Go|Kotlin|PHP|Perl|Ruby"; "i")))' config.json > config.json.tmp && mv config.json.tmp config.json

cd ../worker
jq 'del(.languages[] | select(.name | test("Swift|Pascal|Mono|C#|Go|Kotlin|PHP|Perl|Ruby"; "i")))' config.json > config.json.tmp && mv config.json.tmp config.json
```

> Ensure `config.json` and the `scripts/` directory exist inside both `backend/judge0/api/` and `backend/judge0/worker/` before building.

**3. Test Build Locally (Optional)**

```bash
# Build API image
docker buildx build --platform linux/arm64 \
  -t ghcr.io/rishabhvenu/codeclashers-judge0-api-arm64:test \
  -f backend/judge0/api/Dockerfile \
  backend/judge0/api/

# Build worker image
docker buildx build --platform linux/arm64 \
  -t ghcr.io/rishabhvenu/codeclashers-judge0-worker-arm64:test \
  -f backend/judge0/worker/Dockerfile \
  backend/judge0/worker/
```

**4. Commit and Push**

```bash
git add backend/judge0/
git commit -m "Update Judge0 source code"
git push origin main
```

The deploy workflow will automatically build and push new images.

**5. Force Image Pull (if needed)**

If the deployment doesn't pull the new image:

```bash
# Restart the deployment to force image pull
kubectl rollout restart deployment/judge0-server -n codeclashers
kubectl rollout restart deployment/judge0-worker -n codeclashers
```

## Pod Management

### Restarting Pods Safely

**Single Deployment:**

```bash
# Restart a specific deployment (rolling update, zero-downtime)
kubectl rollout restart deployment/colyseus -n codeclashers

# Check rollout status
kubectl rollout status deployment/colyseus -n codeclashers
```

**Multiple Deployments:**

```bash
# Restart all deployments
kubectl rollout restart deployment -n codeclashers

# Or specific ones
kubectl rollout restart deployment/colyseus deployment/bots -n codeclashers
```

**StatefulSets (MongoDB, Redis):**

```bash
# StatefulSets require more care
# Delete a pod and let it recreate
kubectl delete pod mongodb-0 -n codeclashers

# Or scale down and up (CAUTION: may cause downtime)
kubectl scale statefulset mongodb --replicas=0 -n codeclashers
kubectl scale statefulset mongodb --replicas=1 -n codeclashers
```

### Checking Pod Status

```bash
# List all pods
kubectl get pods -n codeclashers

# Describe a specific pod
kubectl describe pod <pod-name> -n codeclashers

# View pod logs
kubectl logs <pod-name> -n codeclashers

# Follow logs
kubectl logs -f <pod-name> -n codeclashers
```

### Troubleshooting Failed Pods

```bash
# Check pod events
kubectl describe pod <pod-name> -n codeclashers

# Check logs
kubectl logs <pod-name> -n codeclashers --previous

# Execute into pod (debugging)
kubectl exec -it <pod-name> -n codeclashers -- /bin/sh
```

## Troubleshooting

### Secrets Not Found

**Error:** `secrets "app-secrets" not found`

**Solution:**
1. Verify secrets are synced: `kubectl get secrets -n codeclashers`
2. Run `sync-secrets.yml` workflow if missing
3. Check GitHub Secrets are set correctly

### Images Not Pulling

**Error:** `Failed to pull image` or `ImagePullBackOff`

**Solution:**
1. Verify image exists: `docker manifest inspect ghcr.io/rishabhvenu/codeclashers-colyseus:<tag>`
2. Check `ghcr-secret` exists: `kubectl get secret ghcr-secret -n codeclashers`
3. Restart deployment: `kubectl rollout restart deployment/<name> -n codeclashers`

### Deployments Not Updating

**Issue:** Changes aren't reflected after deployment

**Solution:**
1. Check image tag in deployment: `kubectl describe deployment/<name> -n codeclashers`
2. Force rollout restart: `kubectl rollout restart deployment/<name> -n codeclashers`
3. Check rollout history: `kubectl rollout history deployment/<name> -n codeclashers`

### Services Not Accessible

**Issue:** Can't connect to services from outside cluster

**Solution:**
1. Check service type: `kubectl get svc -n codeclashers`
2. Verify externalIPs are set: `kubectl describe svc/<name> -n codeclashers`
3. Check `COLYSEUS_HOST_IP` variable is set in GitHub Variables
4. Verify firewall rules allow traffic on service ports

### Judge0 Not Working

**Issue:** Judge0 submissions fail

**Solution:**
1. Check Judge0 server logs: `kubectl logs deployment/judge0-server -n codeclashers`
2. Check Judge0 worker logs: `kubectl logs deployment/judge0-worker -n codeclashers`
3. Verify PostgreSQL is running: `kubectl get pods -l app=postgres -n codeclashers`
4. Check Judge0 config.json is valid: `kubectl exec deployment/judge0-server -n codeclashers -- cat /api/config.json`

## Additional Resources

- [Bootstrap Scripts](../infra/) - k3s installation scripts
- [Secret Templates](../backend/k8s/secrets/) - Secret template files
- [Judge0 Build](../backend/judge0/) - Judge0 Dockerfiles and config
- [Kubernetes Manifests](../backend/k8s/) - All K8s resource definitions

