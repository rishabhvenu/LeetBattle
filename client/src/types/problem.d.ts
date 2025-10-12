export type ProblemDifficulty = "Easy" | "Medium" | "Hard";
export type ProblemExample = {
  input: string;
  output: string;
  explanation: string | null;
};
export type ProblemSignature = {
  functionName: string;
  parameters: { name: string; type: string }[];
  returnType: string;
};
export type ProblemSolutions = {
  python?: string;
  cpp?: string;
  java?: string;
  js?: string;
  [key: string]: string | undefined;
};
export type ProblemTestCase = {
  input: Record<string, unknown>;
  output: unknown;
};
export type ProblemData = {
  title: string;
  difficulty: ProblemDifficulty;
  topics: string[];
  description: string;
  examples: ProblemExample[];
  constraints: string[];
  signature?: ProblemSignature;
  solutions?: ProblemSolutions;
  testCases?: ProblemTestCase[];
};
