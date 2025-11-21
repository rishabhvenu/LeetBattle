'use server';

import { redirect } from 'next/navigation';
import connectDB, { getMongoClient } from '../mongodb';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import {
  authLimiter,
  rateLimit,
  getClientIdentifier,
} from '../rateLimiter';
import { createSession, getSession as getSessionImpl } from '../session';
import { DB_NAME, USERS_COLLECTION, User } from './constants';

// Re-export getSession as async function wrapper to comply with "use server" requirements
export async function getSession() {
  return getSessionImpl();
}

export async function registerUser(prevState: { error?: string } | null, formData: FormData) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(authLimiter, identifier);
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }

  // Extract form data
  const username = formData.get('username') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;
  const firstName = formData.get('firstName') as string;
  const lastName = formData.get('lastName') as string;

  // Validation
  if (!username || !email || !password || !firstName || !lastName) {
    return { error: 'All fields are required' };
  }

  if (password !== confirmPassword) {
    return { error: 'Passwords do not match' };
  }

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters long' };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    // Check if user already exists
    const existingUser = await users.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return { error: 'User with this email or username already exists' };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const newUser: Omit<User, '_id'> = {
      username,
      email,
      password: hashedPassword,
      profile: {
        firstName,
        lastName,
      },
      stats: {
        totalMatches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        rating: 1200,
      },
      matchIds: [],
      lastLogin: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await users.insertOne(newUser);

    if (result.insertedId) {
      // Create session
      await createSession(result.insertedId.toString(), email, username);
      // Redirect after successful registration
      redirect('/');
    }

    return { error: 'Failed to create user' };
  } catch (error) {
    // Check if it's a redirect error (which is expected)
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error; // Re-throw redirect errors
    }
    console.error('Registration error:', error);
    return { error: 'An error occurred during registration' };
  }
}

export async function loginUser(prevState: { error?: string } | null, formData: FormData) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(authLimiter, identifier);
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }

  // Extract form data - should always be FormData in Next.js 15
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required' };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    // Find user by email
    const user = await users.findOne({ email });

    if (!user) {
      return { error: 'Invalid credentials' };
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return { error: 'Invalid credentials' };
    }

    // Update last login
    await users.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

    // Create session
    await createSession(user._id.toString(), user.email, user.username);
    // Redirect after successful login
    redirect('/');
  } catch (error) {
    // Check if it's a redirect error (which is expected)
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error; // Re-throw redirect errors
    }
    console.error('Login error:', error);
    return { error: 'An error occurred during login' };
  }
}

export async function logoutUser() {
  try {
    // Get sessionId from cookie (Edge operation)
    const { getSessionCookie } = await import('../session-edge');
    const sessionId = await getSessionCookie();

    if (sessionId) {
      // deleteSession handles both cookie deletion (Edge) and DB deletion (Node)
      const { deleteSession } = await import('../session');
      await deleteSession(sessionId);
    } else {
      // If no sessionId, still try to clear cookie
      const { deleteSessionCookie } = await import('../session-edge');
      await deleteSessionCookie();
    }

    redirect('/login');
  } catch (error) {
    // Check if it's a redirect error (which is expected)
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      throw error; // Re-throw redirect errors
    }
    console.error('Logout error:', error);
    redirect('/');
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(authLimiter, identifier);
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }

  // Validation
  if (!currentPassword || !newPassword) {
    return { error: 'Both current and new passwords are required' };
  }

  if (newPassword.length < 8) {
    return { error: 'New password must be at least 8 characters long' };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const users = db.collection(USERS_COLLECTION);

    // Get current session
    const session = await getSession();
    if (!session.authenticated || !session.userId) {
      return { error: 'User not authenticated' };
    }

    // Find user by ID
    const user = await users.findOne({ _id: new ObjectId(session.userId) });
    if (!user) {
      return { error: 'User not found' };
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return { error: 'Current password is incorrect' };
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await users.updateOne(
      { _id: new ObjectId(session.userId) },
      { $set: { password: hashedNewPassword, updatedAt: new Date() } }
    );

    return { success: true, message: 'Password updated successfully' };
  } catch (error) {
    console.error('Password change error:', error);
    return { error: 'An error occurred while changing password' };
  }
}

