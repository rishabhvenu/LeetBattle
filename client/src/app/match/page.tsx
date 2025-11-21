import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import MatchClient from '@/components/pages/match/MatchClient';
import { getGuestSession, getGuestMatchData } from '@/lib/guest-actions';

export const dynamic = 'force-dynamic';

export default async function MatchPage() {
  // Get session data
  const rawSessionData = await getSession();
  
  if (rawSessionData.authenticated) {
    // Safe primitive session object
    let safeSessionData: {
      userId: string;
      username: string;
      userAvatar: string | null;
    } = {
      userId: '',
      username: 'User',
      userAvatar: null,
    };

    try {
      // Correct MongoDB ObjectId detection + conversion
      const replacer = (key: string, value: unknown) => {
        if (value && typeof value === 'object') {
          const ctor = (value as any).constructor?.name;

          if (ctor === 'ObjectId' || (value as any)._bsontype === 'ObjectID') {
            try {
              return (value as any).toString();
            } catch {
              return '';
            }
          }
        }
        return value;
      };

      // Serialize entire session
      const serialized = JSON.stringify(rawSessionData, replacer);
      const parsed = JSON.parse(serialized) as {
        authenticated: boolean;
        userId?: unknown;
        user?: {
          username?: unknown;
          avatar?: unknown;
        };
      };

      // Extract and safely string-ify all session values
      safeSessionData.userId =
        parsed.userId == null ? '' : String(parsed.userId);

      safeSessionData.username =
        parsed.user?.username == null ? 'User' : String(parsed.user?.username);

      safeSessionData.userAvatar =
        parsed.user?.avatar == null
          ? null
          : typeof parsed.user?.avatar === 'string'
          ? parsed.user?.avatar
          : null;

    } catch (error) {
      console.error('Error serializing session data:', error);
      safeSessionData = {
        userId: '',
        username: 'User',
        userAvatar: null,
      };
    }

    // Final primitives
    const finalUserId = String(safeSessionData.userId || '');
    const finalUsername = String(safeSessionData.username || 'User');
    const finalAvatar =
      safeSessionData.userAvatar == null
        ? null
        : String(safeSessionData.userAvatar);

    return (
      <MatchClient
        userId={finalUserId}
        username={finalUsername}
        userAvatar={finalAvatar}
        isGuest={false}
      />
    );
  }
  
  // Guest user path
  const guestId = await getGuestSession();
  if (!guestId) {
    redirect('/landing');
  }
  
  const guestMatchData = await getGuestMatchData(guestId);
  
  return (
    <MatchClient
      userId={guestId}
      username="Guest"
      userAvatar={null}
      isGuest={true}
      guestMatchData={guestMatchData}
    />
  );
}
