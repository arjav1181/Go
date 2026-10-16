export function deriveDeviceCategory(userAgent: string | null): string {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/(bot|crawler|spider|slurp|curl|wget|fetch|headless)/.test(ua)) return 'bot';
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Referrer names that the system synthesises for its own first-party events.
 *
 * A QR scan is optical and a page-button click originates on a published page,
 * so neither carries a real Referer. Both are filed under a reserved label so
 * they are visible in the referrer breakdown rather than looking like direct
 * traffic.
 *
 * These are reserved, not merely preferred. A visitor fully controls the
 * `Referer` request header, so without this guard a hostile page could send
 * `Referer: Bitly QR Code` and mint fake scan attribution against any link.
 *
 * Collisions are not actually reachable through the hostname parser — a
 * hostname cannot contain a space — but the check is cheap and makes the
 * invariant explicit rather than incidental.
 */
export const RESERVED_REFERRERS = ['Bitly QR Code', 'Bitly Link-in-bio'] as const;

export function isReservedReferrer(value: string): boolean {
  return (RESERVED_REFERRERS as readonly string[]).includes(value);
}

export function parseReferrerHost(referrer: string | null): string {
  if (!referrer) return 'direct';
  try {
    const url = new URL(referrer);
    const host = url.hostname.toLowerCase();
    if (host === '') return 'direct';
    // Fail closed: if this ever resolved to a reserved label, record it as
    // unknown rather than as first-party traffic.
    if (isReservedReferrer(host)) return 'unknown';
    return host;
  } catch {
    return 'unknown';
  }
}
