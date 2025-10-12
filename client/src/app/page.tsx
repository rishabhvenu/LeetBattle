import { getSession, getUserStatsCached } from '@/lib/actions';
import { redirect } from 'next/navigation';
import HomePageClient from './HomePageClient';

export default async function HomePage() {
  const session = await getSession();

  // If no session, redirect to landing page
  if (!session.authenticated) {
    redirect('/landing');
  }

  // Fetch real user stats (cached in Redis, fallback to MongoDB)
  const stats = await getUserStatsCached(session.user!.id);

  const homeSession = {
    user: session.user,
    stats: {
      totalMatches: stats.totalMatches,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      rating: stats.rating ?? 1200,
    }
  };

  // Transform session for Layout component
  const layoutSession = {
    _id: session.user?.id || '',
    username: session.user?.username || 'User'
  };

  // If session exists, show home page with sidebar
  return <HomePageClient homeSession={homeSession} layoutSession={layoutSession} />;
}