/**
 * Custom domain verification (spec sheet section 10).
 *
 * The documented flow is: enter the domain, associate groups, publish the DNS
 * records, verify. This module owns step four and the record values for step
 * three.
 *
 * Verification is by DNS TXT lookup rather than by probing the domain over
 * HTTP. That is deliberate: a TXT record can be read before the domain has been
 * pointed at us, so an owner can verify ahead of a cutover instead of having to
 * move live traffic first and discover a typo afterwards.
 *
 * What the TXT record does and does not prove
 * ------------------------------------------
 * It proves the requester can edit DNS for that zone. That is exactly what
 * prevents someone else registering `bit.ly`-lookalike domains they do not own.
 * It is not a secret and is never treated as one — the token is stored in
 * plaintext because it must be shown back to the owner, and it grants nothing
 * on its own.
 */

import { resolveTxt } from 'node:dns/promises';

export const MAX_DOMAIN_LENGTH = 32;

/** Record name the owner publishes the token under. */
export const VERIFICATION_HOST = '_go-verify';

/** Record values the documented setup needs. */
export interface DnsInstructions {
  txt: { name: string; value: string };
  cname: { name: string; value: string };
}

/** How long a verification result is cached before a recheck. */
export const VERIFICATION_TTL_MS = 10 * 60 * 1000;

export interface HostnameCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a candidate short domain.
 *
 * Rejects the canonical app domain and anything that is not a plausible
 * hostname, since these become the visible half of every URL created with them.
 */
export function validateDomainHostname(
  hostname: string,
  canonicalHost?: string | null
): HostnameCheck {
  const host = hostname.trim().toLowerCase();

  if (!host) return { ok: false, reason: 'Enter a domain.' };
  if (host.length > MAX_DOMAIN_LENGTH) {
    return { ok: false, reason: `Must be ${MAX_DOMAIN_LENGTH} characters or fewer, including the dot.` };
  }
  if (!isPlausibleHostname(host)) {
    return { ok: false, reason: 'That is not a valid domain name.' };
  }
  if (canonicalHost && host === canonicalHost.trim().toLowerCase()) {
    return { ok: false, reason: 'That is already the main domain.' };
  }
  // `www.` on a short-link domain would make every link one prefix longer for
  // no benefit, and the spec treats the short domain as distinct from a
  // website domain.
  if (host.startsWith('www.')) {
    return { ok: false, reason: 'Remove the www. prefix — use the bare domain.' };
  }
  return { ok: true };
}

export function isPlausibleHostname(value: string): boolean {
  if (!value || value.length > 253) return false;
  if (value.startsWith('.') || value.endsWith('.')) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  return labels.every(
    (label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(label) && label.length <= 63
  );
}

export function dnsInstructions(
  hostname: string,
  token: string,
  canonicalHost: string
): DnsInstructions {
  return {
    txt: { name: VERIFICATION_HOST, value: token },
    cname: { name: '@', value: canonicalHost }
  };
}

/**
 * Look for the verification TXT record.
 *
 * Every failure mode is folded into `ok: false` with a reason the owner can act
 * on. DNS resolution also fails for reasons that have nothing to do with the
 * owner — a timeout, an upstream resolver failure — and those are reported
 * distinctly from a missing record, because telling someone their record is
 * wrong when their resolver is having a bad day costs them an hour.
 */
export async function verifyTxtRecord(
  hostname: string,
  expectedToken: string,
  lookup: (name: string) => Promise<string[][]> = (name) => resolveTxt(name)
): Promise<HostnameCheck> {
  const fqdn = `${VERIFICATION_HOST}.${hostname.trim().toLowerCase()}`;

  let records: string[][];
  try {
    records = await lookup(fqdn);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { ok: false, reason: `No TXT record found at ${fqdn}.` };
    }
    if (code === 'ETIMEOUT' || code === 'ESERVFAIL') {
      return { ok: false, reason: 'Could not query DNS just now. Try again in a minute.' };
    }
    return { ok: false, reason: 'Could not query DNS. Try again in a minute.' };
  }

  const flat = records.flat().map((v) => v.trim());
  if (flat.includes(expectedToken)) return { ok: true };
  if (flat.length) {
    return { ok: false, reason: `Found a TXT record but not the expected token. Expected ${expectedToken}.` };
  }
  return { ok: false, reason: `No TXT record found at ${fqdn}.` };
}

/**
 * Generate a verification token.
 *
 * Prefixed so it is recognisable in a zone file and greppable in a support
 * conversation. Random enough that guessing one does not let an attacker mark
 * someone else's domain as verified.
 */
export function generateVerificationToken(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  let body = '';
  for (let i = 0; i < 24; i += 1) {
    body += alphabet[Math.floor(random() * alphabet.length)];
  }
  return `go-verify-${body}`;
}

/**
 * Should this domain's root serve the configured page?
 *
 * True only when verified and not disabled, so a domain that lost
 * verification stops serving traffic rather than silently continuing.
 */
export function rootRouterActive(status: string, archived: boolean): boolean {
  return status === 'verified' && !archived;
}