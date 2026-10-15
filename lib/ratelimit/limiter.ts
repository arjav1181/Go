/**
 * Multi-instance rate limiting.
 *
 * The store is Postgres because the application runs across multiple instances
 * and an in-memory counter only limits a single one. Each bucket is keyed by an
 * opaque, *hashed* identifier: the raw IP address is never stored or logged.
 *
 * Degradation policy is deliberate and differs by scope:
 *
 *  - **nonessential** (analytics, click recording, QR preview): if the limiter
 *    itself fails, the request is allowed. Losing a rate limit is preferable to
 *    breaking a visitor's redirect or an owner's dashboard.
 *  - **essential** (auth attempts, link creation, API mutations): if the limiter
 *    fails, the request is *still allowed* here too, but the failure is logged
 *    as an operational event. Blocking legitimate owners because the limiter is
 *    down would be an outage; this is a documented residual risk.
 */

import { createHash } from 'node:crypto';
import { getServiceSupabase } from '../db/supabase-server';

/** Buckets are hashed so a database dump never reveals an IP address. */
export function hashBucketKey(value: string, scope: string): string {
  return createHash('sha256').update(`${scope}|${value}`).digest('hex').slice(0, 32);
}

/**
 * Opaque per-caller key derived from request headers.
 *
 * Prefers a stable session-ish signal if the platform supplies one, otherwise
 * the connecting address. Neither is persisted in raw form, and this function
 * never returns anything that could be reversed to an IP address.
 */
export function callerKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const direct = headers.get('x-real-ip');
  const raw = (forwarded?.split(',')[0] ?? direct ?? 'unknown').trim();
  return hashBucketKey(raw || 'unknown', 'caller');
}

export type RateLimitOutcome = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  /** True when the limiter could not be consulted. */
  degraded: boolean;
};

export type RateLimitPolicy = {
  /** Identifies the caller; hashed by this module before use. */
  key: string;
  /** Namespace, e.g. 'login'. Separate budgets per operation. */
  scope: string;
  limit: number;
  windowSeconds: number;
  /** Allow through when the limiter is unavailable. Defaults to true. */
  failOpen?: boolean;
};

/** Read a limit from configuration, falling back to a safe default. */
export function limitFromEnv(name: string, fallback: number, max = 10_000): number {
  const raw = Number(process.env[name] ?? '');
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.trunc(raw), max);
}

/**
 * Shared counter store. Injectable so the decision logic can be tested without
 * a database; production uses Postgres.
 */
export type RateLimitStore = (input: {
  bucketKey: string;
  scope: string;
  windowSeconds: number;
}) => Promise<number>;

const postgresStore: RateLimitStore = async ({ bucketKey, scope, windowSeconds }) => {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('rate_limit_hit', {
    p_bucket_key: bucketKey,
    p_scope: scope,
    p_window_seconds: windowSeconds
  });
  if (error) throw error;
  if (typeof data !== 'number') throw new Error('unexpected rate limit response');
  return Number(data);
};

export async function checkRateLimit(
  policy: RateLimitPolicy,
  store: RateLimitStore = postgresStore
): Promise<RateLimitOutcome> {
  const failOpen = policy.failOpen ?? true;
  const bucketKey = hashBucketKey(policy.key, policy.scope);

  try {
    const hits = await store({
      bucketKey,
      scope: policy.scope,
      windowSeconds: policy.windowSeconds
    });

    // A malformed counter must not read as "over budget", which would turn a
    // store glitch into an accidental denial of service. Treat it as degraded.
    if (!Number.isFinite(hits)) {
      return degradedOutcome(policy, failOpen);
    }

    const allowed = hits <= policy.limit;
    return {
      allowed,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - hits),
      retryAfterSeconds: allowed ? 0 : policy.windowSeconds,
      degraded: false
    };
  } catch {
    return degradedOutcome(policy, failOpen);
  }
}

function degradedOutcome(policy: RateLimitPolicy, failOpen: boolean): RateLimitOutcome {
  return {
    allowed: failOpen,
    limit: policy.limit,
    remaining: 0,
    retryAfterSeconds: policy.windowSeconds,
    degraded: true
  };
}

/** Policy presets. Limits are deliberately generous for normal human use. */
export const POLICIES = {
  /** Password guessing against a single account. */
  login: { scope: 'login', limit: 10, windowSeconds: 300 },
  /** Link creation is the main spam/abuse surface. */
  linkCreate: { scope: 'link-create', limit: 30, windowSeconds: 3600 },
  /** Editing, toggling and rule changes. */
  linkEdit: { scope: 'link-edit', limit: 120, windowSeconds: 3600 },
  /** QR rendering is CPU-bound image generation. */
  qr: { scope: 'qr', limit: 30, windowSeconds: 300 },
  /** CSV export scans the whole stats table. */
  export: { scope: 'export', limit: 10, windowSeconds: 3600 },
  /** Public redirects: a light brake against scripted abuse only. */
  redirect: { scope: 'redirect', limit: 600, windowSeconds: 60 }
} as const;

export type PolicyName = keyof typeof POLICIES;

export function policyFor(
  name: PolicyName,
  key: string,
  overrides: { limit?: number; windowSeconds?: number; failOpen?: boolean } = {}
): RateLimitPolicy {
  const base = POLICIES[name];
  return {
    key,
    scope: base.scope,
    limit: overrides.limit ?? limitFromEnv(`RATE_LIMIT_${base.scope.toUpperCase().replace(/-/g, '_')}`, base.limit),
    windowSeconds: overrides.windowSeconds ?? base.windowSeconds,
    failOpen: overrides.failOpen ?? true
  };
}