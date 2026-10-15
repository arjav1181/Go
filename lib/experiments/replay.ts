/**
 * Deterministic experiment replay and simulation.
 *
 * Given the *same* configuration snapshot, salt and link identity, replay always
 * produces the same assignment. That is what makes a reported result
 * reproducible: the numbers can be recomputed from the archived config without
 * depending on the live variant rows.
 *
 * Simulation is a routing-distribution check only. It answers "does the split
 * match the configured weights?", which is a property of the bucketing function.
 * It says nothing about real-world conversion.
 */

import { hashBucket, BUCKET_COUNT, assignByBucket, totalWeight, type WeightedVariant } from './bucketing';

export type ExperimentConfigVariant = {
  id: string;
  label: string;
  destination_url: string;
  weight: number;
  is_active: boolean;
};

export type ExperimentConfig = {
  /** Archived with the experiment; not read from the live tables. */
  version: number;
  linkId: string;
  domain: string;
  salt: string;
  variants: ExperimentConfigVariant[];
  outcome_metric: string;
  captured_at: string;
};

export type ReplayResult = {
  variant: ExperimentConfigVariant | null;
  bucket: number;
  /** Why this assignment was made, for auditability. */
  explanation: string;
};

/**
 * Replay one routing decision.
 *
 * The assignment key is identical to the one the redirect path uses, so replay
 * reflects what a real visitor would have been served.
 */
export function replayAssignment(
  config: ExperimentConfig,
  options: { linkId?: string; domain?: string } = {}
): ReplayResult {
  const linkId = options.linkId ?? config.linkId;
  const domain = options.domain ?? config.domain;
  const key = `${config.salt}|${domain}|${linkId}`;
  const bucket = hashBucket(key);

  const picked = assignByBucket(config.variants as WeightedVariant[], bucket);
  // Re-hydrate from the snapshot so the caller gets the full variant record.
  const variant = picked
    ? config.variants.find((candidate) => candidate.id === picked.id) ?? null
    : null;

  return {
    variant,
    bucket,
    explanation: variant
      ? `Bucket ${bucket}/${BUCKET_COUNT} selected "${variant.label}" for this link under version ${config.version}.`
      : `Bucket ${bucket}/${BUCKET_COUNT} matched no eligible variant; the default destination would be served.`
  };
}

export type SimulationResult = {
  trials: number;
  counts: Record<string, number>;
  observedShare: Record<string, number>;
  targetShare: Record<string, number>;
  /** Largest absolute deviation from target, in percentage points. */
  maxDeviationPoints: number;
  withinTolerance: boolean;
};

/**
 * Simulate the routing distribution over synthetic keys.
 *
 * This is a check of the bucketing function, NOT an experiment outcome. Real
 * visitors do not arrive as `sim-0`, `sim-1`, …, so equal counts here prove the
 * weights are applied correctly and nothing more.
 */
export function simulateDistribution(
  config: ExperimentConfig,
  trials: number = 10_000,
  tolerancePoints: number = 2
): SimulationResult {
  const safeTrials = Math.max(1, Math.min(Math.trunc(trials), 200_000));
  const counts: Record<string, number> = {};
  let total = 0;

  for (const variant of config.variants) {
    if (variant.is_active && variant.weight > 0) total += variant.weight;
  }

  for (let i = 0; i < safeTrials; i += 1) {
    // Distinct synthetic keys exercise the full bucket space.
    const variant = assignByBucket(
      config.variants as WeightedVariant[],
      hashBucket(`sim:${config.salt}:${config.linkId}:${i}`),
      BUCKET_COUNT
    );
    if (!variant) continue;
    counts[variant.label] = (counts[variant.label] ?? 0) + 1;
  }

  const targetShare: Record<string, number> = {};
  const observedShare: Record<string, number> = {};
  let maxDeviationPoints = 0;

  for (const variant of config.variants) {
    const eligible = variant.is_active && variant.weight > 0;
    const target = eligible && total > 0 ? variant.weight / total : 0;
    const observed = safeTrials > 0 ? (counts[variant.label] ?? 0) / safeTrials : 0;
    targetShare[variant.label] = target;
    observedShare[variant.label] = observed;
    maxDeviationPoints = Math.max(maxDeviationPoints, Math.abs(observed - target) * 100);
  }

  return {
    trials: safeTrials,
    counts,
    observedShare,
    targetShare,
    maxDeviationPoints,
    withinTolerance: maxDeviationPoints <= tolerancePoints
  };
}

/** Compute the immutable configuration snapshot for an experiment. */
export function buildConfigSnapshot(input: {
  linkId: string;
  domain: string;
  salt: string;
  variants: Array<{
    id: string;
    label: string;
    destination_url: string;
    weight: number;
    is_active: boolean;
  }>;
  outcomeMetric?: string;
  version: number;
}): ExperimentConfig {
  return {
    version: input.version,
    linkId: input.linkId,
    domain: input.domain,
    salt: input.salt,
    variants: input.variants.map((variant) => ({ ...variant })),
    outcome_metric: input.outcomeMetric ?? 'clicks',
    captured_at: new Date().toISOString()
  };
}

/** Stable fingerprint of a configuration, so a result can be tied to a config. */
export function configFingerprint(config: ExperimentConfig): string {
  const parts = [
    `v${config.version}`,
    config.domain || 'canonical',
    config.outcome_metric,
    ...[...config.variants]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((variant) => `${variant.label}:${variant.weight}:${variant.is_active ? 1 : 0}`)
  ];
  return parts.join('|');
}

export { totalWeight };