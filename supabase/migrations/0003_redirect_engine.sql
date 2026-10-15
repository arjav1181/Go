-- P2 redirect engine: scheduled destination windows and weighted variants.

-- Scheduled destinations ----------------------------------------------------
-- A schedule is a time window that temporarily overrides links.destination_url.
-- Resolution happens on the redirect path at request time, so a change takes
-- effect immediately without a cron job.
create table if not exists public.link_schedules (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.links (id) on delete cascade,
  destination_url text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  constraint link_schedules_window_valid check (ends_at is null or ends_at > starts_at)
);

create index if not exists link_schedules_link_starts_idx
  on public.link_schedules (link_id, starts_at);

-- Weighted A/B and rotation -----------------------------------------------
-- Equal weights behave as simple rotation; unequal weights behave as an A/B
-- split. Selection is random per request and stores no visitor identity.
create table if not exists public.link_variants (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.links (id) on delete cascade,
  label text not null,
  destination_url text not null,
  weight integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint link_variants_weight_valid check (weight >= 0 and weight <= 100),
  constraint link_variants_label_format check (label ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  constraint link_variants_link_label_unique unique (link_id, label)
);

create index if not exists link_variants_link_idx on public.link_variants (link_id);

-- Per-variant click breakdown ----------------------------------------------
-- Adds a variant dimension to the existing aggregate table. No new visitor
-- data is stored: this is the same coarse aggregation, grouped one more way.
alter table public.daily_click_stats
  add column if not exists variant_label text not null default '';

alter table public.daily_click_stats
  drop constraint if exists daily_click_stats_unique;

alter table public.daily_click_stats
  add constraint daily_click_stats_unique
  unique (link_id, day, referrer_host, device_category, variant_label);

-- Atomic increment now carries the variant label.
drop function if exists public.increment_click(uuid, date, text, text);

create or replace function public.increment_click(
  p_link_id uuid,
  p_day date,
  p_referrer_host text,
  p_device_category text,
  p_variant_label text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.daily_click_stats (
    link_id, day, referrer_host, device_category, variant_label, click_count
  )
  values (p_link_id, p_day, p_referrer_host, p_device_category, coalesce(p_variant_label, ''), 1)
  on conflict (link_id, day, referrer_host, device_category, variant_label)
  do update set
    click_count = public.daily_click_stats.click_count + 1,
    updated_at = now();
end;
$$;

revoke all on function public.increment_click(uuid, date, text, text, text) from public;
grant execute on function public.increment_click(uuid, date, text, text, text) to service_role;

-- Row level security: no public access; service role bypasses RLS.
alter table public.link_schedules enable row level security;
alter table public.link_variants enable row level security;