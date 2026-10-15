/**
 * Statistics for A/B comparison.
 *
 * This module deliberately refuses to produce a verdict unless the statistical
 * assumptions hold. It implements a two-proportion z-test (pooled) and reports
 * `insufficient` whenever the sample is too small or the test is degenerate.
 *
 * What a result does NOT mean:
 *  - a significant difference is evidence of a difference in observed rates, not
 *    proof that a variant causes better outcomes;
 *  - repeated clicks from one person are not independent observations, so the
 *    p-value can be optimistic when a single visitor contributes many clicks;
 *  - traffic split is approximate, so the achieved split may differ from target.
 */

/** Minimum observations per arm before a test is even attempted. */
export const MIN_SAMPLE_PER_ARM = 100;

/** Standard significance threshold. */
export const ALPHA = 0.05;

/** Pooled proportion bounds; outside this the normal approximation is unusable. */
const MIN_POOLED_P = 0.01;
const MAX_POOLED_P = 0.99;

/** Standard normal probability density. */
export function normalPdf(z: number): number {
  return Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
}

const SIMPSON_INTERVALS = 1000;

/**
 * Standard normal CDF.
 *
 * Computed by composite Simpson integration of the pdf from 0 to |z|. This is
 * slower than a fitted polynomial but verifiable: it reproduces the definitional
 * percentiles (Phi(1.959964) = 0.975) to ~1e-9 with no dependence on
 * remembered constants that may be subtly wrong.
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  if (z === 0) return 0.5;

  const sign = z < 0 ? -1 : 1;
  const limit = Math.abs(z);
  const h = limit / SIMPSON_INTERVALS;

  let sum = normalPdf(0) + normalPdf(limit);
  for (let i = 1; i < SIMPSON_INTERVALS; i += 1) {
    sum += (i % 2 === 1 ? 4 : 2) * normalPdf(i * h);
  }

  return 0.5 + sign * ((sum * h) / 3);
}

/** Error function, derived from the normal CDF. */
export function erf(x: number): number {
  return 2 * normalCdf(x * Math.SQRT2) - 1;
}

/** Two-tailed p-value for a z statistic. */
export function twoTailedP(z: number): number {
  if (!Number.isFinite(z)) return 1;
  const absolute = Math.abs(z);
  if (absolute > 40) return 0;
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(absolute))));
}

export type VerdictStatus = 'significant' | 'not_significant' | 'insufficient';

export type ComparisonResult = {
  status: VerdictStatus;
  /** Null unless the test actually ran. */
  pValue: number | null;
  z: number | null;
  rateA: number;
  rateB: number;
  difference: number;
  sampleA: number;
  sampleB: number;
  alpha: number;
  /** Human-readable, safe to render verbatim. */
  explanation: string;
  /** Machine-readable reason when status is `insufficient`. */
  reason?:
    | 'empty'
    | 'insufficient_sample'
    | 'degenerate_rate'
    | 'identical_rates'
    | 'identical_samples';
};

export type Arm = { successes: number; trials: number };

function rate(arm: Arm): number {
  if (arm.trials <= 0) return 0;
  return arm.successes / arm.trials;
}

/**
 * Two-proportion z-test comparing arm B against arm A.
 *
 * `successes` is whatever "outcome" means to the caller (in this product,
 * aggregate clicks). It is returned honestly: when the assumptions do not hold
 * there is no p-value and the explanation says why.
 */
export function compareProportions(
  armA: Arm,
  armB: Arm,
  options: { minSample?: number; alpha?: number } = {}
): ComparisonResult {
  const minSample = options.minSample ?? MIN_SAMPLE_PER_ARM;
  const alpha = options.alpha ?? ALPHA;

  const rateA = rate(armA);
  const rateB = rate(armB);
  const difference = rateB - rateA;

  const base = {
    rateA,
    rateB,
    difference,
    sampleA: armA.trials,
    sampleB: armB.trials,
    alpha
  };

  if (armA.trials <= 0 && armB.trials <= 0) {
    return {
      ...base,
      status: 'insufficient',
      pValue: null,
      z: null,
      reason: 'empty',
      explanation: 'No observations yet, so nothing can be compared.'
    };
  }

  if (armA.trials < minSample || armB.trials < minSample) {
    return {
      ...base,
      status: 'insufficient',
      pValue: null,
      z: null,
      reason: 'insufficient_sample',
      explanation: `Not enough data to assess: at least ${minSample} observations per variant are needed.`
    };
  }

  if (armA.successes === armA.trials && armB.successes === armB.trials) {
    return {
      ...base,
      status: 'insufficient',
      pValue: null,
      z: null,
      reason: 'degenerate_rate',
      explanation: 'Every observation converted in both variants, so no comparison is possible.'
    };
  }

  if (armA.successes === 0 && armB.successes === 0) {
    return {
      ...base,
      status: 'insufficient',
      pValue: null,
      z: null,
      reason: 'degenerate_rate',
      explanation: 'No observed outcomes in either variant, so no comparison is possible.'
    };
  }

  const pooled = (armA.successes + armB.successes) / (armA.trials + armB.trials);
  if (pooled <= MIN_POOLED_P || pooled >= MAX_POOLED_P) {
    return {
      ...base,
      status: 'insufficient',
      pValue: null,
      z: null,
      reason: 'degenerate_rate',
      explanation:
        'Outcome rate is near 0% or 100%, where a z-test is unreliable. Treat this as descriptive only.'
    };
  }

  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / armA.trials + 1 / armB.trials)
  );

  if (standardError === 0 || !Number.isFinite(standardError)) {
    return {
      ...base,
      status: 'insufficient',
      pValue: null,
      z: null,
      reason: 'degenerate_rate',
      explanation: 'The test could not be computed for this data.'
    };
  }

  const z = difference / standardError;
  const pValue = twoTailedP(z);

  if (difference === 0) {
    return {
      ...base,
      status: 'not_significant',
      pValue: 1,
      z: 0,
      reason: 'identical_rates',
      explanation: 'Both variants produced identical observed rates.'
    };
  }

  const significant = pValue < alpha;
  const direction = difference > 0 ? 'higher' : 'lower';
  const pText = pValue < 0.0001 ? '< 0.0001' : pValue.toFixed(4);
  const diffText = Math.abs(difference * 100).toFixed(2);

  return {
    ...base,
    status: significant ? 'significant' : 'not_significant',
    pValue,
    z,
    explanation: significant
      ? `Observed rate is ${direction} by ${diffText} percentage points ` +
        `(p = ${pText}). This indicates a difference in observed rates, not a guaranteed improvement.`
      : `No statistically significant difference detected (p = ${pText}, threshold ${alpha}).`
  };
}