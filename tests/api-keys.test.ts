import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateApiKey,
  hashApiKey,
  safeHashEquals,
  looksLikeApiKey,
  parseBearerToken,
  apiKeyDisplayPrefix,
  API_KEY_PREFIX,
  KEY_DISPLAY_PREFIX_LENGTH
} from '../lib/api/keys';

test('generated keys are prefixed and carry at least 128 bits of entropy', () => {
  const { key } = generateApiKey();
  assert.ok(key.startsWith(API_KEY_PREFIX));
  // 24 random bytes -> 32 base64url chars, i.e. 192 bits of entropy.
  assert.ok(key.length - API_KEY_PREFIX.length >= 32, `secret length was ${key.length}`);
  assert.ok(/^go_[A-Za-z0-9_-]+$/.test(key), 'key must be url-safe');
});

test('generated keys are unique', () => {
  const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key));
  assert.equal(keys.size, 200);
});

test('the raw key is never stored, only its hash', () => {
  const { key, hash, prefix } = generateApiKey();
  assert.notEqual(hash, key);
  assert.equal(hash.length, 64); // sha256 hex
  assert.equal(hash, hashApiKey(key));
  assert.equal(prefix, key.slice(0, KEY_DISPLAY_PREFIX_LENGTH));
});

test('the display prefix never exposes the secret', () => {
  const { key, prefix } = generateApiKey();
  assert.ok(key.startsWith(prefix));
  assert.ok(key.length > prefix.length);
  assert.ok(!key.slice(prefix.length).startsWith(prefix));
});

test('apiKeyDisplayPrefix truncates consistently', () => {
  assert.equal(apiKeyDisplayPrefix('abcdefghijklmnop'), 'abcdefghijkl');
  assert.equal(apiKeyDisplayPrefix('short'), 'short');
});

test('hashing is deterministic', () => {
  const key = 'go_fixed_test_value_1234';
  assert.equal(hashApiKey(key), hashApiKey(key));
});

test('different keys produce different hashes', () => {
  assert.notEqual(hashApiKey('go_a'), hashApiKey('go_b'));
});

test('safeHashEquals matches identical digests', () => {
  const h = hashApiKey('go_example');
  assert.equal(safeHashEquals(h, h), true);
});

test('safeHashEquals rejects different digests', () => {
  assert.equal(safeHashEquals(hashApiKey('go_a'), hashApiKey('go_b')), false);
});

test('safeHashEquals rejects mismatched lengths without throwing', () => {
  assert.equal(safeHashEquals('abc', 'abcdef'), false);
  assert.equal(safeHashEquals('', 'x'), false);
});

test('looksLikeApiKey accepts generated keys', () => {
  assert.equal(looksLikeApiKey(generateApiKey().key), true);
});

test('looksLikeApiKey rejects malformed values', () => {
  assert.equal(looksLikeApiKey('nope'), false);
  assert.equal(looksLikeApiKey(''), false);
  assert.equal(looksLikeApiKey('go_short'), false);
  assert.equal(looksLikeApiKey(`${API_KEY_PREFIX}${'x'.repeat(500)}`), false);
});

test('parseBearerToken reads a bearer header', () => {
  assert.equal(parseBearerToken('Bearer go_abc123'), 'go_abc123');
});

test('parseBearerToken is case-insensitive on the scheme', () => {
  assert.equal(parseBearerToken('bearer go_abc123'), 'go_abc123');
  assert.equal(parseBearerToken('BEARER go_abc123'), 'go_abc123');
});

test('parseBearerToken tolerates surrounding whitespace', () => {
  assert.equal(parseBearerToken('  Bearer   go_abc123  '), 'go_abc123');
});

test('parseBearerToken rejects other schemes and empty values', () => {
  assert.equal(parseBearerToken(null), null);
  assert.equal(parseBearerToken(''), null);
  assert.equal(parseBearerToken('Basic abc123'), null);
  assert.equal(parseBearerToken('Bearer'), null);
  assert.equal(parseBearerToken('Bearer '), null);
});

test('parseBearerToken rejects a header with embedded spaces', () => {
  assert.equal(parseBearerToken('Bearer go_a go_b'), null);
});