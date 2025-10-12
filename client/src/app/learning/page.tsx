import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import LearningPath from "@/pages/practice/LearningPath";
import Layout from "@/components/Layout";
import { logoutUser } from '@/lib/actions';

export default async function LearningPage() {
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
    <Layout session={layoutSession} showNavbar={true} onLogout={logoutUser}>
      <LearningPath />
    </Layout>
  );
}
