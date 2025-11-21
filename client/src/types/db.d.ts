import type { ObjectId } from 'mongodb';

export type SpecialInputType =
  | 'linked_list_cycle';

export interface SpecialInputConfig {
  id: string;
  type: SpecialInputType;
  label?: string;
  description?: string;
  targets: Array<{
    parameter: string;
    role?: 'input' | 'output';
  }>;
  options?: Record<string, unknown>;
}

// Core User document - stores identity, auth, avatar URL, and linkage to matches
export interface UserDoc {
  _id: ObjectId;
  username: string;               // unique
  email: string;                  // unique
  passwordHash: string;           // bcrypt hash
  avatarUrl?: string;             // full URL to S3/MinIO object
  createdAt: Date;                // join date
  // Linkage (do not denormalize wins/losses). Query via matches by userId.
  matchIds?: ObjectId[];          // optional cached linkage for faster lookups
}

// Problem document - source of truth for problems used in matches
export interface ProblemDoc {
  _id: ObjectId;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topics: string[];
  description: string;
  examples: { input: string; output: string; explanation: string | null }[];
  constraints: string[];
  timeComplexity?: string; // Target time complexity (e.g., "O(n)", "O(n log n)")
  signature?: {
    functionName: string;
    parameters: { name: string; type: string }[];
    returnType: string;
  };
  solutions?: {
    python?: string;
    cpp?: string;
    java?: string;
    js?: string;
    [key: string]: string | undefined;
  };
  testCases?: Array<{
    input: Record<string, unknown>;
    output: unknown;
    specialInputData?: Record<string, Record<string, unknown>>;
  }>;
  specialInputs?: SpecialInputConfig[];
  verified?: boolean;
  verifiedAt?: Date;
  verificationResults?: Record<string, unknown>;
  verificationError?: string[];
  allTestCases?: Record<string, Array<{
    testNumber: number;
    input: unknown;
    expected: unknown;
    actual: unknown;
    error?: string;
    passed: boolean;
  }>>;
  failedTestCases?: Record<string, Array<{
    testNumber: number;
    input: unknown;
    expected: unknown;
    actual: unknown;
    error?: string;
  }>>;
  createdAt: Date;
  updatedAt: Date;
}

// Submission document - stores Judge0 submission linkage and outputs
export interface SubmissionDoc {
  _id: ObjectId;
  userId: ObjectId;               // ref -> UserDoc
  matchId?: ObjectId;             // ref -> MatchDoc (optional for practice/test runs)
  problemId: ObjectId;            // ref -> ProblemDoc
  judge0SubmissionId?: string;    // external ID from Judge0
  language: string;               // e.g., 'python', 'cpp'
  sourceCode: string;             // optional long text; consider storing separately if needed
  stdout?: string | null;
  stderr?: string | null;
  compileOutput?: string | null;
  status?: {
    id: number;
    description: string;
  } | null;
  time?: string | null;
  memory?: string | null;
  submissionType?: 'match' | 'test'; // Single collection for both submissions and test runs
  createdAt: Date;
}

// Match document - stores competitive match metadata and relationships
export interface MatchDoc {
  _id: ObjectId;
  playerIds: ObjectId[];          // [userId1, userId2]
  problemId: ObjectId;            // ref -> ProblemDoc
  submissionIds: ObjectId[];      // ref -> SubmissionDoc[] (competitive submissions)
  testRunIds?: ObjectId[];        // ref -> SubmissionDoc[] with submissionType='test' (optional)
  winnerUserId?: ObjectId | null; // ref -> UserDoc (null for draw)
  endedAt?: Date;                 // end timestamp of the match
  startedAt?: Date;               // start timestamp of the match
  createdAt?: Date;               // creation timestamp of the match
  // Additional metadata
  mode?: 'public' | 'private';
  ratingDelta?: number;           // optional rating change
  status: 'ongoing' | 'finished'; // current status of the match
  botStats?: Record<string, {     // Bot statistics for this match
    submissions: number;          // Number of submissions made by bot
    testCasesSolved: number;      // Number of test cases solved by bot
  }>;
}

// Suggested collection names (to keep consistency across codebase)
export const COLLECTIONS = {
  users: 'users',
  matches: 'matches',
  submissions: 'submissions',
  problems: 'problems',
} as const;

// Suggested MongoDB indexes (to be created via migration/setup script)
export const INDEX_SUGGESTIONS = {
  users: [
    { key: { username: 1 }, unique: true },
    { key: { email: 1 }, unique: true },
    { key: { createdAt: -1 } },
  ],
  matches: [
    { key: { playerIds: 1 } },
    { key: { problemId: 1 } },
    { key: { endedAt: -1 } },
    { key: { status: 1 } },
  ],
  submissions: [
    { key: { userId: 1 } },
    { key: { matchId: 1 } },
    { key: { problemId: 1 } },
    { key: { submissionType: 1 } },
    { key: { createdAt: -1 } },
  ],
  problems: [
    { key: { difficulty: 1 } },
    { key: { topics: 1 } },
    { key: { title: 1 } },
  ],
} as const;


