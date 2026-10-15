-- Phase 4: reproducible experiment evaluation.
--
-- An experiment records the hypothesis it was created for, an optional
-- evaluation window, and a versioned snapshot of its configuration. The
-- snapshot is what makes an aggregate result reproducible after the fact: the
-- live variant rows may change, but the version that produced a number does not.

alter table public.link_experiments
  add column if not exists hypothesis text;
alter table public.link_experiments
  add column if not exists outcome_metric text not null default 'clicks';
alter table public.link_experiments
  add column if not exists starts_at timestamptz;
alter table public.link_experiments
  add column if not exists ends_at timestamptz;

-- The window must be ordered when both ends are present.
alter table public.link_experiments
  drop constraint if exists link_experiments_window_valid;
alter table public.link_experiments
  add constraint link_experiments_window_valid
  check (ends_at is null or starts_at is null or ends_at > starts_at);

-- Immutable, versioned configuration snapshots.
create table if not exists public.experiment_config_versions (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.link_experiments (id) on delete cascade,
  version integer not null,
  -- Full routing configuration at this point in time.
  config jsonb not null,
  -- Who/what produced the snapshot (e.g. 'created', 'variant_updated').
  reason text not null default 'update',
  created_at timestamptz not null default now(),
  constraint experiment_config_versions_unique unique (experiment_id, version),
  constraint experiment_config_versions_version_positive check (version >= 1)
);

create index if not exists experiment_config_versions_idx
  on public.experiment_config_versions (experiment_id, version desc);

alter table public.experiment_config_versions enable row level security;

-- Aggregate outcome events, per experiment variant and day.
--
-- This is the minimal non-personal event data needed to recompute the reported
-- figures: how many times a variant was assigned, and how many aggregate clicks
-- followed. No visitor identifier of any kind is stored.
create table if not exists public.experiment_outcomes (
  id bigint generated always as identity primary key,
  experiment_id uuid not null references public.link_experiments (id) on delete cascade,
  variant_label text not null,
  day date not null,
  assignments bigint not null default 0,
  clicks bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint experiment_outcomes_unique unique (experiment_id, variant_label, day)
);

create index if not exists experiment_outcomes_idx
  on public.experiment_outcomes (experiment_id, day);

alter table public.experiment_outcomes enable row level security;

-- Roll assignment counts forward into the reproducible outcome table.
create or replace function public.increment_experiment_assignment(
  p_experiment_id uuid,
  p_variant_label text,
  p_day date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.experiment_outcomes (experiment_id, variant_label, day, assignments)
  values (p_experiment_id, p_variant_label, p_day, 1)
  on conflict (experiment_id, variant_label, day)
  do update set
    assignments = public.experiment_outcomes.assignments + 1,
    updated_at = now();
end;
$$;

revoke all on function public.increment_experiment_assignment(uuid, text, date) from public;
grant execute on function public.increment_experiment_assignment(uuid, text, date) to service_role;

drop trigger if exists experiment_outcomes_set_updated_at on public.experiment_outcomes;
create trigger experiment_outcomes_set_updated_at
before update on public.experiment_outcomes
for each row execute function public.set_updated_at();

-- Bounded housekeeping for the rate-limit table.
--
-- Only rows from windows that can no longer be current are removed. This is
-- additive and safe to run repeatedly.
create or replace function public.sweep_rate_limit_buckets(p_keep_windows integer default 2)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz;
  v_deleted integer;
begin
  v_cutoff := now() - make_interval(mins => greatest(p_keep_windows, 1) * 60);
  delete from public.rate_limit_buckets where window_start < v_cutoff;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.sweep_rate_limit_buckets(integer) from public;
grant execute on function public.sweep_rate_limit_buckets(integer) to service_role;