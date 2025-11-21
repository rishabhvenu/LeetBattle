import { TestCaseResult } from '@/components/Running';

export interface MatchClientProps {
  userId: string;
  username: string;
  userAvatar?: string | null;
  isGuest?: boolean;
  guestMatchData?: unknown;
}

export interface ProblemSignature {
  functionName: string;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
}

export interface ProblemExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface Problem {
  _id: string;
  title: string;
  description: string;
  difficulty: string;
  signature?: ProblemSignature;
  testCasesCount?: number;
  starterCode?: Record<string, string>;
  topics?: string[];
  examples?: ProblemExample[];
  constraints?: string[];
}

export interface OpponentStats {
  name: string;
  avatar: string | null;
  globalRank: number;
  gamesWon: number;
  winRate: number;
  rating: number;
}

export interface UserStats {
  rating: number;
  winRate: number;
  totalMatches: number;
}

export interface MatchResult {
  winner: boolean;
  draw: boolean;
}

export interface RatingChange {
  oldRating: number;
  newRating: number;
  change: number;
}

export type RatingChanges = Record<string, RatingChange>;

export interface TestSummary {
  passed: number;
  total: number;
}

export interface ErrorType {
  type: string;
  label: string;
}

export interface BackendSubmission {
  complexityFailed?: boolean;
  timestamp: string;
  language: string;
  code?: string;
  testResults?: Array<{ status: number }>;
  averageTime?: number;
  averageMemory?: number;
  derivedComplexity?: string;
  expectedComplexity?: string;
  passed?: boolean;
}

export interface FailedTestCase {
  input?: string;
  expected?: string;
  actual?: string;
}

export interface FormattedSubmission {
  id: string | number;
  status: string;
  errorType: string;
  language: string;
  time: string;
  date: string;
  timestamp: string;
  code: string;
  passedTests: number;
  totalTests: number;
  runtime: string;
  memory: string;
  timeComplexity: string;
  expectedComplexity?: string;
  spaceComplexity: string;
  complexityError?: string;
  compileError?: string;
  runtimeError?: string;
  systemError?: string;
  timeoutError?: string;
  memoryError?: string;
  failedTestCase?: FailedTestCase;
}

export interface CodeUpdatePayload {
  userId: string;
  language: string;
  code: string;
  lines: number;
}

export interface MatchInitPayload {
  startedAt?: string;
  linesWritten?: Record<string, number>;
}

export interface NewSubmissionPayload {
  userId: string;
  submission: BackendSubmission;
}

export interface TestSubmissionResultPayload {
  userId: string;
  testResults: TestCaseResult[];
}

export interface SubmissionResultPayload {
  userId: string;
  allPassed?: boolean;
  submission?: BackendSubmission;
}

export interface ComplexityFailedPayload {
  userId: string;
  expectedComplexity?: string;
  derivedComplexity?: string;
  language?: string;
}

export interface TestProgressUpdatePayload {
  userId: string;
  testsPassed: number;
}

export interface MatchWinnerPayload {
  userId: string;
  ratingChanges?: RatingChanges;
}

export interface MatchDrawPayload {
  ratingChanges?: RatingChanges;
}

export interface RateLimitPayload {
  action: string;
}

