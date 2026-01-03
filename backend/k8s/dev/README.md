# Local Development with k3d

This directory contains Kubernetes manifests for local development using k3d (k3s in Docker), a lightweight Kubernetes distribution that runs in Docker containers.

## Prerequisites

1. **Docker** installed and running
2. **k3d** installed:
   - macOS: `brew install k3d`
   - Linux: See [k3d installation guide](https://k3d.io/)
   - Windows: See [k3d installation guide](https://k3d.io/)
3. **kubectl** installed
4. **kustomize** (optional - kubectl 1.14+ has built-in support)

## Quick Start

### 1. Create k3d Cluster

First, create a k3d cluster with proper port mappings:

```bash
cd backend/k8s/dev
./setup-k3d-cluster.sh
```

This script will:
- Create a k3d cluster named `codeclashers-dev`
- Configure port mappings for all services (via k3d loadbalancer)
- Enable privileged containers (required for Judge0 workers)
- Set up kubectl to use the new cluster

**Alternative: Manual Cluster Creation**

If you prefer to create the cluster manually:

```bash
k3d cluster create codeclashers-dev \
  --port "27017:32017@loadbalancer" \
  --port "6379:30637@loadbalancer" \
  --port "2567:30267@loadbalancer" \
  --port "2358:32358@loadbalancer" \
  --port "9000:30900@loadbalancer" \
  --port "9001:30901@loadbalancer" \
  --port "3030:30300@loadbalancer" \
  --port "9090:30909@loadbalancer" \
  --port "3100:31000@loadbalancer" \
  --k3s-arg "--secrets-encryption@server:0" \
  --k3s-arg "--service-node-port-range=1-65535@server:0"
```

### Verify Cluster is Running

```bash
kubectl cluster-info
kubectl get nodes
```

You should see your k3d cluster nodes listed.

### 2. Run Setup Script

From the project root:

```bash
cd backend/k8s/dev
./setup-dev.sh
```

**What this does:**
1. ✅ Checks kubectl connection to Kubernetes
2. ✅ Creates `codeclashers-dev` namespace
3. ✅ Creates secrets (matches your `.env` files)
4. ✅ Builds Docker images (Colyseus & Bots)
5. ✅ Deploys all services
6. ✅ Waits for services to be ready

**Expected time:** 2-5 minutes (depending on image builds)

### 3. Verify Services

```bash
# Check all pods are running
kubectl get pods -n codeclashers-dev

# Check services
kubectl get svc -n codeclashers-dev
```

### 4. Access Services

**Option 1: Use k3d Loadbalancer (Recommended - No Setup Needed)**

Services are automatically accessible via k3d's loadbalancer on standard ports:
- MongoDB: `localhost:27017`
- Redis: `localhost:6379`
- Colyseus: `localhost:2567`
- Judge0: `localhost:2358`
- MinIO API: `localhost:9000`
- MinIO Console: `localhost:9001`
- Grafana: `localhost:3030` (username: `admin`, password: `admin`)
- Prometheus: `localhost:9090`

**Option 2: Use Port-Forward Daemon (Background, Auto-Restarts)**

If you prefer port-forwarding or loadbalancer isn't working, use the daemon:

```bash
cd backend/k8s/dev
./port-forward-daemon.sh
```

This runs in the background and auto-restarts if pods restart. To stop:

```bash
./stop-port-forward.sh
```

**Option 3: Use NodePort (Fallback)**

If loadbalancer ports aren't configured, services are exposed on NodePorts:
- MongoDB: `localhost:32017`
- Redis: `localhost:30637`
- Colyseus: `localhost:30267`
- Judge0: `localhost:32358`
- MinIO API: `localhost:30900`
- MinIO Console: `localhost:30901`
- Grafana: Check service for NodePort (`kubectl get svc -n codeclashers-dev grafana`)
- Prometheus: Check service for NodePort (`kubectl get svc -n codeclashers-dev prometheus`)

**MinIO Credentials:**
- Username: `minioadmin`
- Password: `minioadmin123`

**Grafana Credentials:**
- Username: `admin`
- Password: `admin` (default dev password)

## Manual Setup

If you prefer to set up manually:

### 1. Create Secrets

```bash
cd backend/k8s/dev
./create-dev-secrets.sh
```

### 2. Deploy with Kustomize

```bash
# Using kubectl (1.14+)
kubectl apply -k .

# Or using kustomize
kustomize build . | kubectl apply -f -
```

## Development vs Production

### Local Development (This Setup)
- **MongoDB**: Single instance (no replica set)
- **Redis**: 3-node cluster (matches production behavior, smaller scale)
- **MinIO**: Local S3-compatible storage
- **Replicas**: 1 per service (for resource efficiency)
- **Namespace**: `codeclashers-dev`

### Production (Oracle Cloud)
- **MongoDB**: 3-node replica set with automatic failover
- **Redis**: 6-node cluster with replication
- **AWS S3**: Cloud storage (no MinIO)
- **Replicas**: 2+ per service (high availability)
- **Namespace**: `codeclashers`

## Configuration

### Environment Variables

The setup uses default development values. To customize, edit `create-dev-secrets.sh` or set environment variables:

```bash
export REDIS_PASSWORD="your_password"
export MONGODB_URI="mongodb://admin:admin123@localhost:32017/codeclashers?authSource=admin"
export OPENAI_API_KEY="your_key"
./create-dev-secrets.sh
```

**Note:** Only `MONGODB_URI` is required. Username and password are automatically extracted from the URI. The format should be: `mongodb://username:password@host:port/db?authSource=admin`

### Image Building

By default, the setup script builds images locally. To use pre-built images:

```bash
BUILD_IMAGES=false ./setup-dev.sh
```

#### Rebuild After Code Changes

**Quick Rebuild (Recommended):**
```bash
cd backend/k8s/dev
./rebuild.sh
```

This script will:
- Rebuild Docker images for Colyseus and Bots
- Restart the services to use new images
- Wait for rollouts to complete

**Manual Rebuild:**
```bash
# Build images
docker build -t codeclashers-colyseus:dev ./backend/colyseus
docker build -t codeclashers-bots:dev ./backend/bots

# Restart services
cd backend/k8s/dev
./restart-safe.sh
```

## Useful Commands

### View Logs

```bash
# All services
kubectl logs -n codeclashers-dev -l environment=development --tail=100

# Specific service
kubectl logs -n codeclashers-dev -l app=colyseus --tail=100 -f
```

### Redis Cluster Initialization

After deploying the Redis Cluster StatefulSet, you need to initialize the cluster:

```bash
# Wait for all Redis pods to be ready
kubectl wait --namespace=codeclashers-dev \
  --for=condition=ready pod \
  --selector=app=redis-cluster-dev \
  --timeout=300s

# Run the initialization job
kubectl apply -f jobs/redis-cluster-init-dev.yaml

# Check initialization status
kubectl logs -n codeclashers-dev job/redis-cluster-init-dev
```

The initialization job is idempotent - it will skip initialization if the cluster is already set up.

### Wipe Redis (Development Only)

```bash
cd backend/k8s/dev
./wipe-redis.sh            # prompts before wiping
./wipe-redis.sh --yes      # skips confirmation (dangerous)
```

This runs `FLUSHALL` against the dev Redis Cluster pods (`redis-cluster-dev` StatefulSet) and verifies the key count is zero afterward. Use cautiously—this removes **all** cached data in the dev namespace.

### Auto-Start Port Forwarding

To automatically start port-forwarding when running setup:

```bash
AUTO_PORT_FORWARD=true ./setup-dev.sh
```

This will start the port-forward daemon in the background automatically.

### Manual Port Forwarding (Alternative to Loadbalancer)

```bash
# MongoDB
kubectl port-forward -n codeclashers-dev svc/mongodb-dev 27017:27017

# Redis
kubectl port-forward -n codeclashers-dev svc/redis-cluster-dev 6379:6379

# Colyseus
kubectl port-forward -n codeclashers-dev svc/colyseus 2567:2567
```

### Restart Services

```bash
# Restart a specific deployment
kubectl rollout restart deployment/colyseus -n codeclashers-dev

# Restart all deployments
kubectl rollout restart deployment -n codeclashers-dev
```

### Delete Everything

```bash
# Delete entire namespace (removes all resources)
kubectl delete namespace codeclashers-dev

# Or delete specific resources
kubectl delete -k .
```

### Delete k3d Cluster

To completely remove the k3d cluster:

```bash
k3d cluster delete codeclashers-dev
```

**⚠️ WARNING:** This will delete the cluster and **ALL persistent volume data** (MongoDB, Redis, MinIO). Make sure to backup any important data before deleting the cluster.

You can recreate it later with `./setup-k3d-cluster.sh`, but all data will be lost.

### Volume Persistence

k3d uses the `local-path-provisioner` which stores volumes on the host filesystem:

- ✅ **Data persists** across pod restarts
- ✅ **Data persists** when you stop/start the k3d cluster
- ✅ **Data persists** when Docker restarts
- ❌ **Data is LOST** when you delete the cluster (`k3d cluster delete`)

**Persistent Volumes:**
- MongoDB: 8Gi (`mongodb-data-dev`)
- Redis: 2Gi per node (`redis-cluster-dev-0`, `redis-cluster-dev-1`, `redis-cluster-dev-2`)
- MinIO: 10Gi (`minio-data-dev`)

To backup data before cluster deletion, you can export data from MongoDB/Redis or copy files from MinIO.

## Troubleshooting

### Services Not Starting

```bash
# Check pod status
kubectl get pods -n codeclashers-dev

# Describe pod to see errors
kubectl describe pod <pod-name> -n codeclashers-dev

# Check logs
kubectl logs <pod-name> -n codeclashers-dev
```

### Port Already in Use

If a port is already in use, you can:
1. Stop the conflicting service
2. Modify the service YAML to use a different NodePort
3. Use port forwarding instead of NodePort

### MinIO Bucket Not Created

The MinIO init job should run automatically. If the bucket isn't created:

```bash
# Check init job status
kubectl get jobs -n codeclashers-dev

# Manually run init
kubectl delete job minio-init-dev -n codeclashers-dev
kubectl apply -f minio-dev.yaml
```

### MongoDB Connection Issues

Ensure MongoDB is fully ready:

```bash
kubectl wait --namespace=codeclashers-dev \
  --for=condition=ready pod \
  --selector=app=mongodb-dev \
  --timeout=300s
```

### Redis Connection Issues

Check Redis password matches in secrets:

```bash
kubectl get secret app-secrets-dev -n codeclashers-dev -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d
```

## File Structure

```
dev/
├── kustomization.yaml        # Main kustomize config
├── namespace-dev.yaml        # Development namespace
├── mongodb-dev.yaml          # Single MongoDB instance
├── statefulsets/redis-cluster-dev.yaml  # Redis Cluster StatefulSet (3 nodes)
├── services/redis-cluster-dev.yaml     # Redis Cluster service
├── services/redis-cluster-headless-dev.yaml  # Redis Cluster headless service
└── jobs/redis-cluster-init-dev.yaml    # Redis Cluster initialization job
├── minio-dev.yaml            # MinIO for local S3
├── patches/
│   └── deployments.yaml      # Dev-specific deployment patches
├── create-dev-secrets.sh     # Secret creation script
├── setup-dev.sh             # Full setup script
└── README.md                # This file
```

## Next Steps

1. Update your frontend `.env.local` to point to localhost services:
   ```env
   MONGODB_URI=mongodb://localhost:27017/codeclashers
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=redis_dev_password_123
   NEXT_PUBLIC_COLYSEUS_HTTP_URL=http://localhost:2567
   NEXT_PUBLIC_COLYSEUS_WS_URL=ws://localhost:2567
   S3_ENDPOINT=http://localhost:9000
   AWS_ACCESS_KEY_ID=minioadmin
   AWS_SECRET_ACCESS_KEY=minioadmin123
   ```

2. Start your frontend:
   ```bash
   cd client
   npm run dev
   ```

3. Access the application at `http://localhost:3000`

## Monitoring

### Grafana Dashboards

Grafana is available at `http://localhost:3030` (when using port forwarding).

**Default Credentials:**
- Username: `admin`
- Password: `admin` (change on first login)

**What you can monitor:**
- Kubernetes pod status and resource usage
- Node/VM statistics (CPU, memory, disk, network)
- Application metrics from your services
- Cluster health and performance

**Pre-configured Data Sources:**
- Prometheus (automatically configured) - provides all metrics
- Loki (automatically configured) - provides all pod logs

### Prometheus Metrics

Prometheus is available at `http://localhost:9090` (when using port forwarding).

**What it collects:**
- All Kubernetes pods metrics (CPU, memory, network)
- Node exporter metrics (VM statistics)
- Kube-state-metrics (pod status, deployment state)
- Application metrics from pods

**Query Examples:**
```promql
# Pod CPU usage
rate(container_cpu_usage_seconds_total[5m])

# Pod memory usage
container_memory_usage_bytes

# Pod status
kube_pod_status_phase

# Node CPU
node_cpu_seconds_total
```

### Viewing Monitoring Stack

```bash
# Check monitoring pods
kubectl get pods -n codeclashers-dev | grep -E 'prometheus|grafana|node-exporter|kube-state'

# View Grafana logs
kubectl logs -n codeclashers-dev -l app=grafana

# View Prometheus logs
kubectl logs -n codeclashers-dev -l app=prometheus
```

### Viewing Logs in Grafana (Loki)

All pod logs are automatically collected by Promtail and sent to Loki. View them in Grafana:

**Using Explore (Recommended):**
1. Go to **Explore** (compass icon) in Grafana
2. Select **Loki** as the data source
3. Use LogQL queries to filter logs:

```logql
# All logs from codeclashers-dev namespace
{namespace="codeclashers-dev"}

# Logs from specific pod
{pod="colyseus-xxxxx"}

# Logs from specific app
{app="colyseus"}

# Logs from specific app with text search
{app="colyseus"} |= "error"

# Logs from multiple pods
{app=~"colyseus|bots"}

# Filter by log level (if your app uses structured logging)
{namespace="codeclashers-dev"} | json | level="error"

# Time range logs with limit
{namespace="codeclashers-dev"} [5m] limit 1000
```

**Common Log Queries:**
```logql
# Colyseus logs
{app="colyseus"}

# Bots logs  
{app="bots"}

# Error logs only
{namespace="codeclashers-dev"} |= "error" or |= "Error" or |= "ERROR"

# Recent logs (last 5 minutes)
{namespace="codeclashers-dev"} [5m]

# Logs containing specific text
{namespace="codeclashers-dev"} |= "connection"
```

**Log Labels Available:**
- `namespace` - Kubernetes namespace (codeclashers-dev)
- `pod` - Pod name
- `container` - Container name
- `app` - App label from pod
- `environment` - Environment label (development)

### Loki Log Aggregation

Loki is available at `http://localhost:3100` (when using port forwarding).

**Components:**
- **Loki**: Log aggregation server (stores logs)
- **Promtail**: Log collector (DaemonSet that collects logs from all pods)

**Log Retention:** 7 days (168 hours) in dev environment

