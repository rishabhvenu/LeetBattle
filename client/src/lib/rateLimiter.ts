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
    if (ipFromHeaders && ipFromHeaders !== 'unknown') {
      return ipFromHeaders;
    }
    
    // Fallback: try to get session-based identifier (calls Node via session.ts)
    const session = await getSession();
    if (session.userId) {
      return `user:${session.userId}`;
    }
    
    // Better fallback: use a combination of headers to create a unique identifier
    // This helps when IP headers are missing but we have other identifying info
    try {
      const { headers } = await import('next/headers');
      const headersList = await headers();
      const userAgent = headersList.get('user-agent') || '';
      const acceptLanguage = headersList.get('accept-language') || '';
      
      // Create a simple hash-like identifier from available headers
      // This is better than 'unknown' but still allows some rate limiting
      const combined = (userAgent + acceptLanguage).slice(0, 32);
      // Simple hash-like function (Edge-safe, no Buffer needed)
      let hash = 0;
      for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      const fallbackId = `fallback:${Math.abs(hash).toString(36).slice(0, 12)}`;
      return fallbackId;
    } catch {
      // Last resort: use timestamp-based identifier to avoid all users sharing 'unknown'
      return `temp:${Date.now().toString().slice(-8)}`;
    }
  } catch (error) {
    console.error('Error getting client identifier:', error);
    // Use timestamp-based fallback instead of 'unknown'
    return `temp:${Date.now().toString().slice(-8)}`;
  }
}
