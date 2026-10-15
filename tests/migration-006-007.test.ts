import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const experiments = readFileSync(join(process.cwd(), 'supabase/migrations/0006_experiments.sql'), 'utf8');
const rules = readFileSync(join(process.cwd(), 'supabase/migrations/0007_conditional_rules.sql'), 'utf8');
const keys = readFileSync(
  join(process.cwd(), 'supabase/migrations/0004_api_keys_and_alias_domains.sql'),
  'utf8'
);

test('experiments are constrained to a lifecycle status set', () => {
  assert.match(experiments, /constraint link_experiments_status_valid check \(status in \('active', 'paused', 'stopped'\)\)/i);
});

test('at most one running experiment per link keeps routing unambiguous', () => {
  assert.match(experiments, /create unique index if not exists link_experiments_active_uidx[\s\S]*where status = 'active'/i);
});

test('variants attach to experiments and keep legacy rows working', () => {
  const variantsAlter = experiments.match(
    /alter table public\.link_variants[\s\S]*?;/i
  )?.[0];
  assert.ok(variantsAlter, 'link_variants must gain an experiment_id column');
  assert.match(variantsAlter, /experiment_id uuid references public\.link_experiments/i);
  // Phase 2 variants keep working with a NULL experiment, so the column must
  // stay nullable (NOT NULL would break rows created before Phase 3).
  assert.doesNotMatch(variantsAlter, /experiment_id uuid not null/i);
});

test('assignment stats store no visitor identity', () => {
  assert.match(experiments, /create table if not exists public\.experiment_daily_stats/i);
  assert.equal(/ip_address/i.test(experiments), false);
  assert.equal(/user_agent/i.test(experiments), false);
  assert.equal(/session_id|visitor_id|cookie/i.test(experiments), false);
});

test('assignment counting is atomic', () => {
  assert.match(experiments, /on conflict \(experiment_id, variant_label, day\)/i);
  assert.match(experiments, /assignment_count = public\.experiment_daily_stats\.assignment_count \+ 1/i);
});

test('assignment increment is restricted to service_role', () => {
  assert.match(experiments, /revoke all on function public\.increment_assignment\(uuid, text, date\) from public/i);
  assert.match(experiments, /grant execute on function public\.increment_assignment\(uuid, text, date\) to service_role/i);
});

test('new tables have row level security enabled', () => {
  const matches = experiments.match(/enable row level security/gi) ?? [];
  assert.equal(matches.length, 2);
});

// --- conditional rules -----------------------------------------------------

test('rule condition kinds are a closed set', () => {
  assert.match(
    rules,
    /constraint link_rule_conditions_kind_valid check \(kind in \('query_param', 'time_window'\)\)/i
  );
});

test('no condition kind allows IP, geo or user-agent', () => {
  const kinds = rules.match(/kind in \(([^)]*)\)/i)?.[1] ?? '';
  for (const forbidden of ['ip', 'geo', 'country', 'user_agent', 'device', 'cookie', 'referer']) {
    assert.equal(kinds.toLowerCase().includes(forbidden), false, forbidden);
  }
});

test('rule priority and weight are constrained', () => {
  assert.match(rules, /constraint link_rules_priority_valid check \(priority >= 1\)/i);
  assert.match(rules, /constraint link_rules_weight_valid check \(weight >= 0 and weight <= 100\)/i);
});

test('query parameter names are constrained to a safe charset', () => {
  assert.match(
    rules,
    /kind <> 'query_param' or \(param is not null and param ~ '\^\[A-Za-z0-9_-\]\{1,64\}\$'\)/i
  );
});

test('time windows must be ordered', () => {
  assert.match(rules, /constraint link_rule_conditions_window_valid check \(\s*kind <> 'time_window' or ends_at is null or ends_at > starts_at\s*\)/i);
});

test('rules and conditions have row level security', () => {
  const matches = rules.match(/enable row level security/gi) ?? [];
  assert.equal(matches.length, 2);
});

test('rules cascade when their link is deleted', () => {
  assert.match(rules, /link_id uuid not null references public\.links \(id\) on delete cascade/i);
  assert.match(rules, /rule_id uuid not null references public\.link_rules \(id\) on delete cascade/i);
});

// --- api keys --------------------------------------------------------------

test('api keys store a hash and never the plaintext secret', () => {
  assert.match(keys, /key_hash text not null/i);
  assert.equal(/\bkey text not null\b/i.test(keys), false);
});

test('api keys carry least-privilege scopes with a read-only default', () => {
  assert.match(keys, /scopes text not null default 'links:read'/i);
});

test('key rotation lineage is recorded', () => {
  assert.match(keys, /add column if not exists rotated_from uuid/i);
});