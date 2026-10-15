/**
 * Redirect resolution chain.
 *
 * Order of precedence (each step falls back to the link's own destination if
 * it produces nothing):
 *
 *   1. link lifecycle (disabled / expired / missing)  -- handled by resolve.ts
 *   2. an active scheduled window
 *   3. a matching conditional rule (weighted among matches)
 *   4. an active experiment variant (hash-bucketed)
 *   5. the link's own destination
 *
 * Invalid or partial data never breaks a redirect: every layer degrades to the
 * layer below it.
 */

import {
  assignByBucket,
  hashBucket,
  BUCKET_COUNT,
  type WeightedVariant
} from '../experiments/bucketing';
import { resolveEffectiveDestination, type ScheduleWindow } from './target';
import { evaluateRules, filterQuery, type Rule, type RuleDecision } from '../rules/evaluate';
import { safeDestination } from './resolve';

export type ExperimentVariant = WeightedVariant & {
  destination_url: string;
  experiment_id?: string | null;
  /** Clicks attributed to this variant; used by the comparison view only. */
  clicks?: number;
};

export type ResolutionInput = {
  linkId: string;
  linkDestination: string;
  /** '' for the canonical host. */
  domain: string;
  schedules: ScheduleWindow[];
  variants: ExperimentVariant[];
  rules: Rule[];
  /** Raw request query parameters, filtered internally. */
  query: Record<string, string>;
  now: Date;
  /** Salt for deterministic bucketing; changing it re-buckets traffic. */
  salt: string;
};

export type ResolutionResult = {
  destination: string;
  source: 'schedule' | 'rule' | 'variant' | 'link';
  /** Variant label for per-variant click grouping; '' when not a variant. */
  variantLabel: string;
  /** Experiment id, when a variant served the request. */
  experimentId: string | null;
  /** Populated when rules were evaluated, for the preview/why view. */
  ruleDecision: RuleDecision | null;
};

export function experimentSalt(): string {
  return process.env.EXPERIMENT_SALT ?? '';
}

/** Stable key for bucketing a visitor into a link's traffic split. */
export function assignmentKey(linkId: string, domain: string, salt: string): string {
  return `${salt}|${domain}|${linkId}`;
}

/** Never emit a destination that is not a plain http(s) URL. */
function safeOr(value: string, fallback: string): string {
  return safeDestination(value) ?? fallback;
}

export function resolveRedirectTarget(input: ResolutionInput): ResolutionResult {
  const fallback = safeOr(input.linkDestination, input.linkDestination);
  const bucket = hashBucket(assignmentKey(input.linkId, input.domain, input.salt));

  // 1. Scheduled window wins over everything below it.
  const scheduled = resolveEffectiveDestination({
    linkDestination: fallback,
    schedules: input.schedules,
    now: input.now
  });
  if (scheduled.source === 'schedule') {
    return {
      destination: safeOr(scheduled.destination, fallback),
      source: 'schedule',
      variantLabel: '',
      experimentId: null,
      ruleDecision: null
    };
  }

  // 2. Conditional rules.
  let ruleDecision: RuleDecision | null = null;
  if (input.rules.length > 0) {
    const filtered = filterQuery(input.query);
    ruleDecision = evaluateRules(
      input.rules,
      { query: filtered.query, now: input.now, ignoredParams: filtered.ignored },
      bucket,
      BUCKET_COUNT
    );

    if (ruleDecision.rule) {
      return {
        destination: safeOr(ruleDecision.rule.destination_url, fallback),
        source: 'rule',
        variantLabel: '',
        experimentId: null,
        ruleDecision
      };
    }
  }

  // 3. Experiment / weighted variants.
  if (input.variants.length > 0) {
    const chosen = assignByBucket(input.variants as WeightedVariant[], bucket, BUCKET_COUNT);
    if (chosen) {
      const matched = input.variants.find((variant) => variant.id === chosen.id);
      return {
        destination: safeOr(matched?.destination_url ?? '', fallback),
        source: 'variant',
        variantLabel: chosen.label,
        experimentId: matched?.experiment_id ?? null,
        ruleDecision
      };
    }
  }

  // 4. The link's own destination.
  return {
    destination: fallback,
    source: 'link',
    variantLabel: '',
    experimentId: null,
    ruleDecision
  };
}