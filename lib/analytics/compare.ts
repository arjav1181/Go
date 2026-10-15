/**
 * Period-over-period comparison.
 *
 * The goal is to report change honestly: when there is no baseline, a raw
 * percentage is mathematically undefined (+Inf%), so we say so explicitly
 * instead of printing a misleading number.
 */

export type ChangeKind = 'up' | 'down' | 'flat' | 'new_activity' | 'no_data';

export type PeriodComparison = {
  current: number;
  previous: number;
  delta: number;
  kind: ChangeKind;
  /** null whenever a percentage is not meaningful. */
  percentChange: number | null;
  /** Human-readable explanation; safe to show directly in the UI. */
  description: string;
};

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function comparePeriods(current: number, previous: number): PeriodComparison {
  const delta = current - previous;

  if (current === 0 && previous === 0) {
    return {
      current,
      previous,
      delta,
      kind: 'no_data',
      percentChange: null,
      description: 'No clicks in either period.'
    };
  }

  if (previous === 0) {
    return {
      current,
      previous,
      delta,
      kind: 'new_activity',
      percentChange: null,
      description: `New activity: ${current} clicks, from 0 in the previous period.`
    };
  }

  const percentChange = roundPercent((delta / previous) * 100);

  if (delta === 0) {
    return {
      current,
      previous,
      delta,
      kind: 'flat',
      percentChange: 0,
      description: 'No change compared with the previous period.'
    };
  }

  const direction = delta > 0 ? 'up' : 'down';
  return {
    current,
    previous,
    delta,
    kind: direction,
    percentChange,
    description: `${Math.abs(percentChange)}% ${delta > 0 ? 'more' : 'fewer'} clicks than the previous period.`
  };
}

export type DailyPoint = { day: string; clicks: number };

/**
 * Bucket aggregate rows into a dense daily series over the range.
 * Days without data are present with 0 clicks so the chart has an honest axis.
 */
export function toDailySeries(
  rows: Array<{ day: string; click_count: number | string }>,
  days: string[]
): DailyPoint[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.day, (totals.get(row.day) ?? 0) + Number(row.click_count));
  }
  return days.map((day) => ({ day, clicks: totals.get(day) ?? 0 }));
}

export function sumClicks(rows: Array<{ click_count: number | string }>): number {
  return rows.reduce((sum, row) => sum + Number(row.click_count), 0);
}

export type Breakdown = { key: string; clicks: number };

export function toBreakdown(
  rows: Array<{ referrer_host: string; device_category: string; click_count: number | string }>,
  field: 'referrer_host' | 'device_category'
): Breakdown[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = row[field];
    totals.set(key, (totals.get(key) ?? 0) + Number(row.click_count));
  }
  return [...totals.entries()]
    .map(([key, clicks]) => ({ key, clicks }))
    .sort((a, b) => b.clicks - a.clicks || a.key.localeCompare(b.key));
}