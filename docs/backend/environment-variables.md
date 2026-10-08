# Environment Variables Reference

Complete reference for all environment variables used across frontend and backend services.

**MIGRATION NOTICE:** As of this update, secrets are managed through AWS Secrets Manager instead of GitHub Secrets. GitHub Variables are still used for non-sensitive configuration values.

---

## Quick Reference

### AWS Secrets Manager (Sensitive Data)

All sensitive secrets are now stored in AWS Secrets Manager and fetched during GitHub Actions deployment:

| Secret Group | AWS Secret Name | Description |
|--------------|----------------|-------------|
| Backend | `codeclashers/backend` | All backend service secrets |
| Frontend | `codeclashers/frontend` | All frontend deployment secrets |
| Registry | `codeclashers/ghcr` | GitHub Container Registry PAT |

**Backend Secrets** (`codeclashers/backend`):
- `REDIS_PASSWORD`, `MONGODB_URI` (username/password are automatically extracted from URI)
- `JUDGE0_POSTGRES_USER`, `JUDGE0_POSTGRES_PASSWORD`, `JUDGE0_POSTGRES_DB`
- `OPENAI_API_KEY`, `INTERNAL_SERVICE_SECRET`, `BOT_SERVICE_SECRET`
- `COLYSEUS_RESERVATION_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`

**Note:** Only `MONGODB_URI` is required. The URI should include credentials: `mongodb://username:password@host:port/db?authSource=admin`. Username and password are automatically extracted by deployment scripts.

**Frontend Secrets** (`codeclashers/frontend`):
- `NEXTAUTH_SECRET`, `MONGODB_URI`, `REDIS_PASSWORD`
- `OPENAI_API_KEY`, `INTERNAL_SERVICE_SECRET`
- `AWS_ROLE_ARN`, `AWS_ACCOUNT_ID`, `ROUTE53_HOSTED_ZONE_ID`

**Registry Secrets** (`codeclashers/ghcr`):
- `GHCR_PAT`

### GitHub Secrets (Infrastructure Only)

Only one GitHub Secret remains - used for OIDC authentication:

| Secret | Description |
|--------|-------------|
| `AWS_ROLE_ARN` | OIDC role for AWS authentication |

### GitHub Variables (Non-Sensitive)

| Variable | Default | Description |
|----------|---------|-------------|
| `COLYSEUS_HOST_IP` | **Required** | Oracle VM public IP |
| `REDIS_HOST` | `redis-cluster` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_CLUSTER_ENABLED` | `true` | Enable cluster mode |
| `MONGODB_PORT` | `27017` | MongoDB port |
| `COLYSEUS_PORT` | `2567` | Colyseus port |
| `JUDGE0_PORT` | `2358` | Judge0 port |
| `NEXT_PUBLIC_COLYSEUS_HTTP_URL` | - | Public HTTP endpoint |
| `NEXT_PUBLIC_COLYSEUS_WS_URL` | - | Public WebSocket endpoint |
| `NEXT_PUBLIC_API_BASE` | - | API base URL (fallback) |
| `AWS_REGION` | `us-east-1` | AWS region |
| `S3_BUCKET_NAME` | - | S3 bucket for avatars |

---

## Frontend (Next.js / Lambda)

### Required Variables

**Backend Connection:**
```env
NEXT_PUBLIC_API_BASE=https://api.leetbattle.net
NEXT_PUBLIC_COLYSEUS_HTTP_URL=https://api.leetbattle.net
NEXT_PUBLIC_COLYSEUS_WS_URL=wss://api.leetbattle.net
```

**Database & Cache:**
```env
MONGODB_URI=mongodb://user:pass@host:27017/codeclashers?authSource=admin
REDIS_HOST=<redis-ip>
REDIS_PORT=6379
REDIS_PASSWORD=<password>
REDIS_CLUSTER_ENABLED=true
REDIS_CLUSTER_NODES=<optional-comma-separated-nodes>
```

**Storage:**
```env
S3_BUCKET_NAME=<bucket-name>
AWS_REGION=us-east-1
# S3_ENDPOINT - Only for MinIO, leave empty for AWS S3
```

**Authentication:**
```env
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=https://leetbattle.net
INTERNAL_SERVICE_SECRET=<must-match-backend>
```

### Notes

- **AWS Credentials**: NOT needed in Lambda - IAM role handles auth
- **S3_ENDPOINT**: Only set for MinIO (dev), not AWS S3 (production)
- **INTERNAL_SERVICE_SECRET**: CRITICAL - Must match backend secret

---

## Backend: Colyseus Service

### Required Variables

```env
# Server
PORT=2567
COLYSEUS_PORT=2567
CORS_ORIGIN=https://leetbattle.net

# Redis (REQUIRED - no fallback)
REDIS_HOST=redis-cluster
REDIS_PORT=6379
REDIS_PASSWORD=<password>
REDIS_CLUSTER_ENABLED=true

# MongoDB (REQUIRED - no fallback)
MONGODB_URI=mongodb://...

# Judge0 (REQUIRED - no fallback)
JUDGE0_URL=http://judge0-server:2358
JUDGE0_HOST=judge0-server
JUDGE0_PORT=2358

# Authentication
INTERNAL_SERVICE_SECRET=<secret>
BOT_SERVICE_SECRET=<secret>
COLYSEUS_RESERVATION_SECRET=<secret>

# OpenAI
OPENAI_API_KEY=<key>

# AWS S3
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
S3_BUCKET_NAME=<bucket>
AWS_REGION=us-east-1
```

---

## Backend: Bots Service

### Required Variables

```env
# Redis (REQUIRED - no fallback)
REDIS_HOST=redis-cluster
REDIS_PORT=6379
REDIS_PASSWORD=<password>

# MongoDB (REQUIRED - no fallback)
MONGODB_URI=mongodb://...

# Colyseus (REQUIRED - no fallback)
COLYSEUS_URL=ws://colyseus:2567
COLYSEUS_HOST=colyseus
COLYSEUS_PORT=2567

# Authentication
BOT_SERVICE_SECRET=<secret>
```

---

## Backend: Judge0 Services

### Required Variables

```env
# Redis (from secrets)
REDIS_HOST=redis-cluster
REDIS_PORT=6379
REDIS_PASSWORD=<password>

# PostgreSQL (from secrets/configmap)
POSTGRES_HOST=postgres
POSTGRES_USER=<user>
POSTGRES_PASSWORD=<password>
POSTGRES_DB=<database>
```

**Note:** Judge0 always listens on port 2358 internally. The `JUDGE0_PORT` secret is for other services to know how to connect.

---

## Kubernetes Configuration

### Secrets (app-secrets)

```yaml
REDIS_HOST: redis-cluster
REDIS_PORT: "6379"
REDIS_PASSWORD: <base64-encoded>
JUDGE0_PORT: "2358"
MONGODB_PORT: "27017"
COLYSEUS_PORT: "2567"
MONGODB_URI: <base64-encoded>
MONGODB_URI_INTERNAL: <base64-encoded>
```

### ConfigMap (app-config)

```yaml
JUDGE0_HOST: judge0-server
COLYSEUS_HOST: colyseus
POSTGRES_HOST: postgres
MONGODB_HOST: mongodb
REDIS_HOST: redis-cluster
```

### Inter-Service Communication

Services use Kubernetes DNS for internal communication:

| Service | Internal URL |
|---------|--------------|
| Colyseus | `ws://colyseus:2567` |
| Judge0 | `http://judge0-server:2358` |
| MongoDB | `mongodb://mongodb:27017` |
| Redis | `redis-cluster:6379` |

Full DNS: `<service-name>.codeclashers.svc.cluster.local`

---

## Validation Rules

All critical environment variables now:

1. ✅ **Throw errors if missing** - No silent fallbacks to localhost
2. ✅ **Use environment variables** - No hardcoded URLs or IPs
3. ✅ **Reference services correctly** - Use K8s service names from ConfigMap
4. ✅ **Use ports from secrets** - All ports configurable

### Removed Hardcoded Values

| Before (Removed) | After (Required) |
|------------------|------------------|
| `127.0.0.1` | `REDIS_HOST` env var |
| `ws://localhost:2567` | `COLYSEUS_URL` env var |
| `http://codeclashers-judge0:2358` | `JUDGE0_URL` env var |
| `mongodb://codeclashers-mongodb:27017` | `MONGODB_URI` env var |

---

## Frontend-Backend Consistency

### Variables That Must Match

| Variable | Frontend | Backend |
|----------|----------|---------|
| `INTERNAL_SERVICE_SECRET` | ✅ Required | ✅ Required |
| `MONGODB_URI` | ✅ Same connection string | ✅ Same connection string |
| `REDIS_PASSWORD` | ✅ Same password | ✅ Same password |

### Frontend Authentication with Backend

Protected endpoints require the `X-Internal-Secret` header:
- `/queue/enqueue`
- `/queue/dequeue`
- `/queue/clear`

The frontend code sends this header automatically when `INTERNAL_SERVICE_SECRET` is set.

---

## Lambda Deployment Notes

### Required Lambda Environment Variables

```env
# MongoDB - Full connection string
MONGODB_URI=mongodb://user:pass@<mongodb-ip>:27017/codeclashers?authSource=admin

# Redis - Password required
REDIS_HOST=<redis-ip>
REDIS_PORT=6379
REDIS_PASSWORD=<password>
REDIS_CLUSTER_ENABLED=true

# Colyseus - Public URLs
NEXT_PUBLIC_COLYSEUS_HTTP_URL=http://<colyseus-ip>:2567
NEXT_PUBLIC_COLYSEUS_WS_URL=ws://<colyseus-ip>:2567

# Authentication
INTERNAL_SERVICE_SECRET=<must-match-backend>
NEXTAUTH_URL=https://leetbattle.net
NEXTAUTH_SECRET=<secret>

# S3 - IAM role handles credentials
S3_BUCKET_NAME=<bucket>
AWS_REGION=us-east-1
```

### Production Recommendations

Use HTTPS/WSS with proper domains:
```env
NEXT_PUBLIC_COLYSEUS_HTTP_URL=https://api.yourdomain.com
NEXT_PUBLIC_COLYSEUS_WS_URL=wss://api.yourdomain.com
```

---

## Troubleshooting

### Missing Environment Variable Errors

Services now fail fast if critical env vars are missing. Check logs for:
- `Missing required environment variable: REDIS_HOST`
- `MONGODB_URI is required`
- `JUDGE0_URL must be configured`

### Authentication Errors (401)

1. Verify `INTERNAL_SERVICE_SECRET` matches between frontend and backend
2. Check Lambda has `INTERNAL_SERVICE_SECRET` set
3. Ensure frontend sends `X-Internal-Secret` header

### Connection Errors

1. Verify LoadBalancer external IPs: `kubectl get svc -n codeclashers`
2. Check security groups/firewall allow traffic
3. Test connectivity: `curl http://<colyseus-ip>:2567/health`

---

## Verification Checklist

Before deploying:

- [ ] AWS Secrets Manager secrets populated with correct values
- [ ] IAM policy attached to OIDC role (`AWS_ROLE_ARN`)
- [ ] GitHub Variables (non-sensitive) configured
- [ ] `INTERNAL_SERVICE_SECRET` matches between frontend/backend secrets
- [ ] `MONGODB_URI` includes full connection string with credentials (format: `mongodb://username:password@host:port/db?authSource=admin`)
- [ ] MongoDB username/password are automatically extracted from URI (not required separately)
- [ ] `REDIS_HOST` points to correct IP/hostname
- [ ] `NEXT_PUBLIC_COLYSEUS_*` URLs point to public endpoints
- [ ] Backend services have `LoadBalancer` type
- [ ] Frontend can reach backend via external IPs

## Migration from GitHub Secrets

If migrating from GitHub Secrets to AWS Secrets Manager:

1. **Create secrets structure:**
   ```bash
   ./scripts/secrets/create-secrets-manager.sh
   ```

2. **Migrate values (interactive):**
   ```bash
   ./scripts/secrets/migrate-to-aws.sh
   ```

3. **Attach IAM policy:**
   ```bash
   ./scripts/secrets/attach-iam-policy.sh
   ```

4. **Test deployment:**
   - Run `sync-secrets.yml` workflow for K8s
   - Run `frontend-build.yml` and `frontend-deploy.yml` for Lambda

5. **(Optional) Remove old GitHub Secrets:**
   - Keep `AWS_ROLE_ARN` for OIDC authentication
   - Remove all other secrets (now in Secrets Manager)

---

## Related Documentation

- **AWS Secrets Manager:** [`backend/k8s/argocd/README-IAM-POLICY.md`](../../backend/k8s/argocd/README-IAM-POLICY.md)
- **Local Development:** [`local-development.md`](./local-development.md)
- **Deployment:** [`deployment.md`](./deployment.md)
- **ArgoCD:** [`argocd.md`](./argocd.md)

