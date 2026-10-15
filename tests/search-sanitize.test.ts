import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSearchQuery } from '../lib/links/search';

test('keeps an ordinary query intact', () => {
  assert.equal(sanitizeSearchQuery('my link'), 'my link');
  assert.equal(sanitizeSearchQuery('readme'), 'readme');
  assert.equal(sanitizeSearchQuery('2026-review'), '2026-review');
});

test('trims surrounding whitespace', () => {
  assert.equal(sanitizeSearchQuery('  hello  '), 'hello');
});

test('collapses internal whitespace runs', () => {
  assert.equal(sanitizeSearchQuery('a    b'), 'a b');
});

test('strips commas that would split filter clauses', () => {
  assert.equal(sanitizeSearchQuery('a,b'), 'a b');
});

test('strips parentheses used for PostgREST grouping', () => {
  assert.equal(sanitizeSearchQuery('a(b)c'), 'a b c');
});

test('strips quotes used for injection', () => {
  assert.equal(sanitizeSearchQuery(`a"b`), 'a b');
  assert.equal(sanitizeSearchQuery("a'b"), 'a b');
});

test('strips wildcards from user input', () => {
  assert.equal(sanitizeSearchQuery('a%b'), 'a b');
  assert.equal(sanitizeSearchQuery('a*b'), 'a b');
});

test('strips backslashes', () => {
  assert.equal(sanitizeSearchQuery('a\\b'), 'a b');
});

test('removes control characters', () => {
  assert.equal(sanitizeSearchQuery('a\u0000b'), 'a b');
  assert.equal(sanitizeSearchQuery('a\u0007b'), 'a b');
  assert.equal(sanitizeSearchQuery('a\nb'), 'a b');
  assert.equal(sanitizeSearchQuery('a\u001fb'), 'a b');
});

test('a malicious filter payload is reduced to inert text', () => {
  const attack = `x"),or(slug.ilike.%${'a'.repeat(3)}%,title.ilike.%`;
  const result = sanitizeSearchQuery(attack);
  assert.equal(result.includes(','), false);
  assert.equal(result.includes('('), false);
  assert.equal(result.includes(')'), false);
  assert.equal(result.includes('"'), false);
});

test('empty and whitespace-only input yields an empty string', () => {
  assert.equal(sanitizeSearchQuery(''), '');
  assert.equal(sanitizeSearchQuery('    '), '');
});