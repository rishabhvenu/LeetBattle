import type { ErrorType } from '@/types/match';

/**
 * Helper function to determine error type from Judge0 status
 */
export function getErrorType(status: number): ErrorType {
  switch (status) {
    case 6: return { type: 'compile', label: 'Compile Error' };
    case 11: return { type: 'runtime', label: 'Runtime Error' };
    case 5: return { type: 'timeout', label: 'Time Limit Exceeded' };
    case 4: return { type: 'wrong', label: 'Wrong Answer' };
    case 12: return { type: 'memory', label: 'Memory Limit Exceeded' };
    case 13: return { type: 'system', label: 'System Error' };
    default: return { type: 'wrong', label: 'Wrong Answer' };
  }
}

