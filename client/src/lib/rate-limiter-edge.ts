'use server';

// Runtime is Node.js by default in Lambda deployment
// Removed runtime export - Next.js 15 doesn't allow non-function exports in "use server" files

import { headers } from 'next/headers';

/**
 * Get client identifier from headers only
 * Edge-safe header operation
 */
export async function getClientIdentifierFromHeaders(): Promise<string | null> {
  try {
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
    
    return null;
  } catch (error) {
    console.error('Error getting client identifier from headers:', error);
    return null;
  }
}

// Rate limiter configuration constants (no Redis dependency)
export const RATE_LIMITER_CONFIG = {
  general: {
    points: 10,
    duration: 10,
    blockDuration: 60,
  },
  auth: {
    points: 5,
    duration: 60,
    blockDuration: 300,
  },
  queue: {
    points: 20,
    duration: 10,
    blockDuration: 30,
  },
  admin: {
    points: 30,
    duration: 60,
    blockDuration: 300,
  },
  upload: {
    points: 2,
    duration: 60,
    blockDuration: 120,
  },
} as const;



