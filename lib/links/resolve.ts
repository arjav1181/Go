export type LinkRow = {
  id: string;
  destination_url: string;
  is_active: boolean;
  expires_at: string | null;
};

export type RedirectDecision =
  | { kind: 'redirect'; location: string }
  | { kind: 'not_found' }
  | { kind: 'gone'; reason: 'disabled' | 'expired' | 'invalid' };

export function safeDestination(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function decideRedirect(link: LinkRow | null, now: Date = new Date()): RedirectDecision {
  if (!link) return { kind: 'not_found' };
  if (!link.is_active) return { kind: 'gone', reason: 'disabled' };
  if (link.expires_at && new Date(link.expires_at).getTime() <= now.getTime()) {
    return { kind: 'gone', reason: 'expired' };
  }
  const destination = safeDestination(link.destination_url);
  if (!destination) return { kind: 'gone', reason: 'invalid' };
  return { kind: 'redirect', location: destination };
}
