# Quick Start Guide - Docker Desktop Kubernetes

Follow these steps to get your local development environment running with Docker Desktop Kubernetes.

## Step 1: Enable Kubernetes in Docker Desktop

1. **Open Docker Desktop**
2. **Go to Settings** (gear icon)
3. **Navigate to Kubernetes** (left sidebar)
4. **Enable Kubernetes**:
   - Check "Enable Kubernetes"
   - Choose **"kind"** as the Kubernetes backend (recommended)
   - Set **1 node** (sufficient for local dev)
5. **Click "Apply & Restart"**
   - Wait for Kubernetes to start (green indicator in bottom bar)

## Step 2: Verify Kubernetes is Running

Open a terminal and run:

```bash
kubectl cluster-info
```

You should see output like:
```
Kubernetes control plane is running at https://127.0.0.1:6443
```

If you see an error, wait a few more seconds for Docker Desktop to finish starting Kubernetes.

## Step 3: Run the Setup Script

Navigate to the dev directory and run the setup script:

```bash
cd backend/k8s/dev
./setup-dev.sh
```

This script will:
- ✅ Check if kubectl is available
- ✅ Verify Kubernetes connection
- ✅ Create the `codeclashers-dev` namespace
- ✅ Create development secrets (matching your `.env` files)
- ✅ Build Docker images locally (Colyseus and Bots)
- ✅ Deploy all services to Kubernetes
- ✅ Wait for services to be ready

**Expected output:**
```
🚀 Setting up CodeClashers for local development with Docker Desktop Kubernetes
✅ Connected to Kubernetes cluster
📝 Creating development secrets...
✅ Development secrets created successfully!
🔨 Building and deploying services...
📦 Building Docker images...
  Building Colyseus...
  Building Bots...
🚀 Deploying to Kubernetes...
✅ Setup complete!
```

## Step 4: Verify Services Are Running

Check that all pods are running:

```bash
kubectl get pods -n codeclashers-dev
```

Wait until all pods show `STATUS: Running` and `READY: 1/1`:

```
NAME                               READY   STATUS    RESTARTS   AGE
colyseus-xxxxx                     1/1     Running   0          2m
bots-xxxxx                         1/1     Running   0          2m
judge0-server-xxxxx                1/1     Running   0          2m
judge0-worker-xxxxx                1/1     Running   0          2m
mongodb-dev-xxxxx                  1/1     Running   0          2m
redis-dev-xxxxx                    1/1     Running   0          2m
minio-dev-xxxxx                    1/1     Running   0          2m
postgres-xxxxx                     1/1     Running   0          2m
minio-init-dev-xxxxx               0/1     Completed 0          2m
```

## Step 5: Access Services

All services are now accessible on `localhost` via NodePort:

| Service | URL | Credentials |
|---------|-----|-------------|
| **MongoDB** | `mongodb://localhost:27017/codeclashers` | No auth (dev) |
| **Redis** | `localhost:6379` | Password: `redis_dev_password_123` |
| **Colyseus HTTP** | `http://localhost:2567` | - |
| **Colyseus WebSocket** | `ws://localhost:2567` | - |
| **Judge0** | `http://localhost:2358` | - |
| **MinIO API** | `http://localhost:9000` | - |
| **MinIO Console** | `http://localhost:9001` | User: `minioadmin` / Pass: `minioadmin123` |
| **Grafana** | `http://localhost:3030` | User: `admin` / Pass: `admin` |
| **Prometheus** | `http://localhost:9090` | - |

## Step 6: Test the Setup

### Test MongoDB
```bash
# Using mongosh (if installed)
mongosh mongodb://localhost:27017/codeclashers

# Or test from a pod
kubectl exec -it -n codeclashers-dev deployment/mongodb-dev -- mongosh --eval "db.version()"
```

### Test Redis
```bash
kubectl exec -it -n codeclashers-dev deployment/redis-dev -- redis-cli -a redis_dev_password_123 ping
# Should return: PONG
```

### Test Colyseus
```bash
curl http://localhost:2567/
# Should return some response (might be an error, but connection works)
```

### Test Judge0
```bash
curl http://localhost:2358/
# Should return Judge0 API info
```

### Test MinIO
Open in browser: `http://localhost:9001`
- Login with: `minioadmin` / `minioadmin123`
- You should see the `codeclashers-avatars` bucket

## Step 7: Start Your Frontend

Your frontend `.env.local` is already configured! Just start the dev server:

```bash
cd client
npm run dev
```

The frontend will connect to all services on `localhost` using the ports defined in your `.env.local`.

## Troubleshooting

### Pods Not Starting

Check pod logs:
```bash
kubectl logs -n codeclashers-dev <pod-name>
```

Check pod status:
```bash
kubectl describe pod <pod-name> -n codeclashers-dev
```

### Image Pull Errors

If you see `ImagePullBackOff` for Colyseus or Bots:
```bash
# Make sure images were built
docker images | grep codeclashers

# If missing, build manually
cd backend/colyseus
docker build -t codeclashers-colyseus:dev .

cd ../bots
docker build -t codeclashers-bots:dev .
```

### Port Already in Use

If you get "port already in use" errors:
```bash
# Find what's using the port (macOS/Linux)
lsof -i :27017  # MongoDB
lsof -i :6379   # Redis
lsof -i :2567   # Colyseus

# Stop conflicting services or change NodePort in service YAML
```

### Reset Everything

To start fresh:
```bash
# Delete everything
kubectl delete namespace codeclashers-dev

# Wait for cleanup
kubectl get namespace codeclashers-dev

# Run setup again
cd backend/k8s/dev
./setup-dev.sh
```

## Useful Commands

### View All Resources
```bash
kubectl get all -n codeclashers-dev
```

### View Logs
```bash
# All Colyseus logs
kubectl logs -n codeclashers-dev -l app=colyseus --tail=100 -f

# Specific pod
kubectl logs -n codeclashers-dev <pod-name> -f
```

### Restart Services
```bash
# Restart a specific service
kubectl rollout restart deployment/colyseus -n codeclashers-dev

# Restart all
kubectl rollout restart deployment -n codeclashers-dev
```

### Port Forward (Alternative to NodePort)
```bash
# If NodePort doesn't work, use port forwarding
kubectl port-forward -n codeclashers-dev svc/mongodb-dev 27017:27017 &
kubectl port-forward -n codeclashers-dev svc/redis 6379:6379 &
kubectl port-forward -n codeclashers-dev svc/colyseus 2567:2567 &
```

## Next Steps

1. ✅ All services running
2. ✅ Frontend connecting to services
3. 🎉 Start developing!

For more details, see the full [Local Development README](/backend/k8s/dev/README.md).

