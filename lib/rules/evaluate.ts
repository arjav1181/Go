/**
 * Conditional redirect rules.
 *
 * Conditions are declarative data only. Nothing here parses, compiles or
 * executes owner-supplied code or expressions: values are compared with plain
 * string equality or set membership, never with a user-supplied pattern.
 *
 * Supported condition kinds (all deterministic, all privacy-safe):
 *  - `query_param`  : request query parameter equals one of the allowed values
 *  - `time_window`  : request time falls inside [start, end)
 *
 * Explicitly unsupported, by design: IP or geo conditions, user-agent or
 * device fingerprinting, cookies, referrer matching, and any code execution.
 */

export type ConditionKind = 'query_param' | 'time_window';

export type RuleCondition = {
  id: string;
  kind: ConditionKind;
  /** Query parameter name, only for query_param. */
  param: string | null;
  /** Comma-separated allowed values, only for query_param. */
  value: string | null;
  /** Inclusive start (ISO), only for time_window. */
  starts_at: string | null;
  /** Exclusive end (ISO), only for time_window. */
  ends_at: string | null;
};

export type Rule = {
  id: string;
  name: string;
  /** Lower numbers evaluate first. */
  priority: number;
  destination_url: string;
  /** Relative weight among the rules that match. */
  weight: number;
  is_active: boolean;
  conditions: RuleCondition[];
};

export type RuleContext = {
  /** Query parameters from the request, already filtered by privacy rules. */
  query: Record<string, string>;
  now: Date;
  /** Names removed by the tracking-parameter filter, for the explanation view. */
  ignoredParams?: string[];
};

export type ConditionOutcome = {
  conditionId: string;
  kind: ConditionKind;
  matched: boolean;
  /** Why it matched or failed, safe to show the owner. */
  reason: string;
};

export type RuleOutcome = {
  ruleId: string;
  ruleName: string;
  priority: number;
  matched: boolean;
  conditions: ConditionOutcome[];
};

export type RuleDecision = {
  /** Chosen rule, or null when nothing matched (caller uses the default). */
  rule: Rule | null;
  destination: string | null;
  /** Every rule evaluated, in priority order, for the "why" view. */
  trace: RuleOutcome[];
  /** Rules that matched but lost to a higher-priority match. */
  shadowed: RuleOutcome[];
  /** Query parameters ignored because they are known tracking parameters. */
  ignoredParams: string[];
};

const PARAM_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Parameters that identify ad/campaign traffic rather than a deliberate choice
 * by the visitor. They are ignored unless an owner explicitly allowlists them,
 * which keeps the rule system from becoming a campaign-tracking backdoor.
 */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid',
  'ttclid', 'twclid', 'igshid', 'mc_cid', 'mc_eid', '_ga', '_gl', 'yclid',
  'li_fat_id', 'wickedid', 'ref', 'referrer', 'source'
]);

export function isTrackingParam(name: string): boolean {
  return TRACKING_PARAMS.has(name.toLowerCase());
}

/**
 * Drop tracking parameters before rules are evaluated.
 *
 * Returns the filtered map plus the names that were removed, so the owner can
 * see why a value had no effect.
 */
export function filterQuery(query: Record<string, string | undefined | null>): {
  query: Record<string, string>;
  ignored: string[];
} {
  const clean: Record<string, string> = {};
  const ignored: string[] = [];

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (isTrackingParam(key)) {
      ignored.push(key);
      continue;
    }
    clean[key] = value;
  }

  return { query: clean, ignored: ignored.sort() };
}

function evaluateCondition(condition: RuleCondition, ctx: RuleContext): ConditionOutcome {
  if (condition.kind === 'query_param') {
    const param = condition.param ?? '';
    const allowed = (condition.value ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    const actual = ctx.query[param];

    if (!PARAM_NAME_RE.test(param)) {
      return {
        conditionId: condition.id,
        kind: condition.kind,
        matched: false,
        reason: `Parameter name "${param}" is not a valid parameter name.`
      };
    }
    if (allowed.length === 0) {
      return {
        conditionId: condition.id,
        kind: condition.kind,
        matched: false,
        reason: `Rule for "${param}" has no allowed values configured.`
      };
    }
    if (actual === undefined) {
      return {
        conditionId: condition.id,
        kind: condition.kind,
        matched: false,
        reason: `Request had no "${param}" parameter.`
      };
    }

    // Exact string comparison only: no regex, no pattern matching.
    const matched = allowed.includes(actual);
    return {
      conditionId: condition.id,
      kind: condition.kind,
      matched,
      reason: matched
        ? `"${param}=${actual}" matched an allowed value.`
        : `"${param}=${actual}" did not match ${allowed.map((v) => `"${v}"`).join(', ')}.`
    };
  }

  if (condition.kind === 'time_window') {
    const nowMs = ctx.now.getTime();
    const startMs = condition.starts_at ? Date.parse(condition.starts_at) : Number.NaN;
    const endMs = condition.ends_at ? Date.parse(condition.ends_at) : Number.NaN;

    if (condition.starts_at && !Number.isFinite(startMs)) {
      return {
        conditionId: condition.id,
        kind: condition.kind,
        matched: false,
        reason: 'Start time is not a valid timestamp; condition ignored.'
      };
    }
    if (condition.ends_at && !Number.isFinite(endMs)) {
      return {
        conditionId: condition.id,
        kind: condition.kind,
        matched: false,
        reason: 'End time is not a valid timestamp; condition ignored.'
      };
    }
    if (condition.ends_at && Number.isFinite(startMs) && endMs <= startMs) {
      return {
        conditionId: condition.id,
        kind: condition.kind,
        matched: false,
        reason: 'Window ends before it starts; condition ignored.'
      };
    }

    const afterStart = !Number.isFinite(startMs) || nowMs >= startMs;
    const beforeEnd = !Number.isFinite(endMs) || nowMs < endMs;
    const matched = afterStart && beforeEnd;

    return {
      conditionId: condition.id,
      kind: condition.kind,
      matched,
      reason: matched
        ? 'Request time is inside the configured window.'
        : 'Request time is outside the configured window.'
    };
  }

  return {
    conditionId: condition.id,
    kind: condition.kind,
    matched: false,
    reason: 'Unsupported condition kind; treated as no match.'
  };
}

/**
 * Evaluate rules in priority order (ascending, then name for stability).
 *
 * The first matching rule wins, which is deterministic and predictable. Other
 * matching rules are returned in `shadowed` so the UI can warn about ambiguity
 * instead of leaving the owner guessing.
 */
export function evaluateRules(
  rules: Rule[],
  ctx: RuleContext,
  bucket: number,
  bucketCount: number
): RuleDecision {
  const active = rules
    .filter((rule) => rule.is_active)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  const trace: RuleOutcome[] = [];
  const matched: RuleOutcome[] = [];
  const matchedRules: Rule[] = [];

  for (const rule of active) {
    if (rule.conditions.length === 0) {
      trace.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        matched: false,
        conditions: []
      });
      continue;
    }

    const conditions = rule.conditions.map((condition) => evaluateCondition(condition, ctx));
    const isMatch = conditions.every((condition) => condition.matched);
    const outcome: RuleOutcome = {
      ruleId: rule.id,
      ruleName: rule.name,
      priority: rule.priority,
      matched: isMatch,
      conditions
    };
    trace.push(outcome);

    if (isMatch) {
      matched.push(outcome);
      matchedRules.push(rule);
    }
  }

  if (matchedRules.length === 0) {
    return { rule: null, destination: null, trace, shadowed: [], ignoredParams: ctx.ignoredParams ?? [] };
  }

  const winner = pickRuleByBucket(matchedRules, bucket, bucketCount);
  const winnerIndex = matchedRules.findIndex((rule) => rule.id === winner.id);

  return {
    rule: winner,
    destination: winner.destination_url,
    trace,
    shadowed: matched.filter((_, index) => index !== winnerIndex),
    ignoredParams: ctx.ignoredParams ?? []
  };
}

function pickRuleByBucket(
  rules: Rule[],
  bucket: number,
  bucketCount: number
): Rule {
  const total = rules.reduce((sum, rule) => sum + Math.max(0, rule.weight), 0);
  if (total <= 0) return rules[0];

  const normalized = ((bucket % bucketCount) + bucketCount) % bucketCount;
  const target = (normalized / bucketCount) * total;

  let cursor = 0;
  for (const rule of rules) {
    cursor += Math.max(0, rule.weight);
    if (target < cursor) return rule;
  }
  return rules[rules.length - 1];
}