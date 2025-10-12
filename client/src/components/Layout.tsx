'use client';

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Navbar from "./Navbar";

interface LayoutProps {
  session: { _id: string; username: string } | null;
  showNavbar: boolean;
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}

export default function Layout({ session, showNavbar, logoutAction, children }: LayoutProps) {
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
      {showNavbar && <Navbar session={session} logoutAction={logoutAction} />}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
