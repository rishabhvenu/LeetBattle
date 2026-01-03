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
    cached.conn = null; // Clear connection on error
    // Try to close mongoose connection if it exists
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
      }
    } catch (closeError) {
      // Ignore close errors
    }
    throw e;
  }

  return cached.conn;
}

// MongoClient singleton for native driver operations
let clientPromise: Promise<MongoClient> | null = null;
let clientInstance: MongoClient | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  // Check if existing client is still connected
  if (clientInstance) {
    try {
      // Quick ping to verify connection is alive
      await Promise.race([
        clientInstance.db().command({ ping: 1 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ping timeout')), 1000))
      ]);
      return clientInstance;
    } catch {
      // Connection is stale, reset and reconnect
      clientPromise = null;
      clientInstance = null;
      try { await clientInstance?.close(); } catch { /* ignore */ }
    }
  }
  
  if (!clientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      monitorCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,  // Increased for pod restart tolerance
      socketTimeoutMS: 10000,  // Increased for pod restart tolerance
      connectTimeoutMS: 5000,  // Increased for pod restart tolerance
      retryWrites: true,  // Enable retries for resilience
      retryReads: true,   // Enable read retries
      family: 4,          // Force IPv4 to avoid IPv6 issues
    });
    
    // Listen for connection events to reset client on disconnect
    client.on('close', () => {
      clientPromise = null;
      clientInstance = null;
    });
    
    // Add timeout wrapper to prevent hanging (10 second total timeout for pod restart tolerance)
    clientPromise = Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => 
        setTimeout(() => {
          clientPromise = null; // Reset on timeout so we can retry
          clientInstance = null;
          // Try to close the client if connection attempt is hanging
          try {
            client.close().catch(() => {}); // Ignore close errors
          } catch {
            // Ignore
          }
          reject(new Error('MongoDB client connection timeout after 10s'));
        }, 10000)
      ),
    ]).then((connectedClient) => {
      clientInstance = connectedClient;
      return connectedClient;
    }).catch((error) => {
      clientPromise = null; // Reset on any error
      clientInstance = null;
      // Try to close the client
      try {
        client.close().catch(() => {}); // Ignore close errors
      } catch {
        // Ignore
      }
      throw error;
    });
  }
  return clientPromise;
}

export default connectDB;
