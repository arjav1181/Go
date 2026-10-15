/**
 * API key scopes (least privilege) and a fixed-window rate limiter.
 *
 * Both are deliberately simple and dependency-free. The rate limiter is
 * per-instance and best-effort: on serverless each instance keeps its own
 * counters, so the effective ceiling scales with concurrency. That is an
 * acceptable trade-off for a personal service and is documented as such.
 */

export const SCOPES = ['links:read', 'links:write', 'analytics:read'] as const;
export type Scope = (typeof SCOPES)[number];

export const DEFAULT_SCOPE: Scope = 'links:read';

const SCOPE_SET = new Set<string>(SCOPES);

export function isValidScope(value: unknown): value is Scope {
  return typeof value === 'string' && SCOPE_SET.has(value);
}

/**
 * Parse a comma-separated scope list.
 * Unknown scopes are dropped; an empty result falls back to the read-only
 * default so a malformed key can never become more permissive than intended.
 */
export function parseScopes(raw: string | null | undefined): Scope[] {
  if (!raw) return [DEFAULT_SCOPE];
  const scopes = raw
    .split(',')
    .map((value) => value.trim())
    .filter(isValidScope);
  return scopes.length > 0 ? [...new Set(scopes)] : [DEFAULT_SCOPE];
}

export function hasScope(granted: Scope[], required: Scope): boolean {
  return granted.includes(required);
}

/** Which scopes a mutating request needs. */
export const WRITE_SCOPES: Scope[] = ['links:write'];

export function describeScopes(scopes: Scope[]): string {
  return scopes.length === 0 ? 'none' : scopes.join(', ');
}

// --- rate limiting ---------------------------------------------------------

export const DEFAULT_RATE_LIMIT = 60; // requests per window per key
export const RATE_WINDOW_MS = 60_000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

export function rateLimitPerMinute(): number {
  const raw = Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? '');
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RATE_LIMIT;
  return Math.min(Math.trunc(raw), 10_000);
}

/**
 * Consume one unit from a key's budget.
 *
 * `now` is injectable so the window rollover is testable without timers.
 */
export function consumeRateLimit(
  key: string,
  now: number = Date.now(),
  limit: number = rateLimitPerMinute()
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const bucket: Bucket = { count: 1, resetAt: now + RATE_WINDOW_MS };
    buckets.set(key, bucket);
    return { allowed: true, limit, remaining: Math.max(0, limit - 1), resetAt: bucket.resetAt };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt
  };
}

/** Test seam: clear all buckets. */
export function __resetRateLimits(): void {
  buckets.clear();
}