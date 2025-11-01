'use server';

import {
  getSessionCookie,
  setSessionCookie,
  deleteSessionCookie,
  getSessionCookieName,
} from './session-edge';
import {
  getSessionFromDB,
  createSessionInDB,
  deleteSessionFromDB,
  isAdminUser,
  type SessionData,
} from './session-db';

// Re-export cookie name function
export { getSessionCookieName };

/**
 * Get session - Edge runtime orchestrator
 * Reads cookie (Edge) then queries DB (Node)
 */
export async function getSession(): Promise<SessionData> {
  try {
    const sessionId = await getSessionCookie();

    if (!sessionId) {
      return { authenticated: false };
    }

    return await getSessionFromDB(sessionId);
  } catch (error) {
    console.error('Session lookup failed:', error);
    return { authenticated: false };
  }
}

/**
 * Create session - Edge runtime orchestrator
 * Creates in DB (Node) then sets cookie (Edge)
 */
export async function createSession(userId: string, email: string, username: string): Promise<void> {
  try {
    const { sessionId } = await createSessionInDB(userId, email, username);
    await setSessionCookie(sessionId);
  } catch (error) {
    console.error('Session creation error:', error);
    throw error;
  }
}

/**
 * Delete session - Edge runtime orchestrator
 * Deletes cookie (Edge) then deletes from DB (Node)
 */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await deleteSessionCookie();
    await deleteSessionFromDB(sessionId);
  } catch (error) {
    console.error('Session deletion error:', error);
    // Continue even if DB deletion fails - cookie is already deleted
  }
}

/**
 * Assert admin session - Edge runtime orchestrator
 */
export async function assertAdminSession(): Promise<SessionData> {
  const session = await getSession();

  if (!session.authenticated || !session.userId) {
    throw new Error('Authentication required');
  }

  const adminStatus = await isAdminUser(session.userId, session.user?.email);
  if (!adminStatus) {
    throw new Error('Admin privileges required');
  }

  return session;
}
