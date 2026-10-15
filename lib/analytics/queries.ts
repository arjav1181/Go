import { getServiceSupabase } from '@/lib/db/supabase-server';
import {
  resolveRange,
  previousPeriod,
  eachDay,
  isWithinRange,
  type RangePreset
} from '@/lib/analytics/range';
import {
  comparePeriods,
  toDailySeries,
  toBreakdown,
  sumClicks
} from '@/lib/analytics/compare';
import type { AnalyticsSeries } from '@/components/analytics-panel';

export type RawStatRow = {
  day: string;
  referrer_host: string;
  device_category: string;
  click_count: number | string;
};

function normalizePreset(value: string | undefined): RangePreset {
  return value === '7d' || value === '30d' || value === '90d' || value === 'custom'
    ? value
    : '30d';
}

/**
 * Build the analytics payload for a set of links.
 *
 * When `linkIds` is empty the totals intentionally show zero rather than
 * querying every link, so the dashboard stays scoped to the visible set.
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

  if (params.linkIds.length === 0) {
    return {
      preset,
      range,
      series: toDailySeries([], eachDay(range)),
      comparison: comparePeriods(0, 0),
      referrers: [],
      devices: [],
      hasAnyDataInRange: false
    };
  }

  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('daily_click_stats')
    .select('day, referrer_host, device_category, click_count')
    .in('link_id', params.linkIds)
    .gte('day', previous.start)
    .lte('day', range.end);

  const rows = (data ?? []) as RawStatRow[];
  const inRange = rows.filter((row) => isWithinRange(row.day, range));
  const inPrevious = rows.filter((row) => isWithinRange(row.day, previous));

  return {
    preset,
    range,
    series: toDailySeries(inRange, eachDay(range)),
    comparison: comparePeriods(sumClicks(inRange), sumClicks(inPrevious)),
    referrers: toBreakdown(inRange, 'referrer_host'),
    devices: toBreakdown(inRange, 'device_category'),
    hasAnyDataInRange: sumClicks(inRange) > 0
  };
}