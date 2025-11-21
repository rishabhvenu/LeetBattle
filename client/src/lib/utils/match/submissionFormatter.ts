import type { BackendSubmission, FormattedSubmission } from '@/types/match';
import { getRelativeTime } from './timeUtils';
import { getErrorType } from './errorHandling';

/**
 * Format backend submission to UI format
 */
export function formatSubmission(submission: unknown): FormattedSubmission {
  const sub = submission as BackendSubmission;
  
  // Check if this is a complexity failed submission
  if (sub.complexityFailed) {
    return {
      id: sub.timestamp,
      status: 'Time Complexity Failed',
      errorType: 'complexity',
      language: sub.language.charAt(0).toUpperCase() + sub.language.slice(1),
      time: getRelativeTime(sub.timestamp),
      date: getRelativeTime(sub.timestamp),
      timestamp: sub.timestamp,
      code: sub.code || '// Code not available',
      passedTests: sub.testResults?.filter((t) => t.status === 3).length || 0,
      totalTests: sub.testResults?.length || 0,
      runtime: sub.averageTime ? `${sub.averageTime} ms` : '—',
      memory: sub.averageMemory ? `${sub.averageMemory} MB` : '—',
      timeComplexity: sub.derivedComplexity || 'Unknown',
      expectedComplexity: sub.expectedComplexity,
      spaceComplexity: 'O(1)',
      complexityError: 'All tests passed, but your solution does not meet the required time complexity.'
    };
  }
  
  const firstFailedTest = sub.testResults?.find((t) => t.status !== 3 && ((t as unknown) as { status?: { id?: number } }).status?.id !== 3);
  const firstFailedTestDetails = firstFailedTest as (undefined | { error?: string; input?: string; expectedOutput?: string; userOutput?: string });
  const firstFailedError = firstFailedTestDetails?.error;
  const actualPassedTests = sub.testResults?.filter((t) => t.status === 3 || ((t as unknown) as { status?: { id?: number } }).status?.id === 3).length || 0;
  const totalTests = sub.testResults?.length || 0;
  
  let status = 'Accepted';
  let errorType = { type: '', label: '' };
  
  // Check if submission passed or failed
  if (!(sub as { passed?: boolean }).passed) {
    // Submission failed - determine why
    if (firstFailedTest) {
      const statusId = typeof firstFailedTest.status === 'number' ? firstFailedTest.status : ((firstFailedTest as unknown) as { status?: { id?: number } }).status?.id;
      errorType = getErrorType(statusId || 4);
      status = errorType.label;
    } else {
      // No test results but marked as failed
      status = 'Wrong Answer';
      errorType = { type: 'wrong', label: 'Wrong Answer' };
    }
  } else if (totalTests > 0 && actualPassedTests !== totalTests) {
    // Has test results but not all passed (shouldn't happen if submission.passed is true, but handle it)
    const statusId = typeof firstFailedTest?.status === 'number' ? firstFailedTest.status : ((firstFailedTest as unknown) as { status?: { id?: number } }).status?.id;
    errorType = getErrorType(statusId || 4);
    status = errorType.label;
  }

  return {
    id: sub.timestamp,
    status,
    errorType: errorType.type,
    language: sub?.language ? (sub.language.charAt(0).toUpperCase() + sub.language.slice(1)) : 'Unknown',
    time: getRelativeTime(sub.timestamp),
    date: getRelativeTime(sub.timestamp),
    timestamp: sub.timestamp,
    code: sub.code || '// Code not available',
    passedTests: actualPassedTests,
    totalTests: totalTests,
    runtime: sub.averageTime ? `${sub.averageTime} ms` : '—',
    memory: sub.averageMemory ? `${sub.averageMemory} MB` : '—',
    timeComplexity: 'O(n)', // Placeholder
    spaceComplexity: 'O(1)', // Placeholder
    compileError: firstFailedError && errorType.type === 'compile' ? firstFailedError : undefined,
    runtimeError: firstFailedError && errorType.type === 'runtime' ? firstFailedError : undefined,
    systemError: firstFailedError && errorType.type === 'system' ? firstFailedError : undefined,
    timeoutError: firstFailedError && errorType.type === 'timeout' ? firstFailedError : undefined,
    memoryError: firstFailedError && errorType.type === 'memory' ? firstFailedError : undefined,
    failedTestCase: firstFailedTest ? {
      input: (firstFailedTestDetails?.input) || '',
      expected: (firstFailedTest as unknown as { expectedOutput?: string })?.expectedOutput || '',
      actual: (firstFailedTest as unknown as { userOutput?: string })?.userOutput || '',
    } : undefined,
  };
}

