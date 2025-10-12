/**
 * Problem Data Helper
 * Fetches complete problem data including testCases from MongoDB
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/codeclashers';
const DB_NAME = 'codeclashers';

let clientCache: MongoClient | null = null;

async function getMongoClient(): Promise<MongoClient> {
  if (clientCache) {
    try {
      // Test connection with ping
      await clientCache.db(DB_NAME).admin().ping();
      return clientCache;
    } catch (error) {
      // Connection lost, create new one
      clientCache = null;
    }
  }
  
  // Create MongoDB client with logging disabled
  clientCache = new MongoClient(MONGODB_URI, {
    monitorCommands: false,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  });
  await clientCache.connect();
  return clientCache;
}

/**
 * Get complete problem data including testCases
 * (testCases are not sent to clients for security)
 */
export async function getProblemWithTestCases(problemId: string) {
  try {
    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const problemsCollection = db.collection('problems');

    const problem = await problemsCollection.findOne({ 
      _id: new ObjectId(problemId) 
    });

    if (!problem) {
      console.error(`Problem not found: ${problemId}`);
      return null;
    }

    return {
      _id: problem._id.toString(),
      title: problem.title,
      difficulty: problem.difficulty,
      signature: problem.signature,
      testCases: problem.testCases || [],
      solutions: problem.solutions || {},
      timeComplexity: problem.timeComplexity
    };
  } catch (error) {
    console.error('Error fetching problem:', error);
    return null;
  }
}

