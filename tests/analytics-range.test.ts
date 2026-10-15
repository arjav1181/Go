import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRange,
  previousPeriod,
  rangeLengthDays,
  eachDay,
  isWithinRange,
  isValidRange,
  toUtcDay
} from '../lib/analytics/range';

const NOW = new Date('2026-03-15T23:30:00.000Z');

test('resolves 7d preset as seven inclusive days ending today', () => {
  const range = resolveRange('7d', undefined, undefined, NOW);
  assert.equal(range.end, '2026-03-15');
  assert.equal(range.start, '2026-03-09');
  assert.equal(rangeLengthDays(range), 7);
});

test('resolves 30d preset', () => {
  const range = resolveRange('30d', undefined, undefined, NOW);
  assert.equal(range.end, '2026-03-15');
  assert.equal(rangeLengthDays(range), 30);
});

test('resolves 90d preset', () => {
  const range = resolveRange('90d', undefined, undefined, NOW);
  assert.equal(rangeLengthDays(range), 90);
});

test('unknown preset falls back to 30d', () => {
  const range = resolveRange('nonsense', undefined, undefined, NOW);
  assert.equal(rangeLengthDays(range), 30);
});

test('custom range is honoured when valid', () => {
  const range = resolveRange('custom', '2026-01-01', '2026-01-31', NOW);
  assert.deepEqual(range, { start: '2026-01-01', end: '2026-01-31' });
});

test('invalid custom range falls back instead of throwing', () => {
  const range = resolveRange('custom', '2026-03-10', '2026-03-01', NOW);
  assert.equal(rangeLengthDays(range), 30);
});

test('range spanning a month boundary has correct length', () => {
  assert.equal(rangeLengthDays({ start: '2026-02-27', end: '2026-03-02' }), 4);
});

test('single day range has length 1', () => {
  assert.equal(rangeLengthDays({ start: '2026-03-15', end: '2026-03-15' }), 1);
});

test('inverted range has length 0', () => {
  assert.equal(rangeLengthDays({ start: '2026-03-15', end: '2026-03-01' }), 0);
});

test('previous period is the immediately preceding equal-length window', () => {
  const range = { start: '2026-03-09', end: '2026-03-15' };
  assert.deepEqual(previousPeriod(range), { start: '2026-03-02', end: '2026-03-08' });
});

test('previous period crosses month boundary correctly', () => {
  const range = { start: '2026-02-27', end: '2026-03-02' };
  assert.deepEqual(previousPeriod(range), { start: '2026-02-23', end: '2026-02-26' });
});

test('previous period of a full-year range is correct', () => {
  const range = { start: '2025-01-01', end: '2025-12-31' };
  const prev = previousPeriod(range);
  assert.equal(rangeLengthDays(range), 365);
  assert.equal(rangeLengthDays(prev), 365);
  assert.equal(prev.end, '2024-12-31');
  // 2024 is a leap year, so the 365 days before 2025-01-01 start on 2024-01-02.
  assert.equal(prev.start, '2024-01-02');
});

test('previous period handles leap day', () => {
  // 2024-02-28, 2024-02-29, 2024-03-01 => the 3 days before are 25th-27th.
  const range = { start: '2024-02-28', end: '2024-03-01' };
  assert.deepEqual(previousPeriod(range), { start: '2024-02-25', end: '2024-02-27' });
});

test('eachDay enumerates every day in range', () => {
  const days = eachDay({ start: '2026-02-28', end: '2026-03-02' });
  assert.deepEqual(days, ['2026-02-28', '2026-03-01', '2026-03-02']);
});

test('eachDay returns empty for inverted range', () => {
  assert.deepEqual(eachDay({ start: '2026-03-02', end: '2026-02-28' }), []);
});

test('isWithinRange is inclusive on both ends', () => {
  const range = { start: '2026-03-09', end: '2026-03-15' };
  assert.equal(isWithinRange('2026-03-09', range), true);
  assert.equal(isWithinRange('2026-03-15', range), true);
  assert.equal(isWithinRange('2026-03-08', range), false);
  assert.equal(isWithinRange('2026-03-16', range), false);
});

test('toUtcDay formats a date in UTC regardless of local offset', () => {
  assert.equal(toUtcDay(new Date('2026-03-15T23:59:59.999Z')), '2026-03-15');
});

test('isValidRange rejects malformed dates', () => {
  assert.equal(isValidRange('2026-3-1', '2026-03-02'), false);
  assert.equal(isValidRange('2026-03-01', 'not-a-date'), false);
  assert.equal(isValidRange('2026-03-02', '2026-03-01'), false);
  assert.equal(isValidRange('2026-03-01', '2026-03-02'), true);
});

test('preset ranges are stable across a month boundary', () => {
  const march1 = new Date('2026-03-01T00:10:00.000Z');
  const range = resolveRange('7d', undefined, undefined, march1);
  assert.equal(range.end, '2026-03-01');
  assert.equal(range.start, '2026-02-23');
});