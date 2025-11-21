import { getSession, getUserStatsCached, getOngoingMatchesCount } from '@/lib/actions';
import { redirect } from 'next/navigation';
import Play from "@/components/pages/Play";
import Layout from "@/components/Layout";
import { logoutUser } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function PlayPage() {
  const session = await getSession();

  // If no session, redirect to landing page
  if (!session.authenticated) {
    redirect('/landing');
  }

  // Transform session for Layout component
  const layoutSession = {
    _id: session.user?.id || '',
    username: session.user?.username || 'User'
  };

  // Fetch global rank from cached stats
  const stats = await getUserStatsCached(session.user!.id);
  const ongoingMatches = await getOngoingMatchesCount();

  // Transform session for Play component
  const playSession = {
    _id: session.user?.id || '',
    username: session.user?.username || 'User',
    timeCoded: stats?.timeCoded ?? 0,
    problemsSolved: 0,
    globalRank: stats?.globalRank ?? 1,
    currentStreak: 0,
  };

  return (
    <Layout session={layoutSession} showNavbar={true} logoutAction={logoutUser}>
      <Play session={playSession} ongoingMatches={ongoingMatches} />
    </Layout>
  );
}
