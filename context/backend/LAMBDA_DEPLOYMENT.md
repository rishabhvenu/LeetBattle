# Lambda/S3 Frontend Deployment Configuration

This document describes the configuration needed for deploying the Next.js frontend (compiled with OpenNext) to AWS Lambda and S3, and how it connects to the backend services running on Kubernetes.

## Backend Services External Access

All backend services have been configured with `LoadBalancer` type to enable external access from Lambda functions:

- **Colyseus**: `LoadBalancer` on port 2567
- **MongoDB**: `LoadBalancer` on port 27017
- **Redis**: `LoadBalancer` on port 6379
- **Judge0**: `LoadBalancer` on port 2358

### Getting External IPs

After deployment, get the external IPs/domains:

```bash
kubectl get svc -n codeclashers
```

Look for the `EXTERNAL-IP` column. For k3s, this may show as `<pending>` initially, then assign an IP from the node's external IP pool.

## Lambda Environment Variables

The following environment variables **must** be set in your Lambda function configuration:

### Required Environment Variables

```env
# MongoDB - Full connection string with credentials
# Format: mongodb://username:password@host:port/database?authSource=admin
MONGODB_URI=mongodb://username:password@<mongodb-external-ip>:27017/codeclashers?authSource=admin

# Redis - Password required
REDIS_HOST=<redis-external-ip>
REDIS_PORT=6379
REDIS_PASSWORD=<redis-password>
REDIS_CLUSTER_ENABLED=true  # If using Redis cluster

# Colyseus - Public URLs (no credentials in URL)
NEXT_PUBLIC_COLYSEUS_HTTP_URL=http://<colyseus-external-ip>:2567
NEXT_PUBLIC_COLYSEUS_WS_URL=ws://<colyseus-external-ip>:2567

# Internal Service Authentication (REQUIRED for protected endpoints)
INTERNAL_SERVICE_SECRET=<same-secret-as-backend>

# Next.js Authentication
NEXTAUTH_URL=https://yourdomain.com
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>

# AWS S3 Configuration
# Note: AWS credentials are NOT needed in Lambda - IAM role is used automatically
S3_BUCKET_NAME=<your-bucket-name>
AWS_REGION=us-east-1
# S3_ENDPOINT: DO NOT SET for AWS S3 - SDK automatically determines endpoint from region
# Only set for MinIO or S3-compatible services (e.g., S3_ENDPOINT=http://localhost:9000)

# Optional: API Base URL (fallback)
NEXT_PUBLIC_API_BASE=http://<colyseus-external-ip>:2567
```

### Production Recommendations

For production, use HTTPS/WSS with proper domains:

```env
NEXT_PUBLIC_COLYSEUS_HTTP_URL=https://api.yourdomain.com
NEXT_PUBLIC_COLYSEUS_WS_URL=wss://api.yourdomain.com
MONGODB_URI=mongodb://username:password@mongodb.yourdomain.com:27017/codeclashers?authSource=admin
REDIS_HOST=redis.yourdomain.com
```

## Authentication Requirements

### MongoDB
- **Requires**: Username and password in connection string
- **Format**: `mongodb://username:password@host:port/database?authSource=admin`

### Redis
- **Requires**: Password authentication
- **Set**: `REDIS_PASSWORD` environment variable
- **Cluster Mode**: Set `REDIS_CLUSTER_ENABLED=true` if using Redis cluster

### Colyseus
- **Public Endpoints**: No authentication required (rate-limited)
  - `/queue/reservation`
  - `/reserve/consume`
  - `/match/snapshot`
  - `/match/submissions`
  - `/private/*`
  - `/guest/*`
  
- **Protected Endpoints**: Require `X-Internal-Secret` header
  - `/queue/enqueue` - ✅ Fixed: Frontend now sends header
  - `/queue/dequeue` - ✅ Fixed: Frontend now sends header
  - `/queue/clear` - ✅ Fixed: Frontend now sends header
  
- **Admin Endpoints**: Require admin session (cookie-based)
  - `/admin/*` - Uses cookie authentication (already implemented)

## Frontend Code Changes

The following changes were made to support Lambda deployment:

1. **Queue Actions** (`client/src/lib/actions/queue.ts`):
   - Added `X-Internal-Secret` header to `enqueueUser()`
   - Added `X-Internal-Secret` header to `dequeueUser()`
   - Added `X-Internal-Secret` header to `clearReservation()`

2. **Room Connection** (`client/src/lib/utils/match/roomConnection.ts`):
   - Updated to use server action `clearReservation()` instead of direct fetch
   - Ensures authentication header is properly included

## Deployment Checklist

- [ ] Deploy backend services to Kubernetes
- [ ] Verify all services have `LoadBalancer` type
- [ ] Get external IPs for all services
- [ ] Configure DNS (optional but recommended for production)
- [ ] Set up SSL/TLS certificates (required for production)
- [ ] Set all environment variables in Lambda
- [ ] Verify `INTERNAL_SERVICE_SECRET` matches backend secret
- [ ] Test MongoDB connection from Lambda
- [ ] Test Redis connection from Lambda
- [ ] Test Colyseus HTTP endpoint from Lambda
- [ ] Test Colyseus WebSocket endpoint from Lambda
- [ ] Deploy frontend to Lambda/S3
- [ ] Verify frontend can connect to all backend services

## Troubleshooting

### Connection Issues

**MongoDB Connection Failed:**
- Verify `MONGODB_URI` includes username, password, and correct host
- Check MongoDB service has `LoadBalancer` type
- Verify MongoDB is accessible from Lambda's network (security groups/firewall)

**Redis Connection Failed:**
- Verify `REDIS_PASSWORD` matches backend
- Check Redis service has `LoadBalancer` type
- Verify Redis cluster mode is enabled if using cluster: `REDIS_CLUSTER_ENABLED=true`

**Colyseus Connection Failed:**
- Verify `NEXT_PUBLIC_COLYSEUS_HTTP_URL` and `NEXT_PUBLIC_COLYSEUS_WS_URL` are set
- Check Colyseus service has `LoadBalancer` type
- Verify service is accessible from Lambda

### Authentication Errors

**401 Unauthorized on `/queue/enqueue` or `/queue/dequeue`:**
- Verify `INTERNAL_SERVICE_SECRET` is set in Lambda
- Verify `INTERNAL_SERVICE_SECRET` matches backend secret
- Check frontend code is using latest version with authentication headers

**MongoDB Authentication Failed:**
- Verify connection string includes `authSource=admin`
- Check username and password are correct
- Verify MongoDB replica set is initialized

**Redis Authentication Failed:**
- Verify `REDIS_PASSWORD` matches backend configuration
- Check Redis is configured with `requirepass`

## Security Notes

1. **Never commit secrets** to version control
2. **Use AWS Secrets Manager** or Parameter Store for sensitive values in production
3. **Rotate secrets regularly** in production
4. **Use HTTPS/WSS** for all external connections in production
5. **Restrict network access** using security groups/firewalls
6. **Monitor access logs** for unauthorized access attempts

## Next Steps

1. Set up DNS records pointing to LoadBalancer IPs
2. Configure SSL/TLS certificates (Let's Encrypt or AWS Certificate Manager)
3. Set up CloudFront distribution for frontend
4. Configure AWS WAF for DDoS protection
5. Set up monitoring and alerting
6. Document disaster recovery procedures

