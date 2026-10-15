/**
 * Timezone helpers for schedule editing.
 *
 * Timestamps are stored as UTC instants (timestamptz). The owner picks a
 * display timezone in the UI and the browser-side value is converted to UTC
 * before it ever reaches the server, so the stored instant is unambiguous no
 * matter where the request originates.
 *
 * Intl.DateTimeFormat is used rather than a hand-rolled offset table, so DST is
 * handled by the platform.
 */

export const COMMON_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Moscow',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland'
] as const;

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(timeZone: string | undefined | null): string {
  if (!timeZone) return 'UTC';
  return isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC instant.
 *
 * `value` is the `datetime-local` form, e.g. "2026-09-01T14:30".
 *
 * The conversion is done in two passes so DST gaps/overlaps resolve the way
 * platforms do: build an approximate instant, re-read its UTC components, then
 * re-interpret those components in the target zone.
 */
export function localInputToUtcIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second = '00'] = match;
  const zone = normalizeTimeZone(timeZone);

  const numbers = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second)
  };

  // Range-check before building a Date: Date.UTC silently rolls overflow over
  // (month 13 becomes the next year), which would store a bogus instant.
  if (numbers.month < 1 || numbers.month > 12) return null;
  if (numbers.day < 1 || numbers.day > 31) return null;
  if (numbers.hour > 23 || numbers.minute > 59 || numbers.second > 59) return null;
  const daysInMonth = new Date(Date.UTC(numbers.year, numbers.month, 0)).getUTCDate();
  if (numbers.day > daysInMonth) return null;

  const wallAsUtc = Date.UTC(
    numbers.year,
    numbers.month - 1,
    numbers.day,
    numbers.hour,
    numbers.minute,
    numbers.second
  );
  if (!Number.isFinite(wallAsUtc)) return null;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(wallAsUtc)).map((part) => [part.type, part.value])
  );
  if (!parts.year || !parts.month || !parts.day) return null;

  const asZoned = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  const offset = asZoned - wallAsUtc;
  return new Date(wallAsUtc - offset).toISOString();
}

/**
 * Format a UTC instant for display in a given timezone.
 */
export function formatInTimeZone(
  iso: string | null | undefined,
  timeZone: string,
  options: { withZone?: boolean } = {}
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const zone = normalizeTimeZone(timeZone);

  // Assemble from parts rather than trusting locale concatenation: some ICU
  // builds render en-CA as "2026-09-01, 05:30" with a separator of their own.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  const formatted = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;

  return options.withZone === false ? formatted : `${formatted} ${zone}`;
}

/** The browser's timezone, or UTC when unavailable. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}