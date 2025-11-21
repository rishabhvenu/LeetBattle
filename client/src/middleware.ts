import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'experimental-edge';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  
  // Allow public routes for all methods (GET, POST, etc.)
  const publicRoutes = ['/landing', '/login', '/register'];
  const isPublicRoute = publicRoutes.includes(pathname);
  
  // If it's a public route, always allow access regardless of authentication
  if (isPublicRoute) {
    return NextResponse.next();
  }
  
  // Get session cookie
  const sessionCookie = request.cookies.get('codeclashers.sid');
  const isAuthenticated = !!sessionCookie;
  
  const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/problems');
  
  // Routes that allow guest access
  const guestRoutes = ['/match', '/queue'];
  const isGuestRoute = guestRoutes.includes(pathname);
  
  // Check for guest session cookie
  const guestCookie = request.cookies.get('codeclashers.guest.sid');
  const hasGuestSession = !!guestCookie;

  // If user is not authenticated and trying to access protected route
  if (!isAuthenticated && (isAdminRoute || (!isPublicRoute && !isGuestRoute))) {
    // For POST requests, redirect might cause issues, so just block them
    if (method === 'POST') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/landing', request.url));
  }

  // For /match route, require either authentication or guest session
  if (!isAuthenticated && pathname === '/match' && !hasGuestSession) {
    if (method === 'POST') {
      return NextResponse.json({ error: 'Authentication or guest session required' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/queue', request.url));
  }

  // If user is authenticated and trying to access login/register
  if (isAuthenticated && (pathname === '/login' || pathname === '/register')) {
    if (method === 'POST') {
      return NextResponse.json({ error: 'Already authenticated' }, { status: 400 });
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static files (images, svg, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sword-left.svg|sword-right.svg|placeholder_avatar.png|logo.png).*)',
  ],
};
