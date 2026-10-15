/**
 * Configurable aggregation dimensions.
 *
 * The owner may switch off referrer and/or device collection. When a dimension
 * is disabled the column is stored as a fixed sentinel instead of the real
 * value, which reduces storage without touching the redirect path and without
 * changing what the redirect itself does.
 *
 * Turning a dimension off therefore stops *storing* that data; it cannot
 * retroactively remove data already written (that is what retention is for).
 */

import { parseReferrerHost, deriveDeviceCategory } from '../analytics/device-category';

export const NO_REFERRER = 'none';
export const NO_DEVICE = 'unknown';

export type AggregationSettings = {
  track_referrer: boolean;
  track_device: boolean;
};

export const DEFAULT_AGGREGATION: AggregationSettings = {
  track_referrer: true,
  track_device: true
};

export function normalizeAggregation(input: {
  track_referrer?: unknown;
  track_device?: unknown;
}): AggregationSettings {
  return {
    // Default to enabled when unspecified: collecting less must be a choice.
    track_referrer: input.track_referrer === undefined ? true : input.track_referrer === true,
    track_device: input.track_device === undefined ? true : input.track_device === true
  };
}

export function resolveReferrerHost(
  settings: AggregationSettings,
  referrer: string | null
): string {
  if (!settings.track_referrer) return NO_REFERRER;
  return parseReferrerHost(referrer);
}

export function resolveDeviceCategory(
  settings: AggregationSettings,
  userAgent: string | null
): string {
  if (!settings.track_device) return NO_DEVICE;
  return deriveDeviceCategory(userAgent);
}

export function describeAggregation(settings: AggregationSettings): string {
  const parts: string[] = [];
  parts.push(settings.track_referrer ? 'referrer hostname' : 'no referrer');
  parts.push(settings.track_device ? 'device category' : 'no device');
  return `Collecting: ${parts.join(', ')}.`;
}