'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { generatePresignedUrl } from './minio';
import { REST_ENDPOINTS } from '../constants/RestEndpoints';
import { 
  authLimiter, 
  generalLimiter, 
  queueLimiter, 
  adminLimiter, 
  uploadLimiter, 
  rateLimit, 
  getClientIdentifier 
} from './rateLimiter';

// Dynamic imports for server-side only packages
async function getMongoClient() {
  const { getMongoClient: getMongoClientImpl } = await import('./mongodb');
  return getMongoClientImpl();
}

async function getRedis() {
  const { getRedis: getRedisImpl } = await import('./redis');
  return getRedisImpl();
}

async function getObjectId() {
  const { ObjectId } = await import('mongodb');
  return ObjectId;
}

async function getTryToObjectId() {
  const { tryToObjectId } = await import('./utilsObjectId');
  return tryToObjectId;
}

// Copy all the existing functions from actions.ts but with dynamic imports
// This is a simplified version - you'll need to copy all functions from the original file

export async function getSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('session')?.value;
  
  if (!sessionId) {
    return null;
  }

  try {
    const client = await getMongoClient();
    const db = client.db(process.env.DB_NAME || 'codeclashers');
    const sessions = db.collection('sessions');
    
    const session = await sessions.findOne({ _id: sessionId as unknown });
    if (!session) {
      return null;
    }

    return {
      id: sessionId,
      userId: session.userId,
      user: session.user
    };
  } catch (error) {
    console.error('Session error:', error);
    return null;
  }
}

// Rounding function for stats display
function roundToNearestEstimate(num: number): number {
  if (num === 0) return 0;
  
  // For numbers below 10, return 5 if >= 5, otherwise return 1
  if (num < 10) {
    return num >= 5 ? 5 : 1;
  }
  
  // For numbers 10-99, round down to nearest 10
  if (num < 100) {
    return Math.floor(num / 10) * 10;
  }
  
  // For numbers 100-999, round down to nearest 100
  if (num < 1000) {
    return Math.floor(num / 100) * 100;
  }
  
  // For numbers 1000+, round down to nearest 100
  return Math.floor(num / 100) * 100;
}

export async function getGeneralStats() {
  try {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:2567';
    const response = await fetch(`${apiBase}/global/general-stats`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Apply rounding logic to the stats
    return {
      activePlayers: roundToNearestEstimate(data.activePlayers || 0),
      matchesCompleted: roundToNearestEstimate(data.matchesCompleted || 0),
      inProgressMatches: data.inProgressMatches || 0,
      inQueue: data.inQueue || 0
    };
  } catch (error) {
    console.error('Error fetching general stats:', error);
    // Return default values if fetch fails
    return {
      activePlayers: 0,
      matchesCompleted: 0,
      inProgressMatches: 0,
      inQueue: 0
    };
  }
}

// Add all other functions from actions.ts here with dynamic imports
// This is just a template - you'll need to copy all the functions
