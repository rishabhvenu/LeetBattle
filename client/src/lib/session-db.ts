'use server';

import { ObjectId } from 'mongodb';
import connectDB, { getMongoClient } from './mongodb';

const DB_NAME = process.env.DB_NAME || 'codeclashers';
const USERS_COLLECTION = 'users';
const SESSIONS_COLLECTION = 'sessions';

const DEFAULT_ADMIN_EMAIL = 'rishiryan4@gmail.com';

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  avatar?: string | null;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  role?: string;
  isAdmin?: boolean;
}

export interface SessionData {
  userId?: string;
  user?: SessionUser;
  authenticated: boolean;
}

interface SessionDocument {
  _id: string;
  userId?: ObjectId | string;
  user?: SessionUser;
  expires: Date;
  createdAt: Date;
}

interface DbUser {
  _id: ObjectId;
  email: string;
  username: string;
  profile?: {
    firstName?: string;
    lastName?: string;
    avatar?: string | null;
  };
  avatarUrl?: string | null;
  roles?: string[];
  role?: string;
  isAdmin?: boolean;
}

function parseAdminAllowList(): Set<string> {
  const envValue = process.env.ADMIN_EMAILS || DEFAULT_ADMIN_EMAIL;
  return new Set(
    envValue
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Get session data from MongoDB by sessionId
 * Node runtime - MongoDB operations
 */
export async function getSessionFromDB(sessionId: string): Promise<SessionData> {
  try {
    if (!sessionId) {
      return { authenticated: false };
    }

    await connectDB();
    const client = await getMongoClient();

    const db = client.db(DB_NAME);
    const sessions = db.collection<SessionDocument>(SESSIONS_COLLECTION);

    const session = await sessions.findOne({
      _id: sessionId,
      expires: { $gt: new Date() },
    });

    if (session && session.userId) {
      // Convert userId to string - handle ObjectId properly
      // Check for ObjectId structure explicitly (has 'head' and 'pos' properties)
      let normalizedUserId: string;
      if (typeof session.userId === 'string') {
        normalizedUserId = session.userId;
      } else if (session.userId && typeof session.userId === 'object') {
        // Check for ObjectId structure
        const obj = session.userId as Record<string, unknown>;
        if ('head' in obj && 'pos' in obj) {
          // It's an ObjectId - convert to string using toString()
          const objId = session.userId as { toString?: () => string };
          if (objId.toString && typeof objId.toString === 'function') {
            try {
              const converted = objId.toString();
              normalizedUserId = typeof converted === 'string' ? converted : String(session.userId);
            } catch {
              normalizedUserId = String(session.userId);
            }
          } else {
            normalizedUserId = String(session.userId);
          }
        } else {
          // Not an ObjectId, but still an object - try to convert
          normalizedUserId = String(session.userId);
        }
      } else {
        normalizedUserId = String(session.userId);
      }

      if (!normalizedUserId) {
        return { authenticated: false };
      }

      // Helper to convert ObjectId to string
      const convertObjectIdToString = (val: unknown, fallback: string = ''): string => {
        if (val === null || val === undefined) return fallback;
        if (typeof val === 'string') return val;
        if (typeof val === 'object' && val !== null) {
          const obj = val as Record<string, unknown>;
          // Check for ObjectId structure
          if ('head' in obj && 'pos' in obj) {
            const objId = val as { toString?: () => string };
            if (objId.toString && typeof objId.toString === 'function') {
              try {
                const converted = objId.toString();
                return typeof converted === 'string' ? converted : fallback;
              } catch {
                return fallback;
              }
            }
            return fallback;
          }
        }
        return String(val || fallback);
      };

      // Ensure user object has all string fields - convert any ObjectIds
      // This is critical for React Server Components which serialize props
      // Explicitly convert each field to prevent ObjectIds from getting through
      const user = session.user ? {
        id: convertObjectIdToString(session.user.id, normalizedUserId),
        email: convertObjectIdToString(session.user.email || '', ''),
        username: convertObjectIdToString(session.user.username || '', ''),
        avatar: (() => {
          const rawAvatar = session.user!.avatar;
          if (rawAvatar === null || rawAvatar === undefined) return null;
          if (typeof rawAvatar === 'string') return rawAvatar;
          if (typeof rawAvatar === 'object') {
            // ObjectIds are not valid for avatar URLs
            return null;
          }
          return null;
        })(),
        firstName: session.user.firstName ? convertObjectIdToString(session.user.firstName, '') : undefined,
        lastName: session.user.lastName ? convertObjectIdToString(session.user.lastName, '') : undefined,
        roles: session.user.roles ? (Array.isArray(session.user.roles) ? session.user.roles.map(r => convertObjectIdToString(r, '')) : []) : undefined,
        role: session.user.role ? convertObjectIdToString(session.user.role, '') : undefined,
        isAdmin: session.user.isAdmin,
      } : undefined;

      // Final step: Use JSON serialization to ensure ALL ObjectIds are converted to strings
      // This is critical for React Server Components which serialize props
      // Even if we've converted above, this ensures nothing slips through
      try {
        const replacer = (key: string, value: unknown) => {
          if (value === null || value === undefined) return value;
          if (typeof value === 'object' && value !== null) {
            const obj = value as Record<string, unknown>;
            // Check for ObjectId structure
            if ('head' in obj && 'pos' in obj) {
              // It's an ObjectId - convert to string
              const objId = value as { toString?: () => string };
              if (objId.toString && typeof objId.toString === 'function') {
                try {
                  return objId.toString();
                } catch {
                  return '';
                }
              }
              return '';
            }
          }
          return value;
        };

        // Serialize and parse to force ObjectId conversion
        const serialized = JSON.stringify({
          authenticated: true,
          userId: normalizedUserId,
          user,
        }, replacer);

        const parsed = JSON.parse(serialized) as SessionData;

        // Verify userId is a string after parsing
        if (parsed.userId && typeof parsed.userId !== 'string') {
          parsed.userId = String(parsed.userId || '');
        }

        // Verify user fields are strings
        if (parsed.user) {
          if (parsed.user.id && typeof parsed.user.id !== 'string') {
            parsed.user.id = String(parsed.user.id || '');
          }
          if (parsed.user.username && typeof parsed.user.username !== 'string') {
            parsed.user.username = String(parsed.user.username || '');
          }
          if (parsed.user.email && typeof parsed.user.email !== 'string') {
            parsed.user.email = String(parsed.user.email || '');
          }
          // Avatar should be string or null
          if (parsed.user.avatar !== null && typeof parsed.user.avatar !== 'string') {
            parsed.user.avatar = null;
          }
        }

        return parsed;
      } catch (error) {
        console.error('Error serializing session data in getSessionFromDB:', error);
        // If serialization fails, return the converted values directly
        // (they should already be strings, but just in case)
        return {
          authenticated: true,
          userId: normalizedUserId,
          user,
        };
      }
    }

    return { authenticated: false };
  } catch (error) {
    console.error('Session lookup failed:', error);
    return { authenticated: false };
  }
}

/**
 * Create session in MongoDB
 * Node runtime - MongoDB operations
 */
export async function createSessionInDB(
  userId: string,
  email: string,
  username: string
): Promise<{ sessionId: string; sessionData: SessionData }> {
  try {
    const sessionId = crypto.randomUUID();

    await connectDB();
    const client = await getMongoClient();

    const db = client.db(DB_NAME);
    const users = db.collection<DbUser>(USERS_COLLECTION);
    const sessions = db.collection<SessionDocument>(SESSIONS_COLLECTION);

    const user = await users.findOne({ _id: new ObjectId(userId) });

    const userAvatar = user?.profile?.avatar || user?.avatarUrl || null;
    const isAdmin =
      Boolean(user?.isAdmin) ||
      user?.role === 'admin' ||
      (Array.isArray(user?.roles) && user?.roles.includes('admin')) ||
      (user?.email ? parseAdminAllowList().has(user.email.toLowerCase()) : false);

    const sessionData: SessionDocument = {
      _id: sessionId,
      // Store userId as a string, not ObjectId, to prevent React Server Components serialization issues
      userId: userId,
      user: {
        id: userId,
        email,
        username,
        avatar: userAvatar,
        firstName: user?.profile?.firstName || '',
        lastName: user?.profile?.lastName || '',
        roles: user?.roles || [],
        role: user?.role,
        isAdmin,
      } satisfies SessionUser,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    await sessions.insertOne(sessionData);

    return {
      sessionId,
      sessionData: {
        authenticated: true,
        userId,
        user: sessionData.user,
      },
    };
  } catch (error) {
    console.error('Session creation error:', error);
    throw error;
  }
}

/**
 * Delete session from MongoDB
 * Node runtime - MongoDB operations
 */
export async function deleteSessionFromDB(sessionId: string): Promise<void> {
  await connectDB();
  const client = await getMongoClient();
  const db = client.db(DB_NAME);
  const sessions = db.collection<SessionDocument>(SESSIONS_COLLECTION);
  await sessions.deleteOne({ _id: sessionId });
}

/**
 * Check if user is admin
 * Node runtime - MongoDB operations
 */
export async function isAdminUser(userId: string, fallbackEmail?: string): Promise<boolean> {
  const allowList = parseAdminAllowList();

  if (fallbackEmail && allowList.has(fallbackEmail.toLowerCase())) {
    return true;
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    const user = await users.findOne(
      { _id: new ObjectId(userId) },
      { projection: { isAdmin: 1, role: 1, roles: 1, email: 1 } }
    );

    if (!user) {
      return false;
    }

    if (user.isAdmin || user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))) {
      return true;
    }

    if (user.email && allowList.has(user.email.toLowerCase())) {
      return true;
    }
  } catch (error) {
    console.error('Admin check failed:', error);
    return false;
  }

  return false;
}



