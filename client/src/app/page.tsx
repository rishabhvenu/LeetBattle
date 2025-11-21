import { getSession, getUserStatsCached, getUserActivityCached } from '@/lib/actions';
import { redirect } from 'next/navigation';
import HomePageClient from './HomePageClient';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getSession();

  // If no session, redirect to landing page
  if (!session.authenticated) {
    redirect('/landing');
  }

  // Fetch real user stats and activity (cached in Redis, fallback to MongoDB)
  const [stats, activity] = await Promise.all([
    getUserStatsCached(session.user!.id),
    getUserActivityCached(session.user!.id)
  ]);

  const homeSession = {
    user: session.user,
    stats: {
      totalMatches: stats.totalMatches,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      rating: stats.rating ?? 1200,
    },
    activity
  };

  // Transform session for Layout component
  const layoutSession = {
    _id: session.user?.id || '',
    username: session.user?.username || 'User'
  };

  // If session exists, show home page with sidebar
  return <HomePageClient homeSession={homeSession} layoutSession={layoutSession} />;
}