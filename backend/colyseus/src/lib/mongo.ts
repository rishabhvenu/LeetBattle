import { MongoClient, Db } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is required');
}

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'codeclashers';

let cachedClient: MongoClient | null = null;
let connectingPromise: Promise<MongoClient> | null = null;

async function createClient(): Promise<MongoClient> {
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    monitorCommands: false,
  });
  await client.connect();
  return client;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (cachedClient) {
    return cachedClient;
  }

  if (!connectingPromise) {
    connectingPromise = createClient()
      .then((client) => {
        cachedClient = client;
        return client;
      })
      .catch((error) => {
        connectingPromise = null;
        throw error;
      });
  }

  return connectingPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(DB_NAME);
}

export function getDbName(): string {
  return DB_NAME;
}

