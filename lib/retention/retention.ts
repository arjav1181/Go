/**
 * Retention policy maths.
 *
 * Pure functions so the cut-off behaviour is verifiable without a database or
 * a clock. Retention is opt-in: with `enabled` false the purge is a no-op.
 */

export const DEFAULT_RETENTION_DAYS = 365;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

export type RetentionSettings = {
  enabled: boolean;
  days: number;
};

export const DISABLED_RETENTION: RetentionSettings = {
  enabled: false,
  days: DEFAULT_RETENTION_DAYS
};

export function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidRetentionDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_RETENTION_DAYS &&
    value <= MAX_RETENTION_DAYS
  );
}

/**
 * The first UTC day that is PURGED (everything strictly before it is kept).
 *
 * A 30-day policy on 2026-07-15 keeps 2026-06-16..2026-07-15 inclusive — exactly
 * 30 days — so the cut-off is `today - (days - 1)`.
 */
export function computeCutoffDay(settings: RetentionSettings, now: Date = new Date()): string {
  const nowMs = Date.parse(`${toUtcDay(now)}T00:00:00.000Z`);
  const cutoffMs = nowMs - (settings.days - 1) * 86_400_000;
  return toUtcDay(new Date(cutoffMs));
}

/** Days of history the policy retains, for display. */
export function retentionWindowDays(settings: RetentionSettings): number | null {
  return settings.enabled ? settings.days : null;
}

export function shouldPurge(settings: RetentionSettings): boolean {
  return settings.enabled && isValidRetentionDays(settings.days);
}

/** True when a stored day is strictly older than the retained window. */
export function isPurgeableDay(
  day: string,
  settings: RetentionSettings,
  now: Date = new Date()
): boolean {
  if (!shouldPurge(settings)) return false;
  return day < computeCutoffDay(settings, now);
}

export function describeRetention(settings: RetentionSettings): string {
  if (!settings.enabled) return 'Disabled — all click history is kept indefinitely.';
  return `Enabled — click data older than ${settings.days} days is deleted daily.`;
}

/** Clamp arbitrary input to a usable policy, for settings saves. */
export function normalizeRetention(input: Partial<RetentionSettings>): RetentionSettings {
  const enabled = input.enabled === true;
  const days = isValidRetentionDays(input.days) ? input.days : DEFAULT_RETENTION_DAYS;
  return { enabled, days };
}