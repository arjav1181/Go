export function deriveDeviceCategory(userAgent: string | null): string {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/(bot|crawler|spider|slurp|curl|wget|fetch|headless)/.test(ua)) return 'bot';
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return 'mobile';
  return 'desktop';
}

export function parseReferrerHost(referrer: string | null): string {
  if (!referrer) return 'direct';
  try {
    const url = new URL(referrer);
    const host = url.hostname.toLowerCase();
    if (host === '') return 'direct';
    return host;
  } catch {
    return 'unknown';
  }
}
