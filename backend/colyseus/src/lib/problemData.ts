/**
 * Problem Data Helper
 * Fetches complete problem data including testCases from MongoDB
 */

import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from './mongo';

const DB_NAME = getDbName();

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

    // Return ALL problem fields (testCases are server-only but we need them for execution)
    return {
      _id: problem._id.toString(),
      title: problem.title,
      description: problem.description,
      difficulty: problem.difficulty,
      signature: problem.signature,
      specialInputs: problem.specialInputs || problem.specialInputConfigs || [],
      testCases: (problem.testCases || []).map((testCase: { input: Record<string, unknown>; output: unknown; specialInputData?: Record<string, Record<string, unknown>>; specialInputs?: Record<string, Record<string, unknown>> }) => ({
        input: testCase.input,
        output: testCase.output,
        specialInputData: testCase.specialInputData || testCase.specialInputs || {},
      })),
      testCasesCount: (problem.testCases || []).length,
      solutions: problem.solutions || {},
      timeComplexity: problem.timeComplexity,
      examples: problem.examples || [],
      constraints: problem.constraints || [],
      topics: problem.topics || [],
      hints: problem.hints || [],
      starterCode: problem.starterCode || null,
      followUp: problem.followUp || null,
    };
  } catch (error) {
    console.error('Error fetching problem:', error);
    return null;
  }
}

