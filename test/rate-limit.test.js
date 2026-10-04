import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRateLimiter,
  createFailureTracker,
  clientIp,
  rateLimitError
} from '../worker/src/rate-limit.js';

test('createRateLimiter rejects once the window max is reached', () => {
  const clock = 1000;
  const limiter = createRateLimiter({ windowMs: 60000, max: 3, now: () => clock });

  assert.equal(limiter.check('ip-1').allowed, true);
  assert.equal(limiter.check('ip-1').allowed, true);
  assert.equal(limiter.check('ip-1').allowed, true);
  const blocked = limiter.check('ip-1');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);

  // A different key is unaffected.
  assert.equal(limiter.check('ip-2').allowed, true);
});

test('createRateLimiter slides the window as time passes', () => {
  let clock = 1000;
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: () => clock });

  assert.equal(limiter.check('ip-1').allowed, true);
  assert.equal(limiter.check('ip-1').allowed, false);

  clock = 61000;
  assert.equal(limiter.check('ip-1').allowed, true);
});

test('createFailureTracker blocks after repeated failures and recovers', () => {
  let clock = 1000;
  const tracker = createFailureTracker({ windowMs: 60000, max: 2, now: () => clock });

  assert.equal(tracker.record('ip-1').allowed, true);
  assert.equal(tracker.record('ip-1').allowed, true);
  const blocked = tracker.record('ip-1');
  assert.equal(blocked.allowed, false);

  clock = 61001;
  assert.equal(tracker.record('ip-1').allowed, true);
});

test('createRateLimiter.reset clears all state', () => {
  const clock = 1000;
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: () => clock });
  assert.equal(limiter.check('ip-1').allowed, true);
  assert.equal(limiter.check('ip-1').allowed, false);
  limiter.reset();
  assert.equal(limiter.check('ip-1').allowed, true);
});

test('clientIp prefers cf-connecting-ip over x-forwarded-for', () => {
  const c = {
    req: {
      header: (name) => {
        if (name === 'cf-connecting-ip') return '203.0.113.7';
        if (name === 'x-forwarded-for') return '198.51.100.1, 10.0.0.1';
        return null;
      }
    }
  };
  assert.equal(clientIp(c), '203.0.113.7');
});

test('clientIp falls back to the first x-forwarded-for entry', () => {
  const c = {
    req: {
      header: (name) => {
        if (name === 'cf-connecting-ip') return null;
        if (name === 'x-forwarded-for') return '198.51.100.1, 10.0.0.1';
        return null;
      }
    }
  };
  assert.equal(clientIp(c), '198.51.100.1');
});

test('rateLimitError returns 429 with Retry-After header', async () => {
  const res = rateLimitError(3000);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '3');
  const body = await res.json();
  assert.ok(body.error);
});