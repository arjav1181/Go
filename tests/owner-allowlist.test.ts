import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getOwnerEmails, isOwnerEmail } from '../lib/auth/owner';

/**
 * The owner allowlist is the only thing standing between an anonymous visitor
 * and the dashboard. It is a single environment variable holding a
 * comma-separated list, so parsing mistakes here are access-control bugs.
 */

function withOwnerEmails(value: string | undefined, fn: () => void): void {
  const previous = process.env.OWNER_EMAILS;
  if (value === undefined) delete process.env.OWNER_EMAILS;
  else process.env.OWNER_EMAILS = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.OWNER_EMAILS;
    else process.env.OWNER_EMAILS = previous;
  }
}

test('a single owner email is accepted', () => {
  withOwnerEmails('arjav.3003jain@gmail.com', () => {
    assert.deepEqual(getOwnerEmails(), ['arjav.3003jain@gmail.com']);
    assert.equal(isOwnerEmail('arjav.3003jain@gmail.com'), true);
  });
});

test('multiple owners are supported, comma-separated', () => {
  withOwnerEmails('arjav.3003jain@gmail.com,hello@arjav.is-cool.dev', () => {
    assert.deepEqual(getOwnerEmails(), [
      'arjav.3003jain@gmail.com',
      'hello@arjav.is-cool.dev'
    ]);
    assert.equal(isOwnerEmail('arjav.3003jain@gmail.com'), true);
    assert.equal(isOwnerEmail('hello@arjav.is-cool.dev'), true);
  });
});

test('whitespace, casing and stray commas are tolerated', () => {
  withOwnerEmails(' A@Example.com , b@example.com ,, ', () => {
    assert.deepEqual(getOwnerEmails(), ['a@example.com', 'b@example.com']);
    assert.equal(isOwnerEmail('A@EXAMPLE.COM'), true, 'lookup must be case-insensitive');
    assert.equal(isOwnerEmail('b@example.com'), true);
  });
});

test('three or more owners all resolve', () => {
  withOwnerEmails('a@x.com,b@x.com,c@x.com', () => {
    for (const email of ['a@x.com', 'b@x.com', 'c@x.com']) {
      assert.equal(isOwnerEmail(email), true, email);
    }
  });
});

test('an unlisted address is refused', () => {
  withOwnerEmails('arjav.3003jain@gmail.com,hello@arjav.is-cool.dev', () => {
    assert.equal(isOwnerEmail('stranger@evil.example'), false);
    assert.equal(isOwnerEmail(''), false);
    assert.equal(isOwnerEmail(null), false);
    assert.equal(isOwnerEmail(undefined), false);
  });
});

test('the match is exact, not a prefix or substring', () => {
  withOwnerEmails('owner@example.com', () => {
    // Each of these would be an access-control bypass if matching were naive.
    assert.equal(isOwnerEmail('attacker@example.com'), false);
    assert.equal(isOwnerEmail('owner@example.com.evil.example'), false);
    assert.equal(isOwnerEmail('owner@example.co'), false);
    assert.equal(isOwnerEmail('xowner@example.com'), false);
    assert.equal(isOwnerEmail('owner@sub.example.com'), false);
    assert.equal(isOwnerEmail('OWNER@EXAMPLE.COM'), true, 'case is normalised, nothing else');
  });
});

test('an unset or empty allowlist refuses everyone', () => {
  withOwnerEmails(undefined, () => {
    assert.deepEqual(getOwnerEmails(), []);
    assert.equal(isOwnerEmail('anyone@example.com'), false);
  });
  withOwnerEmails('', () => {
    assert.deepEqual(getOwnerEmails(), []);
    assert.equal(isOwnerEmail('anyone@example.com'), false);
  });
  withOwnerEmails('   ,  ,', () => {
    assert.deepEqual(getOwnerEmails(), []);
    assert.equal(isOwnerEmail('anyone@example.com'), false);
  });
});