/**
 * API key generation and verification.
 *
 * Only a SHA-256 hash is stored, so a database leak does not expose usable
 * keys. Keys are compared in constant time to avoid leaking them via timing.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_KEY_PREFIX = 'go_';
/** Human-visible portion stored alongside the hash for identification. */
export const KEY_DISPLAY_PREFIX_LENGTH = 12;

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString('base64url');
  const key = `${API_KEY_PREFIX}${secret}`;
  return {
    key,
    hash: hashApiKey(key),
    prefix: key.slice(0, KEY_DISPLAY_PREFIX_LENGTH)
  };
}

export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, KEY_DISPLAY_PREFIX_LENGTH);
}

/** Constant-time comparison of two hex digests of equal length. */
export function safeHashEquals(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length >= 20 && value.length <= 200;
}

/**
 * Extract a bearer token from an Authorization header.
 * Returns null when the header is absent or not a bearer scheme.
 */
export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}