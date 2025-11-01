'use server';

export const runtime = 'nodejs';

import { RateLimiterRedis } from 'rate-limiter-flexible';
import { getRedis } from './redis';
import { RATE_LIMITER_CONFIG } from './rate-limiter-edge';

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

// Stricter limiter for authentication endpoints (5 attempts per minute)
export const authLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:auth',
  points: RATE_LIMITER_CONFIG.auth.points,
  duration: RATE_LIMITER_CONFIG.auth.duration,
  blockDuration: RATE_LIMITER_CONFIG.auth.blockDuration,
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



