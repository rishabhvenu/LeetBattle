'use server';

import { REST_ENDPOINTS } from '../../constants/RestEndpoints';
import { ensureAdminAccess, getSessionCookieHeader } from './shared';

export async function generateBotProfile(count: number, gender?: 'male' | 'female' | 'random') {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ count, gender }),
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error generating bot profile:', error);
    return { success: false, error: 'Failed to generate bot profile' };
  }
}

export async function generateBotAvatar(fullName: string, gender: 'male' | 'female' | 'nonbinary') {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/avatar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
      body: JSON.stringify({ fullName, gender }),
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || result.message || 'API request failed' };
    }
    return result;
  } catch (error) {
    console.error('Error generating bot avatar:', error);
    return { success: false, error: 'Failed to generate bot avatar' };
  }
}

export async function initializeBotsCollection() {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/init`, {
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
    console.error('Error initializing bots collection:', error);
    return { success: false, error: 'Failed to initialize bots collection' };
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
    const cookieHeader = await getSessionCookieHeader();
    const url = `${REST_ENDPOINTS.API_BASE}/admin/bots`;
    console.log('Fetching bots from:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      credentials: 'include',
    });

    // Optional verbose logging for debugging; commented out to reduce console noise
    // console.log('Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Response error:', errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const result = await response.json();
    // Silent success in normal operation; uncomment for debugging:
    // console.log('Bots fetched successfully:', result);
    return result;
  } catch (error) {
    console.error('Error fetching bots:', error);
    return { success: false, error: `Failed to fetch bots: ${error}` };
  }
}

export async function deployBots(botIds: string[], deploy: boolean) {
  const adminError = await ensureAdminAccess();
  if (adminError) {
    return { success: false, error: adminError };
  }

  try {
    const cookieHeader = await getSessionCookieHeader();
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/deploy`, {
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
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/${botId}`, {
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
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/${botId}`, {
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
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/reset`, {
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
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/rotation/config`, {
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
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/rotation/status`, {
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
    const response = await fetch(`${REST_ENDPOINTS.API_BASE}/admin/bots/rotation/init`, {
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

