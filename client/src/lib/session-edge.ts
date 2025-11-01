'use server';

import { cookies } from 'next/headers';

export async function getSessionCookieName(): Promise<string> {
  return 'codeclashers.sid';
}

/**
 * Get session cookie value
 * Edge-safe cookie operation
 */
export async function getSessionCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const cookieName = await getSessionCookieName();
    const sessionCookie = cookieStore.get(cookieName);
    return sessionCookie?.value || null;
  } catch (error) {
    console.error('Error getting session cookie:', error);
    return null;
  }
}

/**
 * Set session cookie
 * Edge-safe cookie operation
 */
export async function setSessionCookie(
  sessionId: string,
  options?: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    maxAge?: number;
    path?: string;
  }
): Promise<void> {
  try {
    const cookieStore = await cookies();
    const cookieName = await getSessionCookieName();
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    cookieStore.set(cookieName, sessionId, {
      httpOnly: options?.httpOnly ?? true,
      secure: options?.secure ?? isProduction,
      sameSite: options?.sameSite ?? 'lax',
      maxAge: options?.maxAge ?? 24 * 60 * 60, // 24 hours
      path: options?.path ?? '/',
    });
  } catch (error) {
    console.error('Error setting session cookie:', error);
    throw error;
  }
}

/**
 * Delete session cookie
 * Edge-safe cookie operation
 */
export async function deleteSessionCookie(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const cookieName = await getSessionCookieName();
    cookieStore.delete(cookieName);
  } catch (error) {
    console.error('Error deleting session cookie:', error);
  }
}



