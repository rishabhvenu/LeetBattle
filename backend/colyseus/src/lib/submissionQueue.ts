/**
 * Submission Queue with Backpressure
 * Rate limits Judge0 submissions to prevent overload using p-queue
 */

import PQueue from 'p-queue';
import { CircuitBreaker, CircuitState } from './circuitBreaker';

export interface SubmissionQueueOptions {
  concurrency?: number;          // Max concurrent submissions
  intervalCap?: number;          // Max submissions per interval
  interval?: number;             // Interval in milliseconds
  timeout?: number;              // Timeout for individual submissions
  circuitBreakerOptions?: {
    failureThreshold?: number;
    successThreshold?: number;
    timeout?: number;
    resetTimeout?: number;
  };
}

export interface QueueStats {
  size: number;
  pending: number;
  isPaused: boolean;
  circuitState: CircuitState;
  circuitStats: {
    failures: number;
    successes: number;
    totalRequests: number;
    totalFailures: number;
    totalSuccesses: number;
  };
}

export class SubmissionQueue {
  private queue: PQueue;
  private circuitBreaker: CircuitBreaker;
  private submissionCount: number = 0;
  private errorCount: number = 0;

  constructor(options?: SubmissionQueueOptions) {
    // Create queue with concurrency and rate limiting
    this.queue = new PQueue({
      concurrency: options?.concurrency ?? 10,         // Max 10 concurrent
      intervalCap: options?.intervalCap ?? 20,         // Max 20 per interval
      interval: options?.interval ?? 1000,             // 1 second interval
      timeout: options?.timeout ?? 30000,              // 30 second timeout
      throwOnTimeout: true,
    });

    // Create circuit breaker
    this.circuitBreaker = new CircuitBreaker(options?.circuitBreakerOptions);

    console.log(
      '[SubmissionQueue] Initialized with ' +
      `concurrency=${options?.concurrency ?? 10}, ` +
      `intervalCap=${options?.intervalCap ?? 20}, ` +
      `interval=${options?.interval ?? 1000}ms`
    );
  }

  /**
   * Submit a task with backpressure and circuit breaker protection
   */
  async submit<T>(task: () => Promise<T>): Promise<T> {
    // Check circuit breaker first
    if (this.circuitBreaker.isOpen()) {
      const stats = this.circuitBreaker.getStats();
      throw new Error(
        `Circuit breaker is ${stats.state}: Judge0 service unavailable. ` +
        `Last failure: ${stats.lastFailureTime ? new Date(stats.lastFailureTime).toISOString() : 'never'}`
      );
    }

    // Check queue size for backpressure
    if (this.queue.size > 100) {
      throw new Error(
        `Submission queue overloaded: ${this.queue.size} tasks pending. ` +
        `Please try again later.`
      );
    }

    this.submissionCount++;

    // Add to queue and execute with circuit breaker protection
    try {
      const result = await this.queue.add(() =>
        this.circuitBreaker.execute(task)
      );
      return result;
    } catch (error) {
      this.errorCount++;
      
      // Enhance error message with queue context
      if (error instanceof Error) {
        if (error.message.includes('Timeout')) {
          throw new Error(
            `Submission timed out after ${this.queue.timeout}ms. ` +
            `Judge0 service may be overloaded.`
          );
        } else if (error.message.includes('Circuit breaker')) {
          // Circuit breaker error, pass through
          throw error;
        } else {
          throw new Error(`Submission failed: ${error.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const circuitStats = this.circuitBreaker.getStats();
    
    return {
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused,
      circuitState: circuitStats.state,
      circuitStats: {
        failures: circuitStats.failures,
        successes: circuitStats.successes,
        totalRequests: circuitStats.totalRequests,
        totalFailures: circuitStats.totalFailures,
        totalSuccesses: circuitStats.totalSuccesses,
      },
    };
  }

  /**
   * Check if queue is healthy
   */
  isHealthy(): boolean {
    const stats = this.getStats();
    return (
      stats.circuitState === CircuitState.CLOSED &&
      stats.size < 50 &&
      stats.pending < 8
    );
  }

  /**
   * Pause the queue
   */
  pause(): void {
    this.queue.pause();
    console.log('[SubmissionQueue] Paused');
  }

  /**
   * Resume the queue
   */
  resume(): void {
    this.queue.start();
    console.log('[SubmissionQueue] Resumed');
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue.clear();
    console.log('[SubmissionQueue] Cleared');
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    console.log('[SubmissionQueue] Circuit breaker reset');
  }

  /**
   * Wait for queue to be empty
   */
  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  /**
   * Get submission metrics
   */
  getMetrics() {
    const stats = this.getStats();
    return {
      totalSubmissions: this.submissionCount,
      totalErrors: this.errorCount,
      successRate:
        this.submissionCount > 0
          ? ((this.submissionCount - this.errorCount) / this.submissionCount) * 100
          : 100,
      queueSize: stats.size,
      pendingTasks: stats.pending,
      circuitState: stats.circuitState,
      isHealthy: this.isHealthy(),
    };
  }
}

// Global singleton instance
let globalSubmissionQueue: SubmissionQueue | null = null;

/**
 * Get or create the global submission queue instance
 */
export function getSubmissionQueue(options?: SubmissionQueueOptions): SubmissionQueue {
  if (!globalSubmissionQueue) {
    globalSubmissionQueue = new SubmissionQueue(options);
  }
  return globalSubmissionQueue;
}

/**
 * Reset the global submission queue (for testing)
 */
export function resetSubmissionQueue(): void {
  globalSubmissionQueue = null;
}

