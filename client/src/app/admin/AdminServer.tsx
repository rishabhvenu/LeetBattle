import { redirect } from 'next/navigation';

import AdminPageContent from './AdminPageContent';
import { assertAdminSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AdminServer() {
  try {
    await assertAdminSession();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'Authentication required') {
      redirect('/landing');
    }
    redirect('/unauthorized');
  }

  return <AdminPageContent />;
}
