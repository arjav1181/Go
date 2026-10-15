import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComparison, type VariantRow } from '../lib/experiments/compare';

const row = (label: string, weight: number, assignments: number, clicks: number, isActive = true): VariantRow => ({
  label,
  destination_url: `https://example.com/${label}`,
  weight,
  is_active: isActive,
  assignments,
  clicks
});

test('shares are computed against the target split', () => {
  const result = buildComparison([row('a', 25, 250, 10), row('b', 75, 750, 20)]);
  const a = result.rows.find((r) => r.label === 'a');
  assert.equal(a?.targetShare, 0.25);
  assert.equal(a?.actualShare, 0.25);
});

test('inactive variants have zero target share', () => {
  const result = buildComparison([row('a', 25, 100, 5), row('b', 75, 0, 0, false)]);
  const b = result.rows.find((r) => r.label === 'b');
  assert.equal(b?.targetShare, 0);
});

test('totals are reported', () => {
  const result = buildComparison([row('a', 50, 100, 5), row('b', 50, 100, 8)]);
  assert.equal(result.totalAssignments, 200);
  assert.equal(result.totalClicks, 13);
});

test('no verdict with fewer than two eligible variants', () => {
  const result = buildComparison([row('a', 100, 500, 50)]);
  assert.equal(result.verdict, null);
});

test('no verdict when both variants are inactive', () => {
  const result = buildComparison([row('a', 0, 0, 0, false), row('b', 0, 0, 0, false)]);
  assert.equal(result.verdict, null);
});

test('small samples produce an insufficient verdict', () => {
  const result = buildComparison([row('a', 50, 10, 2), row('b', 50, 10, 3)]);
  assert.equal(result.verdict?.status, 'insufficient');
  assert.equal(result.verdict?.reason, 'insufficient_sample');
});

test('large samples produce a verdict', () => {
  const result = buildComparison([row('a', 50, 2000, 100), row('b', 50, 2000, 300)]);
  assert.equal(result.verdict?.status, 'significant');
  assert.ok(result.verdict?.pValue !== null);
});

test('identical performance is not significant', () => {
  const result = buildComparison([row('a', 50, 2000, 200), row('b', 50, 2000, 200)]);
  assert.equal(result.verdict?.status, 'not_significant');
});

test('caveats always state the split is approximate', () => {
  const result = buildComparison([row('a', 50, 10, 1), row('b', 50, 10, 1)]);
  assert.ok(result.caveats.some((c) => /approximate/i.test(c)));
  assert.ok(result.caveats.some((c) => /not unique people/i.test(c)));
});

test('comparison never claims an improvement', () => {
  const result = buildComparison([row('a', 50, 2000, 100), row('b', 50, 2000, 900)]);
  const text = [result.verdict?.explanation ?? '', ...result.caveats].join(' ');
  assert.doesNotMatch(text, /will improve/i);
  assert.doesNotMatch(text, /better conversion/i);
  assert.doesNotMatch(text, /increases? (conversion|revenue)/i);
});

test('significant verdict carries the disclaimer', () => {
  const result = buildComparison([row('a', 50, 2000, 100), row('b', 50, 2000, 900)]);
  assert.match(result.verdict?.explanation ?? '', /not a guaranteed improvement/i);
});

test('empty data produces an insufficient verdict, not a crash', () => {
  const result = buildComparison([row('a', 50, 0, 0), row('b', 50, 0, 0)]);
  assert.equal(result.verdict?.status, 'insufficient');
  assert.equal(result.totalAssignments, 0);
});

test('an uneven actual split is reported honestly', () => {
  // Target was 50/50 but observed 90/10.
  const result = buildComparison([row('a', 50, 900, 45), row('b', 50, 100, 5)]);
  const a = result.rows.find((r) => r.label === 'a');
  assert.equal(a?.targetShare, 0.5);
  assert.ok(Math.abs((a?.actualShare ?? 0) - 0.9) < 1e-9);
});

test('custom minimum sample is honoured', () => {
  const rows = [row('a', 50, 20, 4), row('b', 50, 20, 8)];
  assert.equal(buildComparison(rows, { minSample: 100 }).verdict?.status, 'insufficient');
  assert.notEqual(buildComparison(rows, { minSample: 5 }).verdict?.status, 'insufficient');
});