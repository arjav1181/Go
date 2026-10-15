import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRedirect } from '../lib/links/resolve';

const base = {
  id: '00000000-0000-0000-0000-000000000000',
  destination_url: 'https://example.com/target',
  is_active: true,
  expires_at: null
};

test('active link redirects to destination', () => {
  const decision = decideRedirect(base);
  assert.deepEqual(decision, { kind: 'redirect', location: 'https://example.com/target' });
});

test('missing link is not found', () => {
  assert.equal(decideRedirect(null).kind, 'not_found');
});

test('disabled link does not redirect', () => {
  const decision = decideRedirect({ ...base, is_active: false });
  assert.deepEqual(decision, { kind: 'gone', reason: 'disabled' });
});

test('expired link does not redirect', () => {
  const decision = decideRedirect({ ...base, expires_at: '2020-01-01T00:00:00.000Z' });
  assert.deepEqual(decision, { kind: 'gone', reason: 'expired' });
});

test('future expiry still redirects', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(decideRedirect({ ...base, expires_at: future }).kind, 'redirect');
});

test('corrupted destination does not redirect', () => {
  const decision = decideRedirect({ ...base, destination_url: 'javascript:alert(1)' });
  assert.deepEqual(decision, { kind: 'gone', reason: 'invalid' });
});
