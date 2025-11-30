import { RateLimiterRedis } from 'rate-limiter-flexible';
import { getRedis } from './redis';
import { RATE_LIMITER_CONFIG } from './rate-limiter-config';

// Create different rate limiters for different types of operations
const redis = getRedis();

// General rate limiter for most server actions (10 requests per 10 seconds per IP)
export const generalLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:general',
  points: RATE_LIMITER_CONFIG.general.points,
  duration: RATE_LIMITER_CONFIG.general.duration,
  blockDuration: RATE_LIMITER_CONFIG.general.blockDuration,
});

// Stricter limiter for authentication endpoints (10 attempts per minute)
// Configured to fail open if Redis is unavailable (doesn't block users)
export const authLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:auth',
  points: RATE_LIMITER_CONFIG.auth.points,
  duration: RATE_LIMITER_CONFIG.auth.duration,
  blockDuration: RATE_LIMITER_CONFIG.auth.blockDuration,
  // Fail open: if Redis is unavailable, allow requests instead of blocking
  execEvenly: false,
  execEvenlyMinDelayMs: 0,
});

// Queue operations limiter (20 requests per 10 seconds)
export const queueLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:queue',
  points: RATE_LIMITER_CONFIG.queue.points,
  duration: RATE_LIMITER_CONFIG.queue.duration,
  blockDuration: RATE_LIMITER_CONFIG.queue.blockDuration,
});

// Admin operations limiter (reasonable for admin interface - 30 per minute)
export const adminLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:admin',
  points: RATE_LIMITER_CONFIG.admin.points,
  duration: RATE_LIMITER_CONFIG.admin.duration,
  blockDuration: RATE_LIMITER_CONFIG.admin.blockDuration,
});

// Upload operations limiter (2 per minute)
export const uploadLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:upload',
  points: RATE_LIMITER_CONFIG.upload.points,
  duration: RATE_LIMITER_CONFIG.upload.duration,
  blockDuration: RATE_LIMITER_CONFIG.upload.blockDuration,
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
    // Add timeout wrapper to fail fast if Redis is hanging (5 second timeout)
    await Promise.race([
      limiter.consume(identifier, customPoints || 1),
      new Promise<void>((_, reject) => 
        setTimeout(() => reject(new Error('Rate limit check timeout')), 5000)
      ),
    ]);
  } catch (rejRes: unknown) {
    // Check if this is a timeout or Redis connection error (not a rate limit error)
    const error = rejRes as Error & { msBeforeNext?: number; remainingPoints?: number };
    
    // If it's a timeout or Redis connection error (no msBeforeNext property), fail open (allow the request)
    // This prevents Redis outages from blocking legitimate users
    if (!error.msBeforeNext && !error.remainingPoints) {
      console.warn('Redis connection error/timeout in rate limiter, allowing request:', error.message);
      return; // Fail open - allow the request
    }
    
    // This is a real rate limit error
    const msBeforeNext = error.msBeforeNext || 60000;
    const retryAfterSeconds = Math.ceil(msBeforeNext / 1000);
    
    throw new Error(
      `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`
    );
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



