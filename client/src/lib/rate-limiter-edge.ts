'use server';

import { headers } from 'next/headers';

/**
 * Get client identifier from headers only
 * Edge-safe header operation
 */
export async function getClientIdentifierFromHeaders(): Promise<string | null> {
  try {
    const headersList = await headers();
    
    // Try to get real IP from various headers (considering proxies/load balancers)
    // Order matters: Cloudflare first, then x-forwarded-for, then x-real-ip
    const cfConnectingIp = headersList.get('cf-connecting-ip'); // Cloudflare (most reliable)
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const xClientIp = headersList.get('x-client-ip'); // Some load balancers use this
    
    // Cloudflare IP (most reliable)
    if (cfConnectingIp) {
      return cfConnectingIp.trim();
    }
    
    // x-forwarded-for (can be a comma-separated list, take the first one)
    if (forwardedFor) {
      const firstIp = forwardedFor.split(',')[0].trim();
      // Validate it's a valid IP format
      if (firstIp && /^[\d.]+$/.test(firstIp.split(':')[0])) {
        return firstIp;
      }
    }
    
    // x-real-ip
    if (realIp) {
      const trimmed = realIp.trim();
      if (trimmed && /^[\d.]+$/.test(trimmed.split(':')[0])) {
        return trimmed;
      }
    }
    
    // x-client-ip (fallback)
    if (xClientIp) {
      const trimmed = xClientIp.trim();
      if (trimmed && /^[\d.]+$/.test(trimmed.split(':')[0])) {
        return trimmed;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting client identifier from headers:', error);
    return null;
  }
}



