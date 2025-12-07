# MongoDB Replica Set Configuration

This directory contains the Kubernetes manifests for a production-ready MongoDB Replica Set.

## Architecture

- **Dynamic MongoDB Replicas**: StatefulSet with configurable replica count (default: 3)
- **Automatic Discovery**: Init job discovers available pods dynamically
- **No Hardcoded Values**: All replica counts and pod indices are dynamically determined
- **Headless Service**: Enables DNS-based discovery for replica set members
- **LoadBalancer Service**: External access point on port 27017
- **Automatic Initialization**: Init job bootstraps the replica set
- **High Availability**: PodDisruptionBudget ensures minimum 2 pods available
- **Persistent Storage**: 8Gi per replica using PVCs

## Prerequisites

1. **Create Secrets**:
   ```bash
   # Create MongoDB credentials secret
   kubectl create secret generic mongodb-secrets \
     --namespace=codeclashers \
     --from-literal=MONGO_INITDB_ROOT_USERNAME="admin" \
     --from-literal=MONGO_INITDB_ROOT_PASSWORD="your-secure-password"
   
   # Create keyfile for replica set authentication
   openssl rand -base64 756 > mongodb-keyfile
   kubectl create secret generic mongodb-keyfile \
     --namespace=codeclashers \
     --from-file=keyfile=./mongodb-keyfile
   ```

2. **Deploy Resources**:
   ```bash
   # Apply all MongoDB resources
   kubectl apply -f mongodb/
   
   # Or via kustomization
   kubectl apply -k ../kustomization.yaml
   ```

## How It Works

### 1. StatefulSet Startup
- Pods start sequentially: mongodb-0, then mongodb-1, mongodb-2, etc.
- Replica count is configurable via `K8S_MONGODB_REPLICAS` environment variable or kustomize
- Minimum 3 replicas recommended for proper quorum (must be odd number for voting)
- Each pod gets a stable DNS name: `mongodb-{N}.mongodb-headless.codeclashers.svc.cluster.local`
- Each pod mounts its own 8Gi persistent volume
- Pods wait for the keyfile secret before starting MongoDB

### 2. Replica Set Initialization
The init job (`mongodb-replica-set-init`) automatically:
- **Dynamically discovers** all available MongoDB pods via connection attempts
- Waits for all discovered pods to accept MongoDB connections
- Checks if replica set is already initialized (idempotent)
- Runs `rs.initiate()` on the first available pod (mongodb-0) with all discovered members
- Sets priority so lower-index pods become primary first
- Automatically adds any missing members if replica set was partially initialized
- Verifies initialization and prints connection string with all discovered members

### 3. Readiness Probes
Each pod's readiness probe:
- Checks if MongoDB is accepting connections
- Verifies replica set is initialized (for pods 1 and 2)
- Confirms the pod is a member of the replica set
- Blocks traffic until fully joined

### 4. Automatic Failover
- If primary (mongodb-0) fails, a secondary is automatically elected
- Pod restarts automatically rejoin the replica set
- Data persists across pod restarts via PVCs

### 5. Rolling Updates
- PodDisruptionBudget ensures max 1 pod down at a time
- Updates happen one pod at a time (zero downtime)
- Each updated pod automatically rejoins the replica set

## Configuration

### Replica Count
The replica count is dynamically configurable:

**Option 1: Using kustomize (recommended)**
```bash
cd backend/k8s/mongodb
kustomize edit replicas mongodb 5  # Scale to 5 replicas
# Update REPLICA_COUNT in configmap.yaml to match
kubectl apply -k .
```

**Option 2: Direct kubectl scale**
```bash
kubectl scale statefulset mongodb --replicas=5 -n codeclashers
# Update REPLICA_COUNT in ConfigMap
kubectl patch configmap mongodb-config -n codeclashers --type merge -p '{"data":{"REPLICA_COUNT":"5"}}'
# Run init job to add new members
kubectl delete job mongodb-replica-set-init -n codeclashers
kubectl apply -f mongodb/init-job.yaml
```

- Default: 3 replicas (minimum for quorum)
- ConfigMap: `REPLICA_COUNT` in `mongodb-config` (used by init job for discovery)

**Note**: MongoDB replica sets work best with odd numbers (3, 5, 7) for proper voting and primary election.

### Scaling
To scale the replica set:
1. Update `K8S_MONGODB_REPLICAS` in your deployment pipeline
2. Update `REPLICA_COUNT` in ConfigMap to match
3. Apply the updated StatefulSet
4. Run the init job again (it will automatically add new members)

## Connection Strings

The init job outputs connection strings with all discovered members dynamically.

### Internal (Kubernetes) - Example with 3 replicas
```
mongodb://admin:password@mongodb-0.mongodb-headless.codeclashers.svc.cluster.local:27017,mongodb-1.mongodb-headless.codeclashers.svc.cluster.local:27017,mongodb-2.mongodb-headless.codeclashers.svc.cluster.local:27017/codeclashers?replicaSet=rs0&authSource=admin
```

### External (via LoadBalancer)
```
mongodb://admin:password@<loadbalancer-ip>:27017/codeclashers?replicaSet=rs0&authSource=admin
```

### Simplified (single endpoint)
```
mongodb://admin:password@mongodb.codeclashers.svc.cluster.local:27017/codeclashers?replicaSet=rs0&authSource=admin
```

## Verification

```bash
# Check pods
kubectl get pods -n codeclashers -l app=mongodb

# Check replica set status
kubectl exec -it mongodb-0 -n codeclashers -- mongosh --quiet --eval "rs.status()"

# Check primary
kubectl exec -it mongodb-0 -n codeclashers -- mongosh --quiet --eval "rs.isMaster().primary"

# View logs
kubectl logs -f mongodb-0 -n codeclashers
kubectl logs -f job/mongodb-replica-set-init -n codeclashers
```

## Troubleshooting

### Replica Set Not Initializing
1. Check init job logs: `kubectl logs job/mongodb-replica-set-init -n codeclashers`
2. Verify all pods are running: `kubectl get pods -n codeclashers -l app=mongodb`
3. Check if keyfile secret exists: `kubectl get secret mongodb-keyfile -n codeclashers`

### Pods Not Joining Replica Set
1. Check pod logs for MongoDB errors
2. Verify network connectivity between pods
3. Ensure keyfile is identical across all pods (same secret)
4. Check readiness probe status: `kubectl describe pod mongodb-0 -n codeclashers`

### Primary Not Elected
1. Manually check replica set status: `kubectl exec mongodb-0 -n codeclashers -- mongosh --eval "rs.status()"`
2. Force reconfiguration if needed (use with caution)

## Maintenance

### Scale Up/Down
✅ **Dynamic Scaling**: The replica set supports dynamic scaling:
- **Scale Up**: Add replicas via StatefulSet, then run init job to add new members
- **Scale Down**: Remove members from replica set first (`rs.remove()`), then scale StatefulSet
- The init job automatically discovers and adds new members

**Best Practice**: Always maintain an odd number of replicas (3, 5, 7) for proper quorum.

### Data Persistence

**IMPORTANT**: MongoDB data is stored in PersistentVolumeClaims (PVCs) created by the StatefulSet. These PVCs use the `local-path` storage class, which stores data on the host filesystem at `/var/lib/rancher/k3s/storage/`.

**Critical Requirements**:
1. **Persistent Storage**: Ensure `/var/lib/rancher/k3s/storage/` is on a persistent filesystem (NOT tmpfs/ephemeral)
2. **PVC Retention**: PVCs are automatically retained when StatefulSet is deleted (by design)
3. **Backup**: Always backup MongoDB data before major operations or VM restarts

**Verifying Storage Persistence**:
```bash
# Check if storage location is persistent (should NOT be tmpfs)
mount | grep k3s-storage

# Check PVC status
kubectl get pvc -n codeclashers | grep mongodb

# Verify data exists
kubectl exec mongodb-0 -n codeclashers -- ls -la /data/db/
```

**If Data is Lost After Restart**:
1. Check if `/var/lib/rancher/k3s/storage/` is on ephemeral storage
2. Verify PVCs still exist: `kubectl get pvc -n codeclashers`
3. Check if k3s was reset/reinstalled (this wipes local-path volumes)
4. Consider using external storage (NFS, cloud block storage) for production

See `docs/debugging-guide.md` section "MongoDB Data Persistence Issues" for detailed troubleshooting.

### Backup
Each pod has a persistent volume. Use MongoDB's native backup tools:
```bash
kubectl exec mongodb-0 -n codeclashers -- mongodump --out /data/backup
```

**Regular Backup Schedule**:
```bash
# Create daily backup
kubectl exec mongodb-0 -n codeclashers -- mongodump --out /data/backup/$(date +%Y%m%d)

# Copy backup to external location (recommended)
kubectl cp codeclashers/mongodb-0:/data/backup ./mongodb-backup
```

### Updates
Rolling updates are safe - pods update one at a time with zero downtime.

