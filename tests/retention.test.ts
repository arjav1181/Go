import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCutoffDay,
  shouldPurge,
  isPurgeableDay,
  isValidRetentionDays,
  retentionWindowDays,
  describeRetention,
  normalizeRetention,
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS
} from '../lib/retention/retention';

const NOW = new Date('2026-07-15T10:00:00.000Z');

test('retention is disabled by default', () => {
  assert.equal(shouldPurge({ enabled: false, days: 30 }), false);
});

test('nothing is purgeable while disabled', () => {
  const old = '2020-01-01';
  assert.equal(isPurgeableDay(old, { enabled: false, days: 1 }, NOW), false);
});

test('retention window is null while disabled', () => {
  assert.equal(retentionWindowDays({ enabled: false, days: 30 }), null);
});

test('retention window reports days while enabled', () => {
  assert.equal(retentionWindowDays({ enabled: true, days: 30 }), 30);
});

test('cutoff day is exclusive so exactly N days are kept', () => {
  // 30-day policy on 2026-07-15 keeps 2026-06-16..2026-07-15 (30 days).
  assert.equal(computeCutoffDay({ enabled: true, days: 30 }, NOW), '2026-06-16');
});

test('one-day policy keeps only today', () => {
  assert.equal(computeCutoffDay({ enabled: true, days: 1 }, NOW), '2026-07-15');
});

test('the cutoff day itself is kept, the day before is purged', () => {
  const settings = { enabled: true, days: 30 };
  assert.equal(isPurgeableDay('2026-06-16', settings, NOW), false); // cutoff kept
  assert.equal(isPurgeableDay('2026-06-15', settings, NOW), true); // before cutoff
  assert.equal(isPurgeableDay('2026-07-15', settings, NOW), false); // today kept
});

test('future days are never purged', () => {
  assert.equal(isPurgeableDay('2027-01-01', { enabled: true, days: 30 }, NOW), false);
});

test('cutoff maths crosses month and year boundaries', () => {
  // days = 1 keeps only the current day, so the first purged day is today.
  assert.equal(computeCutoffDay({ enabled: true, days: 1 }, new Date('2026-03-01T00:10:00Z')), '2026-03-01');
  assert.equal(computeCutoffDay({ enabled: true, days: 1 }, new Date('2026-01-01T23:59:00Z')), '2026-01-01');
  // A 365-day policy on 2026-01-01 starts purging from 2025-01-02.
  assert.equal(computeCutoffDay({ enabled: true, days: 365 }, new Date('2026-01-01T00:00:00Z')), '2025-01-02');
  assert.equal(computeCutoffDay({ enabled: true, days: 30 }, new Date('2026-03-01T00:10:00Z')), '2026-01-31');
});

test('cutoff maths handles a leap day', () => {
  // 30 days before 2024-03-01 lands in February of a leap year.
  assert.equal(computeCutoffDay({ enabled: true, days: 1 }, new Date('2024-03-01T12:00:00Z')), '2024-03-01');
  assert.equal(computeCutoffDay({ enabled: true, days: 29 }, new Date('2024-03-01T12:00:00Z')), '2024-02-02');
  // Two days back from 2024-03-01 is the leap day itself.
  assert.equal(computeCutoffDay({ enabled: true, days: 2 }, new Date('2024-03-01T12:00:00Z')), '2024-02-29');
});

test('cutoff uses the UTC day regardless of time of day', () => {
  const early = new Date('2026-07-15T00:01:00Z');
  const late = new Date('2026-07-15T23:59:00Z');
  assert.equal(
    computeCutoffDay({ enabled: true, days: 7 }, early),
    computeCutoffDay({ enabled: true, days: 7 }, late)
  );
});

test('an invalid retention window is never purged', () => {
  assert.equal(shouldPurge({ enabled: true, days: 0 }), false);
  assert.equal(shouldPurge({ enabled: true, days: -5 }), false);
  assert.equal(shouldPurge({ enabled: true, days: 99_999 }), false);
  assert.equal(shouldPurge({ enabled: true, days: 1.5 }), false);
});

test('retention day validation bounds', () => {
  assert.equal(isValidRetentionDays(MIN_RETENTION_DAYS), true);
  assert.equal(isValidRetentionDays(MAX_RETENTION_DAYS), true);
  assert.equal(isValidRetentionDays(MIN_RETENTION_DAYS - 1), false);
  assert.equal(isValidRetentionDays(MAX_RETENTION_DAYS + 1), false);
  assert.equal(isValidRetentionDays(30.5), false);
  assert.equal(isValidRetentionDays('30'), false);
  assert.equal(isValidRetentionDays(null), false);
});

test('normalizeRetention coerces unsafe input to safe defaults', () => {
  assert.deepEqual(normalizeRetention({ enabled: true, days: -1 }), {
    enabled: true,
    days: DEFAULT_RETENTION_DAYS
  });
  assert.deepEqual(normalizeRetention({}), { enabled: false, days: DEFAULT_RETENTION_DAYS });
  assert.deepEqual(normalizeRetention({ enabled: true, days: 30 }), { enabled: true, days: 30 });
});

test('describeRetention is honest about the disabled state', () => {
  assert.match(describeRetention({ enabled: false, days: 30 }), /Disabled/);
  assert.match(describeRetention({ enabled: true, days: 30 }), /30 days/);
});

test('maximum retention still yields a valid cutoff', () => {
  const cutoff = computeCutoffDay({ enabled: true, days: MAX_RETENTION_DAYS }, NOW);
  assert.match(cutoff, /^\d{4}-\d{2}-\d{2}$/);
});