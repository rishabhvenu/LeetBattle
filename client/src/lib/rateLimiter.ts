'use server';

// Runtime is Node.js by default in Lambda deployment
// Removed runtime export - Next.js 15 doesn't allow non-function exports in "use server" files

// Re-export Node runtime functions
export {
  generalLimiter,
  authLimiter,
  queueLimiter,
  adminLimiter,
  uploadLimiter,
  rateLimit,
  checkRateLimit,
} from './rate-limiter-redis';

import { getClientIdentifierFromHeaders } from './rate-limiter-edge';
import { getSession } from './session';

/**
 * Get a unique identifier for the current request
 * Edge runtime orchestrator - tries headers first, falls back to session
 */
export async function getClientIdentifier(): Promise<string> {
  try {
    // Try headers first (Edge-compatible)
    const ipFromHeaders = await getClientIdentifierFromHeaders();
    if (ipFromHeaders) {
      return ipFromHeaders;
    }
    
    // Fallback: try to get session-based identifier (calls Node via session.ts)
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
