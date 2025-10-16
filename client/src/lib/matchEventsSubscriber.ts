'use server';

import { getRedis, RedisKeys } from './redis';
import { MongoClient } from 'mongodb';

const g: any = globalThis as any;
let started = g.__match_sub_started__ || false;
g.__match_sub_started__ = true;

export async function ensureMatchEventsSubscriber() {
  // Backend (Colyseus) is now authoritative for persistence.
  // Intentionally no-op to avoid double-writing ratings or matches.
  started = true;
  if (process.env.NODE_ENV !== 'production') console.log('[matchSub] disabled - backend authoritative');
}

async function handleMatchEnd(matchId: string) {
  // Intentionally disabled - backend persists ratings and match documents.
  return;
}


