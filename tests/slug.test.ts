import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCustomSlug, RESERVED_SLUGS } from '../lib/links/validation';
import { generateRandomSlug } from '../lib/links/slug';

test('accepts valid slug', () => {
  const result = validateCustomSlug('hello-world');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.slug, 'hello-world');
});

test('normalizes to lowercase', () => {
  const result = validateCustomSlug('  HelloWorld  ');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.slug, 'hello world'.replace(/\s/g, ''));
});

test('rejects too short', () => {
  const result = validateCustomSlug('ab');
  assert.equal(result.ok, false);
});

test('rejects reserved', () => {
  const result = validateCustomSlug('dashboard');
  assert.equal(result.ok, false);
});

test('rejects invalid chars', () => {
  const result = validateCustomSlug('hello world');
  assert.equal(result.ok, false);
});

test('reserved set contains dashboard', () => {
  assert.equal(RESERVED_SLUGS.has('dashboard'), true);
});

test('generates valid random slug', () => {
  const slug = generateRandomSlug();
  const result = validateCustomSlug(slug);
  assert.equal(result.ok, true);
});
