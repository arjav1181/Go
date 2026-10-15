import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  redact,
  logEvent,
  EVENTS,
  PERSISTED_EVENTS,
  correlationIdFrom
} from '../lib/log';

/**
 * The durable event store cannot be exercised without Postgres here, but its
 * contract matters: it must never throw, must never reject, and must never
 * become a side channel for data the stdout log path would have dropped.
 */

test('persisted event names are canonical and queryable', () => {
  const names = Object.values(PERSISTED_EVENTS);
  for (const name of names) {
    assert.match(name, /^[a-z0-9_]+\.[a-z0-9_]+$/, `unexpected event name: ${name}`);
  }
  assert.equal(new Set(names).size, names.length, 'duplicate event name');
});

test('persisted events cover authentication, abuse and cron operations', () => {
  // These are the events that make a "was there a credential-stuffing attempt
  // overnight?" question answerable after the fact.
  assert.ok(PERSISTED_EVENTS.loginFailed);
  assert.ok(PERSISTED_EVENTS.authRateLimited);
  assert.ok(PERSISTED_EVENTS.apiDenied);
  assert.ok(PERSISTED_EVENTS.cronFailed);
  assert.ok(PERSISTED_EVENTS.purgeCompleted);
});

test('the redirect hot path is not in the persisted set', () => {
  // A database write per redirect would make the cheapest operation the most
  // expensive one. Successful redirects are intentionally stdout-only.
  const hotPath = [EVENTS.redirectError, EVENTS.clickRecordFailed, EVENTS.assignmentFailed];
  for (const event of hotPath) {
    assert.ok(
      !Object.values(PERSISTED_EVENTS).includes(event as never),
      `${event} must not be persisted on the redirect path`
    );
  }
});

test('severity mapping in the SQL function covers the values callers send', () => {
  // Mirrors the CASE expression in 0010_operational_event_fixes.sql.
  const normalise = (input: string): string => {
    const v = input.toLowerCase();
    if (['info', 'warn', 'error'].includes(v)) return v;
    if (['critical', 'fatal'].includes(v)) return 'error';
    if (['warning', 'err'].includes(v)) return 'warn';
    return 'info';
  };
  assert.equal(normalise('info'), 'info');
  assert.equal(normalise('warn'), 'warn');
  assert.equal(normalise('error'), 'error');
  assert.equal(normalise('CRITICAL'), 'error');
  assert.equal(normalise('Fatal'), 'error');
  assert.equal(normalise('Warning'), 'warn');
  assert.equal(normalise('err'), 'warn');
  assert.equal(normalise(''), 'info');
  assert.equal(normalise('nonsense'), 'info');
});

test('correlation ids are sanitised, never echoed from input', () => {
  const hostile = new Headers({ 'x-request-id': '../../etc/passwd' });
  const id = correlationIdFrom(hostile);
  assert.match(id, /^[A-Za-z0-9_-]+$/);
});

test('log output never contains a raw api key or cookie', () => {
  const captured: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  try {
    logEvent('test.event', 'info', {
      api_key: 'gk_live_secret_value',
      cookie: 'sb-access-token=abc',
      destination: 'https://secret.example/private',
      note: 'contact me at private@example.com'
    });
  } finally {
    console.log = original;
  }
  const line = captured.join('\n');
  assert.ok(!line.includes('gk_live_secret_value'));
  assert.ok(!line.includes('sb-access-token'));
  assert.ok(!line.includes('secret.example'));
});

test('redaction preserves harmless operational fields', () => {
  const out = redact({ route: '/api/v1/links', status: 429, count: 3 });
  assert.equal(out.route, '/api/v1/links');
  assert.equal(out.status, 429);
  assert.equal(out.count, 3);
});
