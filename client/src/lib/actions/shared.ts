'use server';

import { assertAdminSession } from '../session';
import { ADMIN_GUARD_ERROR } from './constants';

/**
 * Get session cookie header for server-side fetch requests
 * Server actions can't use credentials: 'include', so we manually add the cookie
 */
export async function getSessionCookieHeader(): Promise<string> {
  const { getSessionCookie } = await import('../session-edge');
  const sessionId = await getSessionCookie();
  return sessionId ? `codeclashers.sid=${sessionId}` : '';
}

export async function ensureAdminAccess(): Promise<string | null> {
  try {
    await assertAdminSession();
    return null;
  } catch (error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return ADMIN_GUARD_ERROR;
  }
}

