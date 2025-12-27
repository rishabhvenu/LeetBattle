/**
 * Circuit Breaker Pattern Implementation
 * Protects Judge0 service from overload by opening the circuit when failures exceed threshold
 */

export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN',     // Circuit is open, rejecting requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

export interface CircuitBreakerOptions {
  failureThreshold: number;      // Number of failures before opening
  successThreshold: number;      // Number of successes in half-open to close
  timeout: number;               // Milliseconds before attempting to close
  resetTimeout: number;          // Milliseconds to reset failure count
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastStateChangeTime: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number | null = null;
  private lastStateChangeTime: number = Date.now();
  private nextAttemptTime: number = 0;

  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;

  private readonly options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = {
      failureThreshold: options?.failureThreshold ?? 5,
      successThreshold: options?.successThreshold ?? 2,
      timeout: options?.timeout ?? 60000, // 1 minute
      resetTimeout: options?.resetTimeout ?? 30000, // 30 seconds
    };
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      
      // Check if timeout has expired, transition to half-open
      if (now >= this.nextAttemptTime) {
        this.transitionTo(CircuitState.HALF_OPEN);
        this.successCount = 0;
        return false;
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error(`Circuit breaker is ${this.state}: service unavailable`);
    }

    this.totalRequests++;

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.totalSuccesses++;
    this.failureCount = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        this.successCount = 0;
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success after some time
      const now = Date.now();
      if (this.lastFailureTime && (now - this.lastFailureTime) > this.options.resetTimeout) {
        this.failureCount = 0;
        this.lastFailureTime = null;
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.totalFailures++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open state reopens the circuit
      this.transitionTo(CircuitState.OPEN);
      this.nextAttemptTime = Date.now() + this.options.timeout;
    } else if (this.state === CircuitState.CLOSED) {
      if (this.failureCount >= this.options.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
        this.nextAttemptTime = Date.now() + this.options.timeout;
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChangeTime = Date.now();
    
    console.log(
      `[CircuitBreaker] State transition: ${oldState} -> ${newState} ` +
      `(failures: ${this.failureCount}, successes: ${this.successCount})`
    );
  }

  /**
   * Manually reset circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastStateChangeTime = Date.now();
    this.nextAttemptTime = 0;
    
    console.log('[CircuitBreaker] Manually reset to CLOSED state');
  }

  /**
   * Get current statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failureCount,
      successes: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChangeTime: this.lastStateChangeTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }
}

