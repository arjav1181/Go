import Link from 'next/link';
import type { DateRange, RangePreset } from '@/lib/analytics/range';
import { RANGE_PRESETS, RANGE_LABEL } from '@/lib/analytics/range';
import type { PeriodComparison } from '@/lib/analytics/compare';

export type AnalyticsSeries = {
  preset: RangePreset;
  series: Array<{ day: string; clicks: number }>;
  comparison: PeriodComparison;
  referrers: Array<{ key: string; clicks: number }>;
  devices: Array<{ key: string; clicks: number }>;
  hasAnyDataInRange: boolean;
  range: DateRange;
};

function comparisonTone(kind: PeriodComparison['kind']): string {
  switch (kind) {
    case 'up':
      return 'text-green-700 dark:text-green-400';
    case 'down':
      return 'text-red-700 dark:text-red-400';
    default:
      return 'text-[var(--muted)]';
  }
}

function buildHref(
  base: string,
  preset: RangePreset,
  range: DateRange,
  linkId?: string
): string {
  const params = new URLSearchParams();
  params.set('range', preset);
  if (preset === 'custom') {
    params.set('start', range.start);
    params.set('end', range.end);
  }
  if (linkId) params.set('link', linkId);
  return `${base}?${params.toString()}`;
}

export function AnalyticsPanel({
  data,
  basePath,
  linkId
}: {
  data: AnalyticsSeries;
  basePath: string;
  linkId?: string;
}) {
  const { series, comparison, referrers, devices, range, hasAnyDataInRange } = data;
  const max = Math.max(1, ...series.map((point) => point.clicks));
  const currentTotal = comparison.current;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--muted)]">Range:</span>
        {RANGE_PRESETS.map((preset) => (
          <Link
            key={preset}
            href={buildHref(basePath, preset, range, linkId)}
            aria-current={isActive(preset, data) ? 'page' : undefined}
            className={
              isActive(preset, data)
                ? 'rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white'
                : 'rounded-md border border-[var(--border)] px-3 py-1 text-xs'
            }
          >
            {RANGE_LABEL[preset]}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted)]">
            Clicks · {range.start} to {range.end} (UTC)
          </p>
          <p className="mt-1 text-2xl font-semibold">{currentTotal}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted)]">Compared with previous period</p>
          <p className={`mt-1 text-sm font-medium ${comparisonTone(comparison.kind)}`}>
            {comparison.description}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Previous: {comparison.previous} clicks
            {comparison.percentChange === null ? '' : ` · ${comparison.percentChange}%`}
          </p>
        </div>
      </div>

      {!hasAnyDataInRange ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted)]">
          No clicks were recorded in this range. Counts are clicks, not unique visitors.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Clicks by day (UTC)</h3>
            <div className="overflow-x-auto">
              <svg
                viewBox={`0 0 ${Math.max(series.length, 1) * 14} 80`}
                className="h-32 min-w-full"
                role="img"
                aria-label={`Daily clicks from ${range.start} to ${range.end}`}
              >
                {series.map((point, index) => {
                  const height = (point.clicks / max) * 60;
                  const x = index * 14 + 2;
                  return (
                    <g key={point.day}>
                      <rect
                        x={x}
                        y={70 - height}
                        width={10}
                        height={height}
                        fill="var(--accent)"
                        rx={2}
                      >
                        <title>{`${point.day}: ${point.clicks} clicks`}</title>
                      </rect>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Breakdown title="Referrer hosts" rows={referrers} mono />
            <Breakdown title="Device category" rows={devices} />
          </div>
        </>
      )}
    </div>
  );
}

function isActive(preset: RangePreset, data: AnalyticsSeries): boolean {
  return data.preset === preset;
}

function Breakdown({
  title,
  rows,
  mono = false
}: {
  title: string;
  rows: Array<{ key: string; clicks: number }>;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No data in this range.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2">
              <span className={`truncate ${mono ? 'font-mono text-xs' : ''}`}>{row.key}</span>
              <span className="text-[var(--muted)]">{row.clicks}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}