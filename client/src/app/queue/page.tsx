import { getSession, getUserStatsCached } from '@/lib/actions';
import { redirect } from 'next/navigation';
import MatchQueue from "@/pages/match/MatchQueue";
import Layout from "@/components/Layout";
import { logoutUser } from '@/lib/actions';
import { getRedis, RedisKeys } from '@/lib/redis';

export default async function QueuePage() {
  const session = await getSession();

  // If no session, redirect to landing page
  if (!session.authenticated) {
    redirect('/landing');
  }

  // Check if user already has an active match/reservation
  const redis = getRedis();
  const existingReservation = await redis.get(`queue:reservation:${session.user!.id}`);
  
  if (existingReservation) {
    try {
      const reservationData = JSON.parse(existingReservation);
      
      // Check if match room still exists in activeMatchesSet
      const matchActive = await redis.sismember(RedisKeys.activeMatchesSet, reservationData.matchId);
      
      if (matchActive) {
        console.log(`User ${session.user!.id} already has an active match, redirecting to match page`);
        redirect('/match');
      } else {
        // Match no longer active, clear the stale reservation
        console.log(`Match ${reservationData.matchId} no longer active, clearing stale reservation`);
        await redis.del(`queue:reservation:${session.user!.id}`);
        // Continue to queue page
      }
    } catch (error) {
      console.error('Error checking reservation:', error);
      // Clear potentially corrupted reservation
      await redis.del(`queue:reservation:${session.user!.id}`);
    }
  }

  // Transform session for Layout component
  const layoutSession = {
    _id: session.user?.id || '',
    username: session.user?.username || 'User'
  };

  // Fetch rating from cached stats
  const stats = await getUserStatsCached(session.user!.id);
  const rating = stats.rating ?? 1200;

  return (
    <Layout session={layoutSession} showNavbar={true} logoutAction={logoutUser}>
      <MatchQueue userId={session.user!.id} rating={rating} />
    </Layout>
  );
}
