import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import Settings from "@/components/pages/Settings";
import Layout from "@/components/Layout";
import { logoutUser } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SettingsPage() {
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

  // Transform session for Settings component
  const username = session.user?.username || 'User';
  const initials = username.substring(0, 2).toUpperCase();
  
  const settingsSession = {
    _id: session.user?.id || '',
    username,
    email: session.user?.email || 'user@example.com',
    avatar: session.user?.avatar || undefined,
    initials,
    timeCoded: 0,
    problemsSolved: 0,
    globalRank: 1,
    currentStreak: 0,
  };

  return (
    <Layout session={layoutSession} showNavbar={true} logoutAction={logoutUser}>
      <Settings restHandler={null} session={settingsSession} />
    </Layout>
  );
}
