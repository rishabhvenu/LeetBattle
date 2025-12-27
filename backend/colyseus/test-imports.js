// Test script to verify refactored modules can be imported
console.log('=== Testing Module Imports ===\n');

// Test helper modules
console.log('Test 1: Importing helper modules...');
try {
  const redisHelpers = require('./dist/helpers/redisHelpers');
  console.log('✓ redisHelpers:', Object.keys(redisHelpers));
  
  const botHelpers = require('./dist/helpers/botHelpers');
  console.log('✓ botHelpers:', Object.keys(botHelpers));
  
  const roomHelpers = require('./dist/helpers/roomHelpers');
  console.log('✓ roomHelpers:', Object.keys(roomHelpers));
  
  const statsHelpers = require('./dist/helpers/statsHelpers');
  console.log('✓ statsHelpers:', Object.keys(statsHelpers));
  
  console.log('✓ All helper modules imported successfully\n');
} catch (error) {
  console.error('✗ Helper module import failed:', error.message);
  process.exit(1);
}

// Test route modules
console.log('Test 2: Importing route modules...');
try {
  const guest = require('./dist/routes/guest');
  console.log('✓ guest routes:', Object.keys(guest));
  
  const queue = require('./dist/routes/queue');
  console.log('✓ queue routes:', Object.keys(queue));
  
  const match = require('./dist/routes/match');
  console.log('✓ match routes:', Object.keys(match));
  
  console.log('✓ All route modules imported successfully\n');
} catch (error) {
  console.error('✗ Route module import failed:', error.message);
  process.exit(1);
}

// Test circuit breaker and submission queue
console.log('Test 3: Importing circuit breaker modules...');
try {
  const circuitBreaker = require('./dist/lib/circuitBreaker');
  console.log('✓ circuitBreaker:', Object.keys(circuitBreaker));
  
  const submissionQueue = require('./dist/lib/submissionQueue');
  console.log('✓ submissionQueue:', Object.keys(submissionQueue));
  
  console.log('✓ Circuit breaker modules imported successfully\n');
} catch (error) {
  console.error('✗ Circuit breaker import failed:', error.message);
  process.exit(1);
}

// Test Redis cleanup worker
console.log('Test 4: Importing cleanup worker...');
try {
  const cleanup = require('./dist/workers/redisCleanup');
  console.log('✓ redisCleanup:', Object.keys(cleanup));
  
  console.log('✓ Cleanup worker imported successfully\n');
} catch (error) {
  console.error('✗ Cleanup worker import failed:', error.message);
  process.exit(1);
}

console.log('=== All Module Imports Successful ===');
process.exit(0);

