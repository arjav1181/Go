import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isScheduleActive,
  selectActiveSchedule,
  findOverlappingSchedules,
  pickWeightedVariant,
  activeVariants,
  resolveEffectiveDestination,
  type Variant,
  type ScheduleWindow
} from '../lib/links/target';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 3_600_000;

const window = (id: string, startOffsetH: number, endOffsetH: number | null): ScheduleWindow => ({
  id,
  destination_url: `https://example.com/${id}`,
  starts_at: new Date(NOW.getTime() + startOffsetH * HOUR).toISOString(),
  ends_at: endOffsetH === null ? null : new Date(NOW.getTime() + endOffsetH * HOUR).toISOString()
});

const variant = (label: string, weight: number, isActive = true): Variant => ({
  id: label,
  label,
  destination_url: `https://example.com/${label}`,
  weight,
  is_active: isActive
});

// --- schedule windows ------------------------------------------------------

test('schedule is active inside its window', () => {
  assert.equal(isScheduleActive(window('a', -1, 1), NOW), true);
});

test('schedule is inactive before it starts', () => {
  assert.equal(isScheduleActive(window('a', 1, 2), NOW), false);
});

test('schedule is inactive after it ends', () => {
  assert.equal(isScheduleActive(window('a', -2, -1), NOW), false);
});

test('schedule starting exactly now is active', () => {
  assert.equal(isScheduleActive(window('a', 0, 5), NOW), true);
});

test('schedule ending exactly now is inactive (half-open interval)', () => {
  assert.equal(isScheduleActive(window('a', -5, 0), NOW), false);
});

test('open-ended schedule stays active', () => {
  assert.equal(isScheduleActive(window('a', -1, null), NOW), true);
});

test('open-ended schedule is inactive before it starts', () => {
  assert.equal(isScheduleActive(window('a', 1, null), NOW), false);
});

test('invalid timestamps are never active', () => {
  assert.equal(
    isScheduleActive({ id: 'x', destination_url: 'https://e.com', starts_at: 'nonsense', ends_at: null }, NOW),
    false
  );
});

test('most recently started active schedule wins', () => {
  const early = window('early', -10, 10);
  const late = window('late', -1, 10);
  assert.equal(selectActiveSchedule([early, late], NOW)?.id, 'late');
  assert.equal(selectActiveSchedule([late, early], NOW)?.id, 'late');
});

test('no active schedule returns null', () => {
  assert.equal(selectActiveSchedule([window('a', 1, 2), window('b', -5, -4)], NOW), null);
});

// --- overlap detection -----------------------------------------------------

test('overlapping windows are detected', () => {
  const existing = [window('a', 0, 10)];
  const start = new Date(NOW.getTime() + 5 * HOUR).toISOString();
  const end = new Date(NOW.getTime() + 15 * HOUR).toISOString();
  assert.equal(findOverlappingSchedules(existing, start, end).length, 1);
});

test('adjacent non-overlapping windows are allowed', () => {
  const existing = [window('a', 0, 5)];
  const start = new Date(NOW.getTime() + 5 * HOUR).toISOString();
  const end = new Date(NOW.getTime() + 9 * HOUR).toISOString();
  assert.equal(findOverlappingSchedules(existing, start, end).length, 0);
});

test('a window contained by an existing one overlaps', () => {
  const existing = [window('a', 0, 10)];
  const start = new Date(NOW.getTime() + 2 * HOUR).toISOString();
  const end = new Date(NOW.getTime() + 3 * HOUR).toISOString();
  assert.equal(findOverlappingSchedules(existing, start, end).length, 1);
});

test('an open-ended existing window overlaps any future window', () => {
  const existing = [window('a', -1, null)];
  const start = new Date(NOW.getTime() + 50 * HOUR).toISOString();
  assert.equal(findOverlappingSchedules(existing, start, null).length, 1);
});

test('excluding an id ignores that schedule', () => {
  const existing = [window('a', 0, 10)];
  const start = new Date(NOW.getTime() + HOUR).toISOString();
  const end = new Date(NOW.getTime() + 2 * HOUR).toISOString();
  assert.equal(findOverlappingSchedules(existing, start, end, 'a').length, 0);
});

// --- weighted variants -----------------------------------------------------

test('picks the only variant', () => {
  assert.equal(pickWeightedVariant([variant('a', 100)], () => 0.99)?.label, 'a');
});

test('respects relative weights at boundaries', () => {
  const variants = [variant('a', 25), variant('b', 75)];
  assert.equal(pickWeightedVariant(variants, () => 0)?.label, 'a');
  assert.equal(pickWeightedVariant(variants, () => 0.24)?.label, 'a');
  assert.equal(pickWeightedVariant(variants, () => 0.25)?.label, 'b');
  assert.equal(pickWeightedVariant(variants, () => 0.99)?.label, 'b');
});

test('random never returns out of range', () => {
  const variants = [variant('a', 50), variant('b', 50)];
  assert.equal(pickWeightedVariant(variants, () => 0)?.label, 'a');
  assert.equal(pickWeightedVariant(variants, () => 0.999999)?.label, 'b');
});

test('inactive variants are ignored', () => {
  const variants = [variant('a', 100, false), variant('b', 1)];
  assert.equal(pickWeightedVariant(variants, () => 0.5)?.label, 'b');
});

test('zero-weight variants are never selected', () => {
  const variants = [variant('a', 0), variant('b', 10)];
  for (const r of [0, 0.1, 0.5, 0.99]) {
    assert.equal(pickWeightedVariant(variants, () => r)?.label, 'b');
  }
});

test('all-zero weights return null', () => {
  assert.equal(pickWeightedVariant([variant('a', 0), variant('b', 0)], () => 0.5), null);
});

test('empty variant list returns null', () => {
  assert.equal(pickWeightedVariant([], () => 0.5), null);
});

test('relative weights match absolute weights in distribution', () => {
  const relative = [variant('a', 1), variant('b', 3)];
  const absolute = [variant('a', 25), variant('b', 75)];
  for (const r of [0, 0.1, 0.24, 0.25, 0.5, 0.74, 0.75, 0.99]) {
    assert.equal(pickWeightedVariant(relative, () => r)?.label, pickWeightedVariant(absolute, () => r)?.label);
  }
});

test('equal weights behave as rotation across the full range', () => {
  const variants = [variant('a', 50), variant('b', 50)];
  assert.equal(pickWeightedVariant(variants, () => 0.1)?.label, 'a');
  assert.equal(pickWeightedVariant(variants, () => 0.9)?.label, 'b');
});

test('distribution approximates the configured weights', () => {
  const variants = [variant('a', 10), variant('b', 90)];
  let a = 0;
  const total = 10000;
  for (let i = 0; i < total; i += 1) {
    if (pickWeightedVariant(variants, () => i / total)?.label === 'a') a += 1;
  }
  // ~10% expected; allow a generous band so the test is not flaky.
  assert.ok(a / total > 0.08 && a / total < 0.12, `got ${a / total}`);
});

test('activeVariants filters by active flag and positive weight', () => {
  const list = [variant('a', 5), variant('b', 0), variant('c', 5, false), variant('d', 5)];
  assert.deepEqual(activeVariants(list).map((v) => v.label), ['a', 'd']);
});

// --- precedence ------------------------------------------------------------

test('falls back to the link destination when nothing applies', () => {
  const resolved = resolveEffectiveDestination({ linkDestination: 'https://example.com/base', now: NOW });
  assert.deepEqual(resolved, { destination: 'https://example.com/base', source: 'link', label: null });
});

test('an active schedule overrides the link destination', () => {
  const resolved = resolveEffectiveDestination({
    linkDestination: 'https://example.com/base',
    schedules: [window('promo', -1, 5)],
    now: NOW
  });
  assert.equal(resolved.source, 'schedule');
  assert.equal(resolved.destination, 'https://example.com/promo');
});

test('a schedule out of window does not override', () => {
  const resolved = resolveEffectiveDestination({
    linkDestination: 'https://example.com/base',
    schedules: [window('promo', 5, 9)],
    now: NOW
  });
  assert.equal(resolved.source, 'link');
});

test('a schedule overrides a variant', () => {
  const resolved = resolveEffectiveDestination({
    linkDestination: 'https://example.com/base',
    schedules: [window('promo', -1, 5)],
    variants: [variant('a', 100)],
    now: NOW
  });
  assert.equal(resolved.source, 'schedule');
});

test('a variant is used when no schedule applies', () => {
  const resolved = resolveEffectiveDestination({
    linkDestination: 'https://example.com/base',
    variants: [variant('a', 100)],
    now: NOW,
    random: () => 0.1
  });
  assert.equal(resolved.source, 'variant');
  assert.equal(resolved.destination, 'https://example.com/a');
  assert.equal(resolved.label, 'a');
});

test('inactive variants leave the link destination in place', () => {
  const resolved = resolveEffectiveDestination({
    linkDestination: 'https://example.com/base',
    variants: [variant('a', 100, false)],
    now: NOW
  });
  assert.equal(resolved.source, 'link');
});

test('link expiry still short-circuits destination resolution', () => {
  // Expiry is evaluated before this function is ever called; this asserts the
  // engine itself never resurrects an expired link by supplying a target.
  const resolved = resolveEffectiveDestination({
    linkDestination: 'https://example.com/base',
    schedules: [window('promo', -10, 10)],
    now: NOW
  });
  assert.equal(resolved.destination, 'https://example.com/promo');
});