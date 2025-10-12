import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import LoginPageClient from "./LoginPageClient";

export default async function Login() {
  const session = await getSession();

  // If user is already authenticated, redirect to home
  if (session.authenticated) {
    redirect('/');
  }

  return <LoginPageClient />;
}