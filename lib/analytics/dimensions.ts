/**
 * One row of the click cube.
 *
 * Declared here rather than imported from the query layer so the dimension
 * engine stays a pure module with no database dependency, and so the panel and
 * the engine agree on the shape without a circular import.
 */
export type AnalyticRow = {
  day: string;
  referrer_host: string;
  device_category: string;
  variant_label: string;
  campaign: string;
  link_id: string;
  /** Slug; empty when the link could not be resolved. */
  link?: string;
  click_count: number | string;
};

/**
 * Multi-dimensional analytics.
 *
 * The click table is a small cube: every row is one (day × link × referrer ×
 * device × variant × campaign) bucket with a count. This module pivots that cube
 * so the dashboard can slice it by any single dimension, cross two dimensions
 * against each other, and rank values within one — which is the difference
 * between "here are your clicks" and an analytics product.
 *
 * Everything here is pure and synchronous. The rows have already been fetched
 * and owner-scoped; no function in this file touches the database.
 */

export const DIMENSIONS = [
  'day',
  'referrer_host',
  'device_category',
  'campaign',
  'variant_label',
  'link'
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  day: 'Date',
  referrer_host: 'Referrer',
  device_category: 'Device',
  campaign: 'Campaign',
  variant_label: 'Variant',
  link: 'Link'
};

/**
 * Values stored as an empty string mean "not applicable", not "blank answer".
 *
 * Surfacing them as the literal empty string makes every table read
 * `(untagged)` or `(direct)`, which is noise; a single consistent bucket is
 * easier to scan and easier to filter.
 */
export function normalizeDimensionValue(dimension: Dimension, raw: unknown): string {
  const value = raw === null || raw === undefined ? '' : String(raw).trim();
  if (value !== '') return value;

  switch (dimension) {
    case 'referrer_host':
      return '(direct)';
    case 'device_category':
      return '(unknown)';
    case 'campaign':
      return '(untagged)';
    case 'variant_label':
      return '(base)';
    case 'link':
      return '(unknown link)';
    default:
      return '(none)';
  }
}

export type Slice = {
  value: string;
  clicks: number;
  share: number;
};

export type CrossCell = { x: string; y: string; clicks: number };

export type CrossTab = {
  xDimension: Dimension;
  yDimension: Dimension;
  rows: Array<{ value: string; clicks: number; share: number; cells: CrossCell[] }>;
  columns: string[];
  max: number;
  total: number;
};

/** Sum clicks by one dimension. */
export function sliceBy(rows: AnalyticRow[], dimension: Dimension): Slice[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const value = normalizeDimensionValue(dimension, row[dimension]);
    totals.set(value, (totals.get(value) ?? 0) + toCount(row.click_count));
  }

  const total = [...totals.values()].reduce((sum, n) => sum + n, 0);

  return [...totals.entries()]
    .map(([value, clicks]) => ({
      value,
      clicks,
      share: total > 0 ? clicks / total : 0
    }))
    .sort((a, b) => b.clicks - a.clicks || a.value.localeCompare(b.value));
}

/**
 * Pivot two dimensions against each other.
 *
 * Rows are truncated so a pathological referrer list cannot produce a chart
 * nobody can read; the remainder is folded into an explicit "(other)" row so
 * the numbers still add up to the real total.
 */
export function crossTab(
  rows: AnalyticRow[],
  xDimension: Dimension,
  yDimension: Dimension,
  options: { maxRows?: number } = {}
): CrossTab {
  const maxRows = options.maxRows ?? 12;

  const grid = new Map<string, Map<string, number>>();
  const xTotals = new Map<string, number>();
  const yTotals = new Map<string, number>();
  let total = 0;

  for (const row of rows) {
    const x = normalizeDimensionValue(xDimension, row[xDimension]);
    const y = normalizeDimensionValue(yDimension, row[yDimension]);
    const clicks = toCount(row.click_count);

    if (!grid.has(x)) grid.set(x, new Map());
    grid.get(x)!.set(y, (grid.get(x)!.get(y) ?? 0) + clicks);
    xTotals.set(x, (xTotals.get(x) ?? 0) + clicks);
    yTotals.set(y, (yTotals.get(y) ?? 0) + clicks);
    total += clicks;
  }

  const rankedX = [...xTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);

  const kept = rankedX.slice(0, maxRows);
  const folded = rankedX.slice(maxRows);
  const OVERFLOW = '(other)';

  const columns = [...yTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([value]) => value);

  const resultRows: CrossTab['rows'] = [];

  for (const value of kept) {
    const byY = grid.get(value) ?? new Map();
    const cells = columns.map((y) => ({ x: value, y, clicks: byY.get(y) ?? 0 }));
    // Anything outside the displayed columns is folded into an explicit row so
    // the visible total still equals the real total rather than quietly
    // under-reporting.
    const rest = [...byY.entries()]
      .filter(([y]) => !columns.includes(y))
      .reduce((sum, [, count]) => sum + count, 0);

    if (rest > 0) {
      cells.push({ x: value, y: OVERFLOW, clicks: rest });
      columns.push(OVERFLOW);
    }

    resultRows.push({
      value,
      clicks: xTotals.get(value) ?? 0,
      share: total > 0 ? (xTotals.get(value) ?? 0) / total : 0,
      cells
    });
  }

  if (folded.length > 0) {
    const byY = new Map<string, number>();
    for (const name of folded) {
      for (const [y, c] of grid.get(name) ?? new Map()) {
        byY.set(y, (byY.get(y) ?? 0) + c);
      }
    }
    const cells = columns.map((y) => ({ x: OVERFLOW, y, clicks: byY.get(y) ?? 0 }));
    resultRows.push({
      value: OVERFLOW,
      clicks: folded.reduce((s, name) => s + (xTotals.get(name) ?? 0), 0),
      share: 0,
      cells
    });
  }

  const max = resultRows.reduce((m, r) => Math.max(m, r.cells.reduce((s, c) => Math.max(s, c.clicks), 0)), 0);

  return { xDimension, yDimension, rows: resultRows, columns: [...new Set(columns)], max, total };
}

function toCount(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type CumulativePoint = { day: string; clicks: number; cumulative: number };

/** Running total across the series, for the "cumulative" view. */
export function toCumulative(series: Array<{ day: string; clicks: number }>): CumulativePoint[] {
  let running = 0;
  return series.map((point) => {
    running += point.clicks;
    return { day: point.day, clicks: point.clicks, cumulative: running };
  });
}

export type Stat = {
  total: number;
  best: { day: string; clicks: number } | null;
  average: number;
  peak: number;
  activeDays: number;
};

/** Headline numbers. `average` is per *day in range*, including zero days. */
export function summarise(series: Array<{ day: string; clicks: number }>): Stat {
  const total = series.reduce((sum, p) => sum + p.clicks, 0);
  const peak = series.reduce((m, p) => Math.max(m, p.clicks), 0);
  const best = series.reduce<{ day: string; clicks: number } | null>((bestSoFar, p) => {
    if (!bestSoFar || p.clicks > bestSoFar.clicks) return { day: p.day, clicks: p.clicks };
    return bestSoFar;
  }, null);

  return {
    total,
    best: best && best.clicks > 0 ? best : null,
    average: series.length > 0 ? total / series.length : 0,
    peak,
    activeDays: series.filter((p) => p.clicks > 0).length
  };
}

/**
 * Percentage change, with the zero case handled honestly.
 *
 * Going from 0 to something is reported as null rather than 100%: there is no
 * meaningful growth rate from a zero baseline, and rendering "∞" or "+100%"
 * would overstate what is known.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}