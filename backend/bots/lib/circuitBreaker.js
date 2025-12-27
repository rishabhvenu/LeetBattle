// Simple circuit breaker implementation for external API calls
'use strict';

/**
 * Circuit breaker states
 */
const States = {
  CLOSED: 'CLOSED',     // Normal operation
  OPEN: 'OPEN',         // Failing, reject requests immediately
  HALF_OPEN: 'HALF_OPEN' // Testing if service recovered
};

/**
 * Simple circuit breaker to prevent cascading failures
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds
    this.successThreshold = options.successThreshold || 2; // For HALF_OPEN state
    this.fallback = options.fallback || (() => null);
    
    this.state = States.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = null;
    this.logger = options.logger || console;
  }
  
  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @param {string} context - Context for logging
   * @returns {Promise} Result of fn or fallback
   */
  async execute(fn, context = 'unknown') {
    if (this.state === States.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        this.logger.warn(`[CircuitBreaker:${context}] Circuit is OPEN, using fallback`);
        return this.fallback({ isStale: true, reason: 'circuit-open' });
      }
      // Transition to HALF_OPEN to test if service recovered
      this.state = States.HALF_OPEN;
      this.successCount = 0;
      this.logger.log(`[CircuitBreaker:${context}] Transitioning to HALF_OPEN, testing recovery`);
    }
    
    try {
      const result = await fn();
      this.onSuccess(context);
      return result;
    } catch (error) {
      this.onFailure(context, error);
      return this.fallback({ isStale: true, reason: 'circuit-breaker-fallback', error: error.message });
    }
  }
  
  /**
   * Handle successful execution
   */
  onSuccess(context) {
    this.failureCount = 0;
    
    if (this.state === States.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = States.CLOSED;
        this.logger.log(`[CircuitBreaker:${context}] Circuit CLOSED, service recovered`);
      }
    }
  }
  
  /**
   * Handle failed execution
   */
  onFailure(context, error) {
    this.failureCount++;
    this.logger.error(`[CircuitBreaker:${context}] Failure ${this.failureCount}/${this.failureThreshold}:`, error.message);
    
    if (this.state === States.HALF_OPEN || this.failureCount >= this.failureThreshold) {
      this.state = States.OPEN;
      this.nextAttemptTime = Date.now() + this.resetTimeout;
      this.logger.error(`[CircuitBreaker:${context}] Circuit OPEN, will retry after ${this.resetTimeout}ms`);
    }
  }
  
  /**
   * Get current circuit breaker state
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttemptTime: this.nextAttemptTime
    };
  }
  
  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.state = States.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = null;
    this.logger.log('[CircuitBreaker] Manually reset to CLOSED state');
  }
}

module.exports = {
  CircuitBreaker,
  States
};

