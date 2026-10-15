import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScopes,
  hasScope,
  isValidScope,
  describeScopes,
  consumeRateLimit,
  __resetRateLimits,
  DEFAULT_SCOPE,
  SCOPES,
  RATE_WINDOW_MS
} from '../lib/api/scopes';

// --- scopes ----------------------------------------------------------------

test('the default scope is read-only', () => {
  assert.deepEqual(parseScopes(null), [DEFAULT_SCOPE]);
  assert.deepEqual(parseScopes(undefined), [DEFAULT_SCOPE]);
  assert.deepEqual(parseScopes(''), [DEFAULT_SCOPE]);
});

test('valid scopes parse and de-duplicate', () => {
  assert.deepEqual(parseScopes('links:read,links:write'), ['links:read', 'links:write']);
  assert.deepEqual(parseScopes('links:read, links:read '), ['links:read']);
});

test('unknown scopes are dropped', () => {
  assert.deepEqual(parseScopes('links:read,admin:everything'), ['links:read']);
});

test('a fully invalid scope list falls back to the least-privilege default', () => {
  assert.deepEqual(parseScopes('admin:everything,root:all'), [DEFAULT_SCOPE]);
});

test('scope validation', () => {
  assert.equal(isValidScope('links:read'), true);
  assert.equal(isValidScope('links:write'), true);
  assert.equal(isValidScope('analytics:read'), true);
  assert.equal(isValidScope('admin'), false);
  assert.equal(isValidScope(null), false);
});

test('least privilege: a read key cannot perform writes', () => {
  const scopes = parseScopes('links:read');
  assert.equal(hasScope(scopes, 'links:read'), true);
  assert.equal(hasScope(scopes, 'links:write'), false);
  assert.equal(hasScope(scopes, 'analytics:read'), false);
});

test('a write key still needs its own scope granted', () => {
  const scopes = parseScopes('links:write');
  assert.equal(hasScope(scopes, 'links:write'), true);
  assert.equal(hasScope(scopes, 'links:read'), false, 'scopes are not implied');
});

test('analytics scope is independent', () => {
  assert.equal(hasScope(parseScopes('analytics:read'), 'analytics:read'), true);
  assert.equal(hasScope(parseScopes('links:read,links:write'), 'analytics:read'), false);
});

test('describeScopes renders for the UI', () => {
  assert.equal(describeScopes(['links:read', 'links:write']), 'links:read, links:write');
  assert.equal(describeScopes([]), 'none');
});

// --- rate limiting ---------------------------------------------------------

test('requests under the limit are allowed', () => {
  __resetRateLimits();
  const first = consumeRateLimit('key-a', 1000, 5);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 4);
});

test('the limit is enforced after N requests', () => {
  __resetRateLimits();
  const now = 1000;
  for (let i = 0; i < 5; i += 1) {
    assert.equal(consumeRateLimit('key-b', now, 5).allowed, true, `request ${i + 1}`);
  }
  const blocked = consumeRateLimit('key-b', now, 5);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
});

test('the window resets after it expires', () => {
  __resetRateLimits();
  const start = 1000;
  for (let i = 0; i < 3; i += 1) consumeRateLimit('key-c', start, 3);
  assert.equal(consumeRateLimit('key-c', start, 3).allowed, false);
  // After the window, the budget is restored.
  assert.equal(consumeRateLimit('key-c', start + RATE_WINDOW_MS + 1, 3).allowed, true);
});

test('limits are tracked per key', () => {
  __resetRateLimits();
  for (let i = 0; i < 3; i += 1) consumeRateLimit('key-d', 1000, 3);
  assert.equal(consumeRateLimit('key-d', 1000, 3).allowed, false);
  assert.equal(consumeRateLimit('key-e', 1000, 3).allowed, true, 'other keys unaffected');
});

test('rate limit responses expose standard headers values', () => {
  __resetRateLimits();
  const result = consumeRateLimit('key-f', 10_000, 10);
  assert.equal(result.limit, 10);
  assert.equal(result.remaining, 9);
  assert.ok(result.resetAt > 10_000);
});

test('reset is cleared between tests', () => {
  __resetRateLimits();
  assert.equal(consumeRateLimit('key-g', 1000, 1).allowed, true);
  __resetRateLimits();
  assert.equal(consumeRateLimit('key-g', 1000, 1).allowed, true);
});

test('the scope catalogue is exactly the documented set', () => {
  assert.deepEqual([...SCOPES], ['links:read', 'links:write', 'analytics:read']);
});