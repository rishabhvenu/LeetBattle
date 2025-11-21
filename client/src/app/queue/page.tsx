import { getSession, getUserStatsCached } from '@/lib/actions';
import { redirect } from 'next/navigation';
import MatchQueue from "@/components/pages/match/MatchQueue";
import Layout from "@/components/Layout";
import { logoutUser } from '@/lib/actions';
import { getRedis, RedisKeys } from '@/lib/redis';
import { getGuestSession, hasGuestPlayed } from '@/lib/guest-actions';
import GuestQueue from '@/components/pages/match/GuestQueue';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const session = await getSession();

  // If no session, show guest queue (will handle session creation)
  if (!session.authenticated) {
    // Check if guest has already played (if session exists)
    const guestId = await getGuestSession();
    if (guestId) {
      try {
        const hasPlayed = await hasGuestPlayed();
        if (hasPlayed) {
          // Guest already played, show sign-up prompt
          return <GuestQueue isAlreadyPlayed={true} />;
        }
      } catch (error) {
        console.error('Error checking guest play status:', error);
        // If backend is not accessible, assume guest hasn't played
        // This prevents the server component from failing
      }
      
      // Guest has a session but hasn't played yet - check if they have an active match
      let shouldRedirectGuestToMatch = false;
      try {
        const redis = getRedis();
        const guestSessionData = await redis.get(`guest:session:${guestId}`);
        
        if (guestSessionData) {
          try {
            const sessionData = JSON.parse(guestSessionData);
            const matchId = sessionData.matchId;
            
            // Check if the match is still active
            const matchActive = await redis.sismember(RedisKeys.activeMatchesSet, matchId);
            
            if (matchActive) {
              // Guest has an active match, redirect to match page
              console.log(`Guest ${guestId} already has an active match, will redirect to match page`);
              shouldRedirectGuestToMatch = true;
            } else {
              // Match no longer active, clear the stale session
              console.log(`Guest match ${matchId} no longer active, clearing stale session`);
              await redis.del(`guest:session:${guestId}`);
              // Continue to create new match
            }
          } catch (error) {
            console.error('Error checking guest session:', error);
            // Clear potentially corrupted session
            await redis.del(`guest:session:${guestId}`);
          }
        }
      } catch (error) {
        console.error('Error accessing Redis:', error);
        // If Redis is not accessible, continue without checking
        // This prevents the server component from failing
      }
      
      // Redirect outside of try-catch so the NEXT_REDIRECT error propagates properly
      if (shouldRedirectGuestToMatch) {
        redirect('/match');
      }
    }
    
    // Guest can play (or create new session), show guest queue
    return <GuestQueue isAlreadyPlayed={false} />;
  }

  // Check if user already has an active match/reservation
  let shouldRedirectToMatch = false;
  try {
    const redis = getRedis();
    const existingReservation = await redis.get(`queue:reservation:${session.user!.id}`);
    
    if (existingReservation) {
      try {
        const reservationData = JSON.parse(existingReservation);
        
        // Check if match room still exists in activeMatchesSet
        const matchActive = await redis.sismember(RedisKeys.activeMatchesSet, reservationData.matchId);
        
        if (matchActive) {
          console.log(`User ${session.user!.id} already has an active match, will redirect to match page`);
          shouldRedirectToMatch = true;
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
  } catch (error) {
    console.error('Error accessing Redis for user reservation:', error);
    // If Redis is not accessible, continue without checking
    // This prevents the server component from failing
  }

  // Redirect outside of try-catch so the NEXT_REDIRECT error propagates properly
  if (shouldRedirectToMatch) {
    redirect('/match');
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
      <MatchQueue userId={session.user!.id} username={session.user!.username} rating={rating} />
    </Layout>
  );
}
