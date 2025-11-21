# How to Restart Services

## Quick Restart (Recommended)

### Restart All Services Safely

```bash
cd backend/k8s/dev
./restart-safe.sh
```

**What this does:**
- Handles services with persistent volumes correctly (MongoDB, Redis, PostgreSQL, MinIO)
- Restarts other services normally (Colyseus, Bots, Judge0, Prometheus, Grafana, etc.)
- Waits for all services to be ready
- Shows final status

**Time:** ~2-5 minutes depending on service startup times

## Understanding Restart Methods

### Why Two Restart Scripts?

Some services use **ReadWriteOnce** PersistentVolumes that can only be mounted by one pod at a time:

- MongoDB (`mongodb-dev`)
- Redis (`redis-dev`) 
- PostgreSQL (`postgres`)
- MinIO (`minio-dev`)

**Note:** Monitoring services (Prometheus, Grafana, node-exporter, kube-state-metrics) don't use persistent volumes in dev, so they restart normally without special handling.

When using `kubectl rollout restart`, Kubernetes tries to create a new pod before terminating the old one, causing volume lock conflicts.

### Safe Restart Script

The `restart-safe.sh` script handles this by:

1. **Scaling down** services with persistent volumes to 0 replicas
2. **Waiting** for all pods to terminate completely
3. **Scaling back up** to 1 replica
4. **Restarting** other services normally with `rollout restart`

### Quick Restart Script

The `restart.sh` script uses `rollout restart` for everything. This is faster but may cause volume conflicts.

## Restart Individual Services

### Services with Persistent Volumes

**Scale Down/Up Method (Required):**

```bash
# MongoDB
kubectl scale deployment/mongodb-dev -n codeclashers-dev --replicas=0
kubectl wait --for=delete pod -l app=mongodb-dev -n codeclashers-dev --timeout=60s
kubectl scale deployment/mongodb-dev -n codeclashers-dev --replicas=1

# Redis
kubectl scale deployment/redis-dev -n codeclashers-dev --replicas=0
kubectl wait --for=delete pod -l app=redis-dev -n codeclashers-dev --timeout=60s
kubectl scale deployment/redis-dev -n codeclashers-dev --replicas=1

# PostgreSQL
kubectl scale deployment/postgres -n codeclashers-dev --replicas=0
kubectl wait --for=delete pod -l app=postgres -n codeclashers-dev --timeout=60s
kubectl scale deployment/postgres -n codeclashers-dev --replicas=1

# MinIO
kubectl scale deployment/minio-dev -n codeclashers-dev --replicas=0
kubectl wait --for=delete pod -l app=minio-dev -n codeclashers-dev --timeout=60s
kubectl scale deployment/minio-dev -n codeclashers-dev --replicas=1
```

### Services Without Persistent Volumes

**Rollout Restart Method (Faster):**

```bash
# Colyseus
kubectl rollout restart deployment/colyseus -n codeclashers-dev

# Bots
kubectl rollout restart deployment/bots -n codeclashers-dev

# Judge0 Server
kubectl rollout restart deployment/judge0-server -n codeclashers-dev

# Judge0 Worker
kubectl rollout restart deployment/judge0-worker -n codeclashers-dev

# Monitoring Services
kubectl rollout restart deployment/prometheus -n codeclashers-dev
kubectl rollout restart deployment/grafana -n codeclashers-dev
kubectl rollout restart daemonset/node-exporter -n codeclashers-dev
kubectl rollout restart deployment/kube-state-metrics -n codeclashers-dev
```

## Restart All (Quick Method)

```bash
# Restart all deployments at once (may cause volume conflicts)
kubectl rollout restart deployment --all -n codeclashers-dev
```

**Warning:** May cause MongoDB/Redis/Postgres/MinIO to crash if pods overlap.

## Monitoring Restart Progress

### Watch All Pods

```bash
# Real-time pod status
kubectl get pods -n codeclashers-dev -w
```

Press Ctrl+C to stop watching.

### Check Specific Deployment

```bash
# Watch Colyseus restart
kubectl rollout status deployment/colyseus -n codeclashers-dev -w
```

### Check All Deployments

```bash
# Get deployment status
kubectl get deployments -n codeclashers-dev

# Check rollout status
for d in $(kubectl get deployments -n codeclashers-dev -o jsonpath='{.items[*].metadata.name}'); do
  echo "Checking $d..."
  kubectl rollout status deployment/$d -n codeclashers-dev --timeout=30s || echo "  ⚠️  Still restarting"
done
```

## Complete Reset (Nuclear Option)

If you need to completely wipe and restart everything:

```bash
cd backend/k8s/dev

# Delete entire namespace (WARNING: Deletes all data!)
kubectl delete namespace codeclashers-dev

# Wait for cleanup
sleep 10

# Recreate everything
./setup-dev.sh
```

**⚠️ WARNING:** This deletes all persistent data:
- All MongoDB data (users, matches, sessions)
- All Redis data (queues, cache)
- All PostgreSQL data (Judge0 history)
- All MinIO data (avatars)

## Troubleshooting Restart Issues

### MongoDB Pod in CrashLoopBackOff

**Symptom:** Pod keeps crashing with "DBPathInUse" error

**Cause:** Two pods trying to access same ReadWriteOnce volume

**Fix:**
```bash
# Delete the crashing pod
kubectl delete pod -n codeclashers-dev -l app=mongodb-dev --field-selector=status.phase!=Running

# Or scale down then up
kubectl scale deployment/mongodb-dev -n codeclashers-dev --replicas=0
sleep 5
kubectl scale deployment/mongodb-dev -n codeclashers-dev --replicas=1
```

### Pod Stuck in "Terminating"

**Fix:**
```bash
# Force delete the pod
kubectl delete pod <pod-name> -n codeclashers-dev --force --grace-period=0
```

### Service Not Ready After Restart

**Check:**
```bash
# Describe pod for events
kubectl describe pod <pod-name> -n codeclashers-dev

# Check logs
kubectl logs -n codeclashers-dev <pod-name>

# Check events in namespace
kubectl get events -n codeclashers-dev --sort-by='.lastTimestamp' | tail -20
```

### Clear All CrashLoopBackOff Pods

```bash
# Delete all pods in error state
kubectl get pods -n codeclashers-dev -o jsonpath='{.items[?(@.status.containerStatuses[0].state.waiting.reason=="CrashLoopBackOff")].metadata.name}' | xargs -r kubectl delete pod -n codeclashers-dev
```

## Restart After Code Changes

### After Backend Code Changes

**Quick Method (Recommended):**
```bash
cd backend/k8s/dev
./rebuild.sh
```

This single command will:
- Rebuild Docker images for Colyseus and Bots
- Restart services to use new images
- Wait for rollouts to complete

**Manual Method:**
```bash
# 1. Rebuild Docker images
cd backend/colyseus
docker build -t codeclashers-colyseus:dev .

cd ../bots
docker build -t codeclashers-bots:dev .

# 2. Restart services
cd ../../k8s/dev
./restart-safe.sh
```

### After Kubernetes Manifest Changes

```bash
cd backend/k8s/dev

# Apply changes
kubectl apply -k .

# Restart affected services
./restart-safe.sh
```

### After Environment Variable Changes

```bash
cd backend/k8s/dev

# Update secrets
./create-dev-secrets.sh

# Restart services to pick up new env vars
./restart-safe.sh
```

## Restart Checklist

Before restarting, ensure:

- [ ] Port-forwarding is active (if needed)
- [ ] No active critical operations running
- [ ] You have backup of important data (if needed)
- [ ] Kubernetes cluster is healthy: `kubectl get nodes`

After restarting, verify:

- [ ] All pods are Running: `kubectl get pods -n codeclashers-dev`
- [ ] Services are accessible: `./check-ports.sh`
- [ ] Application works: Test in browser
- [ ] Logs look healthy: `./logs.sh colyseus --tail=20`

