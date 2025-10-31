# Production Backend Setup (Kubernetes)

This guide explains how to set up the backend services on Oracle Cloud VM using Kubernetes (k3s) with automatic deployment via GitHub Actions.

## Architecture Overview

**Production (Kubernetes on Oracle VM):**
- k3s (lightweight Kubernetes)
- Colyseus (2+ replicas, rolling updates, zero-downtime)
- Bot Service (2+ replicas)
- Judge0 Server (2+ replicas)
- Judge0 Worker (2+ replicas, privileged)
- MongoDB (StatefulSet, persistent volume)
- Redis (StatefulSet, persistent volume)
- PostgreSQL (Deployment, ephemeral)

**Development (Docker Compose):**
- Keep existing `docker-compose.yml` unchanged

## What This Setup Includes

- ✅ **Colyseus** - Real-time game server (Kubernetes Deployment)
- ✅ **Redis** - Caching and matchmaking queue (StatefulSet with persistence)
- ✅ **MongoDB** - Database (StatefulSet with persistence)
- ✅ **Judge0 Server** - Code execution API (Kubernetes Deployment)
- ✅ **Judge0 Worker** - Code execution engine (Kubernetes Deployment, privileged)
- ✅ **Judge0 PostgreSQL** - Judge0 database (Kubernetes Deployment, ephemeral)
- ✅ **Bot Service** - Automated bot players (Kubernetes Deployment)

## External Services

- ✅ **All services run locally** on the Oracle VM in Kubernetes
- ❌ **MinIO** - Uses AWS S3 for object storage (configured via secrets)

## Fully Automated Deployment

**No manual setup required!** Everything is automated via GitHub Actions.

When you push to `main` with changes in `backend/`, the workflow will:

1. **First run only**: Install k3s on the self-hosted runner
2. Build Docker images (Colyseus and Bots)
3. Push images to GitHub Container Registry
4. Create Kubernetes namespace and secrets
5. Deploy all services with zero-downtime rolling updates
6. Perform health checks and verify deployments

## GitHub Secrets Required

Configure these secrets in your GitHub repository settings:

### Required Secrets

- `REDIS_PASSWORD` - Redis authentication password
- `JUDGE0_POSTGRES_USER` - PostgreSQL username for Judge0
- `JUDGE0_POSTGRES_PASSWORD` - PostgreSQL password for Judge0
- `JUDGE0_POSTGRES_DB` - PostgreSQL database name for Judge0
- `MONGODB_USERNAME` - MongoDB username (e.g., "admin")
- `MONGODB_PASSWORD` - MongoDB password
- `OPENAI_API_KEY` - OpenAI API key for bot generation
- `INTERNAL_SERVICE_SECRET` - Secret for internal service auth
- `BOT_SERVICE_SECRET` - Secret for bot service
- `COLYSEUS_RESERVATION_SECRET` - Secret for Colyseus reservations
- `AWS_ACCESS_KEY_ID` - AWS access key for S3
- `AWS_SECRET_ACCESS_KEY` - AWS secret key for S3
- `S3_BUCKET_NAME` - Name of your S3 bucket
- `AWS_REGION` - AWS region (default: us-east-1)
- `MONGODB_URI` - Full MongoDB connection string for external access (CloudFront/Frontend)
  - Format: `mongodb://<username>:<password>@<vm-ip-or-domain>:32017/codeclashers?authSource=admin`
  - Get VM IP: `curl ifconfig.me` or check Oracle Cloud console
  - Example: `mongodb://admin:yourpassword@123.456.789.0:32017/codeclashers?authSource=admin`

### Optional Resource Limits (with defaults)

**MongoDB:**
- `K8S_MONGODB_REPLICAS` - Default: 1
- `K8S_MONGODB_MEMORY_REQUEST` - Default: 2Gi
- `K8S_MONGODB_MEMORY_LIMIT` - Default: 4Gi
- `K8S_MONGODB_CPU_REQUEST` - Default: 500m
- `K8S_MONGODB_CPU_LIMIT` - Default: 1000m

**Redis:**
- `K8S_REDIS_REPLICAS` - Default: 1
- `K8S_REDIS_MEMORY_REQUEST` - Default: 512Mi
- `K8S_REDIS_MEMORY_LIMIT` - Default: 1Gi
- `K8S_REDIS_CPU_REQUEST` - Default: 250m
- `K8S_REDIS_CPU_LIMIT` - Default: 500m

**PostgreSQL:**
- `K8S_POSTGRES_REPLICAS` - Default: 1
- `K8S_POSTGRES_MEMORY_REQUEST` - Default: 256Mi
- `K8S_POSTGRES_MEMORY_LIMIT` - Default: 512Mi
- `K8S_POSTGRES_CPU_REQUEST` - Default: 250m
- `K8S_POSTGRES_CPU_LIMIT` - Default: 500m

**Colyseus (recommended 2+ for zero-downtime):**
- `K8S_COLYSEUS_REPLICAS` - Default: 2
- `K8S_COLYSEUS_MEMORY_REQUEST` - Default: 512Mi
- `K8S_COLYSEUS_MEMORY_LIMIT` - Default: 1Gi
- `K8S_COLYSEUS_CPU_REQUEST` - Default: 500m
- `K8S_COLYSEUS_CPU_LIMIT` - Default: 1000m

**Judge0 Server:**
- `K8S_JUDGE0_SERVER_REPLICAS` - Default: 2
- `K8S_JUDGE0_SERVER_MEMORY_REQUEST` - Default: 512Mi
- `K8S_JUDGE0_SERVER_MEMORY_LIMIT` - Default: 1Gi
- `K8S_JUDGE0_SERVER_CPU_REQUEST` - Default: 500m
- `K8S_JUDGE0_SERVER_CPU_LIMIT` - Default: 1000m

**Judge0 Worker:**
- `K8S_JUDGE0_WORKER_REPLICAS` - Default: 2
- `K8S_JUDGE0_WORKER_MEMORY_REQUEST` - Default: 1Gi
- `K8S_JUDGE0_WORKER_MEMORY_LIMIT` - Default: 2Gi
- `K8S_JUDGE0_WORKER_CPU_REQUEST` - Default: 1000m
- `K8S_JUDGE0_WORKER_CPU_LIMIT` - Default: 2000m

**Bots:**
- `K8S_BOTS_REPLICAS` - Default: 2
- `K8S_BOTS_MEMORY_REQUEST` - Default: 256Mi
- `K8S_BOTS_MEMORY_LIMIT` - Default: 512Mi
- `K8S_BOTS_CPU_REQUEST` - Default: 250m
- `K8S_BOTS_CPU_LIMIT` - Default: 500m

## External Access

### Colyseus (WebSocket/HTTP)
- **Type**: LoadBalancer
- **Port**: 2567
- **Internal**: `http://colyseus:2567` or `ws://colyseus:2567`
- **External**: Accessible on the VM's external IP or domain
- **CloudFront**: Configure frontend to connect to this endpoint

### MongoDB
- **Type**: NodePort (accessible externally)
- **Port**: 32017 (external), 27017 (internal)
- **Internal URI**: `mongodb://username:password@mongodb:27017/codeclashers?authSource=admin`
- **External URI**: `mongodb://username:password@<vm-ip>:32017/codeclashers?authSource=admin`
- **Authentication**: Required (configure via `MONGODB_USERNAME` and `MONGODB_PASSWORD` secrets)
- **CloudFront/Frontend**: Use external URI with credentials from secrets

Check external IPs:
```bash
k3s kubectl get svc -n codeclashers
# Look for EXTERNAL-IP or use node IP
```

## Zero-Downtime Deployments

All deployments use Kubernetes rolling updates with the following configuration:
- `maxSurge: 1` - Allow one extra pod during update
- `maxUnavailable: 0` - Never have fewer than desired replicas
- PodDisruptionBudgets ensure minimum availability
- Readiness probes prevent traffic to unhealthy pods
- Graceful shutdown hooks allow connections to drain

When you push code changes:
1. New pods are created with the updated image
2. New pods must pass readiness checks before receiving traffic
3. Traffic is gradually shifted from old to new pods
4. Old pods are gracefully terminated after 30-60 seconds

## Manual kubectl Commands

If you need to manually interact with the cluster:

```bash
# Get pods status
k3s kubectl get pods -n codeclashers

# Get services
k3s kubectl get svc -n codeclashers

# View logs
k3s kubectl logs -f deployment/colyseus -n codeclashers
k3s kubectl logs -f deployment/bots -n codeclashers

# Scale a deployment
k3s kubectl scale deployment colyseus --replicas=3 -n codeclashers

# Restart a deployment (triggers rolling update)
k3s kubectl rollout restart deployment/colyseus -n codeclashers

# Rollback a deployment
k3s kubectl rollout undo deployment/colyseus -n codeclashers

# Describe a pod (for debugging)
k3s kubectl describe pod <pod-name> -n codeclashers

# Execute a command in a pod
k3s kubectl exec -it deployment/colyseus -n codeclashers -- /bin/sh
```

## Health Checks

All services have health checks configured:
- **Liveness probes** - Restart unhealthy pods
- **Readiness probes** - Only route traffic to healthy pods

Manual health checks:
```bash
# Check Colyseus
k3s kubectl exec -n codeclashers deployment/colyseus -- nc -z localhost 2567

# Check Judge0
k3s kubectl exec -n codeclashers deployment/judge0-server -- curl -f http://localhost:2358

# Check Redis
k3s kubectl exec -n codeclashers deployment/redis -- redis-cli -a $REDIS_PASSWORD ping

# Check MongoDB
k3s kubectl exec -n codeclashers deployment/mongodb -- mongosh --eval "db.adminCommand('ping')"

# Check all pods
k3s kubectl get pods -n codeclashers
```

## Monitoring

### Resource Usage

```bash
# View resource usage
k3s kubectl top pods -n codeclashers

# View node resources
k3s kubectl top node
```

### Logs

```bash
# View all logs for a deployment
k3s kubectl logs -f deployment/colyseus -n codeclashers

# View logs for specific pod
k3s kubectl logs -f <pod-name> -n codeclashers

# View logs for previous crashed container
k3s kubectl logs --previous deployment/colyseus -n codeclashers
```

## Troubleshooting

### Pods not starting

Check pod status and events:
```bash
k3s kubectl describe pod <pod-name> -n codeclashers
k3s kubectl get events -n codeclashers --sort-by='.lastTimestamp'
```

### Image pull errors

Ensure GitHub Container Registry permissions are set correctly for the `GITHUB_TOKEN`.

### Out of memory

Oracle Cloud free tier has 24GB RAM. Monitor usage and adjust resource limits:
```bash
k3s kubectl top node
```

Scale down replicas or adjust memory limits in GitHub Secrets.

### Persistent volume issues

```bash
# Check PVC status
k3s kubectl get pvc -n codeclashers

# Describe PVC
k3s kubectl describe pvc mongodb-data -n codeclashers
```

### Judge0 privileged container issues

Judge0 workers require privileged access. Ensure k3s is installed with the correct flags:
```bash
k3s --version
```

### Judge0 troubleshooting

If Judge0 server/worker are crashing:
```bash
# Check pod logs
k3s kubectl logs -n codeclashers deployment/judge0-server --tail=50
k3s kubectl logs -n codeclashers deployment/judge0-worker --tail=50

# Check if PostgreSQL is accessible
k3s kubectl exec -n codeclashers deployment/postgres -- pg_isready

# Verify secrets are set correctly
k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data}' | jq -r 'keys[]'
```

Common issues:
- **PostgreSQL connection timeout**: Wait for postgres to be fully ready before starting Judge0
- **Privileged container issues**: Ensure k3s allows privileged containers (default on k3s)
- **Missing environment variables**: Verify JUDGE0_POSTGRES_* secrets are set in GitHub

### Rollback on deployment failure

The workflow automatically rolls back on health check failure. Manual rollback:
```bash
k3s kubectl rollout undo deployment/<service-name> -n codeclashers
k3s kubectl rollout status deployment/<service-name> -n codeclashers
```

## Security Notes

1. **All secrets are in GitHub Secrets** - Never commit actual secrets
2. Use strong passwords for all services
3. Keep Docker images updated
4. Regularly review resource limits
5. Monitor pod logs for suspicious activity
6. Judge0 workers run with privileged access (required for code execution isolation)
