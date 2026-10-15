import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashBucketKey,
  callerKeyFromHeaders,
  limitFromEnv,
  checkRateLimit,
  policyFor,
  POLICIES
} from '../lib/ratelimit/limiter';

test('bucket keys are hashed, never raw', () => {
  const key = hashBucketKey('203.0.113.5', 'login');
  assert.ok(!key.includes('203.0.113.5'));
  assert.equal(key.length, 32);
  assert.match(key, /^[0-9a-f]{32}$/);
});

test('the same input always yields the same bucket', () => {
  assert.equal(hashBucketKey('a', 's'), hashBucketKey('a', 's'));
});

test('different scopes produce different buckets for the same caller', () => {
  assert.notEqual(hashBucketKey('1.2.3.4', 'login'), hashBucketKey('1.2.3.4', 'qr'));
});

test('caller key handles proxy headers without exposing the address', () => {
  const key = callerKeyFromHeaders(new Headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }));
  assert.ok(!key.includes('198.51.100.9'));
  assert.match(key, /^[0-9a-f]{32}$/);
});

test('caller key tolerates missing headers', () => {
  const key = callerKeyFromHeaders(new Headers());
  assert.match(key, /^[0-9a-f]{32}$/);
});

test('caller key prefers the first forwarded address', () => {
  const a = callerKeyFromHeaders(new Headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }));
  const b = callerKeyFromHeaders(new Headers({ 'x-forwarded-for': '1.1.1.1' }));
  assert.equal(a, b);
});

test('env limits fall back safely when unset or invalid', () => {
  const previous = process.env.RATE_LIMIT_TEST;
  delete process.env.RATE_LIMIT_TEST;
  assert.equal(limitFromEnv('RATE_LIMIT_TEST', 42), 42);

  process.env.RATE_LIMIT_TEST = 'not-a-number';
  assert.equal(limitFromEnv('RATE_LIMIT_TEST', 42), 42);

  process.env.RATE_LIMIT_TEST = '-5';
  assert.equal(limitFromEnv('RATE_LIMIT_TEST', 42), 42);

  process.env.RATE_LIMIT_TEST = '0';
  assert.equal(limitFromEnv('RATE_LIMIT_TEST', 42), 42);

  process.env.RATE_LIMIT_TEST = '999999';
  assert.equal(limitFromEnv('RATE_LIMIT_TEST', 42), 10000, 'clamped to max');

  if (previous === undefined) delete process.env.RATE_LIMIT_TEST;
  else process.env.RATE_LIMIT_TEST = previous;
});

test('a valid env limit is honoured', () => {
  const previous = process.env.RATE_LIMIT_TEST;
  process.env.RATE_LIMIT_TEST = '7';
  assert.equal(limitFromEnv('RATE_LIMIT_TEST', 42), 7);
  if (previous === undefined) delete process.env.RATE_LIMIT_TEST;
  else process.env.RATE_LIMIT_TEST = previous;
});

// --- degradation policy ----------------------------------------------------

test('the limiter degrades open when the store is unavailable', async () => {
  // No Supabase configuration in the test environment, so the store throws.
  const outcome = await checkRateLimit({
    key: 'caller',
    scope: 'login',
    limit: 10,
    windowSeconds: 60,
    failOpen: true
  });
  assert.equal(outcome.degraded, true);
  assert.equal(outcome.allowed, true, 'must not block legitimate traffic when limiter is down');
});

test('the limiter can be configured to fail closed for sensitive scopes', async () => {
  const outcome = await checkRateLimit({
    key: 'caller',
    scope: 'login',
    limit: 10,
    windowSeconds: 60,
    failOpen: false
  });
  assert.equal(outcome.degraded, true);
  assert.equal(outcome.allowed, false);
});

test('a degraded result still reports a usable retry hint', async () => {
  const outcome = await checkRateLimit({
    key: 'caller',
    scope: 'login',
    limit: 10,
    windowSeconds: 45,
    failOpen: true
  });
  assert.equal(outcome.retryAfterSeconds, 45);
});

// --- policies --------------------------------------------------------------

test('presets are ordered from strictest to most permissive', () => {
  assert.ok(POLICIES.login.limit < POLICIES.linkEdit.limit);
  assert.ok(POLICIES.qr.limit < POLICIES.linkEdit.limit);
  assert.ok(POLICIES.export.limit <= POLICIES.linkCreate.limit);
});

test('the redirect brake is loose enough not to disturb visitors', () => {
  // 600/minute is far above normal human use but stops naive scraping loops.
  assert.ok(POLICIES.redirect.limit >= 120);
});

test('policyFor applies the preset and honours overrides', () => {
  const policy = policyFor('login', 'abc');
  assert.equal(policy.scope, 'login');
  assert.equal(policy.windowSeconds, POLICIES.login.windowSeconds);

  const overridden = policyFor('login', 'abc', { limit: 3, windowSeconds: 10 });
  assert.equal(overridden.limit, 3);
  assert.equal(overridden.windowSeconds, 10);
});

test('policy scopes are unique so budgets do not collide', () => {
  const scopes = Object.values(POLICIES).map((policy) => policy.scope);
  assert.equal(new Set(scopes).size, scopes.length);
});
// --- decision logic against an injected store ------------------------------

import type { RateLimitStore } from '../lib/ratelimit/limiter';

/** Minimal in-memory stand-in for the Postgres counter. */
function fakeStore(): RateLimitStore & { calls: number } {
  const counts = new Map<string, number>();
  const store = async ({ bucketKey, scope }: { bucketKey: string; scope: string }) => {
    const key = `${scope}|${bucketKey}`;
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    store.calls += 1;
    return next;
  };
  store.calls = 0;
  return store;
}

test('requests are allowed up to the limit, then blocked', async () => {
  const store = fakeStore();
  const policy = { key: 'caller', scope: 'login', limit: 3, windowSeconds: 60 };

  assert.equal((await checkRateLimit(policy, store)).allowed, true);
  assert.equal((await checkRateLimit(policy, store)).allowed, true);
  assert.equal((await checkRateLimit(policy, store)).allowed, true);
  const fourth = await checkRateLimit(policy, store);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.remaining, 0);
  assert.equal(fourth.retryAfterSeconds, 60);
});

test('remaining count decreases as the budget is consumed', async () => {
  const store = fakeStore();
  const policy = { key: 'caller', scope: 'qr', limit: 10, windowSeconds: 60 };
  assert.equal((await checkRateLimit(policy, store)).remaining, 9);
  assert.equal((await checkRateLimit(policy, store)).remaining, 8);
  assert.equal((await checkRateLimit(policy, store)).remaining, 7);
});

test('budgets are isolated per scope for the same caller', async () => {
  const store = fakeStore();
  for (let i = 0; i < 3; i += 1) {
    await checkRateLimit({ key: 'c', scope: 'login', limit: 3, windowSeconds: 60 }, store);
  }
  const blocked = await checkRateLimit({ key: 'c', scope: 'login', limit: 3, windowSeconds: 60 }, store);
  assert.equal(blocked.allowed, false);
  // A different scope still has its full budget.
  const other = await checkRateLimit({ key: 'c', scope: 'qr', limit: 3, windowSeconds: 60 }, store);
  assert.equal(other.allowed, true);
});

test('budgets are isolated per caller for the same scope', async () => {
  const store = fakeStore();
  const policy = (key: string) => ({ key, scope: 'login', limit: 2, windowSeconds: 60 });
  await checkRateLimit(policy('a'), store);
  await checkRateLimit(policy('a'), store);
  assert.equal((await checkRateLimit(policy('a'), store)).allowed, false);
  assert.equal((await checkRateLimit(policy('b'), store)).allowed, true);
});

test('the limiter passes a hashed key, never the raw caller value', async () => {
  const seen: string[] = [];
  const spy: RateLimitStore = async ({ bucketKey }) => {
    seen.push(bucketKey);
    return 1;
  };
  await checkRateLimit({ key: '203.0.113.7', scope: 'login', limit: 5, windowSeconds: 60 }, spy);
  assert.ok(!seen[0].includes('203.0.113.7'));
});

test('a store error fails open by default', async () => {
  const broken: RateLimitStore = async () => {
    throw new Error('database unavailable');
  };
  const outcome = await checkRateLimit(
    { key: 'c', scope: 'login', limit: 5, windowSeconds: 30 },
    broken
  );
  assert.equal(outcome.degraded, true);
  assert.equal(outcome.allowed, true);
});

test('a store error can be configured to fail closed', async () => {
  const broken: RateLimitStore = async () => {
    throw new Error('database unavailable');
  };
  const outcome = await checkRateLimit(
    { key: 'c', scope: 'login', limit: 5, windowSeconds: 30, failOpen: false },
    broken
  );
  assert.equal(outcome.degraded, true);
  assert.equal(outcome.allowed, false);
});

test('a malformed store response is treated as degraded, not as an allow', async () => {
  const bad: RateLimitStore = async () => Number.NaN;
  const outcome = await checkRateLimit({ key: 'c', scope: 'login', limit: 5, windowSeconds: 30 }, bad);
  assert.equal(outcome.degraded, true);
});
