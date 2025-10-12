# LeetBattle Backend

Backend infrastructure for LeetBattle competitive coding platform.

## Architecture Overview

The backend consists of multiple microservices orchestrated via Docker Compose:

### Core Services

- **Colyseus** (Port 2567) - Real-time game server for matches
- **MongoDB** (Port 27017) - User accounts, sessions, match history
- **Redis** (Port 6379) - Matchmaking queue, caching, pub/sub events
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
- **EC2 (Private Subnet)** - Colyseus + Judge0 + Redis
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

## Colyseus Game Server

The Colyseus server handles real-time match logic and matchmaking:

```
colyseus/
├── src/
│   ├── index.ts              # Server entry point
│   ├── rooms/
│   │   ├── MatchRoom.ts      # Competitive match room
│   │   └── QueueRoom.ts      # Matchmaking queue room
│   ├── lib/
│   │   ├── codeRunner.ts     # Judge0 integration
│   │   ├── judge0.ts         # Judge0 API client
│   │   ├── testExecutor.ts   # Test case execution
│   │   ├── problemData.ts    # Problem management
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
3. Pairs players by ELO rating (±200 range)
4. Selects random problem from `client/problems.json`
5. Creates Colyseus MatchRoom
6. Stores reservations in Redis for players to join

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

### MongoDB Collections

- `users` - User accounts and profiles
- `sessions` - Active login sessions (TTL index)
- `matches` - Match history and results
- `submissions` - Code submissions and test results

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
- Room types: `match`, `queue`

### Judge0 API

- `POST /submissions` - Submit code for execution
- `GET /submissions/:token` - Get submission results
- `GET /languages` - List supported languages

Full documentation: https://ce.judge0.com/

## Contributing

When modifying backend services:
1. Update `docker-compose.yml` if adding/changing services
2. Document environment variables in `.env.example`
3. Update this README with new features
4. Test all services with `docker-compose up`

## License

MIT
