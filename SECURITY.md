# Security & Production Issues

This document tracks security concerns and production deployment issues that need to be addressed before going live.

## 🔴 Critical Issues

### 1. Environment Variables Management ✅ FIXED

**Status:** ✅ **Resolved**

**Issue:** Real credentials were committed to git in `.env` files.

**Fix Applied:**
- Removed `.env` and `.env.local` from git tracking
- Created `.env.example` and `.env.local.example` templates
- Updated `.gitignore` to prevent future commits
- Updated MinIO init script to use environment variables

**Action Required:**
- ⚠️ **Rotate all credentials before production deployment**
- Generate strong random passwords for:
  - `MINIO_ROOT_PASSWORD`
  - `REDIS_PASSWORD`
  - `JUDGE0_POSTGRES_PASSWORD`
  - `NEXTAUTH_SECRET` (use `openssl rand -base64 32`)

---

### 2. Queue Worker Architecture ⚠️ NEEDS REFACTORING

**Status:** 🟡 **Documented, needs architectural change**

**Issue:** `ensureQueueWorker` runs `setInterval` inside a Next.js server action.

**Problems:**
- In serverless environments (Vercel, Netlify), intervals don't persist between invocations
- Can leak timers across requests
- Not guaranteed to run in production
- Single point of failure

**Current Location:** `client/src/lib/queueWorker.ts`

**Recommended Solutions:**

#### Option A: Separate Worker Service (Recommended)
```bash
# Create dedicated worker service
backend/queue-worker/
├── src/
│   ├── index.ts          # Main worker process
│   ├── matchmaker.ts     # Matching logic
│   └── redis.ts          # Redis client
├── Dockerfile
└── package.json
```

Add to `docker-compose.yml`:
```yaml
queue-worker:
  build: ./queue-worker
  environment:
    REDIS_HOST: redis
    REDIS_PASSWORD: ${REDIS_PASSWORD}
  depends_on:
    - redis
  restart: unless-stopped
```

#### Option B: Use Bull/BullMQ
```typescript
// Install: npm install bullmq
import { Queue, Worker } from 'bullmq';

const matchmakingQueue = new Queue('matchmaking', {
  connection: { host: 'redis', port: 6379 }
});

// Schedule recurring job
await matchmakingQueue.add('pair-players', {}, {
  repeat: { every: 2000 } // Every 2 seconds
});

// Worker process
new Worker('matchmaking', async (job) => {
  await pairPlayersFromQueue();
});
```

#### Option C: Cron Job (Simple)
```bash
# Add to cron or use node-cron
*/1 * * * * curl http://localhost:3000/api/matchmaking/tick
```

**Temporary Workaround:**
Current implementation works for:
- ✅ Development (local Next.js server)
- ✅ Self-hosted deployments (dedicated server)
- ❌ Serverless platforms (Vercel, Netlify, AWS Lambda)

---

### 3. CORS Configuration ✅ IMPROVED

**Status:** ✅ **Improved, needs production adjustment**

**Issue:** MinIO CORS was set to `AllowedOrigins: ["*"]` (open to all origins).

**Fix Applied:**
Updated `backend/minio-init/init.sh`:
```json
{
  "AllowedOrigins": ["http://localhost:3000", "http://localhost:3001"],
  "AllowedMethods": ["GET", "PUT", "POST", "HEAD"]
}
```

**Action Required Before Production:**
Update CORS origins to match your production domain:
```json
{
  "AllowedOrigins": [
    "https://yourapp.com",
    "https://www.yourapp.com"
  ]
}
```

---

### 4. Match Persistence Schema ✅ FIXED

**Status:** ✅ **Resolved**

**Issue:** Schema mismatch between Colyseus state and `persistMatchFromState` function caused silent failures.

**Fix Applied:**
- Enhanced `persistMatchFromState` to handle multiple data formats
- Added validation for player IDs and submissions
- Improved error handling with try-catch blocks
- Added warning logs for data inconsistencies

---

### 5. Server Action in Client Component ✅ FIXED

**Status:** ✅ **Resolved**

**Issue:** Match page imported `getSession` server action in client component.

**Fix Applied:**
- Converted `/match` page to server component
- Session now fetched on server before rendering
- Removed client-side useEffect workaround

---

## 🟡 Medium Priority Issues

### 6. Rate Limiting

**Status:** ❌ **Not Implemented**

**Risk:** API abuse, DoS attacks

**Recommendation:**
```typescript
// Install: npm install express-rate-limit
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

---

### 7. Input Validation

**Status:** ⚠️ **Partial**

**Missing:**
- Code submission size limits
- Username/email validation
- Problem ID validation

**Recommendation:**
```typescript
// Install: npm install zod
import { z } from 'zod';

const codeSubmissionSchema = z.object({
  code: z.string().max(50000), // 50KB limit
  language: z.string(),
  problemId: z.string().regex(/^[0-9a-fA-F]{24}$/)
});
```

---

### 8. Logging & Monitoring

**Status:** ❌ **Console.log only**

**Recommendation:**
- Add structured logging (Winston, Pino)
- Set up error tracking (Sentry, Rollbar)
- Add performance monitoring (New Relic, Datadog)

---

## 🟢 Best Practices to Implement

### Authentication
- [ ] Add password strength requirements
- [ ] Implement email verification
- [ ] Add 2FA support
- [ ] Session timeout configuration
- [ ] CSRF protection

### Database
- [ ] Add database connection pooling limits
- [ ] Implement query timeouts
- [ ] Add indexes for common queries
- [ ] Set up automated backups

### Infrastructure
- [ ] Use Docker secrets instead of environment variables
- [ ] Set up SSL/TLS certificates
- [ ] Configure firewall rules
- [ ] Enable Docker security scanning
- [ ] Implement health check endpoints

### Monitoring
- [ ] Set up uptime monitoring
- [ ] Configure alerts for errors
- [ ] Track API response times
- [ ] Monitor database performance
- [ ] Log security events

---

## Pre-Production Checklist

Before deploying to production, ensure:

- [ ] All credentials rotated (not using default/dev passwords)
- [ ] Environment variables stored securely (not in code)
- [ ] CORS configured for production domains only
- [ ] Rate limiting enabled on all public endpoints
- [ ] Queue worker moved to dedicated service or job queue
- [ ] Error tracking and monitoring configured
- [ ] Database backups automated
- [ ] SSL/TLS certificates installed
- [ ] Security headers configured
- [ ] Dependencies updated and audited (`npm audit`)
- [ ] Load testing completed
- [ ] Disaster recovery plan documented

---

## Reporting Security Issues

If you discover a security vulnerability, please email **[your-email@example.com]** instead of creating a public issue.

---

**Last Updated:** 2025-10-12

