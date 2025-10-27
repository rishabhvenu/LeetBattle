import { getSession } from '@/lib/actions';
import { redirect } from 'next/navigation';
import Layout from "@/components/Layout";
import { logoutUser } from '@/lib/actions';
import { Shield, Home, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default async function UnauthorizedPage() {
  const session = await getSession();

  // If no session, redirect to landing page
  if (!session || !session.authenticated) {
    redirect('/landing');
  }

  // Transform session for Layout component
  const layoutSession = {
    _id: session.user?.id || '',
    username: session.user?.username || 'User'
  };

  return (
    <Layout session={layoutSession} showNavbar={true} logoutAction={logoutUser}>
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center">
            <div className="mx-auto w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mb-6">
              <Shield className="w-12 h-12 text-red-600" />
            </div>
            
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Access Denied
            </h1>
            
            <p className="text-lg text-gray-600 mb-8">
              You don't have permission to access the admin panel. 
              Only authorized administrators can access this area.
            </p>
            
            <div className="space-y-4">
              <Link href="/">
                <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                  <Home className="w-4 h-4 mr-2" />
                  Go to Home
                </Button>
              </Link>
              
              <Link href="/play">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Play
                </Button>
              </Link>
            </div>
            
            <div className="mt-8 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">
                If you believe this is an error, please contact the system administrator.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
