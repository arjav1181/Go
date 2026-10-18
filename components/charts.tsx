'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

/**
 * Charts, built on Recharts.
 *
 * Recharts reads colours from the CSS custom properties rather than hex
 * literals, so charts follow the Geist light/dark tokens automatically instead
 * of needing a second palette. Everything is responsive; the tooltip is a
 * custom renderer so it matches the type scale rather than the library default.
 */

const BLUE = 'var(--ds-blue-600)';
const GRID = 'rgba(128,128,128,0.28)';
const MUTED = 'var(--ds-gray-600)';
const FOREGROUND = 'var(--ds-gray-1000)';
const BACKGROUND = 'var(--ds-background-100)';
const SURFACE = 'var(--ds-background-200)';

export type SeriesPoint = { day: string; clicks: number };

type ChartDatum = SeriesPoint & { previous?: number };

function niceTick(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(value));
}

/** Recharts requires a non-zero height; this keeps it consistent everywhere. */
const CHART_HEIGHT = 260;

function ChartTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; dataKey?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const current = payload.find((p) => p.dataKey === 'clicks')?.value ?? 0;
  const previous = payload.find((p) => p.dataKey === 'previous')?.value;

  return (
    <div className="rounded-lg border border-[var(--ds-gray-400)] px-3 py-2 text-label-12 shadow-lg"
         style={{ background: BACKGROUND }}>
      <p className="text-[color:var(--ds-gray-600)]">{label}</p>
      <p className="mt-0.5 font-medium text-[color:var(--ds-gray-1000)]">
        {Number(current).toLocaleString()} click{Number(current) === 1 ? '' : 's'}
      </p>
      {typeof previous === 'number' && previous > 0 ? (
        <p className="mt-0.5 text-[color:var(--ds-gray-600)]">
          previous: {Number(previous).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Time-series area chart with an optional comparison period.
 *
 * The previous period is drawn as a dashed line rather than a second filled
 * area: two overlapping fills make "before vs after" much harder to read than
 * a solid current line over a dashed baseline.
 */
export function TimeSeriesChart({
  current,
  previous,
  height = CHART_HEIGHT
}: {
  current: SeriesPoint[];
  previous?: SeriesPoint[];
  height?: number;
}) {
  const [showComparison, setShowComparison] = useState(true);

  const data: ChartDatum[] = current.map((point, i) => ({
    day: point.day,
    clicks: point.clicks,
    previous: previous?.[i]?.clicks
  }));

  const hasData = current.some((p) => p.clicks > 0);
  const hasPrevious = Boolean(previous?.some((p) => p.clicks > 0));

  return (
    <div className="relative">
      {hasPrevious ? (
        <label className="absolute right-0 top-0 z-10 flex cursor-pointer items-center gap-1.5 text-label-12 text-[color:var(--ds-gray-900)]">
          <input className="checkbox h-3.5 w-3.5 rounded border-[var(--ds-gray-400)]" type="checkbox"
            checked={showComparison}
            onChange={(e) => setShowComparison(e.target.checked)}
             />
          Compare to previous
        </label>
      ) : null}

      {!hasData ? (
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-[var(--ds-gray-400)] text-label-13 text-[color:var(--ds-gray-600)]"
          style={{ height }}
        >
          No clicks recorded in this range yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 28, right: 8, bottom: 4, left: -12 }}>
            <defs>
              <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={BLUE} stopOpacity={0.24} />
                <stop offset="100%" stopColor={BLUE} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: MUTED }}
              tickFormatter={(v: string) => v.slice(5)}
              minTickGap={28}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: MUTED }}
              tickFormatter={niceTick}
              width={48}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: 'var(--ds-gray-500)', strokeWidth: 1 }}
            />
            {showComparison && hasPrevious ? (
              <Area
                type="monotone"
                dataKey="previous"
                stroke="var(--ds-gray-500)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                fill="none"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="clicks"
              stroke={BLUE}
              strokeWidth={2}
              fill="url(#clicksFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: BACKGROUND }}
              animationDuration={320}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Horizontal bar list.
 *
 * Not a chart component: a breakdown of a handful of categorical values is
 * more scannable as text-plus-bar than as an axis, and it stays readable when
 * the values are long strings like referrer hostnames.
 */
export function BarList({
  items,
  onSelect,
  activeValue
}: {
  items: Array<{ value: string; clicks: number; share: number }>;
  onSelect?: (value: string | null) => void;
  activeValue?: string | null;
}) {
  if (items.length === 0) {
    return <p className="text-label-13 text-[color:var(--ds-gray-600)]">Nothing recorded in this range.</p>;
  }

  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const isActive = activeValue === item.value;
        return (
          <li key={item.value}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(isActive ? null : item.value)}
              aria-pressed={onSelect ? isActive : undefined}
              className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors ${
                onSelect ? 'hover:bg-[color:var(--ds-background-200)]' : 'cursor-default'
              } ${isActive ? 'bg-[color:var(--ds-background-200)]' : ''}`}
            >
              <span className="min-w-0 flex-1 truncate text-label-13 text-[color:var(--ds-gray-1000)]" title={item.value}>
                {item.value}
              </span>
              <span className="relative hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[color:var(--ds-gray-200)] sm:block">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    background: BLUE,
                    width: `${(item.share * 100).toFixed(1)}%`
                  }}
                />
              </span>
              <span className="w-12 shrink-0 text-right text-label-13 tabular-nums text-[color:var(--ds-gray-900)]">
                {item.clicks.toLocaleString()}
              </span>
              <span className="w-11 shrink-0 text-right text-label-12 tabular-nums text-[color:var(--ds-gray-600)]">
                {(item.share * 100).toFixed(item.share < 0.1 ? 1 : 0)}%
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

/** Compact trend line for table rows. */
export function Sparkline({
  values,
  width = 96,
  height = 24
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span className="text-[color:var(--ds-gray-600)]">—</span>;

  const data = values.map((clicks, i) => ({ i, clicks }));

  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Area
          type="monotone"
          dataKey="clicks"
          stroke={BLUE}
          strokeWidth={1.5}
          fill={BLUE}
          fillOpacity={0.12}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Cross-tab heatmap, rendered as a vertical bar chart.
 *
 * Bar length already encodes magnitude, so a colour ramp on top of it would be
 * decoration rather than information — the legend would cost more attention
 * than it returns.
 */
export function CrossTabChart({
  rows,
  max,
  total,
  emptyLabel = 'Nothing recorded in this range.'
}: {
  rows: Array<{ value: string; clicks: number; share: number }>;
  max?: number;
  total: number;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="text-label-13 text-[color:var(--ds-gray-600)]">{emptyLabel}</p>;
  }

  const peak = max ?? rows.reduce((m, r) => Math.max(m, r.clicks), 0);

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 30 + 24)}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 56, bottom: 4, left: 4 }}
          onMouseLeave={() => setHover(null)}
        >
          <CartesianGrid stroke={GRID} strokeDasharray="3 4" horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="value"
            width={132}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: MUTED }}
          />
          <Tooltip
            cursor={{ fill: SURFACE }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as { value: string; clicks: number; share: number };
              return (
                <div
                  className="rounded-lg border border-[var(--ds-gray-400)] px-3 py-2 text-label-12"
                  style={{ background: BACKGROUND }}
                >
                  <p className="max-w-[220px] truncate text-[color:var(--ds-gray-1000)]">{row.value}</p>
                  <p className="mt-0.5 tabular-nums text-[color:var(--ds-gray-600)]">
                    {row.clicks.toLocaleString()} clicks · {(row.share * 100).toFixed(1)}%
                  </p>
                </div>
              );
            }}
          />
          <Bar
            dataKey="clicks"
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            onMouseEnter={(_: unknown, payload: unknown) => {
              const row = Array.isArray(payload) ? payload[0] : payload;
              if (row && typeof row === 'object' && 'value' in row) {
                setHover(String((row as { value: string }).value));
              }
            }}
            label={{
              position: 'right',
              fontSize: 11,
              fill: FOREGROUND,
              formatter: (v: unknown) => Number(v).toLocaleString()
            }}
          >
            {rows.map((row) => (
              <Cell
                key={row.value}
                fill={BLUE}
                fillOpacity={hover === null || hover === row.value ? 0.9 : 0.35}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-label-12 text-[color:var(--ds-gray-600)]">
        {total.toLocaleString()} clicks across {rows.length} row{rows.length === 1 ? '' : 's'}
        {peak > 0 ? ` · busiest ${peak.toLocaleString()}` : ''}
      </p>
    </div>
  );
}