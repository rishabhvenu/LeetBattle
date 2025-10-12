'use client';

import Home from "@/pages/Home";
import Layout from "@/components/Layout";
import { logoutUser } from '@/lib/actions';

interface HomePageClientProps {
  homeSession: {
    user?: {
      id: string;
      email: string;
      username: string;
    };
    stats: {
      totalMatches: number;
      wins: number;
      losses: number;
      draws: number;
      rating: number;
    };
  };
  layoutSession: {
    _id: string;
    username: string;
  };
}

export default function HomePageClient({ homeSession, layoutSession }: HomePageClientProps) {
  return (
    <Layout session={layoutSession} showNavbar={true} onLogout={logoutUser}>
      <Home session={homeSession} restHandler={null} />
    </Layout>
  );
}
