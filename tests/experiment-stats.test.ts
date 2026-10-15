import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  erf,
  normalCdf,
  twoTailedP,
  compareProportions,
  MIN_SAMPLE_PER_ARM
} from '../lib/experiments/stats';

test('erf matches reference values', () => {
  assert.ok(Math.abs(erf(0) - 0) < 1e-6);
  assert.ok(Math.abs(erf(1) - 0.8427008) < 1e-6);
  assert.ok(Math.abs(erf(-1) + 0.8427008) < 1e-6);
  assert.ok(Math.abs(erf(2) - 0.9953223) < 1e-6);
  assert.ok(Math.abs(erf(0.5) - 0.5204999) < 1e-6);
});

test('erf is odd', () => {
  for (const x of [0.1, 0.75, 1.5, 3]) {
    assert.ok(Math.abs(erf(x) + erf(-x)) < 1e-9);
  }
});

test('normalCdf matches reference values', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-4);
  assert.ok(Math.abs(normalCdf(1) - 0.8413447) < 1e-6);
});

test('normalCdf is monotonic and bounded', () => {
  let previous = 0;
  for (let z = -4; z <= 4; z += 0.25) {
    const value = normalCdf(z);
    assert.ok(value >= previous);
    assert.ok(value >= 0 && value <= 1);
    previous = value;
  }
});

test('twoTailedP matches known z values', () => {
  assert.ok(Math.abs(twoTailedP(1.96) - 0.05) < 1e-3);
  assert.ok(Math.abs(twoTailedP(2.576) - 0.01) < 1e-3);
  assert.ok(Math.abs(twoTailedP(0) - 1) < 1e-9);
  assert.ok(twoTailedP(10) < 1e-20);
});

test('twoTailedP is symmetric', () => {
  assert.ok(Math.abs(twoTailedP(1.7) - twoTailedP(-1.7)) < 1e-12);
});

// --- compareProportions ----------------------------------------------------

test('empty data reports insufficient with no p-value', () => {
  const result = compareProportions({ successes: 0, trials: 0 }, { successes: 0, trials: 0 });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.pValue, null);
  assert.equal(result.reason, 'empty');
});

test('small samples refuse to produce a verdict', () => {
  const result = compareProportions({ successes: 5, trials: 10 }, { successes: 40, trials: 50 });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.pValue, null);
  assert.equal(result.reason, 'insufficient_sample');
  assert.match(result.explanation, /at least 100/);
});

test('a custom minimum sample is respected', () => {
  const result = compareProportions(
    { successes: 5, trials: 10 },
    { successes: 6, trials: 10 },
    { minSample: 5 }
  );
  assert.notEqual(result.status, 'insufficient');
});

test('identical rates are reported as not significant, not as a win', () => {
  const result = compareProportions(
    { successes: 50, trials: 100 },
    { successes: 50, trials: 100 }
  );
  assert.equal(result.status, 'not_significant');
  assert.equal(result.difference, 0);
  assert.equal(result.reason, 'identical_rates');
});

test('a large clear difference is significant', () => {
  const result = compareProportions(
    { successes: 100, trials: 1000 },
    { successes: 250, trials: 1000 }
  );
  assert.equal(result.status, 'significant');
  assert.ok((result.pValue ?? 1) < 0.05);
  assert.ok(result.z !== null && result.z > 0);
});

test('a large clear difference in the other direction is also significant', () => {
  const result = compareProportions(
    { successes: 250, trials: 1000 },
    { successes: 100, trials: 1000 }
  );
  assert.equal(result.status, 'significant');
  assert.ok(result.z !== null && result.z < 0);
});

test('a small difference is not significant', () => {
  const result = compareProportions(
    { successes: 500, trials: 1000 },
    { successes: 530, trials: 1000 }
  );
  assert.equal(result.status, 'not_significant');
  assert.ok((result.pValue ?? 0) > 0.05);
});

test('degenerate 100% rates refuse the test', () => {
  const result = compareProportions(
    { successes: 200, trials: 200 },
    { successes: 200, trials: 200 }
  );
  assert.equal(result.status, 'insufficient');
  assert.equal(result.pValue, null);
  assert.equal(result.reason, 'degenerate_rate');
});

test('near-zero rates refuse the test rather than reporting nonsense', () => {
  const result = compareProportions(
    { successes: 1, trials: 5000 },
    { successes: 3, trials: 5000 }
  );
  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'degenerate_rate');
  assert.match(result.explanation, /descriptive/);
});

test('never makes a positive improvement claim', () => {
  const result = compareProportions(
    { successes: 100, trials: 1000 },
    { successes: 300, trials: 1000 }
  );
  // "improvement" may appear only inside the explicit disclaimer; strip that
  // and assert nothing affirmative remains.
  const withoutDisclaimer = result.explanation.replace(
    /not a guaranteed improvement\.?/gi,
    ''
  );
  assert.doesNotMatch(withoutDisclaimer, /improve/i);
  assert.doesNotMatch(withoutDisclaimer, /better (conversion|performance|results)/i);
  assert.doesNotMatch(withoutDisclaimer, /will (improve|increase|boost)/i);
  assert.doesNotMatch(withoutDisclaimer, /guarantee[sd]? (better|more|higher)/i);
});

test('significant wording states it is not a guarantee', () => {
  const result = compareProportions(
    { successes: 100, trials: 1000 },
    { successes: 300, trials: 1000 }
  );
  assert.match(result.explanation, /not a guaranteed improvement/i);
});

test('rates and difference are always reported descriptively', () => {
  const result = compareProportions(
    { successes: 10, trials: 20 },
    { successes: 3, trials: 40 }
  );
  assert.equal(result.rateA, 0.5);
  assert.equal(result.rateB, 0.075);
  assert.ok(Math.abs(result.difference - -0.425) < 1e-9);
});

test('zero-trial arms do not produce NaN', () => {
  const result = compareProportions({ successes: 0, trials: 0 }, { successes: 200, trials: 200 });
  assert.ok(Number.isFinite(result.rateA));
  assert.ok(Number.isFinite(result.rateB));
  assert.ok(Number.isFinite(result.difference));
  assert.equal(result.status, 'insufficient');
});

test('the default minimum sample is the documented value', () => {
  assert.equal(MIN_SAMPLE_PER_ARM, 100);
  const justUnder = compareProportions(
    { successes: 50, trials: MIN_SAMPLE_PER_ARM - 1 },
    { successes: 60, trials: 1000 }
  );
  assert.equal(justUnder.status, 'insufficient');
});