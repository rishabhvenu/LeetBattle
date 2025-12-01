import type { Context, Next } from 'koa';
import { getMongoClient, getDbName } from './mongo';

interface SessionDocument {
  _id: string;
  expires: Date;
  user?: {
    email?: string;
  };
  userId?: string;
}

const DB_NAME = getDbName();
const USERS_COLLECTION = 'users';
const SESSIONS_COLLECTION = 'sessions';
const ADMIN_EMAIL = 'rishiryan4@gmail.com';

/**
 * Admin authentication middleware
 * Validates user session and checks if user email matches the admin email
 * Only allows access to users with the specified admin email
 * Also accepts X-Internal-Secret for server-to-server calls
 */
export function adminAuthMiddleware() {
  return async (ctx: Context, next: Next) => {
    try {
      // Check for internal service secret first (for server-to-server calls)
      const internalSecret = ctx.get('X-Internal-Secret');
      const expectedInternalSecret = process.env.INTERNAL_SERVICE_SECRET;
      
      console.log('[adminAuth] checking internal secret', {
        path: ctx.path,
        method: ctx.method,
        hasInternalSecret: !!internalSecret,
        hasExpectedSecret: !!expectedInternalSecret,
        secretLength: internalSecret?.length || 0,
        expectedLength: expectedInternalSecret?.length || 0,
        secretsMatch: internalSecret === expectedInternalSecret,
      });
      
      if (internalSecret && expectedInternalSecret && internalSecret === expectedInternalSecret) {
        console.log('[adminAuth] internal service authentication SUCCESS', {
          path: ctx.path,
          method: ctx.method,
          serviceName: ctx.get('X-Service-Name') || 'unknown',
        });
        ctx.state.internalService = true;
        ctx.state.adminUser = true; // Treat internal service as admin
        await next();
        return;
      }
      
      if (internalSecret && expectedInternalSecret && internalSecret !== expectedInternalSecret) {
        console.warn('[adminAuth] internal secret mismatch', {
          path: ctx.path,
          method: ctx.method,
          receivedLength: internalSecret.length,
          expectedLength: expectedInternalSecret.length,
        });
      }
      
      // Get session cookie (for browser-based calls)
      const sessionCookie = ctx.cookies.get('codeclashers.sid');
      console.log('[adminAuth] incoming request', {
        path: ctx.path,
        method: ctx.method,
        hasSessionCookie: Boolean(sessionCookie),
        hasInternalSecret: Boolean(internalSecret),
      });
      
      if (!sessionCookie) {
        console.warn('[adminAuth] missing session cookie', {
          path: ctx.path,
          method: ctx.method,
        });
        ctx.status = 401;
        ctx.body = { error: 'not_authenticated', message: 'No session found' };
        return;
      }

      // Look up session in MongoDB
      const client = await getMongoClient();
      const db = client.db(DB_NAME);
      const sessions = db.collection<SessionDocument>(SESSIONS_COLLECTION);
      
      const now = new Date();
      const session = await sessions.findOne({ 
        _id: sessionCookie,
        expires: { $gt: now }
      });
      if (session) {
        console.log('[adminAuth] session lookup success', {
          userId: session.userId?.toString(),
          userEmail: session.user?.email,
          expires: session.expires,
          now,
        });
      }
      
      if (!session) {
        console.warn('[adminAuth] session not found or expired', {
          sessionCookie,
          now,
        });
        ctx.status = 401;
        ctx.body = { error: 'invalid_session', message: 'Session expired or not found' };
        return;
      }

      // Get user information from session
      const userEmail = session.user?.email;
      
      if (!userEmail) {
        console.warn('[adminAuth] session missing user email', {
          sessionCookie,
          userId: session.userId?.toString(),
        });
        ctx.status = 401;
        ctx.body = { error: 'no_user_email', message: 'No user email in session' };
        return;
      }

      // Check if user email matches the admin email
      console.log('[adminAuth] checking email match', {
        userEmail,
        adminEmail: ADMIN_EMAIL,
        match: userEmail === ADMIN_EMAIL,
        userEmailLength: userEmail?.length,
        adminEmailLength: ADMIN_EMAIL.length,
      });
      
      if (userEmail !== ADMIN_EMAIL) {
        console.warn('[adminAuth] non-admin session - email mismatch', {
          sessionCookie,
          userEmail,
          expectedAdminEmail: ADMIN_EMAIL,
          match: false,
        });
        ctx.status = 403;
        ctx.body = { error: 'forbidden', message: 'Admin access required' };
        return;
      }

      console.log('[adminAuth] admin access granted', {
        userId: session.userId?.toString(),
        userEmail,
        path: ctx.path,
      });

      // Add user info to context for logging
      ctx.state.adminUser = true;
      ctx.state.userEmail = userEmail;
      ctx.state.userId = session.userId?.toString();
      
      await next();
    } catch (error: any) {
      console.error('Admin auth middleware error:', error);
      ctx.status = 500;
      ctx.body = { error: 'authentication_error', message: 'Failed to authenticate' };
    }
  };
}

/**
 * Internal service authentication middleware
 * Validates X-Internal-Secret header for service-to-service communication
 * Bypasses rate limiting for authenticated internal requests
 */
export function internalAuthMiddleware() {
  return async (ctx: Context, next: Next) => {
    const internalSecret = ctx.get('X-Internal-Secret');
    const expectedSecret = process.env.INTERNAL_SERVICE_SECRET;
    
    if (!expectedSecret) {
      console.error('INTERNAL_SERVICE_SECRET not configured');
      ctx.status = 500;
      ctx.body = { error: 'internal_auth_not_configured' };
      return;
    }
    
    if (!internalSecret) {
      ctx.status = 401;
      ctx.body = { error: 'missing_internal_secret' };
      return;
    }
    
    if (internalSecret !== expectedSecret) {
      ctx.status = 401;
      ctx.body = { error: 'invalid_internal_secret' };
      return;
    }
    
    // Add service identifier to context for logging
    ctx.state.internalService = true;
    ctx.state.serviceIdentifier = ctx.get('X-Service-Name') || 'unknown';
    
    // Skip rate limiting for internal services
    await next();
  };
}

/**
 * Bot service authentication middleware
 * Validates X-Bot-Secret header for bot service communication
 * Bypasses rate limiting for authenticated bot requests
 */
export function botAuthMiddleware() {
  return async (ctx: Context, next: Next) => {
    const botSecret = ctx.get('X-Bot-Secret');
    const expectedSecret = process.env.BOT_SERVICE_SECRET;
    
    if (!expectedSecret) {
      console.error('BOT_SERVICE_SECRET not configured');
      ctx.status = 500;
      ctx.body = { error: 'bot_auth_not_configured' };
      return;
    }
    
    if (!botSecret) {
      ctx.status = 401;
      ctx.body = { error: 'missing_bot_secret' };
      return;
    }
    
    if (botSecret !== expectedSecret) {
      ctx.status = 401;
      ctx.body = { error: 'invalid_bot_secret' };
      return;
    }
    
    // Add service identifier to context for logging
    ctx.state.botService = true;
    ctx.state.serviceIdentifier = 'bot-service';
    
    // Skip rate limiting for bot services
    await next();
  };
}

/**
 * Combined authentication middleware for endpoints used by both internal services and bots
 * Accepts either X-Internal-Secret or X-Bot-Secret
 * Bypasses rate limiting for authenticated requests
 */
export function combinedAuthMiddleware() {
  return async (ctx: Context, next: Next) => {
    const internalSecret = ctx.get('X-Internal-Secret');
    const botSecret = ctx.get('X-Bot-Secret');
    
    // Check for internal service authentication
    if (internalSecret) {
      const expectedInternalSecret = process.env.INTERNAL_SERVICE_SECRET;
      
      if (!expectedInternalSecret) {
        console.error('INTERNAL_SERVICE_SECRET not configured');
        ctx.status = 500;
        ctx.body = { error: 'internal_auth_not_configured' };
        return;
      }
      
      if (internalSecret !== expectedInternalSecret) {
        ctx.status = 401;
        ctx.body = { error: 'invalid_internal_secret' };
        return;
      }
      
      // Add service identifier to context for logging
      ctx.state.internalService = true;
      ctx.state.serviceIdentifier = ctx.get('X-Service-Name') || 'internal-service';
      
      // Skip rate limiting for internal services
      await next();
      return;
    }
    
    // Check for bot service authentication
    if (botSecret) {
      const expectedBotSecret = process.env.BOT_SERVICE_SECRET;
      
      if (!expectedBotSecret) {
        console.error('BOT_SERVICE_SECRET not configured');
        ctx.status = 500;
        ctx.body = { error: 'bot_auth_not_configured' };
        return;
      }
      
      if (botSecret !== expectedBotSecret) {
        ctx.status = 401;
        ctx.body = { error: 'invalid_bot_secret' };
        return;
      }
      
      // Add service identifier to context for logging
      ctx.state.botService = true;
      ctx.state.serviceIdentifier = 'bot-service';
      
      // Skip rate limiting for bot services
      await next();
      return;
    }
    
    // No valid authentication found
    ctx.status = 401;
    ctx.body = { error: 'missing_authentication' };
  };
}
