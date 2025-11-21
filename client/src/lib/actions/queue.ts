'use server';

import {
  queueLimiter,
  rateLimit,
  getClientIdentifier,
} from '../rateLimiter';

export async function enqueueUser(userId: string, rating: number) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(queueLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  // Backend is authoritative; subscriber disabled to avoid double writes
  const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  
  if (!internalSecret) {
    console.error('INTERNAL_SERVICE_SECRET is not configured');
    return { success: false, error: 'Internal service secret not configured' };
  }
  
  const res = await fetch(`${base}/queue/enqueue`, { 
    method: 'POST', 
    headers: { 
      'Content-Type': 'application/json',
      'X-Internal-Secret': internalSecret,
      'X-Service-Name': 'nextjs-actions'
    }, 
    body: JSON.stringify({ userId, rating }) 
  });
  if (!res.ok) return { success: false };
  return { success: true };
}

export async function dequeueUser(userId: string) {
  // Rate limiting
  const identifier = await getClientIdentifier();
  try {
    await rateLimit(queueLimiter, identifier);
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }

  // Backend is authoritative; subscriber disabled to avoid double writes
  const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  
  if (!internalSecret) {
    console.error('INTERNAL_SERVICE_SECRET is not configured');
    return { success: false, error: 'Internal service secret not configured' };
  }
  
  const res = await fetch(`${base}/queue/dequeue`, { 
    method: 'POST', 
    headers: { 
      'Content-Type': 'application/json',
      'X-Internal-Secret': internalSecret,
      'X-Service-Name': 'nextjs-actions'
    }, 
    body: JSON.stringify({ userId }) 
  });
  if (!res.ok) return { success: false };
  return { success: true };
}

export async function consumeReservation(userId: string) {
  // Backend is authoritative; subscriber disabled to avoid double writes
  const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
  const tokRes = await fetch(`${base}/queue/reservation?userId=${encodeURIComponent(userId)}`);
  if (!tokRes.ok) return { success: false, error: 'no_token' };
  const { token } = await tokRes.json();
  const conRes = await fetch(`${base}/reserve/consume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  if (!conRes.ok) return { success: false, error: 'consume_failed' };
  const data = await conRes.json();
  const reservation = data.reservation;
  
  console.log('consumeReservation - reservation:', reservation);
  
  // Problem is already selected by QueueRoom, no need to select it here
  return { success: true, reservation };
}

export async function clearReservation(userId: string) {
  const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  
  if (!internalSecret) {
    console.error('INTERNAL_SERVICE_SECRET is not configured');
    return;
  }
  
  await fetch(`${base}/queue/clear`, { 
    method: 'POST', 
    headers: { 
      'Content-Type': 'application/json',
      'X-Internal-Secret': internalSecret,
      'X-Service-Name': 'nextjs-actions'
    }, 
    body: JSON.stringify({ userId }) 
  });
}

