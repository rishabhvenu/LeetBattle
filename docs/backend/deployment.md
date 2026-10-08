# Backend Deployment Guide

Comprehensive guide for deploying the CodeClashers backend to Kubernetes (k3s) on Oracle Cloud VM with GitHub Actions automation.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites & Secrets](#prerequisites--secrets)
3. [Initial Setup](#initial-setup)
4. [Deployment Workflow](#deployment-workflow)
5. [Manual Deployment](#manual-deployment)
6. [Secret Management](#secret-management)
7. [Service Configuration](#service-configuration)
8. [Pod Management](#pod-management)
9. [Monitoring & Logs](#monitoring--logs)
10. [Troubleshooting](#troubleshooting)
11. [Rollback Procedures](#rollback-procedures)

---

## Architecture Overview

### Production Stack (Kubernetes on Oracle VM)

| Service | Type | Replicas | Notes |
|---------|------|----------|-------|
| Colyseus | Deployment | 2+ | Real-time game server, rolling updates |
| Bots | Deployment | 2+ | Bot simulation service |
| Judge0 Server | Deployment | 2+ | Code execution API |
| Judge0 Worker | Deployment | 2+ | Privileged containers |
| MongoDB | StatefulSet | 1+ | Persistent volume |
| Redis | StatefulSet | 1+ | Persistent volume |
| PostgreSQL | Deployment | 1 | Ephemeral (Judge0 only) |

### Key Directories

```
backend/
├── colyseus/           # Game server source
├── bots/               # Bot service source
├── judge0/
│   ├── api/           # Judge0 API Dockerfile
│   └── worker/        # Judge0 Worker Dockerfile
└── k8s/
    ├── namespaces/    # Namespace definitions
    ├── configmaps/    # ConfigMap resources
    ├── secrets/       # Secret templates (excluded from auto-deploy)
    ├── storage/       # PVC definitions
    ├── statefulsets/  # MongoDB, Redis
    ├── deployments/   # App deployments
    ├── services/      # Service definitions
    └── pdbs/          # Pod Disruption Budgets
```

---

## Prerequisites & Secrets

### Required GitHub Secrets

Set in: **Settings → Secrets and variables → Actions → Secrets**

| Secret | Description |
|--------|-------------|
| `REDIS_PASSWORD` | Redis authentication password |
| `MONGODB_URI` | Full MongoDB connection string with credentials |
| `OPENAI_API_KEY` | OpenAI API key for bot generation |
| `INTERNAL_SERVICE_SECRET` | Internal service authentication |
| `BOT_SERVICE_SECRET` | Bot service authentication |
| `COLYSEUS_RESERVATION_SECRET` | Colyseus reservation secret |
| `JUDGE0_POSTGRES_USER` | Judge0 database user |
| `JUDGE0_POSTGRES_PASSWORD` | Judge0 database password |
| `JUDGE0_POSTGRES_DB` | Judge0 database name |
| `AWS_ACCESS_KEY_ID` | AWS access key for S3 (optional) |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key for S3 (optional) |

### Required GitHub Variables

Set in: **Settings → Secrets and variables → Actions → Variables**

| Variable | Description | Default |
|----------|-------------|---------|
| `COLYSEUS_HOST_IP` | Oracle VM public IP address | **Required** |
| `REDIS_HOST` | Redis host (use VM IP or `redis-cluster`) | `redis-cluster` |
| `REDIS_PORT` | Redis port | `6379` |
| `MONGODB_PORT` | MongoDB port | `27017` |
| `COLYSEUS_PORT` | Colyseus port | `2567` |
| `JUDGE0_PORT` | Judge0 port | `2358` |
| `S3_BUCKET_NAME` | S3 bucket name | Optional |
| `AWS_REGION` | AWS region | `us-east-1` |

---

## Initial Setup

### 1. Bootstrap Master Node

On a new Oracle Cloud VM:

```bash
# Clone the repository
git clone https://github.com/your-org/codeclashers.git
cd codeclashers

# Run bootstrap script
sudo bash infra/bootstrap-master.sh
```

The bootstrap script will:
- Install k3s with required configuration
- Disable Traefik (uses standard Services)
- Enable privileged containers (for Judge0)
- Set NodePort range to 1-65535
- Configure kubeconfig for your user

### 2. Bootstrap Worker Nodes (Optional)

```bash
# On master node, get the token:
sudo cat /var/lib/rancher/k3s/server/node-token

# On worker node:
export K3S_URL=https://<master-ip>:6443
export K3S_TOKEN=<token-from-master>
sudo bash infra/bootstrap-worker.sh
```

### 3. Sync Secrets

Before first deployment:

1. Set all required secrets in GitHub Secrets/Variables
2. Go to GitHub Actions → `sync-secrets.yml` workflow
3. Click "Run workflow" → "Run workflow"
4. Verify: `kubectl get secrets -n codeclashers`

---

## Deployment Workflow

### Automated Deployment (Recommended)

**Trigger:** Push to `main` branch with changes in `backend/` or manual dispatch

**Workflow:** `.github/workflows/deploy-backend.yml`

**Pipeline Stages:**

1. **Checkout & Setup** - Clone repo, configure Node.js and Docker
2. **Install Dependencies** - `npm ci` for Colyseus and Bots
3. **Lint & Build** - TypeScript compilation and linting
4. **Docker Build & Push** - Build and push to GHCR
5. **Kubernetes Deploy** - Apply manifests with rolling updates
6. **Health Checks** - Verify all pods are healthy

**What the workflow does:**
- ✅ Builds Docker images (Colyseus, Bots, Judge0)
- ✅ Pushes images to GitHub Container Registry
- ✅ Applies Kubernetes manifests
- ✅ Performs rolling updates

**What it does NOT do:**
- ❌ Install k3s (use bootstrap scripts)
- ❌ Create/update secrets (use sync-secrets.yml)
- ❌ Apply secrets/ directory

### Quick Deploy Checklist

1. Set `COLYSEUS_HOST_IP` variable to your Oracle VM IP
2. Set all required secrets
3. Push to `main` branch OR run workflow manually
4. Verify: `kubectl get svc -n codeclashers`

---

## Manual Deployment

For manual deployments without GitHub Actions:

```bash
# SSH into the VM
ssh user@<vm-ip>

# Set environment
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
cd /opt/codeclashers && git pull

# Set image tags
export IMAGE_TAG=$(git rev-parse --short HEAD)
export COLYSEUS_IMAGE="ghcr.io/rishabhvenu/codeclashers-colyseus:${IMAGE_TAG}"
export BOTS_IMAGE="ghcr.io/rishabhvenu/codeclashers-bots:${IMAGE_TAG}"

# Build images locally (if GHCR unavailable)
docker build -t ${COLYSEUS_IMAGE} backend/colyseus
docker build -t ${BOTS_IMAGE} backend/bots

# Apply manifests (excluding secrets/)
cd backend/k8s
kubectl apply -f namespaces/
kubectl apply -f configmaps/
kubectl apply -f storage/
kubectl apply -f statefulsets/
kubectl apply -f pdbs/
kubectl apply -f services/
kubectl apply -f deployments/

# Or with envsubst for image tags
envsubst < deployments/colyseus.yaml | kubectl apply -f -

# Monitor rollout
kubectl rollout status deployment/colyseus -n codeclashers
kubectl rollout status deployment/bots -n codeclashers
```

---

## Secret Management

### Architecture

Secrets follow a two-tier approach:

1. **GitHub Secrets/Variables** - Source of truth
2. **Kubernetes Secrets** - Runtime values (synced on-demand)

### Why Separate Secret Sync?

- ✅ **Intentional updates** - Secrets only change when explicitly synced
- ✅ **Stable deployments** - Deploy doesn't accidentally overwrite secrets
- ✅ **Audit trail** - Manual sync visible in GitHub Actions
- ✅ **Rollback safety** - Secrets don't change on every code deployment

### Secret Types Created

| Secret | Purpose |
|--------|---------|
| `app-secrets` | Main app secrets (Redis, MongoDB, AWS, etc.) |
| `mongodb-secrets` | MongoDB credentials for StatefulSet |
| `mongodb-keyfile` | MongoDB replica set keyfile (auto-generated) |
| `ghcr-secret` | GitHub Container Registry auth |

### Syncing Secrets

```bash
# Verify secrets exist
kubectl get secrets -n codeclashers

# Manual sync via GitHub Actions:
# Actions → sync-secrets.yml → Run workflow
```

---

## Service Configuration

### External Access

After deployment, services are accessible at:

| Service | URL |
|---------|-----|
| Colyseus | `http://<COLYSEUS_HOST_IP>:2567` |
| Colyseus WS | `ws://<COLYSEUS_HOST_IP>:2567` |
| MongoDB | `<COLYSEUS_HOST_IP>:27017` |
| Redis | `<COLYSEUS_HOST_IP>:6379` |
| Judge0 | `<COLYSEUS_HOST_IP>:2358` |

### Frontend Configuration

Set these for frontend deployment:
- `NEXT_PUBLIC_COLYSEUS_HTTP_URL` = `http://<COLYSEUS_HOST_IP>:2567`
- `NEXT_PUBLIC_COLYSEUS_WS_URL` = `ws://<COLYSEUS_HOST_IP>:2567`
- `REDIS_HOST` = `<COLYSEUS_HOST_IP>`

### Zero-Downtime Deployments

All deployments use rolling updates:
- `maxSurge: 1` - Allow one extra pod during update
- `maxUnavailable: 0` - Never fewer than desired replicas
- PodDisruptionBudgets ensure minimum availability
- Readiness probes prevent traffic to unhealthy pods

---

## Pod Management

### Restarting Services

```bash
# Single deployment (rolling update, zero-downtime)
kubectl rollout restart deployment/colyseus -n codeclashers

# Check rollout status
kubectl rollout status deployment/colyseus -n codeclashers

# Multiple deployments
kubectl rollout restart deployment/colyseus deployment/bots -n codeclashers

# StatefulSets (careful - may cause brief downtime)
kubectl delete pod mongodb-0 -n codeclashers
```

### Scaling

```bash
# Scale a deployment
kubectl scale deployment colyseus --replicas=3 -n codeclashers

# Scale down for maintenance
kubectl scale deployment colyseus --replicas=0 -n codeclashers
```

---

## Monitoring & Logs

### Pod Status

```bash
# List all pods
kubectl get pods -n codeclashers

# Detailed pod info
kubectl describe pod <pod-name> -n codeclashers

# Resource usage
kubectl top pods -n codeclashers
kubectl top node
```

### Viewing Logs

```bash
# Follow logs
kubectl logs -f deployment/colyseus -n codeclashers

# Specific pod
kubectl logs -f <pod-name> -n codeclashers

# Previous crashed container
kubectl logs --previous deployment/colyseus -n codeclashers

# All containers in deployment
kubectl logs -f deployment/colyseus -n codeclashers --all-containers
```

### Health Checks

```bash
# Check Colyseus
kubectl exec -n codeclashers deployment/colyseus -- nc -z localhost 2567

# Check Judge0
kubectl exec -n codeclashers deployment/judge0-server -- curl -f http://localhost:2358

# Check Redis
kubectl exec -n codeclashers deployment/redis -- redis-cli -a $REDIS_PASSWORD ping

# Check MongoDB
kubectl exec -n codeclashers deployment/mongodb -- mongosh --eval "db.adminCommand('ping')"
```

---

## Troubleshooting

### Secrets Not Found

**Error:** `secrets "app-secrets" not found`

**Solution:**
1. Verify secrets exist: `kubectl get secrets -n codeclashers`
2. Run `sync-secrets.yml` workflow
3. Check GitHub Secrets are configured

### Images Not Pulling

**Error:** `ImagePullBackOff`

**Solution:**
1. Verify image exists: `docker manifest inspect ghcr.io/rishabhvenu/codeclashers-colyseus:<tag>`
2. Check `ghcr-secret` exists: `kubectl get secret ghcr-secret -n codeclashers`
3. Force restart: `kubectl rollout restart deployment/<name> -n codeclashers`

### Services Not Accessible

**Issue:** Can't connect from outside cluster

**Solution:**
1. Check service type: `kubectl get svc -n codeclashers`
2. Verify externalIPs: `kubectl describe svc/<name> -n codeclashers`
3. Check `COLYSEUS_HOST_IP` is set correctly
4. Verify firewall rules allow traffic

### Judge0 Not Working

**Issue:** Code submissions fail

**Solution:**
1. Check Judge0 logs: `kubectl logs deployment/judge0-server -n codeclashers`
2. Check worker logs: `kubectl logs deployment/judge0-worker -n codeclashers`
3. Verify PostgreSQL: `kubectl get pods -l app=postgres -n codeclashers`
4. Check config: `kubectl exec deployment/judge0-server -n codeclashers -- cat /api/config.json`

### Authentication Errors (401)

**Symptoms:** Frontend gets 401 on queue/match endpoints

**Solution:**
- ✅ Verify `INTERNAL_SERVICE_SECRET` matches between frontend and backend
- ✅ Verify Lambda has `INTERNAL_SERVICE_SECRET` environment variable
- ✅ Check frontend sends `X-Internal-Secret` header

### MongoDB Connection Failed

**Symptoms:** Authentication failed errors

**Solution:**
- ✅ Verify `MONGODB_URI` includes username, password, and `authSource=admin`
- ✅ Test connection: `mongosh "<MONGODB_URI>"`

### Out of Memory

**Issue:** Pods being OOMKilled

**Solution:**
1. Check usage: `kubectl top node`
2. Scale down replicas or adjust memory limits
3. Oracle Cloud free tier has 24GB RAM

---

## Rollback Procedures

### Automatic Rollback

The workflow automatically rolls back on health check failure.

### Manual Rollback

```bash
# Rollback to previous version
kubectl rollout undo deployment/colyseus -n codeclashers
kubectl rollout undo deployment/bots -n codeclashers

# Check rollback status
kubectl rollout status deployment/colyseus -n codeclashers

# View rollout history
kubectl rollout history deployment/colyseus -n codeclashers

# Rollback to specific revision
kubectl rollout undo deployment/colyseus --to-revision=2 -n codeclashers
```

---

## Rebuilding Judge0

### When to Rebuild

- Judge0 source code changes
- Config.json updates (language support)
- Script changes

### Process

```bash
# 1. Clone Judge0 source
git clone https://github.com/judge0/judge0.git /tmp/judge0-src

# 2. Copy to API directory (preserve ARM64 Dockerfile)
rsync -av --exclude='Dockerfile' /tmp/judge0-src/ backend/judge0/api/

# 3. Filter config.json for ARM64 (removes unsupported languages)
cd backend/judge0/api
jq 'del(.languages[] | select(.name | test("Swift|Pascal|Mono|C#|Go|Kotlin|PHP|Perl|Ruby"; "i")))' config.json > config.json.tmp && mv config.json.tmp config.json

# 4. Test build locally (optional)
docker buildx build --platform linux/arm64 \
  -t ghcr.io/rishabhvenu/codeclashers-judge0-api-arm64:test \
  -f backend/judge0/api/Dockerfile \
  backend/judge0/api/

# 5. Commit and push - workflow will build and deploy
git add backend/judge0/
git commit -m "Update Judge0 source code"
git push origin main
```

---

## Quick Reference

### Common Commands

```bash
# Get all resources
kubectl get all -n codeclashers

# Get services with external IPs
kubectl get svc -n codeclashers

# Restart all deployments
kubectl rollout restart deployment -n codeclashers

# Watch pod status
kubectl get pods -n codeclashers -w

# Execute into pod
kubectl exec -it <pod-name> -n codeclashers -- /bin/sh

# Check events
kubectl get events -n codeclashers --sort-by='.lastTimestamp'
```

### Deployment Triggers

| Trigger | Action |
|---------|--------|
| Push to `main` | Auto-deploy if `backend/` changed |
| Manual dispatch | GitHub Actions → Deploy Backend → Run |
| Secret changes | Run `sync-secrets.yml` first |

