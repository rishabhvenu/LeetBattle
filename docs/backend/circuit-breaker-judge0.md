# Judge0 Circuit Breaker & Submission Queue

## Overview

The Judge0 service now includes a circuit breaker pattern and submission queue with backpressure to prevent overload and provide graceful degradation under high load.

**Location**: 
- `backend/colyseus/src/lib/circuitBreaker.ts` - Circuit breaker implementation
- `backend/colyseus/src/lib/submissionQueue.ts` - Submission queue with rate limiting

## Problem Statement

Without protection, Judge0 can become overloaded during:
- Traffic spikes (many simultaneous matches)
- Judge0 service degradation
- Network issues between Colyseus and Judge0

This leads to:
- Timeouts cascading to all users
- Failed submissions with no retry mechanism
- No backpressure signal to clients

## Solution: Circuit Breaker + Submission Queue

### Circuit Breaker

Protects Judge0 by opening the circuit when failures exceed a threshold, preventing further requests until recovery.

**States:**
- **CLOSED** - Normal operation, all requests pass through
- **OPEN** - Circuit is open, rejecting all requests (service unavailable)
- **HALF_OPEN** - Testing recovery, allowing limited requests

**Configuration:**
```typescript
{
  failureThreshold: 5,      // Failures before opening circuit
  successThreshold: 2,      // Successes in half-open to close circuit
  timeout: 60000,           // 1 minute before trying half-open
  resetTimeout: 30000,      // 30 seconds to reset failure count
}
```

### Submission Queue

Provides rate limiting and concurrency control using p-queue.

**Configuration:**
```typescript
{
  concurrency: 10,          // Max 10 concurrent submissions
  intervalCap: 20,          // Max 20 submissions per interval
  interval: 1000,           // 1 second interval
  timeout: 30000,           // 30 second timeout per submission
}
```

## Usage

### Basic Usage

```typescript
import { getSubmissionQueue } from './lib/submissionQueue';

const queue = getSubmissionQueue();

// Submit code for execution
try {
  const result = await queue.submit(async () => {
    // Your Judge0 API call here
    return await executeCode(code, languageId, input);
  });
  
  console.log('Execution result:', result);
} catch (error) {
  if (error.message.includes('Circuit breaker')) {
    // Circuit is open, Judge0 unavailable
    console.error('Judge0 service unavailable:', error);
  } else if (error.message.includes('overloaded')) {
    // Queue is full
    console.error('Too many submissions, try again later');
  } else {
    // Other error
    console.error('Submission failed:', error);
  }
}
```

### Custom Configuration

```typescript
import { SubmissionQueue } from './lib/submissionQueue';

const queue = new SubmissionQueue({
  concurrency: 15,
  intervalCap: 30,
  interval: 1000,
  timeout: 45000,
  circuitBreakerOptions: {
    failureThreshold: 10,
    successThreshold: 3,
    timeout: 120000,
  }
});
```

### Monitoring

```typescript
import { getSubmissionQueue } from './lib/submissionQueue';

const queue = getSubmissionQueue();

// Get queue statistics
const stats = queue.getStats();
console.log('Queue stats:', {
  size: stats.size,                    // Tasks waiting
  pending: stats.pending,              // Tasks executing
  isPaused: stats.isPaused,            // Queue paused?
  circuitState: stats.circuitState,    // CLOSED/OPEN/HALF_OPEN
  failures: stats.circuitStats.failures,
  successes: stats.circuitStats.successes
});

// Check health
const isHealthy = queue.isHealthy();
console.log('Queue healthy?', isHealthy);

// Get metrics
const metrics = queue.getMetrics();
console.log('Metrics:', {
  totalSubmissions: metrics.totalSubmissions,
  totalErrors: metrics.totalErrors,
  successRate: metrics.successRate,
  queueSize: metrics.queueSize,
  circuitState: metrics.circuitState
});
```

### Manual Control

```typescript
import { getSubmissionQueue } from './lib/submissionQueue';

const queue = getSubmissionQueue();

// Pause submissions
queue.pause();

// Resume submissions
queue.resume();

// Clear pending submissions
queue.clear();

// Reset circuit breaker
queue.resetCircuitBreaker();

// Wait for queue to empty
await queue.onIdle();
```

## Error Handling

The submission queue provides specific error messages:

### Circuit Breaker Open

```
Error: Circuit breaker is OPEN: Judge0 service unavailable. 
Last failure: 2024-01-15T10:30:00.000Z
```

**Action**: Wait for circuit to recover (default 1 minute) or investigate Judge0 service

### Queue Overload

```
Error: Submission queue overloaded: 150 tasks pending. 
Please try again later.
```

**Action**: Implement exponential backoff in client, reduce submission rate

### Timeout

```
Error: Submission timed out after 30000ms. 
Judge0 service may be overloaded.
```

**Action**: Check Judge0 service health, consider increasing timeout

## Circuit Breaker State Transitions

```
CLOSED --[failure threshold reached]--> OPEN
OPEN --[timeout expired]--> HALF_OPEN
HALF_OPEN --[success threshold reached]--> CLOSED
HALF_OPEN --[any failure]--> OPEN
```

## Metrics & Monitoring

### Key Metrics

Track these for production monitoring:

- **Circuit State** - CLOSED (good), OPEN/HALF_OPEN (degraded)
- **Queue Size** - Should be < 50 normally
- **Pending Tasks** - Should be < 8 normally (< concurrency)
- **Success Rate** - Should be > 95%
- **Circuit Failures** - Spikes indicate Judge0 issues

### Alerting

Set up alerts for:

- Circuit state is OPEN for > 5 minutes
- Queue size > 100
- Success rate < 90% over 5 minutes
- Pending tasks > concurrency for > 1 minute

### Logs

The system logs important events:

```
[CircuitBreaker] State transition: CLOSED -> OPEN (failures: 5, successes: 0)
[SubmissionQueue] Initialized with concurrency=10, intervalCap=20, interval=1000ms
[SubmissionQueue] Paused
[SubmissionQueue] Resumed
[SubmissionQueue] Cleared
[SubmissionQueue] Circuit breaker reset
```

## Performance Considerations

### Concurrency

- Default `concurrency: 10` handles ~10 simultaneous submissions
- Increase if Judge0 can handle more load
- Monitor Judge0 CPU/memory before increasing

### Rate Limiting

- Default `intervalCap: 20` limits to 20 submissions/second
- Tune based on Judge0 capacity
- Consider burst traffic patterns

### Timeout

- Default `timeout: 30000ms` (30 seconds)
- Increase for complex code execution
- Decrease to fail faster under load

### Circuit Breaker

- Default `failureThreshold: 5` opens circuit after 5 failures
- Adjust based on acceptable error rate
- Higher threshold = more tolerance, slower detection

## Integration with Code Runner

Update `codeRunner.ts` to use the submission queue:

```typescript
import { getSubmissionQueue } from './submissionQueue';

async function executeCode(code: string, languageId: number, stdin: string) {
  const queue = getSubmissionQueue();
  
  try {
    const result = await queue.submit(async () => {
      // Existing Judge0 API call logic
      return await judge0Client.createSubmission({
        source_code: code,
        language_id: languageId,
        stdin: stdin
      });
    });
    
    return result;
  } catch (error) {
    // Handle circuit breaker / queue errors
    throw error;
  }
}
```

## Testing

### Unit Tests

Test circuit breaker states:

```typescript
import { CircuitBreaker, CircuitState } from './circuitBreaker';

const cb = new CircuitBreaker({ failureThreshold: 3 });

// Simulate failures
for (let i = 0; i < 3; i++) {
  try {
    await cb.execute(async () => { throw new Error('fail'); });
  } catch {}
}

expect(cb.getState()).toBe(CircuitState.OPEN);
```

### Integration Tests

Test queue with real Judge0 submissions (staging only).

## Troubleshooting

### Circuit Keeps Opening

1. Check Judge0 service health
2. Review Judge0 logs for errors
3. Verify network connectivity
4. Check if Judge0 is overloaded (CPU/memory)
5. Consider increasing `failureThreshold`

### Queue Always Full

1. Check submission rate vs. capacity
2. Increase `concurrency` if Judge0 can handle it
3. Increase `intervalCap` for burst capacity
4. Implement backoff in clients
5. Consider scaling Judge0 horizontally

### Slow Response Times

1. Check Judge0 response times
2. Verify `timeout` is appropriate
3. Review pending tasks count
4. Check if queue is backed up
5. Consider increasing Judge0 resources

## Related Documentation

- [`backend/judge0-runbook.md`](./judge0-runbook.md) - Judge0 service operations
- [`backend/overview.md`](./overview.md) - Backend architecture
- [`backend/debugging-playbook.md`](./debugging-playbook.md) - Debugging guide

