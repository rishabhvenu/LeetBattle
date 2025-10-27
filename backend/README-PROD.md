# Production Backend Setup

This guide explains how to set up the backend services on Oracle Cloud without MongoDB and MinIO (using MongoDB Atlas and AWS S3 instead).

## What This Setup Includes

- ✅ **Colyseus** - Real-time game server
- ✅ **Redis** - Caching and matchmaking queue
- ✅ **Judge0 Server** - Code execution API
- ✅ **Judge0 Worker** - Code execution engine
- ✅ **Judge0 PostgreSQL** - Judge0 database
- ✅ **Bot Service** - Automated bot players

## External Services (Not Included)

- ❌ **MongoDB** - Uses MongoDB Atlas (managed)
- ❌ **MinIO** - Uses AWS S3 for object storage

## One-Time Setup on Oracle VM

### 1. Clone Repository

```bash
cd /opt
sudo mkdir CodeClashers
sudo chown ubuntu:ubuntu CodeClashers
cd CodeClashers
git clone https://github.com/yourusername/CodeClashers.git .
```

### 2. Install Docker & Docker Compose

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker ubuntu
newgrp docker
```

### 3. Create Production Environment File

```bash
cd backend
cp .env.production.template .env.production
nano .env.production
```

Fill in all the values:
- MongoDB Atlas connection string
- Redis password
- Judge0 PostgreSQL credentials
- AWS S3 credentials
- OpenAI API key
- All secret keys

### 4. Set Permissions

```bash
chmod 600 .env.production
```

### 5. Start Services

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 6. Verify Services

```bash
docker-compose -f docker-compose.prod.yml ps
```

## Environment Variables Explained

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `REDIS_PASSWORD` | Redis authentication password |
| `AWS_ACCESS_KEY_ID` | AWS access key for S3 |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key for S3 |
| `S3_BUCKET_NAME` | Name of your S3 bucket |
| `OPENAI_API_KEY` | OpenAI API key for bot generation |
| `INTERNAL_SERVICE_SECRET` | Secret for internal service auth |
| `BOT_SERVICE_SECRET` | Secret for bot service |
| `COLYSEUS_RESERVATION_SECRET` | Secret for Colyseus reservations |

## GitHub Actions Auto-Deployment

The backend is automatically deployed via GitHub Actions when you push to `main` with changes in `backend/`.

The workflow runs on your self-hosted runner (Oracle VM) and:
1. Pulls latest code
2. Rebuilds containers
3. Restarts services

## Manual Deployment

If you need to manually redeploy:

```bash
cd /opt/CodeClashers/backend
git pull origin main
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

## Health Checks

```bash
# Check Colyseus
curl http://localhost:2567/health

# Check Judge0
curl http://localhost:2358/

# Check Redis
docker exec codeclashers-redis redis-cli -a $REDIS_PASSWORD ping
```

## Logs

```bash
# View all logs
docker-compose -f docker-compose.prod.yml logs -f

# View specific service
docker-compose -f docker-compose.prod.yml logs -f colyseus
```

## Troubleshooting

### Services won't start

Check logs:
```bash
docker-compose -f docker-compose.prod.yml logs
```

### Port conflicts

Check if ports are in use:
```bash
sudo netstat -tulpn | grep -E '2567|6379|2358'
```

### Out of memory

Oracle Cloud free tier has 24GB RAM. Monitor usage:
```bash
free -h
```

## Security Notes

1. **Never commit `.env.production`** - It's in `.gitignore`
2. Use strong passwords for all secrets
3. Restrict MongoDB Atlas network access to Oracle VM IP only
4. Use IAM roles for S3 access when possible
5. Keep Docker images updated
