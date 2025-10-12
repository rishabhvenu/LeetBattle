'use client';

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Navbar from "./Navbar";

interface LayoutProps {
  session: { _id: string; username: string } | null;
  showNavbar: boolean;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
}

export default function Layout({ session, showNavbar, onLogout, children }: LayoutProps) {
  const router = useRouter();

  useEffect(() => {
    if (!session) {
      router.push("/landing");
    }
  }, [session, router]);

  if (!session) {
    return null;
  }

  return (
    <div className="flex h-screen">
      {showNavbar && <Navbar session={session} onLogout={onLogout} />}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
