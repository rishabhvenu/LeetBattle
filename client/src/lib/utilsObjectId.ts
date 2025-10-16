import { ObjectId } from 'mongodb';

export function isValidObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

export function toObjectId(value: string | ObjectId): ObjectId {
  if (value instanceof ObjectId) return value;
  if (isValidObjectIdString(value)) return new ObjectId(value);
  throw new Error('Invalid ObjectId value');
}

export function tryToObjectId(value: unknown): ObjectId | null {
  if (value instanceof ObjectId) return value;
  if (isValidObjectIdString(value)) return new ObjectId(value);
  return null;
}

export function serializeId(id: ObjectId | string): string {
  return id instanceof ObjectId ? id.toString() : String(id);
}


