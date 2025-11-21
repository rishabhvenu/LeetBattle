import { getRedis, RedisKeys } from '../lib/redis';

export interface RoomInfoPayload {
  players?: Array<{ userId: string; username: string }>;
  creatorId?: string;
  status?: string;
  matchId?: string;
  matchRoomId?: string;
  problemId?: string;
  [key: string]: unknown;
}

export async function loadRoomInfo(roomCode: string): Promise<RoomInfoPayload | null> {
  const redis = getRedis();
  const raw = await redis.get(`private:room:${roomCode}:info`);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse room info blob:', error);
    return null;
  }
}

export async function mergePlayersInRoomInfo(
  roomCode: string,
  players: Map<string, { userId: string; username: string }>,
  updates: Partial<RoomInfoPayload> = {},
): Promise<RoomInfoPayload | null> {
  const redis = getRedis();
  const infoKey = `private:room:${roomCode}:info`;
  const raw = await redis.get(infoKey);

  let blob: RoomInfoPayload = {};
  if (raw) {
    try {
      blob = JSON.parse(raw);
    } catch (error) {
      console.error('Failed to parse existing room info blob:', error);
    }
  }
  const existingPlayers: Array<{ userId: string; username: string }> = Array.isArray(blob.players) ? blob.players : [];
  const inMemoryPlayers = Array.from(players.values()).map((p) => ({ userId: p.userId, username: p.username }));

  const mergedMap = new Map<string, { userId: string; username: string }>();
  for (const p of existingPlayers) mergedMap.set(p.userId, p);
  for (const p of inMemoryPlayers) mergedMap.set(p.userId, p);

  blob.players = Array.from(mergedMap.values());
  blob = { ...blob, ...updates };

  await redis.setex(infoKey, 1800, JSON.stringify(blob));
  return blob;
}

export async function cleanupPrivateRoomKeys(roomCode: string) {
  const redis = getRedis();
  await redis.del(`private:room:${roomCode}`);
  await redis.del(`private:room:${roomCode}:info`);
  await redis.del(`private:room:${roomCode}:players`);
}

export async function broadcastRoomInfo(room: any, payload: RoomInfoPayload | null) {
  if (payload && typeof room?.broadcast === 'function') {
    room.broadcast('room_info', payload);
  }
}

export async function setMatchBlob(
  matchId: string,
  updates: (current: Record<string, any>) => void | Record<string, any>,
  ttlSeconds = 3600,
) {
  const redis = getRedis();
  const key = RedisKeys.matchKey(matchId);
  const raw = await redis.get(key);
  let obj = raw ? JSON.parse(raw) : {};

  const updateResult = updates(obj);
  if (updateResult && typeof updateResult === 'object') {
    obj = updateResult;
  }

  await redis.set(key, JSON.stringify(obj));
  await redis.expire(key, ttlSeconds);
}

