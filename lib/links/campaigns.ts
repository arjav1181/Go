import { z } from 'zod';

/**
 * Campaign markers.
 *
 * A short label attached to a link so clicks can be grouped by campaign
 * without inventing a visitor identity. Deliberately UTM-like in shape but much
 * smaller: the point is to label *your own* links, not to carry third-party
 * tracking parameters around.
 *
 * Anything a visitor could inject into a query string is never persisted.
 */

export const CAMPAIGN_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** Query parameter that selects a campaign on a shared link. */
export const CAMPAIGN_PARAM = 'c';

const campaignSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(CAMPAIGN_PATTERN, 'Use 1–32 characters: lowercase letters, numbers, hyphen or underscore.');

/**
 * Normalise and validate a campaign name.
 *
 * Returns null for an empty value: clearing a campaign is a legitimate action,
 * not an error.
 */
export function normalizeCampaign(
  raw: string | null | undefined
): { ok: true; campaign: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, campaign: null };
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, campaign: null };

  const parsed = campaignSchema.safeParse(trimmed);
  if (!parsed.success) return { ok: false, error: 'Campaign must be 1–32 characters: a–z, 0–9, - or _.' };
  return { ok: true, campaign: parsed.data };
}

/**
 * Read a campaign marker off an incoming request URL.
 *
 * Deliberately conservative: if the value does not match the pattern exactly it
 * is discarded rather than sanitised. There is no legitimate campaign name that
 * needs trimming, so anything odd is either a mistake or an injection attempt,
 * and dropping it is both safe and predictable.
 */
export function campaignFromUrl(url: string): string | null {
  let raw: string | null = null;
  try {
    raw = new URL(url).searchParams.get(CAMPAIGN_PARAM);
  } catch {
    return null;
  }
  if (raw === null) return null;
  return CAMPAIGN_PATTERN.test(raw) ? raw : null;
}

/**
 * Append a campaign marker to a destination URL.
 *
 * Used when the owner sets a campaign on the link itself: the marker is added
 * to the outbound destination so the destination's own analytics can attribute
 * the click, without go. seeing or storing anything extra.
 */
export function withCampaignParam(destination: string, campaign: string): string {
  const normalized = normalizeCampaign(campaign);
  if (!normalized.ok || normalized.campaign === null) return destination;

  try {
    const url = new URL(destination);
    url.searchParams.set(CAMPAIGN_PARAM, normalized.campaign);
    return url.toString();
  } catch {
    return destination;
  }
}

/** Aggregate clicks by campaign for the dashboard. */
export type CampaignRollup = {
  campaign: string;
  clicks: number;
  share: number;
};

export function rollupCampaigns(
  rows: Array<{ campaign: string; clicks: number }>
): CampaignRollup[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = row.campaign && row.campaign.trim() !== '' ? row.campaign : 'untagged';
    totals.set(key, (totals.get(key) ?? 0) + row.clicks);
  }

  const grand = [...totals.values()].reduce((sum, n) => sum + n, 0);
  const rollups = [...totals.entries()]
    .map(([campaign, clicks]) => ({
      campaign,
      clicks,
      // Guard against divide-by-zero when every click count is zero.
      share: grand > 0 ? clicks / grand : 0
    }))
    .sort((a, b) => b.clicks - a.clicks || a.campaign.localeCompare(b.campaign));

  return rollups;
}