/**
 * Short-lived unlock grants for password-protected links.
 *
 * Why this exists
 * ---------------
 * The password prompt form submits `POST /{slug}`. The obvious fix is to read
 * the password from the form body and redirect — but a redirect that carries the
 * password in the query string puts it in browser history, in the `Referer` of
 * the destination page, and in every access log between here and there. A short
 * link is often shared in public, so that leak is not hypothetical.
 *
 * So a successful verification mints a signed, expiring grant in an HttpOnly
 * cookie scoped to that one slug, and the browser is then redirected to the
 * plain `GET /{slug}`. The password itself never enters a URL.
 *
 * Grant contents: slug, link id, expiry, and an HMAC over those. There is no
 * user identity — this is "this browser proved it knows the password for this
 * one link", nothing more, and it grants no access to any other link.
 *
 * `?pw=` is still accepted on GET for API and CLI callers, which have no cookie
 * jar. That is a deliberate trade: those callers put the secret somewhere we do
 * not control either way.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long one unlock lasts. Short enough that a shared machine is not a leak. */
export const GRANT_TTL_MS = 30 * 60 * 1000;

const SEP = '.';

function secret(): string | null {
  const value = process.env.EXPERIMENT_SALT ?? process.env.CRON_SECRET ?? '';
  return value.length >= 16 ? value : null;
}

/** Domain-separated so this key can never be reused as another key's key. */
function derive(): string | null {
  const base = secret();
  if (!base) return null;
  return createHmac('sha256', base).update('link-password-grant').digest('base64url');
}

export interface Grant {
  slug: string;
  linkId: string;
  /** Unix ms. */
  expiresAt: number;
}

export function issueGrant(grant: Omit<Grant, 'expiresAt'> & { expiresAt?: number }, now = Date.now()): string | null {
  const key = derive();
  if (!key) return null;
  const expiresAt = grant.expiresAt ?? now + GRANT_TTL_MS;
  const body = `${grant.slug}${SEP}${grant.linkId}${SEP}${expiresAt}`;
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  return `${Buffer.from(body, 'utf8').toString('base64url')}${SEP}${sig}`;
}

/**
 * Verify a grant. Returns the claims when valid, null otherwise.
 *
 * Fails closed on a missing signing key, an unparseable token, a bad signature,
 * or an expired token. The comparison is constant-time.
 */
export function verifyGrant(token: string | undefined | null, now = Date.now()): Grant | null {
  const key = derive();
  if (!key || !token) return null;

  const parts = token.split(SEP);
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  let decoded: string;
  try {
    decoded = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const segments = decoded.split(SEP);
  if (segments.length !== 3) return null;
  const [slug, linkId, expiresRaw] = segments;

  const expected = createHmac('sha256', key).update(decoded).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  return { slug, linkId, expiresAt };
}

/** Cookie name for a slug. Scoped per link so one unlock never opens another. */
export function grantCookieName(slug: string): string {
  return `lk_${slug.replace(/[^a-z0-9_-]/gi, '').slice(0, 32)}`;
}

/**
 * Cookie attributes for the grant.
 *
 * `Secure` follows the request scheme so a local http://localhost run still
 * works; in production every request is https so the cookie is always secure.
 */
export function grantCookieOptions(maxAgeSeconds: number, secure: boolean): string {
  return [
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
    ''
  ]
    .filter(Boolean)
    .join('; ');
}

export { GRANT_TTL_MS as TTL_MS };