/**
 * Test Executor Service
 * Executes solution code against test cases using Judge0
 */

import { generateBatchRunnableCode, getJudge0LanguageId, compareOutputs } from './codeRunner';
import { submitToJudge0, pollJudge0 } from './judge0';

interface FunctionSignature {
  functionName: string;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
}

interface TestCase {
  input: Record<string, unknown>;
  output: unknown;
}

interface TestResult {
  passed: boolean;
  testCase: TestCase;
  actualOutput?: unknown;
  error?: string;
  executionTime?: string;
  memory?: string;
  testNumber?: number;
  status?: {
    id: number;
    description: string;
  };
}

interface ExecutionResult {
  allPassed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
  averageTime?: number;
  averageMemory?: number;
}


/**
 * Execute all test cases for a solution using batch submission
 */
export async function executeAllTestCases(
  language: 'python' | 'javascript' | 'java' | 'cpp',
  solutionCode: string,
  signature: FunctionSignature,
  testCases: TestCase[]
): Promise<ExecutionResult> {
  return await executeBatchTestCases(language, solutionCode, signature, testCases);
}

/**
 * Execute test cases using batch submission
 */
async function executeBatchTestCases(
  language: 'python' | 'javascript' | 'java' | 'cpp',
  solutionCode: string,
  signature: FunctionSignature,
  testCases: TestCase[]
): Promise<ExecutionResult> {
  try {
    // Generate batch code
    const batchCode = generateBatchRunnableCode(language, solutionCode, signature, testCases);
    
    // Get Judge0 language ID
    const languageId = getJudge0LanguageId(language);
    
    // Submit to Judge0
    console.log(`Submitting ${language} batch with ${testCases.length} test cases...`);
    const submission = await submitToJudge0(languageId, batchCode);
    const token = submission.token;
    console.log(`Batch submission token: ${token}`);
    
    // Poll for result
    let result = await pollJudge0(token);
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts × 2s = 60 seconds max
    
    while (result.status.id <= 2 && attempts < maxAttempts) {
      console.log(`${language} batch attempt ${attempts + 1}/${maxAttempts}: Status ${result.status.id} (${result.status.description})`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2 seconds
      result = await pollJudge0(token);
      attempts++;
    }
    
    console.log(`${language} batch final status: ${result.status.id} (${result.status.description})`);
  
  // Log detailed error information
  if (result.status.id !== 3) {
    console.error(`${language} batch execution failed:`, {
      status: result.status,
      stderr: result.stderr,
      compile_output: result.compile_output,
      stdout: result.stdout,
      message: result.message,
    });
  }
  
  // Check if execution was successful
  if (result.status.id !== 3) {
    // For general execution errors (like 400 UTF-8 errors), we still want to show
    // which specific test cases would have been tested, but mark them all as failed
    // due to the general error
    const generalError = result.stderr || result.compile_output || result.message || result.status.description;
    
    return {
      allPassed: false,
      totalTests: testCases.length,
      passedTests: 0,
      failedTests: testCases.length,
      results: testCases.map((testCase, index) => ({
        passed: false,
        testCase,
        actualOutput: undefined, // No actual output due to general error
        error: `General execution error: ${generalError}`,
        status: result.status,
        executionTime: result.time,
        memory: result.memory,
        testNumber: index + 1, // Add test number for better identification
      })),
      averageTime: result.time ? parseFloat(result.time) : undefined,
      averageMemory: result.memory ? parseFloat(result.memory) : undefined,
    };
  }
  
  // Parse batch output (guard against null/undefined stdout)
  const batchOutput = result.stdout?.trim() || '';
  if (!batchOutput) {
    return {
      allPassed: false,
      totalTests: testCases.length,
      passedTests: 0,
      failedTests: testCases.length,
      results: testCases.map((testCase, index) => ({
        passed: false,
        testCase,
        actualOutput: undefined,
        error: 'No output from code execution',
        status: result.status,
        testNumber: index + 1,
      })),
    };
  }
  
  const results: TestResult[] = [];
  
  // Parse each test result from batch output
  const lines = batchOutput.split('\n');
  for (let i = 0; i < testCases.length && i < lines.length; i++) {
    const line = lines[i];
    const testCase = testCases[i];
    
    // Parse "Test X: {result}" format
    const match = line.match(/Test \d+: (.+)/);
    if (match) {
      try {
        const actualOutput = JSON.parse(match[1]);
        const passed = compareOutputs(testCase.output, actualOutput);
        
        results.push({
          passed,
          testCase,
          actualOutput,
          executionTime: result.time,
          memory: result.memory,
          status: passed ? { id: 3, description: 'Accepted' } : { id: 4, description: 'Wrong Answer' },
          testNumber: i + 1,
        });
      } catch (error) {
        results.push({
          passed: false,
          testCase,
          actualOutput: undefined,
          error: `Failed to parse output: ${match[1]}`,
          executionTime: result.time,
          memory: result.memory,
          status: { id: 6, description: 'Runtime Error' },
          testNumber: i + 1,
        });
      }
    } else {
      results.push({
        passed: false,
        testCase,
        actualOutput: undefined,
        error: `Unexpected output format: ${line}`,
        executionTime: result.time,
        memory: result.memory,
        status: { id: 4, description: 'Wrong Answer' },
        testNumber: i + 1,
      });
    }
  }
  
  // Fill remaining test cases as failed if not enough results
  while (results.length < testCases.length) {
    const testCase = testCases[results.length];
    results.push({
      passed: false,
      testCase,
      actualOutput: undefined,
      error: 'No result from batch execution',
      status: { id: 4, description: 'Wrong Answer' },
      testNumber: results.length + 1,
    });
  }
  
  // Calculate statistics
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = results.length - passedTests;
  
  return {
    allPassed: passedTests === results.length,
    totalTests: results.length,
    passedTests,
    failedTests,
    results,
    averageTime: result.time ? parseFloat(result.time) : undefined,
    averageMemory: result.memory ? parseFloat(result.memory) : undefined,
  };
  } catch (error) {
    // Handle Judge0 errors or other execution failures
    console.error(`Judge0 execution error for ${language}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown execution error';
    
    return {
      allPassed: false,
      totalTests: testCases.length,
      passedTests: 0,
      failedTests: testCases.length,
      results: testCases.map((testCase, index) => ({
        passed: false,
        testCase,
        actualOutput: undefined,
        error: errorMessage,
        status: {
          id: 13,  // Internal Error
          description: 'System Error'
        },
        testNumber: index + 1,
      })),
    };
  }
}



/**
 * Validate solution against stored test cases (useful for verifying generated solutions)
 */
export async function validateSolution(
  language: 'python' | 'javascript' | 'java' | 'cpp',
  solutionCode: string,
  problem: {
    signature: FunctionSignature;
    testCases: TestCase[];
  }
): Promise<ExecutionResult> {
  return executeAllTestCases(
    language,
    solutionCode,
    problem.signature,
    problem.testCases
  );
}

