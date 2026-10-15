/**
 * Analytics date ranges.
 *
 * Click rows are bucketed by UTC day (date column). Ranges are therefore built
 * in UTC so "last 30 days" always means the same set of days regardless of the
 * server's local timezone.
 */

export const RANGE_PRESETS = ['7d', '30d', '90d', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export type DateRange = { start: string; end: string };

export const MS_PER_DAY = 86_400_000;

export function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidRange(start: string, end: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  const s = Date.parse(`${start}T00:00:00.000Z`);
  const e = Date.parse(`${end}T23:59:59.999Z`);
  return Number.isFinite(s) && Number.isFinite(e) && s <= e;
}

/**
 * Resolve a preset or a custom range into concrete UTC days.
 * `endDay` is inclusive. Defaults to today (UTC).
 */
export function resolveRange(
  preset: string | undefined,
  customStart: string | undefined,
  customEnd: string | undefined,
  now: Date = new Date()
): DateRange {
  if (preset === 'custom' && customStart && customEnd && isValidRange(customStart, customEnd)) {
    return { start: customStart, end: customEnd };
  }
  const fallback = preset === '7d' || preset === '30d' || preset === '90d' ? preset : '30d';
  const days = Number.parseInt(fallback, 10);
  const endMs = Date.parse(`${toUtcDay(now)}T23:59:59.999Z`);
  const startMs = Date.parse(`${toUtcDay(now)}T00:00:00.000Z`) - (days - 1) * MS_PER_DAY;
  return { start: toUtcDay(new Date(startMs)), end: toUtcDay(new Date(endMs)) };
}

export function rangeLengthDays(range: DateRange): number {
  const start = Date.parse(`${range.start}T00:00:00.000Z`);
  const end = Date.parse(`${range.end}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / MS_PER_DAY) + 1;
}

/** The immediately preceding window of equal length, used for comparison. */
export function previousPeriod(range: DateRange): DateRange {
  const length = rangeLengthDays(range);
  if (length === 0) return { start: range.start, end: range.end };
  const endMs = Date.parse(`${range.start}T00:00:00.000Z`) - 1;
  const startMs = Date.parse(`${range.start}T00:00:00.000Z`) - length * MS_PER_DAY;
  return { start: toUtcDay(new Date(startMs)), end: toUtcDay(new Date(endMs)) };
}

export function eachDay(range: DateRange): string[] {
  const days = rangeLengthDays(range);
  if (days === 0) return [];
  const startMs = Date.parse(`${range.start}T00:00:00.000Z`);
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) out.push(toUtcDay(new Date(startMs + i * MS_PER_DAY)));
  return out;
}

export function isWithinRange(day: string, range: DateRange): boolean {
  return day >= range.start && day <= range.end;
}

export const RANGE_LABEL: Record<RangePreset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  custom: 'Custom'
};