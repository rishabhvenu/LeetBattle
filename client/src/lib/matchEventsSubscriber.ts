'use server';

import { getRedis, RedisKeys } from './redis';
import { MongoClient } from 'mongodb';

const g: any = globalThis as any;
let started = g.__match_sub_started__ || false;
g.__match_sub_started__ = true;

export async function ensureMatchEventsSubscriber() {
  if (started) return;
  started = true;
  const redis = getRedis();
  const sub = redis.duplicate();
  sub.subscribe(RedisKeys.matchEventsChannel, (err) => {
    if (err) { started = false; return; }
  });
  sub.on('message', async (_channel, message) => {
    try {
      const evt = JSON.parse(message);
      if (evt.type === 'match_end') {
        await handleMatchEnd(evt.matchId);
      } else if (evt.type === 'submission_result' && evt.scope === 'competitive') {
        // No-op immediate persist; we persist on match_end for idempotency
      }
    } catch {}
  });
  if (process.env.NODE_ENV !== 'production') console.log('[matchSub] listening on events:match');
}

async function handleMatchEnd(matchId: string) {
  try {
    const redis = getRedis();
    const raw = await redis.get(RedisKeys.matchKey(matchId));
    if (!raw) return;
    const state = JSON.parse(raw);
    const { persistMatchFromState } = await import('./actions');
    // persist competitive submissions and match document
    // @ts-ignore
    await persistMatchFromState(state);
  } catch {}
}


