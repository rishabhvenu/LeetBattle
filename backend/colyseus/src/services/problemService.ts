import { ObjectId } from 'mongodb';
import { getMongoClient, getDbName } from '../lib/mongo';
import { getProblemWithTestCases } from '../lib/problemData';

export interface ProblemSelectionOptions {
  selectedProblemId?: string | null;
  difficulty?: string;
  verifiedOnly?: boolean;
}

export interface ProblemSelectionResult {
  problemId: string;
  difficulty: string;
  problemData: Awaited<ReturnType<typeof getProblemWithTestCases>>;
}

function normalizeDifficulty(input?: string): string {
  if (!input) {
    return 'Medium';
  }
  const value = input.toLowerCase();
  if (value === 'easy' || value === 'medium' || value === 'hard') {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return 'Medium';
}

export async function selectProblem(options: ProblemSelectionOptions = {}): Promise<ProblemSelectionResult> {
  const difficulty = normalizeDifficulty(options.difficulty);

  if (options.selectedProblemId) {
    const problemData = await getProblemWithTestCases(options.selectedProblemId);
    if (!problemData) {
      throw new Error(`Problem not found: ${options.selectedProblemId}`);
    }
    return {
      problemId: options.selectedProblemId,
      difficulty: problemData.difficulty ?? difficulty,
      problemData,
    };
  }

  const client = await getMongoClient();
  const db = client.db(getDbName());
  const problems = db.collection('problems');

  const baseMatch: Record<string, any> = { difficulty };
  if (options.verifiedOnly !== false) {
    baseMatch.verified = true;
  }

  const candidates = await problems.aggregate([{ $match: baseMatch }, { $sample: { size: 1 } }]).toArray();

  if (candidates.length === 0) {
    const fallbackMatch: Record<string, any> = {};
    if (options.verifiedOnly !== false) {
      fallbackMatch.verified = true;
    }
    const fallbackCandidates = await problems.aggregate([{ $match: fallbackMatch }, { $sample: { size: 1 } }]).toArray();
    if (fallbackCandidates.length === 0) {
      throw new Error('No problems available for selection');
    }
    const fallbackId = fallbackCandidates[0]._id.toString();
    const problemData = await getProblemWithTestCases(fallbackId);
    if (!problemData) {
      throw new Error(`Problem not found: ${fallbackId}`);
    }
    return {
      problemId: fallbackId,
      difficulty: problemData.difficulty ?? difficulty,
      problemData,
    };
  }

  const selected = candidates[0];
  const selectedId = selected._id instanceof ObjectId ? selected._id.toString() : selected._id;
  const problemData = await getProblemWithTestCases(selectedId);
  if (!problemData) {
    throw new Error(`Problem not found: ${selectedId}`);
  }

  return {
    problemId: selectedId,
    difficulty: problemData.difficulty ?? difficulty,
    problemData,
  };
}

