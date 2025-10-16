import { getSession, getMatchHistory } from '@/lib/actions';
import { redirect } from 'next/navigation';
import MatchHistory from "@/pages/match-history/MatchHistory";
import Layout from "@/components/Layout";
import { logoutUser } from '@/lib/actions';

export default async function MatchHistoryPage() {
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

  // Fetch match history for the first page
  const matchHistory = await getMatchHistory(session.user!.id, 1, 10);

  return (
    <Layout session={layoutSession} showNavbar={true} logoutAction={logoutUser}>
      <MatchHistory initialData={matchHistory} userId={session.user!.id} />
    </Layout>
  );
}
