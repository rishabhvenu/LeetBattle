import { RateLimiterRedis } from 'rate-limiter-flexible';
import { getRedis } from './redis';
import { getSession } from './session';

// Create different rate limiters for different types of operations
const redis = getRedis();

// General rate limiter for most server actions (10 requests per 10 seconds per IP)
export const generalLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:general',
  points: 10, // Number of requests
  duration: 10, // Per 10 seconds
  blockDuration: 60, // Block for 60 seconds if exceeded
});

// Stricter limiter for authentication endpoints (5 attempts per minute)
export const authLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:auth',
  points: 5,
  duration: 60,
  blockDuration: 300, // Block for 5 minutes if exceeded
});

// Queue operations limiter (20 requests per 10 seconds)
export const queueLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:queue',
  points: 20,
  duration: 10,
  blockDuration: 30,
});

// Admin operations limiter (reasonable for admin interface - 30 per minute)
export const adminLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:admin',
  points: 30,
  duration: 60,
  blockDuration: 300,
});

// Upload operations limiter (2 per minute)
export const uploadLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:upload',
  points: 2,
  duration: 60,
  blockDuration: 120,
});

/**
 * Rate limit wrapper for server actions
 * Usage:
 * export async function myAction(formData: FormData) {
 *   const identifier = await getClientIdentifier();
 *   await rateLimit(generalLimiter, identifier);
 *   // ... rest of your code
 * }
 */
export async function rateLimit(
  limiter: RateLimiterRedis,
  identifier: string,
  customPoints?: number
): Promise<void> {
  try {
    await limiter.consume(identifier, customPoints || 1);
  } catch (rejRes: unknown) {
    const msBeforeNext = (rejRes as { msBeforeNext?: number })?.msBeforeNext || 60000;
    const retryAfterSeconds = Math.ceil(msBeforeNext / 1000);
    
    throw new Error(
      `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`
    );
  }
}

/**
 * Get a unique identifier for the current request
 * Uses IP address or a fallback to session/user ID
 */
export async function getClientIdentifier(): Promise<string> {
  try {
    // In Next.js 15+ with server actions, we can access headers
    const { headers } = await import('next/headers');
    const headersList = await headers();
    
    // Try to get real IP from various headers (considering proxies/load balancers)
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const cfConnectingIp = headersList.get('cf-connecting-ip'); // Cloudflare
    
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
    
    // Fallback: try to get session-based identifier
    const session = await getSession();
    if (session.userId) {
      return `user:${session.userId}`;
    }
    
    // Last resort fallback
    return 'unknown';
  } catch (error) {
    console.error('Error getting client identifier:', error);
    return 'unknown';
  }
}

/**
 * Helper to check remaining points without consuming
 */
export async function checkRateLimit(
  limiter: RateLimiterRedis,
  identifier: string
): Promise<{ remainingPoints: number; msBeforeNext: number }> {
  try {
    const res = await limiter.get(identifier);
    if (!res) {
      return { remainingPoints: limiter.points, msBeforeNext: 0 };
    }
    return {
      remainingPoints: res.remainingPoints,
      msBeforeNext: res.msBeforeNext,
    };
  } catch (error) {
    console.error('Error checking rate limit:', error);
    return { remainingPoints: 0, msBeforeNext: 60000 };
  }
}
