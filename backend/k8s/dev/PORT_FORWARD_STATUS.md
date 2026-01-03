# Port-Forward Status

## Current Status

- **MongoDB**: ✅ Port-forward active on `localhost:27017`
- **Redis**: ⚠️ Port-forward active on `localhost:6380` (6379 is occupied by local process)
- **Colyseus**: ❌ Pod in ImagePullBackOff (separate issue)

## Frontend Configuration

Update your `.env.local` file:

```env
# MongoDB
MONGODB_URI=mongodb://admin:admin123@localhost:27017/codeclashers?authSource=admin

# Redis (using port 6380 instead of 6379)
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_PASSWORD=redis_dev_password_123
REDIS_CLUSTER_ENABLED=false
```

## Starting Port-Forwards

Run:
```bash
cd backend/k8s/dev
./start-port-forwards.sh
```

Or manually:
```bash
kubectl port-forward -n codeclashers-dev svc/mongodb-dev 27017:27017 &
kubectl port-forward -n codeclashers-dev svc/redis-cluster-dev 6380:6379 &
```
