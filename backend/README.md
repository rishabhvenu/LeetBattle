# CodeClashers Backend

Backend services for CodeClashers competitive coding platform.

## Services

- **MongoDB**: Main database for user data and matches
- **MinIO**: S3-compatible object storage
- **Redis**: Caching and pub/sub messaging
- **Judge0**: Code execution engine
- **Colyseus**: Real-time game server

## Getting Started

### 1. Environment Variables

The `.env` file is included in the repository with development credentials. 

For production deployments:
- Update all passwords in `.env` with secure values
- `MINIO_ROOT_PASSWORD`: Use a strong password (min 8 characters)
- `REDIS_PASSWORD`: Use a strong password  
- `JUDGE0_POSTGRES_PASSWORD`: Use a strong password

### 2. Start Services

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### 3. Access Services

- **Colyseus Server**: http://localhost:2567
- **MinIO Console**: http://localhost:9001
- **MongoDB**: mongodb://localhost:27017
- **Redis**: localhost:6379
- **Judge0 API**: http://localhost:2358

## Security Notes

### Development vs Production:
- `.env` file is committed with **development credentials only**
- For production: Update all passwords before deploying
- Never commit production credentials to the repository

### ❌ NEVER Commit:
- Production `.env` files with real passwords
- Database dumps with real user data
- Private keys or certificates
- API keys for external services

## Development

For development, you can use weaker passwords in your local `.env` file. 

For production, ensure:
1. All passwords are strong (20+ random characters)
2. Change default usernames if possible
3. Use Docker secrets or environment injection
4. Enable network security (firewall rules, VPC)
5. Regular security updates
