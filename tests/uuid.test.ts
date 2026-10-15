import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUuid } from '../lib/tags/validation';

const VALID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

test('accepts a well-formed uuid', () => {
  assert.equal(parseUuid(VALID), VALID);
});

test('is case-insensitive', () => {
  assert.equal(parseUuid(VALID.toUpperCase()), VALID.toUpperCase());
});

test('rejects non-string input', () => {
  assert.equal(parseUuid(undefined), null);
  assert.equal(parseUuid(null), null);
  assert.equal(parseUuid(42), null);
  assert.equal(parseUuid({}), null);
});

test('rejects an empty string', () => {
  assert.equal(parseUuid(''), null);
});

test('rejects near-miss uuids', () => {
  assert.equal(parseUuid('3f2504e0-4f89-11d3-9a0c'), null);
  assert.equal(parseUuid('3f2504e04f8911d39a0c0305e82c3301'), null);
  assert.equal(parseUuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301-extra'), null);
  assert.equal(parseUuid('zzz04e0-4f89-11d3-9a0c-0305e82c3301'), null);
});

test('rejects an injection attempt', () => {
  assert.equal(parseUuid(`${VALID}' OR 1=1 --`), null);
  assert.equal(parseUuid('"; drop table links; --'), null);
});