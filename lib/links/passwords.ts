import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing for protected links.
 *
 * Reuses the shape of API-key hashing (salted, compared in constant time) but
 * upgrades to **scrypt**, because a link password is a human-chosen secret that
 * is guessable, unlike a 32-byte random API key. SHA-256 would be far too fast
 * to resist offline cracking of a weak password.
 *
 * The plaintext is never stored, never logged, and never leaves the request
 * that supplied it.
 */

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** scrypt cost. Tuned so a verification is ~50ms — slow enough to resist
 *  cracking, fast enough to sit in a request path. */
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashLinkPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for a missing or malformed hash rather than throwing: an
 * unconfigured column is a normal state, not an error.
 */
export function verifyLinkPassword(stored: string | null | undefined, password: string): boolean {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'base64');
    expected = Buffer.from(parts[2], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, SCRYPT_OPTIONS);
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * A short, URL-safe fingerprint of a link's password state.
 *
 * Lets the owner UI tell "protected" from "not protected" without storing or
 * transmitting anything reversible, and without running scrypt just to render a
 * badge.
 */
export function linkPasswordFingerprint(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return createHash('sha256').update(stored).digest('hex').slice(0, 12);
}

/**
 * Password policy.
 *
 * Deliberately modest: this gates a short link, not a bank account, and the
 * real limit is that an attacker can always brute-force a weak password
 * offline if they exfiltrate the database. The goal is to make the obvious
 * guesses fail, not to pretend otherwise.
 */
export function validateLinkPassword(password: string): { ok: true } | { ok: false; error: string } {
  if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
  if (password.length > 128) return { ok: false, error: 'Password must be at most 128 characters.' };
  if (!password.trim()) return { ok: false, error: 'Password cannot be only whitespace.' };

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) {
    return { ok: false, error: 'Use at least two of: lowercase, uppercase, numbers, symbols.' };
  }
  return { ok: true };
}