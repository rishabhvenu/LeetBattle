# Bot Service

The Bot Service manages AI-powered opponents for LeetBattle, providing instant matches for players when human opponents aren't available.

## Overview

The Bot Service is a standalone Node.js application that:
- Maintains a pool of AI bot identities with realistic statistics
- Automatically queues bots for matchmaking when human players are waiting
- Manages bot lifecycle through deployment/undeployment commands
- Integrates with the main Colyseus game server for match participation
- Uses configurable statistical distributions for realistic bot completion times

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Admin Panel   │    │   Bot Service   │    │ Colyseus Server │
│                 │    │                 │    │                 │
│ Bot Management  │───▶│ Bot Lifecycle   │───▶│ Match Rooms     │
│ Deploy/Undeploy │    │ Queue Integration│    │ Bot Clients     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Next.js API   │    │      Redis      │    │     MongoDB     │
│                 │    │                 │    │                 │
│ Bot Commands    │───▶│ Pub/Sub Events  │    │ Bot Identities  │
│ State Updates   │    │ Bot State Sets  │    │ Bot Statistics  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Bot Lifecycle

### 1. Bot Identity Management
- Bots are stored in MongoDB `bots` collection
- Each bot has unique ID, name, avatar, gender, and statistics
- Bot statistics include rating, wins, losses, draws, total matches
- Bots can be deployed/undeployed dynamically
- **NEW**: When created via `/admin/bots/generate`, bots are automatically added to the rotation queue and deployed if below minimum threshold

### 2. Deployment System
- Admin panel sends deployment commands via Redis pub/sub
- Bot service listens to `bots:commands` channel
- Commands include: `deploy` (start all bots), `stop` (stop specific/all bots)
- Bot service maintains `bots:deployed` Redis set for active bots
- Multiple bot pods participate in leader election via Redis (`bots:leader` key). Only the leader processes commands and rotates bots; failover happens automatically when the leader stops renewing its lease (`BOT_LEADER_TTL_MS`).

### 3. Queue Integration
- Deployed bots automatically join the matchmaking queue
- Bots use their current ELO rating for fair matchmaking
- Bot service continuously cycles through deployed bots
- Bots wait in queue until matched with human players
- Before every join attempt the service clears stale state by calling the Colyseus `/queue/clear` endpoint with the `X-Bot-Secret` header and purging related Redis keys (`queue:reservation:*`, `queue:joinedAt:*`, `bots:state:*`, `bot:current_match:*`, `bots:active`). This eliminates the “seat reservation expired” disconnect loop observed in pod logs.

### 4. Match Participation
- When matched, bots connect to Colyseus MatchRoom as clients
- Bots participate in matches with configurable completion timing
- Bot completion times use statistical distributions (lognormal/gamma)
- Bot statistics are updated after match completion

## Configuration

### Environment Variables

```env
# Redis Connection
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=redis_dev_password_123

# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/codeclashers

# Colyseus Server
COLYSEUS_URL=ws://localhost:2567

# Bot Configuration
BOT_COUNT=30
BOT_SERVICE_SECRET=dev_bot_secret
```

### Bot Timing Configuration

The Bot Service supports configurable timing distributions for realistic bot behavior:

#### Lognormal Distribution (Default)
```env
BOT_TIME_DIST=lognormal
BOT_TIME_PARAMS_EASY={"muMinutes":30,"sigma":0.35}
BOT_TIME_PARAMS_MEDIUM={"muMinutes":35,"sigma":0.35}
BOT_TIME_PARAMS_HARD={"muMinutes":40,"sigma":0.35}
```

- `muMinutes`: Mean completion time in minutes
- `sigma`: Standard deviation (higher = more variance)
- Generates realistic completion times with natural variation

#### Gamma Distribution (Alternative)
```env
BOT_TIME_DIST=gamma
BOT_TIME_PARAMS_EASY={"shapeK":2.0,"scaleMinutes":15}
BOT_TIME_PARAMS_MEDIUM={"shapeK":2.5,"scaleMinutes":14}
BOT_TIME_PARAMS_HARD={"shapeK":3.0,"scaleMinutes":13}
```

- `shapeK`: Shape parameter (higher = more consistent)
- `scaleMinutes`: Scale parameter in minutes
- Useful for different timing patterns

## Redis Data Structures

### Sets
- `bots:deployed` - Set of currently deployed bot IDs
- `bots:active` - Set of bots currently in active matches

### Pub/Sub Channels
- `bots:commands` - Deployment commands from admin panel
  - `{"type":"deploy"}` - Deploy all available bots
  - `{"type":"stop","botIds":["bot:001","bot:002"]}` - Stop specific bots
  - `{"type":"stop"}` - Stop all bots
  - `{"type":"checkDeployment","reason":"new_bots_created"}` - Trigger deployment check (auto-sent when bots are created)

### Keys
- `queue:reservation:{botId}` - Bot match reservations
- `match:{matchId}:ratings` - Match rating data for bots

## Bot Data Model

```javascript
{
  _id: ObjectId,
  userId: "bot:001",           // Unique bot identifier
  fullName: "Alex Chen",       // Display name
  username: "alexchen",        // Username
  avatar: "/placeholder_avatar.png", // Avatar URL
  gender: "male",              // male | female | nonbinary
  stats: {
    rating: 1200,              // Current ELO rating
    wins: 15,                  // Total wins
    losses: 12,                // Total losses
    draws: 3,                  // Total draws
    totalMatches: 30           // Total matches played
  },
  deployed: true,              // Deployment status
  createdAt: Date,
  updatedAt: Date
}
```

## API Integration

### Colyseus Integration
- Bot service connects to Colyseus as WebSocket clients
- Bots join matches using the same reservation system as human players
- Bot clients handle match events (problem data, submissions, results)
- Bots automatically submit solutions based on timing distributions

### Admin Panel Integration
- Admin panel sends commands via Redis pub/sub
- Bot service responds to deployment/undeployment commands
- Real-time bot status updates via Redis sets
- Bot statistics displayed in admin dashboard

### Authentication
- Bot service uses `X-Bot-Secret` header for authenticated requests
- Secret configured via `BOT_SERVICE_SECRET` environment variable
- Authentication bypasses rate limiting for bot operations
- Secure service-to-service communication with Colyseus server

## Development

### Running Locally (Kubernetes/k3s)

The bot service runs in a Kubernetes cluster using k3s. 

**View bot service pods:**
```bash
kubectl get pods -n codeclashers-dev | grep bots
```

**View bot service logs:**
```bash
kubectl logs -n codeclashers-dev -l app=bots -f
```

**Restart bot service:**
```bash
kubectl rollout restart deployment -n codeclashers-dev bots
```

**Wipe Redis and restart:**
```bash
cd backend/k8s/dev
./wipe-redis.sh -y
kubectl rollout restart deployment -n codeclashers-dev bots colyseus
```

**Access health endpoint:**
```bash
# Port forward first
kubectl port-forward -n codeclashers-dev svc/bots-service 3000:3000

# Then check health
curl http://localhost:3000/health
curl http://localhost:3000/metrics
```

### Running Tests
```bash
cd backend/bots
npm test
```

### Local Development (Standalone)
For local development without Kubernetes:
```bash
cd backend/bots
npm install
npm start
```

### Debugging
- Bot service logs all major lifecycle events (view with `kubectl logs`)
- Health endpoint provides deployment stats and circuit breaker status
- Redis pub/sub commands are logged for debugging
- Bot match participation is tracked in Colyseus logs
- MongoDB bot statistics can be queried directly

## Production Considerations

### Scaling
- Bot service can be scaled horizontally
- Each instance maintains its own bot pool
- Redis coordination ensures no duplicate bot deployment
- Leader lease timeout (`BOT_LEADER_TTL_MS`) defaults to 15 seconds and can be tuned per environment
- MongoDB handles concurrent bot statistics updates

### Performance
- Bot service uses connection pooling for MongoDB and Redis
- Bot lifecycle management is optimized for low latency
- Statistical timing calculations are cached per match
- Bot queue integration minimizes unnecessary API calls

### Monitoring
- Bot deployment status available via `/health` HTTP endpoint (port 3000)
- Prometheus metrics available at `/metrics` endpoint
- Circuit breaker status included in health checks
- Bot match participation tracked in MongoDB
- Admin panel provides real-time bot management

**Health Endpoint Response:**
```json
{
  "status": "healthy",
  "leadership": { "isLeader": true, "instanceId": "..." },
  "deployment": { "currentDeployed": 5, "currentActive": 2 },
  "circuitBreakers": { "queueStats": { "state": "CLOSED" } }
}
```

## Troubleshooting

### Common Issues

**Bots not joining queue:**
- Check Redis connection and pub/sub channels
- Verify bot deployment status in Redis `bots:deployed` set
- Check bot service logs for connection errors

**Bots not completing matches:**
- Verify timing distribution configuration
- Check Colyseus server connectivity
- Review bot match participation logs

**Bot statistics not updating:**
- Check MongoDB connection
- Verify bot ID format and collection structure
- Review match completion event handling

### Debug Commands

**Kubernetes (k3s):**
```bash
# Check deployed bots in Redis
kubectl exec -n codeclashers-dev svc/redis-dev -- redis-cli -a $REDIS_PASSWORD SMEMBERS bots:deployed

# Check active bots
kubectl exec -n codeclashers-dev svc/redis-dev -- redis-cli -a $REDIS_PASSWORD SMEMBERS bots:active

# Monitor bot commands
kubectl exec -n codeclashers-dev svc/redis-dev -- redis-cli -a $REDIS_PASSWORD MONITOR | grep bots:commands

# Check bot service health
kubectl port-forward -n codeclashers-dev svc/bots-service 3000:3000 &
curl http://localhost:3000/health

# Check bot statistics in MongoDB
kubectl exec -n codeclashers-dev svc/mongodb-dev -- mongosh codeclashers --eval "db.bots.find().pretty()"
```

**Direct Access (if port-forwarded):**
```bash
# Check deployed bots
redis-cli SMEMBERS bots:deployed

# Check active bots
redis-cli SMEMBERS bots:active

# Monitor bot commands
redis-cli MONITOR | grep bots:commands

# Check bot statistics
mongosh --eval "db.bots.find().pretty()"
```

## Future Enhancements

- **Adaptive Bot Difficulty**: Bots that learn from player patterns
- **Custom Bot Personalities**: Different coding styles and strategies
- **Bot Tournaments**: Bot vs bot competitions
- **Advanced Timing Models**: Machine learning-based completion times
- **Bot Analytics**: Detailed performance metrics and insights
