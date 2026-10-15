/**
 * Static validation for rule sets.
 *
 * The goal is to refuse configurations that would behave unpredictably, rather
 * than silently resolving them in some arbitrary order.
 */

import type { Rule, RuleCondition } from './evaluate';

export type ValidationIssue = {
  ruleId: string | null;
  ruleName: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
};

const PARAM_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function validateRule(rule: Rule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (severity: 'error' | 'warning', code: string, message: string) =>
    issues.push({ ruleId: rule.id, ruleName: rule.name, severity, code, message });

  if (rule.destination_url.trim() === '') {
    push('error', 'destination_missing', 'Rule has no destination URL.');
  }

  if (!Number.isInteger(rule.priority) || rule.priority < 1) {
    push('error', 'priority_invalid', 'Priority must be a whole number of 1 or more.');
  }

  if (!Number.isFinite(rule.weight) || rule.weight < 0 || rule.weight > 100) {
    push('error', 'weight_invalid', 'Weight must be between 0 and 100.');
  }

  if (rule.conditions.length === 0) {
    push(
      'error',
      'no_conditions',
      'A rule must have at least one condition. A rule with no conditions would match every request and shadow the default destination.'
    );
  }

  const seenQueryParams = new Set<string>();
  for (const condition of rule.conditions) {
    issues.push(...validateCondition(rule, condition, seenQueryParams));
  }

  return issues;
}

function validateCondition(
  rule: Rule,
  condition: RuleCondition,
  seenQueryParams: Set<string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string, severity: 'error' | 'warning' = 'error') =>
    issues.push({ ruleId: rule.id, ruleName: rule.name, severity, code, message });

  if (condition.kind === 'query_param') {
    const param = condition.param ?? '';
    const allowed = (condition.value ?? '').split(',').map((v) => v.trim()).filter(Boolean);

    if (!PARAM_NAME_RE.test(param)) {
      push('param_invalid', `Parameter name "${param}" is not valid. Use letters, numbers, "-" or "_".`);
    }
    if (allowed.length === 0) {
      push('values_missing', 'Query parameter condition has no allowed values.');
    }
    if (allowed.length > 25) {
      push('values_too_many', 'Too many allowed values for one parameter.', 'warning');
    }
    if (seenQueryParams.has(param.toLowerCase()) && param !== '') {
      push(
        'param_repeated',
        `Parameter "${param}" is constrained twice in this rule; the stricter rule wins.`,
        'warning'
      );
    }
    if (param !== '') seenQueryParams.add(param.toLowerCase());
    return issues;
  }

  if (condition.kind === 'time_window') {
    const startValid = condition.starts_at ? Number.isFinite(Date.parse(condition.starts_at)) : true;
    const endValid = condition.ends_at ? Number.isFinite(Date.parse(condition.ends_at)) : true;

    if (condition.starts_at && !startValid) {
      push('start_invalid', 'Start time is not a valid timestamp.');
    }
    if (condition.ends_at && !endValid) {
      push('end_invalid', 'End time is not a valid timestamp.');
    }
    if (startValid && endValid && condition.starts_at && condition.ends_at) {
      if (Date.parse(condition.ends_at) <= Date.parse(condition.starts_at)) {
        push('window_inverted', 'Time window ends before it starts.');
      }
    }
    return issues;
  }

  push('kind_unsupported', `Unsupported condition kind "${condition.kind}".`);
  return issues;
}

/**
 * Validate a whole rule set for a link, including cross-rule conflicts.
 */
export function validateRuleSet(rules: Rule[]): ValidationIssue[] {
  const issues = rules.flatMap(validateRule);

  const priorities = new Map<number, Rule[]>();
  for (const rule of rules) {
    const list = priorities.get(rule.priority) ?? [];
    list.push(rule);
    priorities.set(rule.priority, list);
  }
  for (const [priority, group] of priorities) {
    if (group.length > 1) {
      for (const rule of group) {
        issues.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: 'warning',
          code: 'priority_tie',
          message: `Priority ${priority} is shared with ${group.length - 1} other rule(s). Ties are broken by name, which is deterministic but easy to misread.`
        });
      }
    }
  }

  // Two rules with identical conditions are genuinely ambiguous: only the
  // first would ever be reachable.
  const signature = (rule: Rule) =>
    rule.conditions
      .map((c) =>
        c.kind === 'query_param'
          ? `q:${(c.param ?? '').toLowerCase()}=${(c.value ?? '').trim().toLowerCase()}`
          : `t:${c.starts_at ?? ''}/${c.ends_at ?? ''}`
      )
      .sort()
      .join('&');

  const bySignature = new Map<string, Rule[]>();
  for (const rule of rules) {
    const key = signature(rule);
    const list = bySignature.get(key) ?? [];
    list.push(rule);
    bySignature.set(key, list);
  }
  for (const group of bySignature.values()) {
    if (group.length > 1) {
      for (const rule of group) {
        issues.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: 'warning',
          code: 'duplicate_conditions',
          message: 'Another rule has identical conditions; this rule can only be reached if that one is disabled.'
        });
      }
    }
  }

  return issues;
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}