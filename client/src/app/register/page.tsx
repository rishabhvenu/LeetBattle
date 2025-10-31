import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import RegisterPageClient from "./RegisterPageClient";

export default async function Register() {
  const session = await getSession();

  // If user is already authenticated, redirect to home
  console.log(session.authenticated);
  if (session.authenticated) {
    redirect('/');
  }

  return <RegisterPageClient />;
}