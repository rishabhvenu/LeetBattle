# How the Development System Works

## Architecture Overview

This Kubernetes dev environment runs all backend services in Docker Desktop's Kubernetes cluster. The frontend (Next.js) runs locally and connects to services via port-forwarding.

### Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Desktop Kubernetes                 │
│                    (kind backend, 1 node)                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  MongoDB    │  │   Redis     │  │  PostgreSQL │          │
│  │  (Stateful) │  │  (Stateful) │  │  (Stateful) │          │
│  │   Port 27017│  │   Port 6379 │  │  Port 5432  │          │
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
│                                                               │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         │ Port Forward        │ Port Forward       │ Port Forward
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Local Machine (Your Computer)                  │
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Next.js Frontend (Port 3000)                │    │
│  │  • Connects via localhost:27017 (MongoDB)          │    │
│  │  • Connects via localhost:6379 (Redis)             │    │
│  │  • Connects via localhost:2567 (Colyseus)         │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Services Explained

### MongoDB (Database)
- **Purpose**: Stores user accounts, sessions, match history, bot data
- **Image**: `mongo:7.0`
- **Storage**: 8Gi PersistentVolume (ReadWriteOnce)
- **Port**: 27017 (internal), 32017 (NodePort), forwarded to localhost:27017
- **Authentication**: Username `admin`, Password `admin123`
- **Connection**: `mongodb://admin:admin123@localhost:27017/codeclashers?authSource=admin`

### Redis (Cache & Pub/Sub)
- **Purpose**: Matchmaking queue, caching, pub/sub events, bot coordination
- **Image**: `redis:7-alpine`
- **Storage**: 2Gi PersistentVolume (ReadWriteOnce)
- **Port**: 6379 (internal), 30637 (NodePort), forwarded to localhost:6379
- **Authentication**: Password `redis_dev_password_123`
- **Mode**: Single instance (cluster disabled for dev)

### PostgreSQL (Judge0 Database)
- **Purpose**: Stores Judge0 execution history and submissions
- **Image**: `postgres:15-alpine`
- **Storage**: 2Gi PersistentVolume (ReadWriteOnce)
- **Port**: 5432 (internal only, not exposed)
- **Database**: `judge0`
- **User**: `judge0` / Password: `judge0_secure_pass_456`

### Colyseus (Game Server)
- **Purpose**: Real-time game server for matches, private rooms, guest mode
- **Image**: `codeclashers-colyseus:dev` (built locally)
- **Port**: 2567 (internal), 30267 (NodePort), forwarded to localhost:2567
- **Dependencies**: MongoDB, Redis, Judge0
- **Features**: WebSocket server, matchmaking, room management

### Bots Service
- **Purpose**: AI bot management and lifecycle
- **Image**: `codeclashers-bots:dev` (built locally)
- **Port**: 3000 (internal only)
- **Dependencies**: MongoDB, Redis, Colyseus
- **Function**: Manages bot players, fills matchmaking queue

### Judge0 (Code Execution)
- **Purpose**: Code execution engine supporting 89+ languages
- **Image**: `judge0/judge0:latest`
- **Components**:
  - **Server** (Port 2358): HTTP API for code submissions
  - **Worker**: Processes code execution jobs from Redis queue
- **Port**: 2358 (internal), 32358 (NodePort), forwarded to localhost:2358
- **Dependencies**: Redis (queue), PostgreSQL (history)

### MinIO (S3-Compatible Storage)
- **Purpose**: Local S3-compatible storage for avatar uploads (dev only)
- **Image**: `minio/minio:latest`
- **Storage**: 2Gi PersistentVolume (ReadWriteOnce)
- **Ports**: 
  - API: 9000 (internal), 30900 (NodePort), forwarded to localhost:9000
  - Console: 9001 (internal), 30901 (NodePort), forwarded to localhost:9001
- **Credentials**: `minioadmin` / `minioadmin123`

## Data Flow

### User Registration/Login
1. User submits form → Next.js Server Action
2. Server Action connects to MongoDB (via port-forward)
3. Creates user account in MongoDB
4. Creates session in MongoDB `sessions` collection
5. Sets session cookie

### Matchmaking Flow
1. User clicks "Find Match" → Next.js Server Action
2. Server Action calls Colyseus `/match/queue` endpoint
3. Colyseus adds user to Redis queue
4. Colyseus matchmaking cycle runs every few seconds
5. When match found, creates MatchRoom
6. Updates MongoDB with match data
7. Returns match info to frontend

### Code Execution Flow
1. User submits code → Colyseus MatchRoom
2. Colyseus sends to Judge0 API (`POST /submissions`)
3. Judge0 Server queues job in Redis
4. Judge0 Worker picks up job and executes code
5. Results stored in PostgreSQL
6. Results returned to Colyseus
7. Colyseus updates match state
8. Frontend receives update via WebSocket

## Network Architecture

### Internal Kubernetes Networking
- Services communicate using DNS names:
  - `mongodb-dev.codeclashers-dev.svc.cluster.local:27017`
  - `redis.codeclashers-dev.svc.cluster.local:6379`
  - `colyseus.codeclashers-dev.svc.cluster.local:2567`

### External Access (Local Machine)
- Kubernetes services exposed via **NodePort** (30000-32767 range)
- Port-forwarding maps standard ports (27017, 6379, etc.) to NodePorts
- Frontend connects to `localhost:27017` → port-forward → NodePort → Service → Pod

### Port Mapping

| Service | Internal Port | NodePort | Forwarded Port | Purpose |
|---------|--------------|----------|----------------|---------|
| MongoDB | 27017 | 32017 | 27017 | Database |
| Redis | 6379 | 30637 | 6379 | Cache/Queue |
| Colyseus | 2567 | 30267 | 2567 | Game Server |
| Judge0 | 2358 | 32358 | 2358 | Code Execution |
| MinIO API | 9000 | 30900 | 9000 | S3 API |
| MinIO Console | 9001 | 30901 | 9001 | Web UI |
| PostgreSQL | 5432 | - | - | Internal only |
| Bots | 3000 | - | - | Internal only |

## Persistent Storage

### ReadWriteOnce Volumes
These services use PersistentVolumes that can only be mounted by one pod at a time:
- **MongoDB**: 8Gi - Database files
- **Redis**: 2Gi - AOF (Append Only File) persistence
- **PostgreSQL**: 2Gi - Database files
- **MinIO**: 2Gi - Object storage

**Important**: When restarting these services, you must:
1. Scale down to 0 (terminate pod)
2. Wait for termination
3. Scale back up to 1

This prevents volume lock conflicts.

## Environment Variables

### Frontend (.env.local)
- `MONGODB_URI`: Connection string with credentials
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis connection
- `NEXT_PUBLIC_COLYSEUS_HTTP_URL`: Colyseus HTTP endpoint
- `NEXT_PUBLIC_COLYSEUS_WS_URL`: Colyseus WebSocket endpoint

### Backend (Kubernetes Secrets)
All backend services read from Kubernetes secrets:
- `app-secrets-dev`: Contains all passwords, API keys, connection strings
- `app-config`: Contains service hostnames and configuration

## Security Model

### Authentication
- **Admin Access**: Email must match `rishiryan4@gmail.com` (hardcoded in backend)
- **Session-Based**: Uses MongoDB sessions with cookies
- **Internal Services**: Use `INTERNAL_SERVICE_SECRET` for service-to-service auth

### Secrets Management
- Secrets stored in Kubernetes `Secret` objects
- Not committed to git
- Created via `create-dev-secrets.sh` script
- Matches values in `.env` and `.env.local` files

## Startup Sequence

1. **Kubernetes cluster** starts (Docker Desktop)
2. **Secrets** created (`create-dev-secrets.sh`)
3. **MongoDB** starts (waits for pod ready)
4. **Redis** starts (waits for pod ready)
5. **PostgreSQL** starts (waits for pod ready)
6. **MinIO** starts + init job creates bucket
7. **Judge0** starts (waits for Redis + PostgreSQL)
8. **Colyseus** starts (waits for MongoDB + Redis)
9. **Bots** starts (waits for Colyseus + MongoDB)
10. **Port-forwarding** starts (maps ports to localhost)

## Dependencies Graph

```
MongoDB ──┐
          ├──> Colyseus ──> Frontend
Redis ────┘

PostgreSQL ──> Judge0 Server ──> Colyseus
Redis ──────┘         │
                      │
                  Judge0 Worker

Colyseus ──> Bots Service
MongoDB ──┘
Redis ────┘
```

## Common Operations

### Adding a New Service
1. Create deployment YAML in `deployments/`
2. Create service YAML in `services/`
3. Add to `kustomization.yaml`
4. Update secrets if needed
5. Deploy: `kubectl apply -k .`

### Updating Environment Variables
1. Edit `create-dev-secrets.sh`
2. Run: `./create-dev-secrets.sh`
3. Restart affected deployments

### Scaling Services
```bash
# Scale Colyseus to 3 replicas
kubectl scale deployment/colyseus -n codeclashers-dev --replicas=3
```

Note: Services with ReadWriteOnce volumes cannot scale (MongoDB, Redis, PostgreSQL, MinIO).

## Troubleshooting Flow

1. **Check pod status**: `kubectl get pods -n codeclashers-dev`
2. **Check logs**: `./logs.sh <service-name>`
3. **Check port-forwards**: `./check-ports.sh`
4. **Restart if needed**: `./restart-safe.sh`
5. **Check events**: `kubectl get events -n codeclashers-dev --sort-by='.lastTimestamp'`






