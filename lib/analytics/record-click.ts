import { getServiceSupabase } from '@/lib/db/supabase-server';
import { CAMPAIGN_PATTERN } from '@/lib/links/campaigns';
import { isReservedReferrer } from './device-category';
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
  /**
   * Two-letter country code resolved at the CDN edge.
   *
   * Taken from the `x-vercel-ip-country` request header rather than by
   * geolocating the visitor's address, so no IP is ever persisted. See
   * migration 0015 for the reasoning. Empty when the edge could not determine
   * it, which is normal and not an error.
   */
  countryCode?: string | null;
  /** Which weighted variant served the click; '' for the link/schedule target. */
  variantLabel?: string;
  /** Owner's campaign label, or a per-visit marker; '' when untagged. */
  campaign?: string | null;
  /**
   * First-party referrer label to use instead of one derived from the request,
   * for events the service originates itself: a QR scan or a page-button click.
   *
   * Restricted to the reserved labels in `device-category`. That restriction is
   * the whole point — without it this would be an unauthenticated way to write
   * an arbitrary referrer string onto any link's analytics.
   */
  syntheticReferrer?: string | null;
  /** Aggregation dimensions for this owner; defaults to collecting both. */
  aggregation?: AggregationSettings;
}): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    // Explicit settings win; otherwise resolve from the owner's cached settings.
    const aggregation =
      input.aggregation ??
      (input.ownerId ? (await getCachedOwnerSettings(input.ownerId)).aggregation : DEFAULT_AGGREGATION);

    /**
     * A synthetic referrer wins over the header-derived one, but only after
     * being checked against the reserved list. Falling through to the normal
     * resolution rather than throwing means an unexpected value degrades to real
     * attribution instead of dropping the click.
     */
    const synthetic = input.syntheticReferrer ?? '';
    const referrerHost =
      isReservedReferrer(synthetic) && aggregation.track_referrer
        ? synthetic
        : resolveReferrerHost(aggregation, input.referrer);
    const deviceCategory = resolveDeviceCategory(aggregation, input.userAgent);
    const variantLabel = (input.variantLabel ?? '').slice(0, 32);
    // Re-validated here rather than trusted from the caller: a campaign reaches
    // this module from a query string on one path. Anything off-pattern is
    // dropped instead of sanitised, so no visitor-controlled text is persisted.
    const campaign = CAMPAIGN_PATTERN.test(input.campaign ?? '') ? (input.campaign as string) : '';

    // Same reasoning as the campaign: this value arrives from a request header,
    // so it is filtered here rather than trusted from the caller. Anything that
    // is not two uppercase letters is dropped.
    const rawCountry = (input.countryCode ?? '').trim().toUpperCase();
    const countryCode = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : '';

    const supabase = getServiceSupabase();
    await supabase.rpc('increment_click', {
      p_link_id: input.linkId,
      p_day: day,
      p_referrer_host: referrerHost,
      p_device_category: deviceCategory,
      p_variant_label: variantLabel,
      p_campaign: campaign,
      p_country_code: countryCode
    });
  } catch {
    // Analytics failures must not break redirects or expose visitor data.
  }
}