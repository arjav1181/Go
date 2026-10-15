import { getServiceSupabase } from '@/lib/db/supabase-server';
import type { Rule, RuleCondition } from './evaluate';

type RawRule = {
  id: string;
  name: string;
  priority: number;
  destination_url: string;
  weight: number;
  is_active: boolean;
};

type RawCondition = {
  id: string;
  rule_id: string;
  kind: string;
  param: string | null;
  value: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

/**
 * Load a link's rules with their conditions, ordered by priority.
 *
 * Shared by the redirect path, the management UI and the rule validator so all
 * three see exactly the same rule set.
 */
export async function loadRules(linkId: string): Promise<Rule[]> {
  const supabase = getServiceSupabase();
  const { data: rules } = await supabase
    .from('link_rules')
    .select('id, name, priority, destination_url, weight, is_active')
    .eq('link_id', linkId)
    .order('priority', { ascending: true });

  const list = (rules ?? []) as RawRule[];
  if (list.length === 0) return [];

  const { data: conditions } = await supabase
    .from('link_rule_conditions')
    .select('id, rule_id, kind, param, value, starts_at, ends_at')
    .in('rule_id', list.map((rule) => rule.id));

  const allConditions = (conditions ?? []) as RawCondition[];

  return list.map((rule) => ({
    id: rule.id,
    name: rule.name,
    priority: rule.priority,
    destination_url: rule.destination_url,
    weight: rule.weight,
    is_active: rule.is_active,
    conditions: allConditions
      .filter((condition) => condition.rule_id === rule.id)
      .map(
        (condition): RuleCondition => ({
          id: condition.id,
          kind: condition.kind as RuleCondition['kind'],
          param: condition.param,
          value: condition.value,
          starts_at: condition.starts_at,
          ends_at: condition.ends_at
        })
      )
  }));
}