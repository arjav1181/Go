import { getServiceSupabase } from '@/lib/db/supabase-server';
import type { ScheduleWindow } from '@/lib/links/target';
import type { ExperimentVariant } from '@/lib/links/resolve-target';
import type { Rule, RuleCondition } from '@/lib/rules/evaluate';

export type RedirectConfig = {
  schedules: ScheduleWindow[];
  variants: ExperimentVariant[];
  rules: Rule[];
};

/**
 * Column sets tried in order, most capable first.
 *
 * The redirect must work against a database that has not been migrated yet,
 * and it must work against one that has been partly migrated. PostgREST cannot
 * ask for an optional column, so a query naming a missing column fails
 * outright — including the fallback. Degrading one column-set at a time is what
 * turns "this deployment is ahead of the database" from a redirect outage into
 * a slightly less capable redirect.
 */
const SELECT_FULL =
  'id, destination_url, is_active, expires_at, created_by, password_hash, campaign,' +
  'link_schedules(id, destination_url, starts_at, ends_at),' +
  'link_variants(id, label, destination_url, weight, is_active, experiment_id),' +
  'link_rules(id, name, priority, destination_url, weight, is_active,' +
  'link_rule_conditions(id, kind, param, value, starts_at, ends_at))';

/** Same, minus columns introduced by migration 0011. */
const SELECT_NO_PHASE_SIX =
  'id, destination_url, is_active, expires_at, created_by,' +
  'link_schedules(id, destination_url, starts_at, ends_at),' +
  'link_variants(id, label, destination_url, weight, is_active, experiment_id),' +
  'link_rules(id, name, priority, destination_url, weight, is_active,' +
  'link_rule_conditions(id, kind, param, value, starts_at, ends_at))';

export type LinkWithConfig = {
  id: string;
  destination_url: string;
  is_active: boolean;
  expires_at: string | null;
  created_by: string | null;
  password_hash: string | null;
  campaign: string | null;
} & RedirectConfig;

/**
 * Fetch a link *and* everything the redirect engine needs for it, in one
 * round trip.
 *
 * Previously this ran two queries that both started from `links`: resolve the
 * slug, then fetch routing config by id. Folding them together removes a full
 * database round trip from every redirect.
 *
 * Tries progressively smaller column sets so a partially migrated database
 * still redirects. Every step here has actually happened in production — a
 * deployment got ahead of the database and every link 404'd until this ladder
 * existed.
 */
export async function loadLinkWithConfig(params: {
  slug: string;
  domain: string;
}): Promise<LinkWithConfig | null> {
  const supabase = getServiceSupabase();

  for (const columns of [SELECT_FULL, SELECT_NO_PHASE_SIX]) {
    try {
      const { data, error } = await supabase
        .from('links')
        .select(columns)
        .eq('slug', params.slug)
        .eq('domain', params.domain)
        .maybeSingle();

      if (!error && data) return shapeLink(data as unknown as Record<string, unknown>);
      if (error) continue;
    } catch {
      continue;
    }
  }

  return loadLinkWithConfigFallback(params.slug, params.domain);
}

function shapeLink(row: Record<string, unknown>): LinkWithConfig {
  return {
    id: row.id as string,
    destination_url: row.destination_url as string,
    is_active: row.is_active as boolean,
    expires_at: (row.expires_at as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    // Absent rather than null means the column does not exist on this
    // database. Both must behave as "not set", never as an error.
    password_hash: (row.password_hash as string | null | undefined) ?? null,
    campaign: (row.campaign as string | null | undefined) ?? null,
    schedules: (row.link_schedules as ScheduleWindow[]) ?? [],
    variants: (row.link_variants as ExperimentVariant[]) ?? [],
    rules: shapeRules(row.link_rules)
  };
}

function shapeRules(raw: unknown): Rule[] {
  const rows =
    raw as Array<Omit<Rule, 'conditions'> & {
      link_rule_conditions: Array<Omit<RuleCondition, 'kind'> & { kind: string }> | null;
    }> | null;

  return (rows ?? []).map((rule) => ({
    id: rule.id,
    name: rule.name,
    priority: rule.priority,
    destination_url: rule.destination_url,
    weight: rule.weight,
    is_active: rule.is_active,
    conditions: (rule.link_rule_conditions ?? []).map((condition) => ({
      id: condition.id,
      kind: condition.kind as RuleCondition['kind'],
      param: condition.param,
      value: condition.value,
      starts_at: condition.starts_at,
      ends_at: condition.ends_at
    }))
  }));
}

/**
 * Last resort: a minimal link lookup plus per-table config.
 *
 * Only selects columns present since migration 0001, because by the time this
 * runs the database is known not to support the newer ones.
 */
async function loadLinkWithConfigFallback(slug: string, domain: string): Promise<LinkWithConfig | null> {
  const supabase = getServiceSupabase();

  const { data: link } = await supabase
    .from('links')
    .select('id, destination_url, is_active, expires_at, created_by')
    .eq('slug', slug)
    .eq('domain', domain)
    .maybeSingle();

  if (!link) return null;

  const config = await loadRedirectConfig((link as { id: string }).id);
  return {
    ...(link as Omit<LinkWithConfig, keyof RedirectConfig>),
    password_hash: null,
    campaign: null,
    ...config
  };
}

/**
 * Load everything the redirect engine needs for one link.
 *
 * A single embedded query is used when the schema supports it, which keeps the
 * hot path to one round trip instead of four. If the embedded query fails for
 * any reason — an older database that has not had the Phase 3 migrations applied,
 * or a PostgREST relationship that cannot be resolved — we fall back to plain
 * per-table lookups rather than failing the redirect.
 */
export async function loadRedirectConfig(linkId: string): Promise<RedirectConfig> {
  const supabase = getServiceSupabase();
  const empty: RedirectConfig = { schedules: [], variants: [], rules: [] };

  try {
    const { data, error } = await supabase
      .from('links')
      .select(
        'id, link_schedules(id, destination_url, starts_at, ends_at),' +
          'link_variants(id, label, destination_url, weight, is_active, experiment_id),' +
          'link_rules(id, name, priority, destination_url, weight, is_active,' +
          'link_rule_conditions(id, kind, param, value, starts_at, ends_at))'
      )
      .eq('id', linkId)
      .maybeSingle();

    if (!error && data) {
      const row = data as unknown as {
        id: string;
        link_schedules: ScheduleWindow[] | null;
        link_variants: ExperimentVariant[] | null;
        link_rules:
          | Array<
              Omit<Rule, 'conditions'> & {
                link_rule_conditions: Array<
                  Omit<RuleCondition, 'kind'> & { kind: string }
                > | null;
              }
            >
          | null;
      };

      return {
        schedules: row.link_schedules ?? [],
        variants: row.link_variants ?? [],
        rules: (row.link_rules ?? []).map((rule) => ({
          id: rule.id,
          name: rule.name,
          priority: rule.priority,
          destination_url: rule.destination_url,
          weight: rule.weight,
          is_active: rule.is_active,
          conditions: (rule.link_rule_conditions ?? []).map((condition) => ({
            id: condition.id,
            kind: condition.kind as RuleCondition['kind'],
            param: condition.param,
            value: condition.value,
            starts_at: condition.starts_at,
            ends_at: condition.ends_at
          }))
        }))
      };
    }
  } catch {
    // Fall through to the per-table path.
  }

  return loadRedirectConfigFallback(linkId, empty);
}

/**
 * Conservative per-table loader.
 *
 * Used when the embedded query is unavailable. Missing tables (for example the
 * rule tables on a database that has not been migrated yet) degrade to empty
 * collections, which makes the link fall back to its own destination instead of
 * failing the request.
 */
async function loadRedirectConfigFallback(linkId: string, empty: RedirectConfig): Promise<RedirectConfig> {
  const supabase = getServiceSupabase();

  const [schedules, variants, rules] = await Promise.all([
    supabase
      .from('link_schedules')
      .select('id, destination_url, starts_at, ends_at')
      .eq('link_id', linkId),
    supabase
      .from('link_variants')
      .select('id, label, destination_url, weight, is_active, experiment_id')
      .eq('link_id', linkId),
    supabase
      .from('link_rules')
      .select('id, name, priority, destination_url, weight, is_active')
      .eq('link_id', linkId)
  ]);

  const ruleRows = (rules.data ?? []) as Array<{
    id: string;
    name: string;
    priority: number;
    destination_url: string;
    weight: number;
    is_active: boolean;
  }>;

  const conditions =
    ruleRows.length > 0
      ? await supabase
          .from('link_rule_conditions')
          .select('id, rule_id, kind, param, value, starts_at, ends_at')
          .in('rule_id', ruleRows.map((rule) => rule.id))
      : { data: [] as unknown[] };

  const conditionRows = (conditions.data ?? []) as Array<{
    id: string;
    rule_id: string;
    kind: string;
    param: string | null;
    value: string | null;
    starts_at: string | null;
    ends_at: string | null;
  }>;

  return {
    schedules: (schedules.data ?? []) as ScheduleWindow[],
    variants: (variants.data ?? []) as ExperimentVariant[],
    rules:
      ruleRows.length > 0 || conditionRows.length > 0
        ? ruleRows.map((rule) => ({
            id: rule.id,
            name: rule.name,
            priority: rule.priority,
            destination_url: rule.destination_url,
            weight: rule.weight,
            is_active: rule.is_active,
            conditions: conditionRows
              .filter((condition) => condition.rule_id === rule.id)
              .map((condition) => ({
                id: condition.id,
                kind: condition.kind as RuleCondition['kind'],
                param: condition.param,
                value: condition.value,
                starts_at: condition.starts_at,
                ends_at: condition.ends_at
              }))
          }))
        : empty.rules
  };
}