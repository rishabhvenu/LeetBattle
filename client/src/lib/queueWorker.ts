'use server';

import { getRedis, RedisKeys } from './redis';
import fs from 'fs';
import path from 'path';

const g: any = globalThis as any;
let started = g.__queue_worker_started__ || false;
g.__queue_worker_started__ = true;

export async function ensureQueueWorker() {
  if (started) return;
  started = true;
  const intervalMs = 1000;
  setInterval(tick, intervalMs);
  if (process.env.NODE_ENV !== 'production') console.log('[queueWorker] started');
}

async function tick() {
  try {
    const redis = getRedis();
    const entries = await redis.zrange('queue:elo', 0, 19, 'WITHSCORES');
    if (!entries || entries.length < 4) return; // need at least 2 users

    const queued: { userId: string; rating: number }[] = [];
    for (let i = 0; i < entries.length; i += 2) {
      queued.push({ userId: entries[i], rating: parseFloat(entries[i + 1]) });
    }

    queued.sort((a, b) => a.rating - b.rating);
    let bestPair: [string, string] | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < queued.length - 1; i++) {
      const diff = Math.abs(queued[i].rating - queued[i + 1].rating);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestPair = [queued[i].userId, queued[i + 1].userId];
      }
    }
    if (!bestPair) return;

    const [u1, u2] = bestPair;
    const rem = await redis.zrem('queue:elo', u1, u2);
    if (!rem) return; // another worker took it

    const problemId = await chooseProblemId();
    const base = process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!;
    await fetch(`${base}/admin/create-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: [u1, u2], problemId })
    });
    if (process.env.NODE_ENV !== 'production') console.log('[queueWorker] created match for', u1, u2, 'problem', problemId);
  } catch {}
}

async function chooseProblemId(): Promise<string> {
  try {
    const file = path.join(process.cwd(), 'src', 'problems.json');
    const raw = fs.readFileSync(file, 'utf-8');
    const obj = JSON.parse(raw);
    const keys = Object.keys(obj);
    if (!keys.length) return '000000000000000000000000';
    const difficulty = process.env.MATCH_DIFFICULTY || 'Medium';
    const filtered = keys.filter((k) => obj[k]?.difficulty === difficulty);
    const pool = filtered.length ? filtered : keys;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    // For now, we use the problem key as problemId; in the future map to Mongo ObjectId
    return pick;
  } catch {
    return '000000000000000000000000';
  }
}


