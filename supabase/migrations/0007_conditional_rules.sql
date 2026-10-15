-- Phase 3 conditional redirects.
--
-- Rules are declarative data. There is no expression, script or pattern
-- language: conditions are query-parameter equality and time windows only.

create table if not exists public.link_rules (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.links (id) on delete cascade,
  name text not null,
  -- Lower numbers evaluate first. A unique index per link makes ordering
  -- deterministic; duplicate priorities are reported as a warning, not an error.
  priority integer not null default 1,
  destination_url text not null,
  -- Relative weight among the rules that match.
  weight integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_rules_priority_valid check (priority >= 1),
  constraint link_rules_weight_valid check (weight >= 0 and weight <= 100),
  constraint link_rules_name_format check (name ~ '^[a-z0-9][a-z0-9 _-]{0,63}$')
);

create index if not exists link_rules_link_idx on public.link_rules (link_id, priority);

create table if not exists public.link_rule_conditions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.link_rules (id) on delete cascade,
  -- Closed set: no arbitrary predicates.
  kind text not null,
  param text,
  value text,
  starts_at timestamptz,
  ends_at timestamptz,
  constraint link_rule_conditions_kind_valid check (kind in ('query_param', 'time_window')),
  -- A query_param condition must name a parameter and at least one value.
  constraint link_rule_conditions_param_valid check (
    kind <> 'query_param' or (param is not null and param ~ '^[A-Za-z0-9_-]{1,64}$')
  ),
  constraint link_rule_conditions_window_valid check (
    kind <> 'time_window' or ends_at is null or ends_at > starts_at
  )
);

create index if not exists link_rule_conditions_rule_idx on public.link_rule_conditions (rule_id);

alter table public.link_rules enable row level security;
alter table public.link_rule_conditions enable row level security;

drop trigger if exists link_rules_set_updated_at on public.link_rules;
create trigger link_rules_set_updated_at
before update on public.link_rules
for each row execute function public.set_updated_at();