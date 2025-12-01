'use server';

import { REST_ENDPOINTS } from '../../constants/RestEndpoints';
import { ensureAdminAccess, getSessionCookieHeader } from './shared';
import connectDB, { getMongoClient } from '../mongodb';
import { DB_NAME } from './constants';

export async function generateBotProfile(count: number, gender?: 'male' | 'female' | 'random') {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    // Use Colyseus HTTP URL for backend API endpoints
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || REST_ENDPOINTS.API_BASE || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }
    
    const response = await fetch(`${apiBase}/admin/bots/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ count, gender }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Bot generation API error:', response.status, errorText);
      try {
        const errorJson = JSON.parse(errorText);
        return { success: false, error: errorJson.error || errorJson.message || 'API request failed' };
      } catch {
        return { success: false, error: `HTTP ${response.status}: ${errorText.substring(0, 100)}` };
      }
    }

    const result = await response.json();
    return result;
  } catch (error: any) {
    console.error('Error generating bot profile:', error);
    return { success: false, error: `Failed to generate bot profile: ${error.message || error}` };
  }
}

export async function generateBotAvatar(fullName: string, gender: 'male' | 'female' | 'nonbinary') {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    // Use Colyseus HTTP URL for backend API endpoints
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || REST_ENDPOINTS.API_BASE || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }
    
    const response = await fetch(`${apiBase}/admin/bots/avatar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ fullName, gender }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Bot avatar API error:', response.status, errorText);
      try {
        const errorJson = JSON.parse(errorText);
        return { success: false, error: errorJson.error || errorJson.message || 'API request failed' };
      } catch {
        return { success: false, error: `HTTP ${response.status}: ${errorText.substring(0, 100)}` };
      }
    }

    const result = await response.json();
    return result;
  } catch (error: any) {
    console.error('Error generating bot avatar:', error);
    return { success: false, error: `Failed to generate bot avatar: ${error.message || error}` };
  }
}

export async function initializeBotsCollection() {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const bots = db.collection('bots');

    // Check if collection exists and has any documents
    const count = await bots.countDocuments();
    
    if (count === 0) {
      // Collection exists but is empty - this is fine, it's initialized
      return { 
        success: true, 
        message: 'Bots collection is initialized and ready to use. It is currently empty.' 
      };
    }

    // Collection has documents - already initialized
    return { 
      success: true, 
      message: `Bots collection is already initialized with ${count} bot(s).` 
    };
  } catch (error) {
    console.error('Error initializing bots collection:', error);
    // If collection doesn't exist, MongoDB will create it on first insert
    // So we can consider this a success
    return { 
      success: true, 
      message: 'Bots collection will be created automatically when you add your first bot.' 
    };
  }
}

export async function getBots() {
  // Check admin access on server side first
  const adminError = await ensureAdminAccess();
  if (adminError) {
    console.error('Admin access denied:', adminError);
    return { success: false, error: adminError };
  }

  try {
    await connectDB();
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const bots = db.collection('bots');

    // Fetch all bots from MongoDB
    const botsList = await bots.find({}).toArray();

    // Transform MongoDB documents to match BotDoc format
    const { ObjectId } = await import('mongodb');
    const formattedBots = botsList.map((bot: any) => ({
      _id: bot._id, // Keep as ObjectId to match BotDoc type
      username: bot.username || 'Unknown',
      fullName: bot.fullName || bot.username || 'Unknown',
      avatar: bot.avatar || '', // BotDoc requires string, not null
      gender: (bot.gender === 'male' || bot.gender === 'female') ? bot.gender : 'male', // Required field, ensure valid value
      stats: bot.stats || {
        rating: 1200,
        totalMatches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      },
      matchIds: (bot.matchIds || []).map((id: any) => {
        // Ensure matchIds are ObjectId instances
        if (id instanceof ObjectId) return id;
        if (typeof id === 'string') return new ObjectId(id);
        return new ObjectId(String(id));
      }),
      deployed: bot.deployed || false,
      createdAt: bot.createdAt || bot._id.getTimestamp(),
      updatedAt: bot.updatedAt || bot._id.getTimestamp(),
    }));

    return { success: true, bots: formattedBots };
  } catch (error: any) {
    console.error('Error fetching bots:', error);
    // Check if collection doesn't exist
    if (error?.message?.includes('not initialized') || error?.code === 'NamespaceNotFound') {
      return { success: false, error: 'Bots collection not initialized' };
    }
    return { success: false, error: `Failed to fetch bots: ${error.message || error}` };
  }
}

export async function deployBots(botIds: string[], deploy: boolean) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || REST_ENDPOINTS.API_BASE || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }
    const response = await fetch(`${apiBase}/admin/bots/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ botIds, deploy }),
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error deploying bots:', error);
    return { success: false, error: 'Failed to deploy bots' };
  }
}

export async function updateBot(botId: string, updates: Record<string, unknown>) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || REST_ENDPOINTS.API_BASE || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }
    const response = await fetch(`${apiBase}/admin/bots/${botId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify(updates),
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error updating bot:', error);
    return { success: false, error: 'Failed to update bot' };
  }
}

export async function deleteBot(botId: string) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || REST_ENDPOINTS.API_BASE || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }
    const response = await fetch(`${apiBase}/admin/bots/${botId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error deleting bot:', error);
    return { success: false, error: 'Failed to delete bot' };
  }
}

export async function resetBotData(resetType: 'stats' | 'all' = 'stats') {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || REST_ENDPOINTS.API_BASE || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }
    const response = await fetch(`${apiBase}/admin/bots/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ resetType }),
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error resetting bot data:', error);
    return { success: false, error: 'Failed to reset bot data' };
  }
}

export async function deleteAllBots() {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ resetType: 'all' }),
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error deleting all bots:', error);
    return { success: false, error: 'Failed to delete all bots' };
  }
}

export async function resetBotStats() {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ resetType: 'stats' }),
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error resetting bot stats:', error);
    return { success: false, error: 'Failed to reset bot stats' };
  }
}

// Bot rotation management functions
export async function setRotationConfig(maxDeployed: number) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || REST_ENDPOINTS.API_BASE || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }
    const response = await fetch(`${apiBase}/admin/bots/rotation/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ maxDeployed }),
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error setting rotation config:', error);
    return { success: false, error: 'Failed to set rotation config' };
  }
}

export async function getRotationStatus() {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || REST_ENDPOINTS.API_BASE || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }
    const response = await fetch(`${apiBase}/admin/bots/rotation/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
    });

    const result = await response.json();
    
    if (!response.ok) {
      console.error('[getRotationStatus] API error response', {
        status: response.status,
        statusText: response.statusText,
        error: result.error,
        message: result.message,
      });
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    
    return result;
  } catch (error) {
    console.error('Error getting rotation status:', error);
    return { success: false, error: 'Failed to get rotation status' };
  }
}

export async function initializeRotationSystem() {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const apiBase = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || REST_ENDPOINTS.API_BASE || '';
    if (!apiBase) {
      return { success: false, error: 'Backend API URL not configured' };
    }
    const response = await fetch(`${apiBase}/admin/bots/rotation/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error initializing rotation system:', error);
    return { success: false, error: 'Failed to initialize rotation system' };
  }
}

