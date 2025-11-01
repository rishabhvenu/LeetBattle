import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import Leaderboard from "@/components/pages/Leaderboard";
import Layout from "@/components/Layout";
import { logoutUser } from '@/lib/actions';

export default async function LeaderboardPage() {
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

  return (
    <Layout session={layoutSession} showNavbar={true} logoutAction={logoutUser}>
      <Leaderboard />
    </Layout>
  );
}
