'use strict';

const test = require('node:test');
const assert = require('assert/strict');
const {
  clearBotQueueState,
  performRedisCleanup,
  tryClearQueueReservationViaHttp,
} = require('../lib/queueCleanup');

function createLogger() {
  return {
    log: () => {},
    warn: () => {},
  };
}

function createRedisStub(overrides = {}) {
  const calls = [];
  const stub = {
    calls,
    async del(key) {
      calls.push({ op: 'del', key });
      return 1;
    },
    async zrem(key, member) {
      calls.push({ op: 'zrem', key, member });
      return 1;
    },
    async srem(key, member) {
      calls.push({ op: 'srem', key, member });
      return 0;
    },
    ...overrides,
  };
  return stub;
}

test('performRedisCleanup reports successes', async () => {
  const redis = createRedisStub();
  const result = await performRedisCleanup('bot123', redis, { logger: createLogger() });

  assert.equal(result.reservation.success, true);
  assert.equal(result.queueEntry.success, true);
  assert.deepEqual(
    redis.calls.map((entry) => entry.op),
    ['del', 'del', 'zrem', 'del', 'del', 'srem'],
  );
});

test('performRedisCleanup surfaces failures', async () => {
  const redis = createRedisStub({
    async zrem(key, member) {
      throw new Error(`zrem-failure:${key}:${member}`);
    },
  });

  const result = await performRedisCleanup('botXYZ', redis, { logger: createLogger() });

  assert.equal(result.queueEntry.success, false);
  assert.ok(result.queueEntry.error.includes('zrem-failure'));
});

test('clearBotQueueState uses provided fetch implementation and redis stub', async () => {
  const redis = createRedisStub();
  let fetchCalled = false;
  const fetchImpl = async (url, options) => {
    fetchCalled = true;
    assert.equal(url, 'http://example.com:2567/queue/clear');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Bot-Secret'], 'secret');
    return {
      ok: true,
      status: 200,
      text: async () => '',
    };
  };

  const result = await clearBotQueueState('bot789', redis, {
    colyseusUrl: 'ws://example.com:2567',
    botServiceSecret: 'secret',
    fetchImpl,
    logger: createLogger(),
  });

  assert.equal(fetchCalled, true);
  assert.equal(result.httpResult.ok, true);
  assert.equal(result.redisResult.reservation.success, true);
});

test('tryClearQueueReservationViaHttp handles missing URL', async () => {
  const result = await tryClearQueueReservationViaHttp('botNoUrl', {
    colyseusUrl: '',
    logger: createLogger(),
  });
  assert.equal(result.attempted, false);
  assert.equal(result.reason, 'missing_colyseus_url');
});

