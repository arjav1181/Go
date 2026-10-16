/**
 * Date-window parsing for the analytics report endpoints.
 *
 * Split out from the handlers because it is pure and therefore testable:
 * `analytics-reports.ts` imports the Supabase server client, which uses the
 * `@/` path alias that Node's runtime resolver cannot resolve, so anything
 * under test has to be free of it. This module has no imports at all.
 */

/** Retained history ceiling. Two years, matching the documented plan windows. */
export const MAX_WINDOW_DAYS = 730;

/**
 * Documented time units.
 *
 * `minute` and `hour` are sub-day buckets; the rest are multiples of a day.
 * Anything unrecognised falls back to a day rather than erroring, so a client
 * with a typo still gets a sensible answer instead of a 400.
 */
export const UNIT_TO_DAYS: Record<string, number> = {
  minute: 1 / 1440,
  hour: 0.25,
  day: 1,
  week: 7,
  month: 30
};

export interface ReportWindow {
  from: string;
  to: string;
  units: number;
}


export function resolveWindow(params: URLSearchParams, now = Date.now()): ReportWindow {
  const unit = params.get('unit') ?? 'day';
  const rawUnits = params.get('units');

  // -1 means "everything we have", which is bounded by the retention ceiling
  // rather than unbounded — an unbounded range over an indexed table is an easy
  // way to make an API call expensive.
  const MAX_DAYS = MAX_WINDOW_DAYS;

  let units = rawUnits === null ? 30 : Number(rawUnits);
  if (!Number.isFinite(units)) units = 30;
  const perUnit = UNIT_TO_DAYS[unit] ?? 1;

  const days =
    units === -1
      ? MAX_DAYS
      : Math.min(MAX_DAYS, Math.max(1, Math.ceil(units * perUnit)));

  const to = new Date(now);
  const from = new Date(now - days * 86_400_000);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    units
  };
}

