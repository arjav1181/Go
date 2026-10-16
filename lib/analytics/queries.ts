import { getServiceSupabase } from '@/lib/db/supabase-server';
import {
  resolveRange,
  previousPeriod,
  eachDay,
  isWithinRange,
  type RangePreset
} from '@/lib/analytics/range';
import { comparePeriods, toDailySeries, sumClicks } from '@/lib/analytics/compare';
import type { AnalyticsSeries } from '@/components/analytics-panel';

export type RawStatRow = {
  day: string;
  referrer_host: string;
  device_category: string;
  variant_label: string;
  campaign: string;
  /** Populated by the slug join below; empty when the link is unknown. */
  link_id: string;
  /** Populated by attachSlugs below; the slug, or '' when unknown. */
  link?: string;
  click_count: number | string;
};

const STAT_COLUMNS =
  'link_id, day, referrer_host, device_category, variant_label, campaign, click_count';

function normalizePreset(value: string | undefined): RangePreset {
  return value === '7d' || value === '30d' || value === '90d' || value === 'custom'
    ? value
    : '30d';
}

/**
 * Build the analytics payload for a set of links.
 *
 * Returns the raw cube as well as the pre-aggregated series, because the panel
 * pivots it by dimension client-side. The rows are already owner-scoped and
 * bounded to the range, so no query runs per filter interaction.
 */
export async function buildAnalytics(params: {
  linkIds: string[];
  preset?: string;
  start?: string;
  end?: string;
  now?: Date;
}): Promise<AnalyticsSeries> {
  const preset = normalizePreset(params.preset);
  const now = params.now ?? new Date();
  const range = resolveRange(preset, params.start, params.end, now);
  const previous = previousPeriod(range);

  const empty: AnalyticsSeries = {
    preset,
    range,
    series: toDailySeries([], eachDay(range)),
    previousSeries: toDailySeries([], eachDay(previous)),
    rows: [],
    comparison: comparePeriods(0, 0),
    hasAnyDataInRange: false
  };

  if (params.linkIds.length === 0) return empty;

  const supabase = getServiceSupabase();

  // One query covers both the current and the comparison window, so a
  // before/after chart costs one round trip rather than two.
  const { data } = await supabase
    .from('daily_click_stats')
    .select(STAT_COLUMNS)
    .in('link_id', params.linkIds)
    .gte('day', previous.start)
    .lte('day', range.end);

  const rows = (data ?? []) as RawStatRow[];

  // The cube is keyed by link id internally; swap in the slug so the UI can
  // group by a human-readable value without another query.
  const withLink = await attachSlugs(rows, params.linkIds);

  const inRange = withLink.filter((row) => isWithinRange(row.day, range));
  const inPrevious = withLink.filter((row) => isWithinRange(row.day, previous));

  return {
    preset,
    range,
    series: toDailySeries(inRange, eachDay(range)),
    previousSeries: toDailySeries(inPrevious, eachDay(previous)),
    rows: inRange,
    comparison: comparePeriods(sumClicks(inRange), sumClicks(inPrevious)),
    hasAnyDataInRange: sumClicks(inRange) > 0
  };
}

/**
 * Replace link ids with slugs so the UI can group by a value a person can read.
 *
 * The slug map is fetched once for the visible link set and joined in memory.
 * Wrapped in try/catch because the fallback — grouping by an empty label — is
 * far better than failing the whole dashboard over a missing column.
 */
async function attachSlugs(rows: RawStatRow[], linkIds: string[]): Promise<RawStatRow[]> {
  if (rows.length === 0) return rows;

  try {
    const { data: links } = await getServiceSupabase()
      .from('links')
      .select('id, slug')
      .in('id', linkIds);

    const slugById = new Map(
      (links ?? []).map((l) => [
        (l as { id: string }).id,
        (l as { slug: string }).slug
      ])
    );

    return rows.map((row) => ({ ...row, link: slugById.get(row.link_id) ?? '' }));
  } catch {
    return rows.map((row) => ({ ...row, link: '' }));
  }
}
