import { getServiceSupabase } from '@/lib/db/supabase-server';
import {
  resolveReferrerHost,
  resolveDeviceCategory,
  DEFAULT_AGGREGATION,
  type AggregationSettings
} from '@/lib/settings/aggregation';
import { getCachedOwnerSettings } from '@/lib/settings/cache';

export async function recordClick(input: {
  linkId: string;
  ownerId?: string;
  referrer: string | null;
  userAgent: string | null;
  /** Which weighted variant served the click; '' for the link/schedule target. */
  variantLabel?: string;
  /** Aggregation dimensions for this owner; defaults to collecting both. */
  aggregation?: AggregationSettings;
}): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    // Explicit settings win; otherwise resolve from the owner's cached settings.
    const aggregation =
      input.aggregation ??
      (input.ownerId ? (await getCachedOwnerSettings(input.ownerId)).aggregation : DEFAULT_AGGREGATION);

    const referrerHost = resolveReferrerHost(aggregation, input.referrer);
    const deviceCategory = resolveDeviceCategory(aggregation, input.userAgent);
    const variantLabel = (input.variantLabel ?? '').slice(0, 32);
    const supabase = getServiceSupabase();
    await supabase.rpc('increment_click', {
      p_link_id: input.linkId,
      p_day: day,
      p_referrer_host: referrerHost,
      p_device_category: deviceCategory,
      p_variant_label: variantLabel
    });
  } catch {
    // Analytics failures must not break redirects or expose visitor data.
  }
}