import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashBucket,
  assignByBucket,
  assignVariantForKey,
  activeWeighted,
  totalWeight,
  variantSetSignature,
  distribution,
  BUCKET_COUNT,
  type WeightedVariant
} from '../lib/experiments/bucketing';

const v = (id: string, weight: number, isActive = true): WeightedVariant => ({
  id,
  label: id,
  weight,
  is_active: isActive
});

test('hashBucket stays in range', () => {
  for (let i = 0; i < 500; i += 1) {
    const bucket = hashBucket(`key-${i}`);
    assert.ok(Number.isInteger(bucket));
    assert.ok(bucket >= 0 && bucket < BUCKET_COUNT);
  }
});

test('hashBucket is deterministic', () => {
  assert.equal(hashBucket('same-key'), hashBucket('same-key'));
});

test('different keys spread across buckets as the birthday paradox predicts', () => {
  // With n keys in m buckets the expected distinct count is m*(1-(1-1/m)^n).
  // For 2000 keys in 10000 buckets that is ~1813, so ~187 collisions are normal.
  const keys = 2000;
  const expected = BUCKET_COUNT * (1 - Math.pow(1 - 1 / BUCKET_COUNT, keys));
  const seen = new Set<number>();
  for (let i = 0; i < keys; i += 1) seen.add(hashBucket(`visitor-${i}`));
  assert.ok(
    Math.abs(seen.size - expected) < expected * 0.05,
    `got ${seen.size}, expected about ${expected.toFixed(0)}`
  );
});

test('the same key always yields the same variant', () => {
  const variants = [v('a', 50), v('b', 50)];
  const first = assignVariantForKey(variants, 'stable-key')?.label;
  for (let i = 0; i < 100; i += 1) {
    assert.equal(assignVariantForKey(variants, 'stable-key')?.label, first);
  }
});

test('a single active variant always wins', () => {
  assert.equal(assignByBucket([v('only', 100)], 0)?.label, 'only');
  assert.equal(assignByBucket([v('only', 100)], 9999)?.label, 'only');
});

test('inactive and zero-weight variants are never selected', () => {
  const variants = [v('off', 100, false), v('zero', 0), v('on', 1)];
  for (let bucket = 0; bucket < BUCKET_COUNT; bucket += 97) {
    assert.equal(assignByBucket(variants, bucket)?.label, 'on');
  }
});

test('no eligible variants returns null', () => {
  assert.equal(assignByBucket([], 0), null);
  assert.equal(assignByBucket([v('a', 0)], 0), null);
  assert.equal(assignByBucket([v('a', 10, false)], 0), null);
});

test('weights are relative, not absolute', () => {
  const relative = assignByBucket([v('a', 1), v('b', 3)], 7500);
  const absolute = assignByBucket([v('a', 25), v('b', 75)], 7500);
  assert.equal(relative?.label, absolute?.label);
});

test('zero-weight bucket maps to the first positive-weight variant', () => {
  assert.equal(assignByBucket([v('a', 1), v('b', 3)], 0)?.label, 'a');
});

test('bucket boundaries are respected', () => {
  const variants = [v('a', 25), v('b', 75)];
  assert.equal(assignByBucket(variants, 2499)?.label, 'a');
  assert.equal(assignByBucket(variants, 2500)?.label, 'b');
});

test('out-of-range buckets wrap instead of throwing', () => {
  const variants = [v('a', 50), v('b', 50)];
  assert.equal(assignByBucket(variants, BUCKET_COUNT)?.label, assignByBucket(variants, 0)?.label);
  assert.ok(assignByBucket(variants, -1));
});

test('activeWeighted and totalWeight helpers', () => {
  const list = [v('a', 5), v('b', 0), v('c', 5, false), v('d', 10)];
  assert.deepEqual(activeWeighted(list).map((x) => x.id), ['a', 'd']);
  assert.equal(totalWeight(list), 20);
  assert.equal(totalWeight([]), 0);
});

test('distribution matches configured weights closely', () => {
  // 25/75 split, sampled across every bucket.
  const variants = [v('a', 25), v('b', 75)];
  const counts = distribution(variants, BUCKET_COUNT);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shareA = (counts.a ?? 0) / total;
  assert.ok(Math.abs(shareA - 0.25) < 0.01, `share was ${shareA}`);
});

test('even 50/50 split is balanced', () => {
  const counts = distribution([v('a', 50), v('b', 50)], BUCKET_COUNT);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shareA = (counts.a ?? 0) / total;
  assert.ok(Math.abs(shareA - 0.5) < 0.01, `share was ${shareA}`);
});

test('three-way split approximates the weights', () => {
  const variants = [v('a', 10), v('b', 20), v('c', 70)];
  const counts = distribution(variants, BUCKET_COUNT);
  const total = Object.values(counts).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(counts.a / total - 0.1) < 0.01);
  assert.ok(Math.abs(counts.b / total - 0.2) < 0.01);
  assert.ok(Math.abs(counts.c / total - 0.7) < 0.01);
});

test('observed split over realistic keys tracks the configured weights', () => {
  // Statistical check on hashed keys, the way production assigns.
  const variants = [v('a', 30), v('b', 70)];
  let a = 0;
  const trials = 5000;
  for (let i = 0; i < trials; i += 1) {
    if (assignVariantForKey(variants, `user-${i}`)?.label === 'a') a += 1;
  }
  const share = a / trials;
  assert.ok(Math.abs(share - 0.3) < 0.05, `share was ${share}`);
});

test('changing weights changes the signature and re-buckets', () => {
  const before = variantSetSignature([v('a', 50), v('b', 50)]);
  const after = variantSetSignature([v('a', 70), v('b', 30)]);
  assert.notEqual(before, after);
});

test('signature is order-independent', () => {
  assert.equal(
    variantSetSignature([v('a', 1), v('b', 2)]),
    variantSetSignature([v('b', 2), v('a', 1)])
  );
});

test('signature ignores inactive and zero-weight variants', () => {
  assert.equal(
    variantSetSignature([v('a', 1), v('b', 0), v('c', 9, false)]),
    variantSetSignature([v('a', 1)])
  );
});