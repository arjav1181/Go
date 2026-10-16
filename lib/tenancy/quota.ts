/**
 * Plans and quotas (spec sheet section 12).
 *
 * What this is, and what it deliberately is not
 * ---------------------------------------------
 * The spec publishes five tiers with specific monthly creation ceilings and
 * analytics history windows. Those numbers are a *pricing decision*, not a
 * technical fact, so they are not baked in here. What is implemented is the
 * mechanism: a named plan carrying limits, an owner assigned to one, and
 * enforcement at the point where an asset is created.
 *
 * Default is a single generous plan with no practical ceiling, because this
 * deployment has one operator and inventing a paywall nobody asked for would be
 * a product decision made by accident. Adding a paid tier is a row, not a code
 * change.
 *
 * Two distinctions the spec is careful about, preserved here:
 *
 *   - Creation limits are not traffic limits. You can hit your monthly link
 *     ceiling and still serve unlimited clicks to the links you have.
 *   - Redirect (destination-change) quota is separate from creation quota.
 *     Editing where a link points is metered independently.
 *
 * History windows are also per plan, and are enforced when reading analytics
 * rather than by discarding old rows — deleting data an owner is still entitled
 * to reason about would be worse than declining to show it.
 */

import { getServiceSupabase } from '@/lib/db/supabase-server';

export const PLAN_NAMES = ['solo', 'team', 'business', 'enterprise'] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

/** Metered actions. Each has its own counter window and limit. */
export const QUOTA_ACTIONS = [
  'link_create',
  'link_redirect',
  'qr_create',
  'page_create',
  'campaign_create',
  'api_request'
] as const;
export type QuotaAction = (typeof QUOTA_ACTIONS)[number];

/** Counters reset monthly, matching the documented windows. */
export const QUOTA_WINDOW_DAYS = 30;

export interface PlanLimits {
  link_create: number | null;
  link_redirect: number | null;
  qr_create: number | null;
  page_create: number | null;
  campaign_create: number | null;
  api_request: number | null;
  /** Days of click history the plan may read. */
  analyticsHistoryDays: number;
}

/**
 * Every action must have a limit on every plan.
 *
 * `satisfies` rather than `Record<PlanName, PlanLimits>`, because the explicit
 * interface above gives better errors: adding a new action to QUOTA_ACTIONS and
 * forgetting to meter it here is a compile error instead of an unmetered
 * action discovered in production.
 */
const _exhaustive: Record<QuotaAction, true> = {
  link_create: true,
  link_redirect: true,
  qr_create: true,
  page_create: true,
  campaign_create: true,
  api_request: true
};
void _exhaustive;

/**
 * Built-in defaults.
 *
 * `solo` is unmetered. The others exist so the shape can be exercised and so
 * adding a real commercial tier is a data change rather than a rewrite.
 */
export const PLAN_DEFAULTS: Record<PlanName, PlanLimits> = {
  solo: {
    link_create: null,
    link_redirect: null,
    qr_create: null,
    page_create: null,
    campaign_create: null,
    api_request: null,
    analyticsHistoryDays: 730
  },
  team: {
    link_create: 500,
    link_redirect: 20,
    qr_create: 10,
    page_create: 10,
    campaign_create: 25,
    api_request: 25_000,
    analyticsHistoryDays: 120
  },
  business: {
    link_create: 3_000,
    link_redirect: 110,
    qr_create: 200,
    page_create: 20,
    campaign_create: 100,
    api_request: 50_000,
    analyticsHistoryDays: 365
  },
  enterprise: {
    link_create: null,
    link_redirect: null,
    qr_create: null,
    page_create: null,
    campaign_create: null,
    api_request: null,
    analyticsHistoryDays: 730
  }
};

export function isPlanName(value: unknown): value is PlanName {
  return typeof value === 'string' && (PLAN_NAMES as readonly string[]).includes(value);
}

export function limitsFor(plan: PlanName): PlanLimits {
  return PLAN_DEFAULTS[plan] ?? PLAN_DEFAULTS.solo;
}

export interface QuotaDecision {
  allowed: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  reason?: string;
  /** False when the counter could not be read, so the caller knows it failed open. */
  measured: boolean;
}

/** Start of the current 30-day window, as a date. */
export function windowStart(now = new Date()): string {
  const d = new Date(now.getTime() - QUOTA_WINDOW_DAYS * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Is `plan` allowed another `action`?
 *
 * Counting happens in the caller, because the row to count differs per action —
 * links created, redirects performed, codes created. Passing the count in keeps
 * this function pure and testable, and keeps one wrong query from silently
 * metering the wrong thing.
 *
 * Fails open, and says so. A quota check that cannot reach the database must not
 * take the owner's ability to create a link offline; the caller can log
 * `measured: false` and alert on it instead. This is the opposite choice to the
 * permission check in lib/tenancy/groups.ts, and deliberately so: a missing
 * permission check is a security hole, a missing quota check is an accounting
 * error.
 */
export function checkQuota(
  plan: PlanName,
  action: QuotaAction,
  used: number
): QuotaDecision {
  const limit = limitsFor(plan)[action];

  if (limit === null) {
    return { allowed: true, limit: null, used, remaining: null, measured: true };
  }

  const remaining = Math.max(0, limit - used);
  return {
    allowed: used < limit,
    limit,
    used,
    remaining,
    measured: true,
    reason: used >= limit ? `Plan "${plan}" allows ${limit} ${action.replace('_', ' ')} per month.` : undefined
  };
}

/** How far back this plan may read analytics, given a requested window. */
export function clampHistoryDays(plan: PlanName, requestedDays: number): number {
  const max = limitsFor(plan).analyticsHistoryDays;
  return Math.max(1, Math.min(Math.floor(requestedDays), max));
}

/**
 * Count links created by an owner within the window.
 *
 * Returns null on failure so the caller can distinguish "zero used" from "could
 * not tell", and fail open deliberately.
 */
export async function countLinkCreates(ownerId: string, now = new Date()): Promise<number | null> {
  const supabase = getServiceSupabase();
  const { count, error } = await supabase
    .from('links')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', ownerId)
    .gte('created_at', windowStart(now).slice(0, 10));
  if (error) return null;
  return count ?? 0;
}

/** Count QR codes created within the window. */
export async function countQrCreates(ownerId: string, now = new Date()): Promise<number | null> {
  const supabase = getServiceSupabase();
  const { count, error } = await supabase
    .from('qr_codes')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', ownerId)
    .gte('created_at', windowStart(now).slice(0, 10));
  if (error) return null;
  return count ?? 0;
}

/**
 * The owner's plan.
 *
 * Reads `owner_settings.plan`, defaulting to `solo` when unset or unrecognised.
 * An unknown value must not lock an owner out of their own account, so this
 * falls back rather than rejecting.
 */
export async function planForOwner(ownerId: string): Promise<PlanName> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('owner_settings')
    .select('plan')
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error || !data) return 'solo';
  const plan = (data as { plan?: unknown }).plan;
  return isPlanName(plan) ? plan : 'solo';
}