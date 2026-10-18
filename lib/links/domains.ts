/**
 * Optional link aliases on additional domains.
 *
 * Disabled by default. The feature turns on purely through configuration:
 * set ALIAS_DOMAINS to a comma-separated list of extra hostnames you control.
 * When it is unset or empty, every link resolves on the canonical host and
 * this module is a pass-through, so the behaviour is identical to P0/P1.
 *
 * TLS and DNS for extra domains are the operator's responsibility; this code
 * never touches DNS.
 *
 * Since migration 0017 a verified custom domain is also honoured, so adding one
 * through the API does not require a redeploy to take effect. The env-var route
 * is kept because it is how a domain is aliased before its DNS propagates, and
 * because it costs nothing.
 */

import { getServiceSupabase } from '@/lib/db/supabase-server';

export const ALIAS_DOMAINS_ENV = 'ALIAS_DOMAINS';

/** Normalise a host: lowercase, strip port and trailing dot. */
export function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') return null;
  const withoutPort = trimmed.replace(/:\d+$/, '');
  const withoutDot = withoutPort.replace(/\.$/, '');
  return withoutDot === '' ? null : withoutDot;
}

export function parseAliasDomains(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const domains = raw
    .split(',')
    .map((value) => normalizeHost(value))
    .filter((value): value is string => value !== null);
  return [...new Set(domains)];
}

/**
 * Reject values that are not plausible hostnames, so a typo in configuration
 * cannot silently change routing.
 */
export function isPlausibleHostname(host: string): boolean {
  if (host.length < 4 || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (host.includes('..')) return false;
  if (host.startsWith('.') || host.endsWith('.')) return false;
  const labels = host.split('.');
  return labels.every((label) => label.length > 0 && label.length <= 63);
}

export type HostResolution = {
  /** The domain value stored on the link row. '' means the canonical host. */
  domain: string;
  /** True when the request arrived on an explicitly configured alias. */
  isAlias: boolean;
};

export type DomainConfig = {
  canonicalHost: string | null;
  aliasDomains: string[];
};

export function domainConfigFromEnv(
  env: Record<string, string | undefined>,
  appUrl: string | undefined
): DomainConfig {
  const canonicalHost = normalizeHost(safeHost(appUrl));
  const aliasDomains = parseAliasDomains(env[ALIAS_DOMAINS_ENV]).filter(
    (domain) => domain !== canonicalHost && isPlausibleHostname(domain)
  );
  return { canonicalHost, aliasDomains };
}

function safeHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function isAliasFeatureEnabled(config: DomainConfig): boolean {
  return config.aliasDomains.length > 0;
}

/**
 * Decide which `domain` value a request should resolve against.
 *
 * Unknown hosts deliberately resolve to the canonical domain instead of
 * failing, so a misconfigured DNS record degrades to normal behaviour rather
 * than breaking every short link.
 */
export function resolveHostScope(host: string | null, config: DomainConfig): HostResolution {
  const normalized = normalizeHost(host);

  if (!normalized || !isAliasFeatureEnabled(config)) {
    return { domain: '', isAlias: false };
  }

  if (normalized === config.canonicalHost) {
    return { domain: '', isAlias: false };
  }

  if (config.aliasDomains.includes(normalized)) {
    return { domain: normalized, isAlias: true };
  }

  return { domain: '', isAlias: false };
}
/**
 * Root-router lookup for verified custom domains.
 *
 * A visitor who types only the domain (no path) should be sent to the page the
 * owner configured, which is the spec's "root router". Returns null for
 * anything unverified, disabled or archived so a domain that loses
 * verification stops serving traffic rather than quietly continuing.
 *
 * Deliberately a single indexed read on the hot redirect path: it runs for
 * every visitor whose host is not the canonical domain, and a slow lookup here
 * would tax every request on a branded domain.
 */
export async function rootRedirectFor(host: string | null): Promise<string | null> {
  const normalized = normalizeHost(host);
  if (!normalized) return null;

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('custom_domains')
    .select('root_redirect_url')
    .eq('hostname', normalized)
    .eq('status', 'verified')
    .eq('archived', false)
    .not('root_redirect_url', 'is', null)
    .maybeSingle();

  if (error || !data) return null;
  const target = (data as { root_redirect_url?: string | null }).root_redirect_url;
  return target && target.length > 0 ? target : null;
}

/**
 * Should this host be treated as an alias even though it is not in
 * `ALIAS_DOMAINS`?
 *
 * A verified custom domain is authoritative, so it must resolve links the same
 * way the canonical host does. Without this, adding a domain would verify
 * successfully and then still 404 every link created on it.
 */
export async function isVerifiedCustomDomain(host: string | null): Promise<boolean> {
  const normalized = normalizeHost(host);
  if (!normalized) return false;

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('custom_domains')
    .select('id')
    .eq('hostname', normalized)
    .eq('status', 'verified')
    .eq('archived', false)
    .maybeSingle();

  return !error && Boolean(data);
}
