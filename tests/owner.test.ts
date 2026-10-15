import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOwnerEmails, isOwnerEmail } from '../lib/auth/owner';

test('parses comma-separated owner emails', () => {
  process.env.OWNER_EMAILS = 'Owner@Example.com, second@example.com ,';
  const emails = getOwnerEmails();
  assert.deepEqual(emails, ['owner@example.com', 'second@example.com']);
});

test('owner allowlist is case-insensitive', () => {
  process.env.OWNER_EMAILS = 'owner@example.com';
  assert.equal(isOwnerEmail('OWNER@example.com'), true);
});

test('non-allowlisted email is rejected', () => {
  process.env.OWNER_EMAILS = 'owner@example.com';
  assert.equal(isOwnerEmail('intruder@example.com'), false);
});

test('missing email is rejected', () => {
  process.env.OWNER_EMAILS = 'owner@example.com';
  assert.equal(isOwnerEmail(null), false);
});

test('empty allowlist rejects everyone', () => {
  process.env.OWNER_EMAILS = '';
  assert.equal(isOwnerEmail('owner@example.com'), false);
});
