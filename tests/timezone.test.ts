import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localInputToUtcIso,
  formatInTimeZone,
  isValidTimeZone,
  normalizeTimeZone,
  detectTimeZone,
  COMMON_TIMEZONES
} from '../lib/schedules/timezone';

test('valid timezones are accepted', () => {
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('America/New_York'), true);
  assert.equal(isValidTimeZone('Asia/Tokyo'), true);
});

test('invalid timezones are rejected', () => {
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone('Not A Zone'), false);
});

test('normalise falls back to UTC', () => {
  assert.equal(normalizeTimeZone('Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(normalizeTimeZone('nonsense'), 'UTC');
  assert.equal(normalizeTimeZone(undefined), 'UTC');
  assert.equal(normalizeTimeZone(null), 'UTC');
});

test('UTC local input converts to the same wall clock', () => {
  assert.equal(localInputToUtcIso('2026-09-01T14:30', 'UTC'), '2026-09-01T14:30:00.000Z');
});

test('conversion respects the zone offset', () => {
  // Tokyo is UTC+9 year round.
  assert.equal(localInputToUtcIso('2026-09-01T14:30', 'Asia/Tokyo'), '2026-09-01T05:30:00.000Z');
});

test('conversion handles a negative offset', () => {
  // New York in September is UTC-4 (daylight saving).
  assert.equal(localInputToUtcIso('2026-09-01T14:30', 'America/New_York'), '2026-09-01T18:30:00.000Z');
});

test('the same instant renders identically in two zones', () => {
  const iso = '2026-09-01T05:30:00.000Z';
  assert.match(formatInTimeZone(iso, 'UTC'), /^2026-09-01 05:30/);
  assert.match(formatInTimeZone(iso, 'Asia/Tokyo'), /^2026-09-01 14:30/);
});

test('display includes the zone name by default', () => {
  assert.match(formatInTimeZone('2026-09-01T05:30:00.000Z', 'Asia/Tokyo'), /Asia\/Tokyo$/);
  assert.doesNotMatch(formatInTimeZone('2026-09-01T05:30:00.000Z', 'UTC', { withZone: false }), /UTC$/);
});

test('empty and invalid instants display as a dash', () => {
  assert.equal(formatInTimeZone(null, 'UTC'), '—');
  assert.equal(formatInTimeZone(undefined, 'UTC'), '—');
  assert.equal(formatInTimeZone('not-a-date', 'UTC'), '—');
});

test('malformed local input is rejected', () => {
  assert.equal(localInputToUtcIso('', 'UTC'), null);
  assert.equal(localInputToUtcIso('nonsense', 'UTC'), null);
  assert.equal(localInputToUtcIso('2026-13-45T99:99', 'UTC'), null);
});

test('an invalid zone still produces a UTC instant rather than throwing', () => {
  assert.equal(localInputToUtcIso('2026-09-01T14:30', 'Nowhere/Special'), '2026-09-01T14:30:00.000Z');
});

test('daylight saving boundaries are handled by the platform', () => {
  // US DST starts 2026-03-08. Before and after the jump the offset differs.
  const before = localInputToUtcIso('2026-03-07T12:00', 'America/New_York');
  const after = localInputToUtcIso('2026-03-09T12:00', 'America/New_York');
  assert.equal(before, '2026-03-07T17:00:00.000Z'); // EST, UTC-5
  assert.equal(after, '2026-03-09T16:00:00.000Z'); // EDT, UTC-4
});

test('southern hemisphere daylight saving is handled', () => {
  // Sydney DST runs in the southern summer.
  const january = localInputToUtcIso('2026-01-15T12:00', 'Australia/Sydney');
  assert.equal(january, '2026-01-15T01:00:00.000Z'); // AEDT, UTC+11
});

test('seconds are honoured when provided', () => {
  assert.equal(localInputToUtcIso('2026-09-01T14:30:45', 'UTC'), '2026-09-01T14:30:45.000Z');
});

test('round-tripping a rendered time reproduces the instant', () => {
  const iso = '2026-09-01T05:30:00.000Z';
  const rendered = formatInTimeZone(iso, 'Asia/Tokyo', { withZone: false }); // "2026-09-01 14:30"
  const backToInput = rendered.replace(' ', 'T');
  assert.equal(localInputToUtcIso(backToInput, 'Asia/Tokyo'), iso);
});

test('detectTimeZone returns something usable', () => {
  const detected = detectTimeZone();
  assert.ok(detected.length > 0);
  assert.equal(isValidTimeZone(detected), true);
});

test('the common timezone list is all valid', () => {
  for (const zone of COMMON_TIMEZONES) {
    assert.equal(isValidTimeZone(zone), true, zone);
  }
});