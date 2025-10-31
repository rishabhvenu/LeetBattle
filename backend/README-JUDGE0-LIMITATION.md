# Judge0 ARM64 Limitation

## Problem

Judge0 cannot run on ARM64 architecture due to its dependency on AMD64-only compiler images (`judge0/compilers:1.4.0`). The base image uses Debian Buster repositories which are EOL (End of Life) and not available for ARM64.

### Build Failures

When attempting to build Judge0 for ARM64:
1. The base image `judge0/compilers:1.4.0` is AMD64-only
2. Debian Buster repositories (used by the base image) are EOL and return 404 errors
3. QEMU emulation doesn't work reliably for complex multi-stage builds

## Current Status

✅ **Deployment Success**: All other services are running successfully on ARM64:
- MongoDB (StatefulSet)
- Redis (StatefulSet)
- PostgreSQL (Deployment)
- Colyseus (Deployment)
- Bots (Deployment)

❌ **Judge0 Status**: Not deployed (replicas set to 0 or failing)

## Impact

**Code execution is not functional** - users cannot submit or test code in matches.

## Recommended Solutions

### Option 1: Use AMD64 Oracle VM (Recommended)

**Pros:**
- Judge0 works out of the box
- All services run natively without emulation
- Best performance
- Zero compatibility issues

**Cons:**
- Need to migrate from current ARM64 VM

**Steps:**
1. Provision a new AMD64 Oracle Cloud VM instance
2. Set up GitHub Actions runner on the new VM
3. Redeploy all services

### Option 2: Disable Judge0 Feature

**Pros:**
- Keep current ARM64 infrastructure
- All other features work

**Cons:**
- Code submission and testing disabled
- Core functionality broken

**Steps:**
1. Keep Judge0 replicas at 0 in deployments
2. Document feature limitation to users

### Option 3: Use External Judge0 Service

**Pros:**
- Keep ARM64 infrastructure
- Can use managed Judge0 service

**Cons:**
- Additional cost
- External dependency
- Requires network configuration

**Steps:**
1. Set up Judge0 on a separate AMD64 instance/cloud service
2. Update `JUDGE0_URL` environment variable in Colyseus deployment
3. Configure network access between services

## Temporary Workaround

While deciding on a solution, you can keep the current deployment running with:

```bash
# Scale Judge0 down to 0
kubectl scale deployment judge0-server -n codeclashers --replicas=0
kubectl scale deployment judge0-worker -n codeclashers --replicas=0
```

This allows other services to function normally.

## Next Steps

1. Decide on one of the solutions above
2. If choosing Option 1, I can help with the migration
3. If choosing Option 2, we should add user-facing messaging about the limitation
4. If choosing Option 3, we need to set up and configure the external service

## References

- Judge0 Repository: https://github.com/judge0/api
- Judge0 Base Image: https://hub.docker.com/r/judge0/judge0
- Issue Discussion: (link to your issue or discussion)

