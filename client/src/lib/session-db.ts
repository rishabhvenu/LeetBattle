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
      const normalizedUserId =
        typeof session.userId === 'string'
          ? session.userId
          : session.userId?.toString();

      if (!normalizedUserId) {
        return { authenticated: false };
      }

      return {
        authenticated: true,
        userId: normalizedUserId,
        user: session.user,
      };
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
      userId: new ObjectId(userId),
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



