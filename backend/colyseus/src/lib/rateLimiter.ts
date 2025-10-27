import { RateLimiterRedis } from 'rate-limiter-flexible';
import { getRedis } from './redis';
import type { Context, Next } from 'koa';

// Create different rate limiters for different types of operations
const redis = getRedis();

// General rate limiter for most API endpoints (30 requests per 10 seconds per IP)
export const generalLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:colyseus:general',
  points: 30, // Number of requests
  duration: 10, // Per 10 seconds
  blockDuration: 60, // Block for 60 seconds if exceeded
});

// Queue operations limiter (100 requests per 10 seconds - increased for testing)
export const queueLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:colyseus:queue',
  points: 100,
  duration: 10,
  blockDuration: 30,
});

// Match data endpoints limiter (50 requests per 10 seconds - higher for active matches)
export const matchLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:colyseus:match',
  points: 50,
  duration: 10,
  blockDuration: 20,
});

// Admin operations limiter (stricter - 5 per minute)
export const adminLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:colyseus:admin',
  points: 5,
  duration: 60,
  blockDuration: 300,
});

/**
 * Get client identifier from Koa context
 * Tries various headers to get the real IP address
 */
function getClientIdentifier(ctx: Context): string {
  // Try to get real IP from various headers (considering proxies/load balancers)
  const forwardedFor = ctx.get('x-forwarded-for');
  const realIp = ctx.get('x-real-ip');
  const cfConnectingIp = ctx.get('cf-connecting-ip'); // Cloudflare
  
  if (forwardedFor) {
    // x-forwarded-for can be a comma-separated list, take the first one
    return forwardedFor.split(',')[0].trim();
  }
  
  if (realIp) {
    return realIp;
  }
  
  if (cfConnectingIp) {
    return cfConnectingIp;
  }
  
  // Fallback to Koa's IP detection
  return ctx.ip;
}

/**
 * Koa middleware factory for rate limiting
 * Usage:
 * router.post('/queue/enqueue', rateLimitMiddleware(queueLimiter), async (ctx) => { ... });
 */
export function rateLimitMiddleware(limiter: RateLimiterRedis) {
  return async (ctx: Context, next: Next) => {
    const identifier = getClientIdentifier(ctx);
    
    try {
      const rateLimitResponse = await limiter.consume(identifier, 1);
      
      // Add rate limit headers to response
      ctx.set('X-RateLimit-Limit', limiter.points.toString());
      ctx.set('X-RateLimit-Remaining', rateLimitResponse.remainingPoints.toString());
      ctx.set('X-RateLimit-Reset', new Date(Date.now() + rateLimitResponse.msBeforeNext).toISOString());
      
      await next();
    } catch (rejRes: unknown) {
      const rejectRes = rejRes as { msBeforeNext?: number; remainingPoints?: number };
      const msBeforeNext = rejectRes.msBeforeNext || 60000;
      const retryAfterSeconds = Math.ceil(msBeforeNext / 1000);
      
      // Set rate limit headers
      ctx.set('X-RateLimit-Limit', limiter.points.toString());
      ctx.set('X-RateLimit-Remaining', '0');
      ctx.set('X-RateLimit-Reset', new Date(Date.now() + msBeforeNext).toISOString());
      ctx.set('Retry-After', retryAfterSeconds.toString());
      
      ctx.status = 429;
      ctx.body = {
        error: 'rate_limit_exceeded',
        message: `Too many requests. Please try again in ${retryAfterSeconds} seconds.`,
        retryAfter: retryAfterSeconds,
      };
    }
  };
}

/**
 * Global rate limiter middleware - apply to all routes
 */
export const globalRateLimitMiddleware = rateLimitMiddleware(generalLimiter);

