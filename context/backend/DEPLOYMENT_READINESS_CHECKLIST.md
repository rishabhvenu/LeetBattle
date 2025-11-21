# Deployment Readiness Checklist

Use this checklist to verify everything is ready before deploying.

## ✅ Code Changes (All Complete)

- [x] Backend services changed to `LoadBalancer` type
- [x] Frontend code updated to send `X-Internal-Secret` header
- [x] Frontend infrastructure includes `INTERNAL_SERVICE_SECRET`
- [x] Frontend deployment workflow passes all required variables
- [x] GitHub Actions workflow enhanced with health checks and rollback

## 🔴 Backend Endpoints Configuration

**You have 3 options for backend endpoints:**

### Option 1: Cloud Services (Recommended) ✅
**You can set these BEFORE deploying frontend:**

- **MongoDB**: Use MongoDB Atlas (cloud) - IP is already in `MONGODB_URI` secret
  - Example: `mongodb+srv://user:pass@cluster.mongodb.net/db`
  - ✅ No need to wait for backend deployment

- **Redis**: Use managed Redis (AWS ElastiCache, Redis Cloud, etc.)
  - Set `REDIS_HOST` = your managed Redis hostname/IP
  - ✅ No need to wait for backend deployment

- **Colyseus**: Use domain name or fixed IP
  - Set `NEXT_PUBLIC_COLYSEUS_HTTP_URL` = `https://api.leetbattle.net` (domain)
  - OR `http://<your-vm-public-ip>:2567` (fixed IP)
  - ✅ No need to wait if using domain/fixed IP

### Option 2: Kubernetes LoadBalancer (Dynamic IPs) ⚠️
**You MUST deploy backend first, then get IPs:**

1. Deploy backend to Kubernetes
2. Get LoadBalancer external IPs:
   ```bash
   kubectl get svc -n codeclashers
   ```
3. Update GitHub Variables with the IPs:
   - `REDIS_HOST` = `<redis-external-ip>`
   - `NEXT_PUBLIC_COLYSEUS_HTTP_URL` = `http://<colyseus-external-ip>:2567`
   - `NEXT_PUBLIC_COLYSEUS_WS_URL` = `ws://<colyseus-external-ip>:2567`

### Option 3: Mixed Setup
- MongoDB: Cloud (Atlas) - set in `MONGODB_URI` secret ✅
- Redis: Kubernetes LoadBalancer - need IP after deployment ⚠️
- Colyseus: Domain name - set before deployment ✅

## 🔐 Required GitHub Secrets

### Backend Secrets (for backend deployment)

- [ ] `REDIS_PASSWORD` - Redis password
- [ ] `MONGODB_URI` - Full MongoDB connection string with credentials
- [ ] `OPENAI_API_KEY` - OpenAI API key
- [ ] `INTERNAL_SERVICE_SECRET` - Internal service authentication secret
- [ ] `BOT_SERVICE_SECRET` - Bot service authentication secret
- [ ] `JUDGE0_POSTGRES_PASSWORD` - Judge0 database password
- [ ] `MONGO_INITDB_ROOT_PASSWORD` - MongoDB root password
- [ ] `MONGO_INITDB_ROOT_USERNAME` - MongoDB root username

### Frontend Secrets (for frontend deployment)

- [ ] `MONGODB_URI` - **MUST match backend** (same connection string)
- [ ] `REDIS_PASSWORD` - **MUST match backend** (same password)
- [ ] `INTERNAL_SERVICE_SECRET` - **MUST match backend** (same secret)
- [ ] `NEXTAUTH_SECRET` - NextAuth.js secret (generate: `openssl rand -base64 32`)
- [ ] `AWS_ROLE_ARN` - AWS IAM role ARN for OIDC authentication
- [ ] `AWS_ACCOUNT_ID` - AWS account ID
- [ ] `ROUTE53_HOSTED_ZONE_ID` - Route53 hosted zone ID (if using custom domain)

## 📝 Required GitHub Variables

### Backend Connection Variables

- [ ] `REDIS_HOST` - Redis external IP or domain (set after backend deployment)
- [ ] `REDIS_PORT` - Redis port (default: `6379`)
- [ ] `REDIS_CLUSTER_ENABLED` - Set to `true` for cluster mode
- [ ] `REDIS_CLUSTER_NODES` - Optional: Comma-separated cluster nodes
- [ ] `NEXT_PUBLIC_COLYSEUS_HTTP_URL` - Colyseus HTTP endpoint (set after backend deployment)
- [ ] `NEXT_PUBLIC_COLYSEUS_WS_URL` - Colyseus WebSocket endpoint (set after backend deployment)
- [ ] `NEXT_PUBLIC_API_BASE` - Optional: API base URL (fallback)

### AWS Configuration Variables

- [ ] `AWS_REGION` - AWS region (default: `us-east-1`)
- [ ] `S3_BUCKET_NAME` - Optional: Existing S3 bucket name (or let CDK create one)
- [ ] `S3_ENDPOINT` - **Leave empty** for AWS S3 (only set for MinIO)

### DNS & Domain Variables (Optional but recommended)

- [ ] `ROUTE53_HOSTED_ZONE_NAME` - Hosted zone name (default: `leetbattle.net`)
- [ ] `NEXTJS_DOMAIN_NAME` - Frontend domain name
- [ ] `NEXTAUTH_URL` - Frontend URL (e.g., `https://leetbattle.net`)
- [ ] `COLYSEUS_DOMAIN` - Optional: Colyseus subdomain
- [ ] `COLYSEUS_HOST_IP` - Optional: Colyseus external IP for DNS record

## 🚀 Deployment Order

### Scenario A: Using Cloud Services / Domain Names ✅

**You can deploy frontend immediately after setting secrets/variables:**

1. **Set all GitHub Secrets** (MongoDB URI, Redis password, etc.)
2. **Set all GitHub Variables** with your known endpoints:
   - `MONGODB_URI` (secret) - already contains Atlas hostname
   - `REDIS_HOST` (variable) - your managed Redis hostname
   - `NEXT_PUBLIC_COLYSEUS_HTTP_URL` (variable) - your domain or fixed IP
   - `NEXT_PUBLIC_COLYSEUS_WS_URL` (variable) - your domain or fixed IP
3. **Deploy frontend** - it will work immediately!

### Scenario B: Using Kubernetes LoadBalancer (Dynamic IPs) ⚠️

**You must deploy backend first:**

1. **Set GitHub Secrets** (passwords, API keys, etc.)
2. **Deploy backend** to Kubernetes
3. **Get LoadBalancer IPs**:
   ```bash
   kubectl get svc -n codeclashers
   ```
4. **Update GitHub Variables** with the IPs:
   - `REDIS_HOST` = `<redis-external-ip>`
   - `NEXT_PUBLIC_COLYSEUS_HTTP_URL` = `http://<colyseus-external-ip>:2567`
   - `NEXT_PUBLIC_COLYSEUS_WS_URL` = `ws://<colyseus-external-ip>:2567`
5. **Deploy frontend**

**Verify backend is working:**
```bash
# Test Colyseus HTTP endpoint
curl http://<colyseus-external-ip>:2567/health

# Test MongoDB connection (if using Kubernetes MongoDB)
mongosh "mongodb://user:pass@<mongodb-external-ip>:27017/codeclashers?authSource=admin"

# Test Redis connection
redis-cli -h <redis-external-ip> -p 6379 -a <REDIS_PASSWORD> ping
```

```bash
# Trigger frontend build workflow (builds OpenNext artifacts)
# Then trigger frontend deploy workflow (deploys to Lambda/CloudFront)
```

## ⚠️ Common Issues & Solutions

### Issue 1: Frontend can't connect to backend

**Symptoms:**
- Lambda errors: "Connection refused" or "ECONNREFUSED"
- Frontend shows "Failed to connect to backend"

**Solutions:**
- ✅ Verify backend services have `LoadBalancer` type (not `ClusterIP`)
- ✅ Verify external IPs are assigned: `kubectl get svc -n codeclashers`
- ✅ Verify GitHub Variables point to correct external IPs
- ✅ Check security groups/firewall allow traffic from Lambda to backend IPs
- ✅ Test connectivity: `curl http://<colyseus-external-ip>:2567/health`

### Issue 2: Authentication errors (401 Unauthorized)

**Symptoms:**
- Frontend gets 401 on `/queue/enqueue` or `/queue/dequeue`
- Backend logs show "missing_internal_secret"

**Solutions:**
- ✅ Verify `INTERNAL_SERVICE_SECRET` is set in GitHub Secrets
- ✅ Verify `INTERNAL_SERVICE_SECRET` matches between frontend and backend
- ✅ Verify frontend code sends `X-Internal-Secret` header (already fixed)
- ✅ Verify Lambda has `INTERNAL_SERVICE_SECRET` environment variable

### Issue 3: MongoDB connection failed

**Symptoms:**
- Lambda errors: "MongoServerError: Authentication failed"
- Frontend can't access user data

**Solutions:**
- ✅ Verify `MONGODB_URI` includes username, password, and `authSource=admin`
- ✅ Verify MongoDB service has `LoadBalancer` type
- ✅ Verify MongoDB is accessible from Lambda's network
- ✅ Test connection: `mongosh "<MONGODB_URI>"`

### Issue 4: Redis connection failed

**Symptoms:**
- Lambda errors: "NOAUTH Authentication required"
- Frontend can't access Redis

**Solutions:**
- ✅ Verify `REDIS_PASSWORD` matches backend
- ✅ Verify `REDIS_HOST` points to external LoadBalancer IP
- ✅ Verify Redis service has `LoadBalancer` type
- ✅ Test connection: `redis-cli -h <REDIS_HOST> -p 6379 -a <REDIS_PASSWORD> ping`

### Issue 5: S3 access denied

**Symptoms:**
- Lambda errors: "AccessDenied" when accessing S3
- Avatar uploads fail

**Solutions:**
- ✅ Verify Lambda IAM role has S3 permissions
- ✅ Verify `S3_BUCKET_NAME` is correct
- ✅ Verify bucket exists and is accessible
- ✅ **DO NOT** set `S3_ENDPOINT` for AWS S3 (leave empty)

## ✅ Final Verification

After both deployments complete:

1. **Test Frontend**:
   - Open CloudFront URL or custom domain
   - Try to register/login
   - Try to join queue
   - Verify real-time match works

2. **Check Lambda Logs**:
   ```bash
   aws logs tail /aws/lambda/NextJsLambda --follow
   ```

3. **Check Backend Logs**:
   ```bash
   kubectl logs -n codeclashers deployment/colyseus --tail=100
   ```

4. **Monitor Health**:
   - Check CloudWatch alarms
   - Check Kubernetes pod status: `kubectl get pods -n codeclashers`
   - Check service endpoints: `kubectl get svc -n codeclashers`

## 📋 Quick Deployment Commands

```bash
# 1. Deploy backend (trigger workflow or push to main)
# Wait for completion, then:

# 2. Get backend external IPs
kubectl get svc -n codeclashers

# 3. Update GitHub Variables with IPs
# Go to: Settings > Secrets and variables > Actions > Variables
# Update: REDIS_HOST, NEXT_PUBLIC_COLYSEUS_HTTP_URL, NEXT_PUBLIC_COLYSEUS_WS_URL

# 4. Deploy frontend (trigger workflow)
# Frontend build workflow will run first, then deploy workflow
```

## 🎯 Current Status

**Code is ready**: ✅ All code changes complete
**Backend deployment**: ⏳ Needs to be deployed first
**Frontend deployment**: ⏳ Can deploy after backend has external IPs
**Configuration**: ⚠️ Need to set GitHub Secrets/Variables

**Next Steps:**
1. Set all required GitHub Secrets
2. Deploy backend and get external IPs
3. Update GitHub Variables with backend IPs
4. Deploy frontend

