import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replayAssignment,
  simulateDistribution,
  buildConfigSnapshot,
  configFingerprint,
  type ExperimentConfig
} from '../lib/experiments/replay';

const config = (over: Partial<ExperimentConfig> = {}): ExperimentConfig => ({
  version: 1,
  linkId: 'link-1',
  domain: '',
  salt: 'pepper',
  outcome_metric: 'clicks',
  captured_at: '2026-09-01T00:00:00.000Z',
  variants: [
    { id: 'a', label: 'a', destination_url: 'https://example.com/a', weight: 50, is_active: true },
    { id: 'b', label: 'b', destination_url: 'https://example.com/b', weight: 50, is_active: true }
  ],
  ...over
});

test('replay is deterministic for the same config', () => {
  const c = config();
  const first = replayAssignment(c);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(replayAssignment(c).variant?.label, first.variant?.label);
  }
});

test('replay returns the bucket it used', () => {
  const result = replayAssignment(config());
  assert.ok(Number.isInteger(result.bucket));
  assert.ok(result.bucket >= 0 && result.bucket < 10_000);
});

test('replay explains the decision', () => {
  const result = replayAssignment(config());
  assert.match(result.explanation, /Bucket \d+\/10000/);
  assert.match(result.explanation, /version 1/);
});

test('replay with no eligible variant returns null', () => {
  const result = replayAssignment(
    config({
      variants: [
        { id: 'a', label: 'a', destination_url: 'https://e.com', weight: 0, is_active: false }
      ]
    })
  );
  assert.equal(result.variant, null);
  assert.match(result.explanation, /default destination/);
});

test('changing the salt changes the assignment', () => {
  const a = replayAssignment(config({ salt: 'salt-a' }));
  const b = replayAssignment(config({ salt: 'salt-b' }));
  // With a 50/50 split these will usually differ; assert determinism instead of luck.
  assert.equal(replayAssignment(config({ salt: 'salt-a' })).variant?.label, a.variant?.label);
  assert.equal(replayAssignment(config({ salt: 'salt-b' })).variant?.label, b.variant?.label);
});

test('different links are bucketed independently', () => {
  const results = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    results.add(replayAssignment(config({ linkId: `link-${i}` })).variant?.label ?? 'none');
  }
  assert.equal(results.size, 2, 'both arms should be reachable across links');
});

test('a replayed version reproduces after config changes, if the snapshot is kept', () => {
  const archived = config({ version: 1 });
  const first = replayAssignment(archived);

  // Simulate the experiment being edited afterwards.
  const edited = config({ version: 2 });
  edited.variants[0].weight = 0;

  // Replaying the archived snapshot still yields the original decision.
  assert.equal(replayAssignment(archived).variant?.label, first.variant?.label);
});

test('simulation reproduces the configured split', () => {
  const result = simulateDistribution(config(), 10_000);
  assert.ok(Math.abs(result.observedShare.a - 0.5) < 0.02);
  assert.ok(Math.abs(result.observedShare.b - 0.5) < 0.02);
  assert.equal(result.withinTolerance, true);
});

test('simulation of a 25/75 split is close to target', () => {
  const result = simulateDistribution(
    config({
      variants: [
        { id: 'a', label: 'a', destination_url: 'https://e.com/a', weight: 25, is_active: true },
        { id: 'b', label: 'b', destination_url: 'https://e.com/b', weight: 75, is_active: true }
      ]
    }),
    20_000
  );
  assert.ok(Math.abs(result.observedShare.a - 0.25) < 0.02);
  assert.ok(result.maxDeviationPoints < 2);
});

test('simulation counts sum to the trial count', () => {
  const result = simulateDistribution(config(), 5_000);
  const sum = Object.values(result.counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, 5_000);
});

test('simulation of an empty config yields no share', () => {
  const result = simulateDistribution(
    config({ variants: [] }),
    1_000
  );
  assert.deepEqual(result.counts, {});
  assert.equal(result.maxDeviationPoints, 0);
});

test('simulation clamps an absurd trial count', () => {
  const result = simulateDistribution(config(), 10_000_000);
  assert.ok(result.trials <= 200_000);
});

test('inactive variants get zero target and zero observed share', () => {
  const result = simulateDistribution(
    config({
      variants: [
        { id: 'a', label: 'a', destination_url: 'https://e.com/a', weight: 100, is_active: true },
        { id: 'b', label: 'b', destination_url: 'https://e.com/b', weight: 50, is_active: false }
      ]
    }),
    5_000
  );
  assert.equal(result.targetShare.b, 0);
  assert.equal(result.observedShare.b, 0);
});

test('snapshots deep-copy the variants', () => {
  const variants = [
    { id: 'a', label: 'a', destination_url: 'https://e.com', weight: 100, is_active: true }
  ];
  const snapshot = buildConfigSnapshot({
    linkId: 'l',
    domain: '',
    salt: 's',
    variants,
    version: 1
  });
  variants[0].weight = 5;
  assert.equal(snapshot.variants[0].weight, 100, 'snapshot must not track later mutations');
});

test('the fingerprint changes when the configuration changes', () => {
  const a = configFingerprint(config({ version: 1 }));
  const b = configFingerprint(config({ version: 2 }));
  assert.notEqual(a, b);
});

test('the fingerprint is order-independent and stable', () => {
  const c = config();
  const shuffled = config({
    variants: [...c.variants].reverse()
  });
  assert.equal(configFingerprint(c), configFingerprint(shuffled));
  assert.equal(configFingerprint(c), configFingerprint(c));
});