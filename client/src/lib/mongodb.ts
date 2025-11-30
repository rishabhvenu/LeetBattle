import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';

// Trigger rebuild with updated MONGODB_URI secret
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
}

// Disable MongoDB debugging
mongoose.set('debug', false);

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      // Disable additional logging
      autoIndex: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 3000,  // Reduced to 3s - fail fast if MongoDB unavailable
      socketTimeoutMS: 5000,  // Reduced to 5s - fail faster
      connectTimeoutMS: 3000,  // Reduced to 3s - connection timeout
      heartbeatFrequencyMS: 10000,
      retryWrites: false,  // Disable retries to fail fast
    };

    // Add timeout wrapper to prevent hanging (5 second total timeout - more aggressive)
    cached.promise = Promise.race([
      mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
        // Silently connect - no logging
        return mongoose;
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('MongoDB connection timeout after 5s')), 5000)
      ),
    ]).catch((error) => {
      console.error('MongoDB connection error:', error.message);
      cached.promise = null; // Reset on error so we can retry
      throw error;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

// MongoClient singleton for native driver operations
let clientPromise: Promise<MongoClient> | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (!clientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      monitorCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 3000,  // Reduced to 3s - fail fast if MongoDB unavailable
      socketTimeoutMS: 5000,  // Reduced to 5s - fail faster
      connectTimeoutMS: 3000,  // Reduced to 3s - connection timeout
      retryWrites: false,  // Disable retries to fail fast
    });
    // Add timeout wrapper to prevent hanging (5 second total timeout - more aggressive)
    clientPromise = Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => 
        setTimeout(() => {
          clientPromise = null; // Reset on timeout so we can retry
          reject(new Error('MongoDB client connection timeout after 5s'));
        }, 5000)
      ),
    ]);
  }
  return clientPromise;
}

export default connectDB;
