import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import MatchClient from '@/pages/match/MatchClient';
import { getGuestSession, getGuestMatchData } from '@/lib/guest-actions';

export default async function MatchPage() {
  // This is now a server component - session fetched on server
  const sessionData = await getSession();
  
  if (sessionData.authenticated) {
    // Authenticated user
    const matchSession = {
      userId: sessionData.user?.id,
      username: sessionData.user?.username || 'User',
      avatar: sessionData.user?.avatar || null,
    };

    return <MatchClient userId={matchSession.userId!} username={matchSession.username} userAvatar={matchSession.avatar} isGuest={false} />;
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
