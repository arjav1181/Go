/**
 * Deterministic traffic bucketing for A/B variants.
 *
 * A visitor's arm is chosen by hashing an opaque key, NOT by storing anything.
 * There is no cookie, no fingerprint and no per-visitor row: the same key
 * always lands in the same arm, and the key itself is never persisted.
 *
 * The key is normally `salt + link_id + variant set signature`, so an owner can
 * rotate `EXPERIMENT_SALT` to re-randomise every visitor at once.
 *
 * Bucketing is a best-effort sticky mechanism:
 *  - it is stable per link and salt, but not a guarantee of equal split;
 *  - the same person on two devices may land in different arms;
 *  - an ad blocker or stripped identifier is irrelevant because no identifier
 *    is consulted at all.
 */

import { createHash } from 'node:crypto';

export const BUCKET_COUNT = 10_000;

export type WeightedVariant = {
  id: string;
  label: string;
  weight: number;
  is_active: boolean;
};

export type WeightedDestination = WeightedVariant & { destination_url: string };

/**
 * Map an arbitrary key to a bucket in [0, bucketCount).
 *
 * Uses the first 4 bytes of a SHA-256 digest, which is uniform for unrelated
 * inputs (unlike a plain modulo of a small integer hash).
 */
export function hashBucket(key: string, bucketCount: number = BUCKET_COUNT): number {
  const digest = createHash('sha256').update(key, 'utf8').digest();
  return digest.readUInt32BE(0) % bucketCount;
}

export function activeWeighted(variants: WeightedVariant[]): WeightedVariant[] {
  return variants.filter((variant) => variant.is_active && variant.weight > 0);
}

export function totalWeight(variants: WeightedVariant[]): number {
  return variants.reduce((sum, variant) => sum + Math.max(0, variant.weight), 0);
}

/**
 * Choose a variant for a bucket value.
 *
 * Weights are relative: [1, 3] and [25, 75] select the same boundaries. The
 * mapping is pure, so a given bucket always yields the same variant.
 */
export function assignByBucket(
  variants: WeightedVariant[],
  bucket: number,
  bucketCount: number = BUCKET_COUNT
): WeightedVariant | null {
  const candidates = activeWeighted(variants);
  if (candidates.length === 0) return null;

  const total = totalWeight(candidates);
  if (total <= 0) return null;

  const normalizedBucket = ((bucket % bucketCount) + bucketCount) % bucketCount;
  const target = (normalizedBucket / bucketCount) * total;

  let cursor = 0;
  for (const variant of candidates) {
    cursor += variant.weight;
    if (target < cursor) return variant;
  }
  // Floating-point safety net.
  return candidates[candidates.length - 1];
}

/** Convenience: hash the key and select in one step. */
export function assignVariantForKey(
  variants: WeightedVariant[],
  key: string,
  bucketCount: number = BUCKET_COUNT
): WeightedVariant | null {
  return assignByBucket(variants, hashBucket(key, bucketCount), bucketCount);
}

/**
 * A stable signature of the variant set.
 *
 * Changing weights or destinations changes the signature, which re-buckets
 * traffic. Include it in the assignment key only when that behaviour is wanted.
 */
export function variantSetSignature(variants: WeightedVariant[]): string {
  return candidates(variants)
    .map((variant) => `${variant.id}:${variant.weight}`)
    .sort()
    .join('|');
}

function candidates(variants: WeightedVariant[]): WeightedVariant[] {
  return activeWeighted(variants).slice().sort((a, b) => a.id.localeCompare(b.id));
}

/** Observed share of each label over a set of buckets. Used for verification. */
export function distribution(
  variants: WeightedVariant[],
  bucketCount: number = BUCKET_COUNT,
  sampleStep = 1
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let bucket = 0; bucket < bucketCount; bucket += sampleStep) {
    const picked = assignByBucket(variants, bucket, bucketCount);
    if (!picked) continue;
    counts[picked.label] = (counts[picked.label] ?? 0) + 1;
  }
  return counts;
}