# LeetBattle Backend

Backend infrastructure for LeetBattle competitive coding platform.

## Architecture Overview

The backend consists of multiple microservices orchestrated via Docker Compose:

### Core Services

- **Colyseus** (Port 2567) - Real-time game server for matches, private rooms, and guest mode
- **Bot Service** (Port 3000) - AI bot management and lifecycle
- **MongoDB** (Port 27017) - User accounts, sessions, match history, bot data, guest sessions
- **Redis** (Port 6379) - Matchmaking queue, caching, pub/sub events, bot coordination, guest data storage
- **Judge0** (Port 2358) - Code execution in 89+ languages
- **MinIO** (Ports 9000-9001) - S3-compatible object storage for avatars

## Getting Started

### Development Setup

```bash
# 1. Create .env from template
cp .env.example .env

# 2. Edit .env with your values (dev defaults work for local)
nano .env

# 3. Start all services
docker-compose up -d

# 4. Verify services
docker-compose ps

# 5. View logs
docker-compose logs -f
```

### Production Deployment (AWS)

**Production Stack:**
- **EC2 (Private Subnet)** - Colyseus + Judge0 + Redis + Bot Service
- **MongoDB Atlas** - Managed MongoDB (not local container)
- **AWS S3** - Avatar storage (not MinIO)

See main README.md for complete production deployment guide with:
- VPC and subnet configuration
- Security group rules
- ALB setup for private EC2
- MongoDB Atlas connection
- S3 bucket configuration

### 3. Verify Services Are Running

```bash
docker-compose ps
```

All services should show status "Up" or "healthy".

### 4. Access Services

| Service | URL/Connection | Credentials |
|---------|---------------|-------------|
| Colyseus Server | ws://localhost:2567 | - |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin123 |
| MongoDB | mongodb://localhost:27017/codeclashers | No auth (dev) |
| Redis | localhost:6379 | Password: redis_dev_password_123 |
| Judge0 API | http://localhost:2358 | - |

## Bot Service

The Bot Service manages AI-powered opponents for instant matches:

### Architecture
- **Standalone Service**: Independent Node.js service with its own lifecycle
- **Redis Coordination**: Uses Redis for bot deployment commands and state tracking
- **Colyseus Integration**: Connects to Colyseus server as bot clients
- **MongoDB Storage**: Bot identities and statistics stored in `bots` collection

### Bot Lifecycle
1. **Deployment**: Admin panel deploys bots via Redis pub/sub
2. **Queue Integration**: Bots automatically join matchmaking queue
3. **Match Participation**: Bots participate in matches with configurable timing
4. **Statistics Tracking**: Bot performance tracked in MongoDB

### Configuration
```env
# Bot Service Configuration
BOTS_ENABLED=true
BOT_COUNT=30
BOT_SERVICE_SECRET=dev_bot_secret
BOT_FILL_DELAY_MS=15000
BOT_TIME_DIST=lognormal
BOT_TIME_PARAMS_EASY={"muMinutes":30,"sigma":0.35}
BOT_TIME_PARAMS_MEDIUM={"muMinutes":35,"sigma":0.35}
BOT_TIME_PARAMS_HARD={"muMinutes":40,"sigma":0.35}
```

### Redis Channels
- `bots:deployed` - Set of deployed bot IDs
- `bots:active` - Set of bots currently in matches
- `bots:commands` - Pub/sub channel for deployment commands

### Timing Distributions
- **Lognormal** (default): Realistic completion times with configurable mean/sigma
- **Gamma**: Alternative distribution for different timing patterns
- **Per-Difficulty**: Separate timing parameters for Easy/Medium/Hard problems

See `backend/bots/README.md` for detailed documentation.

## Colyseus Game Server

The Colyseus server handles real-time match logic and matchmaking:

```
colyseus/
├── src/
│   ├── index.ts              # Server entry point
│   ├── rooms/
│   │   ├── MatchRoom.ts      # Competitive match room
│   │   ├── QueueRoom.ts      # Matchmaking queue room
│   │   └── PrivateRoom.ts    # Private room with room codes
│   ├── lib/
│   │   ├── codeRunner.ts     # Judge0 integration
│   │   ├── judge0.ts         # Judge0 API client
│   │   ├── testExecutor.ts   # Test case execution
│   │   ├── problemData.ts    # Problem management
│   │   ├── eloSystem.ts      # Advanced ELO calculations
│   │   ├── matchCreation.ts  # Match creation logic
│   │   ├── dataStructureHelpers.ts # ListNode/TreeNode support
│   │   ├── internalAuth.ts   # Internal service authentication
│   │   ├── queue.ts          # Queue operations
│   │   └── redis.ts          # Redis client
│   └── workers/
│       └── matchmaker.ts     # Background matchmaking (runs every 1s)
├── Dockerfile
└── package.json
```

**Matchmaking Flow:**
1. Players join queue via `/queue/enqueue` (adds to Redis sorted set)
2. Background matchmaker polls every 1 second
3. **Dynamic ELO-based pairing** with progressive threshold expansion (±50 to ±250 based on wait time)
4. Uses Gaussian distribution for difficulty-based problem selection
5. Creates Colyseus MatchRoom with sanitized problem data
6. Stores reservations in Redis for players to join
7. Bot service manages AI opponents with configurable timing distributions

**Private Room Flow:**
1. Player creates private room with unique room code
2. Room creator selects specific problem
3. Second player joins with room code
4. Creator starts match when ready
5. Match transitions to competitive match with same rules

**Guest Mode Flow:**
1. Unauthenticated player starts a guest session (7-day cookie)
2. Guest automatically matched with bot opponent
3. Guest completes match
4. Post-match sign-up prompt to save results
5. Match claiming system converts guest match to permanent account

### Colyseus Development

```bash
cd colyseus
npm install
npm run dev          # Watch mode with auto-reload
npm run build        # Compile TypeScript
npm start            # Production mode
```

## Service Details

### Judge0 Configuration

Judge0 consists of two containers:
- **judge0-server**: REST API for code submission
- **judge0-worker**: Executes code in isolated containers
- **judge0-db**: PostgreSQL for Judge0 metadata

Supported languages: 89+ (JavaScript, Python, C++, Java, Go, Rust, etc.)

### MinIO Setup

MinIO provides S3-compatible object storage:
- Bucket `codeclashers-avatars` created automatically
- Public read access for avatars
- CORS enabled for browser uploads

Access console at http://localhost:9001

### Redis Usage

Redis serves multiple purposes:
- **Matchmaking queue**: Sorted set by ELO rating
- **Match state cache**: Active match data
- **User reservations**: Prevent duplicate queueing
- **Pub/sub**: Match event notifications
- **Guest sessions**: Temporary guest user data storage (`guest:session:{guestId}`)

### MongoDB Collections

- `users` - User accounts and profiles
- `sessions` - Active login sessions (TTL index)
- `matches` - Match history and results
- `submissions` - Code submissions and test results
- `bots` - AI bot identities and statistics
- `problems` - Problem library with test cases

## Troubleshooting

### Judge0 Issues

```bash
# Check Judge0 logs
docker-compose logs judge0-server
docker-compose logs judge0-worker

# Restart Judge0
docker-compose restart judge0-server judge0-worker judge0-db
```

### MinIO Bucket Issues

```bash
# Re-run bucket initialization
docker-compose restart minio-init
docker-compose logs minio-init
```

### Colyseus Connection Issues

```bash
# Check Colyseus logs
docker-compose logs colyseus

# Restart Colyseus
docker-compose restart colyseus
```

### Redis Connection Issues

```bash
# Verify Redis password matches .env
docker-compose logs redis

# Test Redis connection
redis-cli -h localhost -p 6379 -a redis_dev_password_123 PING
```

## Security Notes

### Development Setup
- Create `.env` from `.env.example` template
- Default credentials provided for local development only
- **Never commit your actual `.env` file**

### Production Requirements
⚠️ Before deploying to production:
- [ ] Generate strong passwords (use `openssl rand -base64 32`)
- [ ] Update all credentials in `.env`
- [ ] Enable authentication for MongoDB
- [ ] Use TLS/SSL for all connections
- [ ] Set `NODE_ENV=production`
- [ ] Update MinIO CORS in `minio-init/init.sh` with your domain
- [ ] Configure firewall rules
- [ ] Enable Docker security scanning

## Performance Monitoring

### Check Service Health

```bash
# View all service status
docker-compose ps

# Monitor resource usage
docker stats

# Check specific service logs
docker-compose logs -f [service-name]
```

### Database Monitoring

```bash
# MongoDB connection count
docker exec codeclashers-mongodb mongosh --eval "db.serverStatus().connections"

# Redis memory usage
docker exec codeclashers-redis redis-cli -a redis_dev_password_123 INFO memory
```

## API Documentation

### Colyseus Endpoints

- `ws://localhost:2567` - WebSocket connection
- Room types: `match`, `queue`, `private`
- **Private Room**: Join with room code, creator selects problem and starts match
- **Guest Mode**: Automatic match creation against bots for unauthenticated users

### Judge0 API

- `POST /submissions` - Submit code for execution
- `GET /submissions/:token` - Get submission results
- `GET /languages` - List supported languages

Full documentation: https://ce.judge0.com/

### Guest Mode Endpoints

- `POST /guest/match/create` - Create guest match against bot
- `POST /guest/match/claim` - Claim guest match after registration
- `GET /guest/check?guestId={id}` - Check if guest has played

### Private Room Endpoints

- `POST /private/create` - Create private room (returns room code)
- `GET /private/room/:roomCode` - Get private room info
- `POST /private/join` - Join private room with code
- `POST /private/leave` - Leave private room

## Contributing

When modifying backend services:
1. Update `docker-compose.yml` if adding/changing services
2. Document environment variables in `.env.example`
3. Update this README with new features
4. Test all services with `docker-compose up`

## License

MIT
