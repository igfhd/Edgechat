/**
 * Lightweight in-memory rate limiter for the Worker.
 *
 * Runs per-isolate, so it is a best-effort protection layer in production
 * (Cloudflare may fan a single client across multiple isolates), while being
 * fully deterministic and testable with an injectable clock.
 */

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX = 20;

export function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX,
  now = () => Date.now()
} = {}) {
  const hits = new Map();

  function check(key) {
    const ts = now();
    const cutoff = ts - windowMs;
    const arr = (hits.get(key) || []).filter((t) => t > cutoff);
    if (arr.length >= max) {
      const oldest = arr[0];
      return { allowed: false, retryAfterMs: Math.max(1, oldest + windowMs - ts) };
    }
    arr.push(ts);
    hits.set(key, arr);
    return { allowed: true, retryAfterMs: 0 };
  }

  function reset() {
    hits.clear();
  }

  return { check, reset };
}

export function createFailureTracker({
  windowMs = DEFAULT_WINDOW_MS,
  max = 10,
  now = () => Date.now()
} = {}) {
  const failures = new Map();

  function record(key) {
    const ts = now();
    const cutoff = ts - windowMs;
    const arr = (failures.get(key) || []).filter((t) => t > cutoff);
    arr.push(ts);
    if (arr.length > max) {
      failures.set(key, arr);
      const oldest = arr[0];
      return { allowed: false, retryAfterMs: Math.max(1, oldest + windowMs - ts) };
    }
    failures.set(key, arr);
    return { allowed: true, retryAfterMs: 0 };
  }

  function reset() {
    failures.clear();
  }

  return { record, reset };
}

export function clientIp(c) {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf;
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return 'unknown';
}

export function rateLimitError(retryAfterMs = 60_000) {
  return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': String(Math.ceil(retryAfterMs / 1000))
    }
  });
}