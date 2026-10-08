# Local Development Guide

Complete guide for setting up and running the CodeClashers backend in a local Kubernetes environment that mirrors production.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Setup Options](#setup-options)
4. [Service Access](#service-access)
5. [Daily Workflow](#daily-workflow)
6. [Viewing Logs](#viewing-logs)
7. [Restarting Services](#restarting-services)
8. [Testing with act](#testing-with-act)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start

### One-Command Setup

```bash
./scripts/dev-setup.sh
```

This will:
1. Install k3s (if not present)
2. Create `.env.dev` from template
3. Build Docker images
4. Deploy to Kubernetes
5. Run health checks

### Manual Setup

```bash
# 1. Install k3s (one-time)
./scripts/setup/install-k3s.sh

# 2. Create environment file
cp .env.dev.template .env.dev
# Edit .env.dev with your values

# 3. Deploy
./scripts/dev-setup.sh
```

---

## Architecture

### Dev-Prod Parity

The development environment **mirrors production exactly**:

- **Same Kubernetes runtime**: k3s
- **Same namespace**: `codeclashers`
- **Same service names**: `mongodb`, `redis-cluster`, `colyseus`
- **Same manifests**: Shared base with environment-specific overlays
- **Same deployment process**: Unified scripts for dev and CI/CD

### Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Desktop Kubernetes                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  MongoDB    │  │   Redis     │  │  PostgreSQL │          │
│  │  Port 27017 │  │  Port 6379  │  │  Port 5432  │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Colyseus   │  │    Bots     │  │   Judge0    │          │
│  │  Port 2567  │  │  Port 3000  │  │  Port 2358  │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                               │
│  ┌─────────────┐                                            │
│  │   MinIO     │                                            │
│  │ Port 9000/1 │                                            │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         │ Port Forward        │ Port Forward       │
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Local Machine (Your Computer)                  │
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Next.js Frontend (Port 3000)                │    │
│  │  Connects via localhost to backend services        │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Port Mapping

| Service | Internal Port | NodePort | localhost | Purpose |
|---------|--------------|----------|-----------|---------|
| MongoDB | 27017 | 32017 | 27017 | Database |
| Redis | 6379 | 30637 | 6379 | Cache/Queue |
| Colyseus | 2567 | 30267 | 2567 | Game Server |
| Judge0 | 2358 | 32358 | 2358 | Code Execution |
| MinIO API | 9000 | 30900 | 9000 | S3 API |
| MinIO Console | 9001 | 30901 | 9001 | Web UI |
| Grafana | 3000 | - | 3030 | Monitoring |
| Prometheus | 9090 | - | 9090 | Metrics |

### Dev vs Production Differences

| Aspect | Dev | Prod |
|--------|-----|------|
| Replicas | 1 per service | 2+ per service (HA) |
| MongoDB | Single instance | 3-node replica set |
| Redis | Single instance | 6-node cluster |
| Storage | MinIO | AWS S3 |
| Images | `local/*:dev` | `ghcr.io/*:sha` |

Everything else (service names, ports, connection strings) is **identical**.

---

## Setup Options

### Option 1: Docker Desktop Kubernetes

1. **Open Docker Desktop** → Settings → Kubernetes
2. **Enable Kubernetes** (use "kind" backend)
3. **Wait for green indicator**

```bash
kubectl cluster-info  # Verify connection
cd backend/k8s/dev
./setup-dev.sh
```

### Option 2: k3s (Recommended for Parity)

```bash
# Install k3s
./scripts/setup/install-k3s.sh

# Setup environment
cp .env.dev.template .env.dev
./scripts/dev-setup.sh
```

---

## Service Access

### Connection Strings

| Service | URL | Credentials |
|---------|-----|-------------|
| **MongoDB** | `mongodb://admin:admin123@localhost:27017/codeclashers?authSource=admin` | admin / admin123 |
| **Redis** | `localhost:6379` | Password: `redis_dev_password_123` |
| **Colyseus HTTP** | `http://localhost:2567` | - |
| **Colyseus WS** | `ws://localhost:2567` | - |
| **Judge0** | `http://localhost:2358` | - |
| **MinIO API** | `http://localhost:9000` | minioadmin / minioadmin123 |
| **MinIO Console** | `http://localhost:9001` | minioadmin / minioadmin123 |
| **Grafana** | `http://localhost:3030` | admin / admin |
| **Prometheus** | `http://localhost:9090` | - |

### Testing Connections

```bash
# MongoDB
mongosh mongodb://admin:admin123@localhost:27017/codeclashers?authSource=admin

# Redis
kubectl exec -it -n codeclashers-dev deployment/redis-dev -- redis-cli -a redis_dev_password_123 ping

# Colyseus
curl http://localhost:2567/

# Judge0
curl http://localhost:2358/
```

### Frontend Configuration

Your `.env.local` should include:

```env
MONGODB_URI=mongodb://admin:admin123@localhost:27017/codeclashers?authSource=admin
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_dev_password_123
NEXT_PUBLIC_COLYSEUS_HTTP_URL=http://localhost:2567
NEXT_PUBLIC_COLYSEUS_WS_URL=ws://localhost:2567
```

---

## Daily Workflow

### Making Code Changes

```bash
# Edit backend code
vim backend/colyseus/src/index.ts

# Rebuild and redeploy
./scripts/deploy/build-images.sh
./scripts/deploy/apply-manifests.sh

# Or use the rebuild script
cd backend/k8s/dev
./rebuild.sh
```

### Frontend Development

```bash
cd client
npm install
npm run dev  # Runs on http://localhost:3000
```

### Useful Commands

```bash
# View all pods
kubectl get pods -n codeclashers-dev

# View logs
kubectl logs -n codeclashers-dev deployment/colyseus -f

# Restart a service
kubectl rollout restart deployment/colyseus -n codeclashers-dev

# Execute into a pod
kubectl exec -it -n codeclashers-dev deployment/colyseus -- /bin/bash

# Check service endpoints
kubectl get svc -n codeclashers-dev
```

---

## Viewing Logs

### Quick Reference

| View Type | Command |
|-----------|---------|
| Real-time (follow) | `./logs.sh colyseus` |
| Last N lines | `./logs.sh colyseus --tail=100` |
| Previous container | `./logs.sh colyseus --previous` |
| All services | `./logs.sh --all` |

### Using the Logs Script

```bash
cd backend/k8s/dev

# Follow logs in real-time
./logs.sh colyseus
./logs.sh bots
./logs.sh judge0
./logs.sh mongodb
./logs.sh redis
```

### Direct kubectl Commands

```bash
# Follow logs from deployment
kubectl logs -n codeclashers-dev -f deployment/colyseus

# Show last 100 lines
kubectl logs -n codeclashers-dev --tail=100 -l app=colyseus

# Filter with grep
kubectl logs -n codeclashers-dev -f -l app=colyseus | grep -i error

# Show last 10 minutes
kubectl logs -n codeclashers-dev --since=10m -l app=colyseus
```

### Multi-Terminal Setup

**Terminal 1:** `./logs.sh colyseus`
**Terminal 2:** `./logs.sh bots`
**Terminal 3:** `./logs.sh judge0`
**Terminal 4:** `kubectl get pods -n codeclashers-dev -w`

---

## Restarting Services

### Safe Restart (Recommended)

```bash
cd backend/k8s/dev
./restart-safe.sh
```

This handles services with persistent volumes correctly.

### Services with Persistent Volumes

MongoDB, Redis, PostgreSQL, and MinIO use ReadWriteOnce volumes. They require special handling:

```bash
# Scale down, wait, scale up
kubectl scale deployment/mongodb-dev -n codeclashers-dev --replicas=0
kubectl wait --for=delete pod -l app=mongodb-dev -n codeclashers-dev --timeout=60s
kubectl scale deployment/mongodb-dev -n codeclashers-dev --replicas=1
```

### Services Without Persistent Volumes

```bash
# Normal rollout restart
kubectl rollout restart deployment/colyseus -n codeclashers-dev
kubectl rollout restart deployment/bots -n codeclashers-dev
kubectl rollout restart deployment/judge0-server -n codeclashers-dev
```

### Complete Reset

```bash
# WARNING: Deletes all data!
kubectl delete namespace codeclashers-dev
sleep 10
./setup-dev.sh
```

---

## Testing with act

Run GitHub Actions workflows locally using `act`:

```bash
# Install act (one-time)
brew install act  # macOS

# Run deploy workflow
./scripts/act-run.sh

# Run specific job
./scripts/act-run.sh --job deploy

# Preview without executing
./scripts/act-run.sh --dry-run

# List available workflows
./scripts/act-run.sh --list
```

### Environment Files for act

```bash
# Create secrets file
cp .secrets.dev.template .secrets.dev
# Edit to match .env.dev
```

---

## Troubleshooting

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod -n codeclashers-dev <pod-name>

# Check logs
kubectl logs -n codeclashers-dev <pod-name>

# Check all events
kubectl get events -n codeclashers-dev --sort-by='.lastTimestamp'
```

### Image Pull Errors

```bash
# Check if images exist
docker images | grep codeclashers

# Rebuild images
docker build -t codeclashers-colyseus:dev backend/colyseus
docker build -t codeclashers-bots:dev backend/bots
```

### Port Already in Use

```bash
# Find what's using the port
lsof -i :27017
lsof -i :6379
lsof -i :2567
```

### MongoDB CrashLoopBackOff

**Cause:** Two pods trying to access same volume

```bash
# Fix: Scale down then up
kubectl scale deployment/mongodb-dev -n codeclashers-dev --replicas=0
sleep 5
kubectl scale deployment/mongodb-dev -n codeclashers-dev --replicas=1
```

### Pod Stuck in Terminating

```bash
kubectl delete pod <pod-name> -n codeclashers-dev --force --grace-period=0
```

### Services Not Accessible

```bash
# Check services
kubectl get svc -n codeclashers-dev

# Check endpoints (should have IPs)
kubectl get endpoints -n codeclashers-dev

# Use port-forwarding as fallback
kubectl port-forward -n codeclashers-dev svc/mongodb-dev 27017:27017 &
kubectl port-forward -n codeclashers-dev svc/redis 6379:6379 &
kubectl port-forward -n codeclashers-dev svc/colyseus 2567:2567 &
```

### k3s Not Accessible

```bash
# Check k3s status
docker ps | grep k3s  # macOS
systemctl status k3s  # Linux

# Restart k3s
docker restart k3s-server  # macOS
sudo systemctl restart k3s  # Linux

# Check kubeconfig
export KUBECONFIG=~/.kube/config
kubectl cluster-info
```

---

## Data Flow Reference

### User Registration/Login
1. User submits form → Next.js Server Action
2. Server Action connects to MongoDB (via port-forward)
3. Creates user account in MongoDB
4. Creates session in `sessions` collection
5. Sets session cookie

### Matchmaking Flow
1. User clicks "Find Match" → Next.js Server Action
2. Server Action calls Colyseus `/match/queue` endpoint
3. Colyseus adds user to Redis queue
4. Matchmaking cycle runs every few seconds
5. Match found → creates MatchRoom
6. Updates MongoDB with match data
7. Returns match info to frontend

### Code Execution Flow
1. User submits code → Colyseus MatchRoom
2. Colyseus sends to Judge0 API (`POST /submissions`)
3. Judge0 Server queues job in Redis
4. Judge0 Worker picks up and executes code
5. Results stored in PostgreSQL
6. Results returned to Colyseus
7. Colyseus updates match state
8. Frontend receives update via WebSocket

---

## Benefits of Dev-Prod Parity

- ✅ **Find production issues in dev** - Same environment = same behavior
- ✅ **Test workflows locally** - Use `act` to run GitHub Actions
- ✅ **Fast iteration** - No need to push to test
- ✅ **Confidence in changes** - If it works in dev, it works in prod
- ✅ **Single source of truth** - Same scripts, same manifests

