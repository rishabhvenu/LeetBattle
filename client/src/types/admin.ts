import type { SpecialInputConfig } from '@/types/db';

export interface ProblemExample {
  input: string;
  output: string;
  explanation: string;
}

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface ProblemSignature {
  functionName: string;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
  comparisonMode?: 'strict' | 'unordered' | 'set' | 'custom';
  customComparator?: string;
}

export interface ProblemSolutions {
  python?: string;
  cpp?: string;
  java?: string;
  js?: string;
}

export interface ProblemTestCase {
  input: Record<string, unknown>;
  output: unknown;
  specialInputData?: Record<string, Record<string, unknown>>;
}

export interface TestCaseResult {
  testNumber: number;
  input: unknown;
  expected: unknown;
  actual: unknown;
  error?: string;
  passed: boolean;
}

export interface FailedTestCase {
  testNumber: number;
  input: unknown;
  expected: unknown;
  actual: unknown;
  error?: string;
}

export interface AdminProblem {
  _id: string;
  title: string;
  difficulty: Difficulty;
  topics: string[];
  description: string;
  examples: Array<{
    input: string;
    output: string;
    explanation: string | null;
  }>;
  constraints: string[];
  timeComplexity?: string;
  signature?: ProblemSignature;
  solutions?: ProblemSolutions;
  testCases?: ProblemTestCase[];
  specialInputs?: SpecialInputConfig[];
  createdAt: string;
  updatedAt: string;
  verified?: boolean;
  verifiedAt?: string | null;
  verificationResults?: Record<string, unknown>;
  verificationError?: string[];
  allTestCases?: Record<string, TestCaseResult[]>;
  failedTestCases?: Record<string, FailedTestCase[]>;
}

export type SpecialInputCategory = 'none' | 'linked_list_cycle';

export interface SpecialInputHint {
  type: SpecialInputCategory;
  parameterName: string;
}

export interface ProblemFormData {
  title: string;
  difficulty: Difficulty;
  description: string;
  examples: ProblemExample[];
  constraints: string[];
  timeComplexity: string;
}

export interface LeetCodeProblemDetails {
  title?: string;
  difficulty?: Difficulty;
  description?: string;
  constraints?: string[];
  examples?: Array<{
    input?: string;
    output?: string;
    explanation?: string;
  }>;
}

