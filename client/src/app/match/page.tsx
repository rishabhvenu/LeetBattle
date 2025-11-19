import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import MatchClient from '@/components/pages/match/MatchClient';
import { getGuestSession, getGuestMatchData } from '@/lib/guest-actions';

// Helper function to safely convert any value to string (handles ObjectId)
// This ensures React can properly serialize the value
function safeToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    // Handle ObjectId - check for common ObjectId structure (head, pos)
    // This happens when ObjectId gets partially serialized
    if (value && typeof value === 'object' && 'head' in value && 'pos' in value) {
      // This is a serialized ObjectId - we can't recover the original ID
      // Log error and return empty string
      console.error('Found serialized ObjectId structure in props:', value);
      return '';
    }
    
    // Try toString() method first (works for ObjectId instances)
    if ('toString' in value && typeof value.toString === 'function') {
      try {
        const result = value.toString();
        if (typeof result === 'string') {
          // Verify it looks like a valid ID (not "[object Object]")
          if (result !== '[object Object]' && result.length > 0) {
            return result;
          }
        }
      } catch (e) {
        // Fall through
      }
    }
    
    // Last resort: try to extract any string-like property
    // This won't work for ObjectId but might help with other objects
    return String(value);
  }
  return String(value);
}

export default async function MatchPage() {
  // This is now a server component - session fetched on server
  const sessionData = await getSession();
  
  if (sessionData.authenticated) {
    // DIRECT CONVERSION FROM SOURCE - force to primitives immediately
    // Convert userId directly from sessionData.userId
    const userId: string = (() => {
      const val = sessionData.userId;
      if (typeof val === 'string') return val;
      // If it's an object (including ObjectId), reject immediately
      if (val && typeof val === 'object') {
        return ''; // Reject all objects
      }
      const converted = String(val || '');
      // Double-check the conversion result
      return typeof converted === 'string' ? converted : '';
    })();

    // Convert username directly from sessionData.user?.username
    const username: string = (() => {
      const val = sessionData.user?.username;
      if (typeof val === 'string') return val;
      // If it's an object (including ObjectId), reject immediately
      if (val && typeof val === 'object') {
        return 'User'; // Reject all objects
      }
      const converted = String(val || 'User');
      // Double-check the conversion result
      return typeof converted === 'string' ? converted : 'User';
    })();

    // Convert avatar directly from sessionData.user?.avatar
    const userAvatar: string | null = (() => {
      const val = sessionData.user?.avatar;
      if (val === null || val === undefined) return null;
      if (typeof val === 'string') return val;
      // If it's an object (including ObjectId), reject immediately
      if (val && typeof val === 'object') {
        return null; // Reject all objects
      }
      return null; // Reject non-strings
    })();

    // NUCLEAR OPTION: Serialize everything to JSON and back to force ObjectId conversion
    // This will catch any ObjectId structures and convert them
    const serializeValue = (val: unknown, fallback: string | null): string | null => {
      if (val === null) return null;
      if (typeof val === 'string') return val;
      
      // Try to serialize - if it's an ObjectId, this will expose it
      try {
        const str = JSON.stringify(val);
        const parsed = JSON.parse(str);
        
        // If it parsed to an object with head/pos, it's an ObjectId
        if (parsed && typeof parsed === 'object' && 'head' in parsed && 'pos' in parsed) {
          return fallback;
        }
        
        // If it's still an object, reject it
        if (typeof parsed === 'object') {
          return fallback;
        }
        
        // Otherwise convert to string
        return String(parsed) || fallback;
      } catch {
        return fallback;
      }
    };

    // Force serialize each value
    const safeUserId = serializeValue(userId, '') || '';
    const safeUsername = serializeValue(username, 'User') || 'User';
    const safeAvatar = serializeValue(userAvatar, null);

    // ABSOLUTE FINAL CHECK - force to primitives using JSON round-trip
    // This ensures Next.js can serialize them properly
    const forceToPrimitive = (val: unknown, fallback: string | null): string | null => {
      if (val === null) return null;
      if (typeof val === 'string') {
        // Double-check it's not an object masquerading as a string
        if (val && typeof val === 'object') return fallback;
        return val;
      }
      return fallback;
    };

    // Force each value through JSON serialization to catch ObjectIds
    const propsToSerialize = {
      userId: safeUserId,
      username: safeUsername,
      avatar: safeAvatar
    };

    let serializedProps: { userId: string; username: string; avatar: string | null };
    try {
      const serialized = JSON.stringify(propsToSerialize);
      const parsed = JSON.parse(serialized);
      
      // Check each parsed value for ObjectId structures
      const parsedUserId = parsed.userId;
      const parsedUsername = parsed.username;
      const parsedAvatar = parsed.avatar;
      
      // Force to primitives - check runtime types
      let finalUserId: string = '';
      if (typeof parsedUserId === 'string') {
        finalUserId = parsedUserId;
      } else if (parsedUserId && typeof parsedUserId === 'object') {
        // This is an ObjectId structure
        finalUserId = '';
      }
      
      let finalUsername: string = 'User';
      if (typeof parsedUsername === 'string') {
        finalUsername = parsedUsername;
      } else if (parsedUsername && typeof parsedUsername === 'object') {
        // This is an ObjectId structure
        finalUsername = 'User';
      }
      
      let finalAvatar: string | null = null;
      if (parsedAvatar === null) {
        finalAvatar = null;
      } else if (typeof parsedAvatar === 'string') {
        finalAvatar = parsedAvatar;
      } else if (parsedAvatar && typeof parsedAvatar === 'object') {
        // This is an ObjectId structure
        finalAvatar = null;
      }
      
      serializedProps = { userId: finalUserId, username: finalUsername, avatar: finalAvatar };
    } catch (e) {
      console.error('Serialization failed:', e);
      serializedProps = { userId: '', username: 'User', avatar: null };
    }

    // ONE LAST CHECK - verify the final values are primitives
    const verifyPrimitive = (val: unknown, name: string): string | null => {
      if (val === null) return null;
      if (typeof val === 'string') {
        // Check it's not an object (shouldn't be possible but be safe)
        if (val && typeof val === 'object') {
          console.error(`${name} is an object despite being string type!`, val);
          return name === 'avatar' ? null : (name === 'userId' ? '' : 'User');
        }
        return val;
      }
      console.error(`${name} is not a string:`, typeof val, val);
      return name === 'avatar' ? null : (name === 'userId' ? '' : 'User');
    };

    const verifiedUserId = verifyPrimitive(serializedProps.userId, 'userId') || '';
    const verifiedUsername = verifyPrimitive(serializedProps.username, 'username') || 'User';
    const verifiedAvatar = verifyPrimitive(serializedProps.avatar, 'avatar');

    return <MatchClient 
      userId={verifiedUserId} 
      username={verifiedUsername} 
      userAvatar={verifiedAvatar} 
      isGuest={false} 
    />;
  }
  
  // Check for guest session
  const guestId = await getGuestSession();
  if (!guestId) {
    redirect('/landing');
  }
  
  // Get guest match data (might not exist yet if they haven't created a match)
  const guestMatchData = await getGuestMatchData(guestId);
  
  // Guest user - pass null match data if not created yet
  return <MatchClient 
    userId={guestId} 
    username="Guest" 
    userAvatar={null} 
    isGuest={true}
    guestMatchData={guestMatchData}
  />;
}
