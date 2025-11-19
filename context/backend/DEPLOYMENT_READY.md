# ✅ Backend Deployment Ready

## Code Status: ✅ READY

All code changes are complete:
- ✅ Services use `externalIPs` with `COLYSEUS_HOST_IP` variable
- ✅ Workflow extracts VM IP from `COLYSEUS_HOST_IP`
- ✅ Services bind to predefined ports (2567, 6379, 27017, 2358)
- ✅ No dynamic IP extraction needed

## Required GitHub Secrets

Set these in: **Settings → Secrets and variables → Actions → Secrets**

### Required (No defaults):
- [ ] `REDIS_PASSWORD` - Redis password
- [ ] `MONGODB_URI` - Full MongoDB connection string
- [ ] `OPENAI_API_KEY` - OpenAI API key
- [ ] `INTERNAL_SERVICE_SECRET` - Internal service auth secret
- [ ] `BOT_SERVICE_SECRET` - Bot service auth secret
- [ ] `COLYSEUS_RESERVATION_SECRET` - Colyseus reservation secret
- [ ] `JUDGE0_POSTGRES_USER` - Judge0 database user
- [ ] `JUDGE0_POSTGRES_PASSWORD` - Judge0 database password
- [ ] `JUDGE0_POSTGRES_DB` - Judge0 database name

### Optional (for S3):
- [ ] `AWS_ACCESS_KEY_ID` - Only if using S3 (Lambda uses IAM role)
- [ ] `AWS_SECRET_ACCESS_KEY` - Only if using S3 (Lambda uses IAM role)

## Required GitHub Variables

Set these in: **Settings → Secrets and variables → Actions → Variables**

### Required:
- [ ] `COLYSEUS_HOST_IP` - **Your Oracle VM IP address** (e.g., `1.2.3.4`)
- [ ] `REDIS_HOST` - Redis host (use `COLYSEUS_HOST_IP` or `redis-cluster` for internal)
- [ ] `REDIS_PORT` - Redis port (default: `6379`)
- [ ] `MONGODB_PORT` - MongoDB port (default: `27017`)
- [ ] `COLYSEUS_PORT` - Colyseus port (default: `2567`)
- [ ] `JUDGE0_PORT` - Judge0 port (default: `2358`)

### Optional (with defaults):
- [ ] `S3_BUCKET_NAME` - S3 bucket name (optional)
- [ ] `AWS_REGION` - AWS region (default: `us-east-1`)

## Quick Deploy Checklist

1. **Set `COLYSEUS_HOST_IP` variable** = Your Oracle VM IP
2. **Set all required secrets** (passwords, API keys, etc.)
3. **Set required variables** (ports, Redis host, etc.)
4. **Deploy backend**:
   - Push to `main` branch, OR
   - Go to Actions → Deploy Backend → Run workflow
5. **Verify services are bound**:
   ```bash
   kubectl get svc -n codeclashers
   ```
   Should show services with `externalIPs` set to your VM IP

## After Backend Deployment

Once backend is deployed, services will be accessible at:
- **Colyseus**: `http://<COLYSEUS_HOST_IP>:2567`
- **Redis**: `<COLYSEUS_HOST_IP>:6379`
- **MongoDB**: `<COLYSEUS_HOST_IP>:27017`
- **Judge0**: `<COLYSEUS_HOST_IP>:2358`

Then set these for frontend deployment:
- `NEXT_PUBLIC_COLYSEUS_HTTP_URL` = `http://<COLYSEUS_HOST_IP>:2567`
- `NEXT_PUBLIC_COLYSEUS_WS_URL` = `ws://<COLYSEUS_HOST_IP>:2567`
- `REDIS_HOST` = `<COLYSEUS_HOST_IP>` (if frontend needs direct access)

## Ready to Deploy? ✅

**YES!** Once you've set:
1. ✅ `COLYSEUS_HOST_IP` variable
2. ✅ All required secrets
3. ✅ Required variables (ports, etc.)

You can deploy the backend immediately. The workflow will:
- Extract `COLYSEUS_HOST_IP` from variables
- Bind all services to that IP on predefined ports
- No manual IP updates needed!

