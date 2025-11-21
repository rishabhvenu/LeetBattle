import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import LoginPageClient from "./LoginPageClient";

export const dynamic = 'force-dynamic';

export default async function Login() {
  let session;
  try {
    session = await getSession();
  } catch (error) {
    // If getSession fails, just render the login page
    // This allows unauthenticated users to access the login page
    console.error('Error getting session in login page:', error);
    return <LoginPageClient />;
  }

  // If user is already authenticated, redirect to home
  // This must be outside try-catch so NEXT_REDIRECT can propagate
  if (session?.authenticated) {
    redirect('/');
  }

  return <LoginPageClient />;
}