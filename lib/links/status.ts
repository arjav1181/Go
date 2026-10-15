/**
 * Link lifecycle status.
 *
 * Storage is UTC (timestamptz). All comparisons here are done on absolute
 * instants so the result never depends on the server's local timezone.
 *
 * The server-side redirect path (lib/links/resolve.ts) remains authoritative:
 * these helpers only describe a link for the management UI.
 */

export const EXPIRING_SOON_DAYS = 7;

export type LinkStatus = 'active' | 'expiring_soon' | 'expired' | 'disabled';

/**
 * Flat shape so callers never need to narrow: when there is no expiry,
 * `remainingMs` is null and `expired` is false.
 */
export type ExpiryInfo = {
  expiresAt: string | null;
  status: LinkStatus;
  remainingMs: number | null;
  expired: boolean;
};

export function msUntil(expiresAt: string, now: Date = new Date()): number {
  return new Date(expiresAt).getTime() - now.getTime();
}

/**
 * Derive status + remaining time for a link.
 *
 * A disabled link is reported as disabled even if it is also expired, because
 * that is the state the owner controls directly.
 */
export function getExpiryInfo(
  input: { is_active: boolean; expires_at: string | null },
  now: Date = new Date()
): ExpiryInfo {
  const { is_active, expires_at } = input;

  if (expires_at === null) {
    return { expiresAt: null, status: is_active ? 'active' : 'disabled', remainingMs: null, expired: false };
  }

  const remainingMs = msUntil(expires_at, now);
  const expired = remainingMs <= 0;

  let status: LinkStatus;
  if (!is_active) status = 'disabled';
  else if (expired) status = 'expired';
  else if (remainingMs <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000) status = 'expiring_soon';
  else status = 'active';

  return { expiresAt: expires_at, status, remainingMs, expired };
}

export function isRedirectEligible(
  input: { is_active: boolean; expires_at: string | null },
  now: Date = new Date()
): boolean {
  const { status } = getExpiryInfo(input, now);
  return status === 'active' || status === 'expiring_soon';
}

/**
 * Compact human-readable remaining time, e.g. "3d 4h", "2h 15m", "expired 2d ago".
 * Deliberately coarse: this is a glanceable indicator, not a precise timer.
 */
export function formatRemaining(ms: number): string {
  const abs = Math.abs(ms);

  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);

  let core: string;
  if (days > 0) core = `${days}d ${hours}h`;
  else if (hours > 0) core = `${hours}h ${minutes}m`;
  else core = `${minutes}m`;

  return ms <= 0 ? `expired ${core} ago` : core;
}

export const STATUS_LABEL: Record<LinkStatus, string> = {
  active: 'Active',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  disabled: 'Disabled'
};