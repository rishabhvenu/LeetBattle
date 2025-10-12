'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MatchClient from '@/pages/match/MatchClient';
import { getSession } from '@/lib/actions';

export default function MatchPage() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const loadSession = async () => {
      try {
        const sessionData = await getSession();
        if (!sessionData.authenticated) {
          router.push('/landing');
          return;
        }
        setSession(sessionData);
      } catch (error) {
        console.error('Error loading session:', error);
        router.push('/landing');
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null; // Will redirect
  }

  // Transform session for MatchClient component
  const matchSession = {
    userId: session.user?._id || session.user?.id,
    username: session.user?.username || 'User',
    avatar: session.user?.avatar || null,
    timeCoded: 0,
    problemsSolved: 0,
    globalRank: 1,
    currentStreak: 0,
  };

  return <MatchClient userId={matchSession.userId} username={matchSession.username} userAvatar={matchSession.avatar} />;
}
