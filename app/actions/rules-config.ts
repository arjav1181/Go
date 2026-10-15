'use server';

import { revalidatePath } from 'next/cache';
import { assertOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { normalizeDestinationUrl, shortHostFromAppUrl } from '@/lib/links/validation';
import { validateRule, validateRuleSet, hasBlockingIssues } from '@/lib/rules/validate';
import { localInputToUtcIso, normalizeTimeZone } from '@/lib/schedules/timezone';
import { evaluateRules, filterQuery, type Rule, type RuleCondition } from '@/lib/rules/evaluate';
import { loadRules } from '@/lib/rules/repo';
import { BUCKET_COUNT } from '@/lib/experiments/bucketing';

export interface RuleActionResult {
  ok: boolean;
  message: string;
  issues?: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shortHost = shortHostFromAppUrl(process.env.NEXT_PUBLIC_APP_URL);

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function requireUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export type RuleFormInput = {
  name: string;
  priority: number;
  destination_url: string;
  weight: number;
  is_active: boolean;
  conditions: Array<{
    kind: 'query_param' | 'time_window';
    param?: string | null;
    value?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
  }>;
};

async function buildRuleFromForm(
  linkId: string,
  formData: FormData,
  existing: Rule | null
): Promise<RuleActionResult & { rule?: Rule }> {
  const name = getString(formData, 'name').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 64);
  const priority = Number(getString(formData, 'priority'));
  const weight = Number(getString(formData, 'weight'));
  const isActive = getString(formData, 'is_active') === 'true';
  const timeZone = normalizeTimeZone(getString(formData, 'time_zone'));

  const destination = normalizeDestinationUrl(getString(formData, 'destination_url'), shortHost);
  if (!destination.ok) return { ok: false, message: destination.error };

  const conditions: RuleCondition[] = [];

  // One query-parameter condition and one time-window condition are supported
  // per rule through this form; both are optional but at least one is required.
  const param = getString(formData, 'param').trim();
  const allowed = getString(formData, 'param_values').trim();
  if (param !== '' || allowed !== '') {
    conditions.push({
      id: 'c1',
      kind: 'query_param',
      param,
      value: allowed,
      starts_at: null,
      ends_at: null
    });
  }

  const rawStart = getString(formData, 'starts_at').trim();
  const rawEnd = getString(formData, 'ends_at').trim();
  if (rawStart !== '' || rawEnd !== '') {
    const startsAt = rawStart === '' ? null : localInputToUtcIso(rawStart, timeZone);
    const endsAt = rawEnd === '' ? null : localInputToUtcIso(rawEnd, timeZone);
    if (rawStart !== '' && !startsAt) {
      return { ok: false, message: 'Start time is not a valid date and time.' };
    }
    if (rawEnd !== '' && !endsAt) {
      return { ok: false, message: 'End time is not a valid date and time.' };
    }
    conditions.push({
      id: 'c2',
      kind: 'time_window',
      param: null,
      value: null,
      starts_at: startsAt,
      ends_at: endsAt
    });
  }

  const rule: Rule = {
    id: existing?.id ?? 'new',
    name,
    priority,
    destination_url: destination.url,
    weight,
    is_active: isActive,
    conditions
  };

  const issues = validateRule(rule);
  const blocking = issues.filter((issue) => issue.severity === 'error');
  if (blocking.length > 0) {
    return {
      ok: false,
      message: blocking[0].message,
      issues: issues.map((issue) => `${issue.severity}: ${issue.message}`)
    };
  }

  return {
    ok: true,
    message: 'Valid.',
    rule,
    issues: issues.map((issue) => `${issue.severity}: ${issue.message}`)
  };
}

/** Create a rule after validating it and the resulting rule set. */
export async function createRuleAction(
  linkId: string,
  _prev: RuleActionResult,
  formData: FormData
): Promise<RuleActionResult> {
  await assertOwner();
  requireUuid(linkId, 'link id');

  const built = await buildRuleFromForm(linkId, formData, null);
  if (!built.ok || !built.rule) {
    return { ok: false, message: built.message, issues: built.issues };
  }

  const existing = await loadRules(linkId);
  const projected = validateRuleSet([...existing, built.rule]);
  if (hasBlockingIssues(projected)) {
    const first = projected.find((issue) => issue.severity === 'error');
    return {
      ok: false,
      message: first?.message ?? 'Invalid rule.',
      issues: projected.map((issue) => `${issue.severity}: ${issue.message}`)
    };
  }

  const supabase = getServiceSupabase();
  const { data: created, error } = await supabase
    .from('link_rules')
    .insert({
      link_id: linkId,
      name: built.rule.name,
      priority: built.rule.priority,
      destination_url: built.rule.destination_url,
      weight: built.rule.weight,
      is_active: built.rule.is_active
    })
    .select('id')
    .single();

  if (error || !created) return { ok: false, message: 'Unable to create rule.' };

  const rows = built.rule.conditions.map((condition) => ({
    rule_id: created.id,
    kind: condition.kind,
    param: condition.param,
    value: condition.value,
    starts_at: condition.starts_at,
    ends_at: condition.ends_at
  }));

  if (rows.length > 0) {
    const { error: conditionError } = await supabase.from('link_rule_conditions').insert(rows);
    if (conditionError) {
      await supabase.from('link_rules').delete().eq('id', created.id);
      return { ok: false, message: 'Unable to create rule conditions.' };
    }
  }

  revalidatePath(`/links/${linkId}`);
  const warnings = (built.issues ?? []).filter((issue) => issue.startsWith('warning'));
  return {
    ok: true,
    message: warnings.length > 0 ? `Rule created. ${warnings.join(' ')}` : 'Rule created.'
  };
}

/** Edit a rule in place. Validation runs against the resulting set. */
export async function updateRuleAction(
  linkId: string,
  ruleId: string,
  _prev: RuleActionResult,
  formData: FormData
): Promise<RuleActionResult> {
  await assertOwner();
  requireUuid(linkId, 'link id');
  requireUuid(ruleId, 'rule id');

  const existing = await loadRules(linkId);
  const current = existing.find((rule) => rule.id === ruleId);
  if (!current) return { ok: false, message: 'Rule not found.' };

  const built = await buildRuleFromForm(linkId, formData, current);
  if (!built.ok || !built.rule) {
    return { ok: false, message: built.message, issues: built.issues };
  }

  const projected = validateRuleSet(
    existing.map((rule) => (rule.id === ruleId ? built.rule! : rule))
  );
  if (hasBlockingIssues(projected)) {
    const first = projected.find((issue) => issue.severity === 'error');
    return {
      ok: false,
      message: first?.message ?? 'Invalid rule.',
      issues: projected.map((issue) => `${issue.severity}: ${issue.message}`)
    };
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('link_rules')
    .update({
      name: built.rule.name,
      priority: built.rule.priority,
      destination_url: built.rule.destination_url,
      weight: built.rule.weight,
      is_active: built.rule.is_active
    })
    .eq('id', ruleId)
    .eq('link_id', linkId);

  if (error) return { ok: false, message: 'Unable to update rule.' };

  // Replace conditions wholesale; conditions have no independent identity.
  await supabase.from('link_rule_conditions').delete().eq('rule_id', ruleId);
  const rows = built.rule.conditions.map((condition) => ({
    rule_id: ruleId,
    kind: condition.kind,
    param: condition.param,
    value: condition.value,
    starts_at: condition.starts_at,
    ends_at: condition.ends_at
  }));
  if (rows.length > 0) {
    await supabase.from('link_rule_conditions').insert(rows);
  }

  revalidatePath(`/links/${linkId}`);
  return { ok: true, message: 'Rule updated.' };
}

export async function deleteRuleAction(linkId: string, ruleId: string): Promise<void> {
  await assertOwner();
  requireUuid(linkId, 'link id');
  requireUuid(ruleId, 'rule id');

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('link_rules')
    .delete()
    .eq('id', ruleId)
    .eq('link_id', linkId);

  if (error) throw new Error('Unable to delete rule.');
  revalidatePath(`/links/${linkId}`);
}

export async function toggleRuleAction(
  linkId: string,
  ruleId: string,
  nextActive: boolean
): Promise<void> {
  await assertOwner();
  requireUuid(linkId, 'link id');
  requireUuid(ruleId, 'rule id');

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('link_rules')
    .update({ is_active: nextActive })
    .eq('id', ruleId)
    .eq('link_id', linkId);

  if (error) throw new Error('Unable to update rule.');
  revalidatePath(`/links/${linkId}`);
}
/**
 * Preview a rule set against a hypothetical request.
 *
 * Uses exactly the same evaluator as the redirect path, so the explanation the
 * owner sees is the behaviour a real visitor would get. Nothing is persisted.
 */
export async function previewRulesAction(linkId: string, queryString: string, atIso: string) {
  await assertOwner();
  requireUuid(linkId, 'link id');

  const rules = await loadRules(linkId);

  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(queryString).entries()) {
    query[key] = value;
  }

  const when = atIso ? new Date(atIso) : new Date();
  if (Number.isNaN(when.getTime())) {
    return { ok: false as const, message: 'Preview time is not a valid date.' };
  }

  const filtered = filterQuery(query);
  const decision = evaluateRules(
    rules,
    { query: filtered.query, now: when, ignoredParams: filtered.ignored },
    0,
    BUCKET_COUNT
  );

  return {
    ok: true as const,
    matched: decision.rule?.id ?? null,
    destination: decision.destination,
    trace: decision.trace,
    shadowed: decision.shadowed,
    ignoredParams: filtered.ignored
  };
}
