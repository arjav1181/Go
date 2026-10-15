import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDestinationUrl } from '../lib/links/validation';

test('accepts https url', () => {
  const result = normalizeDestinationUrl('https://example.com/path?q=1');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.url, 'https://example.com/path?q=1');
});

test('rejects javascript scheme', () => {
  const result = normalizeDestinationUrl('javascript:alert(1)');
  assert.equal(result.ok, false);
});

test('rejects data scheme', () => {
  const result = normalizeDestinationUrl('data:text/html,hello');
  assert.equal(result.ok, false);
});

test('rejects malformed', () => {
  const result = normalizeDestinationUrl('not a url');
  assert.equal(result.ok, false);
});

test('rejects same host', () => {
  const result = normalizeDestinationUrl('https://go.arjav.is-cool.dev/x', 'go.arjav.is-cool.dev');
  assert.equal(result.ok, false);
});

test('rejects credentials', () => {
  const result = normalizeDestinationUrl('https://user:pass@example.com/');
  assert.equal(result.ok, false);
});
