import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import RegisterPageClient from "./RegisterPageClient";

export const dynamic = 'force-dynamic';

export default async function Register() {
  try {
    const session = await getSession();

    // If user is already authenticated, redirect to home
    if (session?.authenticated) {
      redirect('/');
    }
  } catch (error) {
    // If getSession fails, just render the register page
    // This allows unauthenticated users to access the register page
    console.error('Error getting session in register page:', error);
  }

  return <RegisterPageClient />;
}