# Debugging Guide

Comprehensive guide for diagnosing issues in both local development and production environments.

---

## Table of Contents

1. [Local Development Debugging](#local-development-debugging)
2. [Production Debugging](#production-debugging)
3. [Common Issues](#common-issues)
4. [Quick Reference](#quick-reference)

---

## Local Development Debugging

### 1. Gather Signal

```bash
# Check all pods
kubectl get pods -n codeclashers-dev

# View logs with helper script
cd backend/k8s/dev
./logs.sh colyseus           # or bots/judge0/redis/etc.
./logs.sh --all --tail=200   # snapshot of everything

# Direct kubectl logs
kubectl logs -n codeclashers-dev deployment/colyseus --tail=200
kubectl describe pod <pod> -n codeclashers-dev

# Check events
kubectl get events -n codeclashers-dev --sort-by='.lastTimestamp'
```

### 2. Validate Port Forwards

```bash
./check-ports.sh            # Check local forwards
./start-port-forward.sh     # Restart port forwarding
```

### 3. Clean State (When Matches/Queues Behave Oddly)

```bash
# Wipe Redis - clears stuck reservations, bot state, matchmaking queues
./wipe-redis.sh          # prompts; add -y to skip confirmation

# Safe Restart - handles persistent volumes correctly
./restart-safe.sh
```

### 4. Rebuild & Redeploy

```bash
./rebuild.sh              # Build images and restart services

# Confirm pods are ready
kubectl get pods -n codeclashers-dev
```

### 5. Post-Reset Verification

```bash
# Health checks
curl http://localhost:2567/health        # Colyseus
curl http://localhost:2358/              # Judge0
redis-cli -p 6379 -a <password> ping     # Redis

# Watch logs while testing
./logs.sh colyseus --tail=200
./logs.sh bots --tail=200
```

---

## Production Debugging

### Access Methods

**SSH to Oracle Cloud VM:**
```bash
# Get VM IP from credentials/oracle_info
ssh -i ~/.ssh/oci.pem ubuntu@<VM_IP>

# Set permissions if needed
chmod 600 ~/.ssh/oci.pem
```

**AWS CLI Access (for Lambda logs):**
```bash
# From VM - export credentials from Kubernetes secrets
export AWS_ACCESS_KEY_ID=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_ACCESS_KEY_ID}' | base64 -d)
export AWS_SECRET_ACCESS_KEY=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.AWS_SECRET_ACCESS_KEY}' | base64 -d)
export AWS_DEFAULT_REGION=us-east-1

# Verify access
aws sts get-caller-identity
```

### Check Pod Status

```bash
# Get all pods
sudo k3s kubectl get pods -n codeclashers

# Get specific pod name
COLYSEUS_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=colyseus -o jsonpath='{.items[0].metadata.name}')

# View logs
sudo k3s kubectl logs -n codeclashers -l app=colyseus --tail=100 -f

# Describe pod
sudo k3s kubectl describe pod $COLYSEUS_POD -n codeclashers
```

### Check Services

```bash
# List all services
sudo k3s kubectl get svc -n codeclashers

# Get internal secret
INTERNAL_SECRET=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.INTERNAL_SERVICE_SECRET}' | base64 -d)

# Test endpoint directly
curl -X POST http://localhost:2567/admin/bots/generate \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{"count":1}'
```

### View Lambda Logs

```bash
LAMBDA_NAME='FrontendStack-NextJsLambda7B47D540-<ID>'

# View recent logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/$LAMBDA_NAME \
  --start-time $(date -u -d '10 minutes ago' +%s)000 \
  --query 'events[*].message' \
  --output text | tail -100

# Filter for specific errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/$LAMBDA_NAME \
  --start-time $(date -u -d '5 minutes ago' +%s)000 \
  --query 'events[*].message' \
  --output text | grep -E 'error|Error|ERROR'
```

### Restart Services

```bash
# Restart deployment
sudo k3s kubectl rollout restart deployment colyseus -n codeclashers
sudo k3s kubectl rollout status deployment colyseus -n codeclashers --timeout=60s

# Force delete pod (if stuck)
sudo k3s kubectl delete pod $COLYSEUS_POD -n codeclashers --force --grace-period=0
```

---

## Common Issues

### Bot Generation Failures

**Problem:** "Failed to generate bot profile" toast

**Causes:**
- Network connectivity from Lambda to Colyseus
- Missing/incorrect `INTERNAL_SERVICE_SECRET`
- API URL missing port (`:2567`)

**Debug:**
```bash
# Check Colyseus logs for auth errors
sudo k3s kubectl logs -n codeclashers -l app=colyseus --tail=50 | grep -E 'adminAuth|internal|secret|401'

# Test endpoint with secret
INTERNAL_SECRET=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.INTERNAL_SERVICE_SECRET}' | base64 -d)
curl -v http://localhost:2567/admin/bots/generate \
  -X POST \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{"count":1}'

# Check Lambda env vars
aws lambda get-function-configuration \
  --function-name $LAMBDA_NAME \
  --query 'Environment.Variables.NEXT_PUBLIC_COLYSEUS_HTTP_URL' \
  --output text
```

### Redis Connection Issues

**Problem:** "Stream isn't writeable" or "Connection is closed"

**Debug:**
```bash
# Check Redis pod
sudo k3s kubectl get pods -n codeclashers -l app=redis-single

# Test connectivity from Colyseus
sudo k3s kubectl exec -n codeclashers $COLYSEUS_POD -- nc -zv redis-single 6379

# Check Redis logs
sudo k3s kubectl logs -n codeclashers -l app=redis-single --tail=50
```

**Fixes:**
- Verify `REDIS_CLUSTER_ENABLED=false` in Lambda env
- Check service type is `LoadBalancer` with correct external IP
- Ensure port 6379/6380 is accessible

### MongoDB Data Persistence

**Problem:** Users have to recreate accounts after restart

**Debug:**
```bash
# Check PVCs exist and are bound
sudo k3s kubectl get pvc -n codeclashers | grep mongodb

# Check storage location is persistent (NOT tmpfs)
df -T /var/lib/rancher/k3s/storage/

# Verify data exists
MONGODB_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=mongodb -o jsonpath='{.items[0].metadata.name}')
sudo k3s kubectl exec -n codeclashers $MONGODB_POD -- ls -la /data/db/ | head -20

# Check user count
sudo k3s kubectl exec -n codeclashers $MONGODB_POD -- mongosh mongodb://localhost:27017/codeclashers --quiet --eval 'db.users.countDocuments({})'
```

**Prevention:**
- Never delete StatefulSet - use `kubectl apply`
- Ensure PVC retention policy is set to `Retain`
- Regular backups

### Authentication Errors (401)

**Problem:** Frontend gets 401 on protected endpoints

**Debug:**
```bash
# Verify internal secret matches
# In Kubernetes:
sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.INTERNAL_SERVICE_SECRET}' | base64 -d

# In Lambda:
aws lambda get-function-configuration \
  --function-name $LAMBDA_NAME \
  --query 'Environment.Variables.INTERNAL_SERVICE_SECRET' \
  --output text

# Check Colyseus pod has the env var
sudo k3s kubectl exec -n codeclashers $COLYSEUS_POD -- env | grep INTERNAL_SERVICE_SECRET
```

### Server-Side Errors on /play Page

**Debug:**
```bash
# Check Lambda logs for error
aws logs filter-log-events \
  --log-group-name /aws/lambda/$LAMBDA_NAME \
  --start-time $(date -u -d '10 minutes ago' +%s)000 \
  --query 'events[*].message' \
  --output text | tail -100

# Check MongoDB connectivity
sudo k3s kubectl get pods -n codeclashers -l app=mongodb

# Check Redis operations
# Look for "Redis unavailable" or timeout messages
```

---

## Quick Reference

### Local Development Commands

```bash
# View logs
./logs.sh colyseus

# Restart services
./restart-safe.sh

# Rebuild after code changes
./rebuild.sh

# Wipe Redis state
./wipe-redis.sh

# Check ports
./check-ports.sh
```

### Production Commands

```bash
# SSH to VM
ssh -i ~/.ssh/oci.pem ubuntu@<VM_IP>

# Get pod name
COLYSEUS_POD=$(sudo k3s kubectl get pods -n codeclashers -l app=colyseus -o jsonpath='{.items[0].metadata.name}')

# View logs
sudo k3s kubectl logs -n codeclashers -l app=colyseus --tail=100 -f

# Get internal secret
INTERNAL_SECRET=$(sudo k3s kubectl get secret app-secrets -n codeclashers -o jsonpath='{.data.INTERNAL_SERVICE_SECRET}' | base64 -d)

# Test endpoint
curl -X POST http://localhost:2567/admin/bots/generate \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"count":1}'

# Check all pods
sudo k3s kubectl get pods -n codeclashers

# Check all services
sudo k3s kubectl get svc -n codeclashers

# Restart deployment
sudo k3s kubectl rollout restart deployment colyseus -n codeclashers
```

### CI/CD Commands

```bash
# View recent workflow runs
gh run list --limit 10

# Watch a specific run
gh run watch <RUN_ID>

# Trigger workflow manually
gh workflow run deploy-backend.yml
```

---

## Related Documentation

- `local-development.md` - Full local dev setup guide
- `deployment.md` - Production deployment procedures
- `matchmaking-flow.md` - Queue and matchmaking details
- `bot-lifecycle.md` - Bot service operation
- `judge0-runbook.md` - Code execution troubleshooting
- `redis-cleanup.md` - Redis key cleanup

