-- Phase 3 experiments: lifecycle wrapper around weighted variants.
--
-- Existing link_variants rows (Phase 2) keep working unchanged; they simply
-- have experiment_id = NULL and continue to act as an ungrouped variant set.

create table if not exists public.link_experiments (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.links (id) on delete cascade,
  name text not null,
  -- active: running. paused: temporarily serving the link default.
  -- stopped: finished, results retained for the record.
  status text not null default 'active',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stopped_at timestamptz,
  constraint link_experiments_status_valid check (status in ('active', 'paused', 'stopped')),
  constraint link_experiments_name_format check (name ~ '^[a-z0-9][a-z0-9 _-]{0,63}$')
);

-- At most one running experiment per link keeps resolution unambiguous.
create unique index if not exists link_experiments_active_uidx
  on public.link_experiments (link_id)
  where status = 'active';

create index if not exists link_experiments_link_idx on public.link_experiments (link_id, status);

-- Variants may belong to an experiment. Rows created before Phase 3 keep
-- experiment_id NULL and continue to act as an ungrouped variant set.
alter table public.link_variants
  add column if not exists experiment_id uuid references public.link_experiments (id) on delete cascade;

create index if not exists link_variants_experiment_idx on public.link_variants (experiment_id);

-- Aggregate assignment counts, recorded independently of click stats so a
-- visitor can be counted as assigned even if the click write fails.
-- No visitor identity is stored: this is a per-day, per-variant counter.
create table if not exists public.experiment_daily_stats (
  experiment_id uuid not null references public.link_experiments (id) on delete cascade,
  variant_label text not null,
  day date not null,
  assignment_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint experiment_daily_stats_unique unique (experiment_id, variant_label, day)
);

create index if not exists experiment_daily_stats_idx
  on public.experiment_daily_stats (experiment_id, day);

alter table public.experiment_daily_stats enable row level security;

drop trigger if exists experiment_daily_stats_set_updated_at on public.experiment_daily_stats;
create trigger experiment_daily_stats_set_updated_at
before update on public.experiment_daily_stats
for each row execute function public.set_updated_at();

-- Atomic assignment increment.
create or replace function public.increment_assignment(
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
  insert into public.experiment_daily_stats (experiment_id, variant_label, day, assignment_count)
  values (p_experiment_id, p_variant_label, p_day, 1)
  on conflict (experiment_id, variant_label, day)
  do update set
    assignment_count = public.experiment_daily_stats.assignment_count + 1,
    updated_at = now();
end;
$$;

revoke all on function public.increment_assignment(uuid, text, date) from public;
grant execute on function public.increment_assignment(uuid, text, date) to service_role;

alter table public.link_experiments enable row level security;