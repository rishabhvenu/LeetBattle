import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import MatchClient from '@/pages/match/MatchClient';

export default async function MatchPage() {
  // This is now a server component - session fetched on server
  const sessionData = await getSession();
  
  if (!sessionData.authenticated) {
    redirect('/landing');
  }

  // Transform session for MatchClient component
  const matchSession = {
    userId: sessionData.user?._id || sessionData.user?.id,
    username: sessionData.user?.username || 'User',
    avatar: sessionData.user?.avatar || null,
  };

  return <MatchClient userId={matchSession.userId} username={matchSession.username} userAvatar={matchSession.avatar} />;
}
