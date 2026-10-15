-- P3 retention and configurable aggregation.
--
-- One row per owner. Retention is OFF by default: no click history is ever
-- deleted until an owner explicitly enables it.
create table if not exists public.owner_settings (
  owner_id uuid primary key,
  retention_enabled boolean not null default false,
  retention_days integer not null default 365,
  -- Aggregation dimensions. Disabling one collapses that column to a constant,
  -- which reduces storage without changing the redirect path.
  track_referrer boolean not null default true,
  track_device boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_settings_retention_days_range check (
    retention_days >= 1 and retention_days <= 3650
  )
);

alter table public.owner_settings enable row level security;

-- Keep updated_at fresh, reusing the shared trigger function from 0001.
drop trigger if exists owner_settings_set_updated_at on public.owner_settings;
create trigger owner_settings_set_updated_at
before update on public.owner_settings
for each row execute function public.set_updated_at();

-- The purge job filters by day. This index keeps the scheduled delete cheap.
create index if not exists daily_click_stats_day_idx on public.daily_click_stats (day);