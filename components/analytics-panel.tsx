'use client';

import { useMemo, useState } from 'react';

import { TimeSeriesChart, BarList, CrossTabChart, Sparkline } from '@/components/charts';
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  sliceBy,
  crossTab,
  toCumulative,
  summarise,
  percentChange,
  type Dimension,
  type AnalyticRow
} from '@/lib/analytics/dimensions';

export type AnalyticsSeries = {
  preset: string;
  range: { start: string; end: string };
  series: Array<{ day: string; clicks: number }>;
  previousSeries: Array<{ day: string; clicks: number }>;
  /** The raw cube, already owner-scoped and bounded to the range. */
  rows: AnalyticRow[];
  comparison: { current: number; previous: number; delta: number };
  hasAnyDataInRange: boolean;
};

const RANGE_PRESETS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'custom', label: 'Custom' }
];

function formatDelta(value: number | null): { text: string; tone: string } {
  if (value === null) return { text: 'new', tone: 'text-[color:var(--ds-gray-600)]' };
  if (value === 0) return { text: 'no change', tone: 'text-[color:var(--ds-gray-600)]' };
  const up = value > 0;
  return {
    text: `${up ? '+' : ''}${(value * 100).toFixed(up ? 0 : 1)}%`,
    tone: up ? 'text-[color:var(--ds-green-600)]' : 'text-[color:var(--ds-red-600)]'
  };
}

/**
 * The analytics surface.
 *
 * Three views over the same cube — a time series, a per-dimension breakdown and
 * a ranked leaderboard — with every categorical breakdown cross-filterable. The
 * cube itself is five dimensions of (day × link × referrer × device × variant ×
 * campaign), so "which campaigns convert on mobile from direct traffic" is one
 * filter rather than a SQL query.
 */
export function AnalyticsPanel({
  data,
  basePath
}: {
  data: AnalyticsSeries;
  basePath: string;
}) {
  // The range is a link, not local state: it must survive a refresh and be
  // shareable, so `data.preset` (from the URL) is the single source of truth.
  const range = data.preset;
  const [view, setView] = useState<'daily' | 'cumulative'>('daily');
  const [xDimension, setXDimension] = useState<Dimension>('referrer_host');
  const [yDimension, setYDimension] = useState<Dimension>('device_category');
  const [filter, setFilter] = useState<Record<string, string>>({});

  const rows = data.rows;

  const filtered = useMemo(() => {
    if (Object.keys(filter).length === 0) return rows;
    return rows.filter((row) =>
      Object.entries(filter).every(([dimension, value]) =>
        row[dimension as keyof AnalyticRow] === value
      )
    );
  }, [rows, filter]);

  const stat = useMemo(() => summarise(data.series), [data.series]);
  const cumulative = useMemo(() => toCumulative(data.series), [data.series]);

  const chartData = view === 'cumulative' ? cumulative : data.series;

  const breakdown = useMemo(() => sliceBy(filtered, xDimension), [filtered, xDimension]);
  const cross = useMemo(
    () => crossTab(filtered, xDimension, yDimension).rows,
    [filtered, xDimension, yDimension]
  );

  const perLink = useMemo(() => sliceBy(filtered, 'link').slice(0, 10), [filtered]);

  const activeFilters = Object.entries(filter);

  function toggleFilter(value: string | null) {
    if (value === null) return;
    setFilter((prev) => {
      const current = prev[xDimension];
      const next = { ...prev };
      if (current === value) delete next[xDimension];
      else next[xDimension] = value;
      return next;
    });
  }

  function clearFilters() {
    setFilter({});
  }

  const delta = percentChange(data.comparison.current, data.comparison.previous);
  const deltaTone = formatDelta(delta);

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-[var(--ds-gray-400)] p-0.5" role="group" aria-label="Date range">
          {RANGE_PRESETS.map((preset) => (
            <a
              key={preset.value}
              href={`${basePath}?range=${preset.value}`}
              aria-current={range === preset.value ? 'true' : undefined}
              className={`rounded px-2.5 py-1 text-label-13 transition-colors ${
                range === preset.value
                  ? 'bg-[color:var(--ds-gray-100)] text-[color:var(--ds-gray-1000)]'
                  : 'text-[color:var(--ds-gray-900)] hover:text-[color:var(--ds-gray-1000)]'
              }`}
            >
              {preset.label}
            </a>
          ))}
        </div>

        <div className="ml-auto flex rounded-md border border-[var(--ds-gray-400)] p-0.5" role="group" aria-label="Chart mode">
          {(['daily', 'cumulative'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              aria-pressed={view === mode}
              className={`rounded px-2.5 py-1 text-label-13 capitalize transition-colors ${
                view === mode
                  ? 'bg-[color:var(--ds-gray-100)] text-[color:var(--ds-gray-1000)]'
                  : 'text-[color:var(--ds-gray-900)] hover:text-[color:var(--ds-gray-1000)]'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Active filters */}
      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-label-12">
          <span className="text-[color:var(--ds-gray-600)]">Filtered by</span>
          {activeFilters.map(([dimension, value]) => (
            <button
              key={dimension}
              type="button"
              onClick={() => toggleFilter(value)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ds-gray-400)] px-2 py-1 hover:bg-[color:var(--ds-background-200)]"
            >
              <span className="text-[color:var(--ds-gray-600)]">{DIMENSION_LABELS[dimension as Dimension]}</span>
              <span className="text-[color:var(--ds-gray-1000)]">{value}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
          <button type="button" onClick={clearFilters} className="text-[color:var(--ds-gray-600)] underline underline-offset-2">
            Clear all
          </button>
        </div>
      ) : null}

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clicks" value={data.comparison.current.toLocaleString()} delta={deltaTone.text} deltaTone={deltaTone.tone} />
        <StatCard label="Daily average" value={stat.average.toFixed(1)} sub={`peak ${stat.peak}`} />
        <StatCard
          label="Best day"
          value={stat.best ? stat.best.clicks.toLocaleString() : '—'}
          sub={stat.best?.day ?? 'no clicks yet'}
        />
        <StatCard label="Active days" value={`${stat.activeDays}`} sub={`of ${data.series.length} in range`} />
      </div>

      {/* Chart */}
      <div className="card p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <h3 className="text-heading-16 text-[color:var(--ds-gray-1000)]">
            {view === 'cumulative' ? 'Cumulative clicks' : 'Clicks per day'}
          </h3>
          <span className="text-label-12 text-[color:var(--ds-gray-600)]">
            {data.range.start} → {data.range.end}
          </span>
        </div>
        <TimeSeriesChart current={chartData} previous={data.previousSeries} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Dimension breakdown */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-heading-16 text-[color:var(--ds-gray-1000)]">Breakdown</h3>
            <select
              value={xDimension}
              onChange={(e) => setXDimension(e.target.value as Dimension)}
              aria-label="Breakdown dimension"
              className="rounded-md border border-[var(--ds-gray-400)] bg-transparent px-2 py-1 text-label-13"
            >
              {DIMENSIONS.map((dimension) => (
                <option key={dimension} value={dimension}>
                  by {DIMENSION_LABELS[dimension].toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <BarList items={breakdown} onSelect={toggleFilter} activeValue={filter[xDimension] ?? null} />
        </div>

        {/* Cross-tab */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-heading-16 text-[color:var(--ds-gray-1000)]">
              {DIMENSION_LABELS[yDimension]} by {DIMENSION_LABELS[xDimension].toLowerCase()}
            </h3>
            <select
              value={yDimension}
              onChange={(e) => setYDimension(e.target.value as Dimension)}
              aria-label="Comparison dimension"
              className="rounded-md border border-[var(--ds-gray-400)] bg-transparent px-2 py-1 text-label-13"
            >
              {DIMENSIONS.filter((d) => d !== xDimension).map((dimension) => (
                <option key={dimension} value={dimension}>
                  {DIMENSION_LABELS[dimension]}
                </option>
              ))}
            </select>
          </div>
          <CrossTabChart rows={cross} total={filtered.reduce((s, r) => s + Number(r.click_count ?? 0), 0)} />
        </div>
      </div>

      {/* Per-link leaderboard */}
      <div className="card p-4">
        <h3 className="mb-3 text-heading-16 text-[color:var(--ds-gray-1000)]">Top links</h3>
        {perLink.length === 0 ? (
          <p className="text-label-13 text-[color:var(--ds-gray-600)]">No clicks in this range.</p>
        ) : (
          <table className="w-full text-label-13">
            <thead>
              <tr className="text-left text-[color:var(--ds-gray-600)]">
                <th scope="col" className="pb-2 font-medium">Link</th>
                <th scope="col" className="pb-2 text-right font-medium">Clicks</th>
                <th scope="col" className="pb-2 text-right font-medium">Share</th>
                <th scope="col" className="pb-2 text-right font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {perLink.map((row) => (
                <tr key={row.value} className="border-t border-[var(--ds-gray-400)]">
                  <td className="truncate py-2 pr-3 font-mono text-[color:var(--ds-gray-1000)]">{row.value}</td>
                  <td className="py-2 text-right tabular-nums">{row.clicks.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums text-[color:var(--ds-gray-900)]">
                    {(row.share * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 text-right">
                    <Sparkline values={trendFor(rows, row.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-label-12 text-[color:var(--ds-gray-600)]">
        Counts are clicks, not unique visitors. Days are aggregated in UTC. Select a value in the
        breakdown to filter everything below it.
      </p>
    </div>
  );
}

/** Small inline series for one link, used by the sparkline column. */
function trendFor(rows: AnalyticRow[], link: string): number[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (row.link !== link) continue;
    const day = String(row.day);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(row.click_count ?? 0));
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

function StatCard({
  label,
  value,
  sub,
  delta,
  deltaTone
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  deltaTone?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-label-12 text-[color:var(--ds-gray-600)]">{label}</p>
      <p className="mt-1 text-heading-24 tabular-nums text-[color:var(--ds-gray-1000)]">{value}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-label-12">
        {delta ? <span className={deltaTone}>{delta}</span> : null}
        {sub ? <span className="text-[color:var(--ds-gray-600)]">{sub}</span> : null}
      </p>
    </div>
  );
}